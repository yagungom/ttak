// ─────────────────────────────────────────────────────────────
//  딱! 홈런 설정 — 숫자만 바꿔서 규칙·난이도를 조절할 수 있어요
// ─────────────────────────────────────────────────────────────

// 사람 인식 엔진·모델 (이 폴더에 같이 들어 있어 외부 서버를 부르지 않습니다)
export const PATHS = Object.freeze({
  BUNDLE: 'vendor/mediapipe/vision_bundle.mjs',
  WASM: 'vendor/mediapipe/wasm',
  POSE_MODELS: { full: 'models/pose_landmarker_full.task', lite: 'models/pose_landmarker_lite.task' },
});

// 카메라 모드 화면 (16:9 고정). 폰 모드는 폰 화면에 맞춰 늘어남 (짧은 쪽 = 720)
export const SCREEN = Object.freeze({ W: 1280, H: 720 });

// 야구장 (미터)
export const FIELD = Object.freeze({
  MOUND_Z: 18.44,          // 투수판까지 거리
  RELEASE: [0.25, 1.95, 17.2], // 투수가 공을 놓는 곳 (x, 높이, 거리)
  ZONE: { halfW: 0.30, bottom: 0.48, top: 1.08 }, // 스트라이크존 (게임용으로 조금 넓게)
  CATCH_Z: -0.55,          // 포수 미트 위치
  BALL_R: 0.06,            // 공 반지름 (TV에서 잘 보이게 실제보다 크게)
  FENCE_LINE: 92,          // 담장 거리: 파울라인 쪽
  FENCE_CENTER: 112,       //            가운데
  FENCE_H: 3.2,
  FAIR_DEG: 41,            // 친 공은 무조건 이 각도 안(페어 지역)으로
  GRAVITY: 9.8,
});

// 선수 종류 — '치는 사람'·'던지는 사람' 기준으로 각각 적용
//  · 던질 때
//    throwMin: 이 속도(어깨 폭/초) 넘게 팔을 휘두르면 던짐 · throwMax: 이 속도면 가장 빠른 공
//    powerFloor: 아주 약하게 던져도 이만큼은 나감 (0~1) · aimPull: 던질 곳을 가운데로 끌어오는 정도 (0 = 그대로, 1 = 무조건 한가운데)
//    kmh: 화면에 보이는 구속 범위
//  · 칠 때 (공이 오는 속도는 '치는 사람' 기준)
//    flight: 공이 홈까지 오는 시간(초) [가장 느린 공, 가장 빠른 공]
//    swingMin / swingMax: 배트(손) 휘두르는 속도 — 이 아래는 스윙 아님 / 이 위는 가장 센 스윙
//    early / late: 공이 홈 앞·뒤로 이만큼(m) 지나는 동안 휘두르면 맞음 → 빠른 공일수록 맞히기 어려움
//    heightK: 배트 높이가 공 높이와 다를 때 영향 (0 = 상관없음) · heightMiss: 높이 차이가 이보다 크면 헛스윙
//    evMin / evMax: 맞은 공 속도(m/s) 약하게 ~ 가장 세게 → 비거리
//    assist: 공이 올 곳·타이밍 동그라미 보여 주기
export const LEVELS = Object.freeze({
  adult: {
    label: '어른', emoji: '🧑',
    throwMin: 5.5, throwMax: 17, powerFloor: 0.05, aimPull: 0, kmh: [70, 150],
    flight: [1.5, 0.78], swingMin: 5.5, swingMax: 17, early: 1.9, late: 1.5, heightK: 1, heightMiss: 1.3, evMin: 17, evMax: 45, assist: false,
  },
  kid: {
    label: '어린이', emoji: '🧒',
    throwMin: 3.2, throwMax: 11, powerFloor: 0.3, aimPull: 0.55, kmh: [40, 95],
    flight: [2.3, 1.65], swingMin: 3.2, swingMax: 11, early: 2.9, late: 2.3, heightK: 0.25, heightMiss: 9, evMin: 22, evMax: 41, assist: true,
  },
  cpu: {
    label: '컴퓨터', emoji: '🤖',
    throwMin: 5, throwMax: 16, powerFloor: 0.2, aimPull: 0, kmh: [80, 145],
    flight: [1.5, 0.8], swingMin: 5, swingMax: 16, early: 1.9, late: 1.5, heightK: 1, heightMiss: 1.3, evMin: 17, evMax: 44, assist: false,
  },
});

