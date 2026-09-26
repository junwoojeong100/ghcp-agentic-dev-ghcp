# 검증 기록 · CXO 브리핑과 실제 Copilot CLI

**확인 시각:** 2026-09-26T11:42:22+09:00

## 결론

CXO 고객을 위한 GitHub Copilot 발표를 개발 생산성, 가치 전달 속도, 품질 리스크,
통제 가능한 AI 도입 중심으로 구성했다. **경영진 본편 12장 + 기술 부록 6장**이다.
기대하는 사업 가치와 실제 관찰한 작업 위임·승인·결과를 구분한다.
조직의 생산성·매출·비용 절감률이나 ROI를 측정한 실험은 아니다.

데모 영상에는 **실제 Copilot CLI의 원본 터미널 출력과 네이티브 파일 편집 승인창**이
나온다. 별도 제작한 Evidence Desk로 제품 UI를 대체하지 않았다.
동일 요청 2회는 주문 1건으로 처리되며, 별도 새 주문은 정상 추가된다.
실제 CLI 재작업까지 반영한 동일 소스로 브라우저 장면을 촬영했다.

**승인 입력은 자동 리허설이다. 실제 사람·조직의 승인으로 표현하지 않는다.**
라이브 `session` 명령은 발표자의 직접 입력을 기다린다.
최종 출시 판단은 미기록이며 PR 생성·푸시·병합·배포가 없다.

## 실제 실행 결과

| 항목 | 관측 결과 | 근거 |
| --- | --- | --- |
| 변경 전 기존 테스트 | 6/6 통과 | `demo/cli-reference/.demo/00-baseline.tap` |
| 변경 전 새 업무 기준 | 9개 실패 | 같은 파일의 acceptance suite |
| 최종 회귀 테스트 | 17/17 통과 | `.demo/03-tests.tap` |
| 고정한 업무 기준 | 16/16 통과 | `demo/acceptance/duplicate-order.test.mjs` |
| 실제 브라우저 | 11개 통과 | `evidence/browser-check.json` |
| 승인·범위·신선도 제어 | 17/17 통과 | `evidence/control-check.json` |
| 실제 편집 승인 입력 | 13회, 전면 허용 없이 이번만 허용 | 원본 `actions.jsonl` |
| PowerPoint/PDF | 18장, 노트·렌더링 텍스트 확인 | `evidence/deck-check.json` |
| 영상 | 300.021초, 1920×1080, H.264/AAC | `evidence/video-check.json` |
| 원본 터미널 기반 장면 | 212초, 70.7% | 제품 UI와 로컬 승인/테스트 출력 포함 |
| 한국어 음성·자막 | 자막 37구간, 로컬 합성 | 영상·SRT·`video/narration.json` |
| 새 폴더에서 ZIP 실행 | 의존성 설치 없이 저장본 테스트·동시 요청·새 주문·승인 대기 확인 | `evidence/package-check.json` |

## 원본 녹화와 편집의 경계

| 원본 | 녹화 길이 | 워크플로 종료 코드 | 의미 |
| --- | --- | --- | --- |
| `cli-take-02` | 437.215초 | 0 | 실제 실행·검증 완료 |
| `cli-take-02-rework` | 194.447초 | 1 | 실제 테스트 실패 포함, 다음 재작업에서 해결 |
| `cli-take-02-rework-02` | 85.620초 | 0 | 실제 실행·검증 완료 |
| `cli-take-02-review` | 54.448초 | 0 | 실제 실행·검증 완료 |

모두 실제 `copilot --agent … --interactive …`를 실행한 PTY 출력이다.
`session.cast`에는 원본 ANSI 출력, `actions.jsonl`에는 입력 시각·출처,
`capture.json`에는 실제 CLI 세션 ID·프로세스 결과·해시를 남겼다.
실패한 재작업도 성공한 것처럼 바꾸거나 숨겨서 삭제하지 않았다.

`video/terminal/edit.json`이 원본 구간과 영상 길이, 스크린샷 출처를 정의한다.
xterm.js는 원본 출력을 렌더링할 뿐 가짜 에이전트 응답이나 승인 UI를 넣지 않는다.
대기·중복 출력은 편집·가속했고 일부 원본 프레임은 설명을 위해 유지했다.
**영상 5분이나 원본 녹화 길이는 순수 개발 시간·제품 응답 성능을 뜻하지 않는다.**

## 실제 재작업 기록

1. 첫 구현은 저장소 14개, 업무 기준 16개의 서버 중심 테스트를 통과했다.
2. 첫 검토는 브라우저 미확인을 명시하고 사람 검토 준비 권고를 했다.
3. 별도 브라우저 확인에서 오류 코드 안내 누락과 실패 시 정상 배너를 관찰했다.
   이 결함을 검토 에이전트가 먼저 발견했다고 주장하지 않는다.
4. 실패 기록을 실제 구현 역할에게 전달하고 네이티브 승인을 거쳐 UI와 회귀
   테스트를 수정했다. 이 재작업의 테스트에는 구문 오류가 있어 검증이 실패했다.
5. 그 실제 테스트 실패도 다시 인계했다. 테스트를 삭제·완화하지 않고 실제
   Copilot CLI로 수정한 뒤 회귀 17개, 업무 기준 16개,
   브라우저 11개를 다시 확인했다.
6. 최종 검토는 현재 테스트와 브라우저 기록의 일치 및 남은 운영 한계를 읽고
   `READY_FOR_HUMAN_REVIEW`를 반환했다. 출시 승인은 기록하지 않았다.

