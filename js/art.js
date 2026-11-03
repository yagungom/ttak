// 그림 파일 불러오기 — Codex(GPT)가 그려 넣은 그림이 있으면 쓰고, 없으면 코드로 그린 그림을 그대로 씀
//  · 선수 시트(3칸 × 2줄, 6동작): 칸마다 잘라서 발 위치를 찾아 둠. 흰 배경이면 자동으로 지움
//  · 그림은 파란 팀 하나만 그리고, 빨간 팀은 파란색을 빨간색으로 바꿔 자동으로 만듦 (자세가 똑같이 맞음)
//  · 파일은 .webp 를 먼저 찾고 없으면 .png
export const ART = { sheets: {}, crowd: null, mitt: null, version: 0 };

const SHEETS = {
  pitcher: 'assets/players/pitcher', pitcherKid: 'assets/players/pitcher-kid',
  batter: 'assets/players/batter', batterKid: 'assets/players/batter-kid',
};
const SINGLES = { crowd: 'assets/stadium/crowd', mitt: 'assets/props/mitt' };
// 시트 칸 순서 (윗줄 왼쪽부터)
export const POSE = Object.freeze({ READY: 0, UP: 1, THROW: 2, FOLLOW: 3, HAPPY: 4, SAD: 5 }); // 투수
export const BPOSE = Object.freeze({ READY: 0, START: 1, HIT: 2, FOLLOW: 3, HAPPY: 4, SAD: 5 }); // 타자

function loadImg(base) {
  return new Promise((resolve) => {
    const exts = ['webp', 'png'];
    const next = () => {
      const ext = exts.shift();
      if (!ext) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = next;
      img.src = `${base}.${ext}`;
    };
    next();
  });
}

function toCanvas(img) {
  const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0);
  return cv;
}

// 흰 배경(투명이 아닌 그림) → 가장자리에서 이어진 흰색만 투명하게 (캐릭터 안의 흰 바지·공은 그대로)
function clearWhiteBg(cv) {
  const { width: w, height: h } = cv, c = cv.getContext('2d', { willReadFrequently: true });
  const im = c.getImageData(0, 0, w, h), d = im.data;
  let clear = 0, n = 0;
  for (let x = 0; x < w; x += 7) for (const y of [0, h - 1]) { n++; if (d[(y * w + x) * 4 + 3] < 20) clear++; }
  if (clear / n > 0.5) return;                        // 이미 투명 배경
  const white = (i) => d[i + 3] > 0 && d[i] > 222 && d[i + 1] > 222 && d[i + 2] > 222 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 26;
  const seen = new Uint8Array(w * h), stack = [];
  const push = (x, y) => { const p = y * w + x; if (!seen[p] && white(p * 4)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % w, y = (p / w) | 0;
    d[p * 4 + 3] = 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  c.putImageData(im, 0, 0);
}

// 3칸 × 2줄 → 동작 6개. 칸마다 그림이 있는 곳만 잘라내고, 맨 아래(발)의 가운데를 기준점으로
function slice(cv) {
  const W = cv.width, H = cv.height, cw = Math.floor(W / 3), ch = Math.floor(H / 2);
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const frames = [];
  for (let r = 0; r < 2; r++) for (let col = 0; col < 3; col++) {
    const x0 = col * cw, y0 = r * ch;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) {
      if (d[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) { frames.push(null); continue; }
    const fw = maxX - minX + 1, fh = maxY - minY + 1;
    // 발 가운데: 아래쪽 7% 줄의 그림 가운데
    let sx = 0, sn = 0;
    for (let y = Math.max(minY, maxY - Math.round(fh * 0.07)); y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (d[(y * W + x) * 4 + 3] > 60) { sx += x; sn++; }
    const out = document.createElement('canvas'); out.width = fw; out.height = fh;
    out.getContext('2d').drawImage(cv, minX, minY, fw, fh, 0, 0, fw, fh);
    frames.push({ cv: out, w: fw, h: fh, fx: sn ? sx / sn - minX : fw / 2 });
  }
  return frames;
}

// 파란 유니폼 → 빨간 유니폼 (파란색 계열만 색을 돌림)
function recolor(frame, hueShift = 147) {
  if (!frame) return null;
  const cv = document.createElement('canvas'); cv.width = frame.w; cv.height = frame.h;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(frame.cv, 0, 0);
  const im = c.getImageData(0, 0, frame.w, frame.h), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
    if (dl < 0.12 || mx < 0.18) continue;
    let h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4; h *= 60; if (h < 0) h += 360;
    if (h < 185 || h > 255) continue;                  // 파란색만
    const s = dl / mx, v = mx, nh = (h + hueShift) % 360;
    const k = (n) => { const kk = (n + nh / 60) % 6; return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)); };
    d[i] = k(5) * 255; d[i + 1] = k(3) * 255; d[i + 2] = k(1) * 255;
  }
  c.putImageData(im, 0, 0);
  return { ...frame, cv };
}

export async function loadArt(onChange) {
  const jobs = Object.entries(SHEETS).map(async ([key, base]) => {
    const img = await loadImg(base);
    if (!img) return;
    try {
      const cv = toCanvas(img); clearWhiteBg(cv);
      const blue = slice(cv);
      if (!blue[0]) return;
      // 크기 기준 = 1번(준비 자세) 높이 → 팔을 들어도 캐릭터 크기는 그대로
      ART.sheets[key] = { stand: blue[0].h, teams: [blue, blue.map((f) => recolor(f))] };
      ART.version++; onChange?.();
    } catch (e) { console.warn('그림 시트 처리 실패', base, e); }
  });
  const singles = Object.entries(SINGLES).map(async ([key, base]) => {
    const img = await loadImg(base);
    if (!img) return;
    try {
      const cv = toCanvas(img);
      if (key === 'mitt') { clearWhiteBg(cv); const f = slice1(cv); if (f) ART.mitt = f; }
      else ART.crowd = cv;
      ART.version++; onChange?.();
    } catch (e) { console.warn('그림 처리 실패', base, e); }
  });
  await Promise.all([...jobs, ...singles]);
}

// 한 장짜리 그림: 그림이 있는 곳만 잘라냄
function slice1(cv) {
  const W = cv.width, H = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (d[(y * W + x) * 4 + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) return null;
  const out = document.createElement('canvas'); out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return { cv: out, w: out.width, h: out.height };
}

// 선수 그림 고르기: 어린이면 어린이 시트(없으면 어른 시트), 팀 0 = 파랑, 1 = 빨강
export function sheetFor(kind, kid) {
  return (kid && ART.sheets[`${kind}Kid`]) || ART.sheets[kind] || null;
}
