'use strict';

// ── Mouth landmarks ───────────────────────────────────────────────────────────
const MOUTH_OUTER = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const MOUTH_INNER = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];
const MOUTH_IDX      = [...new Set([...MOUTH_OUTER, ...MOUTH_INNER])];
const NOSE_IDX       = [1, 2, 3, 4, 5, 6, 168, 197, 45, 275];
const NOSE_MOUTH_IDX = [...new Set([...MOUTH_IDX, ...NOSE_IDX])];
const NOSE_MOUTH_INNER = [...new Set([...MOUTH_INNER, ...NOSE_IDX])];

const LM_NOSE_TIP    = 1;
const LM_LEFT_CHEEK  = 234;
const LM_RIGHT_CHEEK = 454;
const LM_FOREHEAD    = 10;
const LM_CHIN        = 152;

// Hand detection config
const BOX_BASE_EXPAND   = 0.65;
const YAW_EXPAND_FACTOR = 1.3;
const PTH_EXPAND_FACTOR = 0.9;
const MIN_PTS_IN_BOX    = 2;
const NEAR_MISS_RATIO   = 1.6;

// Pixel detection config
const BASELINE_WINDOW      = 20;   // 최근 N 프레임 평균
const COLOR_DIFF_THRESH    = 25;   // RGB 유클리드 거리
const VARIANCE_DROP_THRESH = 300;  // 분산 감소량

// Posture detection config
const BEND_PITCH_THRESH = 0.30;   // face pitch threshold for forward bend
const SIT_TORSO_RATIO   = 2.0;    // (hipY - shoulderY) / faceH fallback for sitting

// Game config
const COUNTDOWN_FROM = 5;
const TICK_MS        = 1000;

// ── Global detection state ────────────────────────────────────────────────────
let lastDetection     = { covering:false, ptsInBox:0, minDist:Infinity, radius:0, yaw:0, pitch:0, method:null };
let lastBox           = null;
let lastHands         = [];
let lastFaceLandmarks = null;
let lastPoseLandmarks = null;
let lastPosture       = { bent:false, sitting:false, torsoRatio:0 };
let lastFaceH         = 0;
let lastImgW          = 640;
let lastImgH          = 480;

// Snapshot canvas (reused across rounds)
let snapCanvas = null;
let snapCtx    = null;

// Pixel baseline
let mouthBaseline  = null;
let baselineBuffer = [];
let pixelCanvas    = null;
let pixelCtx       = null;

// ── App state ─────────────────────────────────────────────────────────────────
const PHASE = { IDLE:'idle', COUNTDOWN:'countdown', SNAP:'snap', RESULT:'result' };
let phase          = PHASE.IDLE;
let countdownTimer = null;
let countdownVal   = COUNTDOWN_FROM;

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
const stateResult    = document.getElementById('state-result');
const startBtn    = document.getElementById('start-btn');
const retryBtn    = document.getElementById('retry-btn');
const snapPreview = document.getElementById('snap-preview');
const resultIcon  = document.getElementById('result-icon');
const resultLabel = document.getElementById('result-label');
const resultSub   = document.getElementById('result-sub');
const totalTriesEl   = document.getElementById('total-tries');
const totalCorrectEl = document.getElementById('total-correct');
const totalWrongEl   = document.getElementById('total-wrong');
const fpsEl          = document.getElementById('fps-value');
const handCountEl    = document.getElementById('hand-count');
const faceDetEl      = document.getElementById('face-detected');
const debugToggleBtn   = document.getElementById('debug-toggle');
const debugPanel       = document.getElementById('debug-panel');
const dbYaw            = document.getElementById('db-yaw');
const dbPitch          = document.getElementById('db-pitch');
const dbPts            = document.getElementById('db-pts');
const dbDist           = document.getElementById('db-dist');
const dbRadius         = document.getElementById('db-radius');
const dbMethod         = document.getElementById('db-method');
const dbYawBar         = document.getElementById('db-yaw-bar');
const debugLogList     = document.getElementById('debug-log-list');
const debugClearBtn    = document.getElementById('debug-clear');
const debugDownloadBtn = document.getElementById('debug-download');
const condCover        = document.getElementById('cond-cover');
const condCoverIcon    = document.getElementById('cond-cover-icon');
const condPosture      = document.getElementById('cond-posture');
const condPostureIcon  = document.getElementById('cond-posture-icon');
const dbBent           = document.getElementById('db-bent');
const dbSitting        = document.getElementById('db-sitting');
const dbTorso          = document.getElementById('db-torso');
let debugVisible = false;

