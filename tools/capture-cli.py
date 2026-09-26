"""Record a real Copilot CLI PTY. Rehearsal inputs are explicitly attributed."""
from pathlib import Path
import argparse
import codecs
import errno
import fcntl
import hashlib
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
import tty

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {"src/app.mjs", "public/app.mjs", "public/index.html", "tests/app.test.mjs"}
ANSI = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]")


def events_in(path):
    if not path.exists():
        return []
    content = path.read_text()
    lines = content.splitlines()
    if content and not content.endswith("\n"):
        lines = lines[:-1]
    return [json.loads(line) for line in lines if line.strip()]


def scoped_patch(request, workspace):
    if request.get("name") != "apply_patch" or not isinstance(request.get("arguments"), str):
        return []
    patch = request["arguments"]
    if "*** Delete File:" in patch or "*** Move to:" in patch:
        return []
    paths = re.findall(r"^\*\*\* (?:Update|Add) File: (.+)$", patch, re.M)
    if not paths:
        return []
    result = []
    for name in paths:
        path = Path(name)
        candidate = path if path.is_absolute() else workspace / path
        if candidate.is_symlink():
            return []
        resolved = candidate.resolve()
        try:
            relative = resolved.relative_to(workspace.resolve()).as_posix()
        except ValueError:
            return []
        if relative not in ALLOWED:
            return []
        result.append(relative)
    return result


def final_answer_complete(events):
    final_turns = {event["data"].get("turnId") for event in events
                   if event["type"] == "assistant.message"
                   and event["data"].get("phase") == "final_answer"
                   and event["data"].get("content", "").strip()
                   and not event["data"].get("toolRequests")}
    return any(event["type"] == "assistant.turn_end"
               and event.get("data", {}).get("turnId") in final_turns for event in events)


