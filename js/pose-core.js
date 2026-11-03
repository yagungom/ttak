// 좌우 반쪽 자세 인식 — 화면을 반으로 나눠 왼쪽·오른쪽에서 각각 '한 명만' 찾음
//  · 자세 인식(Pose Landmarker)을 두 개 띄워 왼쪽 반, 오른쪽 반을 따로 봄 → 한쪽에 두 명이 서도 한 명만 선수로 잡힘
//  · 반쪽씩 보니 사람이 화면에서 더 크게 보여 손 위치가 더 정확함
//  · 메인 화면과 워커(별도 처리)에서 같이 씀
// 개인정보: 영상 프레임은 이 기기 안에서만 처리되고 저장·전송되지 않습니다.

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

async function withGpuFallback(create, forceCpu = false) {
  if (forceCpu) return { task: await create('CPU'), delegate: 'CPU' };
  try { return { task: await create('GPU'), delegate: 'GPU' }; }
  catch (e) { console.warn('GPU 가속 불가, CPU로 전환', e); return { task: await create('CPU'), delegate: 'CPU' }; }
}

export const N_LM = 33;

export class DuoPoseCore {
  // o: { frameW, frameH, bundleUrl, wasmBase, poseModel, forceCpu }
  constructor(o) {
    Object.assign(this, o);
    this.halfW = Math.floor(o.frameW / 2);
    this.cv = [makeCanvas(this.halfW, o.frameH), makeCanvas(this.halfW, o.frameH)];
    this.ctx = this.cv.map((c) => c.getContext('2d'));
    this.lastTs = [-1, -1];
    this.ms = 0;
    this.posers = [null, null];
  }

  async init(progress) {
    progress?.('사람 인식 엔진 불러오는 중… (처음 한 번만 조금 걸려요)');
    const mod = await import(this.bundleUrl);
    const fileset = await mod.FilesetResolver.forVisionTasks(this.wasmBase);
    const make = () => withGpuFallback((delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.poseModel, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.45, minPosePresenceConfidence: 0.45, minTrackingConfidence: 0.45,
      outputSegmentationMasks: false,
    }), this.forceCpu);
    progress?.('왼쪽 선수 인식 준비 중…');
    const a = await make();
    progress?.('오른쪽 선수 인식 준비 중…');
    const b = await make();
    this.posers = [a.task, b.task];
    return { delegate: a.delegate === b.delegate ? a.delegate : `${a.delegate}/${b.delegate}` };
  }

  // src: 이미 좌우반전·16:9로 잘린 프레임 (frameW×frameH)
  // 반환: sides[0|1] = Float32Array(33×3) [x, y, visibility] — x·y 는 '전체 화면' 기준 0~1
  process(src) {
    const t0 = performance.now();
    const sides = [null, null];
    const { halfW, frameH } = this;
    for (let s = 0; s < 2; s++) {
      const c = this.ctx[s];
      c.drawImage(src, s * halfW, 0, halfW, frameH, 0, 0, halfW, frameH);
      let ts = performance.now(); if (ts <= this.lastTs[s]) ts = this.lastTs[s] + 1; this.lastTs[s] = ts;
      try {
        this.posers[s].detectForVideo(this.cv[s], ts, (res) => {
          const lm = res.landmarks?.[0];
          if (!lm || lm.length < N_LM) return;
          const out = new Float32Array(N_LM * 3);
          for (let i = 0; i < N_LM; i++) {
            out[i * 3] = (s + lm[i].x) * 0.5; // 반쪽 좌표 → 전체 화면 좌표
            out[i * 3 + 1] = lm[i].y;
            out[i * 3 + 2] = lm[i].visibility ?? 1;
          }
          sides[s] = out;
        });
      } catch (e) { console.warn('pose error', e); }
    }
    this.ms = this.ms * 0.85 + (performance.now() - t0) * 0.15;
    return { sides, ms: this.ms };
  }
}
