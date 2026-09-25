# 검증 기록 · 실제 실행과 표현의 경계

**확인 시각:** 2026-09-26T08:57:01+09:00

## 결론

로컬 합성 주문 데모에서 같은 요청의 재전송은 한 주문으로 수렴하고,
별도의 새 주문은 유지되는 것을 확인했다. 실제 Copilot CLI의 계획·구현·검토와
재작업 기록을 보존했다. **최종 사람 판단은 미기록이며 PR 생성·병합·배포는 없다.**

## 실행 결과

| 확인 항목 | 관측 결과 | 근거 |
| --- | --- | --- |
| 변경 전 기존 테스트 | 6/6 통과 | `demo/reference/.demo/00-baseline.tap` |
| 변경 전 새 업무 기준 | 9개 실패 — 의도한 결함 재현 | 같은 파일의 acceptance suite |
| 최종 저장소/회귀 테스트 | 17/17 통과 | `demo/reference/.demo/03-tests.tap` |
| 사람이 고정한 업무 기준 | 16/16 통과 | `demo/acceptance/duplicate-order.test.mjs` |
| 실제 브라우저 확인 | 9개 확인 통과 | `evidence/browser-check.json` |
| 단계 제어 | 12/12 통과 | `evidence/control-check.json`, `controller-tests.tap` |
| PowerPoint/PDF | 17장, 전 슬라이드 노트 있음, 렌더링 텍스트 누락·페이지 밖 텍스트 없음 | `evidence/deck-check.json` |
| 영상 | 300.021초, 1920×1080, H.264/AAC, 한국어 자막 37구간 | `evidence/video-check.json` |
| 실제 화면 녹화 | 5개 장면 | `evidence/video-recording.json` |
| 새 폴더에서 저장본 실행 | 추가 패키지 설치 없이 테스트·동시 재전송·새 주문·승인 대기 확인 | `evidence/package-check.json` |

변경 전 실패는 미완성 납품이 아니라 비교를 위한 기준선이다.
최종 저장본은 위의 업무 기준·회귀·브라우저 확인을 통과했다.
제어 테스트는 명시적인 테스트용 가상 계획을 사용하는 단위 테스트이며,
실제 Copilot 응답 기록과 혼동하지 않는다.

## 실제 재작업

1. 첫 구현은 저장소 13개와 업무 기준 16개의 서버 중심 테스트를 통과했다.
2. 읽기 전용 검토 역할이 `CHANGES_REQUESTED`를 반환했다. 주문 전송이 실패해도
   결과 배너는 정상이라고 표시될 수 있다는 지적이었다.
3. 별도 브라우저 확인에서도 같은 문제를 재현했다.
4. 이 두 기록을 구현 역할에게 전달했고, 성공·실패·부분 성공 표시와 관련 회귀
   테스트가 수정되었다.
5. 테스트·브라우저 재확인 뒤 최종 검토는 `READY_FOR_HUMAN_REVIEW`를 반환했다.

최초 기록: `demo/reference/.demo/history/iteration-01/`.
최종 기록: `demo/reference/.demo/`.
각본으로 성공·실패 문구를 삽입하거나 에이전트 출력을 모의 생성하지 않았다.

## 관측한 브라우저 결과

- 변경 전: 같은 요청 2회 → 주문 2건.
- 변경 후: 같은 요청 2회 → 주문 1건. 201/새 주문과 200/기존 결과의 주문번호 동일.
- 별도 새 주문: 누적 요청 3회 → 의도한 주문 2건.
- 이후 재전송, 일반 버튼 중복 클릭 억제, 새 주문을 첫 동작으로 실행하는 경우 확인.
- 강제로 만든 503 응답은 오류로 표시되며 정상 배너를 표시하지 않음. 이후 재시도 확인.
- 저장본 화면은 `SAVED REHEARSAL`, 최종 판단은 대기로 표시됨.

상세 이벤트가 없는 브라우저 항목은 자동 확인의 성공/실패만 기록되어 있다.
모든 브라우저·네트워크 조건을 검증한 것은 아니다.

## 환경과 재현

- GitHub Copilot CLI 1.0.88, Node.js v22.16.0.
- Chrome 154.0.8037.58, Playwright는 루트 `package-lock.json`에 고정.
- PowerPoint: python-pptx. PDF: LibreOffice에서 비태그 PDF로 변환.
- 영상: 실제 브라우저 녹화 + 직접 작성한 설명 그래픽, macOS Yuna 한국어 음성,
  FFmpeg 합성. 음성과 자막은 로컬에서 생성했으며 외부 음성 서비스는 사용하지 않음.
- 음성 분석: -18.03 LUFS, true peak -1.86 dBTP.
- 로컬 주소만 사용. 실제 주문·결제·환불·고객 데이터·배포 없음.
- 모델을 고정하지 않았으므로 새 AI 실행의 시간·표현·결과는 달라질 수 있음.

최종 소스 SHA-256:

`75fdf7cdc1f97375f8323728aa08172c3350b2b69376a7017c1e10288a158a93`

`demo/reference-manifest.json`은 저장된 소스·기록의 파일별 무결성 목록이다.
명령: `cd demo && npm run demo -- check-reference`.

## 제어의 정확한 의미

Copilot 역할 프로필과 도구 제한은 실제 CLI 기능이다. 파일 인계, 로컬 승인 기록,
범위 검사, 해시 확인, 테스트 실행, Evidence Desk는 **이 키트가 만든 보조 도구**다.
역할별 CLI 호출은 별도 세션이며 파일로 산출물을 전달한다.
이는 A2A 통신 프로토콜 구현이나 Copilot Studio 연결이 아니다.

준비 과정의 범위 승인은 `rehearsal-scope-approval`로 표시했다.
사람이나 실제 조직이 승인했다는 뜻이 아니다. 로컬 자기기입 기록은 조직 인증,
변조 방지 감사 로그, 보호 규칙이나 보안 샌드박스를 대신하지 않는다.

## 아직 보장하지 않는 것

현재 주문 저장과 중복 방지는 단일 프로세스 메모리에서만 작동한다.
재시작·다중 인스턴스·키 수명·영속 저장소·사용자 인증·실제 결제 연동을 검증하지
않았다. 이 모의 사례를 그대로 프로덕션 결제 경로에 배포하면 안 된다.

영상의 약 5분은 편집된 설명 길이다. 개발 소요 시간·생산성·매출·비용 절감
성과로 해석하지 않는다. 테스트 통과와 에이전트 검토는 결함 부재의 증명이 아니다.

## 공식 참고 자료

- [GitHub Copilot CLI 사용](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)
- [Custom agents 설정](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- [Copilot CLI 개념·권한 경계](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- [Copilot Studio agent flows](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview)
- [A2A 공식 소개](https://a2a-protocol.org/latest/)

확인되지 않은 제품 기능이나 생산성 수치를 성과로 주장하지 않는다.
