// 딱! 홈런 — 게임 엔진 (규칙·던지기·치기·비거리·컴퓨터 선수·화면 그리기)
//
//  화면 = 포수 자리에서 본 야구장. 투수는 화면 안쪽 마운드, 타자는 홈플레이트 왼쪽
//  · 📺 카메라 모드: 화면 왼쪽 반에 한 명, 오른쪽 반에 한 명. 사람마다 '한 손'만 봄 (대기실에서 공을 톡 친 손)
//      던질 때: 팔 휘두르는 속도 = 구속, 휘두르는 방향·손 높이 = 공이 들어오는 곳 (무조건 스트라이크존 안)
//      칠 때:   휘두르는 속도 = 힘, 공이 올 때 맞춘 타이밍 = 방향(빠르면 당겨치기), 손 높이 = 뜬공/땅볼
//  · 📱 폰 모드: 던질 곳을 누르고 아래로 휙 → 던지기, 공이 오면 톡(옆으로 휙 = 세게) → 치기. 혼자면 상대는 컴퓨터
//  · 규칙: 수비 없음, 친 공은 무조건 페어 지역 안, 날아간 거리(m)가 그대로 점수
//          헛스윙 + 포수가 받은 공 합쳐 3개 = 아웃 (안타를 쳐도 스트라이크는 그대로), 3아웃 = 공수교대,
//          정한 회까지 하고 거리 합계로 승부
import { SCREEN, FIELD, LEVELS, RULES, SIDE_COLORS, SIDE_LABELS, DISPLAY_LAG } from './config.js';
import { Cam3, drawField, drawBall, drawBall3, drawZone, zoneRect, drawPitcher, drawBatter, drawMitt, drawSprite, drawMittArt, groundRing, fenceAt, text, rrect, INK, FONT } from './view3d.js';
import { ART, POSE, BPOSE, sheetFor, loadArt } from './art.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v), -2.5, 2.5); };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const angLerp = (a, b, t) => a + wrapA(b - a) * t;
const HANDS = [[15, 17, 19, 21], [16, 18, 20, 22]]; // 손목, 새끼, 검지, 엄지 (왼손, 오른손)
const SHOULDERS = [11, 12];
const { ZONE } = FIELD;
const ZONE_MID = (ZONE.top + ZONE.bottom) / 2, ZONE_HH = (ZONE.top - ZONE.bottom) / 2;
const PITCH_CAM = { p: [0.2, 1.8, -4.4], t: [0.05, 0.2, 14] };
const SWING_ANIM = 0.26; // 배트 한 바퀴 도는 시간(초)

// 손 떨림은 줄이고, 빠른 스윙은 안 늦게 (One Euro 필터)
class OneEuro {
  constructor(minCutoff = 1.7, beta = 0.008, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.reset(); }
  reset() { this.x = null; this.dx = 0; this.t = 0; }
  static a(cutoff, dt) { const tau = 1 / (TAU * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x == null || t <= this.t) { this.x = x; this.t = t; this.dx = 0; return x; }
    const dt = t - this.t; this.t = t;
    this.dx += OneEuro.a(this.dCutoff, dt) * ((x - this.x) / dt - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

function mkHand() { return { on: false, x: 0, y: 0, rx: 0, ry: 0, t: 0, vx: 0, vy: 0, sp: 0, act: 0, hist: [], fx: new OneEuro(), fy: new OneEuro() }; }
function mkPlayer(side) {
  return {
    side, name: side ? '2P' : '1P', type: 'adult', color: SIDE_COLORS[side], cpu: false,
    score: 0, hits: 0, hrs: 0, longest: 0, ks: 0,
    seenAt: -1e9, present: false,
    body: { ok: false, x: side ? 960 : 320, shY: 300, hipY: 470, headY: 220, scale: 120 },
    hands: [mkHand(), mkHand()], hand: null, armSide: 1, cap: null,
    ready: false, readyHitT: -9, readyPos: null,
  };
}

export class BaseballEngine {
  constructor(canvas, sound) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.sound = sound; this.handlers = {};
    this.W = SCREEN.W; this.H = SCREEN.H;
    this.cam = new Cam3(); this._fieldCache = null; this._fieldKey = '';
    this.camMode = 'pitch'; this.camF = 1400;
    this.input = null; this._unsub = null; this.touchMode = false;
    this.players = [mkPlayer(0), mkPlayer(1)];
    this.innings = RULES.DEFAULT_INNINGS;
    this.game = { inning: 1, half: 0, outs: 0, strikes: 0, atBat: 1 };
    this.state = 'idle'; this.stateT = 0; this.time = 0;
    this.frozen = null; this.freezeT = 0; this.backAt = 0; this.missing = [];
    this.pitch = null; this.hit = null; this.ball = { mode: 'none', x: 0, y: 0, z: 0, rot: 0, vx: 0, vy: 0, vz: 0 };
    this.batH = [ZONE_MID + 0.05, ZONE_MID + 0.05];
    this.swingT = -1; this.mittPop = 0;
    this.pAnim = { arm: 0.9, ball: true, throwT: -1, lean: 0 };
    this.aim = null; this.tSwing = null; this.cpuWind = 1.5;
    this.fx = []; this.pops = []; this.banner = null; this.hint = null;
    this.hitStop = 0; this.shake = 0; this.flash = 0;
    this.demo = false; this.debug = false; this.lagDisplay = DISPLAY_LAG.normal.sec;
    this.lastSwing = null;
    this.fps = 60; this._fpsN = 0; this._fpsT = performance.now();
    this._last = performance.now(); this._acc = 0;
    this.resize(SCREEN.W, SCREEN.H, true);
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
    loadArt(() => { this._fieldCache = null; });   // 그림 파일이 있으면 바꿔 끼움 (없으면 코드 그림 그대로)
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) { try { fn(...a); } catch (e) { console.warn(e); } } }
  snd(name, ...a) { if (!this.demo) this.sound?.[name]?.(...a); }

  // ── 화면 크기 (카메라 모드 16:9 고정, 폰 모드는 폰 화면에 맞춤) ──
  resize(W, H, force = false) {
    W = Math.round(W); H = Math.round(H);
    if (!force && W === this.W && H === this.H) return;
    this.W = W; this.H = H; this.cv.width = W; this.cv.height = H;
    const portrait = H > W;
    this.camF = portrait ? W * 1.7 : Math.min(W * 1.09, H * 1.94);
    this.cam.cx = W / 2; this.cam.cy = H * (portrait ? 0.44 : 0.5);
    this._fieldCache = null;
    if (this.camMode === 'pitch') this._pitchCam();
  }
  // 글씨·점수판 크기 배율 (세로 폰·폴드에서도 읽기 좋게)
  get ui() { return this.H > this.W ? clamp(this.W / 760, 0.6, 1.2) : clamp(Math.min(this.W / 1100, this.H / 720), 0.6, 1.3); }
  _pitchCam() { this.cam.set(PITCH_CAM.p, PITCH_CAM.t, this.camF); }

  // ── 설정 ──
  setPlayers(list) {
    list.forEach((cfg, s) => {
      const p = this.players[s];
      p.name = cfg.name || (s ? '2P' : '1P');
      p.type = LEVELS[cfg.type] ? cfg.type : 'adult';
      p.cpu = p.type === 'cpu';
      p.body.ok = false; p.seenAt = -1e9; p.hand = p.cpu ? 1 : null; p.cap = null;
      for (const h of p.hands) { h.on = false; h.hist = []; h.fx.reset(); h.fy.reset(); h.act = 0; }
    });
  }
  setInnings(n) { this.innings = RULES.INNINGS.includes(n) ? n : RULES.DEFAULT_INNINGS; }
  setDisplayLag(sec) { this.lagDisplay = clamp(Number(sec) || 0, 0, 0.4); }
  setInput(vision) {
    this._unsub?.(); this._unsub = null;
    this.input = vision || null;
    if (vision) this._unsub = vision.onUpdate((now) => this._onPose(now));
  }
  get batSide() { return this.game.half; }       // 초 = 왼쪽(1P) 공격, 말 = 오른쪽(2P) 공격
  get pitSide() { return 1 - this.game.half; }
  _isTouch(p) { return this.touchMode && !p.cpu; }
  _humans() { return this.players.filter((p) => !p.cpu); }

  // 판정 지연: 사람 입력이 게임에 닿기까지(카메라·인식 또는 터치) + 화면이 늦게 보이는 만큼
  _lagIn(p) { return p.cpu ? 0 : this.touchMode ? RULES.TOUCH_LAG : RULES.CAMERA_LAG + (this.input?.ms || 30) / 1000; }
  _lagDisp(p) { return p.cpu ? 0 : this.touchMode ? 0.015 : this.lagDisplay; }

  // ── 📱 폰 모드: 손가락(PC는 마우스) ──
  //  두 사람 → 화면 왼쪽 반 = 왼쪽 선수, 오른쪽 반 = 오른쪽 선수 / 한 사람 + 컴퓨터 → 화면 어디든
  enableTouch() {
    if (this.touchMode) return;
    this.touchMode = true;
    this._ptr = new Map();
    const toLocal = (e) => { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * this.W, y: (e.clientY - r.top) / r.height * this.H }; };
    const stamp = (e) => { const n = performance.now(), t = e.timeStamp; return t > 0 && Math.abs(n - t) < 500 ? t : n; };
    this._tDown = (e) => {
      const q = toLocal(e), s = this._touchSide(q);
      this.sound?.unlock?.();
      if (s < 0) return;
      const t = stamp(e);
      const st = { s, x: q.x, y: q.y, t, vx: 0, vy: 0, role: null };
      this._ptr.set(e.pointerId, st);
      this._touchDown(st, t);
    };
    this._tMove = (e) => {
      const st = this._ptr.get(e.pointerId);
      if (!st) return;
      for (const ce of e.getCoalescedEvents?.() || [e]) {
        const q = toLocal(ce), t = stamp(ce), dt = (t - st.t) / 1000;
        if (dt < 0.004) { st.x = q.x; st.y = q.y; continue; }
        const vx = (q.x - st.x) / dt, vy = (q.y - st.y) / dt;
        const stale = dt > 0.06;                    // 오래 멈췄다가 움직이기 시작한 첫 순간
        st.vx = stale ? vx : st.vx * 0.3 + vx * 0.7; st.vy = stale ? vy : st.vy * 0.3 + vy * 0.7;
        st.x = q.x; st.y = q.y; st.t = t;
        this._touchMove(st, t, stale);
      }
    };
    this._tUp = (e) => { this._ptr.delete(e.pointerId); if (this.aim && this.aim.id === e.pointerId) this.aim.down = false; };
    this.cv.addEventListener('pointerdown', this._tDown);
    this.cv.addEventListener('pointermove', this._tMove);
    window.addEventListener('pointerup', this._tUp);
    window.addEventListener('pointercancel', this._tUp);
  }
  disableTouch() {
    if (!this.touchMode) return;
    this.touchMode = false;
    this.cv.removeEventListener('pointerdown', this._tDown);
    this.cv.removeEventListener('pointermove', this._tMove);
    window.removeEventListener('pointerup', this._tUp);
    window.removeEventListener('pointercancel', this._tUp);
  }
  _touchSide(q) {
    const hs = this._humans();
    if (!hs.length) return -1;
    return hs.length === 1 ? hs[0].side : (q.x < this.W / 2 ? 0 : 1);
  }
  _touchDown(st, t) {
    const p = this.players[st.s];
    if (this.state === 'lobby' || this.state === 'over') {
      if (p.ready || (this.state === 'over' && this.stateT < 2.6)) return;
      const q = this._readyBallAt(st.s);
      if (Math.hypot(st.x - q.x, st.y - q.y) < 95 * this.ui) this._setReady(p, 1, q);
      return;
    }
    if (this.frozen) return;
    if (this.state === 'windup' && st.s === this.pitSide && this.stateT > 0.35) {
      st.role = 'pitch';
      this.aim = { id: [...this._ptr.entries()].find(([, v]) => v === st)?.[0], s: st.s, x: st.x, y: st.y, down: true };
    } else if (this.state === 'pitch' && st.s === this.batSide && this.pitch && !this.pitch.swung && !this.tSwing) {
      st.role = 'bat';
      this.tSwing = { s: st.s, t, y: st.y, maxSp: 0, st };
      this.swingT = SWING_ANIM * 0.18; this.batH[st.s] = this._touchBatH(st.y);
    }
  }
  _touchMove(st, t, stale = false) {
    if (st.role === 'pitch' && this.state === 'windup' && this.aim) {
      const sp = Math.hypot(st.vx, st.vy), [a, b] = RULES.TOUCH_THROW;
      if (stale) return;
      if (sp > a) {                                // 아래로든 위로든 빠르게 쓸면 던짐 (아이도 쉽게)
        st.role = 'thrown';
        const { lx, ly } = this._aimToZone(this.aim);
        this._throw(st.s, { power: clamp((sp - a) / (b - a), 0, 1), lx, ly });
        this.aim = null;
      } else if (sp < 520) { this.aim.x = st.x; this.aim.y = st.y; }
    } else if (st.role === 'bat' && this.tSwing?.st === st) {
      this.tSwing.maxSp = Math.max(this.tSwing.maxSp, Math.hypot(st.vx, st.vy));
    }
  }
  // 손가락 높이 → 배트 높이 (스트라이크존 화면 높이 기준)
  _touchBatH(y) {
    const zr = this._zoneRectPitch();
    return clamp(ZONE.bottom + (zr.y + zr.h - y) / zr.h * (ZONE.top - ZONE.bottom), 0.1, 1.6);
  }
  // 던질 곳 고르기: 혼자면 스트라이크존을 직접 누름, 둘이면 내 반쪽의 작은 '던질 곳 판'
  _aimPad(s) {
    const zr = this._zoneRectPitch();
    if (this._humans().length > 1) return { cx: s === 0 ? this.W * 0.25 : this.W * 0.75, cy: this.H * 0.47, hw: zr.w * 0.75, hh: zr.h * 0.75 };
    return { cx: zr.cx, cy: zr.cy, hw: zr.w / 2, hh: zr.h / 2 };
  }
  _aimToZone(a) {
    const pad = this._aimPad(a.s);
    return { lx: clamp((a.x - pad.cx) / pad.hw, -1.3, 1.3), ly: clamp((pad.cy - a.y) / pad.hh, -1.3, 1.3) };
  }
  _zoneRectPitch() {
    if (!this._zr || this._zrKey !== `${this.W}x${this.H}`) {
      const c = new Cam3(); c.cx = this.cam.cx; c.cy = this.cam.cy; c.set(PITCH_CAM.p, PITCH_CAM.t, this.camF);
      this._zr = zoneRect(c); this._zrKey = `${this.W}x${this.H}`; this._zrCam = c;
    }
    return this._zr;
  }