// ── Logger ────────────────────────────────────────────────────────────────────
const Logger = {
  entries: [],
  MAX: 800,
  _colors: { CORRECT:'#22c55e', WRONG:'#ef4444', SNAP:'#a78bfa', MISS:'#f97316', WARN:'#fbbf24', ERROR:'#a855f7', INFO:'#60a5fa' },

  log(level, payload) {
    const entry = { t: new Date().toISOString(), level, ...payload };
    this.entries.unshift(entry);
    if (this.entries.length > this.MAX) this.entries.pop();
    const color = this._colors[level] || '#94a3b8';
    console.log(`%c[MOUTH][${level}] ${entry.t}`, `color:${color};font-weight:bold`, payload);
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
    if (e.level === 'SNAP') {
      return `찰칵 최종:${e.covering?'가림':'안가림'} | `
           + `[손] pts:${e.hand_pts}/${MIN_PTS_IN_BOX} dist:${d(e.hand_dist)} r:${d(e.hand_r)} | `
           + `[픽셀] colorDiff:${d(e.px_colorDiff)} varDrop:${d(e.px_varDrop)} → ${e.px_covered?'가림':'안가림'}(${e.px_reason}) | `
           + `손:${e.hands}개 얼굴:${e.hasFace?'O':'X'} baseline:${e.baselineSamples}샘플`;
    }
    if (e.level === 'CORRECT') return `${e.grade ?? '정답'}! 방법:${e.method}`;
    if (e.level === 'WRONG')   return `실패 | [손]pts:${e.hand_pts} dist:${d(e.hand_dist)} r:${d(e.hand_r)} | [픽셀]colorDiff:${d(e.px_colorDiff)} varDrop:${d(e.px_varDrop)} 손:${e.hands}개 얼굴:${e.hasFace?'O':'X'}`;
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
    a.href = url; a.download = `mouth-log-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  },
};

const f = v => typeof v === 'number' ? v.toFixed(2) : '-';

// ── Face metrics ──────────────────────────────────────────────────────────────
function estimateFaceMetrics(face) {
  const lc = face[LM_LEFT_CHEEK], rc = face[LM_RIGHT_CHEEK];
  const nt = face[LM_NOSE_TIP];
  const fh = face[LM_FOREHEAD],   ch = face[LM_CHIN];
  let yaw = 0;
  const cheekSpan = Math.abs(rc.x - lc.x);
  if (cheekSpan > 0.01) yaw = ((nt.x - Math.min(lc.x, rc.x)) / cheekSpan - 0.5) * 2;
  let pitch = 0;
  const faceH = Math.abs(ch.y - fh.y);
  if (faceH > 0.01) pitch = ((nt.y - Math.min(fh.y, ch.y)) / faceH - 0.45) * 2;
  return { yaw, pitch, faceH };
}

// ── Mouth box (for hand detection) ────────────────────────────────────────────
function getMouthBox(face, W, H) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const idx of NOSE_MOUTH_IDX) {
    const lm = face[idx];
    const x = lm.x*W, y = lm.y*H;
    if (x<minX) minX=x; if (y<minY) minY=y;
    if (x>maxX) maxX=x; if (y>maxY) maxY=y;
  }
  const { yaw, pitch, faceH } = estimateFaceMetrics(face);
  const aY=Math.abs(yaw), aP=Math.abs(pitch);
  const w=maxX-minX, h=maxY-minY;
  const eL=BOX_BASE_EXPAND+(yaw<0?aY*YAW_EXPAND_FACTOR:0);
  const eR=BOX_BASE_EXPAND+(yaw>0?aY*YAW_EXPAND_FACTOR:0);
  const eT=BOX_BASE_EXPAND+(pitch<0?aP*PTH_EXPAND_FACTOR:0);
  const eB=BOX_BASE_EXPAND+(pitch>0?aP*PTH_EXPAND_FACTOR:0);
  const bx=minX-w*eL, by=minY-h*eT;
  const bw=w*(1+eL+eR), bh=h*(1+eT+eB);
  return { x:bx, y:by, w:bw, h:bh, cx:bx+bw/2, cy:by+bh/2, yaw, pitch, faceH };
}

// ── Hand landmark detection ───────────────────────────────────────────────────
function detectByHand(handLandmarks, box, W, H) {
  let ptsInBox=0, minDist=Infinity;
  for (const lm of handLandmarks) {
    const x=lm.x*W, y=lm.y*H;
    if (x>=box.x && x<=box.x+box.w && y>=box.y && y<=box.y+box.h) ptsInBox++;
    const d=Math.hypot(x-box.cx, y-box.cy);
    if (d<minDist) minDist=d;
  }
  const radius=(box.w+box.h)/4;
  if (ptsInBox>=MIN_PTS_IN_BOX) return { covering:true,  method:'box',    ptsInBox, minDist, radius };
  if (minDist<radius)            return { covering:true,  method:'radius', ptsInBox, minDist, radius };
  return                                { covering:false, method:null,     ptsInBox, minDist, radius };
}

// ── Pixel-based occlusion detection ──────────────────────────────────────────
function getPixelCtx(W, H) {
  if (!pixelCanvas) {
    pixelCanvas = document.createElement('canvas');
    pixelCtx    = pixelCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (pixelCanvas.width !== W || pixelCanvas.height !== H) {
    pixelCanvas.width = W; pixelCanvas.height = H;
  }
  pixelCtx.drawImage(video, 0, 0, W, H);
  return pixelCtx;
}

// 입 안쪽 기준으로 픽셀 박스 계산 (더 타이트하게)
function getMouthPixelBox(face, W, H) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const idx of NOSE_MOUTH_INNER) {
    const lm = face[idx];
    minX=Math.min(minX, lm.x*W); minY=Math.min(minY, lm.y*H);
    maxX=Math.max(maxX, lm.x*W); maxY=Math.max(maxY, lm.y*H);
  }
  const w=maxX-minX, h=maxY-minY, expand=0.8;
  return {
    x: Math.max(0, minX - w*expand),
    y: Math.max(0, minY - h*expand),
    w: w*(1+expand*2),
    h: h*(1+expand*2),
  };
}

function sampleRegionStats(pctx, box) {
  const ix=Math.max(0,Math.floor(box.x)), iy=Math.max(0,Math.floor(box.y));
  const iw=Math.max(1,Math.min(Math.ceil(box.w), pctx.canvas.width-ix));
  const ih=Math.max(1,Math.min(Math.ceil(box.h), pctx.canvas.height-iy));
  if (iw<=0||ih<=0) return null;

  const data = pctx.getImageData(ix, iy, iw, ih).data;
  let rS=0, gS=0, bS=0, n=0;
  for (let i=0; i<data.length; i+=8) { rS+=data[i]; gS+=data[i+1]; bS+=data[i+2]; n++; }
  if (n===0) return null;
  const r=rS/n, g=gS/n, b=bS/n;
  let variance=0;
  for (let i=0; i<data.length; i+=8)
    variance += (data[i]-r)**2 + (data[i+1]-g)**2 + (data[i+2]-b)**2;
  variance /= (3*n);
  return { r, g, b, variance };
}

// IDLE 중 baseline 갱신 (손이 없을 때만)
function updateBaseline(face, W, H) {
  try {
    const pctx  = getPixelCtx(W, H);
    const box   = getMouthPixelBox(face, W, H);
    const stats = sampleRegionStats(pctx, box);
    if (!stats) return;

    baselineBuffer.push(stats);
    if (baselineBuffer.length > BASELINE_WINDOW) baselineBuffer.shift();

    const n = baselineBuffer.length;
    mouthBaseline = {
      r:        baselineBuffer.reduce((s,x)=>s+x.r,       0) / n,
      g:        baselineBuffer.reduce((s,x)=>s+x.g,       0) / n,
      b:        baselineBuffer.reduce((s,x)=>s+x.b,       0) / n,
      variance: baselineBuffer.reduce((s,x)=>s+x.variance,0) / n,
      n,
    };
  } catch (_) { /* getImageData cross-origin guard */ }
}

// 찰칵 순간 픽셀 비교
function detectByPixels(face, W, H) {
  if (!mouthBaseline || mouthBaseline.n < 5) {
    return { covered:false, reason:'baseline-부족', colorDiff:0, varDrop:0, baselineSamples: mouthBaseline?.n??0 };
  }
  try {
    const pctx = getPixelCtx(W, H);
    const box  = getMouthPixelBox(face, W, H);
    const cur  = sampleRegionStats(pctx, box);
    if (!cur) return { covered:false, reason:'샘플실패', colorDiff:0, varDrop:0, baselineSamples:mouthBaseline.n };

    const colorDiff = Math.sqrt(
      (cur.r - mouthBaseline.r)**2 +
      (cur.g - mouthBaseline.g)**2 +
      (cur.b - mouthBaseline.b)**2
    );
    const varDrop = mouthBaseline.variance - cur.variance;

    const byColor    = colorDiff > COLOR_DIFF_THRESH;
    const byVariance = varDrop   > VARIANCE_DROP_THRESH;
    const covered    = byColor && byVariance;

    return {
      covered,
      reason:          covered ? (byColor?'color':'variance') : '미감지',
      colorDiff:       +colorDiff.toFixed(2),
      varDrop:         +varDrop.toFixed(2),
      curVariance:     +cur.variance.toFixed(1),
      baseVariance:    +mouthBaseline.variance.toFixed(1),
      baselineSamples: mouthBaseline.n,
    };
  } catch (_) {
    return { covered:false, reason:'error', colorDiff:0, varDrop:0, baselineSamples:mouthBaseline?.n??0 };
  }
}

// ── Posture detection ─────────────────────────────────────────────────────────
function detectPosture(poseLandmarks, faceH, pitch) {
  const bent = pitch > BEND_PITCH_THRESH;
  if (!poseLandmarks || poseLandmarks.length < 27) {
    return { bent, sitting: false, torsoRatio: 0 };
  }

  const lShoulder = poseLandmarks[11], rShoulder = poseLandmarks[12];
  const lHip      = poseLandmarks[23], rHip      = poseLandmarks[24];
  const lKnee     = poseLandmarks[25], rKnee     = poseLandmarks[26];

  const shoulderVis = (lShoulder.visibility + rShoulder.visibility) / 2;
  const hipVis      = (lHip.visibility      + rHip.visibility)      / 2;
  const kneeVis     = (lKnee.visibility     + rKnee.visibility)     / 2;

  if (shoulderVis < 0.3 || hipVis < 0.3) return { bent, sitting: false, torsoRatio: 0 };

  const shoulderY  = (lShoulder.y + rShoulder.y) / 2;
  const hipY       = (lHip.y      + rHip.y)      / 2;
  const torsoH     = hipY - shoulderY;
  const torsoRatio = faceH > 0.01 ? torsoH / faceH : 999;

  let sitting = false;
  if (kneeVis > 0.3) {
    // 무릎이 골반 높이까지 올라오면 앉은 것
    const kneeY = (lKnee.y + rKnee.y) / 2;
    sitting = !bent && (hipY - kneeY) < 0.05;
  } else {
    // 무릎이 안 보이면 torso 압축 비율로 판정
    sitting = !bent && torsoRatio < SIT_TORSO_RATIO;
  }

  return { bent, sitting, torsoRatio, shoulderVis, hipVis, kneeVis };
}

// ── Snapshot capture ──────────────────────────────────────────────────────────
function captureSnapshot(handDet, pixDet, posture, grade, box, hands, W, H) {
  if (!snapCanvas) {
    snapCanvas = document.createElement('canvas');
    snapCtx    = snapCanvas.getContext('2d');
  }
  snapCanvas.width = W; snapCanvas.height = H;
  const sc = snapCtx;

  // Mirrored video
  sc.save(); sc.translate(W,0); sc.scale(-1,1); sc.drawImage(video,0,0,W,H); sc.restore();

  const covering   = handDet.covering || pixDet.covered;
  const gradeColor = grade === 'EXCELLENT' ? '#22c55e' : grade === 'GOOD' ? '#f59e0b' : '#ef4444';
  const color      = covering ? '#22c55e' : '#ef4444';

  // Grade badge (top-left)
  sc.save();
  sc.font = 'bold 22px system-ui'; sc.fillStyle = gradeColor;
  sc.shadowColor = '#000'; sc.shadowBlur = 10;
  sc.fillText(grade, 10, 32);
  sc.restore();

  if (box) {
    const mx  = W - box.x - box.w;
    const mcx = W - box.cx;
    const r   = (box.w + box.h) / 4;

    sc.save();
    sc.strokeStyle=color; sc.lineWidth=4; sc.shadowColor=color; sc.shadowBlur=14;
    sc.setLineDash(covering?[]:[8,5]);
    sc.strokeRect(mx, box.y, box.w, box.h);

    sc.beginPath(); sc.arc(mcx, box.cy, r, 0, Math.PI*2);
    sc.strokeStyle=color+'55'; sc.lineWidth=2; sc.setLineDash([4,5]); sc.stroke();

    sc.setLineDash([]); sc.shadowBlur=0;
    sc.font='bold 15px system-ui'; sc.fillStyle=color;
    sc.fillText(covering?'코·입 가려짐 ✓':'코·입 (미감지)', mx, box.y-7);
    sc.restore();
  }

  if (hands.length > 0) {
    sc.save();
    sc.fillStyle = covering ? 'rgba(239,68,68,0.85)' : 'rgba(96,165,250,0.8)';
    for (const handLms of hands)
      for (const lm of handLms) {
        sc.beginPath(); sc.arc(W-lm.x*W, lm.y*H, 6, 0, Math.PI*2); sc.fill();
      }
    sc.restore();
  }

  // Debug overlay (하단)
  sc.save();
  sc.font='12px monospace'; sc.shadowColor='#000'; sc.shadowBlur=4; sc.fillStyle='rgba(255,255,255,0.9)';
  const postureStr = posture.bent ? '허리숙임' : posture.sitting ? '앉기' : '직립';
  const lines = [
    `[손] pts:${handDet.ptsInBox??0}/${MIN_PTS_IN_BOX} dist:${f(handDet.minDist)} r:${f(handDet.radius)} yaw:${f(box?.yaw)}`,
    `[픽셀] colorDiff:${f(pixDet.colorDiff)}(임계:${COLOR_DIFF_THRESH}) varDrop:${f(pixDet.varDrop)}(임계:${VARIANCE_DROP_THRESH}) → ${pixDet.reason}`,
    `[자세] ${postureStr}  pitch:${f(handDet.pitch)}  torso:${f(posture.torsoRatio)}  손:${hands.length}개`,
  ];
  lines.forEach((line, i) => sc.fillText(line, 8, H - 8 - (lines.length-1-i)*17));
  sc.restore();

  return snapCanvas.toDataURL('image/jpeg', 0.90);
}

// ── Phase management ──────────────────────────────────────────────────────────
function showPhase(p) {
  stateIdle.style.display      = p===PHASE.IDLE      ? 'flex':'none';
  stateCountdown.style.display = p===PHASE.COUNTDOWN ? 'flex':'none';
  stateResult.style.display    = p===PHASE.RESULT    ? 'flex':'none';
}

function animateNumber(n) {
  cdNumber.removeAttribute('class');
  cdNumber.setAttribute('data-n', n);
  cdNumber.textContent = n;
  void cdNumber.offsetWidth;
  cdNumber.className = 'cd-number pop';
}

function startCountdown() {
  phase = PHASE.COUNTDOWN;
  countdownVal = COUNTDOWN_FROM;
  cdOverlay.classList.add('visible');
  showPhase(PHASE.COUNTDOWN);
  animateNumber(countdownVal);

  // baseline 확정 로그
  Logger.log('INFO', {
    msg: `카운트다운 시작. baseline ${mouthBaseline?.n??0}샘플 확정`,
    baselineR:        mouthBaseline?.r?.toFixed(1),
    baselineVariance: mouthBaseline?.variance?.toFixed(1),
  });

  countdownTimer = setInterval(() => {
    countdownVal--;
    if (countdownVal > 0) { animateNumber(countdownVal); }
    else { clearInterval(countdownTimer); doSnap(); }
  }, TICK_MS);
}

function doSnap() {
  phase = PHASE.SNAP;
  cdOverlay.classList.remove('visible');

  flashOverlay.classList.remove('flash'); void flashOverlay.offsetWidth; flashOverlay.classList.add('flash');
  snapOverlay.classList.remove('visible'); void snapOverlay.offsetWidth; snapOverlay.classList.add('visible');

  // 손 감지 결과 (최근 MediaPipe 프레임)
  const handDet = {
    covering: lastDetection.covering,
    method:   lastDetection.method,
    ptsInBox: lastDetection.ptsInBox,
    minDist:  lastDetection.minDist,
    radius:   lastDetection.radius,
    yaw:      lastDetection.yaw,
    pitch:    lastDetection.pitch,
  };

  // 픽셀 감지 결과 (현재 비디오 프레임 직접 분석)
  const pixDet = lastFaceLandmarks
    ? detectByPixels(lastFaceLandmarks, lastImgW, lastImgH)
    : { covered:false, reason:'얼굴없음', colorDiff:0, varDrop:0, baselineSamples:0 };

  const covering = handDet.covering || pixDet.covered;
  const posture  = { ...lastPosture };
  const grade    = !covering ? 'FAIL' : (posture.bent || posture.sitting) ? 'EXCELLENT' : 'GOOD';
  const method   = handDet.covering
    ? `hand-${handDet.method}`
    : pixDet.covered ? `pixel-${pixDet.reason}` : null;

  // 스냅 로그
  Logger.log('SNAP', {
    grade, covering, method,
    hand_covering:   handDet.covering,
    hand_pts:        handDet.ptsInBox,
    hand_dist:       handDet.minDist,
    hand_r:          handDet.radius,
    px_covered:      pixDet.covered,
    px_reason:       pixDet.reason,
    px_colorDiff:    pixDet.colorDiff,
    px_varDrop:      pixDet.varDrop,
    px_curVar:       pixDet.curVariance,
    px_baseVar:      pixDet.baseVariance,
    baselineSamples: pixDet.baselineSamples,
    posture_bent:    posture.bent,
    posture_sitting: posture.sitting,
    hands:    lastHands.length,
    hasFace:  lastFaceLandmarks !== null,
    yaw:      handDet.yaw,
    pitch:    handDet.pitch,
  });

  const snapURL = captureSnapshot(handDet, pixDet, posture, grade, lastBox, lastHands, lastImgW, lastImgH);
  setTimeout(() => showResult({ covering, grade, posture, method, handDet, pixDet }, snapURL), 700);
}

function showResult(det, snapURL) {
  phase = PHASE.RESULT;
  totalTries++;
  totalTriesEl.textContent = totalTries;

  const { grade, covering, posture } = det;
  const ok = grade !== 'FAIL';
  if (ok) { totalCorrect++; totalCorrectEl.textContent = totalCorrect; }
  else    { totalWrong++;   totalWrongEl.textContent   = totalWrong; }

  snapPreview.src       = snapURL;
  stateResult.className = `panel-card ${grade.toLowerCase()}`;

  resultIcon.textContent  = grade === 'EXCELLENT' ? '🎉' : grade === 'GOOD' ? '👍' : '😶';
  resultLabel.className   = `result-label ${grade.toLowerCase()}`;
  resultLabel.textContent = grade;

  if (grade === 'EXCELLENT') {
    resultSub.textContent = '완벽해요! 정확한 자세예요!';
  } else if (grade === 'GOOD') {
    resultSub.textContent = '잘했어요! 앉거나 허리를 숙이면 더 좋아요!';
  } else {
    resultSub.textContent = '코와 입을 손으로 가려보세요!';
  }

  const postureOk = posture.bent || posture.sitting;
  condCover.className       = `cond-item ${covering   ? 'ok' : 'fail'}`;
  condCoverIcon.textContent = covering   ? '✓' : '✗';
  condPosture.className       = `cond-item ${postureOk ? 'ok' : 'fail'}`;
  condPostureIcon.textContent = postureOk ? '✓' : '✗';

  Logger.log(ok ? 'CORRECT' : 'WRONG', {
    grade,
    method:          det.method,
    hand_pts:        det.handDet.ptsInBox,
    hand_dist:       det.handDet.minDist,
    hand_r:          det.handDet.radius,
    px_colorDiff:    det.pixDet.colorDiff,
    px_varDrop:      det.pixDet.varDrop,
    posture_bent:    posture.bent,
    posture_sitting: posture.sitting,
    hands:           lastHands.length,
    hasFace:         lastFaceLandmarks !== null,
  });

  showPhase(PHASE.RESULT);
}

function reset() {
  phase = PHASE.IDLE;
  clearInterval(countdownTimer);
  cdOverlay.classList.remove('visible');
  snapOverlay.classList.remove('visible');
  showPhase(PHASE.IDLE);
}

startBtn.addEventListener('click', startCountdown);
retryBtn.addEventListener('click', reset);

// ── MediaPipe onResults ───────────────────────────────────────────────────────
function onResults(results) {
  canvas.width  = results.image.width;
  canvas.height = results.image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W = canvas.width, H = canvas.height;
  lastImgW = W; lastImgH = H;

  const hasFace = !!(results.faceLandmarks?.length);
  const hands   = [results.leftHandLandmarks, results.rightHandLandmarks].filter(Boolean);

  lastHands         = hands;
  lastFaceLandmarks = hasFace ? results.faceLandmarks : null;
  lastPoseLandmarks = results.poseLandmarks || null;

  faceDetEl.textContent   = hasFace ? '있음' : '없음';
  handCountEl.textContent = hands.length;

  let box = null;
  let det = { covering:false, ptsInBox:0, minDist:Infinity, radius:0, yaw:0, pitch:0, method:null };

  if (hasFace) {
    box = getMouthBox(results.faceLandmarks, W, H);
    if (hands.length > 0) {
      for (const handLms of hands) {
        const r = detectByHand(handLms, box, W, H);
        if (r.covering || r.minDist < det.minDist) {
          det = { ...r, yaw: box.yaw, pitch: box.pitch };
        }
        if (r.covering) break;
      }
    } else {
      det = { ...det, yaw: box.yaw, pitch: box.pitch };
    }

    lastFaceH   = box.faceH;
    lastPosture = detectPosture(lastPoseLandmarks, lastFaceH, box.pitch);

    // IDLE 중 손이 없을 때만 baseline 갱신
    if (phase === PHASE.IDLE && hands.length === 0) {
      updateBaseline(results.faceLandmarks, W, H);
    }
  }

  lastBox       = box;
  lastDetection = det;

  // Debug panel
  if (debugVisible) {
    dbYaw.textContent    = box ? `${f(box.yaw)} (${box.yaw>0.15?'우':box.yaw<-0.15?'좌':'정면'})` : '-';
    dbPitch.textContent  = box ? f(box.pitch) : '-';
    dbPts.textContent    = det.radius>0 ? `${det.ptsInBox}/${MIN_PTS_IN_BOX}` : '-';
    dbDist.textContent   = det.radius>0 ? `${f(det.minDist)}px` : '-';
    dbRadius.textContent = det.radius>0 ? `${f(det.radius)}px` : '-';
    dbMethod.textContent   = det.covering ? det.method : (mouthBaseline ? `baseline:${mouthBaseline.n}샘플` : '기준없음');
    dbBent.textContent     = lastPosture.bent    ? 'YES' : 'NO';
    dbSitting.textContent  = lastPosture.sitting ? 'YES' : 'NO';
    dbTorso.textContent    = f(lastPosture.torsoRatio);
    if (box && dbYawBar) dbYawBar.style.setProperty('--yaw-pct', `${Math.max(0,Math.min(100,50+box.yaw*50))}%`);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = `${Math.round(frameCount*1000/(now-lastFpsTime))}`;
    frameCount=0; lastFpsTime=now;
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
    modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false,
    refineFaceLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  holistic.onResults(onResults);

  const camera = new Camera(video, {
    onFrame: async () => { await holistic.send({ image: video }); },
    width: 640, height: 480,
  });
  await camera.start();

  loadingEl.style.display = 'none';
  Logger.log('INFO', { msg: '준비 완료. 카메라를 보고 잠시 기다리면 baseline이 쌓입니다.' });
}

init().catch(err => {
  console.error(err);
  Logger.log('ERROR', { msg: err.message });
  document.querySelector('.loading-text').textContent = '오류: ' + err.message;
  document.querySelector('.loading-sub').textContent  = '카메라 권한을 확인해 주세요';
});