첫 기록: `demo/cli-reference/.demo/history/iteration-01/`.
테스트가 실패한 재작업: `demo/cli-reference/.demo/history/iteration-02/`.
최종 기록: `demo/cli-reference/.demo/`.
검토 에이전트는 브라우저 JSON 근거를 읽었다. 스크린샷을 직접 확인하지 못했다는
실제 응답도 그대로 보존했다. 재검토 시 언급한 기존 `04-review.md`는 이전 검토이며,
최종 응답 저장 전 시점의 관찰이다. 브라우저 화면 자체는 별도 자동 확인을 수행했다.

## 현재 소스에서 확인한 고객 동작

- 변경 전 같은 동시 요청 2회 → 주문 2건.
- 변경 후 같은 동시 요청 2회 → 주문 1건, 동일한 주문번호, 기존 결과 재사용 표시.
- 별도 새 주문 → 누적 요청 3회, 정상 주문 2건.
- 이후 재전송, 일반 버튼의 중복 클릭 억제, 새 주문을 첫 동작으로 보내는 경우.
- 테스트용 503 응답의 오류 코드·실패 상태와 재시도 회복.
- 일부 요청만 실패한 경우의 오류 표시와 이후 정상 재전송.
- 주문 목록 조회 실패 후 정상 배너 잔류 방지와 재시도 회복.
- 브라우저 JavaScript 오류 없음, 보조 화면의 저장본/최종 판단 대기 표시.

503 장애는 오류 처리 확인을 위해 의도적으로 주입한 테스트 응답이다.
실제 고객사 장애 기록이나 운영 결제 검증은 아니다.

## 제품 기능과 보조 도구

**실제 Copilot:** 네이티브 터미널 UI, custom agent 역할 프로필, 파일 읽기·편집,
읽기 전용 검토, 파일 편집 권한 요청.

**이 키트의 구현:** 역할별 CLI 실행 순서·파일 인계, 범위 승인 문구, 로컬 승인
기록, 파일 범위·해시 검사, Node.js 테스트 실행, PTY 녹화·영상 편집, Evidence Desk.
로컬 승인 기록은 신원 인증·조직 승인·변조 방지 감사 로그·보안 격리를 대신하지 않는다.

전용 `COPILOT_HOME`에서 수동 승인 모드를 사용하고, 인증 토큰은 자식 프로세스
환경으로만 전달한다. 개인 CLI 설정·훅·IDE 승인을 수정하지 않는다.
배포 ZIP에는 전용 CLI 홈이나 인증 설정이 들어가지 않는다.
Copilot Studio·A2A 프로토콜·GitHub Actions·자동 병합/배포 연결은 하지 않았다.

## 환경·재현·무결성

- 실제 GitHub Copilot CLI 1.0.88, Node.js v22.16.0.
- Chrome 154.0.8037.58; Playwright와 xterm.js는 루트 lockfile에 고정.
- 브라우저 녹화와 터미널 영상 렌더링은 Playwright **headless**다. 이후 재녹화도
  창을 띄우지 않는 같은 방식을 사용한다.
- PowerPoint: python-pptx. PDF: LibreOffice. CJK 폰트 이슈 시 PDF를 사용한다.
- 영상: 실제 CLI PTY·실제 브라우저·설명 그래픽. 한국어 Yuna 음성은 macOS에서
  로컬 합성했고 외부 음성 서비스에 코드를 보내지 않았다.
- 음성: -18.06 LUFS, true peak -1.59 dBTP.
- 합성 주문이며 실제 결제·환불·고객 데이터·PR·배포 없음.
- 모델을 고정하지 않았으므로 재실행의 표현·시간·결과는 달라질 수 있다.

최종 소스 SHA-256: `3a35b30aa84720f645f3637e01316f2921393d9d44708623799dcf5001482e9e`

`demo/cli-reference-manifest.json`이 이번 촬영 소스와 로그의 파일별 해시다.
`demo/reference`와 기존 manifest는 이전 프로그램 방식 리허설의 보존본이며
이번 촬영 결과와 혼동하지 않는다.

```bash
npm test
python3 tools/test_capture_cli.py
node demo/scripts/workflow.mjs check-reference cli-reference
node tools/verify-terminal.mjs
python3 tools/validate_deck.py
python3 tools/verify_video.py
python3 tools/finalize-kit.py
python3 tools/verify_package.py
```

## CXO 설명의 경계와 참고 자료

생산성·리드타임·품질·투자 가치는 조직 파일럿의 측정 대상이다. 사용량·채택률
증가만으로 ROI를 입증하지 않는다. 회수한 시간의 가치와 실제 현금 지출 절감도
구분한다. 기존 GitHub Copilot usage metrics는 참고 데이터이며 이 키트에서
조직 metrics에 연결하거나 조직 성과를 조회한 것은 아니다.

현재 구현은 단일 프로세스 메모리다. 영속성·다중 인스턴스·키 수명·사용자 인증·
실제 결제 연동은 별도 검증이 필요하다. 테스트와 AI 검토는 결함 부재의 보증이 아니다.

- [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
- [Custom agents](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Copilot usage metrics](https://docs.github.com/en/copilot/concepts/billing-and-usage/copilot-usage-metrics/copilot-metrics)
- 설치된 `copilot --help`, `copilot help permissions`, `copilot help config`