  // ── 자세 인식 결과 → 몸·손 → 던지기/치기 ──
  _onPose(now) {
    const L = this.input?.sides;
    for (const p of this.players) {
      if (p.cpu || this._isTouch(p)) continue;
      const a = L?.[p.side];
      if (!a) {
        for (const h of p.hands) if (h.on && now - h.t > 250) { h.on = false; h.hist = []; h.fx.reset(); h.fy.reset(); }
        continue;
      }
      p.seenAt = now;
      this._updateBody(p, a);
      this._updateHands(p, a, now);
      this._gestures(p, now);
    }
  }

  _updateBody(p, a) {
    const X = (i) => a[i * 3], Y = (i) => a[i * 3 + 1], V = (i) => a[i * 3 + 2];
    const shX = (X(11) + X(12)) / 2, shY = (Y(11) + Y(12)) / 2;
    const shW = Math.hypot(X(11) - X(12), Y(11) - Y(12));
    const hipsOk = V(23) > 0.3 && V(24) > 0.3;
    const hipX = hipsOk ? (X(23) + X(24)) / 2 : shX;
    const hipY = hipsOk ? (Y(23) + Y(24)) / 2 : shY + shW * 1.4;
    const scale = clamp(Math.max(shW, Math.hypot(shX - hipX, shY - hipY) * 0.7), 30, 400);
    const headY = V(0) > 0.3 ? Y(0) - scale * 0.5 : shY - scale * 0.95;
    const b = p.body, k = b.ok ? 0.5 : 1;
    b.x = lerp(b.x, (shX + hipX) / 2, k); b.shY = lerp(b.shY, shY, k); b.hipY = lerp(b.hipY, Math.max(hipY, shY + scale * 0.6), k);
    b.headY = lerp(b.headY, headY, k); b.scale = lerp(b.scale, scale, k); b.ok = true;
    b.sh = [[X(11), Y(11)], [X(12), Y(12)]];
  }

  _updateHands(p, a, now) {
    const X = (i) => a[i * 3], Y = (i) => a[i * 3 + 1], V = (i) => a[i * 3 + 2];
    const t = now / 1000, sc = p.body.scale;
    for (let hi = 0; hi < 2; hi++) {
      const [w, pk, ix, th] = HANDS[hi], h = p.hands[hi];
      const wx = X(w), wy = Y(w);
      if (Math.max(V(w), V(ix)) < 0.35 || wx < -40 || wx > SCREEN.W + 40 || wy < -40 || wy > SCREEN.H + 40) {
        if (h.on && now - h.t > 250) { h.on = false; h.hist = []; h.fx.reset(); h.fy.reset(); }
        continue;
      }
      const kx = (X(pk) + X(ix) + X(th)) / 3, ky = (Y(pk) + Y(ix) + Y(th)) / 3;
      const px = wx + (kx - wx) * 0.8, py = wy + (ky - wy) * 0.8; // 손바닥 가운데쯤
      const dt = (now - h.t) / 1000;
      // 인식이 순간 튀면(사람 손으로 불가능한 속도) 기록을 지우고 새로 시작 → 엉뚱한 던지기·스윙 방지
      if (h.on && dt > 0 && Math.hypot(px - h.rx, py - h.ry) / dt / sc > 45) { h.hist = []; h.fx.reset(); h.fy.reset(); }
      if (h.on && dt > 0.012 && dt < 0.3 && h.hist.length) {
        const vx = (px - h.rx) / dt, vy = (py - h.ry) / dt;
        h.vx = vx; h.vy = vy; h.sp = Math.hypot(vx, vy) / sc;
      } else { h.vx = h.vy = 0; h.sp = 0; }
      h.rx = px; h.ry = py; h.t = now; h.on = true;
      h.hist.push({ t: now, x: px, y: py }); while (h.hist.length && now - h.hist[0].t > 600) h.hist.shift();
      h.x = h.fx.filter(px, t); h.y = h.fy.filter(py, t);
      h.act = h.act * 0.85 + h.sp * sc * 0.15;
    }
    // 화면 속 투수 그림이 사람 팔을 따라 하도록: 던지는 손 쪽 어깨 → 손 각도
    if (p.hand != null && p.body.sh) {
      const h = p.hands[p.hand], [sx, sy] = p.body.sh[p.hand];
      p.armSide = sx >= p.body.x ? 1 : -1;
      if (h.on) p.armAng = Math.atan2(h.y - sy, h.x - sx);
      if (h.on && p.side === this.batSide) this.batH[p.side] = lerp(this.batH[p.side], this._handBatH(p, h.y), 0.5);
    }
  }
  // 손 높이 → 배트 높이: 어깨 = 스트라이크존 위, 골반 = 존 아래
  _handBatH(p, y) {
    const b = p.body, rel = (y - b.shY) / Math.max(30, b.hipY - b.shY);
    return clamp(ZONE.top - rel * (ZONE.top - ZONE.bottom), 0.15, 1.55);
  }

  _gestures(p, now) {
    if (p.hand == null || this.frozen) { p.cap = null; return; }
    const h = p.hands[p.hand], lv = LEVELS[p.type];
    if (!h.on) return;
    const throwing = p.side === this.pitSide && this.state === 'windup' && this.stateT > 0.7;
    const batting = p.side === this.batSide && this.state === 'pitch' && this.pitch && !this.pitch.swung;
    if (!throwing && !batting) { p.cap = null; return; }
    const min = throwing ? lv.throwMin : lv.swingMin;
    const v = Math.hypot(h.vx, h.vy) || 1;
    let cap = p.cap;
    if (!cap) {
      // 던지기는 위로 올리는 동작(준비 자세)은 빼고, 내리거나 옆으로 휘두를 때만
      if (h.sp > min && (!throwing || h.vy > -0.35 * v)) {
        cap = p.cap = { kind: throwing ? 'throw' : 'swing', t0: now, peak: h.sp, peakT: now, pts: [{ x: h.rx, y: h.ry }] };
        const prev = h.hist[h.hist.length - 2]; if (prev) cap.pts.unshift({ x: prev.x, y: prev.y });
      }
      return;
    }
    cap.pts.push({ x: h.rx, y: h.ry });
    if (h.sp > cap.peak) { cap.peak = h.sp; cap.peakT = now; }
    const limit = cap.kind === 'throw' ? 120 : 90;
    if (now - cap.t0 >= limit || h.sp < cap.peak * 0.5) {
      p.cap = null;
      if (cap.kind === 'throw') this._camThrow(p, cap);
      else {
        const ys = cap.pts.map((q) => q.y).sort((a, b) => a - b), ym = ys[Math.floor(ys.length / 2)];
        this._swing(p.side, { tDetect: cap.peakT, power: clamp((cap.peak - lv.swingMin) / (lv.swingMax - lv.swingMin), 0, 1), batH: this._handBatH(p, ym) });
      }
    }
  }

