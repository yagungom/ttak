// 3D 보기 — 아주 단순한 원근 카메라 + 야구장·선수 그리기 (그림 파일 없이 전부 코드로)
//  좌표(미터): x = 오른쪽(1루 쪽), y = 위, z = 앞(투수·외야 쪽). 홈플레이트가 (0, 0, 0)
import { FIELD } from './config.js';

const TAU = Math.PI * 2;
export const INK = '#2b2140';
export const FONT = 'system-ui, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const D2R = Math.PI / 180;

export function text(c, str, x, y, { size = 32, color = '#fff', stroke = INK, sw = null, align = 'center', base = 'middle', weight = 900 } = {}) {
  c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = base;
  if (stroke) { c.lineJoin = 'round'; c.lineWidth = sw ?? size * 0.2; c.strokeStyle = stroke; c.strokeText(str, x, y); }
  c.fillStyle = color; c.fillText(str, x, y);
}
export function rrect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// 담장까지 거리: 파울라인 쪽 짧고 가운데가 멂 (th = 가운데 기준 각도, 라디안)
export const fenceAt = (th) => FIELD.FENCE_LINE + (FIELD.FENCE_CENTER - FIELD.FENCE_LINE) * Math.cos(clamp(th, -Math.PI / 4, Math.PI / 4) * 2);
const dirPt = (th, r, y = 0) => [Math.sin(th) * r, y, Math.cos(th) * r];

// ── 원근 카메라 ──
export class Cam3 {
  constructor() {
    this.p = [0, 1.3, -3.6]; this.t = [0, 0.9, 12]; this.F = 1400; this.cx = 640; this.cy = 360;
    this.update();
  }
  set(p, t, F) { this.p = [...p]; this.t = [...t]; if (F) this.F = F; this.update(); }
  update() {
    let [fx, fy, fz] = [this.t[0] - this.p[0], this.t[1] - this.p[1], this.t[2] - this.p[2]];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, rz = -fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;  // 오른쪽 = 위 × 앞
    this.f = [fx, fy, fz]; this.r = [rx, 0, rz];
    this.u = [fy * rz, fz * rx - fx * rz, -fy * rx];                                  // 위 = 앞 × 오른쪽
  }
  toCam(x, y, z) {
    const dx = x - this.p[0], dy = y - this.p[1], dz = z - this.p[2], { r, u, f } = this;
    return [dx * r[0] + dz * r[2], dx * u[0] + dy * u[1] + dz * u[2], dx * f[0] + dy * f[1] + dz * f[2]];
  }
  // 화면 좌표 + 1미터가 몇 px 인지(k)
  proj(x, y, z) {
    const [a, b, d] = this.toCam(x, y, z);
    if (d < 0.08) return null;
    const k = this.F / d;
    return { x: this.cx + a * k, y: this.cy - b * k, k, d };
  }
  // 지평선 높이 (하늘을 그릴 때)
  horizonY() {
    const [fx, , fz] = this.f, l = Math.hypot(fx, fz) || 1;
    const q = this.proj(this.p[0] + fx / l * 5000, this.p[1], this.p[2] + fz / l * 5000);
    return q ? q.y : -1e4;
  }
  // 3D 다각형 → 화면 경로 (카메라 뒤로 넘어간 부분은 잘라냄)
  path(c, pts, near = 0.25) {
    const cam = pts.map((p) => this.toCam(p[0], p[1], p[2]));
    const out = [];
    for (let i = 0; i < cam.length; i++) {
      const A = cam[i], B = cam[(i + 1) % cam.length], ain = A[2] >= near, bin = B[2] >= near;
      if (ain) out.push(A);
      if (ain !== bin) { const t = (near - A[2]) / (B[2] - A[2]); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, near]); }
    }
    if (out.length < 3) return false;
    c.beginPath();
    out.forEach((p, i) => { const k = this.F / p[2], sx = this.cx + p[0] * k, sy = this.cy - p[1] * k; if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy); });
    c.closePath();
    return true;
  }
  fill(c, pts, style) { if (this.path(c, pts)) { c.fillStyle = style; c.fill(); return true; } return false; }
  // 땅 위의 선 (폭 w 미터)
  groundLine(c, a, b, w, style) {
    const dx = b[2] - a[2], dz = -(b[0] - a[0]), l = Math.hypot(dx, dz) || 1, nx = dx / l * w / 2, nz = dz / l * w / 2, y = 0.012;
    this.fill(c, [[a[0] + nx, y, a[2] + nz], [b[0] + nx, y, b[2] + nz], [b[0] - nx, y, b[2] - nz], [a[0] - nx, y, a[2] - nz]], style);
  }
  disc(cx, cz, r, y = 0.01, n = 28) { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } return pts; }
}

