// 딱! 홈런 — 화면 흐름 담당
import { $, $$, store } from './util.js';
import * as fs from './fullscreen.js';
import { BaseballEngine } from './game.js';
import { BallSound } from './sound.js';
import { DuoVision } from './duo-vision.js';
import { LEVELS, RULES, QUALITY, DISPLAY_LAG, SCREEN } from './config.js';

const params = new URLSearchParams(location.search);
const canvas = $('#game');
const sound = new BallSound();
const engine = new BaseballEngine(canvas, sound);
const forceTouch = params.has('mouse') || params.has('touch'); // PC 확인용: 폰 모드로 마우스 플레이
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── 설정 (이 기기에만 저장) ──
const DEFAULTS = {
  play: 'camera', names: ['', ''], types: ['adult', 'kid'], innings: RULES.DEFAULT_INNINGS,
  facing: 'environment', cameraId: '', mirror: true, sfx: true, bgm: true, quality: 'high', debug: false, lag: 'normal',
};
const settings = { ...DEFAULTS, ...store.get('ttak.settings.v1', {}) };
if (!Array.isArray(settings.names) || settings.names.length !== 2) settings.names = ['', ''];
if (!Array.isArray(settings.types) || settings.types.length !== 2 || !settings.types.every((t) => LEVELS[t])) settings.types = [...DEFAULTS.types];
if (!RULES.INNINGS.includes(settings.innings)) settings.innings = RULES.DEFAULT_INNINGS;
if (!QUALITY[settings.quality]) settings.quality = 'high';
if (!DISPLAY_LAG[settings.lag]) settings.lag = 'normal';
if (settings.play !== 'touch') settings.play = 'camera';
if (forceTouch) settings.play = 'touch';
const saveSettings = () => store.set('ttak.settings.v1', settings);
const applySettings = () => {
  sound.sfxOn = settings.sfx; sound.bgmOn = settings.bgm;
  engine.debug = settings.debug || params.has('debug');
  engine.setDisplayLag(DISPLAY_LAG[settings.lag].sec);
  if (vision) vision.mirror = settings.mirror;
};

let vision = null;
let wakeLock = null;
let loadCancelled = false;

function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('on', s.id === `scr-${name}`));
  document.body.dataset.screen = name;
  checkRotate();
}

// 이름: 화면에만 쓰고(글자로만 출력) 이 기기에만 저장. 꺾쇠·제어문자 제거, 6글자
const cleanName = (s, side) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 6) || (side ? '2P' : '1P');
// 카메라 모드는 둘이 좌우로만 → 컴퓨터로 골라 둔 쪽은 어른으로
const playTypes = () => settings.types.map((t) => (settings.play === 'camera' && t === 'cpu' ? 'adult' : t));
const hasHuman = () => playTypes().some((t) => t !== 'cpu');
const isTouchPlay = () => settings.play === 'touch' && hasHuman();
const needsCamera = () => settings.play === 'camera';