  // 카메라로 던진 공: 빠르기 = 구속 / 휘두른 방향(좌우) + 손 높이(위아래) = 들어오는 곳
  _camThrow(p, cap) {
    const lv = LEVELS[p.type], a = cap.pts[0], b = cap.pts[cap.pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const cy = cap.pts.reduce((s, q) => s + q.y, 0) / cap.pts.length;
    const rel = (cy - p.body.shY) / Math.max(30, p.body.hipY - p.body.shY);
    this._throw(p.side, {
      power: clamp((cap.peak - lv.throwMin) / (lv.throwMax - lv.throwMin), 0, 1),
      lx: clamp(dx / len * 1.35, -1.3, 1.3),
      ly: clamp(-(rel - 0.1) * 2.2, -1.3, 1.3),
    });
  }

  // ── 진행 ──
  _setState(s) { this.state = s; this.stateT = 0; }
  get active() { return ['countdown', 'windup', 'pitch', 'call', 'hit', 'change'].includes(this.state); }

  startDemo() {
    this.demo = true; this.frozen = null; this.banner = null;
    this.setPlayers([{ name: '🤖', type: 'cpu' }, { name: '🤖', type: 'cpu' }]);
    this.innings = 99;
    this._startMatch();
  }

  enterLobby() {
    this.demo = false; this.frozen = null; this.banner = null; this.hint = null;
    for (const p of this.players) { p.score = 0; p.ready = p.cpu; p.readyHitT = -9; p.hand = p.cpu ? 1 : null; p.readyPos = null; }
    this.ball.mode = 'none'; this.pitch = null; this.hit = null; this.camMode = 'pitch'; this._pitchCam();
    this._setState('lobby');
    this.emit('lobby');
  }

  startCountdown() {
    if (this.demo) return;
    this.frozen = null; this.banner = null; this.ball.mode = 'none'; this.cdShown = 0;
    this.camMode = 'pitch'; this._pitchCam();
    for (const p of this.players) p.score = 0;
    this._setState('countdown');
    this.emit('countdown');
  }

  _startMatch() {
    for (const p of this.players) {
      Object.assign(p, { score: 0, hits: 0, hrs: 0, longest: 0, ks: 0, cap: null });
      if (p.hand == null) this._pickHand(p);
    }
    this.game = { inning: 1, half: 0, outs: 0, strikes: 0, atBat: 1 };
    this.emit('start');
    this._halfBanner();
    this._newPitch();
  }

  // '바로 시작'처럼 손을 안 고르고 시작하면: 많이 움직인 손 → 오른손
  _pickHand(p) {
    if (p.cpu) { p.hand = 1; return; }
    const [a, b] = p.hands;
    if (a.on !== b.on) p.hand = a.on ? 0 : 1;
    else p.hand = a.act > b.act * 1.3 ? 0 : 1;
  }

  pause() { if (this.active && !this.frozen) { this.frozen = 'manual'; this.freezeT = 0; this._onFreeze(); } }
  resume() { if (this.frozen === 'manual') this.frozen = null; }
  stop() { this.frozen = null; this.ball.mode = 'none'; this.pitch = null; this._setState('idle'); }
  // 공이 날아오는 중에 멈추면, 다시 시작할 때 그 공은 없던 걸로 하고 다시 던짐
  _onFreeze() { if (this.state === 'pitch' && this.pitch && !this.pitch.resolved) { this._newPitch(); this._pop('다시 던져요', this.W / 2, this.H * 0.4, '#fff', 40); } }

  _halfBanner() {
    if (this.demo) return;
    const B = this.players[this.batSide], P = this.players[this.pitSide];
    this.banner = { title: `${this.game.inning}회 ${this.game.half ? '말' : '초'}`, sub: `⚾ ${B.name} 공격 · 🧢 ${P.name} 수비`, color: B.color, t: 0, life: 2.4 };
  }

  _newPitch() {
    this.pitch = null; this.hit = null; this.aim = null; this.tSwing = null;
    this.ball.mode = 'hold';
    this.swingT = -1; this.pAnim.throwT = -1; this.pAnim.ball = true;
    for (const p of this.players) p.cap = null;
    if (this.camMode !== 'pitch') this.camMode = 'back';
    const P = this.players[this.pitSide], B = this.players[this.batSide];
    this.cpuWind = rand(1.2, 2.2) + (B.type === 'kid' ? 0.6 : 0) + (this.demo ? -0.3 : 0);
    if (P.cpu) this.cpuWind += 0.4;
    this._setState('windup');
  }

  // 던지기 (사람·컴퓨터 공통). power 0~1, lx/ly: 들어올 곳 (-1~1, 존 밖이면 존 안으로 넣음)
  _throw(side, { power, lx, ly }) {
    if (this.state !== 'windup' || side !== this.pitSide) return;
    const P = this.players[side], B = this.players[this.batSide], lvP = LEVELS[P.type], lvB = LEVELS[B.type];
    const pe = lvP.powerFloor + (1 - lvP.powerFloor) * clamp(power, 0, 1);
    let pull = lvP.aimPull;
    if (P.cpu && B.type === 'kid') pull = Math.max(pull, 0.45);   // 컴퓨터는 아이에게 치기 좋은 공
    const wob = P.cpu ? 0 : P.type === 'kid' ? 0.08 : 0.14;     // 사람 손은 조금씩 흔들림
    const ax = clamp(lx * (1 - pull) + randn() * wob, -1, 1), ay = clamp(ly * (1 - pull) + randn() * wob, -1, 1);
    const tx = ax * (ZONE.halfW - FIELD.BALL_R * 1.3), ty = ZONE_MID + ay * (ZONE_HH - FIELD.BALL_R * 1.3);
    // 구속은 던진 사람 기준, 날아오는 시간은 그 구속을 치는 사람 기준으로 (아이에겐 같은 구속도 느리게)
    const kmh = Math.round(lerp(lvP.kmh[0], lvP.kmh[1], pe));
    const T = lerp(lvB.flight[0], lvB.flight[1], clamp((kmh - 60) / 90, 0, 1));
    const [rx, ry, rz] = FIELD.RELEASE, x0 = rx * (P.cpu || this._isTouch(P) ? 1 : P.armSide);
    const gy = 3.2 / T; // 보기 좋게 살짝 떨어지는 공 (느린 공도 무지개처럼 뜨지 않게)
    const now = performance.now();
    this.pitch = {
      t: 0, T, x0, y0: ry, z0: rz, vx: (tx - x0) / T, vz: -rz / T, vy: (ty - ry + 0.5 * gy * T * T) / T, gy, tx, ty,
      power: pe, kmh, lx: ax, ly: ay,
      tRel: now, tArr: now + T * 1000, swung: false, resolved: false, caught: false, miss: null, cpuSwing: null,
    };
    this.ball.mode = 'pitch'; this.ball.x = x0; this.ball.y = ry; this.ball.z = rz;
    this.pAnim.throwT = 0; this.pAnim.ball = false;
    this.lastSwing = null;
    this.snd('throwBall', pe);
    const rp = this.cam.proj(x0, ry + 0.4, rz);
    if (rp && !this.demo) this._pop(`${this.pitch.kmh}km/h${this.pitch.kmh >= 140 ? ' 🔥' : ''}`, rp.x + 150 * this.ui, rp.y + 40 * this.ui, '#fff', 34 * this.ui);
    if (B.cpu) this._cpuPlanSwing();
    this._setState('pitch');
  }

  // 컴퓨터 타자: 가끔 안 치고, 칠 때는 타이밍·높이가 조금씩 틀림 (빠른 공일수록 더)
  _cpuPlanSwing() {
    const pt = this.pitch, pe = pt.power;
    if (Math.random() < 0.14) return;
    const e = randn() * (0.1 + 0.08 * pe);
    pt.cpuSwing = { at: pt.tArr - e * 1000, batH: pt.ty + randn() * (0.13 + 0.12 * pe), power: rand(0.35, 1) };
  }

  // 스윙 (사람·컴퓨터 공통). tDetect: 스윙을 알아챈 시각(ms), batH: 배트 높이(m)
  _swing(side, { tDetect, power, batH }) {
    const pt = this.pitch;
    if (this.state !== 'pitch' || !pt || pt.swung || pt.resolved || side !== this.batSide || this.frozen) return;
    pt.swung = true;
    const B = this.players[side], lv = LEVELS[B.type];
    const tEff = tDetect - (this._lagIn(B) + this._lagDisp(B)) * 1000;
    const e = (pt.tArr - tEff) / 1000;                          // + 빨리 휘두름, - 늦게 휘두름
    this.batH[side] = batH;
    const d = (pt.ty - batH) / ZONE_HH, dk = d * lv.heightK;      // + 배트가 공보다 아래
    const [early, late] = this._window(lv, pt);
    this.lastSwing = { e, d, power, early, late };
    if (e > early) pt.miss = 'early';
    else if (e < -late) pt.miss = 'late';
    else if (Math.abs(dk) > lv.heightMiss) pt.miss = dk > 0 ? 'under' : 'over';
    if (pt.miss) {
      this.swingT = SWING_ANIM * 0.25;
      this.snd('whoosh', power);
      const why = { early: '너무 빨라요!', late: '조금 늦었어요!', under: '공이 배트보다 높았어요', over: '공이 배트보다 낮았어요' }[pt.miss];
      const zr = this._zoneRectPitch();
      if (!this.demo && !B.cpu) this._pop(why, zr.cx, zr.y + zr.h + 50 * this.ui, '#fff', 30 * this.ui);
      return;
    }
    this.swingT = SWING_ANIM * 0.43;
    this._contact(side, e, power, dk);
  }

  // 맞았다! 타이밍·힘·높이 → 맞은 공 속도·각도·방향 → 비거리
  // 맞는 시간 창(초): 공이 홈 앞뒤 early/late 미터를 지나는 시간 → 빠른 공일수록 좁음
  _window(lv, pt) { const v = FIELD.RELEASE[2] / pt.T; return [lv.early / v, lv.late / v]; }

  _contact(side, e, power, dk) {
    const pt = this.pitch, B = this.players[side], lv = LEVELS[B.type], kid = B.type === 'kid';
    const [early, late] = this._window(lv, pt);
    const en = clamp(e / (e >= 0 ? early : late), -1, 1);
    const tq = 1 - (kid ? 0.45 : 0.62) * Math.pow(Math.abs(en), 1.6);
    let pf = kid ? (0.55 + 0.45 * power) * (0.55 + 0.45 * tq) : (0.42 + 0.58 * power) * tq;
    pf = clamp(pf * (0.93 + 0.12 * pt.power), 0, 1);
    const ev = lerp(lv.evMin, lv.evMax, pf);
    const alpha = clamp((kid ? 27 : 23) + clamp(dk, -1.6, 1.6) * 30 + randn() * 4, -6, 68);
    const aF = Math.max(alpha, 4) * D2R;
    let D = 0.75 * ev * ev * Math.sin(2 * aF) / FIELD.GRAVITY;
    if (alpha < 4) D *= 0.6;                                    // 땅볼
    D = Math.max(2.5, D);
    const th = clamp((-en * 28 + pt.lx * 9 + randn() * 5), -FIELD.FAIR_DEG, FIELD.FAIR_DEG) * D2R;
    // 공이 지금 있는 곳에서 출발 (이미 미트에 들어갔으면 홈플레이트 위)
    const b = this.ball;
    let x0 = b.x, y0 = b.y, z0 = clamp(b.z, -0.25, 1.6);
    if (pt.caught || b.z < -0.25) { x0 = pt.tx; y0 = pt.ty; z0 = 0; }
    this._launch(side, { x0, y0, z0, D, th, alpha, ev, pf });
    pt.resolved = true;
    // 타격감: 멈칫 + 흔들림 + 번쩍 + 불꽃 + '딱!'
    const q = Math.max(pf, this.hit.hr ? 1 : 0);
    const [s0, s1] = RULES.HIT_STOP, [k0, k1] = RULES.SHAKE;
    this.hitStop = lerp(s0, s1, q); this.shake = lerp(k0, k1, q); this.flash = 0.25 + q * 0.5;
    const sp = this.cam.proj(x0, y0, z0);
    if (sp) {
      this.fx.push({ k: 'flash', x: sp.x, y: sp.y, r0: 20, r1: (90 + q * 140) * this.ui, t: 0, life: 0.18 });
      this._ring(sp.x, sp.y, '#fff', 30, (130 + q * 120) * this.ui);
      const n = Math.round(14 + q * 22);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + th * 0.8 + rand(-1.1, 1.1), v = rand(300, 760) * (0.6 + q) * this.ui;
        this.fx.push({ k: 'spark', x: sp.x, y: sp.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(0.2, 0.42), color: i % 3 ? '#ffd93d' : '#fff', w: rand(3, 7) * this.ui });
      }
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + rand(-0.12, 0.12); this.fx.push({ k: 'line', x: sp.x, y: sp.y, a, r0: 40 * this.ui, r1: (150 + q * 150) * this.ui, t: 0, life: 0.15 + q * 0.07 }); }
      if (!this.demo) {
        const word = this.hit.hr ? '홈런각!' : q > 0.8 ? '딱!!' : q > 0.5 ? '딱!' : '톡!';
        this._pop(word, sp.x, sp.y - 70 * this.ui, q > 0.8 ? '#ffd93d' : '#fff', (q > 0.8 ? 70 : 52) * this.ui);
        if (!B.cpu) {
          const fb = en > 0.4 ? '조금 빨랐어요 (당겨쳤어요)' : en < -0.4 ? '조금 늦었어요 (밀어쳤어요)' : '타이밍 딱 좋아요!';
          const zr = this._zoneRectPitch();
          this._pop(fb, zr.cx, zr.y + zr.h + 50 * this.ui, '#fff', 28 * this.ui);
        }
      }
    }
    this.snd('crack', q);
    if (q > 0.75) this.snd('cheer');
    this.camMode = 'hit'; this.camHit = { t: 0 };
    this._setState('hit');
  }

  _launch(side, { x0, y0, z0, D, th, alpha, ev, pf }) {
    const g = FIELD.GRAVITY, Lx = Math.sin(th) * D, Lz = Math.cos(th) * D;
    const dh = Math.hypot(Lx - x0, Lz - z0), ux = (Lx - x0) / dh, uz = (Lz - z0) / dh;
    const hr = D >= fenceAt(th);
    let a = Math.max(alpha, 1.5) * D2R, v = 20, T = 1;
    const solve = () => {
      const range = (vv) => { const vs = vv * Math.sin(a), tt = (vs + Math.sqrt(vs * vs + 2 * g * Math.max(y0, 0.05))) / g; return vv * Math.cos(a) * tt; };
      let lo = 0.5, hi = 120;
      for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (range(m) < dh) lo = m; else hi = m; }
      v = (lo + hi) / 2;
      const vs = v * Math.sin(a); T = (vs + Math.sqrt(vs * vs + 2 * g * Math.max(y0, 0.05))) / g;
    };
    solve();
    if (hr) {   // 홈런은 담장을 넉넉히 넘어가게
      for (let i = 0; i < 12; i++) {
        const vh = v * Math.cos(a), tf = (fenceAt(th) - Math.hypot(x0, z0)) / vh, yf = y0 + v * Math.sin(a) * tf - 0.5 * g * tf * tf;
        if (yf > FIELD.FENCE_H + 2) break;
        a = Math.min(a + 2.5 * D2R, 50 * D2R); solve();
      }
    }
    const vh = v * Math.cos(a);
    this.hit = { side, t: 0, T, x0, y0, z0, vx: vh * ux, vy: v * Math.sin(a), vz: vh * uz, D: Math.round(D), th, hr, landed: false, landT: 0, lx: Lx, lz: Lz, ev, pf };
    Object.assign(this.ball, { mode: 'hit', x: x0, y: y0, z: z0, vx: vh * ux, vy: v * Math.sin(a), vz: vh * uz });
  }

  _strike(kind) {
    const pt = this.pitch;
    if (!pt || pt.resolved) return;
    pt.resolved = true;
    const B = this.players[this.batSide], g = this.game;
    g.strikes++;
    if (g.strikes >= RULES.STRIKES) {
      g.strikes = 0; g.outs++; g.atBat++; B.ks++;
      this.banner = this.demo ? null : { title: '삼진 아웃!', sub: `${g.outs}아웃`, color: '#e8414f', t: 0, life: RULES.CALL_PAUSE_SEC + 0.3 };
      this.snd('out');
      this.afterCall = g.outs >= RULES.OUTS ? 'change' : 'next';
    } else {
      const title = kind === 'swing' ? '헛스윙!' : '스트라이크!';
      this.banner = this.demo ? null : { title, sub: `스트라이크 ${g.strikes}`, color: '#f2a516', t: 0, life: RULES.CALL_PAUSE_SEC };
      this.snd('strike');
      this.afterCall = 'next';
    }
    this._setState('call');
  }

  _landed() {
    const h = this.hit, B = this.players[h.side], O = this.players[1 - h.side];
    h.landed = true; h.landT = 0;
    const behind = B.score <= O.score;
    B.score += h.D; B.hits++; B.longest = Math.max(B.longest, h.D);
    if (h.hr) B.hrs++;
    // 안타를 쳐도 스트라이크는 그대로 (RULES.RESET_ON_HIT 로 바꿀 수 있음) → 반 이닝 길이가 일정
    if (RULES.RESET_ON_HIT) { this.game.strikes = 0; this.game.atBat++; }
    const lead = behind && B.score > O.score && !this.demo;
    if (h.hr) {
      this.banner = this.demo ? null : { title: '홈런!!', sub: `${h.D}m${lead ? ' · 역전!' : ''}`, color: '#ff6b3d', t: 0, life: 2.6, big: true, y: 0.3 };
      this.snd('homerun');
      for (let i = 0; i < 4; i++) this._firework(rand(this.W * 0.15, this.W * 0.85), rand(this.H * 0.12, this.H * 0.4), i * 0.25);
    } else {
      this.banner = this.demo ? null : { title: `${h.D}m!`, sub: `${B.name}${lead ? ' · 역전!' : ''}`, color: B.color, t: 0, life: 2.2, big: h.D >= 60, y: 0.3 };
      this.snd('land'); this.snd('meters');
      if (lead) this.snd('cheer');
    }
    // 공은 튀고 굴러감 (홈런은 관중석에서 멈춤)
    const b = this.ball;
    if (h.hr) { b.vx = b.vz = b.vy = 0; b.mode = 'gone'; }
    else { b.vy = Math.abs(b.vy) * 0.32; b.vx *= 0.55; b.vz *= 0.55; b.mode = 'roll'; }
  }

  _afterCall() {
    if (this.afterCall === 'change') this._changeSides();
    else this._newPitch();
  }

  _changeSides() {
    const g = this.game;
    g.outs = 0; g.strikes = 0; g.atBat = 1;
    if (g.half === 0) g.half = 1; else { g.half = 0; g.inning++; }
    if (g.inning > this.innings) { this._gameOver(); return; }
    this.ball.mode = 'none'; this.pitch = null;
    const B = this.players[this.batSide], P = this.players[this.pitSide];
    if (!this.demo) {
      this.banner = { title: '공수교대!', sub: `${g.inning}회 ${g.half ? '말' : '초'} · ⚾ ${B.name} 공격 · 🧢 ${P.name} 수비`, color: B.color, t: 0, life: RULES.CHANGE_SEC };
      this.snd('change');
    }
    if (this.camMode !== 'pitch') this.camMode = 'back';
    this._setState('change');
  }

  _gameOver() {
    if (this.demo) { this._startMatch(); return; }
    this.ball.mode = 'none'; this.pitch = null;
    for (const p of this.players) { p.ready = p.cpu; p.readyHitT = -9; p.readyPos = null; }
    const [a, b] = this.players, w = a.score === b.score ? -1 : a.score > b.score ? 0 : 1;
    this.banner = { title: w < 0 ? '무승부!' : `🏆 ${this.players[w].name} 승리!`, sub: `${a.score}m : ${b.score}m`, color: w < 0 ? '#9b5de5' : this.players[w].color, t: 0, life: 3.2, big: true };
    for (let i = 0; i < 140; i++) this.fx.push({ k: 'conf', x: rand(0, this.W), y: rand(-200, -10), vx: rand(-60, 60), vy: rand(60, 220), r: rand(5, 10), rot: rand(0, TAU), vr: rand(-6, 6), t: 0, life: rand(3, 5), color: ['#ffd93d', '#ff6b6b', '#4d96ff', '#3ecfb2', '#9b5de5', '#fff'][i % 6] });
    this.snd('fanfare');
    this._setState('over');
    this.emit('over', {
      winner: w, names: this.players.map((p) => p.name), scores: this.players.map((p) => p.score),
      longest: this.players.map((p) => p.longest), hrs: this.players.map((p) => p.hrs), hits: this.players.map((p) => p.hits),
    });
  }

  // ── 매 프레임 ──
  _frame(now) {
    requestAnimationFrame(this._frame);
    let dt = (now - this._last) / 1000; this._last = now;
    if (dt > 0.1) dt = 0.1;
    this._acc += dt;
    const STEP = 1 / 120;
    let n = 0;
    while (this._acc >= STEP && n < 24) { this._update(STEP); this._acc -= STEP; n++; }
    try { this.render(); } catch (e) { console.warn(e); }
    this._fpsN++;
    if (now - this._fpsT > 1000) { this.fps = this._fpsN * 1000 / (now - this._fpsT); this._fpsN = 0; this._fpsT = now; }
  }

  _update(dt) {
    const now = performance.now();
    for (const p of this.players) p.present = p.cpu || this._isTouch(p) || now - p.seenAt < 450;
    if (this.active && !this.demo && !this.touchMode) this._checkAbsent(now);
    this._updateFx(dt);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.life) this.banner = null; }
    this.shake *= Math.exp(-dt * 12); this.flash = Math.max(0, this.flash - dt * 2.5); this.mittPop = Math.max(0, this.mittPop - dt * 5);
    if (this.frozen) { this.freezeT += dt; return; }
    if (this.hitStop > 0) { this.hitStop -= dt; return; }   // 맞는 순간 멈칫
    this.time += dt; this.stateT += dt;
    if (this.swingT >= 0) { this.swingT += dt; if (this.swingT > SWING_ANIM * 4 && this.state !== 'hit') this.swingT = -1; }
    this._pitcherAnim(dt);
    this._camStep(dt);
    switch (this.state) {
      case 'lobby': case 'over': this._readyStep(); break;
      case 'countdown': {
        const left = Math.ceil(RULES.COUNTDOWN_SEC - this.stateT);
        if (left !== this.cdShown && left > 0) { this.cdShown = left; this.snd('beep', false); }
        if (this.stateT >= RULES.COUNTDOWN_SEC) { this.snd('beep', true); this._startMatch(); }
        break;
      }
      case 'windup': this._windupStep(); break;
      case 'pitch': this._pitchStep(dt, now); break;
      case 'call': if (this.stateT > RULES.CALL_PAUSE_SEC) this._afterCall(); break;
      case 'hit': this._hitStep(dt); break;
      case 'change': if (this.stateT > RULES.CHANGE_SEC) this._newPitch(); break;
      default: break;
    }
  }

  _windupStep() {
    const P = this.players[this.pitSide];
    if (P.cpu) {
      if (this.stateT > this.cpuWind) {
        const B = this.players[this.batSide];
        const k = B.type === 'kid' ? 0.5 : 0.95;
        this._throw(P.side, { power: rand(0.25, 0.92), lx: rand(-1, 1) * k, ly: rand(-1, 1) * k });
      }
      return;
    }
    if (this.stateT > RULES.WINDUP_AUTO_SEC && !this.aim?.down) {
      this._throw(P.side, { power: 0.1, lx: 0, ly: 0 });
      if (this.pitch) this._pop('살살~', this.W / 2, this.H * 0.3, '#fff', 40 * this.ui);
    }
  }

  _pitchStep(dt, now) {
    const pt = this.pitch, b = this.ball, B = this.players[this.batSide];
    pt.t += dt;
    if (!pt.caught) {
      b.x = pt.x0 + pt.vx * pt.t; b.z = pt.z0 + pt.vz * pt.t; b.y = pt.y0 + pt.vy * pt.t - 0.5 * pt.gy * pt.t * pt.t;
      b.rot += dt * 30;
      if (b.z <= FIELD.CATCH_Z) {
        pt.caught = true; b.z = FIELD.CATCH_Z; b.x = pt.tx; b.y = pt.ty - 0.02;
        b.mode = 'caught'; this.mittPop = 1;
        if (!pt.swung || pt.miss) this.snd('mitt');
      }
    }
    // 컴퓨터 타자 스윙
    if (pt.cpuSwing && now >= pt.cpuSwing.at) { const s = pt.cpuSwing; pt.cpuSwing = null; this._swing(B.side, { tDetect: now, power: s.power, batH: s.batH }); if (this.state !== 'pitch') return; }
    // 📱 톡 친 뒤 잠깐 손가락 움직임을 보고 세기 결정
    if (this.tSwing && now - this.tSwing.t >= RULES.TOUCH_SWIPE_MS) {
      const ts = this.tSwing, [a, c] = RULES.TOUCH_SWIPE; this.tSwing = null;
      const power = RULES.TOUCH_TAP_POWER + (1 - RULES.TOUCH_TAP_POWER) * clamp((ts.maxSp - a) / (c - a), 0, 1);
      this._swing(ts.s, { tDetect: ts.t, power, batH: this._touchBatH(ts.y) });
      if (this.state !== 'pitch') return;
    }
    if (pt.resolved) return;
    if (pt.miss && pt.caught) { this._strike('swing'); return; }
    // 안 쳤으면: 늦게 휘두른 스윙이 들어올 시간까지 기다렸다가 스트라이크
    const lv = LEVELS[B.type];
    const wait = (B.cpu ? 0.02 : this._window(lv, pt)[1] + this._lagIn(B) + this._lagDisp(B) + (this.tSwing ? RULES.TOUCH_SWIPE_MS / 1000 : 0) + 0.02) * 1000;
    if (!pt.swung && pt.caught && now > pt.tArr + wait) this._strike('look');
  }

  _hitStep(dt) {
    const h = this.hit, b = this.ball, g = FIELD.GRAVITY;
    h.t += dt;
    if (!h.landed) {
      const t = Math.min(h.t, h.T);
      b.x = h.x0 + h.vx * t; b.z = h.z0 + h.vz * t; b.y = h.y0 + h.vy * t - 0.5 * g * t * t;
      b.rot += dt * 18;
      b.vy = h.vy - g * t;
      if (h.t >= h.T) { b.y = 0; b.x = h.lx; b.z = h.lz; this._landed(); }
    } else {
      h.landT += dt;
      if (b.mode === 'roll') {
        b.vy -= g * dt; b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
        if (b.y <= 0) { b.y = 0; if (b.vy < -1.2) b.vy = -b.vy * 0.35; else b.vy = 0; const f = Math.exp(-dt * 1.6); b.vx *= f; b.vz *= f; }
        const r = Math.hypot(b.x, b.z), th = Math.atan2(b.x, b.z), fr = fenceAt(th) - 0.6;
        if (r > fr) { b.x = Math.sin(th) * fr; b.z = Math.cos(th) * fr; b.vx *= -0.2; b.vz *= -0.2; }
        b.rot += dt * Math.hypot(b.vx, b.vz) * 2;
      }
      if (h.landT > RULES.HIT_PAUSE_SEC) this._newPitch();
    }
  }

  // ── 카메라: 투구 시점 고정 / 친 공 따라가기 / 다시 돌아오기 ──
  _camStep(dt) {
    const c = this.cam;
    if (this.camMode === 'pitch') return;
    let P, T, F;
    if (this.camMode === 'hit' && this.hit) {
      const b = this.ball, dist = Math.hypot(b.x, b.z);
      const k = clamp(this.hit.t / 0.5, 0, 1);
      // 공을 따라가되 땅도 같이 보이게: 공보다 조금 아래를 보고, 공이 높이 뜰수록 카메라도 올라감
      P = [lerp(PITCH_CAM.p[0], b.x * 0.15, k), lerp(PITCH_CAM.p[1], 3 + clamp(b.y * 0.7, 0, 22) + Math.min(dist * 0.06, 6), k), lerp(PITCH_CAM.p[2], -8 - Math.min(dist * 0.08, 9), k)];
      T = [b.x, Math.max(b.y * 0.8 - 1, 0.3), Math.max(b.z, 6)];
      F = this.camF * (1 + clamp((dist - 15) / 90, 0, 1.1));
      const r = 1 - Math.exp(-dt * (this.hit.landed ? 2.5 : 7));
      c.p = c.p.map((v, i) => lerp(v, P[i], r)); c.t = c.t.map((v, i) => lerp(v, T[i], r)); c.F = lerp(c.F, F, r);
    } else {
      const r = 1 - Math.exp(-dt * 6);
      c.p = c.p.map((v, i) => lerp(v, PITCH_CAM.p[i], r)); c.t = c.t.map((v, i) => lerp(v, PITCH_CAM.t[i], r)); c.F = lerp(c.F, this.camF, r);
      const d = Math.hypot(...c.p.map((v, i) => v - PITCH_CAM.p[i])) + Math.hypot(...c.t.map((v, i) => v - PITCH_CAM.t[i])) * 0.02 + Math.abs(c.F - this.camF) / 400;
      if (d < 0.02) { this.camMode = 'pitch'; this._pitchCam(); return; }
    }
    c.update();
  }

  // 화면 속 투수 그림 동작
  _pitcherAnim(dt) {
    const A = this.pAnim, P = this.players[this.pitSide];
    // 각도(화면 기준, 던지는 팔이 화면 오른쪽일 때): 0.95 = 내린 팔, -1.7 = 머리 위로 든 팔, 2.3 = 던지고 반대쪽 아래로
    if (A.throwT >= 0) {                                       // 던진 뒤 팔이 머리 위에서 몸 앞을 지나 반대쪽 아래로
      A.throwT += dt;
      const k = ease(A.throwT / 0.28);
      A.arm = lerp(-1.7, 2.3 - TAU, k); A.lean = lerp(0.6, 1, k);
      if (A.throwT > 1.1) { A.throwT = -1; A.arm = wrapA(A.arm); }
      return;
    }
    A.lean = lerp(A.lean, 0, 0.1);
    let target = 0.95;
    if (this.state === 'windup') {
      if (P.cpu) { const k = ease((this.stateT - (this.cpuWind - 0.7)) / 0.6); target = lerp(0.95, -1.7, k); }
      else if (this._isTouch(P)) target = this.aim?.down ? -1.7 : 0.95;
      else if (P.armAng != null && P.hands[P.hand ?? 1]?.on) target = P.armAng;
    }
    A.arm = P.cpu && this.state === 'windup' ? target : angLerp(A.arm, target, 0.25);
  }

  _checkAbsent(now) {
    const gone = (p, ms) => !p.cpu && now - p.seenAt > ms;
    if (!this.frozen) {
      const miss = this.players.filter((p) => gone(p, RULES.ABSENT_PAUSE_MS));
      if (miss.length) { this.frozen = 'absent'; this.freezeT = 0; this.backAt = 0; this.missing = miss.map((p) => p.side); this._onFreeze(); this.emit('absent', true); }
    } else if (this.frozen === 'absent') {
      this.missing = this.players.filter((p) => gone(p, 450)).map((p) => p.side);
      if (this.missing.length) this.backAt = 0;
      else {
        if (!this.backAt) this.backAt = now;
        if (now - this.backAt > RULES.RETURN_MS) { this.frozen = null; this.backAt = 0; this._pop('다시 시작!', this.W / 2, this.H * 0.45, '#fff', 56 * this.ui); this.emit('absent', false); }
      }
    }
  }

  // ── 대기실·결과: 각자 자기 쪽 공을 손으로 톡 → 둘 다 준비되면 시작 ──
  _readyBallPos(s) {
    const p = this.players[s], W = this.W, H = this.H, cam = !!this.input && !this.touchMode;
    let x, y;
    if (cam) {
      const tn = s === 0 ? 1 : -1;
      x = s === 0 ? W * 0.25 : W * 0.75; y = H * 0.42;
      if (p.present && p.body.ok) {
        x = clamp(p.body.x + tn * p.body.scale * 1.1, s === 0 ? 90 : W / 2 + 80, s === 0 ? W / 2 - 80 : W - 90);
        y = clamp(p.body.shY, 170, H - 160);
      }
    } else {
      const hs = this._humans();
      x = hs.length > 1 ? (s === 0 ? W * 0.25 : W * 0.75) : W / 2; y = H * (this.state === 'over' ? 0.4 : 0.6);   // 결과 카드(아래)와 안 겹치게
    }
    const q = (p.readyPos ||= { x, y });
    q.x += (x - q.x) * 0.04; q.y += (y - q.y) * 0.04;
  }
  _readyBallAt(s) {
    const q = this.players[s].readyPos || { x: s ? this.W * 0.75 : this.W * 0.25, y: this.H * 0.5 };
    return { x: q.x, y: q.y + Math.sin(this.time * 2.4 + s * 1.7) * 10 };
  }
  _setReady(p, hand, q) {
    p.ready = true; p.readyHitT = this.time;
    if (!p.cpu && hand != null) p.hand = hand;          // 공을 친 손이 '던지고 치는 손'
    this.snd('ready'); this._burst(q.x, q.y, p.color, 22); this._ring(q.x, q.y, '#fff', 30, 110);
  }
  _readyStep() {
    for (const p of this.players) if (!p.cpu) this._readyBallPos(p.side);
    const canReady = this.state === 'lobby' ? this.stateT > 0.4 : this.stateT > 2.6;
    if (!canReady) return;
    if (this.input && !this.touchMode) {
      for (const p of this.players) {
        if (p.ready || !p.present || p.cpu) continue;
        const q = this._readyBallAt(p.side);
        for (let hi = 0; hi < 2; hi++) {
          const h = p.hands[hi];
          if (!h.on) continue;
          const r = 64 + p.body.scale * 0.15;
          if (Math.hypot(h.x - q.x, h.y - q.y) < r) { this._setReady(p, hi, q); break; }
        }
      }
    }
    if (this.players.every((p) => p.ready)) {
      if (this.state === 'over') this.emit('retry');
      this.startCountdown();
    }
  }

  // ── 효과 ──
  _pop(textStr, x, y, color, size = 36) { this.pops.push({ text: textStr, x, y, color, size, t: 0, life: 1.3 }); }
  _ring(x, y, color, r0, r1) { this.fx.push({ k: 'ring', x, y, color, r0, r1, t: 0, life: 0.35 }); }
  _burst(x, y, color, n = 18) {
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(120, 380); this.fx.push({ k: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, r: rand(4, 8), color: i % 3 ? color : '#ffd93d', t: 0, life: rand(0.5, 0.9) }); }
  }
  _firework(x, y, delay = 0) {
    const cols = ['#ffd93d', '#ff6b6b', '#4d96ff', '#3ecfb2', '#9b5de5', '#fff'], col = cols[Math.floor(rand(0, cols.length))];
    this.fx.push({ k: 'fw', x, y, t: -delay, life: 1.4, col, n: 26, r: rand(110, 180) * this.ui });
    setTimeout(() => this.snd('firework'), delay * 1000);
  }
  _updateFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.k === 'dot') { f.vy += 600 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      else if (f.k === 'spark') { f.vx *= 0.9; f.vy = f.vy * 0.9 + 500 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      else if (f.k === 'conf') { f.vy = Math.min(f.vy + 120 * dt, 260); f.x += (f.vx + Math.sin(f.t * 3 + f.rot) * 40) * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }
    }
    this.fx = this.fx.filter((f) => f.t < f.life);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.life);
  }

  // ───────────────────────── 그리기 ─────────────────────────
  render() {
    const c = this.ctx, W = this.W, H = this.H;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const camLobby = this.input && !this.touchMode && (this.state === 'lobby' || (this.state === 'over' && this.stateT > 2.6));
    if (camLobby) { this._drawCameraLobby(c); this._drawFx(c); this._drawOverlays(c); if (this.debug) this._drawDebug(c); return; }
    c.save();
    if (this.shake > 0.5) c.translate(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake);
    this._drawWorld(c);
    c.restore();
    if (this.flash > 0) { c.fillStyle = `rgba(255,255,240,${this.flash * 0.35})`; c.fillRect(0, 0, W, H); }
    this._drawFx(c);
    if (this.state !== 'idle' && !this.demo) {
      if (this.input && !this.touchMode) this._drawPips(c);
      this._drawHud(c);
      this._drawGuide(c);
    }
    if (this.touchMode && (this.state === 'lobby' || (this.state === 'over' && this.stateT > 2.6))) this._drawTouchReady(c);
    this._drawOverlays(c);
    if (this.debug) this._drawDebug(c);
  }

  _drawWorld(c) {
    const cam = this.cam, W = this.W, H = this.H;
    if (this.camMode === 'pitch') {
      const key = `${W}x${H}x${this.camF}x${ART.version}`;
      if (!this._fieldCache || this._fieldKey !== key) {
        const cv = this._fieldCache || document.createElement('canvas'); cv.width = W; cv.height = H;
        drawField(cv.getContext('2d'), cam, W, H);
        this._fieldCache = cv; this._fieldKey = key;
      }
      c.drawImage(this._fieldCache, 0, 0);
    } else drawField(c, cam, W, H);
    const P = this.players[this.pitSide], B = this.players[this.batSide], b = this.ball, A = this.pAnim;
    const showPeople = this.state !== 'idle' || this.demo;
    // 친 공이 떨어진 곳
    if (this.hit?.landed) {
      const h = this.hit;
      groundRing(c, cam, h.lx, h.lz, 1.6 + Math.sin(this.time * 6) * 0.3, h.hr ? '#ffd93d' : '#fff', 4);
      const q = cam.proj(h.lx, 2.6, h.lz);
      if (q && (!this.banner || this.demo)) text(c, `${h.D}m`, q.x, q.y, { size: clamp(q.k * 1.6, 20, 64) * this.ui, color: '#ffd93d', sw: 7 });
    }
    if (showPeople) {
      const side = P.cpu || this._isTouch(P) ? 1 : P.armSide;
      const sh = sheetFor('pitcher', P.type === 'kid');
      // 그림이 있으면 그림 투수 (던지는 손은 그림 오른쪽 → 사람이 왼손이면 뒤집음), 없으면 코드로 그린 투수
      if (!(sh && drawSprite(c, cam, sh, P.side, this._pitcherPose(P), [0, 0.27, FIELD.MOUND_Z - 0.1], P.type === 'kid' ? 1.4 : 1.85, side < 0)))
        drawPitcher(c, cam, { color: P.color, arm: A.arm, side, ball: A.ball && this.state !== 'change', lean: A.lean, t: this.time });
    }
    if (b.mode === 'hit' || b.mode === 'roll' || b.mode === 'gone') this._drawHitBall(c);
    if (showPeople && this.camMode !== 'hit') {
      const sw = this.swingT >= 0 ? this.swingT / SWING_ANIM : -1;
      const sh = sheetFor('batter', B.type === 'kid');
      if (!(sh && drawSprite(c, cam, sh, B.side, this._batterPose(sw), [-1.0, 0, 0.12], B.type === 'kid' ? 1.3 : 1.8, false, false)))
        drawBatter(c, cam, { color: B.color, batH: this.batH[B.side], swing: sw > 1 ? 1 : sw, num: String(B.side + 1) });
    }
    if (this.camMode === 'pitch' && (this.state === 'windup' || this.state === 'pitch' || this.state === 'call')) {
      drawZone(c, cam, this.state === 'pitch' ? 0.75 : 0.5);
      this._drawBatGuide(c);
      this._drawAimPad(c);
    }
    if (b.mode === 'pitch' || b.mode === 'caught') this._drawPitchBall(c);
  }

  // 그림 투수 동작: 던지는 중/던진 뒤, 삼진 잡으면 기뻐하기, 홈런 맞으면 아쉬워하기, 준비 중엔 팔 높이 따라
  _pitcherPose(P) {
    const A = this.pAnim;
    if (A.throwT >= 0) return A.throwT < 0.13 ? POSE.THROW : A.throwT < 0.9 ? POSE.FOLLOW : POSE.READY;
    if (this.state === 'call' && this.game.strikes === 0) return POSE.HAPPY;          // 방금 삼진 아웃
    if ((this.state === 'hit' && this.hit?.landed && this.hit.hr) || (this.camMode === 'back' && this.hit?.hr)) return POSE.SAD;
    if (this.state === 'windup' && Math.sin(A.arm) < -0.55) return POSE.UP;           // 손이 어깨보다 위
    return POSE.READY;
  }
  _batterPose(sw) {
    if (this.state === 'call' && this.game.strikes === 0) return BPOSE.SAD;           // 방금 삼진
    if (sw < 0) return BPOSE.READY;
    return sw < 0.3 ? BPOSE.START : sw < 0.62 ? BPOSE.HIT : BPOSE.FOLLOW;
  }

  _drawPitchBall(c) {
    const cam = this.cam, b = this.ball, pt = this.pitch, B = this.players[this.batSide];
    if (!pt) return;
    // 미트: 공이 가까워지면 나타남
    const near = b.z < 7 || pt.caught;
    if (near) { c.save(); if (!pt.caught) c.globalAlpha = 0.85; if (!drawMittArt(c, cam, pt.tx, pt.ty - 0.02, FIELD.CATCH_Z - 0.05, this.mittPop)) drawMitt(c, cam, pt.tx, pt.ty - 0.02, FIELD.CATCH_Z - 0.05, this.mittPop); c.restore(); }
    // 🧒 어린이 타자 도움: 공이 올 곳에 동그라미, 공이 가까워질수록 작아짐 → 딱 맞을 때 휘두르기
    const left = (pt.tArr - performance.now()) / 1000, zp = cam.proj(pt.tx, pt.ty, 0);
    if (zp && LEVELS[B.type].assist && !pt.resolved && !pt.swung && left > -0.3) {
      const rBall = FIELD.BALL_R * zp.k, r = rBall * (1.15 + Math.max(0, left) / pt.T * 4);
      const now = Math.abs(left) < 0.14;
      c.beginPath(); c.arc(zp.x, zp.y, r, 0, TAU); c.lineWidth = now ? 7 : 4; c.strokeStyle = now ? '#ffd93d' : 'rgba(255,255,255,0.85)'; c.stroke();
      c.beginPath(); c.arc(zp.x, zp.y, rBall * 1.15, 0, TAU); c.lineWidth = 2; c.strokeStyle = 'rgba(255,217,61,0.9)'; c.stroke();
      if (now) text(c, '지금!', zp.x, zp.y - r - 26 * this.ui, { size: 40 * this.ui, color: '#ffd93d' });
    }
    // 빠른 공 꼬리
    if (!pt.caught && pt.power > 0.55) {
      for (let i = 1; i <= 5; i++) {
        const t = Math.max(0, pt.t - i * 0.018);
        const q = cam.proj(pt.x0 + pt.vx * t, pt.y0 + pt.vy * t - 0.5 * pt.gy * t * t, pt.z0 + pt.vz * t);
        if (q) { c.beginPath(); c.arc(q.x, q.y, Math.max(3, FIELD.BALL_R * q.k) * (1 - i * 0.12), 0, TAU); c.fillStyle = `rgba(255,${pt.power > 0.8 ? 150 : 230},90,${0.32 - i * 0.05})`; c.fill(); }
      }
    }
    const minR = 3.2;
    if (pt.caught) {
      const q = cam.proj(b.x, b.y, b.z);
      if (q) drawBall(c, q.x, q.y + 0.03 * q.k, FIELD.BALL_R * q.k * 0.95, b.rot);
    } else drawBall3(c, cam, b.x, b.y, b.z, b.rot, minR);
  }

  _drawHitBall(c) {
    const cam = this.cam, b = this.ball, h = this.hit;
    if (!h || b.mode === 'gone' && h.landT > 0.4) return;
    // 꼬리
    if (!h.landed) {
      const g = FIELD.GRAVITY;
      c.save(); c.lineCap = 'round';
      let prev = null;
      for (let i = 0; i <= 12; i++) {
        const t = Math.max(0, h.t - i * 0.05), q = cam.proj(h.x0 + h.vx * t, h.y0 + h.vy * t - 0.5 * g * t * t, h.z0 + h.vz * t);
        if (q && prev) { c.strokeStyle = `rgba(255,${h.hr ? 170 : 240},${h.hr ? 60 : 200},${0.55 * (1 - i / 13)})`; c.lineWidth = Math.max(2, 7 * (1 - i / 13)) * this.ui; c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(q.x, q.y); c.stroke(); }
        prev = q;
      }
      c.restore();
    }
    const q = drawBall3(c, cam, b.x, b.y, b.z, b.rot, 4.5 * this.ui);
    if (q && !h.landed) {
      const dist = Math.round(Math.hypot(b.x, b.z));
      text(c, `${dist}m`, q.x, q.y - q.r - 24 * this.ui, { size: 34 * this.ui, color: '#fff', sw: 6 });
    }
  }

  // 배트 높이 표시 (어른 타자만, 높이가 중요하니까): 존 왼쪽에 작은 배트
  _drawBatGuide(c) {
    const B = this.players[this.batSide];
    if (B.cpu || LEVELS[B.type].heightK < 0.5) return;
    const zr = zoneRect(this.cam); if (!zr) return;
    const bh = this.batH[B.side], y = zr.y + zr.h - (bh - ZONE.bottom) / (ZONE.top - ZONE.bottom) * zr.h;
    const yy = clamp(y, zr.y - zr.h * 0.6, zr.y + zr.h * 1.6), x1 = zr.x - 10 * this.ui, x0 = x1 - 70 * this.ui;
    c.save(); c.globalAlpha = 0.9; c.lineCap = 'round';
    c.strokeStyle = INK; c.lineWidth = 12 * this.ui; c.beginPath(); c.moveTo(x0, yy); c.lineTo(x1, yy); c.stroke();
    c.strokeStyle = '#e8b779'; c.lineWidth = 7 * this.ui; c.stroke();
    c.setLineDash([6, 8]); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x1, yy); c.lineTo(zr.x + zr.w, yy); c.stroke();
    c.restore();
  }

  // 📱 두 사람 폰 모드: 투수 쪽 반에 '던질 곳 판' / 혼자면 존 위에 조준점
  _drawAimPad(c) {
    if (!this.touchMode || this.state !== 'windup') return;
    const P = this.players[this.pitSide];
    if (P.cpu) return;
    const pad = this._aimPad(P.side), two = this._humans().length > 1, ui = this.ui;
    if (two) {
      c.save(); c.globalAlpha = 0.9;
      rrect(c, pad.cx - pad.hw, pad.cy - pad.hh, pad.hw * 2, pad.hh * 2, 14 * ui); c.fillStyle = 'rgba(20,14,50,0.35)'; c.fill();
      c.lineWidth = 3; c.strokeStyle = P.color; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1.5; c.beginPath();
      for (let i = 1; i < 3; i++) { c.moveTo(pad.cx - pad.hw + pad.hw * 2 * i / 3, pad.cy - pad.hh); c.lineTo(pad.cx - pad.hw + pad.hw * 2 * i / 3, pad.cy + pad.hh); c.moveTo(pad.cx - pad.hw, pad.cy - pad.hh + pad.hh * 2 * i / 3); c.lineTo(pad.cx + pad.hw, pad.cy - pad.hh + pad.hh * 2 * i / 3); }
      c.stroke(); c.restore();
      text(c, '🧢 던질 곳 판', pad.cx, pad.cy - pad.hh - 22 * ui, { size: 22 * ui });
    }
    if (this.aim) {
      const { lx, ly } = this._aimToZone(this.aim), zr = zoneRect(this.cam);
      const marks = [[zr.cx + clamp(lx, -1, 1) * zr.w / 2, zr.cy - clamp(ly, -1, 1) * zr.h / 2]];
      if (two) marks.push([pad.cx + lx * pad.hw, pad.cy - ly * pad.hh]);
      for (const [x, y] of marks) {
        const r = 16 * ui;
        c.lineWidth = 4; c.strokeStyle = '#ffd93d';
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.moveTo(x - r * 1.5, y); c.lineTo(x + r * 1.5, y); c.moveTo(x, y - r * 1.5); c.lineTo(x, y + r * 1.5); c.stroke();
      }
    }
  }

  // ── 카메라 대기실: 카메라 화면 전체 + 각자 앞에 공 ──
  _drawCameraLobby(c) {
    const W = this.W, H = this.H;
    if (!this.input.drawTo(c, W, H)) { c.fillStyle = '#1b1640'; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(14,10,40,0.22)'; c.fillRect(0, 0, W, H);
    c.save(); c.setLineDash([14, 14]); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke(); c.restore();
    for (const p of this.players) {
      const cx = p.side ? W * 0.75 : W * 0.25;
      if (!p.present || !p.body.ok) {
        c.save(); c.globalAlpha = 0.55 + Math.sin(this.time * 3) * 0.15; c.setLineDash([12, 10]); c.lineWidth = 5; c.strokeStyle = '#fff';
        c.beginPath(); c.arc(cx, 300, 46, 0, TAU); c.stroke(); rrect(c, cx - 70, 360, 140, 200, 50); c.stroke(); c.restore();
        text(c, `${SIDE_LABELS[p.side]} 선수는 여기에 서요 🙋`, cx, 610, { size: 28 });
        continue;
      }
      for (let hi = 0; hi < 2; hi++) {
        const h = p.hands[hi];
        if (!h.on || (p.ready && p.hand !== hi)) continue;
        const k = 1 + Math.sin(this.time * 6) * 0.08;
        c.beginPath(); c.arc(h.x, h.y, 24 * k, 0, TAU); c.fillStyle = p.ready ? p.color : 'rgba(255,217,61,0.85)'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
      }
      text(c, `${p.type === 'kid' ? '🧒 ' : ''}${p.name}`, p.body.x, Math.max(40, p.body.headY - 24), { size: 28, color: '#fff', stroke: p.color, sw: 8 });
    }
    for (const p of this.players) {
      const x = p.side ? W * 0.75 : W * 0.25;
      if (p.ready) { const k = clamp((this.time - p.readyHitT) * 3, 0, 1); text(c, '준비 완료! ✅', x, 150 + (1 - k) * 20, { size: 40 }); continue; }
      if (!p.present) continue;
      const q = this._readyBallAt(p.side), pulse = 1 + Math.sin(this.time * 6) * 0.08;
      c.beginPath(); c.arc(q.x, q.y, 52 * pulse, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.22)'; c.fill(); c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke();
      drawBall(c, q.x, q.y, 32, this.time * 2);
      text(c, this.state === 'over' ? '한 판 더? 공을 톡!' : '던지고 칠 손으로 톡!', q.x, q.y + 78, { size: 28 });
    }
    if (this.state === 'lobby') this._pill(c, '양쪽에 한 명씩! 공을 톡 친 손 하나로 던지고 쳐요', W / 2, 44, 26);
  }

  _drawTouchReady(c) {
    const ui = this.ui;
    c.fillStyle = 'rgba(14,10,40,0.25)'; c.fillRect(0, 0, this.W, this.H);
    for (const p of this.players) {
      if (p.cpu) continue;
      const q = this._readyBallAt(p.side);
      if (p.ready) { text(c, '준비 완료! ✅', q.x, q.y, { size: 38 * ui }); continue; }
      const pulse = 1 + Math.sin(this.time * 6) * 0.08;
      c.beginPath(); c.arc(q.x, q.y, 58 * ui * pulse, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#fff'; c.stroke();
      drawBall(c, q.x, q.y, 36 * ui, this.time * 2);
      text(c, this.state === 'over' ? '한 판 더? 톡!' : `${p.name} 톡!`, q.x, q.y + 88 * ui, { size: 30 * ui });
    }
    if (this.state === 'lobby') this._pill(c, '공을 손가락으로 톡 치면 시작!', this.W / 2, 44 * ui, 26 * ui);
  }

  // 카메라 모드: 위쪽 양 구석에 각 선수 카메라 작은 창 (손 표시)
  _drawPips(c) {
    const W = this.W, w = Math.round(Math.min(220, W * 0.17)), h = Math.round(w * 9 / 8), m = 14;
    for (const p of this.players) {
      const x = p.side ? W - m - w : m, y = m;
      const role = p.side === this.batSide ? 'bat' : 'pit';
      const active = (role === 'pit' && this.state === 'windup') || (role === 'bat' && this.state === 'pitch');
      c.save();
      rrect(c, x, y, w, h, 16); c.clip();
      if (!this.input.drawHalf(c, p.side, x, y, w, h)) { c.fillStyle = '#1b1640'; c.fillRect(x, y, w, h); }
      if (!p.present) { c.fillStyle = 'rgba(14,10,40,0.6)'; c.fillRect(x, y, w, h); text(c, '🙈', x + w / 2, y + h / 2, { size: 54, stroke: null }); }
      // 던지고 치는 손
      const hd = p.hand != null ? p.hands[p.hand] : null;
      if (hd?.on && p.present) {
        const sx = (v) => x + (v - p.side * W / 2) / (SCREEN.W / 2) * w, sy = (v) => y + v / SCREEN.H * h;
        const hs = hd.hist.slice(-8);
        c.lineCap = 'round';
        for (let i = 1; i < hs.length; i++) { c.strokeStyle = `rgba(255,217,61,${i / hs.length * 0.8})`; c.lineWidth = 6 * i / hs.length + 1; c.beginPath(); c.moveTo(sx(hs[i - 1].x), sy(hs[i - 1].y)); c.lineTo(sx(hs[i].x), sy(hs[i].y)); c.stroke(); }
        c.beginPath(); c.arc(sx(hd.x), sy(hd.y), 11, 0, TAU); c.fillStyle = '#ffd93d'; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
      }
      c.restore();
      rrect(c, x, y, w, h, 16); c.lineWidth = active ? 6 + Math.sin(this.time * 8) * 2 : 4; c.strokeStyle = active ? '#ffd93d' : p.color; c.stroke();
      const label = `${role === 'bat' ? '⚾ 타자' : '🧢 투수'} ${p.name}`;
      c.font = `900 22px ${FONT}`;
      const lw = Math.min(w, c.measureText(label).width + 26);
      rrect(c, x + w / 2 - lw / 2, y + h - 18, lw, 36, 18); c.fillStyle = p.color; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
      text(c, label, x + w / 2, y + h, { size: 22, stroke: null });
    }
  }

  _drawHud(c) {
    if (this.state === 'lobby' || this.state === 'countdown' && this.stateT < 0.1) return;
    const ui = this.ui, g = this.game, W = this.W;
    const w = Math.min(560 * ui, W - 16), h = 96 * ui, x = W / 2 - w / 2, y = 10 * ui;
    rrect(c, x, y, w, h, 20 * ui); c.fillStyle = 'rgba(255,250,242,0.95)'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
    // 회
    const ix = x + 52 * ui;
    const over = this.state === 'over';
    text(c, over ? '경기' : `${Math.min(g.inning, this.innings)}회`, ix, y + h * 0.4, { size: 32 * ui, color: INK, stroke: null });
    text(c, over ? '끝' : g.half ? '▼ 말' : '▲ 초', ix, y + h * 0.75, { size: 20 * ui, color: '#7a6b8f', stroke: null });
    // 두 팀 거리
    const mx0 = x + 104 * ui, mx1 = x + w - 150 * ui;
    for (const p of this.players) {
      const ry = y + h * (p.side ? 0.7 : 0.3), bat = p.side === this.batSide && this.state !== 'over';
      c.font = `900 ${26 * ui}px ${FONT}`;
      let s = p.name; while (c.measureText(s).width > (mx1 - mx0) * 0.55 && s.length > 1) s = s.slice(0, -1);
      if (bat) drawBall(c, mx0 + 10 * ui, ry, 10 * ui, 0);
      text(c, s, mx0 + 28 * ui, ry + 1, { size: 26 * ui, color: p.color, stroke: INK, sw: 5 * ui, align: 'left' });
      text(c, `${p.score}m`, mx1, ry + 1, { size: 30 * ui, color: INK, stroke: null, align: 'right' });
    }
    // 카운트: S ●● / O ●●
    const cx = x + w - 120 * ui;
    const dots = (label, n, max, col, ry) => {
      text(c, label, cx, ry, { size: 22 * ui, color: INK, stroke: null, align: 'left' });
      for (let i = 0; i < max; i++) { c.beginPath(); c.arc(cx + (36 + i * 26) * ui, ry, 9 * ui, 0, TAU); c.fillStyle = i < n ? col : '#e4dcef'; c.fill(); c.lineWidth = 2; c.strokeStyle = INK; c.stroke(); }
    };
    dots('S', g.strikes, RULES.STRIKES - 1, '#f2a516', y + h * 0.3);
    dots('O', g.outs, RULES.OUTS - 1, '#e8414f', y + h * 0.7);
  }

  // 아래쪽 안내 한 줄 (지금 누가 뭘 하면 되는지)
  _drawGuide(c) {
    const P = this.players[this.pitSide], B = this.players[this.batSide], ui = this.ui;
    let msg = '';
    if (this.state === 'windup' && !P.cpu) {
      if (this._isTouch(P)) msg = this._humans().length > 1 ? `🧢 ${P.name}: 던질 곳 판을 누르고 휙 쓸어요!` : `🧢 던질 곳을 누르고 휙 쓸어요! (빠를수록 빠른 공)`;
      else msg = `🧢 ${P.name}: 팔을 휙 휘둘러 던져요! (높이·방향으로 코스가 바뀌어요)`;
      if (this.stateT > RULES.WINDUP_HINT_SEC) msg = `⏰ ${Math.ceil(RULES.WINDUP_AUTO_SEC - this.stateT)}초 뒤에 자동으로 살살 던져요`;
    } else if (this.state === 'windup' && P.cpu && !B.cpu) msg = `⚾ ${B.name} 준비! 🤖 컴퓨터가 던져요`;
    else if (this.state === 'pitch' && !B.cpu && !this.pitch?.swung) {
      if (this._isTouch(B)) msg = this._humans().length > 1 ? `⚾ ${B.name}: 공이 오면 내 쪽 화면을 톡! (옆으로 휙 = 세게)` : '⚾ 공이 오면 공 높이를 톡! (옆으로 휙 쓸면 세게)';
      else msg = LEVELS[B.type].assist ? `⚾ ${B.name}: 공이 동그라미에 들어올 때 휘둘러요!` : `⚾ ${B.name}: 공이 오면 휘둘러요!`;
    }
    const hudB = 10 * ui + 96 * ui;
    if (msg) this._pill(c, msg, this.W / 2, hudB + 34 * ui, 24 * ui);
    else if (this.state === 'windup' || this.state === 'change') text(c, `${this.innings}회까지 · 날아간 거리 합계로 승부`, this.W / 2, hudB + 20 * ui, { size: 18 * ui, color: '#fff', sw: 5 });
  }

  _pill(c, msg, x, y, size) {
    c.font = `900 ${size}px ${FONT}`;
    const w = Math.min(c.measureText(msg).width + size * 1.7, this.W - 12), h = size * 1.9;
    rrect(c, x - w / 2, y - h / 2, w, h, h / 2); c.fillStyle = 'rgba(255,250,242,0.94)'; c.fill(); c.lineWidth = 4; c.strokeStyle = INK; c.stroke();
    text(c, msg, x, y + 1, { size, color: INK, stroke: null });
  }

  _drawFx(c) {
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const a = 1 - f.t / f.life;
      if (f.k === 'ring') {
        c.beginPath(); c.arc(f.x, f.y, lerp(f.r0, f.r1, f.t / f.life), 0, TAU);
        c.globalAlpha = a; c.lineWidth = 6 * a + 1; c.strokeStyle = f.color; c.stroke(); c.globalAlpha = 1;
      } else if (f.k === 'dot') {
        c.globalAlpha = a; c.fillStyle = f.color; c.beginPath(); c.arc(f.x, f.y, f.r, 0, TAU); c.fill(); c.globalAlpha = 1;
      } else if (f.k === 'flash') {
        const k = f.t / f.life;
        c.beginPath(); c.arc(f.x, f.y, lerp(f.r0, f.r1, Math.sqrt(k)), 0, TAU);
        c.fillStyle = `rgba(255,255,240,${0.9 * (1 - k)})`; c.fill();
      } else if (f.k === 'spark') {
        c.globalAlpha = a; c.strokeStyle = f.color; c.lineWidth = f.w; c.lineCap = 'round';
        c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x - f.vx * 0.04, f.y - f.vy * 0.04); c.stroke(); c.globalAlpha = 1;
      } else if (f.k === 'line') {
        const k = f.t / f.life, r0 = lerp(f.r0, f.r1, k * 0.6), r1 = lerp(f.r0, f.r1, Math.min(1, k + 0.4));
        c.globalAlpha = a; c.strokeStyle = '#fff'; c.lineWidth = 4 * a + 1; c.lineCap = 'round';
        c.beginPath(); c.moveTo(f.x + Math.cos(f.a) * r0, f.y + Math.sin(f.a) * r0); c.lineTo(f.x + Math.cos(f.a) * r1, f.y + Math.sin(f.a) * r1); c.stroke(); c.globalAlpha = 1;
      } else if (f.k === 'conf') {
        c.save(); c.translate(f.x, f.y); c.rotate(f.rot); c.globalAlpha = Math.min(1, a * 2);
        c.fillStyle = f.color; c.fillRect(-f.r, -f.r * 0.45, f.r * 2, f.r * 0.9); c.restore();
      } else if (f.k === 'fw') {
        const k = f.t / f.life, rr = f.r * Math.sqrt(k);
        c.globalAlpha = clamp(1.4 - k * 1.4, 0, 1); c.fillStyle = f.col;
        for (let i = 0; i < f.n; i++) { const an = i / f.n * TAU; c.beginPath(); c.arc(f.x + Math.cos(an) * rr, f.y + Math.sin(an) * rr + k * k * 40, 4 * (1 - k * 0.6) * this.ui, 0, TAU); c.fill(); }
        c.globalAlpha = 1;
      }
    }
    for (const p of this.pops) {
      const k = p.t / p.life, s = k < 0.15 ? 0.6 + k / 0.15 * 0.5 : 1.1 - Math.min(0.1, (k - 0.15));
      c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      text(c, p.text, p.x, p.y - k * 40, { size: Math.round(p.size * s), color: p.color });
      c.globalAlpha = 1;
    }
  }

  _drawOverlays(c) {
    const W = this.W, H = this.H, ui = this.ui;
    if (this.state === 'countdown' && !this.frozen) {
      const left = Math.ceil(RULES.COUNTDOWN_SEC - this.stateT), f = this.stateT % 1;
      text(c, String(Math.max(1, left)), W / 2, H / 2 - 30, { size: Math.round(190 * ui * (1.25 - f * 0.25)), color: '#ffd93d', sw: 18 });
      if (left <= 1) text(c, '플레이 볼!', W / 2, H / 2 + 110 * ui, { size: 56 * ui, color: '#fff', sw: 10 });
    }
    const bn = this.banner;
    if (bn) {
      const k = bn.t / bn.life, a = k < 0.12 ? k / 0.12 : k > 0.82 ? (1 - k) / 0.18 : 1, s = k < 0.12 ? 0.7 + k / 0.12 * 0.3 : 1;
      c.globalAlpha = clamp(a, 0, 1);
      const yy = H * (bn.y ?? (bn.big ? 0.36 : 0.34));
      text(c, bn.title, W / 2, yy, { size: Math.round((bn.big ? 96 : 66) * s * ui), color: '#fff', stroke: bn.color, sw: (bn.big ? 18 : 13) * ui });
      if (bn.sub) text(c, bn.sub, W / 2, yy + (bn.big ? 84 : 62) * ui, { size: (bn.big ? 44 : 30) * ui, color: '#fff', sw: 7 * ui });
      c.globalAlpha = 1;
    }
    if (this.frozen === 'absent') {
      c.fillStyle = 'rgba(14,11,34,0.6)'; c.fillRect(0, 0, W, H);
      text(c, '⏸ 잠깐 멈춤', W / 2, H * 0.28, { size: 40, color: '#ffd93d' });
      if (this.missing.length) {
        text(c, '🙈', W / 2, H * 0.43, { size: 90, stroke: null });
        text(c, this.missing.map((s) => `${this.players[s].name} 선수가 안 보여요`).join(' · '), W / 2, H * 0.58, { size: 38 });
        text(c, `화면 ${this.missing.map((s) => SIDE_LABELS[s]).join('·')} 반쪽 안에 서 주세요`, W / 2, H * 0.67, { size: 28 });
      } else text(c, '좋아요! 곧 다시 시작해요', W / 2, H / 2, { size: 44, color: '#ffd93d' });
    }
  }

  _drawDebug(c) {
    const v = this.input, ls = this.lastSwing;
    const lines = [
      `화면 ${this.fps.toFixed(0)}fps · 상태 ${this.state}${this.frozen ? `(${this.frozen})` : ''} · ${this.W}×${this.H}`,
      v ? `인식 ${v.fps.toFixed(0)}fps · ${v.ms.toFixed(0)}ms · ${v.delegate} · ${v.threaded ? '워커' : '메인'} · ${v.FW}×${v.FH}` : (this.touchMode ? '폰 모드' : '카메라 없음'),
      `손 속도(어깨폭/초): ${this.players.map((p) => `${p.name}=${p.hand != null ? p.hands[p.hand].sp.toFixed(1) : '-'}`).join(' ')}`,
      ls ? `마지막 스윙: 타이밍 ${ls.e >= 0 ? '+' : ''}${ls.e.toFixed(2)}초 (맞는 범위 -${ls.late.toFixed(2)}~+${ls.early.toFixed(2)}) · 높이차 ${ls.d.toFixed(2)} · 힘 ${ls.power.toFixed(2)}` : '마지막 스윙: -',
    ];
    c.font = `700 16px ${FONT}`;
    rrect(c, 8, this.H - 120, 600, 108, 10); c.fillStyle = 'rgba(0,0,0,0.6)'; c.fill();
    lines.forEach((l, i) => text(c, l, 18, this.H - 100 + i * 24, { size: 16, align: 'left', stroke: null, weight: 700 }));
  }
}
