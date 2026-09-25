"""Build an editable, diagram-led Korean executive presentation."""
from pathlib import Path
import json
from datetime import datetime
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt
from pptx.oxml.ns import qn
from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "presentation"
ASSETS = OUT / "assets"
STATE = json.loads((ROOT / "demo/reference/.demo/state.json").read_text())
BROWSER = json.loads((ROOT / "evidence/browser-check.json").read_text())
if not STATE["verification"]["passed"] or not BROWSER["passed"]:
    raise RuntimeError("Build the deck only from a verified rehearsal.")

W, H = 13.333333, 7.5
FONT = "Apple SD Gothic Neo"
C = {
    "ink": "182236", "dark": "101727", "panel": "1A2439", "paper": "F7F8FC",
    "white": "FFFFFF", "muted": "78859A", "line": "DCE2EC", "purple": "A783D7",
    "lilac": "D6C1F0", "mint": "64D5AF", "amber": "F0C083", "red": "D36C78",
    "pale": "EEE7F7", "green": "267F62", "lighttext": "B1BED3",
}
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
prs.core_properties.title = "GitHub Copilot: Agentic Development in Action"
prs.core_properties.subject = "고객 문제에서 출시 판단 근거까지"
prs.core_properties.author = "GitHub Copilot presenter kit"
prs.core_properties.keywords = "Copilot, CXO, agentic development, human control"


def rgb(value):
    return RGBColor.from_string(C.get(value, value))


def shape(slide, x, y, w, h, fill, line=None, rounded=False):
    obj = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    obj.fill.solid()
    obj.fill.fore_color.rgb = rgb(fill)
    if line:
        obj.line.color.rgb = rgb(line)
        obj.line.width = Pt(0.8)
    else:
        obj.line.fill.background()
    if rounded:
        obj.adjustments[0] = 0.12
    effect = obj._element.find(f"{qn('p:style')}/{qn('a:effectRef')}")
    if effect is not None:
        effect.set("idx", "0")
    return obj


def text(slide, content, x, y, w, h, size=18, color="ink", bold=False,
         align=PP_ALIGN.LEFT, font=FONT, margin=0, line_spacing=1.16):
    obj = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = obj.text_frame
    tf.clear()
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(margin)
    tf.margin_top = tf.margin_bottom = Inches(margin)
    for i, line in enumerate(content.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.alignment = align
        p.line_spacing = line_spacing
        p.space_before = Pt(0)
        p.space_after = Pt(4 if size >= 16 else 2)
        for run in p.runs:
            run.font.name = "Arial" if font == FONT else font
            run.font.size = Pt(size)
            run.font.bold = bold
            run.font.color.rgb = rgb(color)
            properties = run._r.get_or_add_rPr()
            east_asian = properties.find(qn("a:ea"))
            if east_asian is None:
                east_asian = etree.SubElement(properties, qn("a:ea"))
            east_asian.set("typeface", FONT)
    return obj


def pill(slide, content, x, y, w, color="purple", dark=True):
    shape(slide, x, y, w, 0.33, "panel" if dark else "pale", rounded=True)
    text(slide, content, x + 0.08, y + 0.045, w - 0.16, 0.25, 10,
         color, True, PP_ALIGN.CENTER)


def arrow(slide, x, y, w=0.48, color="muted"):
    obj = slide.shapes.add_shape(MSO_SHAPE.CHEVRON, Inches(x), Inches(y),
                                Inches(w), Inches(0.31))
    obj.fill.solid()
    obj.fill.fore_color.rgb = rgb(color)
    obj.line.fill.background()
    return obj


def line(slide, x1, y1, x2, y2, color="line", width=1.2):
    obj = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                    Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    obj.line.color.rgb = rgb(color)
    obj.line.width = Pt(width)
    effect = obj._element.find(f"{qn('p:style')}/{qn('a:effectRef')}")
    if effect is not None:
        effect.set("idx", "0")
    return obj


def new_slide(eyebrow, title, subtitle="", dark=False, title_size=32):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = rgb("dark" if dark else "paper")
    text(slide, eyebrow.upper(), .57, .34, 11.7, .28, 10,
         "lilac" if dark else "purple", True)
    text(slide, title, .57, .91, 12.1, 1.28, title_size,
         "white" if dark else "ink", True, line_spacing=1.09)
    if subtitle:
        text(slide, subtitle, .59, 2.04, 12.0, .45, 16,
             "lighttext" if dark else "muted")
    n = len(prs.slides)
    line(slide, .57, 7.05, 12.74, 7.05, "panel" if dark else "line", .7)
    text(slide, "GitHub Copilot  /  Agentic Development in Action", .59, 7.16,
         9.6, .19, 8.5, "muted")
    text(slide, f"{n:02d}", 12.1, 7.12, .63, .27, 11,
         "lighttext" if dark else "muted", align=PP_ALIGN.RIGHT)
    return slide


def notes(slide, body, sources=""):
    slide.notes_slide.notes_text_frame.text = (
        body + "\n\n검증·표현 경계: 합성 모의 주문, 실제 결제/배포 없음. "
        "생산성/매출 효과를 측정한 실험이 아님. 사전 실행 화면은 리허설 기록.\n"
        + (f"\n출처/근거:\n{sources}" if sources else "")
    )


def picture(slide, path, x, y, w, h, frame=True):
    if frame:
        shape(slide, x - .025, y - .025, w + .05, h + .05, "white", "line", True)
    image = Image.open(path)
    iw, ih = image.size
    target = w / h
    src = iw / ih
    obj = slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w), height=Inches(h))
    if src > target:
        crop = (1 - target / src) / 2
        obj.crop_left = obj.crop_right = crop
    else:
        crop = (1 - src / target) / 2
        obj.crop_top = obj.crop_bottom = crop
    return obj


