// 카메라 + 좌우 반쪽 자세 인식 연결
// 무거운 인식은 별도 처리(Web Worker)에서 돌리고, 여기서는 카메라 화면 그리기와 결과 전달만 → 게임 화면이 끊기지 않음
// 워커를 못 쓰는 브라우저에서는 같은 코드(pose-core.js)를 화면 쪽에서 그대로 실행
// 개인정보: 카메라 영상은 이 기기의 메모리 안에서만 처리되고, 저장·전송되지 않습니다.
import { SCREEN, QUALITY, PATHS } from './config.js';
import { DuoPoseCore } from './pose-core.js';

const abs = (p) => new URL(p, document.baseURI).href;

export class DuoVision {
  constructor({ quality = 'high', mirror = true } = {}) {
    this.kind = 'camera';
    this.W = SCREEN.W; this.H = SCREEN.H;
    this.mirror = mirror;
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true; this.video.setAttribute('playsinline', '');
    this.stream = null; this.running = false;
    this.sides = [null, null];     // 최신 결과: Float32Array(33×3), 화면 좌표(px)
    this.seenAt = [0, 0];
    this.listeners = new Set();
    this.ms = 0; this.fps = 0; this._fpsT = performance.now(); this._fpsN = 0;
    this.delegate = '-'; this.threaded = false;
    this.worker = null; this.core = null; this.busy = false; this.fid = 0;
    this.cpuFallback = false; this.gotResult = false; this.firstSent = 0;
    this.useWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
      && typeof createImageBitmap === 'function' && !/[?&]noworker/.test(location.search);
    this.setQuality(quality);
  }

  setQuality(q) {
    const p = QUALITY[q] || QUALITY.high;
    this.quality = QUALITY[q] ? q : 'high';
    this.FW = p.w; this.FH = p.h; this.poseKind = p.pose;
    this.small = document.createElement('canvas'); this.small.width = this.FW; this.small.height = this.FH;
    this.sctx = this.small.getContext('2d');
    this._killWorker(); this.core = null; this.engineReady = false;
  }

  _cfg() {
    return {
      frameW: this.FW, frameH: this.FH,
      bundleUrl: abs(PATHS.BUNDLE), wasmBase: abs(PATHS.WASM).replace(/\/$/, ''),
      poseModel: abs(PATHS.POSE_MODELS[this.poseKind]),
      forceCpu: this.cpuFallback || /[?&]cpu\b/.test(location.search), // 그래픽 가속이 말썽이면 CPU로 (?cpu 로 강제)
    };
  }

  async init(progress) {
    if (this.engineReady) return;
    this.gotResult = false; this.firstSent = 0;
    if (this.useWorker) {
      try { await this._initWorker(progress); this.threaded = true; this.engineReady = true; return; }
      catch (e) { console.warn('별도 처리(워커) 사용 불가 → 화면 쪽에서 처리', e); this._killWorker(); }
    }
    this.core = new DuoPoseCore(this._cfg());
    const info = await this.core.init(progress);
    this.delegate = info.delegate; this.threaded = false; this.engineReady = true;
  }