def native_edit_menu(text, request, workspace):
    paths = scoped_patch(request, workspace)
    if not paths or not re.search(r"❯\s*1[.)]\s*Yes", text):
        return None
    questions = re.findall(r"Do you want to (?:update|create) (.+?)\?", text, re.S)
    if not questions:
        return None
    name = re.sub(r"\s*[│┃]\s*", "", questions[-1])
    name = re.sub(r"\r?\n\s*", "", name).strip()
    candidate = Path(name)
    if not candidate.is_absolute():
        candidate = workspace / candidate
    if candidate.is_symlink():
        return None
    try:
        path = candidate.resolve().relative_to(workspace.resolve()).as_posix()
    except ValueError:
        return None
    if path not in paths:
        return None
    return {"path": path, "signature": f"{request['toolCallId']}:{path}", "question": questions[-1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--stage", choices=["session", "rework", "review"], default="session")
    parser.add_argument("--capture-id", help="A fresh recording ID; the workspace remains the same during rework.")
    parser.add_argument("--rehearsal", action="store_true", help="Drive a labeled rehearsal, never impersonate a human.")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--cols", type=int, default=112)
    parser.add_argument("--rows", type=int, default=24)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", args.run_id) or args.run_id in {"reference", "cli-reference"}:
        parser.error("Use a fresh, lowercase run ID, not a reference.")
    if not args.rehearsal and not sys.stdin.isatty():
        parser.error("Human recording requires a terminal. Use --rehearsal only for disclosed automated inputs.")
    workspace = ROOT / "demo" / "runs" / args.run_id
    capture_id = args.capture_id or (args.run_id if args.stage == "session" else f"{args.run_id}-{args.stage}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}", capture_id):
        parser.error("Invalid capture ID.")
    output = ROOT / "video" / "terminal" / capture_id
    if output.exists() or (args.stage == "session" and workspace.exists()):
        parser.error("Run or recording already exists; use a new ID. Nothing was overwritten.")
    if args.stage != "session" and not workspace.is_dir():
        parser.error("Rework and review require an existing workspace.")
    existing_sessions = {
        json.loads(path.read_text()).get("sessionId")
        for path in (workspace / ".demo" / "logs").glob("*.invocation.json")
    }
    output.mkdir(parents=True)
    cast_path = output / "session.cast"
    actions_path = output / "actions.jsonl"
    control_path = ROOT / "video" / "work" / f"{capture_id}-controls.jsonl"
    command = ["node", "scripts/workflow.mjs", args.stage, args.run_id]
    if args.stage == "review":
        command.append("--interactive")
    if args.rehearsal and args.stage == "session":
        command.append("--rehearsal")
    header = {
        "version": 2, "width": args.cols, "height": args.rows, "timestamp": int(time.time()),
        "env": {"TERM": "xterm-256color", "LANG": "ko_KR.UTF-8"},
        "title": "Actual GitHub Copilot CLI / ORDER-001",
        "command": " ".join(command),
    }
    report = {
        "schema": 1, "runId": args.run_id, "captureId": capture_id, "stage": args.stage, "command": command,
        "capture": "Unmodified output from an actual pseudo-terminal, not a scripted terminal animation.",
        "inputOrigin": "automated-rehearsal" if args.rehearsal else "terminal-user",
        "humanApproval": False if args.rehearsal else None,
        "nativePermissions": [], "stages": [], "width": args.cols, "height": args.rows,
    }
    start = time.monotonic()
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(ROOT / "demo")
        os.environ["TERM"] = "xterm-256color"
        os.environ["LANG"] = "ko_KR.UTF-8"
        fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", args.rows, args.cols, 0, 0))
        os.execvp(command[0], command)
    print(f"Recording real CLI PID {pid}: {cast_path.relative_to(ROOT)}", flush=True)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    recent, active, pending, seen_sessions, finished = "", None, None, existing_sessions, set()
    approval_done, processed_controls, last_poll = False, 0, 0
    terminal_settings = termios.tcgetattr(sys.stdin) if sys.stdin.isatty() and not args.rehearsal else None
    if terminal_settings:
        tty.setraw(sys.stdin.fileno())
    with cast_path.open("w") as cast, actions_path.open("w") as actions:
        cast.write(json.dumps(header, ensure_ascii=False) + "\n")

        def send(value, kind, evidence=None):
            os.write(fd, value.encode())
            entry = {"at": round(time.monotonic() - start, 6), "kind": kind,
                     "input": value, "origin": report["inputOrigin"], "evidence": evidence}
            actions.write(json.dumps(entry, ensure_ascii=False) + "\n")
            actions.flush()
            print(f"Input [{kind}] at {entry['at']:.1f}s", flush=True)
            return entry

        try:
            while True:
                elapsed = time.monotonic() - start
                if elapsed > args.timeout:
                    raise TimeoutError("Actual CLI recording timed out; partial capture is preserved, not labeled successful.")
                readers = [fd] + ([sys.stdin] if terminal_settings else [])
                ready, _, _ = select.select(readers, [], [], .1)
                if fd in ready:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not chunk:
                        break
                    text = decoder.decode(chunk)
                    cast.write(json.dumps([round(elapsed, 6), "o", text], ensure_ascii=False) + "\n")
                    cast.flush()
                    recent = (recent + ANSI.sub("", text))[-20000:]
                    if terminal_settings:
                        os.write(sys.stdout.fileno(), chunk)
                    if "\x1b[6n" in text:
                        os.write(fd, b"\x1b[1;1R")
                    if "\x1b]11;?" in text:
                        os.write(fd, b"\x1b]11;rgb:0d0d/1111/1717\x1b\\")
                if terminal_settings and sys.stdin in ready:
                    data = os.read(sys.stdin.fileno(), 4096)
                    os.write(fd, data)
                    actions.write(json.dumps({"at": round(elapsed, 6), "kind": "human-keyboard",
                                              "input": data.decode("utf-8", "replace"), "origin": "terminal-user"}) + "\n")
                    actions.flush()
                if not args.rehearsal or elapsed - last_poll < .4:
                    continue
                last_poll = elapsed
                invocations = list((workspace / ".demo" / "logs").glob("*.invocation.json"))
                if invocations:
                    invocation = json.loads(max(invocations, key=lambda path: path.stat().st_mtime).read_text())
                    session_id = invocation.get("sessionId")
                    if session_id and session_id not in seen_sessions:
                        seen_sessions.add(session_id)
                        active = invocation
                        pending = None
                        report["stages"].append({"agent": invocation["agent"], "sessionId": session_id, "at": elapsed})
                        print(f"Actual agent started: {invocation['agent']} ({session_id})", flush=True)
                if "[HUMAN GATE] Type APPROVE ORDER-001" in recent and not approval_done:
                    if pending is None or pending["kind"] != "scope":
                        pending = {"kind": "scope", "at": elapsed}
                    elif elapsed - pending["at"] >= 6:
                        send("APPROVE ORDER-001\r", "scope-approval-rehearsal",
                             "Controller is waiting at the explicit four-file scope gate.")
                        approval_done, pending, recent = True, None, ""
                if active:
                    log = workspace / ".demo" / "cli-home" / "session-state" / active["sessionId"] / "events.jsonl"
                    events = events_in(log)
                    completed = {event.get("data", {}).get("toolCallId") for event in events
                                 if event["type"] == "tool.execution_complete"}
                    requests = [request for event in events if event["type"] == "assistant.message"
                                for request in event.get("data", {}).get("toolRequests", [])
                                if request.get("toolCallId") not in completed]
                    edit = next((request for request in requests if scoped_patch(request, workspace)), None)
                    menu = native_edit_menu(recent[-7000:], edit, workspace) if edit else None
                    if menu and menu["signature"] not in finished:
                        if pending is None:
                            pending = {"kind": "native-edit", "at": elapsed, "id": edit["toolCallId"]}
                            print("Native edit approval is waiting; scoped paths:", scoped_patch(edit, workspace), flush=True)
                        elif pending["kind"] == "native-edit" and elapsed - pending["at"] >= 7:
                            entry = send("\r", "native-approve-once", {
                                "toolCallId": edit["toolCallId"], "paths": scoped_patch(edit, workspace),
                                "approvedPath": menu["path"], "menuObserved": menu["question"],
                            })
                            report["nativePermissions"].append(entry)
                            finished.add(menu["signature"])
                            pending, recent = None, ""
                    ended = final_answer_complete(events)
                    if ended and active["sessionId"] not in finished:
                        if pending is None:
                            pending = {"kind": "exit", "at": elapsed}
                        elif pending["kind"] == "exit" and elapsed - pending["at"] >= 6:
                            send("/exit\r", "exit-completed-agent", {"sessionId": active["sessionId"]})
                            finished.add(active["sessionId"])
                            pending, recent = None, ""
                controls = events_in(control_path)
                if len(controls) > processed_controls:
                    control = controls[processed_controls]
                    if not control.get("expect") or control["expect"] not in recent:
                        continue
                    if control.get("action") == "exit-completed" and active and ended:
                        send("/exit\r", "exit-completed-agent", {"sessionId": active["sessionId"]})
                        finished.add(active["sessionId"])
                        processed_controls += 1
                        pending, recent = None, ""
                        continue
                    if control.get("action") != "approve-once" or not active:
                        raise ValueError("Rehearsal controls allow only a scoped native approve-once action.")
                    if not edit or not menu:
                        raise ValueError("Cannot approve: no recorded, in-scope apply_patch request is pending.")
                    entry = send("\r", "native-approve-once", {
                        "toolCallId": edit["toolCallId"], "paths": scoped_patch(edit, workspace),
                        "approvedPath": menu["path"], "menuObserved": control["expect"],
                    })
                    report["nativePermissions"].append(entry)
                    finished.add(menu["signature"])
                    processed_controls += 1
                    pending, recent = None, ""
            _, status = os.waitpid(pid, 0)
            report["exitCode"] = os.waitstatus_to_exitcode(status)
        except BaseException as error:
            report["error"] = str(error)
            os.killpg(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
            raise
        finally:
            if terminal_settings:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, terminal_settings)
            os.close(fd)
            report["durationSeconds"] = round(time.monotonic() - start, 3)
            report["complete"] = report.get("exitCode") == 0
            cast.flush()
            report["castSha256"] = hashlib.sha256(cast_path.read_bytes()).hexdigest()
            (output / "capture.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if report["exitCode"]:
        raise SystemExit(report["exitCode"])
    print(f"Saved actual terminal recording ({report['durationSeconds']:.1f}s).", flush=True)


if __name__ == "__main__":
    main()