// ── 관중 무늬 (알록달록 점) ──
const crowdPats = new WeakMap();
let crowdCv = null;
function crowdPattern(c) {
  if (crowdPats.has(c)) return crowdPats.get(c);
  if (!crowdCv) crowdCv = makeCrowd();
  const pat = c.createPattern(crowdCv, 'repeat');
  crowdPats.set(c, pat);
  return pat;
}
function makeCrowd() {
  const cv = document.createElement('canvas'); cv.width = 84; cv.height = 42;
  const s = cv.getContext('2d');
  s.fillStyle = '#4a3f7d'; s.fillRect(0, 0, 84, 42);
  const cols = ['#ff6b6b', '#ffd93d', '#3ecfb2', '#4d96ff', '#9b5de5', '#ffffff', '#ff9f68', '#7bd389'];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
    s.fillStyle = cols[(i * 5 + row * 3) % cols.length];
    s.beginPath(); s.arc(7 + i * 14 + (row % 2) * 7, 7 + row * 14, 4.4, 0, TAU); s.fill();
  }
  return cv;
}

const CLOUDS = [[-260, 150, 700, 70], [-60, 210, 760, 90], [190, 170, 720, 80], [420, 230, 800, 100], [-480, 240, 820, 85]];

// ── 야구장 그리기 ──
export function drawField(c, cam, W, H, { night = false } = {}) {
  // 하늘
  const hy = cam.horizonY();
  const sky = c.createLinearGradient(0, Math.min(hy, H) - H * 1.2, 0, Math.max(hy, 0));
  sky.addColorStop(0, night ? '#14123a' : '#4fa3ff'); sky.addColorStop(1, night ? '#3b2f73' : '#cdeeff');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  // 구름 (아주 먼 곳)
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, z, r] of CLOUDS) {
    const q = cam.proj(x, y, z); if (!q) continue;
    const rr = r * q.k;
    if (rr < 4) continue;
    c.beginPath(); c.ellipse(q.x, q.y, rr, rr * 0.36, 0, 0, TAU); c.ellipse(q.x - rr * 0.45, q.y + rr * 0.06, rr * 0.5, rr * 0.28, 0, 0, TAU); c.ellipse(q.x + rr * 0.5, q.y + rr * 0.08, rr * 0.45, rr * 0.24, 0, 0, TAU); c.fill();
  }
  const N = 24, A = Math.PI / 4;
  const arc = (rOff, y, from = -A, to = A) => { const out = []; for (let i = 0; i <= N; i++) { const th = from + (to - from) * i / N; out.push(dirPt(th, fenceAt(th) + rOff, y)); } return out; };
  // 관중석 (담장 뒤로 높아짐)
  const back = arc(34, 10), front = arc(3, FIELD.FENCE_H + 0.6);
  cam.fill(c, [...front, ...back.reverse()], crowdPattern(c));
  cam.fill(c, arc(34, 10).concat(arc(39, 12).reverse()), '#3a3168');
  // 바깥 땅 (파울 지역 포함)
  cam.fill(c, [[-260, 0, -30], [260, 0, -30], [260, 0, 260], [-260, 0, 260]], '#2f8a52');
  // 외야 잔디 (부채꼴) + 줄무늬
  const fan = [[0, 0, 0], ...arc(0, 0.005)];
  if (cam.path(c, fan)) {
    c.fillStyle = '#45b36b'; c.fill();
    c.save(); c.clip();
    for (let z = 8; z < 130; z += 16) cam.fill(c, [[-140, 0.007, z], [140, 0.007, z], [140, 0.007, z + 8], [-140, 0.007, z + 8]], 'rgba(255,255,255,0.07)');
    // 거리 줄 (25m 마다) — 비거리 감 잡기
    c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = 2;
    for (const r of [25, 50, 75]) {
      c.beginPath(); let first = true;
      for (let i = 0; i <= N; i++) { const th = -A + 2 * A * i / N, q = cam.proj(Math.sin(th) * r, 0.01, Math.cos(th) * r); if (!q) { first = true; continue; } if (first) { c.moveTo(q.x, q.y); first = false; } else c.lineTo(q.x, q.y); }
      c.stroke();
    }
    c.restore();
  }
  for (const r of [25, 50, 75]) {
    const q = cam.proj(Math.sin(0.62) * r, 0.02, Math.cos(0.62) * r);
    if (q && q.k > 3) text(c, `${r}m`, q.x, q.y, { size: clamp(q.k * 2.4, 10, 26), color: 'rgba(255,255,255,0.75)', stroke: 'rgba(30,70,40,0.6)', sw: 3 });
  }
  // 내야 흙 + 내야 잔디
  const dirt = [[0, 0.01, 0]];
  for (let i = 0; i <= 20; i++) { const th = -A + 2 * A * i / 20, r = 29 + 4 * Math.cos(th * 2); dirt.push(dirPt(th, r, 0.01)); }
  cam.fill(c, dirt, '#d9a066');
  cam.fill(c, [[0, 0.012, 4.2], [15.6, 0.012, 19.4], [0, 0.012, 34.8], [-15.6, 0.012, 19.4]], '#45b36b');
  // 마운드·홈 주변 흙
  cam.fill(c, cam.disc(0, FIELD.MOUND_Z, 2.75, 0.014), '#d9a066');
  cam.fill(c, cam.disc(0, 0.2, 4.4, 0.014), '#d9a066');
  // 파울 라인
  for (const s of [-1, 1]) cam.groundLine(c, [0, 0, 0], dirPt(s * A, fenceAt(s * A)), 0.16, '#fff');
  // 타석 선
  for (const s of [-1, 1]) {
    const x0 = s * 0.42, x1 = s * 1.62;
    for (const [a, b] of [[[x0, 0, -0.9], [x1, 0, -0.9]], [[x1, 0, -0.9], [x1, 0, 0.95]], [[x1, 0, 0.95], [x0, 0, 0.95]], [[x0, 0, 0.95], [x0, 0, -0.9]]]) cam.groundLine(c, a, b, 0.07, 'rgba(255,255,255,0.85)');
  }
  // 베이스
  for (const [bx, bz] of [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]]) cam.fill(c, [[bx, 0.03, bz - 0.27], [bx + 0.27, 0.03, bz], [bx, 0.03, bz + 0.27], [bx - 0.27, 0.03, bz]], '#fff');
  // 홈플레이트
  cam.fill(c, [[-0.215, 0.02, 0.43], [0.215, 0.02, 0.43], [0.215, 0.02, 0.215], [0, 0.02, 0], [-0.215, 0.02, 0.215]], '#fff');
  // 투수판
  cam.fill(c, [[-0.3, 0.27, FIELD.MOUND_Z - 0.08], [0.3, 0.27, FIELD.MOUND_Z - 0.08], [0.3, 0.27, FIELD.MOUND_Z + 0.08], [-0.3, 0.27, FIELD.MOUND_Z + 0.08]], '#fff');
  // 담장 (안쪽 면) + 노란 윗줄 + 거리 숫자
  for (let i = 0; i < N; i++) {
    const t0 = -A + 2 * A * i / N, t1 = -A + 2 * A * (i + 1) / N;
    const a0 = dirPt(t0, fenceAt(t0)), a1 = dirPt(t1, fenceAt(t1));
    cam.fill(c, [[a0[0], 0, a0[2]], [a1[0], 0, a1[2]], [a1[0], FIELD.FENCE_H, a1[2]], [a0[0], FIELD.FENCE_H, a0[2]]], i % 2 ? '#1f5f8f' : '#22689c');
    cam.fill(c, [[a0[0], FIELD.FENCE_H - 0.25, a0[2]], [a1[0], FIELD.FENCE_H - 0.25, a1[2]], [a1[0], FIELD.FENCE_H, a1[2]], [a0[0], FIELD.FENCE_H, a0[2]]], '#ffd93d');
  }
  for (const th of [-A * 0.98, 0.2, A * 0.98]) {
    const r = fenceAt(th), q = cam.proj(Math.sin(th) * (r - 0.1), FIELD.FENCE_H * 0.5, Math.cos(th) * (r - 0.1));
    if (q && q.k > 2) text(c, String(Math.round(r)), q.x, q.y, { size: clamp(q.k * 1.7, 9, 60), color: '#fff', stroke: null, weight: 900 });
  }
  // 폴 (파울 기둥)
  for (const s of [-1, 1]) {
    const r = fenceAt(s * A), p0 = cam.proj(Math.sin(s * A) * r, 0, Math.cos(s * A) * r), p1 = cam.proj(Math.sin(s * A) * r, 16, Math.cos(s * A) * r);
    if (p0 && p1) { c.strokeStyle = '#ffd93d'; c.lineWidth = Math.max(2, p0.k * 0.35); c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke(); }
  }
}

