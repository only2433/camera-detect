'use strict';

// ── Pose detection config ─────────────────────────────────────────────────────
const ARM_SPREAD_RATIO  = 1.7;   // wrist span / shoulder span 임계값
const ARM_HEIGHT_SLACK  = 0.14;  // 어깨보다 이만큼 아래까지 허용 (정규화 y 단위)
const ANKLE_DIFF_THRESH = 0.07;  // 발목 y-차이 (한발 서기 판정)
const KNEE_RAISE_THRESH = 0.04;  // 무릎이 골반보다 이만큼 위면 올린 것

// Game config
const COUNTDOWN_FROM   = 5;
const TICK_MS          = 1000;
const HOLD_DURATION_MS = 5000;
const HOLD_SUCCESS_MS  = 4500;

// ── Global state ──────────────────────────────────────────────────────────────
let lastPoseLandmarks = null;
let lastArmDet  = { spread:false, spanRatio:0, lRaised:false, rRaised:false };
let lastLegDet  = { oneFoot:false, ankleDiff:0, lKneeUp:false, rKneeUp:false };
let lastImgW    = 640;
let lastImgH    = 480;

let snapCanvas  = null;
let snapCtx     = null;

// ── App state ─────────────────────────────────────────────────────────────────
const PHASE = { IDLE:'idle', COUNTDOWN:'countdown', HOLD:'hold', RESULT:'result' };
let phase          = PHASE.IDLE;
let countdownTimer = null;
let countdownVal   = COUNTDOWN_FROM;

// Hold phase state
let holdStartTime  = 0;
let holdLastTick   = 0;
let holdArmAccum   = 0;
let holdLegAccum   = 0;
let holdBothAccum  = 0;
let holdEndTimer   = null;

let totalTries = 0, totalCorrect = 0, totalWrong = 0;
let frameCount = 0, lastFpsTime = performance.now();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video        = document.getElementById('webcam');
const canvas       = document.getElementById('overlay');
const ctx          = canvas.getContext('2d');
const loadingEl    = document.getElementById('loading-overlay');
const cdOverlay    = document.getElementById('cd-overlay');
const cdNumber     = document.getElementById('cd-number');
const snapOverlay  = document.getElementById('snap-overlay');
const flashOverlay = document.getElementById('flash-overlay');
const stateIdle      = document.getElementById('state-idle');
const stateCountdown = document.getElementById('state-countdown');
const stateHold      = document.getElementById('state-hold');
const stateResult    = document.getElementById('state-result');
const startOverlay      = document.getElementById('start-overlay');
const holdProgressWrap  = document.getElementById('hold-progress-wrap');
const holdArc           = document.getElementById('hold-arc');
const HOLD_CIRCUMFERENCE = 138.23; // 2 * π * 22
const holdArmsIcon   = document.getElementById('hold-arms-icon');
const holdArmsTime   = document.getElementById('hold-arms-time');
const holdBalIcon    = document.getElementById('hold-balance-icon');
const holdBalTime    = document.getElementById('hold-balance-time');
const holdCondArms   = document.getElementById('hold-cond-arms');
const holdCondBal    = document.getElementById('hold-cond-balance');
const startBtn    = document.getElementById('start-btn');
const retryBtn    = document.getElementById('retry-btn');
const resultSnapshotLeft = document.getElementById('result-snapshot-left');
const resultIcon  = document.getElementById('result-icon');
const resultLabel = document.getElementById('result-label');
const resultSub   = document.getElementById('result-sub');
const totalTriesEl   = document.getElementById('total-tries');
const totalCorrectEl = document.getElementById('total-correct');
const totalWrongEl   = document.getElementById('total-wrong');
const fpsEl          = document.getElementById('fps-value');
const poseDetEl      = document.getElementById('pose-detected');
const armStatusEl    = document.getElementById('arm-status');
const debugToggleBtn   = document.getElementById('debug-toggle');
const debugPanel       = document.getElementById('debug-panel');
const dbSpanRatio      = document.getElementById('db-span-ratio');
const dbArmLeft        = document.getElementById('db-arm-left');
const dbArmRight       = document.getElementById('db-arm-right');
const dbOneFoot        = document.getElementById('db-one-foot');
const dbAnkleDiff      = document.getElementById('db-ankle-diff');
const debugLogList     = document.getElementById('debug-log-list');
const debugClearBtn    = document.getElementById('debug-clear');
const debugDownloadBtn = document.getElementById('debug-download');
const condArms         = document.getElementById('cond-arms');
const condArmsIcon     = document.getElementById('cond-arms-icon');
const condArmsTime     = document.getElementById('cond-arms-time');
const condBalance      = document.getElementById('cond-balance');
const condBalanceIcon  = document.getElementById('cond-balance-icon');
const condBalanceTime  = document.getElementById('cond-balance-time');
const zoomInBtn        = document.getElementById('zoom-in');
const zoomOutBtn       = document.getElementById('zoom-out');
const zoomValEl        = document.getElementById('zoom-val');
let debugVisible = false;