def crop_asset(source, dest, box):
    image = Image.open(ASSETS / source)
    image.crop(box).save(ASSETS / dest)
    return ASSETS / dest


before_crop = crop_asset("01-before.png", "before-result.png", (647, 342, 1330, 877))
after_crop = crop_asset("02-after.png", "after-result.png", (647, 342, 1330, 900))
tests = STATE["verification"]["suites"]
repo_suite = next(s for s in tests if s["name"] == "repository")
acceptance = next(s for s in tests if s["name"] == "acceptance")
baseline = next(s for s in STATE["baselineTests"]["suites"] if s["name"] == "acceptance")
total = sum(s["tests"] for s in tests)
date_label = datetime.fromisoformat(STATE["review"]["completedAt"].replace("Z", "+00:00")).strftime("%Y.%m.%d")

# 01 — Outcome first, not a feature list.
s = new_slide("Executive briefing  ·  2026.09", "고객 문제에서,\n출시 판단 근거까지.", dark=True, title_size=40)
text(s, "GitHub Copilot:\nAgentic Development in Action", .61, 2.59, 6.4, 1.0,
     22, "lilac", True)
text(s, "에이전트에게 작업을.\n사람에게 범위와 최종 판단을.", .61, 4.10, 6.4, 1.1, 24, "white")
pill(s, "CUSTOMER PROBLEM → REVIEWABLE CHANGE", .61, 5.94, 5.6, "mint")
shape(s, 8.0, 1.54, 4.68, 4.89, "panel", rounded=True)
text(s, "같은 주문 요청", 8.35, 1.95, 3.98, .4, 18, "lighttext", align=PP_ALIGN.CENTER)
text(s, "2회", 8.35, 2.6, 3.98, 1.05, 62, "lilac", True, PP_ALIGN.CENTER)
text(s, "↓", 9.7, 3.61, 1.4, .63, 32, "muted", align=PP_ALIGN.CENTER)
text(s, "주문 1건", 8.35, 4.42, 3.98, .81, 38, "mint", True, PP_ALIGN.CENTER)
text(s, "정상적인 새 주문은 그대로", 8.35, 5.55, 3.98, .4, 16, "lighttext", align=PP_ALIGN.CENTER)
notes(s, "오프닝: 오늘은 기능 목록을 설명하지 않습니다. 고객 문제 하나가 검토 가능한 "
      "서비스 변경으로 이어지는 모습을 보겠습니다. 같은 주문을 다시 보내도 주문은 한 건, "
      "별도의 새 주문은 그대로라는 기준을 따라갑니다. GitHub를 몰라도 고객 화면과 "
      "출시 판단 지점만 보시면 됩니다.\n권장 45초.", "demo/starter/REQUEST.md")

# 02 — A business problem an executive can see.
s = new_slide("01  /  why it matters", "고객은 요청을 다시 보냈을 뿐입니다.",
              "시스템이 이를 새 주문으로 받아들이면, 고객 경험과 운영 부담이 함께 흔들립니다.")
shape(s, .60, 2.73, 4.12, 3.6, "white", "line", True)
pill(s, "합성 고객 문의", .87, 3.01, 1.69, "purple", False)
text(s, "“화면이 멈춰서\n한 번 더 눌렀더니,\n주문이 두 건 생겼어요.”", .9, 3.71, 3.49, 1.83,
     24, "ink", True)