// ── 공 ──
export function drawBall(c, x, y, r, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  const g = c.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.75, '#f1ece2'); g.addColorStop(1, '#cfc6b6');
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = g; c.fill();
  if (r > 6) {
    c.save(); c.clip();
    c.strokeStyle = '#e8414f'; c.lineWidth = Math.max(1, r * 0.11);
    c.beginPath(); c.arc(-r * 1.25, 0, r * 0.95, -0.75, 0.75); c.stroke();
    c.beginPath(); c.arc(r * 1.25, 0, r * 0.95, Math.PI - 0.75, Math.PI + 0.75); c.stroke();
    c.restore();
  }
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.lineWidth = Math.max(1, Math.min(3, r * 0.12)); c.strokeStyle = INK; c.stroke();
  c.restore();
}

export function drawBall3(c, cam, x, y, z, rot = 0, minR = 4) {
  // 그림자
  const g = cam.proj(x, 0.01, z);
  if (g && y > 0.02) {
    const k = clamp(1 - y / 30, 0.25, 1);
    c.fillStyle = `rgba(0,0,0,${0.3 * k})`;
    c.beginPath(); c.ellipse(g.x, g.y, Math.max(2, FIELD.BALL_R * 1.4 * g.k), Math.max(1, FIELD.BALL_R * 0.5 * g.k), 0, 0, TAU); c.fill();
  }
  const q = cam.proj(x, y, z);
  if (!q) return null;
  const r = Math.max(minR, FIELD.BALL_R * q.k);
  if (r < 6) { c.beginPath(); c.arc(q.x, q.y, r + 3, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill(); }
  drawBall(c, q.x, q.y, r, rot);
  return { x: q.x, y: q.y, r };
}

// ── 스트라이크존 (홈플레이트 위 네모) ──
export function zoneRect(cam) {
  const { halfW, bottom, top } = FIELD.ZONE;
  const a = cam.proj(-halfW, top, 0), b = cam.proj(halfW, bottom, 0);
  if (!a || !b) return null;
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
export function drawZone(c, cam, alpha = 0.6) {
  const z = zoneRect(cam); if (!z) return;
  c.save(); c.globalAlpha = alpha;
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.5; c.beginPath();
  for (let i = 1; i < 3; i++) { c.moveTo(z.x + z.w * i / 3, z.y); c.lineTo(z.x + z.w * i / 3, z.y + z.h); c.moveTo(z.x, z.y + z.h * i / 3); c.lineTo(z.x + z.w, z.y + z.h * i / 3); }
  c.stroke();
  c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeRect(z.x, z.y, z.w, z.h);
  c.restore();
}

// ── 투수 (앞모습). arm: 던지는 팔 각도(화면 기준, -π/2 = 위), side: 던지는 팔이 화면 어느 쪽(±1) ──
export function drawPitcher(c, cam, { color, arm = 0.9, side = 1, ball = true, lean = 0, t = 0 }) {
  const z = FIELD.MOUND_Z - 0.1, y0 = 0.27, bob = Math.sin(t * 3) * 0.01;
  const P = (x, y) => cam.proj(x + lean * (y - y0) * 0.12, y + y0 + bob, z);
  const feet = [P(-0.2, 0), P(0.2, 0)], hip = P(0, 0.95), sh = P(0, 1.42), head = P(0, 1.68);
  if (!hip || !sh || !head) return;
  const k = sh.k;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  // 다리
  c.strokeStyle = INK; c.lineWidth = Math.max(2, 0.14 * k);
  for (const f of feet) if (f) { c.beginPath(); c.moveTo(hip.x, hip.y); c.lineTo(f.x, f.y); c.stroke(); }
  c.strokeStyle = '#f4f1ea'; c.lineWidth = Math.max(1, 0.09 * k);
  for (const f of feet) if (f) { c.beginPath(); c.moveTo(hip.x, hip.y); c.lineTo(f.x, f.y); c.stroke(); }
  // 몸통 (유니폼)
  const bw = 0.42 * k;
  rrect(c, sh.x - bw / 2, sh.y - 0.04 * k, bw, hip.y - sh.y + 0.12 * k, 0.12 * k);
  c.fillStyle = color; c.fill(); c.lineWidth = Math.max(1.5, 0.035 * k); c.strokeStyle = INK; c.stroke();
  rrect(c, sh.x - bw * 0.18, sh.y + 0.1 * k, bw * 0.36, 0.14 * k, 0.04 * k); c.fillStyle = 'rgba(255,255,255,0.8)'; c.fill();
  // 글러브 팔 (반대쪽)
  const shG = P(-side * 0.2, 1.36), gl = P(-side * 0.12, 1.12);
  if (shG && gl) {
    c.strokeStyle = INK; c.lineWidth = Math.max(2, 0.1 * k); c.beginPath(); c.moveTo(shG.x, shG.y); c.lineTo(gl.x, gl.y); c.stroke();
    c.beginPath(); c.arc(gl.x, gl.y, 0.11 * k, 0, TAU); c.fillStyle = '#9a5b2e'; c.fill(); c.lineWidth = Math.max(1.5, 0.03 * k); c.stroke();
  }
  // 던지는 팔
  const shT = P(side * 0.2, 1.38);
  const L = 0.62, hx = side * 0.2 + Math.cos(arm) * L, hy = 1.38 - Math.sin(arm) * L;
  const hand = P(hx, hy);
  if (shT && hand) {
    c.strokeStyle = INK; c.lineWidth = Math.max(2.5, 0.12 * k); c.beginPath(); c.moveTo(shT.x, shT.y); c.lineTo(hand.x, hand.y); c.stroke();
    c.strokeStyle = color; c.lineWidth = Math.max(1.5, 0.07 * k); c.stroke();
    c.beginPath(); c.arc(hand.x, hand.y, 0.055 * k, 0, TAU); c.fillStyle = '#ffcf9e'; c.fill(); c.lineWidth = Math.max(1, 0.025 * k); c.strokeStyle = INK; c.stroke();
    if (ball) drawBall(c, hand.x + side * 0.04 * k, hand.y - 0.04 * k, Math.max(2.5, 0.05 * k));
  }
  // 머리 + 모자
  const hr = 0.15 * k;
  c.beginPath(); c.arc(head.x, head.y, hr, 0, TAU); c.fillStyle = '#ffcf9e'; c.fill(); c.lineWidth = Math.max(1.5, 0.03 * k); c.strokeStyle = INK; c.stroke();
  c.beginPath(); c.arc(head.x, head.y - hr * 0.15, hr * 1.02, Math.PI, 0); c.closePath(); c.fillStyle = color; c.fill(); c.stroke();
  c.beginPath(); c.ellipse(head.x, head.y - hr * 0.12, hr * 1.25, hr * 0.28, 0, 0, Math.PI); c.fillStyle = color; c.fill(); c.stroke();
  c.fillStyle = INK;
  c.beginPath(); c.arc(head.x - hr * 0.38, head.y + hr * 0.3, hr * 0.12, 0, TAU); c.arc(head.x + hr * 0.38, head.y + hr * 0.3, hr * 0.12, 0, TAU); c.fill();
  c.restore();
}

// ── 타자 (뒷모습, 홈플레이트 왼쪽 = 오른손 타자). batH: 배트 높이(m), swing: 0~1 (-1 = 준비 자세) ──
export function batterPose(batH, swing) {
  const X0 = -0.98, z = 0.12;
  const ready = [X0 + 0.3, clamp(batH + 0.28, 0.75, 1.62), z - 0.06];
  if (swing < 0) {
    const d = [-0.32, 0.82, -0.36], l = Math.hypot(...d);
    return { X0, z, hands: ready, tip: ready.map((v, i) => v + d[i] / l * 0.86) };
  }
  // 손 위치: 준비 → 맞는 곳(공 앞) → 끝까지 돌림
  const s = clamp(swing, 0, 1);
  const contact = [X0 + 0.62, batH, z + 0.32], finish = [X0 + 0.28, batH + 0.42, z + 0.38];
  const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const hands = s < 0.45 ? lerp3(ready, contact, s / 0.45) : lerp3(contact, finish, (s - 0.45) / 0.55);
  const phi = s < 0.45 ? (-110 + 110 * (s / 0.45)) * D2R : (130 * (s - 0.45) / 0.55) * D2R;
  const up = s < 0.45 ? 0.95 * (1 - s / 0.45) : 0.55 * (s - 0.45) / 0.55;
  const d = [Math.cos(phi), up, Math.sin(phi)], l = Math.hypot(...d);
  return { X0, z, hands, tip: hands.map((v, i) => v + d[i] / l * 0.86) };
}

export function drawBatter(c, cam, { color, batH = 0.8, swing = -1, num = '1' }) {
  const { X0, z, hands, tip } = batterPose(batH, swing);
  const P = (x, y, zz = z) => cam.proj(x, y, zz);
  const hipL = P(X0 - 0.17, 0.9), hipR = P(X0 + 0.17, 0.9), shL = P(X0 - 0.24, 1.4), shR = P(X0 + 0.24, 1.4), head = P(X0 + 0.02, 1.64);
  const footL = P(X0 - 0.26, 0.02), footR = P(X0 + 0.26, 0.02);
  if (!hipL || !hipR || !shL || !shR || !head) return;
  const k = head.k;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  // 다리
  c.strokeStyle = INK; c.lineWidth = 0.17 * k;
  for (const [h, f] of [[hipL, footL], [hipR, footR]]) if (f) { c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(f.x, f.y); c.stroke(); }
  c.strokeStyle = '#f4f1ea'; c.lineWidth = 0.12 * k;
  for (const [h, f] of [[hipL, footL], [hipR, footR]]) if (f) { c.beginPath(); c.moveTo(h.x, h.y); c.lineTo(f.x, f.y); c.stroke(); }
  // 몸통 (등)
  c.beginPath(); c.moveTo(shL.x, shL.y); c.lineTo(shR.x, shR.y); c.lineTo(hipR.x, hipR.y); c.lineTo(hipL.x, hipL.y); c.closePath();
  c.fillStyle = color; c.fill(); c.lineWidth = 0.035 * k; c.strokeStyle = INK; c.stroke();
  const mid = P(X0, 1.16);
  if (mid) text(c, num, mid.x, mid.y, { size: Math.round(0.2 * k), color: '#fff', stroke: INK, sw: 0.03 * k });
  // 팔 (양 어깨 → 손)
  const hq = P(...hands);
  if (hq) {
    c.strokeStyle = INK; c.lineWidth = 0.11 * k;
    for (const s of [shL, shR]) { c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(hq.x, hq.y); c.stroke(); }
    c.strokeStyle = color; c.lineWidth = 0.065 * k;
    for (const s of [shL, shR]) { c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(hq.x, hq.y); c.stroke(); }
  }
  // 배트
  drawBat(c, cam, hands, tip);
  if (hq) { c.beginPath(); c.arc(hq.x, hq.y, 0.06 * hq.k, 0, TAU); c.fillStyle = '#f2f2f2'; c.fill(); c.lineWidth = 0.02 * hq.k; c.strokeStyle = INK; c.stroke(); }
  // 헬멧
  const hr = 0.16 * k;
  c.beginPath(); c.arc(head.x, head.y, hr, 0, TAU); c.fillStyle = color; c.fill(); c.lineWidth = 0.035 * k; c.strokeStyle = INK; c.stroke();
  c.beginPath(); c.arc(head.x - hr * 0.35, head.y - hr * 0.35, hr * 0.28, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();
  c.restore();
}

function drawBat(c, cam, a, b) {
  const p = cam.proj(...a), q = cam.proj(...b);
  if (!p || !q) return;
  const w0 = 0.03 * p.k, w1 = 0.065 * q.k;
  const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  c.beginPath();
  c.moveTo(p.x + nx * w0, p.y + ny * w0); c.lineTo(q.x + nx * w1, q.y + ny * w1);
  c.arc(q.x, q.y, w1, Math.atan2(ny, nx), Math.atan2(-ny, -nx));
  c.lineTo(p.x - nx * w0, p.y - ny * w0); c.closePath();
  const g = c.createLinearGradient(p.x, p.y, q.x, q.y); g.addColorStop(0, '#b77b45'); g.addColorStop(1, '#e8b779');
  c.fillStyle = g; c.fill(); c.lineWidth = Math.max(1.5, 0.018 * q.k); c.strokeStyle = INK; c.stroke();
}

// ── 포수 미트 (우리 눈앞) ──
export function drawMitt(c, cam, x, y, z, pop = 0) {
  const q = cam.proj(x, y, z); if (!q) return;
  const r = 0.19 * q.k * (1 + pop * 0.12);
  c.save(); c.translate(q.x, q.y);
  c.beginPath(); c.ellipse(0, r * 0.1, r * 1.05, r, 0, 0, TAU); c.fillStyle = '#8a4b22'; c.fill(); c.lineWidth = Math.max(2, r * 0.07); c.strokeStyle = INK; c.stroke();
  c.beginPath(); c.ellipse(0, r * 0.05, r * 0.62, r * 0.58, 0, 0, TAU); c.fillStyle = '#5e3016'; c.fill();
  c.strokeStyle = '#c98a4f'; c.lineWidth = Math.max(1.5, r * 0.05);
  for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * r * 0.32, -r * 0.92); c.lineTo(i * r * 0.26, -r * 0.55); c.stroke(); }
  c.restore();
}

// 땅 위 동그라미 (떨어진 곳 표시)
export function groundRing(c, cam, x, z, r, style, lw = 3) {
  if (cam.path(c, cam.disc(x, z, r, 0.03, 32))) { c.lineWidth = lw; c.strokeStyle = style; c.stroke(); }
}
