// 야구 효과음 — 기본 소리 엔진(직접 합성, 음원 파일 없음)에 야구 소리를 더함
import { Sound } from './audio.js';

export class BallSound extends Sound {
  _noise(dur, { type = 'bandpass', freq = 1800, q = 1.2, vol = 0.4, when = 0, slideTo = null } = {}) {
    if (!this.ctx || !this.noise) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  }

  // 배트에 맞는 '딱!' — 날카로운 나무 소리 + 묵직한 울림 (세게 맞을수록 크고 맑게)
  crack(q = 0.5) {
    this.sfx(() => {
      this._noise(0.035, { type: 'highpass', freq: 2400, q: 0.7, vol: 0.55 + q * 0.35 });
      this.tone(1650 + q * 600, 0.07, { type: 'triangle', vol: 0.28 + q * 0.2, slide: 900 });
      this.tone(420, 0.09, { type: 'square', vol: 0.08 + q * 0.06, slide: 260 });
      this.tone(120, 0.18, { type: 'sine', vol: 0.45 + q * 0.25, slide: 55 });
    });
  }
  // 포수 미트 '팡!'
  mitt() {
    this.sfx(() => {
      this._noise(0.09, { type: 'lowpass', freq: 1300, q: 0.8, vol: 0.6 });
      this.tone(170, 0.12, { type: 'sine', vol: 0.5, slide: 70 });
    });
  }
  // 헛스윙 '휙'
  whoosh(power = 0.5) { this.sfx(() => this._noise(0.22 + power * 0.1, { type: 'bandpass', freq: 500, slideTo: 2600, q: 0.9, vol: 0.18 + power * 0.2 })); }
  // 던지는 소리 '슉'
  throwBall(power = 0.5) { this.sfx(() => this._noise(0.16, { type: 'bandpass', freq: 900, slideTo: 3000, q: 1.1, vol: 0.12 + power * 0.15 })); }
  strike() { this.sfx(() => { this.tone(784, 0.12, { type: 'square', vol: 0.12 }); this.tone(587, 0.2, { type: 'square', vol: 0.12, when: 0.12 }); }); }
  out() { this.sfx(() => [523, 392, 330, 262].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.22, when: i * 0.1 }))); }
  land() { this.sfx(() => { this.tone(200, 0.08, { type: 'sine', vol: 0.3, slide: 90 }); this._noise(0.06, { type: 'lowpass', freq: 700, vol: 0.2 }); }); }
  meters() { this.sfx(() => [659, 880].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.2, when: i * 0.08 }))); }
  change() { this.sfx(() => [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { type: 'square', vol: 0.08, when: i * 0.09 }))); }
  ready() { this.sfx(() => { this.tone(880, 0.1, { type: 'triangle', vol: 0.22 }); this.tone(1320, 0.16, { type: 'triangle', vol: 0.18, when: 0.08 }); }); }
  cheer(big = false) {
    this.sfx(() => {
      // 관중 '와~' (잡음을 부풀렸다 줄임)
      const t = this.ctx.currentTime, len = big ? 2.4 : 1.3;
      for (let i = 0; i < 3; i++) {
        const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + i * 450; f.Q.value = 0.9;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(big ? 0.2 : 0.12, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + len + 0.1);
      }
    });
  }
  homerun() {
    this.cheer(true);
    this.sfx(() => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', vol: 0.22, when: 0.15 + i * 0.11 })));
  }
  firework() { this.sfx(() => { this._noise(0.4, { type: 'lowpass', freq: 1600, slideTo: 200, vol: 0.35 }); this.tone(90, 0.3, { type: 'sine', vol: 0.3, slide: 40 }); }); }
}