text(s, "실제 고객사 장애 사례가 아닙니다.", .9, 5.84, 3.49, .35, 12, "muted")
picture(s, before_crop, 5.08, 2.60, 7.62, 3.96)
pill(s, "변경 전 실제 리허설 화면", 9.21, 6.64, 3.45, "red", False)
notes(s, "고객 문의를 읽고 오른쪽의 숫자만 짚습니다. 실제로 같은 요청 두 개를 동시에 "
      "보냈고, 서버에 모의 주문 두 건이 생겼습니다. 주문번호도 서로 다릅니다. "
      "실제 결제나 고객 데이터를 사용하지 않습니다. 매출 손실을 측정했다는 뜻도 아닙니다.\n권장 60초.",
      "presentation/assets/01-before.png\nevidence/browser-check.json")

# 03 — Why task handoffs, rather than code generation alone.
s = new_slide("02  /  the problem to solve", "코드가 생겨도,\n출시할 근거는 저절로 생기지 않습니다.", dark=True)
for i, (label, title, body) in enumerate([
    ("요청", "무엇이 맞는 결과인가", "완료 기준을\n먼저 정합니다."),
    ("구현", "어디까지 바꿔도 되는가", "허용 범위와\n금지 영역을 정합니다."),
    ("검증", "정말 문제를 해결했는가", "문제를 재현하고\n실제 결과를 남깁니다."),
    ("검토", "누가 내보내기로 하는가", "남은 위험을 확인하고\n사람이 결정합니다."),
]):
    x = .60 + i * 3.11
    shape(s, x, 2.72, 2.91, 3.15, "panel", rounded=True)
    pill(s, label, x + .22, 3.00, .82, "lilac")
    text(s, title, x + .22, 3.62, 2.48, .84, 20, "white", True)
    text(s, body, x + .22, 4.62, 2.48, .91, 15, "lighttext")
text(s, "목표는 ‘더 많은 코드’가 아니라 ‘다음 판단에 필요한 근거’입니다.",
     .64, 6.33, 12.0, .46, 23, "mint", True)
notes(s, "AI 코딩 자체보다 요청 해석, 범위, 검증, 책임 사이의 공백을 보겠다고 설명합니다. "
      "이 슬라이드는 생산성 개선을 입증하는 수치가 아니라 이번 데모의 설계 목표입니다.\n권장 60초.")

# 04 — A minimal vocabulary bridge.
s = new_slide("03  /  a 30-second orientation", "GitHub는 협업 공간.\nCopilot은 개발 작업을 돕는 AI.")
shape(s, .61, 2.66, 7.49, 3.56, "white", "line", True)
text(s, "GitHub", .95, 2.97, 6.8, .48, 26, "ink", True)
text(s, "개발 변경을 관리하고 협업하는 플랫폼", .95, 3.60, 6.6, .5, 20, "muted")
for i, label in enumerate(["변경 요청", "코드 변경", "검토·승인"]):
    pill(s, label, .95 + i * 2.27, 4.43, 1.91, "purple", False)
text(s, "이번 시연은 로컬 개발 환경에서 실행합니다.\n실제 GitHub PR을 만들거나 병합하지 않습니다.",
     .95, 5.17, 6.66, .72, 15, "muted")
shape(s, 8.36, 2.66, 4.33, 3.56, "dark", rounded=True)
text(s, "GitHub Copilot CLI", 8.72, 3.03, 3.61, .49, 23, "lilac", True)
text(s, "계획을 읽고 제안\n코드를 읽고 수정\n변경과 검증 근거를 검토", 8.72, 3.89, 3.54, 1.59, 20, "white")
notes(s, "GitHub 경험이 없는 참석자를 위한 최소 설명입니다. GitHub와 Copilot을 같은 "
      "개념으로 부르지 않습니다. 이번에 실행한 것은 터미널용 Copilot CLI의 역할별 "
      "프로필과 로컬 Git 변경 비교입니다. GitHub 웹 PR이나 Actions를 시연한 것으로 말하지 않습니다.\n권장 45초.",
      "https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli")

# 05 — Specific request and acceptance criteria.
s = new_slide("04  /  one bounded change request", "중복은 막고,\n정상적인 새 주문은 유지한다.")
cases = [
    ("같은 요청 재전송", "2회 → 1건", "순차·동시 재전송 모두\n기존 주문번호로 응답", "purple"),
    ("별도의 새 주문", "새 주문 허용", "다른 주문 표식이면\n정상적으로 추가 접수", "green"),
    ("같은 표식, 다른 내용", "충돌은 거부", "수량·상품이 달라지면\n기존 주문을 바꾸지 않음", "red"),
]
for i, (title, outcome, body, color) in enumerate(cases):
    x = .61 + i * 4.16
    shape(s, x, 2.67, 3.90, 3.03, "white", "line", True)
    text(s, title, x + .27, 2.96, 3.38, .49, 18, "muted", True)
    text(s, outcome, x + .27, 3.69, 3.38, .7, 31, color, True)
    text(s, body, x + .27, 4.73, 3.35, .8, 17, "ink")
