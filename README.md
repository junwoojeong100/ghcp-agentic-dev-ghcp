# GitHub Copilot CLI · 실제 실행과 승인으로 문제 해결

**CXO 고객 브리핑: GitHub Copilot으로 개발 생산성을 비즈니스 실행력으로.**

발표 본편은 **개발 생산성·가치 전달 속도·품질 리스크·통제 가능한 AI 도입**을
중심으로 구성하고, 기술 상세는 부록으로 분리했습니다.
서두에는 **Copilot이 무엇인지, 사용 서피스, 작업 모드, 에이전트 활용·확장 기능**을
소개하는 5장을 추가했습니다. 전체는 **23장: 경영진 본편 17장 + 기술 부록 6장**입니다.
실제 GitHub Copilot CLI가 저장소를 읽고, 계획을 만들고, **네이티브 파일 편집
승인창**을 거쳐 코드를 수정하는 발표·데모 키트입니다. 별도로 만든 대시보드를
Copilot 제품 화면처럼 보여 주지 않습니다.

| 산출물 | 파일 |
| --- | --- |
| 편집 가능한 PowerPoint · 발표자 노트 포함 | `presentation/GitHub-Copilot-Agentic-Development.pptx` |
| PDF 대체본 | `presentation/GitHub-Copilot-Agentic-Development.pdf` |
| 5분 실제 CLI 중심 영상 · 한국어 음성/자막 | `video/Agentic-Development-Demo-KO.mp4` |
| 자막 / 장면별 대본 | `video/Agentic-Development-Demo-KO.srt`, `video/narration.json` |
| 실연·발표 대사·복구 절차 | `DEMO-GUIDE.ko.md` |
| 원본 터미널 출력·입력 출처 | `video/terminal/` |
| 실제 실행 범위·한계 | `evidence/VERIFICATION.ko.md` |

표지 다음 2~6장은 제품 개요입니다. IDE·CLI·GitHub.com·Copilot app·GitHub Mobile,
Ask·Plan·Agent·지원 환경의 Edit 및 CLI의 Interactive·Plan·Autopilot을 구분합니다.
Cloud agent, Copilot code review, Custom agents, Subagents/Fleet, Skills, MCP,
Hooks의 소개와 **이번 영상에서 실제 사용한 기능**도 구분합니다. 발표자 노트에
공식 출처와 클라이언트별 지원 차이를 적었습니다. 기존 5분 영상은 변경하지 않았습니다.

영상은 **실제 CLI 프로세스의 PTY 출력**을 녹화해 편집했습니다. 터미널 렌더러는
원본 출력을 재생할 뿐, 에이전트 응답이나 승인 UI를 만들어 넣지 않습니다.
**승인 키 입력은 자동 리허설이며 실제 사람·조직의 승인이 아닙니다.** 라이브
명령은 발표자의 직접 입력을 기다립니다. 5분은 개발 소요 시간이 아닙니다.

## 실제 CLI + 사용자 승인으로 실연

Git, Node.js 22+, GitHub Copilot CLI, `gh` 로그인 또는 환경 변수의
`COPILOT_GITHUB_TOKEN`이 필요합니다. 실제 모델 사용에는 계정 정책·사용량 과금이
적용될 수 있습니다.

```bash
cd demo
npm run demo -- session live-01
```

1. **계획:** 실제 `demo-planner`가 요청·코드·테스트를 읽습니다.
2. **범위 승인:** 계획 응답 후 `/exit`. 계획을 확인하고 `APPROVE ORDER-001`을
   직접 입력합니다. 다른 입력이면 구현하지 않고 중단합니다.
3. **파일 편집 승인:** 실제 `demo-implementer`의 변경안을 보고 각 네이티브
   승인창에서 **`1. Yes`**를 선택합니다. 전면 허용은 사용하지 않습니다.
4. **검증·검토:** 구현 응답 후 `/exit`. 로컬 테스트가 실행되고 실제
   `demo-reviewer`가 변경·결과를 검토합니다. 마지막 `/exit` 후 **출시 판단 대기**로
   끝납니다. 브라우저 확인은 별도이며 실제 PR·병합·배포는 하지 않습니다.

