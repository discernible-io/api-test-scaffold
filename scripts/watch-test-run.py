#!/usr/bin/env python3
"""Follow podman logs until deployment test suite finishes; print progress."""
import json
import subprocess
import sys
import time

start = time.time()
proc = subprocess.Popen(
    ["podman", "logs", "-f", "--since", "0s", "api-test-scaffold-container"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)

assert proc.stdout is not None
for line in proc.stdout:
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue

    msg = obj.get("message") or ""
    test_name = obj.get("testName")
    module_name = obj.get("moduleName")
    result = obj.get("result") or obj.get("status")

    if msg.startswith(
        ("Starting test suite:", "Running SDK-based", "Running native", "Filtered")
    ):
        print(f"SUITE {msg}", flush=True)
    elif msg.startswith("Starting test:"):
        print(f"TEST  {msg}", flush=True)
    elif "not-passed" in msg.lower() or result == "not-passed":
        print(
            f"NP    {msg[:220]} test={test_name} module={module_name}",
            flush=True,
        )
    elif msg in (
        "All tests completed",
        "Server ready to accept webhook requests",
        "Deployment test suite not-passed — aborting startup",
    ) or msg.startswith("Deployment test suite not-passed"):
        print(
            f"DONE  {msg} status={obj.get('status')} all={obj.get('allTestsSuccess')} "
            f"sdk={obj.get('sdkTestsSuccess')} native={obj.get('nativeTestsSuccess')}",
            flush=True,
        )
        if obj.get("sdk"):
            print(f"SDK_SUMMARY {obj.get('sdk')}", flush=True)
        if obj.get("native"):
            print(f"NATIVE_SUMMARY {obj.get('native')}", flush=True)
        print(f"ELAPSED_SEC {int(time.time() - start)}", flush=True)
        proc.terminate()
        sys.exit(0)

print("LOG_STREAM_ENDED", flush=True)
sys.exit(1)
