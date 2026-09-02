// 이미지 처리 전담: 축소 / 배경 제거 / 스티커 테두리 / 꾸미기 / PNG 저장

let removeBg; // @imgly/background-removal 은 용량이 커서 실제로 쓸 때 처음 불러온다

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

// 배경 제거 -> 얇은 부위 보정 -> 흰 테두리. 실패하면 null (호출 측에서 원본 사용)
export async function cutout(file, onProgress) {
  try {
    const remove = await loadRemover();
    const fileProgress = {};
    const raw = await remove(file, {
      progress: (key, current, total) => {
        fileProgress[key] = total ? current / total : 0;
        const values = Object.values(fileProgress);
        onProgress(Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100));
      }
    }); // 전용 매팅 모델이 PNG(투명 배경) Blob을 바로 반환
    const feathered = await featherAlpha(raw);
    return await addStickerBorder(feathered);
  } catch (e) {
    console.error('배경 제거 실패:', e);
    return null;
  }
}

// 뿔·더듬이처럼 얇은 부위가 통째로 배경 판정되는 걸 막기 위해 알파를 살짝 번지듯 팽창시킨다
async function featherAlpha(blob, px = 4) {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;

  const sharp = document.createElement('canvas');
  sharp.width = w; sharp.height = h;
  const sctx = sharp.getContext('2d');
  sctx.drawImage(bmp, 0, 0);
  const sharpData = sctx.getImageData(0, 0, w, h);

  const blurred = document.createElement('canvas');
  blurred.width = w; blurred.height = h;
  const bctx = blurred.getContext('2d');
  bctx.filter = `blur(${px}px)`;
  bctx.drawImage(bmp, 0, 0);
  const blurredData = bctx.getImageData(0, 0, w, h);

  for (let i = 3; i < sharpData.data.length; i += 4) {
    sharpData.data[i] = Math.max(sharpData.data[i], blurredData.data[i]);
  }
  sctx.putImageData(sharpData, 0, 0);
  bmp.close();
  return new Promise(resolve => sharp.toBlob(resolve, 'image/png'));
}

// 실제 스티커처럼 실루엣을 따라 두꺼운 흰색 테두리를 두른다
async function addStickerBorder(blob, steps = 32) {
  const bmp = await createImageBitmap(blob);
  const { width: w, height: h } = bmp;
  const borderPx = Math.max(8, Math.round(Math.max(w, h) * 0.04));

  // 실루엣(불투명 흰색 도장) 만들기 - 알파를 이진화해서 흐릿한 그라데이션 없이 딱 떨어지게
  const sil = document.createElement('canvas');
  sil.width = w; sil.height = h;
  const silCtx = sil.getContext('2d');
  silCtx.drawImage(bmp, 0, 0);
  silCtx.globalCompositeOperation = 'source-in';
  silCtx.fillStyle = '#fff';
  silCtx.fillRect(0, 0, w, h);
  const silData = silCtx.getImageData(0, 0, w, h);
  for (let i = 3; i < silData.data.length; i += 4) {
    silData.data[i] = silData.data[i] > 40 ? 255 : 0;
  }
  silCtx.putImageData(silData, 0, 0);

  // 실루엣을 원 둘레 방향으로 여러 번 겹쳐 그려 테두리(팽창) 효과를 만든다
  const pad = borderPx + 2;
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad * 2;
  const outCtx = out.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    outCtx.drawImage(sil, pad + Math.cos(angle) * borderPx, pad + Math.sin(angle) * borderPx);
  }
  outCtx.drawImage(bmp, pad, pad); // 원본을 맨 위에 그대로 올린다
  bmp.close();

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
