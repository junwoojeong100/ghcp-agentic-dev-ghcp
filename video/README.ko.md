# 실제 GitHub Copilot CLI 데모 영상

**`Agentic-Development-Demo-KO.mp4`를 재생하면 됩니다.** 1920×1080, H.264/AAC,
5분, 한국어 로컬 합성 음성과 화면 자막을 포함합니다. 원본 터미널 기반 장면은
총 212초로 영상의 70% 이상이며, Copilot 제품 UI와 로컬 범위 승인·테스트 출력을
포함합니다. 별도 자막은 `.srt`, 대본은 `narration.json`입니다.

## 어떤 화면인가

- 실제 `copilot --agent … --interactive …` 프로세스의 PTY 출력을 녹화했다.
- 원본: `terminal/cli-take-02/`, 실제 재작업: `terminal/cli-take-02-rework/`,
  테스트 구문 오류 재수정: `terminal/cli-take-02-rework-02/`,
  최종 검토: `terminal/cli-take-02-review/`.
- 각 폴더의 `session.cast`는 원본 출력, `actions.jsonl`은 입력의 시각·출처,
  `capture.json`은 실행 명령·CLI 세션 ID·무결성 해시다.
- **승인 키 입력은 자동 리허설**이다. 실제 사람·조직의 승인이 아니다.
  라이브 `npm run demo -- session live-01`은 발표자의 직접 입력을 기다린다.
- xterm.js는 원본 ANSI 출력을 렌더링할 뿐이다. 응답·권한 UI·성공 결과를
  만들어 넣지 않는다. 네이티브 승인창과 역할별 실제 CLI 하단 표시를 유지한다.
- `terminal/edit.json`에 원본 구간·설명용 길이·스크린샷 출처를 남긴다.
  대기·반복 출력은 잘라내거나 가속했고 일부 원본 프레임은 설명을 위해 유지했다.
- 첫 서버 테스트 통과 뒤 실제 브라우저에서 발견한 실패와 CLI 재수정을 포함한다.
  재작업 중 테스트 구문 오류와 그 실제 재수정도 원본에 보존한다.
  최종 앱 영상은 이 재수정까지 반영한 **동일 소스 해시**의 앱이다.

영상 길이는 실제 개발 소요 시간이 아니다. 실제 결제·고객 데이터·배포가 없고,
현재 샘플은 단일 프로세스 메모리 구현이다.

## 새로운 실제 실행 녹화

**이후 녹화도 Playwright headless 방식으로 진행한다.** 브라우저 창이나 데스크톱을
직접 조작하지 않는다. `tools/record-demo.mjs`와 `tools/render-terminal.mjs`는
모두 `chromium.launch({ headless: true })`를 사용한다. 실제 CLI는 PTY 원본을
녹화하고, 그 출력을 headless 브라우저의 터미널 렌더러에서 영상으로 만든다.
CLI 동작을 브라우저용 가짜 화면으로 대체한다는 의미가 아니다.

macOS/Linux의 PTY, Python 3, Node.js 22+, 실제 Copilot CLI, `gh` 로그인 또는
환경 변수의 인증 토큰이 필요하다. 기본 모드는 사람이 입력하는 녹화다.

```bash
# 키트 루트, 실제 터미널에서
python3 tools/capture-cli.py live-recording-01

# 제작용 자동 리허설: 인간 승인이 아님을 녹화와 자료에 명시
python3 tools/capture-cli.py rehearsal-01 --rehearsal

# 기존 실행에서 실패 근거를 반영한 재작업과 최종 검토 녹화
python3 tools/capture-cli.py rehearsal-01 --stage rework --rehearsal
python3 tools/capture-cli.py rehearsal-01 --stage review --rehearsal
```

녹화는 기존 실행·원본을 덮어쓰지 않는다. 자동 리허설은 실제 기록에 나타난
허용 파일의 `apply_patch`와 네이티브 `1. Yes` 선택을 확인한 경우에만 진행한다.
알 수 없는 메뉴를 전면 허용하지 않는다. 준비 과정에서 녹화 도구를 확인한
진단용 중단 실행은 본 영상에 사용하지 않는다.

## 영상과 슬라이드 재제작

Python의 `python-pptx`, Pillow, PyMuPDF, FFmpeg/FFprobe, LibreOffice, macOS 한국어
`Yuna` 음성, Chrome, 루트의 `npm ci`가 필요하다. 음성·자막 생성은 로컬에서 수행한다.

1. 원본과 `terminal/edit.json`, 최종 `demo/cli-reference`를 준비한다.
2. 변경 전 앱을 4311, 최종 `cli-reference`를 4312에서 실행한다.
3. 아래를 실행한다.

```bash
npm ci
python3 video/produce.py --audio-only
node tools/render-terminal.mjs
BEFORE_URL=http://127.0.0.1:4311 AFTER_URL=http://127.0.0.1:4312 node tools/record-demo.mjs
python3 video/produce.py --render-only
python3 presentation/build_slides.py
```

터미널 렌더링 단계는 슬라이드용 실제 CLI 스크린샷도 생성한다. 브라우저 녹화는
최종 CLI 소스와 해시가 다르거나 실제 주문 결과가 다르면 실패한다.
상세 검증·PDF 변환·패키지 근거는 `../evidence/VERIFICATION.ko.md`에 있다.
