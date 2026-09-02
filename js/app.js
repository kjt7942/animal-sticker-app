// 화면 조립 + 흐름 제어. 데이터는 animals.js / storage.js, 이미지는 sticker.js 담당.

import { SPECIES, DEX_TOTAL, toKorean, speciesForName, stars, RARITY_LABEL } from './animals.js';
import { openDb, getAllSightings, addSighting, clearAll, buildDex, getDaily, markDailyDone, formatDate } from './storage.js';
import { downscale, cutout, drawSticker, savePng, DECORATIONS } from './sticker.js';

const $ = (id) => document.getElementById(id);
const el = {
  status: $('status'), progressWrap: $('progressWrap'), progressBar: $('progressBar'),
  fileInput: $('fileInput'), pickInput: $('pickInput'), pickBtn: $('pickBtn'),
  preview: $('preview'), result: $('result'), confirmArea: $('confirmArea'), notFound: $('notFound'),
  altChips: $('altChips'), nameInput: $('nameInput'),
  convertBtn: $('convertBtn'), toggleOriginal: $('toggleOriginal'), saveBtn: $('saveBtn'),
  today: $('todayCard'), count: $('count'), collectBar: $('collectBar'),
  book: $('book'), settingsBtn: $('settingsBtn'),
  modal: $('modal'), modalCard: $('modalCard')
};

const READY_MSG = '✨ 준비 완료! 사진을 찍어보세요';

const state = {
  model: null,
  dex: new Map(),
  dexUrls: [],      // 도감을 다시 그릴 때 한꺼번에 정리한다
  previewUrl: null,
  originalBlob: null,
  stickerBlob: null,
  pendingBlob: null,
  usingOriginal: false,
  modalBitmap: null
};

const setStatus = (msg) => { el.status.textContent = msg; };

function dexUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.dexUrls.push(url);
  return url;
}

function setPreview(blob) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(blob);
  el.preview.src = state.previewUrl;
  el.preview.hidden = false;
}

// ---------- 시작 ----------

async function init() {
  bindEvents();
  try {
    await openDb();
    await refresh();
  } catch (e) {
    console.error('도감을 불러오지 못했습니다.', e);
    setStatus('도감을 불러오지 못했어요. 새로고침 해볼까요?');
  }

  try {
    state.model = await mobilenet.load();
    setStatus(READY_MSG);
  } catch (e) {
    console.error('모델 로딩 실패:', e);
    setStatus('동물 인식 준비에 실패했어요. 연결을 확인해 주세요.');
  }
}

async function refresh() {
  const sightings = await getAllSightings();
  state.dex = buildDex(sightings);
  renderDex();
  renderProgress();
  renderToday();
}

// ---------- 촬영 & 분석 ----------

function resetCapture() {
  state.stickerBlob = null;
  state.usingOriginal = false;
  el.result.innerHTML = '';
  el.confirmArea.hidden = true;
  el.notFound.hidden = true;
  el.convertBtn.hidden = true;
  el.toggleOriginal.hidden = true;
  el.toggleOriginal.classList.remove('active');
  el.toggleOriginal.textContent = '🖼️ 원본 사진으로 저장';
}

async function handleFile(file) {
  if (!file) { // 촬영 취소 또는 카메라 권한 거부
    showNotFound('카메라를 사용할 수 없나요?', '사진을 선택해서 동물을 찾아볼 수도 있어요.');
    return;
  }
  if (!state.model) {
    setStatus('아직 준비 중이에요. 잠시만 기다려 주세요!');
    return;
  }
  resetCapture();
  setStatus('사진 확인 중...');

  try {
    state.originalBlob = await downscale(file);
  } catch (e) {
    console.error('사진을 읽지 못했습니다.', e);
    showNotFound('사진을 열지 못했어요.', '다른 사진으로 다시 해볼까요?');
    setStatus(READY_MSG);
    return;
  }

  state.pendingBlob = state.originalBlob;
  setPreview(state.originalBlob);
  setStatus('동물 찾는 중...');

  try {
    await el.preview.decode();
    const predictions = await state.model.classify(el.preview);
    setStatus('거의 다 됐어요...');
    showPrediction(predictions);
  } catch (e) {
    console.error('분석 실패:', e);
    showNotFound('사진을 살펴보지 못했어요.', '잠시 후 다시 시도해 주세요.');
    setStatus(READY_MSG);
  }
}