shape(s, .61, 6.03, 12.2, .61, "pale", rounded=True)
text(s, "수정 범위: 코드·테스트 4개 파일     |     결제·DB·인증·배포 변경 없음",
     .86, 6.16, 11.7, .33, 16, "ink", True)
notes(s, "자연어 요청을 검증 가능한 기준으로 바꾸는 장면입니다. 같은 표식은 동일 "
      "업무 요청을 구분하는 값입니다. 기술명은 Idempotency-Key이지만 먼저 외울 필요는 없습니다. "
      "수정 허용 파일과 범위 밖을 사람이 승인해야 합니다.\n권장 60초.", "demo/starter/REQUEST.md")

# 06 — Agent-to-agent is an artifact handoff, not a network protocol.
s = new_slide("05  /  how the collaboration works", "역할은 나누고,\n다음 역할에는 산출물을 넘깁니다.", dark=True)
stages = [
    ("계획 Agent", "요청·코드 읽기\n해결 계획 제안", "01-plan.md", "lilac"),
    ("구현 Agent", "승인된 범위에서\n코드·테스트 변경", "02-diff.patch", "lilac"),
    ("실제 테스트", "정해 둔 조건을\n실행해 결과 기록", "03-tests.tap", "mint"),
    ("검토 Agent", "변경·실행 근거 읽기\n위험·누락 검토", "04-review.md", "lilac"),
]
for i, (title, body, artifact, color) in enumerate(stages):
    x = .6 + i * 3.18
    shape(s, x, 2.7, 2.63, 2.23, "panel", rounded=True)
    text(s, title, x + .2, 2.96, 2.22, .48, 20, color, True)
    text(s, body, x + .2, 3.62, 2.22, .8, 17, "white")
    text(s, artifact, x + .2, 4.49, 2.22, .27, 11, "lighttext", font="Arial")
    if i < 3:
        arrow(s, x + 2.75, 3.64, .31, "muted")
shape(s, .60, 5.30, 5.85, .77, "302719", rounded=True)
text(s, "사람 ①  구현 전 범위·완료 기준 승인", .85, 5.5, 5.4, .36, 18, "amber", True)
shape(s, 6.72, 5.30, 5.94, .77, "302719", rounded=True)
text(s, "사람 ②  검토 후 출시 여부 판단", 6.97, 5.5, 5.45, .36, 18, "amber", True)
text(s, "파일 기반 협업 설계입니다. A2A 프로토콜 연결이 아닙니다. 테스트는 AI의 자기평가가 아닙니다.",
     .62, 6.45, 12.0, .35, 14, "lighttext")
notes(s, "실제로 세 개의 별도 Copilot CLI 세션을 역할 프로필로 실행했습니다. "
      "데모 스크립트가 계획, 변경, 테스트 기록, 검토를 파일로 인계합니다. "
      "테스트는 로컬 Node.js 실행이며 별도의 테스트 AI가 통과를 선언하는 구조가 아닙니다. "
      "검토 역할 분리는 오류가 없다는 보장도 아닙니다.\n권장 90초.",
      "demo/starter/.github/agents/\ndemo/scripts/workflow.mjs\nhttps://docs.github.com/en/copilot/reference/custom-agents-configuration")

# 07 — Live demo / video cue.
s = new_slide("06  /  demonstration", "세 장면만 확인해 주세요.",
              "코드를 읽지 않아도, 고객 화면과 업무 근거로 결과를 판단할 수 있습니다.")
for i, (n, title, outcome, color) in enumerate([
    ("01", "문제 재현", "같은 요청 2회\n주문 2건", "red"),
    ("02", "수정 후 비교", "같은 요청 2회\n주문 1건", "green"),
    ("03", "출시 판단", "검증·검토는 완료\n사람의 판단은 대기", "purple"),
]):
    x = .61 + i * 4.16
    shape(s, x, 2.77, 3.91, 3.26, "white", "line", True)
    text(s, n, x + .26, 3.01, 3.37, .48, 20, color, True)
    text(s, title, x + .26, 3.75, 3.37, .54, 25, "ink", True)
    text(s, outcome, x + .26, 4.6, 3.37, 1.0, 21, "muted")
obj = text(s, "약 5분 영상 또는 로컬 데모로 전환", .64, 6.40, 11.9, .42, 20, "ink", True)
obj.click_action.hyperlink.address = "../video/Agentic-Development-Demo-KO.mp4"
notes(s, "여기서 영상이나 브라우저로 전환합니다. 영상 경로는 video/Agentic-Development-Demo-KO.mp4입니다. "
      "5분은 편집된 설명 길이이지 실제 개발 소요 시간이 아닙니다. "
      "라이브가 막히면 저장본으로 전환한다고 명확히 말합니다. 상세 조작은 DEMO-GUIDE.ko.md를 따릅니다.",
      "DEMO-GUIDE.ko.md\nvideo/Agentic-Development-Demo-KO.mp4")

