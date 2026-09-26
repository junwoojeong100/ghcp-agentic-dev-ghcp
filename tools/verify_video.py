"""Validate the delivered media and render actual frames for visual review."""
from pathlib import Path
import json
import re
import subprocess
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "video"
path = VIDEO / "Agentic-Development-Demo-KO.mp4"
metadata = json.loads(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], text=True))
video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
audio = next(stream for stream in metadata["streams"] if stream["codec_type"] == "audio")
duration = float(metadata["format"]["duration"])
config = json.loads((VIDEO / "narration.json").read_text())
assert abs(duration - config["totalSeconds"]) < .5, f"Unexpected duration: {duration}"
assert (video["width"], video["height"]) == (1920, 1080)
assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
assert audio["codec_name"] == "aac" and int(audio["sample_rate"]) == 48000

srt = (VIDEO / "Agentic-Development-Demo-KO.srt").read_text()
def seconds(value):
    h, m, s = value.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)

timestamps = re.findall(r"(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)", srt)
previous = 0
for start_text, end_text in timestamps:
    start, end = seconds(start_text), seconds(end_text)
    assert start >= previous - .002 and end > start and end <= duration
    previous = end
assert len(timestamps) >= 30
recording = json.loads((ROOT / "evidence/video-recording.json").read_text())
assert recording["complete"] and len(recording["clips"]) == 2
terminal = json.loads((ROOT / "evidence/terminal-check.json").read_text())
rendering = json.loads((ROOT / "evidence/terminal-render.json").read_text())
assert terminal["passed"] and terminal["terminalShare"] >= .7
assert len(rendering["clips"]) == 5
assert recording["sourceDigest"] == terminal["sourceDigest"]
for scene in config["scenes"]:
    if scene["kind"] not in {"terminal", "browser"}:
        continue
    suffix = ".mp4" if scene["kind"] == "terminal" else ".webm"
    clip = VIDEO / "recordings" / (scene["id"] + suffix)
    seconds_recorded = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(clip)
    ], text=True).strip())
    assert seconds_recorded >= scene["duration"] - .15
analysis = subprocess.run([
    "ffmpeg", "-hide_banner", "-i", str(path), "-af",
    "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-vn", "-f", "null", "-"
], text=True, capture_output=True, check=True)
match = re.search(r'\{\s*"input_i".*?\}', analysis.stderr, re.S)
assert match, "Audio loudness analysis missing"
loudness = json.loads(match.group())
assert -30 < float(loudness["input_i"]) < -10, loudness
assert float(loudness["input_tp"]) < 0, loudness

preview = VIDEO / "preview"
preview.mkdir(exist_ok=True)
times = [3, 29, 61, 90, 115, 147, 183, 202, 229, 258, 278, 294]
thumbs = []
for i, timestamp in enumerate(times, 1):
    target = preview / f"frame-{timestamp:03d}s.png"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(timestamp),
                    "-i", str(path), "-frames:v", "1", str(target)], check=True)
    image = Image.open(target)
    image.thumbnail((640, 360))
    thumb = Image.new("RGB", (660, 397), "#dce2ec")
    thumb.paste(image, (10, 10))
    ImageDraw.Draw(thumb).text((14, 374), f"{timestamp//60:02d}:{timestamp%60:02d}", fill="#182236")
    thumbs.append(thumb)
for first in range(0, len(thumbs), 6):
    sheet = Image.new("RGB", (1980, 794), "#dce2ec")
    for i, thumb in enumerate(thumbs[first:first+6]):
        sheet.paste(thumb, ((i % 3) * 660, (i // 3) * 397))
    sheet.save(VIDEO / f"contact-sheet-{first//6+1}.png")
report = {
    "passed": True, "durationSeconds": duration, "resolution": [video["width"], video["height"]],
    "videoCodec": video["codec_name"], "pixelFormat": video["pix_fmt"],
    "audioCodec": audio["codec_name"], "audioSampleRate": int(audio["sample_rate"]),
    "captionCount": len(timestamps), "actualRecordedScenes": len(recording["clips"]) + len(rendering["clips"]),
    "actualBrowserScenes": len(recording["clips"]), "actualTerminalScenes": len(rendering["clips"]),
    "actualTerminalSeconds": terminal["terminalSeconds"], "actualTerminalShare": terminal["terminalShare"],
    "sourceDigest": terminal["sourceDigest"], "approvalInputOrigin": terminal["approvalInputOrigin"],
    "audioIntegratedLUFS": float(loudness["input_i"]), "audioTruePeakDBTP": float(loudness["input_tp"]),
    "fileBytes": path.stat().st_size, "frameReviewTimes": times,
    "note": "Five minutes is edited explanation time, not development elapsed time.",
}
(ROOT / "evidence/video-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