  _initWorker(progress) {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./pose-worker.js', import.meta.url));
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('worker init timeout')), 90000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') progress?.(m.msg);
        else if (m.type === 'ready') { clearTimeout(timer); this.delegate = m.info.delegate; w.onmessage = (ev) => this._apply(ev.data); resolve(); }
        else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
      };
      w.onerror = (ev) => { clearTimeout(timer); ev.preventDefault?.(); reject(new Error(ev.message || 'worker error')); };
      w.postMessage({ type: 'init', cfg: this._cfg() });
    });
  }

  _fallbackToCpu() {
    console.warn('그래픽 가속 응답 없음 → CPU로 전환');
    this.cpuFallback = true;
    this._killWorker(); this.core = null; this.engineReady = false;
    this.init().catch((e) => console.warn('CPU 전환 실패', e));
  }

  _killWorker() { try { this.worker?.terminate(); } catch { /* noop */ } this.worker = null; this.busy = false; }

  static async listCameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId); } catch { return []; }
  }

  async startCamera({ deviceId = null, facing = 'environment' } = {}) {
    this.stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no-camera-api'), { name: 'NotSupportedError' });
    const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = { ideal: facing };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    const st = this.stream.getVideoTracks()[0]?.getSettings?.() || {};
    this.deviceId = st.deviceId || deviceId;
    this.facing = st.facingMode || facing;
    this.running = true; this.busy = false;
    this._loop();
  }

  stopCamera() {
    this.running = false;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    this.video.srcObject = null;
    this.sides = [null, null];
  }

  get hasVideo() { return this.running && this.video.videoWidth > 0; }

  // 16:9 로 가운데 잘라낼 영역 (cover)
  _crop() {
    const v = this.video, tr = this.W / this.H, vr = v.videoWidth / v.videoHeight;
    let sx = 0, sy = 0, sw = v.videoWidth, sh = v.videoHeight;
    if (vr > tr) { sw = sh * tr; sx = (v.videoWidth - sw) / 2; } else { sh = sw / tr; sy = (v.videoHeight - sh) / 2; }
    return [sx, sy, sw, sh];
  }

  // 게임 화면 배경으로 카메라 영상 그리기 (거울 반전)
  drawTo(ctx, W, H) {
    if (!this.hasVideo) return false;
    const [sx, sy, sw, sh] = this._crop();
    ctx.save();
    if (this.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();
    return true;
  }

  // 한 사람 쪽(반쪽) 영상만 작은 창에 그리기 — side 0 = 화면 왼쪽 사람 (거울 반전 반영)
  drawHalf(ctx, side, dx, dy, dw, dh) {
    if (!this.hasVideo) return false;
    const [sx, sy, sw, sh] = this._crop(), hw = sw / 2;
    const srcX = this.mirror ? (side === 0 ? sx + hw : sx) : (side === 0 ? sx : sx + hw);
    ctx.save();
    if (this.mirror) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1); ctx.drawImage(this.video, srcX, sy, hw, sh, 0, 0, dw, dh); }
    else ctx.drawImage(this.video, srcX, sy, hw, sh, dx, dy, dw, dh);
    ctx.restore();
    return true;
  }

  onUpdate(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { this._process(); this._loop(); });
    else requestAnimationFrame(() => { if (v.currentTime !== this._lastVT) { this._lastVT = v.currentTime; this._process(); } this._loop(); });
  }

  _process() {
    const v = this.video;
    if (!this.running || !v.videoWidth || !this.engineReady) return;
    // 그래픽 가속(GPU)으로 10초 넘게 결과가 하나도 안 오면 → CPU로 다시 준비 (일부 기기 대비)
    if (!this.gotResult && this.firstSent && !this.cpuFallback && /GPU/.test(this.delegate) && performance.now() - this.firstSent > 10000) {
      this._fallbackToCpu(); return;
    }
    // 이전 프레임을 아직 처리 중이면 이번 프레임은 건너뜀 (밀리지 않게)
    if (this.busy) { if (performance.now() - this.busySince < (this.worker ? 4000 : 1500)) return; this.busy = false; }
    const [sx, sy, sw, sh] = this._crop();
    const c = this.sctx;
    c.save(); c.globalCompositeOperation = 'copy';
    if (this.mirror) { c.translate(this.FW, 0); c.scale(-1, 1); }
    c.drawImage(v, sx, sy, sw, sh, 0, 0, this.FW, this.FH);
    c.restore();
    this.busy = true; this.busySince = performance.now();
    if (!this.firstSent) this.firstSent = this.busySince;
    if (this.worker) {
      createImageBitmap(this.small).then((bmp) => {
        if (!this.worker || !this.running) { bmp.close(); this.busy = false; return; }
        this.worker.postMessage({ type: 'frame', id: ++this.fid, bitmap: bmp }, [bmp]);
      }, () => { this.busy = false; });
    } else {
      try { this._apply({ type: 'result', ...this.core.process(this.small) }); } catch (e) { console.warn(e); this.busy = false; }
    }
  }

  _apply(r) {
    if (r?.type !== 'result') return;
    this.busy = false;
    if (!this.running) return;
    this.gotResult = true;
    const now = performance.now();
    for (let s = 0; s < 2; s++) {
      const a = r.sides?.[s];
      if (a) {
        for (let i = 0; i < a.length; i += 3) { a[i] *= this.W; a[i + 1] *= this.H; }
        this.sides[s] = a; this.seenAt[s] = now;
      } else this.sides[s] = null;
    }
    this.ms = r.ms || 0;
    this._fpsN++;
    if (now - this._fpsT > 1000) { this.fps = this._fpsN * 1000 / (now - this._fpsT); this._fpsN = 0; this._fpsT = now; }
    for (const fn of this.listeners) { try { fn(now); } catch (e) { console.warn(e); } }
  }

  destroy() { this.stopCamera(); this._killWorker(); this.listeners.clear(); }
}