// ── 시작 화면 ──
function renderSetup() {
  document.body.dataset.play = settings.play;
  const types = playTypes();
  for (let s = 0; s < 2; s++) {
    $(`#name${s}`).value = settings.names[s] || '';
    $$(`.seg[data-side="${s}"] .seg-btn`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === types[s])));
  }
  $$('#inn-row .seg-btn').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.inn) === settings.innings)));
  $$('#play-row .seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.play === settings.play)));
  $$('#facing-row .seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.facing === settings.facing)));
  const cam = needsCamera();
  $('#facing-row').hidden = !cam; $('#facing-lbl').hidden = !cam;
  $('#btn-start').textContent = hasHuman() ? '플레이 볼!' : '🤖 컴퓨터끼리 구경하기';
  applyLayout();
}
for (let s = 0; s < 2; s++) {
  $$(`.seg[data-side="${s}"] .seg-btn`).forEach((b) => b.addEventListener('click', () => { settings.types[s] = b.dataset.type; saveSettings(); renderSetup(); }));
  $(`#name${s}`).addEventListener('change', (e) => { settings.names[s] = e.target.value.trim().slice(0, 6); saveSettings(); });
}
$$('#inn-row .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.innings = Number(b.dataset.inn); saveSettings(); renderSetup(); }));
$$('#play-row .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.play = b.dataset.play; saveSettings(); renderSetup(); }));
$$('#facing-row .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.facing = b.dataset.facing; settings.cameraId = ''; saveSettings(); renderSetup(); }));

// ── 화면 채우기 ──
//  📱 폰 모드: 폰 화면 전체를 씀 (가로·세로 모두, 게임 화면비도 폰에 맞춤)
//  📺 카메라 모드: TV 미러링용 16:9 고정
const stageEl = $('#stage');
function applyLayout() {
  const fill = engine.input ? false : settings.play === 'touch';
  document.body.classList.toggle('fill', fill);
  let W = SCREEN.W, H = SCREEN.H;
  if (fill) {
    const r = stageEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const a = clamp(r.width / r.height, 0.42, 2.4); // 짧은 쪽 = 720
      if (a >= 1) { H = 720; W = 720 * a; } else { W = 720; H = 720 / a; }
    }
  }
  engine.resize(W, H);
  checkRotate();
}
let layoutRaf = 0;
function queueLayout() { cancelAnimationFrame(layoutRaf); layoutRaf = requestAnimationFrame(applyLayout); }
window.addEventListener('resize', queueLayout);
window.visualViewport?.addEventListener('resize', queueLayout);
window.addEventListener('orientationchange', () => setTimeout(applyLayout, 250));

function goTitle() {
  loadCancelled = true;
  if (vision) vision.stopCamera(); // 카메라는 쓰지 않을 때 바로 끔
  engine.setInput(null);
  engine.disableTouch();
  sound.stopBgm();
  releaseWake();
  engine.startDemo();             // 뒤에서 컴퓨터끼리 시범 경기
  renderSetup();
  show('title');
}

$('#btn-start').addEventListener('click', () => startGame());

async function startGame() {
  for (let s = 0; s < 2; s++) settings.names[s] = $(`#name${s}`).value.trim().slice(0, 6);
  saveSettings();
  sound.unlock();
  enterFullscreen();
  requestWake();
  engine.stop();
  engine.setPlayers(playTypes().map((type, s) => ({ type, name: cleanName(settings.names[s], s) })));
  engine.setInnings(settings.innings);
  if (!needsCamera()) {
    if (vision) vision.stopCamera();
    engine.setInput(null);
    if (isTouchPlay()) engine.enableTouch(); else engine.disableTouch();
    applyLayout();
    enterLobby();
    return;
  }
  engine.disableTouch();
  loadCancelled = false;
  show('loading'); $('#loading-text').textContent = '카메라 켜는 중… (권한을 허용해 주세요)';
  try {
    if (!vision) vision = new DuoVision({ quality: settings.quality, mirror: settings.mirror });
    vision.mirror = settings.mirror;
    try { await vision.startCamera({ deviceId: settings.cameraId || null, facing: settings.facing }); }
    catch (e) {
      if (!settings.cameraId || e?.name === 'NotAllowedError') throw e;
      settings.cameraId = ''; saveSettings(); // 저장된 카메라가 없어졌으면 앞/뒤 기준으로 다시
      await vision.startCamera({ facing: settings.facing });
    }
    if (loadCancelled) { vision.stopCamera(); return; }
    await vision.init((msg) => { $('#loading-text').textContent = msg; });
    if (loadCancelled) { vision.stopCamera(); return; }
    engine.setInput(vision);
    applyLayout();
    enterLobby();
  } catch (e) {
    console.warn(e);
    if (vision) vision.stopCamera();
    if (!loadCancelled) showCamError(e);
  }
}

function showCamError(e) {
  const name = e?.name || '';
  let title = '카메라를 켤 수 없어요', msg = '';
  if (name === 'NotAllowedError' || name === 'SecurityError') { title = '카메라 권한이 필요해요'; msg = '주소창 옆 자물쇠 → 권한 → 카메라 허용 후 다시 시도해 주세요. 영상은 이 기기 밖으로 나가지 않아요.'; }
  else if (name === 'NotFoundError' || name === 'OverconstrainedError') { msg = '카메라를 찾지 못했어요. 시작 화면에서 후면/전면을 바꾸거나 📱 폰 모드로 해 보세요.'; settings.cameraId = ''; saveSettings(); }
  else if (name === 'NotReadableError') msg = '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.';
  else if (!window.isSecureContext) msg = '카메라는 https 주소에서만 켜져요.';
  else msg = '사람 인식 엔진을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.';
  $('#camerr-title').textContent = title; $('#camerr-text').textContent = msg;
  show('camerr');
}
$('#btn-cancel-load').addEventListener('click', () => goTitle());
$('#btn-cam-retry').addEventListener('click', () => startGame());
$('#btn-cam-home').addEventListener('click', () => goTitle());

// ── 대기실 ──
function enterLobby() {
  engine.enterLobby();
  $('#btn-cam-switch').hidden = !engine.input;
  show('lobby');
  sound.stopBgm();
}
$('#btn-go').addEventListener('click', () => { sound.unlock(); engine.startCountdown(); });
$('#btn-lobby-home').addEventListener('click', () => goTitle());

// 카메라 바꾸기: 누를 때마다 다음 카메라 (광각 렌즈 등)
let toastTimer = 0;
function toast(msg) {
  const t = $('#cam-toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
const FRONT_RE = /front|user|전면|facetime/i, BACK_RE = /back|rear|environment|후면/i;
$('#btn-cam-switch').addEventListener('click', async () => {
  if (!vision || engine.input !== vision) return;
  const cams = await DuoVision.listCameras();
  if (cams.length < 2) { toast('바꿀 수 있는 카메라가 하나뿐이에요'); return; }
  const i = cams.findIndex((c) => c.deviceId === vision.deviceId);
  const next = cams[(i + 1) % cams.length];
  try {
    await vision.startCamera({ deviceId: next.deviceId });
    settings.cameraId = next.deviceId;
    if (vision.facing === 'user' || FRONT_RE.test(next.label)) settings.facing = 'user';
    else if (vision.facing === 'environment' || BACK_RE.test(next.label)) settings.facing = 'environment';
    saveSettings();
    const n = (i + 1) % cams.length + 1;
    toast(`📷 카메라 ${n}/${cams.length}${next.label ? ` · ${next.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')}` : ''}`);
  } catch (e) {
    console.warn(e);
    try { await vision.startCamera({ facing: settings.facing }); } catch { showCamError(e); }
  }
});

// ── 경기 ──
engine.on('countdown', () => { show('play'); sound.startBgm(5, 116); });
engine.on('over', (r) => {
  sound.stopBgm();
  $('#res-title').textContent = r.winner < 0 ? '🤝 무승부!' : `🏆 ${r.names[r.winner]} 승리!`;
  $('#res-name0').textContent = r.names[0];
  $('#res-name1').textContent = r.names[1];
  $('#res-score').textContent = `${r.scores[0]}m : ${r.scores[1]}m`;
  const best = r.longest[0] >= r.longest[1] ? 0 : 1;
  const hr = r.hrs[0] + r.hrs[1];
  $('#res-stats').textContent = r.longest[best] > 0 ? `제일 멀리: ${r.names[best]} ${r.longest[best]}m${hr ? ` · 홈런 ${hr}개` : ''}` : '다음엔 꼭 쳐 봐요!';
  setTimeout(() => { if (engine.state === 'over') show('result'); }, 900);
});
engine.on('retry', () => show('play'));

$('#btn-retry').addEventListener('click', () => { sound.unlock(); engine.startCountdown(); });
$('#btn-home').addEventListener('click', () => goTitle());
$('#btn-pause').addEventListener('click', () => { engine.pause(); sound.stopBgm(); show('pause'); });
$('#btn-resume').addEventListener('click', () => { engine.resume(); sound.startBgm(5, 116); show('play'); });
$('#btn-quit').addEventListener('click', () => goTitle());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (engine.active) { engine.pause(); sound.stopBgm(); show('pause'); } }
  else if (engine.input) requestWake();
});

// ── 하는 법·설정 ──
$('#btn-help').addEventListener('click', () => show('help'));
$('#help-back').addEventListener('click', () => show('title'));
const qSel = $('#set-quality'), lagSel = $('#set-lag');
for (const [k, q] of Object.entries(QUALITY)) { const o = document.createElement('option'); o.value = k; o.textContent = q.label; qSel.append(o); }
for (const [k, q] of Object.entries(DISPLAY_LAG)) { const o = document.createElement('option'); o.value = k; o.textContent = q.label; lagSel.append(o); }
$('#btn-settings').addEventListener('click', () => {
  $('#set-mirror').checked = settings.mirror; $('#set-sfx').checked = settings.sfx; $('#set-bgm').checked = settings.bgm;
  $('#set-debug').checked = settings.debug; qSel.value = settings.quality; lagSel.value = settings.lag;
  show('settings');
});
$('#settings-back').addEventListener('click', () => show('title'));
$('#set-mirror').addEventListener('change', (e) => { settings.mirror = e.target.checked; saveSettings(); applySettings(); });
$('#set-sfx').addEventListener('change', (e) => { settings.sfx = e.target.checked; saveSettings(); applySettings(); });
$('#set-bgm').addEventListener('change', (e) => { settings.bgm = e.target.checked; saveSettings(); applySettings(); });
$('#set-debug').addEventListener('change', (e) => { settings.debug = e.target.checked; saveSettings(); applySettings(); });
lagSel.addEventListener('change', (e) => { settings.lag = e.target.value; saveSettings(); applySettings(); });
qSel.addEventListener('change', (e) => {
  settings.quality = e.target.value; saveSettings();
  if (vision) { vision.stopCamera(); vision.setQuality(settings.quality); }
});

// ── 전체화면·화면 꺼짐 방지 ──
const NS = 'http://www.w3.org/2000/svg';
function fsIcon(exit) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', exit ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2.6');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p); return svg;
}
function renderFsButtons() {
  const on = fs.isFullscreen();
  const hide = fs.isStandalone() && !on && (!fs.supported() || fs.platform.iOS);
  const label = on ? '창 모드' : '전체화면';
  for (const b of $$('[data-fs]')) {
    b.hidden = hide;
    b.replaceChildren(fsIcon(on));
    if (b.classList.contains('fs-title')) { const s = document.createElement('span'); s.className = 'fs-label'; s.textContent = label; b.append(s); }
    b.setAttribute('aria-label', label);
  }
}
let fsBack = 'title';
function openFsGuide() {
  if (engine.active) { engine.pause(); sound.stopBgm(); }
  const g = fs.guide();
  fsBack = engine.active ? 'pause' : (document.body.dataset.screen || 'title');
  $('#fsguide-title').textContent = g.title;
  $('#fsguide-note').textContent = g.note;
  $('#fsguide-steps').replaceChildren(...g.steps.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
  show('fsguide');
}
$('#fsguide-close').addEventListener('click', () => show(fsBack));
$$('[data-fs]').forEach((b) => b.addEventListener('click', async () => {
  sound.unlock();
  if (fs.isFullscreen()) { await fs.exit(); return; }
  const ok = await fs.enter();
  if (!ok || !fs.isFullscreen()) { await new Promise((r) => setTimeout(r, 300)); if (!fs.isFullscreen()) openFsGuide(); }
}));
fs.onChange(() => { renderFsButtons(); queueLayout(); });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'f' || e.key === 'F') && fs.supported()) fs.toggle();
});
async function enterFullscreen() { if (fs.supported() && !fs.isFullscreen()) await fs.enter(); }
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } } catch { /* noop */ }
}
function releaseWake() { try { wakeLock?.release(); } catch { /* noop */ } wakeLock = null; }

// ── 세로 화면 안내 (카메라 모드만. 폰 모드는 세로도 됨) ──
let rotateDismissed = false;
function checkRotate() {
  const portrait = window.innerHeight > window.innerWidth;
  const playing = document.body.dataset.screen && document.body.dataset.screen !== 'title';
  $('#rotate-hint').hidden = !(portrait && playing && !rotateDismissed && needsCamera());
}
$('#rotate-dismiss').addEventListener('click', () => { rotateDismissed = true; checkRotate(); });

// ── 시작 ──
applySettings();
renderFsButtons();
goTitle();
if (params.has('test')) window.__bb = { engine, settings, get vision() { return vision; }, show, startGame };
