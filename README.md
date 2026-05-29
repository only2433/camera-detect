# 양손 벌리기 챌린지

> 실시간 웹캠으로 양손 벌리기 + 한발 서기 자세를 5초간 유지하는지 감지하는 체험형 챌린지 앱

[![Firebase Hosting](https://img.shields.io/badge/Hosted%20on-Firebase-orange?logo=firebase)](https://camera-detect-project.web.app)
[![MediaPipe](https://img.shields.io/badge/ML-MediaPipe%20Holistic-blue?logo=google)](https://mediapipe.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📺 데모

**[https://camera-detect-project.web.app](https://camera-detect-project.web.app)**

| FAIL | GOOD | EXCELLENT |
|:---:|:---:|:---:|
| 양손 벌리기 미달 | 양손 벌리기 유지 | 양손 벌리기 + 한발 서기 유지 |
| 😅 | 👍 | 🎉 |

---

## ✨ 주요 기능

- **5초 자세 유지 판정** — 카운트다운 후 5초간 자세를 유지해야 성공 (내부 임계 4.5초)
- **실시간 양팔 벌리기 감지** — MediaPipe Pose 손목·어깨 랜드마크 기반 스팬 비율 측정
- **한발 서기 감지** — 발목 y좌표 차이 + 무릎 올림 이중 판정
- **SVG 도넛 프로그레스** — 카메라 우상단에 5초 카운트다운 링 표시 (canvas 독립 SVG)
- **실시간 조건 피드백** — HOLD 중 양손/한발 유지 시간을 실시간으로 표시
- **결과 스냅샷** — 종료 시점 카메라 캡처를 좌측 화면에 표시
- **부족 조건 안내** — 결과 화면에서 어떤 조건이 몇 초 부족했는지 구체적으로 표시
- **스켈레톤 오버레이** — 팔(파랑→초록) / 다리(주황→초록) 색상으로 감지 상태 시각화
- **디버그 패널** — 실시간 팔 비율, 발목차, 무릎 상태, JSON 로그 다운로드
- **반응형 고정 레이아웃** — 모든 상태(IDLE/COUNTDOWN/HOLD/RESULT)에서 카메라·패널 크기 고정

---

## 🎮 플로우

```
IDLE → 시작하기 → COUNTDOWN (5초) → HOLD (5초 유지) → RESULT
```

| 단계 | 설명 |
|---|---|
| **IDLE** | 대기 화면. 시작하기 버튼 클릭으로 시작 |
| **COUNTDOWN** | 5→1 카운트다운. 자세를 미리 준비 |
| **HOLD** | "START!" 표시 후 5초간 자세 유지. SVG 도넛 링이 채워짐 |
| **RESULT** | 성공/실패 판정 + 각 조건 유지 시간 표시 + 결과 사진 |

---

## 🏆 등급 판정

```
양손 벌리기 4.5초 미달                          → FAIL
양손 벌리기 4.5초 이상  AND  한발 서기 미달     → GOOD
양손 벌리기 4.5초 이상  AND  한발 서기 4.5초 이상 → EXCELLENT
```

---

## 🛠️ 기술 스택

| 분류 | 기술 |
|---|---|
| ML / 감지 | [MediaPipe Holistic](https://google.github.io/mediapipe/solutions/holistic) (Pose 33pt) |
| 프론트엔드 | Vanilla JS (ES2020), HTML5, CSS3, SVG |
| 배포 | Firebase Hosting |
| 빌드 도구 | Node.js 캐시 버스팅 스크립트 (SHA 해시 기반) |

---

## 🧠 감지 알고리즘

### 1. 양팔 벌리기 (`detectArmSpread`)

```
[판정 조건]
  - 손목 스팬 / 어깨 스팬 ≥ ARM_SPREAD_RATIO (1.7)
  - 왼손목 y ≤ 왼어깨 y + ARM_HEIGHT_SLACK (0.14)
  - 오른손목 y ≤ 오른어깨 y + ARM_HEIGHT_SLACK (0.14)
  ↑ 세 조건 모두 충족 시 "팔 벌림" 판정
```

### 2. 한발 서기 (`detectOneFootBalance`)

```
[판정 조건 - 이중 검증]
  [발목 기준]  |왼발목 y - 오른발목 y| > ANKLE_DIFF_THRESH (0.07)
  [무릎 기준]  (왼무릎 or 오른무릎) y < 골반 평균 y - KNEE_RAISE_THRESH (0.04)
  ↑ 둘 중 하나만 충족해도 "한발 서기" 판정
```

### 3. HOLD 성공 판정

```
5초 동안 실행, 각 프레임 delta time으로 누적
  holdArmAccum  : 양팔 벌림 유지 누적 시간
  holdLegAccum  : 한발 서기 유지 누적 시간
  holdBothAccum : 두 조건 동시 충족 누적 시간

성공 기준: holdArmAccum ≥ 4500ms (HOLD_SUCCESS_MS)
```

---

## 📁 프로젝트 구조

```
mouth-detector/
├── public/
│   ├── index.html        # 앱 진입점 (UI 구조, SVG 프로그레스 포함)
│   ├── app.js            # 감지 로직 + 상태 머신 (IDLE/COUNTDOWN/HOLD/RESULT)
│   ├── style.css         # 스타일 (고정 레이아웃, 반응형)
│   └── mascots/          # 마스코트 이미지 (kkomi, tobi)
├── scripts/
│   └── cache-bust.js     # 배포 전 파일 해시 자동 갱신
├── firebase.json         # Firebase Hosting 설정 (COEP/COOP 헤더 포함)
├── .firebaserc           # Firebase 프로젝트 연결
└── README.md
```

### 핵심 함수

| 함수 | 역할 |
|---|---|
| `detectArmSpread()` | 손목·어깨 스팬 비율로 양팔 벌리기 판정 |
| `detectOneFootBalance()` | 발목 y차이 + 무릎 올림으로 한발 서기 판정 |
| `drawSkeleton()` | 감지 상태에 따라 색상 변환 스켈레톤 그리기 |
| `startHold()` | HOLD 페이즈 시작, SVG 링 초기화, 타이머 설정 |
| `finishHold()` | 5초 후 누적 시간 기반 등급 판정 및 결과 화면 전환 |
| `captureSnapshot()` | 종료 시점 미러 캔버스 캡처 + 등급 배지 렌더링 |
| `onResults()` | MediaPipe 결과 수신 → 감지 → HOLD 누적 → SVG 업데이트 |

---

## 🚀 로컬 실행

```bash
# VS Code Live Server 확장 사용
# public/index.html 우클릭 → Open with Live Server

# 또는 Node.js http-server
npx http-server public -p 8080 --cors
# http://localhost:8080 접속
```

> **주의:** 웹캠 접근은 `localhost` 또는 HTTPS 환경에서만 허용됩니다.

---

## ☁️ Firebase 배포

```bash
# Firebase CLI 설치 (최초 1회)
npm install -g firebase-tools
firebase login

# 배포 (predeploy 훅이 자동으로 캐시 버스팅 실행)
firebase deploy --only hosting
```

---

## ⚙️ 파라미터 튜닝

`public/app.js` 상단 상수로 감도와 타이밍을 조정할 수 있습니다.

```js
const ARM_SPREAD_RATIO  = 1.7;    // 손목 스팬 / 어깨 스팬 임계값
const ARM_HEIGHT_SLACK  = 0.14;   // 어깨보다 이만큼 아래까지 허용
const ANKLE_DIFF_THRESH = 0.07;   // 발목 y 차이 임계값
const KNEE_RAISE_THRESH = 0.04;   // 무릎이 골반보다 이만큼 위면 올린 것

const COUNTDOWN_FROM    = 5;      // 카운트다운 초
const HOLD_DURATION_MS  = 5000;   // 자세 유지 총 시간 (ms)
const HOLD_SUCCESS_MS   = 4500;   // 성공 인정 최소 유지 시간 (ms)
```

---

## 🔒 보안 헤더

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

MediaPipe WASM 모듈의 `SharedArrayBuffer` 사용을 위한 Cross-Origin Isolation 설정입니다.

---

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능합니다.
