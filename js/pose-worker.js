// 별도 처리(Web Worker): 무거운 자세 인식 2개를 여기서 돌려 게임 화면이 끊기지 않게
// 일반(classic) 워커로 띄움 → MediaPipe 가 엔진 파일을 importScripts 로 불러올 수 있음
let core = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const { DuoPoseCore } = await import('./pose-core.js');
      core = new DuoPoseCore(m.cfg);
      const info = await core.init((msg) => self.postMessage({ type: 'progress', msg }));
      self.postMessage({ type: 'ready', info });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  } else if (m.type === 'frame' && core) {
    let r;
    try { r = core.process(m.bitmap); } catch (err) { r = { sides: [null, null], error: String(err?.message || err) }; }
    try { m.bitmap.close(); } catch { /* noop */ }
    const transfer = [];
    for (const s of r.sides || []) if (s) transfer.push(s.buffer);
    self.postMessage({ type: 'result', id: m.id, ...r }, transfer);
  }
};
