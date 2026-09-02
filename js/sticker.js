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

    let mask = await cleanMask(await matte(remove, file, options));
    if (!mask) return null;

    // 피사체가 작게 찍히면 뿔·다리 같은 얇은 부위가 통째로 배경 판정된다.
    // 그 부분만 잘라 크게 만든 뒤 다시 돌리면 훨씬 잘 살아남는다.
    const refined = await refineByCrop(remove, file, mask, options);
    if (refined) mask = refined;

    return await makeSticker(mask);
  } catch (e) {
    console.error('배경 제거 실패:', e);
    return null;
  }
}

// WASM(CPU) 단일 스레드로 돌리면 같은 사진이 12초 넘게 걸린다.
// GitHub Pages 에서는 헤더를 못 넣어 멀티스레드도 못 켜므로 WebGPU 를 먼저 시도한다.
async function matte(remove, file, options) {
  if (navigator.gpu && !gpuBroken) {
    try {
      return await remove(file, { ...options, device: 'gpu' });
    } catch (e) {
      console.warn('WebGPU 배경 제거 실패, CPU 로 전환합니다.', e);
      gpuBroken = true;
    }
  }
  return await remove(file, options); // 전용 매팅 모델이 PNG(투명 배경) Blob 을 바로 반환
}

// 체임퍼 거리 변환: seed 가 1 인 픽셀에서 각 픽셀까지의 거리. 두 번만 훑으면 된다.
function chamfer(seed, w, h) {
  const INF = 1e9, D1 = 1, D2 = Math.SQRT2;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = seed[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + D1);
      if (y > 0) v = Math.min(v, dist[i - w] + D1);
      if (x > 0 && y > 0) v = Math.min(v, dist[i - w - 1] + D2);
      if (x < w - 1 && y > 0) v = Math.min(v, dist[i - w + 1] + D2);
      dist[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = dist[i];
      if (x < w - 1) v = Math.min(v, dist[i + 1] + D1);
      if (y < h - 1) v = Math.min(v, dist[i + w] + D1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, dist[i + w + 1] + D2);
      if (x > 0 && y < h - 1) v = Math.min(v, dist[i + w - 1] + D2);
      dist[i] = v;
    }
  }
  return dist;
}

// 매팅 결과를 정리한다.
// 방충망·풀숲 같은 배경은 흐릿한 덩어리로 남아 스티커를 망치므로,
// 진하게 남은 덩어리(피사체)만 남기고 나머지는 지운 뒤 경계 상자를 돌려준다.
async function cleanMask(blob) {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const n = w * h;

  // 진하게 남은 픽셀만 덩어리로 묶는다. 배경 찌꺼기는 대개 흐릿해서 여기 안 걸린다.
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const size = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] <= 128) continue;
    const id = size.length;
    size.push(0);
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const p = stack[--top];
      size[id]++;
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (label[q] !== -1 || data[q * 4 + 3] <= 128) continue;
          label[q] = id;
          stack[top++] = q;
        }
      }
    }
  }
  if (!size.length) return null;

  // 가장 큰 덩어리의 25% 이상만 남긴다 (동물이 둘 이상 찍힌 사진도 살린다)
  const biggest = Math.max(...size);
  if (biggest < 64) return null;
  const seed = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const id = label[p];
    if (id !== -1 && size[id] >= Math.max(64, biggest * 0.25)) seed[p] = 1;
  }

  // 남긴 덩어리에서 몇 픽셀 안쪽만 살린다.
  // 경계의 반투명한 테두리는 지키면서, 멀리 퍼진 흐릿한 배경은 잘라낸다.
  const near = chamfer(seed, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < n; p++) {
    if (near[p] > 3) { data[p * 4 + 3] = 0; continue; }
    if (data[p * 4 + 3] <= 24) continue;
    const x = p % w, y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;

  ctx.putImageData(image, 0, 0);
  const cleaned = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return { blob: cleaned, x0, y0, x1, y1, width: w, height: h };
}

// 1차 결과에서 피사체 위치를 찾아 그 부분만 크게 다시 매팅한다.
// 모델 입력이 1024x1024 로 고정이라, 피사체가 화면을 채울수록 얇은 부위가 살아난다.
async function refineByCrop(remove, file, box, options) {
  const sw = box.x1 - box.x0 + 1, sh = box.y1 - box.y0 + 1;
  const fill = (sw * sh) / (box.width * box.height);
  if (fill > 0.55) return null; // 이미 충분히 크게 찍혔으면 한 번으로 끝낸다

  const margin = Math.round(Math.max(sw, sh) * 0.12);
  const cx = Math.max(0, box.x0 - margin);
  const cy = Math.max(0, box.y0 - margin);
  const cw = Math.min(box.width - cx, sw + margin * 2);
  const ch = Math.min(box.height - cy, sh + margin * 2);

  const scale = Math.min(2.5, 1100 / Math.max(cw, ch)); // 너무 키우면 흐려지기만 한다
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const bmp = await createImageBitmap(file);
  canvas.getContext('2d').drawImage(bmp, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  bmp.close();

  const crop = await new Promise(r => canvas.toBlob(r, 'image/png'));
  try {
    return await cleanMask(await matte(remove, crop, options));
  } catch (e) {
    console.warn('크롭 재매팅 실패, 1차 결과를 씁니다.', e);
    return null;
  }
}

// 투명 여백을 잘라내고 실루엣을 따라 균일한 흰 테두리를 두른다.
// 예전처럼 실루엣을 여러 각도로 겹쳐 그리면 다리·더듬이 둘레가 울퉁불퉁해져서,
// 거리 변환(가장 가까운 피사체까지의 거리)으로 테두리를 그린다.
async function makeSticker(mask, borderRatio = 0.03) {
  const bmp = await createImageBitmap(mask.blob);
  const { x0, y0, x1, y1 } = mask;
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  const border = Math.max(6, Math.round(Math.max(sw, sh) * borderRatio));
  const pad = border + 2;
  const W = sw + pad * 2, H = sh + pad * 2;

  const cropped = document.createElement('canvas');
  cropped.width = W; cropped.height = H;
  const cctx = cropped.getContext('2d');
  cctx.drawImage(bmp, x0, y0, sw, sh, pad, pad, sw, sh);
  bmp.close();

  // 흐릿하게 남은 배경 찌꺼기는 지우고, 반투명하게 살아남은 다리·더듬이는 실루엣에 포함시킨다
  const cropImage = cctx.getImageData(0, 0, W, H);
  const cropAlpha = cropImage.data;
  for (let i = 3; i < cropAlpha.length; i += 4) {
    if (cropAlpha[i] < 24) cropAlpha[i] = 0;
  }
  cctx.putImageData(cropImage, 0, 0);

  // 2) 각 픽셀이 실루엣에서 얼마나 떨어졌는지 구한다
  const silhouette = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) silhouette[i] = cropAlpha[i * 4 + 3] > 48 ? 1 : 0;
  const dist = chamfer(silhouette, W, H);

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
