# 5분 데모 영상

**`Agentic-Development-Demo-KO.mp4`를 그대로 재생하면 됩니다.**

- 1920×1080, MP4 / H.264 + AAC
- 약 5분, 한국어 로컬 합성 음성, 화면에 포함된 한국어 자막
- 별도 자막 파일: `Agentic-Development-Demo-KO.srt`
- 대본·장면 구성: `narration.json`
- 실제 브라우저 녹화: `recordings/`

장면은 고객 문제 재현, 완료 기준, 역할별 인계, 범위 승인, 실제 검토에서 발생한
재작업, 수정 후 비교, 사람의 최종 판단 순서다. “사전 리허설·편집 영상” 표기를
유지한다. 5분은 설명 영상의 길이이지 실제 개발 소요 시간이 아니다.

## 다시 제작하기

macOS, Python 3, Pillow, FFmpeg/FFprobe, 한국어 `Yuna` 음성,
Node.js 22+, Chrome과 루트의 `npm ci`가 필요하다.
네트워크 음성 합성 서비스나 실제 고객 데이터는 사용하지 않는다.

1. 변경 전 앱을 4311, 저장된 최종 앱을 4312에서 실행한다.
2. 키트 루트에서 다음을 실행한다.

```bash
python3 video/produce.py --audio-only
node tools/record-demo.mjs
python3 video/produce.py --render-only
```

모델을 새로 호출하지 않고 저장된 실제 결과와 실행 가능한 앱을 녹화한다.
장면의 실제 UI 결과가 다르면 녹화가 실패한다. 준비된 성공 문구로 대체하지 않는다.

영상은 최종 사람 판단을 대기로 남긴다. 현재 구현은 단일 프로세스 메모리 저장으로,
운영 결제 시스템의 안전성·분산 환경·재시작 후 데이터 보존을 보장하지 않는다.