// ── Zoom control ──────────────────────────────────────────────────────────────
const ZOOM_MIN  = 1.0;   // 1.0x = 카메라 최대 화각 (줄일 수 없음)
const ZOOM_MAX  = 2.0;
const ZOOM_STEP = 0.25;
let zoomLevel   = 1.0;

function applyZoom() {
  const t = `scaleX(-1) scale(${zoomLevel})`;
  video.style.transform  = t;
  canvas.style.transform = t;
  zoomValEl.textContent  = `${zoomLevel.toFixed(2).replace(/\.?0+$/, '')}x`;
  zoomOutBtn.disabled = zoomLevel <= ZOOM_MIN;
  zoomInBtn.disabled  = zoomLevel >= ZOOM_MAX;
}

zoomInBtn.addEventListener('click', () => {
  zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(2));
  applyZoom();
});
zoomOutBtn.addEventListener('click', () => {
  zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(2));
  applyZoom();
});

// ── Logger ────────────────────────────────────────────────────────────────────
const Logger = {
  entries: [],
  MAX: 800,
  _colors: { CORRECT:'#22c55e', WRONG:'#ef4444', SNAP:'#a78bfa', WARN:'#fbbf24', ERROR:'#a855f7', INFO:'#60a5fa' },

  log(level, payload) {
    const entry = { t: new Date().toISOString(), level, ...payload };
    this.entries.unshift(entry);
    if (this.entries.length > this.MAX) this.entries.pop();
    const color = this._colors[level] || '#94a3b8';
    console.log(`%c[POSE][${level}] ${entry.t}`, `color:${color};font-weight:bold`, payload);
    this._dom(level, entry);
  },

  _dom(level, e) {
    const div = document.createElement('div');
    div.className = `dlog-item dlog-${level.toLowerCase()}`;
    div.innerHTML = `<span class="dlog-time">${e.t.slice(11,19)}</span>`
      + `<span class="dlog-level">${level}</span>`
      + `<span class="dlog-msg">${this._fmt(e)}</span>`;
    debugLogList.prepend(div);
    while (debugLogList.children.length > 120) debugLogList.removeChild(debugLogList.lastChild);
  },

  _fmt(e) {
    const d = v => (typeof v === 'number' ? v.toFixed(2) : String(v ?? '-'));
    if (e.level === 'SNAP')    return `찰칵: 팔벌림:${e.armsSpread?'O':'X'}(ratio:${d(e.spanRatio)}) 한발:${e.oneFoot?'O':'X'}(ankle:${d(e.ankleDiff)}) → ${e.grade}`;
    if (e.level === 'CORRECT') return `${e.grade}!`;
    if (e.level === 'WRONG')   return `실패 | 팔벌림:${e.armsSpread?'O':'X'} 한발:${e.oneFoot?'O':'X'}`;
    if (e.level === 'INFO')    return e.msg || '';
    if (e.level === 'WARN')    return e.msg || '';
    if (e.level === 'ERROR')   return e.msg || '';
    return '';
  },

  clear()    { this.entries = []; debugLogList.innerHTML = ''; },
  download() {
    const blob = new Blob([JSON.stringify(this.entries, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `pose-log-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  },
};

const f = v => typeof v === 'number' ? v.toFixed(2) : '-';

// ── Pose detection ────────────────────────────────────────────────────────────
function detectArmSpread(pose) {
  if (!pose || pose.length < 17) return { spread:false, spanRatio:0, lRaised:false, rRaised:false };

  const lShoulder = pose[11], rShoulder = pose[12];
  const lWrist    = pose[15], rWrist    = pose[16];

  const shoulderVis = Math.min(lShoulder.visibility ?? 1, rShoulder.visibility ?? 1);
  const wristVis    = Math.min(lWrist.visibility ?? 1,    rWrist.visibility ?? 1);
  if (shoulderVis < 0.4 || wristVis < 0.4) {
    return { spread:false, spanRatio:0, lRaised:false, rRaised:false };
  }

  const shoulderSpan = Math.abs(lShoulder.x - rShoulder.x);
  if (shoulderSpan < 0.05) return { spread:false, spanRatio:0, lRaised:false, rRaised:false };

  const wristSpan = Math.abs(lWrist.x - rWrist.x);
  const spanRatio = wristSpan / shoulderSpan;

  // 손목이 어깨 높이이거나 그 위에 있는지 (y가 작을수록 위)
  const lRaised = lWrist.y <= lShoulder.y + ARM_HEIGHT_SLACK;
  const rRaised = rWrist.y <= rShoulder.y + ARM_HEIGHT_SLACK;

  const spread = spanRatio >= ARM_SPREAD_RATIO && lRaised && rRaised;
  return { spread, spanRatio, lRaised, rRaised };
}

function detectOneFootBalance(pose) {
  if (!pose || pose.length < 29) return { oneFoot:false, ankleDiff:0, lKneeUp:false, rKneeUp:false };

  const lHip   = pose[23], rHip   = pose[24];
  const lKnee  = pose[25], rKnee  = pose[26];
  const lAnkle = pose[27], rAnkle = pose[28];

  const hipY      = (lHip.y + rHip.y) / 2;
  const ankleDiff = Math.abs(lAnkle.y - rAnkle.y);

  // 무릎이 골반보다 높이 올라왔는지
  const lKneeUp = (lKnee.visibility ?? 0) > 0.3 && lKnee.y < hipY - KNEE_RAISE_THRESH;
  const rKneeUp = (rKnee.visibility ?? 0) > 0.3 && rKnee.y < hipY - KNEE_RAISE_THRESH;

  const maxAnkleVis = Math.max(lAnkle.visibility ?? 0, rAnkle.visibility ?? 0);
  const byAnkle = maxAnkleVis > 0.2 && ankleDiff > ANKLE_DIFF_THRESH;
  const byKnee  = lKneeUp || rKneeUp;
  const oneFoot = byAnkle || byKnee;

  return { oneFoot, ankleDiff, lKneeUp, rKneeUp };
}

// ── Skeleton drawing ──────────────────────────────────────────────────────────
const SKELETON_SEGS = [
  [11, 12, 'body'],                        // 어깨
  [11, 13, 'arm'], [13, 15, 'arm'],        // 왼팔
  [12, 14, 'arm'], [14, 16, 'arm'],        // 오른팔
  [11, 23, 'body'], [12, 24, 'body'],      // 몸통
  [23, 24, 'body'],                        // 골반
  [23, 25, 'leg'], [25, 27, 'leg'],        // 왼다리
  [24, 26, 'leg'], [26, 28, 'leg'],        // 오른다리
];

function drawSkeleton(sc, pose, W, H, armOk, legOk, mirrorX) {
  if (!pose || pose.length < 29) return;

  const px = lm => ({
    x: mirrorX ? W - lm.x * W : lm.x * W,
    y: lm.y * H,
  });

  sc.save();
  sc.lineWidth = 4;

  for (const [a, b, type] of SKELETON_SEGS) {
    const la = pose[a], lb = pose[b];
    if ((la.visibility ?? 1) < 0.25 || (lb.visibility ?? 1) < 0.25) continue;
    const pa = px(la), pb = px(lb);
    const color = type === 'arm'  ? (armOk ? '#22c55e' : '#60a5fa')
                : type === 'leg'  ? (legOk ? '#22c55e' : '#f59e0b')
                : '#94a3b8';
    sc.beginPath();
    sc.moveTo(pa.x, pa.y);
    sc.lineTo(pb.x, pb.y);
    sc.strokeStyle = color;
    sc.shadowColor = color;
    sc.shadowBlur  = 10;
    sc.stroke();
  }

  const joints = [11,12,13,14,15,16,23,24,25,26,27,28];
  for (const idx of joints) {
    const lm = pose[idx];
    if ((lm.visibility ?? 1) < 0.25) continue;
    const p     = px(lm);
    const isArm = idx >= 11 && idx <= 16;
    const isLeg = idx >= 23 && idx <= 28;
    const color = isArm ? (armOk ? '#22c55e' : '#60a5fa')
                : isLeg ? (legOk ? '#22c55e' : '#f59e0b')
                : '#94a3b8';
    sc.beginPath();
    sc.arc(p.x, p.y, 7, 0, Math.PI * 2);
    sc.fillStyle   = color;
    sc.shadowColor = color;
    sc.shadowBlur  = 8;
    sc.fill();
  }
  sc.restore();
}


// ── Real-time canvas overlay ──────────────────────────────────────────────────
function drawOverlay(pose, armDet, legDet, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (!pose) return;
  drawSkeleton(ctx, pose, W, H, armDet.spread, legDet.oneFoot, false);

  if (phase === PHASE.HOLD) {
    const elapsed  = performance.now() - holdStartTime;
    const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
    holdArc.setAttribute('stroke-dashoffset',
      (HOLD_CIRCUMFERENCE * (1 - progress)).toFixed(3));
  }
}

// ── Snapshot capture ──────────────────────────────────────────────────────────
function captureSnapshot(armDet, legDet, grade, pose, W, H) {
  if (!snapCanvas) {
    snapCanvas = document.createElement('canvas');
    snapCtx    = snapCanvas.getContext('2d');
  }
  snapCanvas.width = W; snapCanvas.height = H;
  const sc = snapCtx;

  // 미러 비디오 그리기
  sc.save();
  sc.translate(W, 0);
  sc.scale(-1, 1);
  sc.drawImage(video, 0, 0, W, H);
  sc.restore();

  // 스켈레톤 (x 좌우 반전)
  drawSkeleton(sc, pose, W, H, armDet.spread, legDet.oneFoot, true);

  // 등급 배지
  const gradeColor = grade === 'EXCELLENT' ? '#22c55e' : grade === 'GOOD' ? '#f59e0b' : '#ef4444';
  sc.save();
  sc.font        = 'bold 24px system-ui';
  sc.fillStyle   = gradeColor;
  sc.shadowColor = '#000';
  sc.shadowBlur  = 12;
  sc.fillText(grade, 12, 34);
  sc.restore();


  return snapCanvas.toDataURL('image/jpeg', 0.90);
}

// ── Phase management ──────────────────────────────────────────────────────────
function showPhase(p) {
  stateIdle.style.display      = p === PHASE.IDLE      ? 'flex' : 'none';
  stateCountdown.style.display = p === PHASE.COUNTDOWN ? 'flex' : 'none';
  stateHold.style.display      = p === PHASE.HOLD      ? 'flex' : 'none';
  stateResult.style.display    = p === PHASE.RESULT    ? 'flex' : 'none';
}

function animateNumber(n) {
  cdNumber.removeAttribute('class');
  cdNumber.setAttribute('data-n', n);
  cdNumber.textContent = n;
  void cdNumber.offsetWidth;
  cdNumber.className = 'cd-number pop';
}

function startCountdown() {
  phase        = PHASE.COUNTDOWN;
  countdownVal = COUNTDOWN_FROM;
  cdOverlay.classList.add('visible');
  showPhase(PHASE.COUNTDOWN);
  animateNumber(countdownVal);

  Logger.log('INFO', { msg: '카운트다운 시작. 자세를 취하세요!' });

  countdownTimer = setInterval(() => {
    countdownVal--;
    if (countdownVal > 0) { animateNumber(countdownVal); }
    else { clearInterval(countdownTimer); startHold(); }
  }, TICK_MS);
}

function startHold() {
  phase         = PHASE.HOLD;
  holdStartTime = performance.now();
  holdLastTick  = holdStartTime;
  holdArmAccum  = 0;
  holdLegAccum  = 0;
  holdBothAccum = 0;

  cdOverlay.classList.remove('visible');
  holdArc.setAttribute('stroke-dashoffset', HOLD_CIRCUMFERENCE);
  holdProgressWrap.style.display = 'block';
  showPhase(PHASE.HOLD);

  // "START!" 오버레이
  startOverlay.classList.remove('visible');
  void startOverlay.offsetWidth;
  startOverlay.classList.add('visible');
  setTimeout(() => startOverlay.classList.remove('visible'), 1200);

  Logger.log('INFO', { msg: 'HOLD 시작 — 5초간 자세를 유지하세요!' });

  holdEndTimer = setTimeout(() => finishHold(), HOLD_DURATION_MS);
}

function finishHold() {
  clearTimeout(holdEndTimer);
  holdProgressWrap.style.display = 'none';

  const armSec  = holdArmAccum  / 1000;
  const legSec  = holdLegAccum  / 1000;
  const bothSec = holdBothAccum / 1000;
  const success = holdBothAccum >= HOLD_SUCCESS_MS;
  const grade   = success ? (holdLegAccum >= HOLD_SUCCESS_MS ? 'EXCELLENT' : 'GOOD') : 'FAIL';

  Logger.log('SNAP', {
    grade,
    armsSpread: holdArmAccum >= HOLD_SUCCESS_MS,
    oneFoot:    holdLegAccum >= HOLD_SUCCESS_MS,
    spanRatio:  lastArmDet.spanRatio,
    ankleDiff:  lastLegDet.ankleDiff,
    armSec, legSec, bothSec,
  });

  const snapURL = captureSnapshot(lastArmDet, lastLegDet, grade, lastPoseLandmarks, lastImgW, lastImgH);
  showResult({ armSec, legSec, bothSec, grade }, snapURL);
}

function showResult(det, snapURL) {
  phase = PHASE.RESULT;
  totalTries++;
  totalTriesEl.textContent = totalTries;

  const { grade, armSec, legSec } = det;
  const armOk = armSec >= HOLD_SUCCESS_MS / 1000;
  const legOk = legSec >= HOLD_SUCCESS_MS / 1000;
  const ok    = grade !== 'FAIL';

  if (ok) { totalCorrect++; totalCorrectEl.textContent = totalCorrect; }
  else    { totalWrong++;   totalWrongEl.textContent   = totalWrong; }

  resultSnapshotLeft.src          = snapURL;
  resultSnapshotLeft.style.display = 'block';
  stateResult.className = `panel-card ${grade.toLowerCase()}`;

  resultIcon.textContent  = grade === 'EXCELLENT' ? '🎉' : grade === 'GOOD' ? '👍' : '😅';
  resultLabel.className   = `result-label ${grade.toLowerCase()}`;
  resultLabel.textContent = grade === 'EXCELLENT' ? 'EXCELLENT!' : grade === 'GOOD' ? 'GOOD!' : 'FAIL';

  // 부족한 부분 메시지
  if (grade === 'EXCELLENT') {
    resultSub.textContent = '완벽해요! 팔 벌리고 한발로 5초 유지!';
  } else if (grade === 'GOOD') {
    resultSub.textContent = `한발 서기가 아직 부족해요 (${legSec.toFixed(1)}s / 4.5s). 무릎을 더 들어보세요!`;
  } else {
    if (!armOk && !legOk) {
      resultSub.textContent = `양손 벌리기(${armSec.toFixed(1)}s)와 한발 서기(${legSec.toFixed(1)}s) 모두 부족해요!`;
    } else {
      resultSub.textContent = `양손 벌리기가 부족해요 (${armSec.toFixed(1)}s / 4.5s). 손을 어깨 높이까지 벌려보세요!`;
    }
  }

  condArms.className        = `cond-item ${armOk ? 'ok' : 'fail'}`;
  condArmsIcon.textContent  = armOk ? '✓' : '✗';
  condArmsTime.textContent  = `${armSec.toFixed(1)}s / 5s`;
  condBalance.className       = `cond-item ${legOk ? 'ok' : 'fail'}`;
  condBalanceIcon.textContent = legOk ? '✓' : '✗';
  condBalanceTime.textContent = `${legSec.toFixed(1)}s / 5s`;

  Logger.log(ok ? 'CORRECT' : 'WRONG', { grade, armOk, legOk, armSec, legSec });

  showPhase(PHASE.RESULT);
}

function reset() {
  phase = PHASE.IDLE;
  clearInterval(countdownTimer);
  clearTimeout(holdEndTimer);
  cdOverlay.classList.remove('visible');
  snapOverlay.classList.remove('visible');
  startOverlay.classList.remove('visible');
  resultSnapshotLeft.style.display  = 'none';
  holdProgressWrap.style.display    = 'none';
  holdArc.setAttribute('stroke-dashoffset', HOLD_CIRCUMFERENCE);
  showPhase(PHASE.IDLE);
}

startBtn.addEventListener('click', startCountdown);
retryBtn.addEventListener('click', reset);

// ── MediaPipe onResults ───────────────────────────────────────────────────────
function onResults(results) {
  canvas.width  = results.image.width;
  canvas.height = results.image.height;

  const W = canvas.width, H = canvas.height;
  lastImgW = W; lastImgH = H;

  // IDLE 중에는 감지·오버레이 비활성화
  if (phase === PHASE.IDLE) {
    ctx.clearRect(0, 0, W, H);
    return;
  }

  // HOLD 중 자세 유지 시간 누적
  if (phase === PHASE.HOLD) {
    const now   = performance.now();
    const delta = now - holdLastTick;
    holdLastTick = now;
    if (lastArmDet.spread)  holdArmAccum  += delta;
    if (lastLegDet.oneFoot) holdLegAccum  += delta;
    if (lastArmDet.spread && lastLegDet.oneFoot) holdBothAccum += delta;

    // 우상단 실시간 패널 업데이트
    holdArmsIcon.textContent = lastArmDet.spread  ? '✓' : '✗';
    holdBalIcon.textContent  = lastLegDet.oneFoot ? '✓' : '✗';
    holdArmsTime.textContent = `${(holdArmAccum / 1000).toFixed(1)}s`;
    holdBalTime.textContent  = `${(holdLegAccum / 1000).toFixed(1)}s`;
    holdCondArms.className   = `cond-item ${lastArmDet.spread  ? 'ok' : 'fail'}`;
    holdCondBal.className    = `cond-item ${lastLegDet.oneFoot ? 'ok' : 'fail'}`;
  }

  const hasPose = !!(results.poseLandmarks?.length);
  lastPoseLandmarks = hasPose ? results.poseLandmarks : null;

  if (poseDetEl)   poseDetEl.textContent = hasPose ? '있음' : '없음';

  if (hasPose) {
    lastArmDet = detectArmSpread(lastPoseLandmarks);
    lastLegDet = detectOneFootBalance(lastPoseLandmarks);
  } else {
    lastArmDet = { spread:false, spanRatio:0, lRaised:false, rRaised:false };
    lastLegDet = { oneFoot:false, ankleDiff:0, lKneeUp:false, rKneeUp:false };
  }

  if (armStatusEl) armStatusEl.textContent = lastArmDet.spread ? 'OK' : '-';

  drawOverlay(lastPoseLandmarks, lastArmDet, lastLegDet, W, H);

  if (debugVisible) {
    if (dbSpanRatio) dbSpanRatio.textContent = f(lastArmDet.spanRatio);
    if (dbArmLeft)   dbArmLeft.textContent   = lastArmDet.lRaised ? 'OK' : '-';
    if (dbArmRight)  dbArmRight.textContent  = lastArmDet.rRaised ? 'OK' : '-';
    if (dbOneFoot)   dbOneFoot.textContent   = lastLegDet.oneFoot ? 'YES' : 'NO';
    if (dbAnkleDiff) dbAnkleDiff.textContent = f(lastLegDet.ankleDiff);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = `${Math.round(frameCount * 1000 / (now - lastFpsTime))}`;
    frameCount = 0; lastFpsTime = now;
  }
}

// ── Debug panel ───────────────────────────────────────────────────────────────
debugToggleBtn.addEventListener('click', () => {
  debugVisible = !debugVisible;
  debugPanel.style.display   = debugVisible ? 'block' : 'none';
  debugToggleBtn.textContent = debugVisible ? '디버그 패널 닫기' : '디버그 패널 열기';
});
debugClearBtn.addEventListener('click',    () => Logger.clear());
debugDownloadBtn.addEventListener('click', () => Logger.download());

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const holistic = new Holistic({
    locateFile: fn => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${fn}`,
  });
  holistic.setOptions({
    modelComplexity:      1,
    smoothLandmarks:      true,
    enableSegmentation:   false,
    refineFaceLandmarks:  false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence:  0.5,
  });
  holistic.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => { await holistic.send({ image: video }); },
    width: 640, height: 480,
  });
  await camera.start();

  loadingEl.style.display = 'none';
  Logger.log('INFO', { msg: '준비 완료! 양손을 벌리고 한발로 서는 자세를 취해보세요.' });
}

init().catch(err => {
  console.error(err);
  Logger.log('ERROR', { msg: err.message });
  document.querySelector('.loading-text').textContent = '오류: ' + err.message;
  document.querySelector('.loading-sub').textContent  = '카메라 권한을 확인해 주세요';
});
