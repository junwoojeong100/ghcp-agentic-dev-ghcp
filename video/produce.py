"""Create a five-minute captioned MP4 from real recordings and local Korean speech."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "video"
WORK = VIDEO / "work"
CONFIG = json.loads((VIDEO / "narration.json").read_text())
W, H = 1920, 1080
BG, PANEL, WHITE, MUTED = "#101727", "#1b263c", "#f6f7fc", "#a2b1ca"
PURPLE, MINT, AMBER, RED = "#c6a2ec", "#79d9b7", "#eac18a", "#ee929f"
FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
for directory in [WORK, WORK / "audio", WORK / "frames", WORK / "segments", VIDEO / "recordings"]:
    directory.mkdir(parents=True, exist_ok=True)


def command(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed: {' '.join(map(str, args[:4]))}\n{result.stderr[-5000:]}")
    return result.stdout


def duration(path):
    return float(command(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", str(path)]).strip())


def font(size, bold=False):
    for index in range(12):
        try:
            candidate = ImageFont.truetype(FONT_PATH, size=size, index=index)
        except OSError:
            break
        style = candidate.getname()[1].lower()
        if (bold and style == "bold") or (not bold and style == "regular"):
            return candidate
    return ImageFont.truetype(FONT_PATH, size=size)


def wrap(content, size, width, bold=False):
    face = font(size, bold)
    lines = []
    for paragraph in content.split("\n"):
        current = ""
        for char in paragraph:
            if face.getlength(current + char) > width and current:
                lines.append(current.rstrip())
                current = char.lstrip()
            else:
                current += char
        lines.append(current.rstrip())
    return lines


def draw_text(draw, content, x, y, size, color=WHITE, bold=False, width=1700, spacing=1.23):
    lines = wrap(content, size, width, bold)
    for line in lines:
        draw.text((x, y), line, font=font(size, bold), fill=color, stroke_width=0)
        y += size * spacing
    return y


def box(draw, xy, fill=PANEL, outline=None, radius=18):
    draw.rounded_rectangle(xy, radius, fill=fill, outline=outline, width=2)


def time_srt(seconds):
    millis = round(seconds * 1000)
    return f"{millis//3600000:02d}:{millis//60000%60:02d}:{millis//1000%60:02d},{millis%1000:03d}"


def prepare_audio():
    chapters, subtitles = [], []
    absolute = 0.0
    for scene in CONFIG["scenes"]:
        chunks = []
        for index, caption in enumerate(scene["captions"], 1):
            fingerprint = hashlib.sha256(f"{CONFIG['voice']}:{CONFIG['rate']}:{caption}".encode()).hexdigest()[:10]
            path = WORK / "audio" / f"{scene['id']}-{index:02d}-{fingerprint}.aiff"
            if not path.exists():
                command(["say", "-v", CONFIG["voice"], "-r", str(CONFIG["rate"]),
                         "-o", str(path)], input=caption)
            chunks.append({"path": path, "text": caption, "duration": duration(path)})
        raw = sum(chunk["duration"] for chunk in chunks)
        target = scene["duration"] - 1.0
        speed = max(.9, raw / target)
        if speed > 1.35:
            raise RuntimeError(f"Narration too long in {scene['id']}: {raw:.1f}s for {scene['duration']}s. Shorten the script.")
        concat = WORK / "audio" / f"{scene['id']}.concat"
        concat.write_text("".join(f"file '{chunk['path']}'\n" for chunk in chunks))
        wav = WORK / "audio" / f"{scene['id']}.wav"
        command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-f", "concat", "-safe", "0", "-i", str(concat),
                 "-af", f"atempo={speed:.8f},loudnorm=I=-18:TP=-1.5:LRA=11,apad",
                 "-t", str(scene["duration"]), "-ar", "48000", "-ac", "1", str(wav)])
        local = 0.0
        scene_subtitles = []
        for chunk in chunks:
            length = chunk["duration"] / speed
            lines = wrap(chunk["text"], 42, 1750)
            pages = [lines[i:i + 2] for i in range(0, len(lines), 2)]
            total_chars = sum(len("".join(page)) for page in pages)
            consumed = 0.0
            for page in pages:
                share = len("".join(page)) / total_chars
                start = local + consumed
                end = min(scene["duration"] - .12, start + length * share)
                entry = {"start": start, "end": end, "text": "\n".join(page)}
                scene_subtitles.append(entry)
                subtitles.append({**entry, "start": start + absolute, "end": end + absolute})
                consumed += length * share
            local += length
        chapters.append({
            "id": scene["id"], "start": absolute, "duration": scene["duration"],
            "rawSpeechSeconds": round(raw, 3), "speechTempo": round(speed, 4),
            "speechSeconds": round(raw / speed, 3), "endHoldSeconds": round(scene["duration"] - raw / speed, 3),
            "audio": str(wav.relative_to(ROOT)), "captions": scene_subtitles,
        })
        print(f"Audio {scene['id']}: raw {raw:.1f}s, tempo {speed:.3f}, segment {scene['duration']}s")
        absolute += scene["duration"]
    if absolute != CONFIG["totalSeconds"]:
        raise RuntimeError("Chapter durations do not match the promised video length.")
    srt = []
    for index, item in enumerate(subtitles, 1):
        srt.append(f"{index}\n{time_srt(item['start'])} --> {time_srt(item['end'])}\n{item['text']}\n")
    (VIDEO / "Agentic-Development-Demo-KO.srt").write_text("\n".join(srt))
    result = {"duration": absolute, "voice": CONFIG["voice"], "chapters": chapters,
              "captionCount": len(subtitles), "disclaimer": CONFIG["disclaimer"]}
    (WORK / "timing.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def draw_frame(scene, index):
    image = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, 14, H), fill=PURPLE if index < 6 else MINT)
    draw_text(d, scene["eyebrow"], 66, 25, 19, PURPLE, True)
    draw_text(d, "사전 리허설 · 편집 영상  |  모의 주문 · 실결제 없음", 1170, 25, 18, MUTED, width=690)
    if len(wrap(scene["title"].replace("\n", " "), 51, 1770, True)) != 1:
        raise RuntimeError(f"Video title overflows in {scene['id']}")
    draw_text(d, scene["title"].replace("\n", " "), 64, 70, 51, WHITE, True, width=1770)
    d.line((64, 143, 1855, 143), fill="#2d3a52", width=2)
    d.line((64, 930, 1855, 930), fill="#2d3a52", width=2)
    draw_text(d, f"{index:02d} / 09", 1755, 901, 18, MUTED, width=120)
    if scene["kind"] == "browser":
        box(d, (62, 156, 1277, 914), "#0a1020", "#34415b", radius=14)
        draw_text(d, "이 장면에서 볼 것", 1320, 196, 22, MUTED, True, width=515)
        draw_text(d, scene["callout"], 1320, 259, 49, MINT if scene["page"] == "after" else PURPLE, True, width=515)
        for i, item in enumerate(scene["bullets"]):
            draw_text(d, f"0{i+1}", 1322, 510 + i * 95, 22, AMBER, True, width=65)
            draw_text(d, item, 1380, 510 + i * 95, 25, WHITE, width=457)
        draw_text(d, "발표용 보조 화면\nGitHub 제품 UI 아님", 1320, 832, 18, MUTED, width=520)
    elif scene["kind"] == "title":
        draw_text(d, "고객의 한 문장", 88, 310, 25, MUTED, True)
        draw_text(d, "“다시 눌렀더니,\n주문이 두 건 생겼어요.”", 88, 386, 57, WHITE, True, width=1100)
        draw_text(d, "계획 · 구현 · 검증 · 검토\n그리고 사람의 최종 판단", 90, 638, 32, PURPLE, width=1100)
        box(d, (1295, 241, 1850, 822), PANEL)
        draw_text(d, "같은 요청", 1370, 292, 30, MUTED, True, width=400)
        draw_text(d, "2회", 1370, 355, 111, PURPLE, True, width=440)
        draw_text(d, "↓", 1470, 517, 54, MUTED, width=180)
        draw_text(d, "주문 1건", 1365, 627, 63, MINT, True, width=455)
        draw_text(d, "5분은 설명 영상 길이입니다. 개발 소요 시간을 뜻하지 않습니다.", 90, 844, 23, MUTED)
    elif scene["kind"] == "criteria":
        cards = [
            ("01", "같은 요청을 다시 보내면", "기존 주문 결과 반환", PURPLE),
            ("02", "별도의 새 주문을 보내면", "새 주문 정상 접수", MINT),
            ("03", "같은 표식인데 내용이 다르면", "충돌 거부 · 기존 주문 유지", AMBER),
        ]
        for i, (n, title, result, color) in enumerate(cards):
            y = 207 + i * 226
            box(d, (85, y, 1835, y + 187), PANEL)
            draw_text(d, n, 125, y + 41, 48, color, True, width=170)
            draw_text(d, title, 300, y + 29, 36, MUTED, width=1460)
            draw_text(d, result, 300, y + 98, 44, WHITE, True, width=1460)
    elif scene["kind"] == "control":
        box(d, (84, 204, 1837, 399), "#332733", "#745063")
        draw_text(d, "실제 확인한 차단 조건", 124, 234, 25, AMBER, True)
        draw_text(d, "범위 승인 없음  →  구현 시작 차단", 123, 291, 49, WHITE, True)
        for x, title, body, color in [
            (84, "허용", "코드·테스트 4개 파일\n현재 요청의 수정", MINT),
            (686, "금지", "결제·DB·인증 변경\n푸시·병합·배포", RED),
            (1288, "사람의 판단", "범위·완료 기준\n최종 출시 여부", AMBER),
        ]:
            box(d, (x, 447, x + 550, 769), PANEL)
            draw_text(d, title, x + 34, 483, 34, color, True, width=485)
            draw_text(d, body, x + 34, 572, 35, WHITE, width=485)
        draw_text(d, "로컬 승인 기록과 도구 제한은 조직 인증·보호 규칙·보안 격리를 대신하지 않습니다.",
                  91, 844, 23, MUTED, width=1730)
    elif scene["kind"] == "close":
        draw_text(d, "우리 조직의 첫 한 건은?", 89, 318, 64, WHITE, True, width=1740)
        for i, label in enumerate(["작은 피해 범위", "명확한 완료 기준", "다시 실행할 근거", "책임 있는 승인자"]):
            x = 90 + i * 445
            box(d, (x, 492, x + 410, 713), PANEL)
            draw_text(d, f"0{i+1}", x + 30, 527, 31, MINT, True, width=350)
            draw_text(d, label, x + 30, 602, 34, WHITE, True, width=350)
        draw_text(d, "에이전트의 수보다, 검토 가능한 업무 결과.", 90, 817, 31, PURPLE, True)
    path = WORK / "frames" / f"{scene['id']}.png"
    image.save(path)
    return path


def caption_video(chapter):
    entries = []
    position = 0.0
    blank = WORK / "frames" / "caption-blank.png"
    if not blank.exists():
        Image.new("RGB", (W, 146), BG).save(blank)
    for index, caption in enumerate(chapter["captions"]):
        if caption["start"] > position:
            entries.append((blank, caption["start"] - position))
        image = Image.new("RGB", (W, 146), BG)
        draw = ImageDraw.Draw(image)
        lines = caption["text"].split("\n")
        y = 30 if len(lines) == 1 else 8
        face = font(42)
        for line_text in lines:
            x = (W - face.getlength(line_text)) / 2
            draw.text((x, y), line_text, font=face, fill=WHITE)
            y += 55
        path = WORK / "frames" / f"{chapter['id']}-caption-{index:02d}.png"
        image.save(path)
        entries.append((path, caption["end"] - caption["start"]))
        position = caption["end"]
    if position < chapter["duration"]:
        entries.append((blank, chapter["duration"] - position))
    listing = WORK / "frames" / f"{chapter['id']}-captions.concat"
    listing.write_text("ffconcat version 1.0\n" + "".join(
        f"file '{path}'\nduration {seconds:.6f}\n" for path, seconds in entries) + f"file '{blank}'\n")
    output = WORK / "frames" / f"{chapter['id']}-captions.mp4"
    command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
             "-safe", "0", "-i", str(listing), "-vf", "fps=25,format=yuv420p",
             "-t", str(chapter["duration"]), "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "16", "-an", str(output)])
    return output


def render(timing):
    outputs = []
    for index, (scene, chapter) in enumerate(zip(CONFIG["scenes"], timing["chapters"]), 1):
        frame = draw_frame(scene, index)
        captions = caption_video(chapter)
        output = WORK / "segments" / f"{scene['id']}.mp4"
        audio = ROOT / chapter["audio"]
        args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
        if scene["kind"] == "browser":
            clip = VIDEO / "recordings" / f"{scene['id']}.webm"
            if not clip.exists():
                raise RuntimeError(f"Missing actual browser recording: {clip}")
            args += ["-i", str(clip), "-loop", "1", "-framerate", "25", "-i", str(frame), "-i", str(audio), "-i", str(captions)]
            graph = (
                "[0:v]trim=start=1,setpts=PTS-STARTPTS,fps=25,scale=1210:754:force_original_aspect_ratio=decrease,"
                "pad=1210:754:(ow-iw)/2:(oh-ih)/2:color=0x101727,setsar=1,"
                "tpad=stop_mode=clone:stop_duration=300[screen];"
                "[1:v][screen]overlay=64:158:shortest=1[base];"
                "[base][3:v]overlay=0:934:shortest=1,format=yuv420p[v]"
            )
            args += ["-filter_complex", graph, "-map", "[v]", "-map", "2:a"]
        else:
            args += ["-loop", "1", "-framerate", "25", "-i", str(frame), "-i", str(audio), "-i", str(captions),
                     "-filter_complex", "[0:v][2:v]overlay=0:934:shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "1:a"]
        args += ["-t", str(scene["duration"]), "-r", "25", "-c:v", "libx264",
                 "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(output)]
        command(args)
        outputs.append(output)
        print(f"Rendered {scene['id']}: {duration(output):.2f}s", flush=True)
    concat = WORK / "segments.concat"
    concat.write_text("".join(f"file '{path}'\n" for path in outputs))
    final = VIDEO / "Agentic-Development-Demo-KO.mp4"
    command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(final)])
    metadata = json.loads(command(["ffprobe", "-v", "error", "-show_format", "-show_streams",
                                   "-of", "json", str(final)]))
    (VIDEO / "media-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    if abs(duration(final) - 300) > .25:
        raise RuntimeError("Final video is not approximately five minutes.")
    command(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(final), "-f", "null", "-"])
    print(f"Saved {final}: {duration(final):.3f}s", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-only", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--frames-only", action="store_true")
    args = parser.parse_args()
    if args.frames_only:
        for i, scene in enumerate(CONFIG["scenes"], 1):
            draw_frame(scene, i)
        print("Video frame templates generated.")
        raise SystemExit(0)
    timing = json.loads((WORK / "timing.json").read_text()) if args.render_only else prepare_audio()
    if not args.audio_only:
        render(timing)
