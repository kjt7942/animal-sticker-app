// 이미지 처리 전담: 축소 / 배경 제거 / 스티커 테두리 / 꾸미기 / PNG 저장

let removeBg;   // @imgly/background-removal 은 용량이 커서 실제로 쓸 때 처음 불러온다
let gpuBroken = false; // WebGPU 가 한 번 실패하면 그 뒤로는 바로 CPU 로 간다

async function loadRemover() {
  if (!removeBg) {
    const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs');
    removeBg = mod.removeBackground;
  }
  return removeBg;
}

// 요즘 폰 사진은 1200만 화소가 넘는다. 그대로 두면 배경 제거도 저장도 느려서 긴 변을 맞춰 줄인다.
export async function downscale(file, max = 1280) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1) { bmp.close(); return file; }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

// 배경 제거 -> 여백 잘라내기 -> 흰 테두리. 실패하면 null (호출 측에서 원본 사용)
export async function cutout(file, onProgress) {
  try {
    const remove = await loadRemover();
    const fileProgress = {};
    const options = {
      progress: (key, current, total) => {
        fileProgress[key] = total ? current / total : 0;
        const values = Object.values(fileProgress);
        onProgress(Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100));
      }
    };

    // WASM(CPU) 단일 스레드로 돌리면 같은 사진이 12초 넘게 걸린다.
    // GitHub Pages 에서는 헤더를 못 넣어 멀티스레드도 못 켜므로 WebGPU 를 먼저 시도한다.
    let raw;
    if (navigator.gpu && !gpuBroken) {
      try {
        raw = await remove(file, { ...options, device: 'gpu' });
      } catch (e) {
        console.warn('WebGPU 배경 제거 실패, CPU 로 전환합니다.', e);
        gpuBroken = true;
      }
    }
    if (!raw) raw = await remove(file, options); // 전용 매팅 모델이 PNG(투명 배경) Blob 을 바로 반환

    return await makeSticker(raw);
  } catch (e) {
    console.error('배경 제거 실패:', e);
    return null;
  }
}

// 투명 여백을 잘라내고 실루엣을 따라 균일한 흰 테두리를 두른다.
// 예전처럼 실루엣을 여러 각도로 겹쳐 그리면 다리·더듬이 둘레가 울퉁불퉁해져서,
// 거리 변환(가장 가까운 피사체까지의 거리)으로 테두리를 그린다.
async function makeSticker(blob, borderRatio = 0.03) {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;

  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d');
  sctx.drawImage(bmp, 0, 0);
  const alpha = sctx.getImageData(0, 0, w, h).data;

  // 1) 피사체 경계 상자
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { bmp.close(); return null; } // 남은 게 없으면 실패로 본다

  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const border = Math.max(6, Math.round(Math.max(sw, sh) * borderRatio));
  const pad = border + 2;
  const W = sw + pad * 2, H = sh + pad * 2;

  const cropped = document.createElement('canvas');
  cropped.width = W; cropped.height = H;
  const cctx = cropped.getContext('2d');
  cctx.drawImage(bmp, x0, y0, sw, sh, pad, pad, sw, sh);
  bmp.close();
  const cropAlpha = cctx.getImageData(0, 0, W, H).data;

  // 2) 체임퍼 거리 변환 - 두 번 훑어서 각 픽셀이 피사체에서 얼마나 떨어졌는지 구한다
  const INF = 1e9;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = cropAlpha[i * 4 + 3] > 90 ? 0 : INF;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + D1);
      if (y > 0) v = Math.min(v, dist[i - W] + D1);
      if (x > 0 && y > 0) v = Math.min(v, dist[i - W - 1] + D2);
      if (x < W - 1 && y > 0) v = Math.min(v, dist[i - W + 1] + D2);
      dist[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = dist[i];
      if (x < W - 1) v = Math.min(v, dist[i + 1] + D1);
      if (y < H - 1) v = Math.min(v, dist[i + W] + D1);
      if (x < W - 1 && y < H - 1) v = Math.min(v, dist[i + W + 1] + D2);
      if (x > 0 && y < H - 1) v = Math.min(v, dist[i + W - 1] + D2);
      dist[i] = v;
    }
  }

  // 3) 테두리를 깔고 그 위에 피사체를 올린다
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const outline = octx.createImageData(W, H);
  const od = outline.data;
  for (let i = 0; i < W * H; i++) {
    const d = dist[i];
    if (d > border) continue;
    od[i * 4] = 255; od[i * 4 + 1] = 255; od[i * 4 + 2] = 255;
    od[i * 4 + 3] = Math.max(0, Math.min(1, border + 1 - d)) * 255; // 바깥 1px 만 부드럽게
  }
  octx.putImageData(outline, 0, 0);
  octx.drawImage(cropped, 0, 0);

  return new Promise(resolve => out.toBlob(resolve, 'image/png'));
}

export const DECORATIONS = [
  { id:'heart',   emoji:'💖', label:'하트' },
  { id:'star',    emoji:'⭐', label:'별' },
  { id:'sparkle', emoji:'✨', label:'반짝' },
  { id:'flower',  emoji:'🌸', label:'꽃' }
];

// 꾸미기 결과를 캔버스에 그린다. 투명 배경 유지.
export async function drawSticker(canvas, bmp, { text = '', decorations = [] } = {}) {
  const w = bmp.width;
  const h = bmp.height;
  const unit = Math.max(w, h);
  const captionH = text ? Math.round(unit * 0.22) : 0;

  canvas.width = w;
  canvas.height = h + captionH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0);

  // 장식은 모서리 쪽에 고정 배치 (드래그는 아직 필요 없다)
  const spots = [[0.12, 0.14], [0.88, 0.2], [0.16, 0.82], [0.84, 0.78]];
  const size = Math.round(unit * 0.16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  decorations.forEach((id, i) => {
    const deco = DECORATIONS.find(d => d.id === id);
    if (!deco) return;
    const [rx, ry] = spots[i % spots.length];
    ctx.font = `${size}px sans-serif`;
    ctx.fillText(deco.emoji, w * rx, h * ry);
  });

  if (text) {
    const fontSize = Math.round(unit * 0.13);
    ctx.font = `${fontSize}px Jua, sans-serif`;
    const y = h + captionH / 2;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, fontSize * 0.28);
    ctx.strokeStyle = '#fff';
    ctx.strokeText(text, w / 2, y);
    ctx.fillStyle = '#ff6f91';
    ctx.fillText(text, w / 2, y);
  }
  return canvas;
}

// 모바일에서는 공유 시트가 가장 확실한 저장 경로다. 안 되면 다운로드로 넘어간다.
export async function savePng(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      console.warn('공유 실패, 다운로드로 대체합니다.', e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