function showPrediction(predictions) {
  const named = predictions
    .map(p => ({ prob: p.probability, ko: toKorean(p.className) }))
    .filter(x => x.ko);

  if (!named.length || named[0].prob < 0.1) {
    showNotFound('어라? 동물을 찾지 못했어요.', '동물이 잘 보이도록 다시 찍어볼까요?');
    setStatus(READY_MSG);
    return;
  }

  const top = named[0];
  const species = speciesForName(top.ko);
  const known = state.dex.get(species.id);
  const badge = known
    ? `<span class="badge again">또 만났어요!</span>`
    : `<span class="badge new">NEW!</span>`;

  el.result.innerHTML =
    `🎉 ${top.ko}<span class="pill">${(top.prob * 100).toFixed(0)}%</span> ${badge}`;
  el.result.classList.remove('pop'); void el.result.offsetWidth; el.result.classList.add('pop');

  const candidates = [...new Set(named.slice(0, 3).map(x => x.ko))];
  el.altChips.innerHTML = candidates.map((c, i) =>
    `<button type="button" class="chip${i === 0 ? ' picked' : ''}" data-name="${c}">${c}</button>`
  ).join('');
  el.nameInput.value = top.ko;
  el.confirmArea.hidden = false;
  el.convertBtn.hidden = false;
  setStatus(READY_MSG);
}

function showNotFound(title, hint) {
  el.notFound.innerHTML =
    `<p class="nf-title">${title}</p><p class="nf-hint">${hint}</p>
     <div class="nf-actions">
       <button type="button" class="btn-pink" data-nf="retake">📸 다시 찍기</button>
       <button type="button" class="btn-ghost" data-nf="pick">🖼️ 사진 선택</button>
     </div>`;
  el.notFound.hidden = false;
  el.confirmArea.hidden = true;
}

// ---------- 저장 ----------

async function saveToDex() {
  const name = el.nameInput.value.trim();
  if (!name || !state.pendingBlob) return;

  const species = speciesForName(name);
  const isNew = !state.dex.has(species.id);
  el.saveBtn.disabled = true;
  try {
    await addSighting({ speciesId: species.id, name, blob: state.pendingBlob });
    await refresh();
  } catch (e) {
    console.error('도감 저장 실패:', e);
    setStatus('도감에 저장하지 못했어요. 다시 시도해 주세요.');
    return;
  } finally {
    el.saveBtn.disabled = false;
  }

  if (isNew) { markDailyDone(); renderToday(); }

  const entry = state.dex.get(species.id);
  showDiscovery(entry, isNew);
  resetCapture();
  el.preview.hidden = true;
}

// ---------- 도감 렌더 ----------

function renderDex() {
  state.dexUrls.forEach(URL.revokeObjectURL);
  state.dexUrls = [];

  const today = formatDate(Date.now());
  const cardHtml = (species, entry) => {
    if (!entry) {
      // 발견한 카드와 높이를 맞추려고 같은 줄 수로 채운다(별은 회색 빈 별).
      return `<div class="card locked">
        <div class="qmark">?</div>
        <div class="name">아직 발견</div>
        <div class="stars">☆☆☆☆☆</div>
        <div class="meta">&nbsp;</div>
      </div>`;
    }
    const isToday = formatDate(entry.firstAt) === today;
    return `<button type="button" class="card" data-species="${species.id}">
      ${isToday ? '<span class="card-badge">NEW</span>' : ''}
      <img src="${dexUrl(entry.blob)}" alt="${species.name}">
      <div class="name">${species.name}</div>
      <div class="stars">${stars(species.rarity)}</div>
      <div class="meta">발견 ${entry.count}회</div>
    </button>`;
  };

  const parts = SPECIES.map(s => cardHtml(s, state.dex.get(s.id)));
  for (const entry of state.dex.values()) {
    if (entry.species.wild) parts.push(cardHtml(entry.species, entry));
  }
  el.book.innerHTML = parts.join('');
}

function renderProgress() {
  const found = SPECIES.filter(s => state.dex.has(s.id)).length;
  const wild = [...state.dex.values()].filter(e => e.species.wild).length;
  el.count.textContent = `${found} / ${DEX_TOTAL} 수집` + (wild ? ` (+야생 ${wild})` : '');
  el.collectBar.style.width = Math.round((found / DEX_TOTAL) * 100) + '%';
}

