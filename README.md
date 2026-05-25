# 🚒 화재 대피 훈련 — 양팔 벌리기 + 한발 서기 챌린지

> 실시간 웹캠으로 화재 대피 자세(양팔 벌리기 + 한발 서기)를 인식하고 점수를 부여하는 체험형 훈련 앱

[![Firebase Hosting](https://img.shields.io/badge/Hosted%20on-Firebase-orange?logo=firebase)](https://camera-detect-project.web.app)
[![MediaPipe](https://img.shields.io/badge/ML-MediaPipe%20Holistic-blue?logo=google)](https://mediapipe.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📺 데모

**[https://camera-detect-project.web.app](https://camera-detect-project.web.app)**

| FAIL | GOOD | EXCELLENT |
|:---:|:---:|:---:|
| 팔 미벌림 | 양팔만 벌림 | 양팔 벌림 + 한발 서기 |
| 😅 | 👍 | 🎉 |

---

## ✨ 주요 기능

- **실시간 양팔 벌리기 감지** — MediaPipe Pose 손목·어깨 랜드마크 기반 스팬 비율 측정
- **한발 서기 감지** — 발목 y좌표 차이 + 무릎 올림 이중 판정
- **3단계 등급 판정** — FAIL / GOOD / EXCELLENT
- **찰칵 스냅** — 카운트다운 후 순간 캡처, 결과 미리보기 이미지 저장
- **스켈레톤 오버레이** — 팔(파랑→초록) / 다리(주황→초록) 색상으로 감지 상태 시각화
- **디버그 패널** — 실시간 팔 비율, 발목차, 무릎 상태, JSON 로그 다운로드
- **반응형 UI** — 모바일/태블릿 대응 (680px 브레이크포인트)

---

## 🛠️ 기술 스택

| 분류 | 기술 |
|---|---|
| ML / 감지 | [MediaPipe Holistic](https://google.github.io/mediapipe/solutions/holistic) (Pose 33pt) |
| 프론트엔드 | Vanilla JS (ES2020), HTML5, CSS3 |
| 배포 | Firebase Hosting |
| 빌드 도구 | Node.js 캐시 버스팅 스크립트 (해시 기반) |

---

## 🧠 감지 알고리즘

### 1. 양팔 벌리기 (`detectArmSpread`)

```
[판정 조건]
  - 손목 스팬 / 어깨 스팬 ≥ ARM_SPREAD_RATIO (1.7)
  - 왼손목 y ≤ 왼어깨 y + ARM_HEIGHT_SLACK (0.14)  → 왼팔 수평 이상
  - 오른손목 y ≤ 오른어깨 y + ARM_HEIGHT_SLACK (0.14)  → 오른팔 수평 이상
  ↑ 세 조건 모두 충족 시 "팔 벌림" 판정
```

### 2. 한발 서기 (`detectOneFootBalance`)

```
[판정 조건 - 이중 검증]
  [발목 기준]  발목 가시성 > 0.2
               AND |왼발목 y - 오른발목 y| > ANKLE_DIFF_THRESH (0.07)
  [무릎 기준]  무릎 가시성 > 0.3
               AND (왼무릎 or 오른무릎) y < 골반 평균 y - KNEE_RAISE_THRESH (0.04)
  ↑ 둘 중 하나만 충족해도 "한발 서기" 판정
```

### 3. 등급 판정

```
armsSpread = false                          → FAIL
armsSpread = true  AND  oneFoot = false     → GOOD
armsSpread = true  AND  oneFoot = true      → EXCELLENT
```

---

## 📁 프로젝트 구조

```
mouth-detector/
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
| `detectArmSpread()` | 손목·어깨 스팬 비율로 양팔 벌리기 판정 |
| `detectOneFootBalance()` | 발목 y차이 + 무릎 올림으로 한발 서기 판정 |
| `drawSkeleton()` | 감지 상태에 따라 색상 변환 스켈레톤 그리기 |
| `captureSnapshot()` | 찰칵 순간 미러 캔버스 캡처 + 배지 렌더링 |
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
// 팔 벌리기 감지
const ARM_SPREAD_RATIO  = 1.7;   // 손목 스팬 / 어깨 스팬 임계값
const ARM_HEIGHT_SLACK  = 0.14;  // 어깨보다 이만큼 아래까지 허용 (정규화 y 단위)

// 한발 서기 감지
const ANKLE_DIFF_THRESH = 0.07;  // 발목 y 차이 임계값
const KNEE_RAISE_THRESH = 0.04;  // 무릎이 골반보다 이만큼 위면 올린 것으로 판정
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