# 08 — Actual before and after.
s = new_slide("07  /  visible outcome", "같은 요청 2회, 주문은 한 건.",
              "서버가 재전송을 구분합니다. 별도의 새 주문은 정상적으로 접수됩니다.")
pill(s, "BEFORE  ·  모의 주문 2건", .65, 2.61, 5.85, "red", False)
pill(s, "AFTER  ·  모의 주문 1건", 6.88, 2.61, 5.85, "green", False)
picture(s, before_crop, .64, 3.08, 5.83, 3.47)
picture(s, after_crop, 6.89, 3.08, 5.82, 3.47)
notes(s, "실제 브라우저에서 같은 요청을 두 번 보낸 화면입니다. 변경 전에는 서로 다른 "
      "주문번호 두 개, 변경 후에는 하나입니다. 영상/브라우저에서 새 주문을 추가해 "
      "정상 구매를 막지 않았다는 것도 보여줍니다. 실제 결제 취소나 환불까지 검증한 것은 아닙니다.",
      "evidence/browser-check.json\npresentation/assets/01-before.png\npresentation/assets/02-after.png")

# 09 — Tests as evidence, not a productivity metric.
s = new_slide("08  /  evidence, not an assertion", "‘완료했습니다’ 대신,\n다시 실행할 수 있는 근거를 봅니다.", dark=True)
shape(s, .63, 2.76, 4.1, 3.7, "panel", rounded=True)
text(s, "사람이 정한 업무 기준", .92, 3.10, 3.51, .5, 19, "lighttext", True)
text(s, f"{acceptance['pass']} / {acceptance['tests']}", .92, 3.9, 3.50, .97, 53, "mint", True)
text(s, "수정 후 테스트 통과", .94, 5.04, 3.49, .41, 18, "white")
text(s, f"변경 전: {baseline['fail']}개 실패\n별도 회귀 테스트: {repo_suite['pass']}개 통과", .94, 5.7, 3.49, .58, 13, "lighttext")
checks = [
    ("같은 요청의 순차·동시 재전송", "주문 1건 · 같은 주문번호"),
    ("같은 표식으로 다른 내용을 보냄", "충돌 거부 · 기존 주문 유지"),
    ("별도 새 주문·다른 고객 범위", "정상 접수 · 서로 독립"),
    ("잘못된 입력과 기존 기능", "오류 명시 · 기존 동작 유지"),
]
for i, (criterion, result) in enumerate(checks):
    y = 2.9 + i * .88
    text(s, "✓", 5.16, y, .35, .38, 22, "mint", True)
    text(s, criterion, 5.67, y, 6.77, .36, 18, "white", True)
    text(s, result, 5.68, y + .40, 6.75, .31, 14, "lighttext")
notes(s, f"실제 리허설 기록에서 업무 기준 {acceptance['tests']}개, 저장소 테스트 "
      f"{repo_suite['tests']}개가 통과했습니다. 이 숫자는 이 샘플에 대한 실행 결과일 뿐 "
      "생산성 수치나 결함 부재 증명이 아닙니다. 브라우저 검증은 별도로 수행했습니다. "
      "사람이 정한 acceptance 테스트 파일은 구현 에이전트의 변경 범위 밖에 있습니다.",
      "demo/reference/.demo/00-baseline.tap\ndemo/reference/.demo/03-verification.json\nevidence/browser-check.json")

# 10 — A real review finding, not a staged failure.
s = new_slide("09  /  a real rework loop", "실제 리허설도,\n한 번에 끝나지 않았습니다.")
for i, (stage, title, body, color) in enumerate([
    ("첫 구현", "서버 테스트 통과", "중복 방지·기존 기능은\n실행된 조건을 통과", "green"),
    ("첫 검토", "화면의 모순 발견", "주문은 실패했는데\n정상이라고 표시할 가능성", "red"),
    ("재작업", "수정 후 다시 확인", "검토 지적과 브라우저 실패를\n구현 담당에게 전달", "purple"),
]):
    x = .63 + i * 4.16
    shape(s, x, 2.67, 3.91, 3.16, "white", "line", True)
    pill(s, stage, x + .25, 2.94, 1.28, color, False)
    text(s, title, x + .25, 3.67, 3.39, .61, 24, "ink", True)
    text(s, body, x + .25, 4.59, 3.39, .91, 17, "muted")