function renderToday() {
  const done = getDaily().done;
  el.today.className = 'today-card' + (done ? ' done' : '');
  el.today.innerHTML = done
    ? `<span class="today-title">🎉 오늘의 발견 완료!</span><span class="today-sub">내일 또 새로운 친구를 만나러 가요.</span>`
    : `<span class="today-title">🔎 오늘의 발견</span><span class="today-sub">새로운 동물 1마리를 찾아보세요! · 0 / 1</span>`;
}

// ---------- 모달 ----------

function openModal(html) {
  el.modalCard.innerHTML = html;
  el.modal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeModal() {
  el.modal.hidden = true;
  el.modalCard.innerHTML = ''; // 모달을 열 때마다 DOM 이 쌓이지 않도록 매번 비운다
  document.body.classList.remove('modal-open');
  if (state.modalBitmap) { state.modalBitmap.close(); state.modalBitmap = null; }
}

function showDiscovery(entry, isNew) {
  const s = entry.species;
  openModal(`
    <div class="discovery ${isNew ? 'is-new' : ''}">
      <p class="disc-head">${isNew ? '✨ 새로운 친구 발견!' : '🐾 또 만났어요!'}</p>
      <div class="disc-img"><img src="${dexUrl(entry.blob)}" alt="${s.name}"></div>
      <h3 class="disc-name">${s.name}</h3>
      <div class="stars big">${stars(s.rarity)}</div>
      <p class="disc-msg">${isNew
        ? '도감에 새로운 친구가 추가되었어요!'
        : `이번이 ${entry.count}번째 발견이에요.`}</p>
      <button type="button" class="btn-green" data-act="close">📖 도감에서 보기</button>
    </div>`);
}

function showDetail(speciesId) {
  const entry = state.dex.get(speciesId);
  if (!entry) return;
  const s = entry.species;
  openModal(`
    <div class="detail">
      <div class="disc-img"><img src="${dexUrl(entry.blob)}" alt="${s.name}"></div>
      <h3 class="disc-name">${s.emoji} ${s.name}</h3>
      <div class="stars big">${stars(s.rarity)} <span class="rarity-label">${RARITY_LABEL[s.rarity]}</span></div>
      <p class="disc-msg">${s.description}</p>
      <div class="stat-row">
        <div><b>${entry.count}회</b><span>발견 횟수</span></div>
        <div><b>${formatDate(entry.firstAt)}</b><span>첫 발견</span></div>
      </div>
      <button type="button" class="btn-pink" data-act="big" data-species="${s.id}">🔍 스티커 크게 보기</button>
      <button type="button" class="btn-green" data-act="retake">📸 다시 사진 찍기</button>
      <button type="button" class="btn-ghost" data-act="close">닫기</button>
    </div>`);
}

function showStickerView(speciesId) {
  const entry = state.dex.get(speciesId);
  if (!entry) return;
  openModal(`
    <div class="sticker-view">
      <div class="checker"><img src="${dexUrl(entry.blob)}" alt="${entry.species.name}"></div>
      <button type="button" class="btn-pink" data-act="decorate" data-species="${speciesId}">🎨 꾸미기</button>
      <button type="button" class="btn-green" data-act="download" data-species="${speciesId}">💾 PNG로 저장</button>
      <button type="button" class="btn-ghost" data-act="close">닫기</button>
    </div>`);
}

async function showDecorate(speciesId) {
  const entry = state.dex.get(speciesId);
  if (!entry) return;
  openModal(`
    <div class="decorate">
      <div class="checker"><canvas id="decoCanvas"></canvas></div>
      <input id="decoText" type="text" maxlength="12" placeholder="문구를 넣어보세요 (12자)">
      <div id="decoChips">${DECORATIONS.map(d =>
        `<button type="button" class="chip" data-deco="${d.id}">${d.emoji} ${d.label}</button>`).join('')}</div>
      <button type="button" class="btn-green" data-act="download-deco" data-species="${speciesId}">💾 PNG로 저장</button>
      <button type="button" class="btn-ghost" data-act="close">닫기</button>
    </div>`);

  try { await document.fonts.load('40px Jua'); } catch (e) { /* 글꼴이 없으면 기본 글꼴로 그린다 */ }
  state.modalBitmap = await createImageBitmap(entry.blob);
  const canvas = $('decoCanvas');
  const picked = new Set();
  const render = () => drawSticker(canvas, state.modalBitmap, {
    text: $('decoText').value.trim(),
    decorations: [...picked]
  });

  $('decoText').addEventListener('input', render);
  $('decoChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-deco]');
    if (!btn) return;
    const id = btn.dataset.deco;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    btn.classList.toggle('picked', picked.has(id));
    render();
  });
  render();
}

