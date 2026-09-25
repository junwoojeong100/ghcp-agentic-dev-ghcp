# GitHub Copilot: Agentic Development in Action

**고객 문제 하나가, 출시를 판단할 수 있는 근거로 바뀌는 과정.**

CXO와 비개발자를 위한 발표·데모 키트입니다. 같은 주문 요청을 두 번 보냈을 때
중복 주문이 생기는 합성 사례를 사용합니다. 실제 결제, 고객 데이터, 배포는 없습니다.

## 먼저 볼 파일

| 용도 | 파일 |
| --- | --- |
| 발표용 PowerPoint | `presentation/GitHub-Copilot-Agentic-Development.pptx` |
| 발표용 PDF | `presentation/GitHub-Copilot-Agentic-Development.pdf` |
| 약 5분 설명 영상 | `video/Agentic-Development-Demo-KO.mp4` |
| 영상 자막 | `video/Agentic-Development-Demo-KO.srt` |
| 화면별 진행·발표 대사·복구 절차 | `DEMO-GUIDE.ko.md` |
| 실제 실행 범위·근거·한계 | `evidence/VERIFICATION.ko.md` |

PPT에는 발표자 노트와 출처가 들어 있습니다. 영상은 한국어 음성과 자막을 포함한
**사전 리허설 편집본**입니다. 영상 길이는 실제 개발 소요 시간이 아닙니다.

## 가장 쉬운 데모: 저장된 실제 결과

Node.js 22 이상이 있으면 앱 실행에 별도 패키지 설치가 필요 없습니다.

```bash
cd demo
npm run fallback
```

- 고객 화면: <http://127.0.0.1:4310/>
- 출시 판단 근거: <http://127.0.0.1:4310/presenter?tab=review>
- 종료: 실행한 터미널에서 `Ctrl+C`

고객 화면에서 **동일 요청 2회 동시 전송**을 누르면 요청은 2회, 주문은 1건입니다.
**별도의 새 주문 보내기**를 누르면 정상 주문이 추가됩니다.
근거 화면에는 `SAVED REHEARSAL`이 표시됩니다. 저장된 실제 Copilot 실행 결과를
읽는 것이며, 화면을 여는 것만으로 새 AI 요청이 발생하지 않습니다.

포트가 사용 중이면 `npm run demo -- serve reference --port 4320`으로 실행합니다.
기존 프로세스를 이름으로 일괄 종료하지 마세요.

## 실제 Copilot으로 다시 실행

Git, Node.js 22+, GitHub Copilot CLI와 사용 권한·로그인이 필요합니다.
실제 모델 호출에는 계정 정책과 사용량 과금이 적용될 수 있습니다.

```bash
cd demo
npm run demo -- prepare live-01
npm run demo -- baseline live-01
npm run demo -- plan live-01
```

`runs/live-01/.demo/01-plan.md`를 **직접 검토한 뒤에만** 다음 단계로 진행합니다.

```bash
npm run demo -- approve-plan live-01 --by presenter --note "범위와 완료 기준 확인"
npm run demo -- implement live-01
npm run demo -- verify live-01
npm run demo -- review live-01
npm run demo -- serve live-01
```

발표는 최종 판단 대기에서 마칩니다. 선택적인 로컬 판단 기록 명령은 가이드에
설명되어 있으며, 어떤 명령도 PR 생성·푸시·병합·배포를 실행하지 않습니다.

## 무엇이 실제 Copilot 기능인가

**실제 사용:** Copilot CLI의 프로그램 방식 호출, `.github/agents/*.agent.md`
역할 프로필, 도구 제한, 저장소 지침, 파일 읽기·편집.

**이 키트가 구현한 보조 기능:** 단계 실행 스크립트, 파일 인계, 로컬 승인 기록,
변경 범위 검사, 해시 기반 증거 신선도 확인, 테스트 실행, 발표용 Evidence Desk.
이 기능들은 GitHub의 내장 승인 UI나 조직 보호 규칙이 아닙니다.

**포함하지 않음:** Copilot Studio 연결, A2A 통신 프로토콜, 실제 GitHub PR,
GitHub Actions, 자동 병합·배포, 프로덕션 결제 안전성 검증.

## 재현·편집

- `demo/starter/`: 변경 전 소스와 역할 프로필
- `demo/reference/`: 실제 리허설의 변경 후 소스와 산출물
- `demo/reference-manifest.json`: 저장본 무결성 확인용 SHA-256 목록
- `demo/acceptance/`: 구현 에이전트가 수정할 수 없는 업무 기준 테스트
- `demo/scripts/`: 발표·단계 실행 보조 도구
- `tools/browser-check.mjs`: 실제 브라우저 동작과 화면 캡처
- `presentation/build_slides.py`: 편집 가능한 슬라이드 생성 소스
- `video/`: 편집된 설명 영상·자막·대본

```bash
# 앱/제어 흐름: 외부 패키지 설치 불필요
npm --prefix demo test
npm --prefix demo run demo -- check-reference

# 제작자용 브라우저 검증: Chrome과 개발 의존성 필요
npm ci
npm run test:browser
```

PowerPoint 재생성에는 Python의 `python-pptx`와 `Pillow`가 필요합니다.
PDF 변환은 LibreOffice, 영상 재생성은 FFmpeg와 macOS 한국어 음성을 사용합니다.
구체적인 실행 조건은 가이드와 검증 기록을 참고하세요.