text(s, "테스트 통과 ≠ 검토 완료 ≠ 출시 승인", .68, 6.25, 12.0, .53, 27, "purple", True)
notes(s, "실제로 최초 검토 에이전트가 CHANGES_REQUESTED를 반환했습니다. "
      "서버 테스트가 통과했어도 실패한 주문을 화면이 정상이라고 표시할 수 있었습니다. "
      "브라우저 자동 확인에서도 재현했고, 이 두 기록을 구현 역할에 다시 전달했습니다. "
      "최초 기록은 history/iteration-01에 보존했습니다. 실패를 각본으로 꾸민 것이 아닙니다. "
      "최종 소스에는 이 수정과 회귀 테스트가 포함됩니다.",
      "demo/reference/.demo/history/iteration-01/04-review.md\n"
      "demo/reference/.demo/history/iteration-01/06-browser-check.json\n"
      "demo/reference/.demo/02-implementation.md")

# 11 — Review is not release approval.
s = new_slide("10  /  a human decision remains", "검토가 끝나도,\n출시는 자동으로 결정하지 않습니다.")
shape(s, .62, 2.70, 4.11, 3.96, "white", "line", True)
pill(s, "최종 출시 판단 대기", .88, 2.98, 3.53, "purple", False)
text(s, "확인한 것", .9, 3.63, 3.45, .42, 19, "ink", True)
text(s, "중복 방지 · 정상 주문 유지\n실제 변경 · 실행된 테스트", .9, 4.17, 3.46, .87, 17, "muted")
text(s, "아직 보장하지 않는 것", .9, 5.22, 3.47, .42, 19, "ink", True)
text(s, "재시작 · 다중 인스턴스\n실제 결제 · 운영 배포", .9, 5.76, 3.47, .70, 16, "muted")
picture(s, ASSETS / "04-review.png", 5.07, 2.72, 7.62, 3.95)
notes(s, "검토 에이전트의 READY_FOR_HUMAN_REVIEW는 검토를 위한 권고이지 사람의 승인이 "
      "아닙니다. 이번 데모는 실제 PR 생성·병합·배포 없이 멈춥니다. 단일 프로세스 메모리 "
      "구현이므로 운영 적용 전 영속성, 원자성, 사용자 범위, 키 수명, 결제 연동을 검토해야 합니다. "
      "저장본의 범위 승인도 리허설 기록임을 명시합니다.",
      "demo/reference/.demo/04-review.md\ndemo/reference/.demo/plan-approval.json")

# 12 — Technical controls vs business responsibility.
s = new_slide("11  /  what the organization controls", "사람의 책임을,\n결정 지점으로 드러냅니다.", dark=True)
for i, (number, title, body, detail) in enumerate([
    ("01", "구현 전에", "범위와 완료 기준", "허용 파일 · 금지 작업\n무엇을 테스트할지"),
    ("02", "검토하기 전에", "현재 변경의 근거", "실제 테스트 · 변경 범위\n코드와 기록의 일치"),
    ("03", "내보내기 전에", "남은 위험과 책임", "운영 적용 조건\n승인자와 최종 결정"),
]):
    x = .64 + i * 4.15
    shape(s, x, 2.71, 3.89, 3.48, "panel", rounded=True)
    text(s, number, x + .26, 2.97, 3.35, .39, 20, "amber", True)
    text(s, title, x + .26, 3.59, 3.35, .5, 25, "white", True)
    text(s, body, x + .26, 4.27, 3.35, .49, 20, "lilac", True)
    text(s, detail, x + .26, 5.0, 3.35, .88, 17, "lighttext")
text(s, "데모의 로컬 승인·해시 검사는 보조 제어입니다. 조직 인증·보호 규칙·보안 격리를 대신하지 않습니다.",
     .64, 6.46, 12.0, .34, 13.5, "lighttext")
notes(s, "준비된 컨트롤러는 승인 없는 구현, 실패/미검증 상태의 검토, 검증 후 소스 변경을 "
      "차단합니다. 이 제어는 GitHub 내장 기능이라고 주장하지 않습니다. 파일·도구 제한도 "
      "완전한 샌드박스나 영구적 권한 경계로 보장하지 않습니다. 프로덕션에는 조직 정책을 "
      "별도로 연결해야 합니다.", "demo/scripts/workflow.mjs\nevidence/control-check.json")

# 13 — Pilot selection, not a production checkout recommendation.
s = new_slide("12  /  where to start", "첫 파일럿은 작게.\n완료 기준은 명확하게.")
criteria = [("피해 범위가 작다", "실제 결제·권한 변경 없이\n격리된 환경에서 재현"),
            ("맞고 틀림이 분명하다", "같은 입력과 기대 결과로\n누구나 다시 확인"),
            ("되돌릴 수 있다", "변경 범위가 좁고\n복구 방법이 명확"),
            ("검토할 사람이 있다", "업무·기술 담당자가\n근거를 보고 판단")]