export const RULES = Object.freeze({
  INNINGS: [1, 2, 3],      // 몇 회까지 (시작 화면에서 고름)
  DEFAULT_INNINGS: 2,
  STRIKES: 3,              // 헛스윙 + 포수가 받은 공 합쳐서 3개면 아웃
  RESET_ON_HIT: false,     // false = 안타를 쳐도 스트라이크 그대로 (스트라이크 3개 될 때까지 계속 침) / true = 진짜 야구처럼 다음 타석
  OUTS: 3,                 // 아웃 3개면 공수교대
  COUNTDOWN_SEC: 3,
  WINDUP_HINT_SEC: 9,      // 투수가 이 시간 동안 안 던지면 안내
  WINDUP_AUTO_SEC: 16,     //            이 시간이 지나면 자동으로 살살 던짐
  CALL_PAUSE_SEC: 1.5,     // 스트라이크·아웃 판정 뒤 다음 공까지
  HIT_PAUSE_SEC: 2.3,      // 공이 떨어진 뒤 다음 타자까지
  CHANGE_SEC: 2.6,         // 공수교대 안내 시간
  ABSENT_PAUSE_MS: 2000,   // 선수가 이 시간 동안 안 보이면 자동 일시정지
  RETURN_MS: 700,          // 다시 보이고 이만큼 지나면 이어서
  CAMERA_LAG: 0.05,        // 카메라가 찍고 인식이 시작되기까지(초) — 인식 시간은 따로 재서 더함
  TOUCH_LAG: 0.03,         // 📱 손가락 터치 지연(초)
  HIT_STOP: [0.05, 0.14],  // 맞는 순간 멈칫하는 시간(초): 약하게 ~ 세게 → 타격감
  SHAKE: [4, 18],          // 맞는 순간 화면 흔들림(px)
  // 📱 폰 모드
  TOUCH_THROW: [700, 5200], // 손가락 쓸어내리는 속도(px/s): 이 이상이면 던짐 ~ 가장 빠른 공
  TOUCH_TAP_POWER: 0.62,   //    톡 치면 이 세기, 옆으로 휙 쓸면 더 세게
  TOUCH_SWIPE: [600, 4200], //   휙 쓰는 속도(px/s) 보통 ~ 가장 셈
  TOUCH_SWIPE_MS: 90,      //    톡 누른 뒤 이 시간 동안 손가락 움직임으로 세기를 봄
});

// 화면 지연 보정 (설정에서 고름): TV가 늦게 보이면 사람이 그만큼 늦게 휘두르니까 판정을 늦춰 줌
export const DISPLAY_LAG = Object.freeze({
  small: { sec: 0.03, label: '작게 (폰 화면·유선 연결)' },
  normal: { sec: 0.09, label: '보통' },
  big: { sec: 0.16, label: '크게 (무선 미러링이 많이 늦을 때)' },
});

export const SIDE_COLORS = Object.freeze(['#4d96ff', '#ff6b6b']);
export const SIDE_LABELS = Object.freeze(['왼쪽', '오른쪽']);

// 인식 화질: 카메라 프레임을 이 크기로 줄여서 좌우 반쪽씩 따로 자세 인식
export const QUALITY = Object.freeze({
  best: { w: 960, h: 540, pose: 'full', label: '최고 (정확, 최신 폰)' },
  high: { w: 768, h: 432, pose: 'lite', label: '고화질' },
  normal: { w: 640, h: 360, pose: 'lite', label: '표준' },
  low: { w: 512, h: 288, pose: 'lite', label: '절전' },
});