function showSettings() {
  openModal(`
    <div class="settings">
      <h3 class="disc-name">⚙️ 설정</h3>
      <p class="disc-msg">도감은 이 기기에만 저장돼요.</p>
      <button type="button" class="btn-ghost danger" data-act="clear">🗑️ 도감 전체 비우기</button>
      <button type="button" class="btn-ghost" data-act="close">닫기</button>
    </div>`);
}

async function downloadSticker(speciesId, fromCanvas) {
  const entry = state.dex.get(speciesId);
  if (!entry) return;
  let blob = entry.blob;
  if (fromCanvas) {
    const canvas = $('decoCanvas');
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  try {
    await savePng(blob, `${entry.species.name}-스티커.png`);
  } catch (e) {
    console.error('스티커 저장 실패:', e);
    setStatus('스티커를 저장하지 못했어요.');
  }
}

// ---------- 이벤트 ----------

function bindEvents() {
  el.fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = ''; // 같은 사진을 다시 골라도 change 가 발생하도록
  });
  el.pickInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleFile(file);
  });
  el.pickBtn.addEventListener('click', () => el.pickInput.click());

  el.altChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    el.nameInput.value = btn.dataset.name;
    el.altChips.querySelectorAll('.chip').forEach(c => c.classList.remove('picked'));
    btn.classList.add('picked');
  });

  el.convertBtn.addEventListener('click', async () => {
    if (!state.originalBlob) return;
    el.convertBtn.disabled = true;
    setStatus('✂️ 배경 지우는 중...');
    el.progressWrap.hidden = false;
    el.progressBar.classList.add('indeterminate'); // 진행률이 안 잡히는 구간은 슬라이딩 애니메이션으로 대체

    const sticker = await cutout(state.originalBlob, (pct) => {
      if (pct >= 99) {
        el.progressBar.classList.add('indeterminate');
      } else {
        el.progressBar.classList.remove('indeterminate');
        el.progressBar.style.width = pct + '%';
      }
    });

    el.progressWrap.hidden = true;
    el.progressBar.classList.remove('indeterminate');
    el.progressBar.style.width = '0%';
    el.convertBtn.disabled = false;

    if (sticker) {
      state.stickerBlob = sticker;
      state.pendingBlob = sticker;
      setPreview(sticker);
      el.convertBtn.hidden = true;
      el.toggleOriginal.hidden = false;
      setStatus(READY_MSG);
    } else {
      setStatus('배경을 지우지 못했어요. 원본 사진으로 저장할게요.');
    }
  });

  el.toggleOriginal.addEventListener('click', () => {
    state.usingOriginal = !state.usingOriginal;
    state.pendingBlob = state.usingOriginal ? state.originalBlob : state.stickerBlob;
    setPreview(state.pendingBlob);
    el.toggleOriginal.textContent = state.usingOriginal ? '✨ 스티커로 저장' : '🖼️ 원본 사진으로 저장';
    el.toggleOriginal.classList.toggle('active', state.usingOriginal);
  });

  el.saveBtn.addEventListener('click', saveToDex);

  el.notFound.addEventListener('click', (e) => {
    const act = e.target.closest('[data-nf]')?.dataset.nf;
    if (act === 'retake') el.fileInput.click();
    if (act === 'pick') el.pickInput.click();
  });

  el.book.addEventListener('click', (e) => {
    const card = e.target.closest('.card[data-species]');
    if (card) showDetail(card.dataset.species);
  });

  el.settingsBtn.addEventListener('click', showSettings);

  el.modal.addEventListener('click', async (e) => {
    if (e.target === el.modal) { closeModal(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, species } = btn.dataset;
    if (act === 'close') closeModal();
    else if (act === 'big') showStickerView(species);
    else if (act === 'decorate') showDecorate(species);
    else if (act === 'download') downloadSticker(species, false);
    else if (act === 'download-deco') downloadSticker(species, true);
    else if (act === 'retake') { closeModal(); el.fileInput.click(); }
    else if (act === 'clear') {
      if (!confirm('도감을 전부 비울까요? 되돌릴 수 없어요.')) return;
      await clearAll();
      await refresh();
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeModal();
  });
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('서비스 워커 등록 실패', e));
  });
}

init();