역할별 실행은 각각 실제 Copilot CLI 세션입니다. 로컬 실행 도구가 파일로
산출물을 인계합니다. 사용자 전역 CLI 설정을 바꾸지 않고 전용 `COPILOT_HOME`에서
수동 승인 모드를 사용합니다. 인증 토큰은 자식 프로세스 환경으로만 전달합니다.
기존 작업 공간은 덮어쓰지 않으므로 재실연에는 `live-02`처럼 새 ID를 사용합니다.

## 바로 확인할 오프라인 결과

녹화된 CLI가 실제로 변경하고 재작업한 최종 소스입니다. 앱에는 외부 패키지가
필요하지 않습니다.

```bash
cd demo
npm run demo -- check-reference cli-reference
npm run fallback
```

<http://127.0.0.1:4310/>에서 **동일 요청 2회 동시 전송**을 누르면 주문은 1건,
**별도의 새 주문 보내기**를 누르면 새 주문이 추가됩니다. `/presenter`는 저장된
근거를 읽는 **보조 화면**이며 Copilot 제품 UI가 아닙니다. 종료는 `Ctrl+C`.

포트 충돌 시 `npm run demo -- serve cli-reference --port 4320`을 사용합니다.
다른 사용자의 프로세스를 종료하지 마세요.

## Copilot의 이점을 보여 주는 흐름

**저장소 맥락 이해 → 실제 여러 파일 변경 → 승인 기반 통제 → 검토 가능한 근거**.
계획·구현·검토를 역할별로 나누되, 완료 기준과 최종 책임은 사람에게 남깁니다.
첫 구현의 서버 테스트가 통과한 뒤 브라우저에서 발견한 실패도 숨기지 않고
**실제 CLI 재수정과 재확인**으로 연결했습니다.

| 실제 Copilot 기능 | 키트의 로컬 보조 도구 |
| --- | --- |
| CLI 원본 UI, custom agent 프로필, 파일 읽기·편집·검토, 네이티브 편집 권한 요청 | 역할 순서·파일 인계, 범위 승인 문구, 테스트 실행, 변경 범위·해시 검사, PTY 녹화·영상 편집 |

조직 인증·보안 샌드박스·GitHub PR/Actions·자동 배포·Copilot Studio·A2A 프로토콜을
구현한 데모는 아닙니다. 합성 주문과 단일 프로세스 메모리를 사용하며 실제
결제·고객 데이터는 없습니다. 생산성·매출·비용 절감률을 측정한 실험도 아닙니다.

## 구성과 재제작

- `demo/starter/`: 변경 전 소스·역할 프로필·요청서
- `demo/cli-reference/`: **이번 CLI 영상의 최종 소스·로그·재작업 기록**
- `demo/reference/`: 이전 프로그램 방식 리허설 보존본
- `demo/acceptance/`: 구현 역할이 수정할 수 없는 업무 기준 테스트
- `tools/capture-cli.py`: 실제 터미널 녹화; 기본은 사람 입력, `--rehearsal`만 자동 입력
- `video/terminal/edit.json`: 원본별 구간·편집 시간·슬라이드 스크린샷 출처
- `presentation/build_slides.py`: PowerPoint 생성 소스

```bash
# 앱/승인 흐름 확인: 외부 패키지 불필요
npm test
python3 tools/test_capture_cli.py

# 제작자용: 실제 브라우저 확인 및 원본 터미널 재생
npm ci
node tools/render-terminal.mjs --run cli-take-02 --serve
```

슬라이드는 `python-pptx`·Pillow, PDF는 LibreOffice, 영상은 FFmpeg·macOS Yuna 음성을
사용합니다. 자세한 녹화·재작업·재제작 절차는 `DEMO-GUIDE.ko.md`와
`video/README.ko.md`에 있습니다.

미리보기·중간 캐시는 배포 파일이 아닙니다. 슬라이드 확인용 PNG와 모아보기는
`presentation/rendered/`, 영상 확인용 프레임은 `video/work/preview/`에 생성되며
Git과 발표 키트 ZIP에서 제외됩니다. `demo/runs/`는 재실연 시 만드는 작업폴더입니다.
완성된 발표 파일, `video/terminal/`의 실제 CLI 원본, 저장본의 검증 기록은 보존합니다.