for i, (title, body) in enumerate(criteria):
    x = .63 + (i % 2) * 6.24
    y = 2.71 + (i // 2) * 1.6
    shape(s, x, y, 5.93, 1.38, "white", "line", True)
    text(s, f"0{i+1}", x + .24, y + .25, .55, .48, 23, "purple", True)
    text(s, title, x + .97, y + .21, 4.62, .40, 20, "ink", True)
    text(s, body, x + .97, y + .72, 4.64, .53, 14, "muted")
text(s, "시작 후보: 내부 도구의 입력 검증 · 회귀 테스트 보강 · 작은 오류 수정",
     .67, 6.28, 12.0, .4, 18, "green", True)
notes(s, "교육용 모의 주문 데모를 보여줬다고 실제 결제 경로를 첫 파일럿으로 권하지 않습니다. "
      "권한·결제·대규모 마이그레이션은 처음부터 고르지 않습니다. "
      "파일럿에서는 요청→검토 시간, 재작업, 누락, 검토 부담을 같은 조건으로 측정합니다. "
      "이 자료에는 개선율을 주장할 데이터가 없습니다.")

# 14 — Concise executive takeaway.
s = new_slide("13  /  take one decision away", "에이전트에게 작업을.\n사람에게 범위와 최종 판단을.", dark=True, title_size=37)
text(s, "고객 문제", .74, 3.13, 2.33, .61, 25, "white", True)
arrow(s, 3.29, 3.24, .58, "purple")
text(s, "검토 가능한 변경", 4.2, 3.13, 4.31, .61, 25, "lilac", True)
arrow(s, 8.31, 3.24, .58, "purple")
text(s, "책임 있는 판단", 9.22, 3.13, 3.64, .61, 25, "mint", True)
shape(s, .66, 4.45, 12.05, 1.47, "panel", rounded=True)
text(s, "우리 조직의 첫 한 건은 무엇입니까?", 1.0, 4.74, 11.29, .55, 27, "white", True)
text(s, "업무 담당자 · 완료 기준 · 허용 범위 · 최종 승인자를 함께 정합니다.",
     1.0, 5.49, 11.29, .33, 16, "lighttext")
notes(s, "마무리: 에이전트 수를 늘리는 것이 목표가 아닙니다. 조직에서 맡길 수 있는 "
      "작업 한 건과 통제할 결정 지점을 함께 설계하는 것이 핵심입니다. "
      "오늘 본 것은 실제로 실행한 한정된 워크플로이며 조직의 생산성 성과를 보증하지 않습니다.")

# 14 — Explicitly separate the concepts.
s = new_slide("Appendix A  /  terminology boundaries", "세 가지는 서로 다른 개념입니다.")
columns = [
    ("이번에 실행", "GitHub의 개발 업무", "Copilot CLI로 계획·구현·검토\n로컬 코드 변경과 테스트 근거", "파일 기반 역할별 인계", "green"),
    ("이번에 연결하지 않음", "Copilot Studio", "업무용 에이전트와\n업무 흐름을 구성하는 별도 영역", "이 데모의 실행 경로가 아님", "muted"),
    ("이번에 구현하지 않음", "A2A 프로토콜", "에이전트 간 통신·상호운용을\n정의하는 프로토콜", "협업 설계라는 뜻과 구분", "muted"),
]
for i, (badge, title, body, foot, color) in enumerate(columns):
    x = .63 + i * 4.16
    shape(s, x, 2.66, 3.90, 3.67, "white", "line", True)
    pill(s, badge, x + .22, 2.93, 3.46, color, False)
    text(s, title, x + .26, 3.67, 3.39, .67, 24, "ink", True)
    text(s, body, x + .26, 4.66, 3.39, .92, 16, "muted")
    text(s, foot, x + .26, 5.83, 3.39, .35, 13, color, True)
notes(s, "세 개념을 같은 이름의 멀티에이전트 기능으로 묶지 않습니다. "
      "이번 세션에서 Agent-to-Agent는 산출물 인계를 뜻합니다. A2A discovery, "
      "Agent Card, 원격 통신이나 Copilot Studio 연결은 수행하지 않았습니다.",
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview\n"
      "https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview\nhttps://a2a-protocol.org/latest/")

# 15 — Reproducibility and truthful claims.
s = new_slide("Appendix B  /  verified scope", "확인한 것과, 주장하지 않는 것.")
shape(s, .62, 2.54, 6.03, 3.91, "white", "line", True)
text(s, "실제 실행 근거", .93, 2.86, 5.39, .47, 23, "green", True)
text(s, f"Copilot CLI 1.0.88 · Node.js 22.16.0\n"
     f"계획·구현·검토: 실제 CLI 실행\n"
     f"업무 기준 {acceptance['tests']}개 / 회귀 {repo_suite['tests']}개 통과\n"
     "실제 브라우저 전후 비교·오류 처리 확인\n"
     "최종 사람 판단: 미기록 · 배포 없음",
     .94, 3.57, 5.36, 2.41, 18, "ink")
shape(s, 6.91, 2.54, 5.80, 3.91, "dark", rounded=True)
text(s, "이 자료로 주장하지 않음", 7.24, 2.86, 5.14, .47, 23, "amber", True)
text(s, "개발 시간·매출·비용 개선율\n오류가 전혀 없다는 보장\n운영 결제 시스템의 안전성\nGitHub PR·Actions·자동 배포\nCopilot Studio·A2A 연결",
     7.25, 3.57, 5.10, 2.41, 18, "white")
text(s, "상세 로그: demo/reference/.demo/    |    브라우저·제어 확인: evidence/",
     .66, 6.62, 12.0, .25, 11, "muted", font="Arial")
notes(s, "기준 날짜는 2026-09-26 KST입니다. 소스와 로그는 키트에 함께 제공합니다. "
      "테스트 수치는 측정된 샘플 결과이며 성공률 마케팅 지표가 아닙니다. "
      "모델과 제품은 바뀔 수 있으므로 발표 전에 가이드의 확인 절차를 다시 수행합니다.",
      "evidence/VERIFICATION.ko.md\ndemo/reference/.demo/logs/\ncopilot --help / copilot help permissions")

# 16 — Sources and presenter entry points.
s = new_slide("Appendix C  /  presenter kit & sources", "바로 보여주고, 근거까지 확인할 수 있습니다.")
text(s, "발표자 키트", .65, 2.49, 5.43, .45, 23, "ink", True)
for i, (label, value) in enumerate([
    ("영상", "video/Agentic-Development-Demo-KO.mp4"),
    ("가이드", "DEMO-GUIDE.ko.md"),
    ("저장본 실행", "cd demo && npm run fallback"),
    ("고객 화면", "http://127.0.0.1:4310/"),
    ("출시 판단 근거", "http://127.0.0.1:4310/presenter"),
]):
    y = 3.13 + i * .57
    text(s, label, .67, y, 1.63, .33, 13, "muted", True)
    text(s, value, 2.27, y, 4.68, .35, 11.5, "ink", font="Arial")
text(s, "공식 문서", 7.24, 2.49, 5.43, .45, 23, "ink", True)
sources = [
    ("GitHub Copilot CLI 사용", "https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview"),
    ("Custom agents 설정", "https://docs.github.com/en/copilot/reference/custom-agents-configuration"),
    ("CLI 권한·경계", "https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli"),
    ("Copilot Studio agent flows", "https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview"),
    ("A2A 공식 소개", "https://a2a-protocol.org/latest/"),
]
for i, (label, url) in enumerate(sources):
    obj = text(s, f"{i+1:02d}  {label} ↗", 7.25, 3.13 + i * .57, 5.1, .39, 16, "purple")
    obj.click_action.hyperlink.address = url
text(s, "확인일: 2026-09-26 KST   ·   발표용 보조 UI와 스크립트는 본 키트의 구현입니다.",
     .66, 6.44, 12.02, .41, 15, "muted")
notes(s, "하이퍼링크가 열리지 않으면 가이드의 경로를 사용합니다. README와 검증 기록이 "
      "전체 재현 절차의 시작점입니다. 공식 문서에서 제품 개념을 확인했으며, 본문에는 "
      "실제로 사용한 기능만 포함했습니다.", "\n".join(url for _, url in sources))

OUT.mkdir(exist_ok=True)
target = OUT / "GitHub-Copilot-Agentic-Development.pptx"
prs.save(target)
audit = {
    "slides": len(prs.slides),
    "all_have_notes": all(bool(s.notes_slide.notes_text_frame.text.strip()) for s in prs.slides),
    "source_digest": STATE["verification"]["sourceDigest"],
    "actual_test_counts": {"acceptance": acceptance["tests"], "repository": repo_suite["tests"]},
    "off_slide_shapes": [],
}
for index, slide in enumerate(prs.slides, 1):
    for item in slide.shapes:
        if item.left < 0 or item.top < 0 or item.left + item.width > prs.slide_width + 3 or item.top + item.height > prs.slide_height + 3:
            audit["off_slide_shapes"].append({"slide": index, "name": item.name})
(OUT / "slide-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
if audit["off_slide_shapes"]:
    raise RuntimeError(f"Off-slide content: {audit['off_slide_shapes']}")
print(f"Saved {target} ({len(prs.slides)} editable slides with notes)")
