"""Recorder unit tests use synthetic events, never production demo evidence."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("capture_cli", Path(__file__).with_name("capture-cli.py"))
capture_cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture_cli)
events_in = capture_cli.events_in
final_answer_complete = capture_cli.final_answer_complete
scoped_patch = capture_cli.scoped_patch
native_edit_menu = capture_cli.native_edit_menu


class CaptureTests(unittest.TestCase):
    def test_only_allowlisted_patches_are_eligible_for_rehearsal_approval(self):
        root = Path("/demo/isolated")
        def request(text):
            return {"name": "apply_patch", "arguments": text}
        valid = "*** Begin Patch\n*** Update File: /demo/isolated/src/app.mjs\n@@\n-a\n+b\n*** End Patch"
        self.assertEqual(scoped_patch(request(valid), root), ["src/app.mjs"])
        for patch in [
            valid.replace("src/app.mjs", "REQUEST.md"),
            valid.replace("/demo/isolated", "/another/workspace"),
            valid.replace("Update File", "Delete File"),
            valid.replace("*** End Patch", "*** Move to: src/data.mjs\n*** End Patch"),
        ]:
            self.assertEqual(scoped_patch(request(patch), root), [])
        self.assertEqual(scoped_patch({"name": "bash", "arguments": "anything"}, root), [])

    def test_intermediate_tool_turn_end_does_not_exit_the_cli(self):
        final = {"type": "assistant.message", "data": {
            "phase": "final_answer", "content": "Fixture only", "toolRequests": [], "turnId": "3",
        }}
        self.assertFalse(final_answer_complete([{"type": "assistant.turn_end", "data": {"turnId": "2"}}]))
        self.assertFalse(final_answer_complete([final]))
        self.assertTrue(final_answer_complete([final, {"type": "assistant.turn_end", "data": {"turnId": "3"}}]))
        self.assertFalse(final_answer_complete([final, {"type": "assistant.turn_end", "data": {"turnId": "2"}}]))

    def test_each_file_in_one_patch_gets_its_own_once_only_approval(self):
        root = Path("/demo/isolated")
        request = {"name": "apply_patch", "toolCallId": "fixture-tool",
                   "arguments": "*** Update File: /demo/isolated/src/app.mjs\n*** Update File: /demo/isolated/public/app.mjs\n"}
        menus = []
        for path in ["src/app.mjs", "public/app.mjs"]:
            text = f"Do you want to update /demo/isolated/{path}?\n❯ 1. Yes\n2. Yes, and don't ask again"
            menus.append(native_edit_menu(text, request, root))
        self.assertNotEqual(menus[0]["signature"], menus[1]["signature"])
        self.assertIsNone(native_edit_menu("Do you want to update /demo/isolated/REQUEST.md?\n❯ 1. Yes", request, root))
        self.assertIsNone(native_edit_menu("Do you want to update /demo/isolated/src/app.mjs?\n❯ 2. Yes, and don't ask again", request, root))
        wrapped = "Do you want to update /demo/isolated/public/   │\n│ app.mjs?\n❯ 1. Yes"
        self.assertEqual(native_edit_menu(wrapped, request, root)["path"], "public/app.mjs")

    def test_partial_log_write_is_ignored_but_corrupt_finished_line_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "events.jsonl"
            path.write_text('{"type":"fixture"}\n{"partial":')
            self.assertEqual(events_in(path), [{"type": "fixture"}])
            path.write_text('invalid\n')
            with self.assertRaises(ValueError):
                events_in(path)


if __name__ == "__main__":
    unittest.main()
