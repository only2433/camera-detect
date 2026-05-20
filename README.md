# 🚒 화재 대피 훈련 — 코·입 가리기 챌린지

> 실시간 웹캠으로 화재 대피 자세(코·입 가리기)를 인식하고 점수를 부여하는 체험형 훈련 앱

[![Firebase Hosting](https://img.shields.io/badge/Hosted%20on-Firebase-orange?logo=firebase)](https://camera-detect-project.web.app)
[![MediaPipe](https://img.shields.io/badge/ML-MediaPipe%20Holistic-blue?logo=google)](https://mediapipe.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📺 데모

**[https://camera-detect-project.web.app](https://camera-detect-project.web.app)**

| FAIL | GOOD | EXCELLENT |
|:---:|:---:|:---:|
| 코·입 미가림 | 코·입만 가림 | 코·입 가림 + 자세 |
| 😶 | 👍 | 🎉 |

---

## ✨ 주요 기능

- **실시간 코·입 가리기 감지** — MediaPipe 손 랜드마크 기반 박스 감지 + 픽셀 색상/분산 비교 이중 확인
- **자세 감지** — 허리 숙이기(Face Pitch) + 앉기(무릎·골반 랜드마크) 인식
- **3단계 등급 판정** — FAIL / GOOD / EXCELLENT
- **찰칵 스냅** — 카운트다운 후 순간 캡처, 결과 미리보기 이미지 저장
- **디버그 패널** — 실시간 Yaw/Pitch, 손 거리, 감지 수치, JSON 로그 다운로드
- **반응형 UI** — 모바일/태블릿 대응 (680px 브레이크포인트)

---

## 🛠️ 기술 스택

| 분류 | 기술 |
|---|---|
| ML / 감지 | [MediaPipe Holistic](https://google.github.io/mediapipe/solutions/holistic) (Face Mesh 468pt + Hand 21pt + Pose 33pt) |
| 프론트엔드 | Vanilla JS (ES2020), HTML5, CSS3 |
| 배포 | Firebase Hosting |
| 빌드 도구 | Node.js 캐시 버스팅 스크립트 (해시 기반) |

---

## 🧠 감지 알고리즘

### 1. 코·입 가리기 (이중 검증)

```
[1차] 손 랜드마크 박스 감지
  - 코·입 랜드마크(NOSE_MOUTH_IDX) 기준 바운딩 박스 계산
  - Yaw/Pitch에 따라 박스를 비대칭 확장 (측면 얼굴 보정)
  - 박스 내 손 포인트 수 ≥ 2  OR  중심 거리 < 반경  → 가림 판정

[2차] 픽셀 색상·분산 비교
  - IDLE 중 손 없을 때 코·입 영역 베이스라인 축적 (최근 20프레임 평균)
  - 찰칵 순간: colorDiff > 25 AND varDrop > 300 → 가림 판정
  - AND 조건으로 조명 변화 오감지 방지
```

### 2. 자세 감지

```
[허리 숙임]  Face Pitch > 0.30  (얼굴이 아래를 향하는 정도)

[앉기]       무릎 랜드마크 가시성 > 0.3
              → (hipY - kneeY) < 0.05  (무릎이 골반 높이까지 올라옴)
             무릎 불가시
              → (hipY - shoulderY) / faceH < 2.0  (토르소 압축 비율)
```

### 3. 등급 판정

```
covering = false                          → FAIL
covering = true  AND  자세 미충족          → GOOD
covering = true  AND  (허리숙임 OR 앉기)   → EXCELLENT
```

---

## 📁 프로젝트 구조

```
camera-detect/
├── public/
│   ├── index.html        # 앱 진입점 (UI 구조)
│   ├── app.js            # 감지 로직 + 게임 상태 머신
│   └── style.css         # 스타일 (다크 테마, 반응형)
├── scripts/
│   └── cache-bust.js     # 배포 전 파일 해시 자동 갱신
├── firebase.json         # Firebase Hosting 설정 (COEP/COOP 헤더 포함)
├── .firebaserc           # Firebase 프로젝트 연결
└── README.md
```

### 핵심 파일 설명

**`public/app.js`**

| 함수 | 역할 |
|---|---|
| `estimateFaceMetrics()` | Yaw / Pitch / faceH 계산 |
| `getMouthBox()` | 코·입 감지 바운딩 박스 (Yaw·Pitch 보정 포함) |
| `detectByHand()` | 손 랜드마크 기반 가림 판정 |
| `detectByPixels()` | 픽셀 색상·분산 비교 |
| `detectPosture()` | 허리 숙임 / 앉기 감지 |
| `captureSnapshot()` | 찰칵 순간 캔버스 캡처 |
| `onResults()` | MediaPipe 결과 수신 + 전체 감지 파이프라인 |

---

## 🚀 로컬 실행

별도 빌드 없이 정적 파일 서버로 실행 가능합니다.

```bash
# 방법 1: VS Code Live Server 확장 사용
# public/index.html 우클릭 → Open with Live Server

# 방법 2: Node.js http-server
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

`firebase.json`의 `predeploy` 훅이 `scripts/cache-bust.js`를 실행해  
`app.js`와 `style.css`의 SHA-256 해시를 `index.html`에 자동 반영합니다.

---

## ⚙️ 파라미터 튜닝

`public/app.js` 상단의 상수로 감도를 조정할 수 있습니다.

```js
// 손 감지
const BOX_BASE_EXPAND   = 0.65;   // 기본 박스 확장 비율
const MIN_PTS_IN_BOX    = 2;      // 박스 내 최소 손 포인트 수

// 픽셀 감지
const COLOR_DIFF_THRESH    = 25;  // RGB 유클리드 거리 임계값
const VARIANCE_DROP_THRESH = 300; // 분산 감소 임계값
const BASELINE_WINDOW      = 20;  // 베이스라인 평균 프레임 수

// 자세 감지
const BEND_PITCH_THRESH = 0.30;   // 허리 숙임 판정 Pitch 값
const SIT_TORSO_RATIO   = 2.0;    // 앉기 판정 토르소/얼굴 비율
```

디버그 패널(화면 하단 버튼)에서 실시간 수치를 확인하며 튜닝하세요.

---

## 🔒 보안 헤더

Firebase Hosting에서 다음 헤더를 전체 경로에 적용합니다.

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

MediaPipe WASM 모듈의 `SharedArrayBuffer` 사용을 위한 Cross-Origin Isolation 설정입니다.

---

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포 가능합니다.
