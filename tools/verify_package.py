"""Exercise the ZIP from a fresh extracted directory, without project dependencies."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import json
import argparse
import subprocess
import tempfile
import zipfile
import os
import hashlib

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--verify-only", action="store_true", help="Check without replacing the saved evidence record.")
args = parser.parse_args()
archive = ROOT / "Agentic-Development-Presenter-Kit.zip"
node_env = {**os.environ, "NODE_PATH": ""}
with tempfile.TemporaryDirectory(prefix="agentic-kit-check-") as folder:
    target = Path(folder)
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = PurePosixPath(entry.filename)
            assert not path.is_absolute() and ".." not in path.parts
        assert bundle.testzip() is None
        bundle.extractall(target)
    kit = target / "Agentic-Development-Presenter-Kit"
    demo = kit / "demo"
    assert not (kit / "node_modules").exists()
    assert not (demo / "runs").exists()
    assert not (demo / "cli-reference/.demo/cli-home").exists()
    manifest = json.loads((kit / "evidence/artifact-manifest.json").read_text())
    for name, expected in manifest["files"].items():
        assert hashlib.sha256((kit / name).read_bytes()).hexdigest() == expected, name
    result = subprocess.run(["node", "scripts/workflow.mjs", "check-reference", "cli-reference"],
                            cwd=demo, env=node_env, capture_output=True, text=True, timeout=60, check=True)
    smoke = r"""
import assert from 'node:assert/strict';
import { once } from 'node:events';
const { serve } = await import('./scripts/workflow.mjs');
const server = await serve('cli-reference', 0);
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const post = key => fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: {'content-type':'application/json','Idempotency-Key':key},
    body: JSON.stringify({checkoutId:'package-checkout',productId:'DEMO-HEADSET',quantity:1})
  });
  const responses = await Promise.all([post('package-order-1'),post('package-order-1')]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  const bodies = await Promise.all(responses.map(r=>r.json()));
  assert.equal(bodies[0].order.id,bodies[1].order.id);
  assert.equal((await (await fetch(`${base}/api/orders?checkoutId=package-checkout`)).json()).total,1);
  assert.equal((await post('package-order-2')).status,201);
  assert.equal((await (await fetch(`${base}/api/orders?checkoutId=package-checkout`)).json()).total,2);
  const evidence = await (await fetch(`${base}/__demo/evidence`)).json();
  assert.equal(evidence.saved,true);
  assert.equal(evidence.state.decision,null);
  assert.equal(evidence.state.review.recommendation,'READY_FOR_HUMAN_REVIEW');
  assert.match(await (await fetch(`${base}/presenter`)).text(),/Evidence Desk/);
  console.log('PORTABLE_SMOKE_OK: retry=1, new-order=2, saved=true, final-decision=null');
} finally {
  server.closeAllConnections();
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
"""
    smoke_result = subprocess.run(
        ["node", "--input-type=module", "-e", smoke],
        cwd=demo, env=node_env, capture_output=True, text=True, timeout=30)
    if smoke_result.returncode:
        raise RuntimeError(f"Portable HTTP check failed:\n{smoke_result.stdout}\n{smoke_result.stderr}")
    assert "PORTABLE_SMOKE_OK" in smoke_result.stdout
    report = {
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        "passed": True,
        "freshExtraction": True,
        "runtimeDependenciesInstalled": False,
        "artifactHashesVerified": len(manifest["files"]),
        "kitSourceDigest": json.loads((demo / "cli-reference/.demo/state.json").read_text())["verification"]["sourceDigest"],
        "referenceTests": result.stdout.strip(),
        "httpChecks": ["simultaneous duplicate yields one order", "new key yields a second order",
                       "saved replay label", "final human decision remains null", "evidence desk responds"],
    }
if not args.verify_only:
    (ROOT / "evidence/package-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(report, ensure_ascii=False, indent=2))
