#!/usr/bin/env python3
"""Report deployment test outcomes from podman logs (passed / not-passed)."""
import json
import re
import subprocess
from collections import Counter, OrderedDict


def main():
    proc = subprocess.run(
        ["podman", "logs", "api-test-scaffold-container"],
        capture_output=True,
        text=True,
    )
    stream = proc.stdout.splitlines() + proc.stderr.splitlines()

    tests = OrderedDict()
    suites = OrderedDict()
    lifecycle = []
    current_suite = None
    endpoint = None
    contract = None
    rodit = None
    not_passed = []

    for raw in stream:
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg = o.get("message") or ""
        module = o.get("moduleName")
        ctx = o.get("context") or {}

        if o.get("apiEndpoint") and "login" not in str(o.get("apiEndpoint")):
            endpoint = o.get("apiEndpoint")
        if o.get("endpoint") and "Resolved API endpoint" in msg:
            endpoint = o.get("endpoint")
        if ctx.get("contractId"):
            contract = ctx["contractId"]
        if ctx.get("roditId") and "initialized successfully" in msg:
            rodit = ctx["roditId"]
        if ctx.get("api_ep") and "Constructed API endpoint" in msg:
            endpoint = ctx["api_ep"]

        if msg in (
            "Running all test suites",
            "TLS connectivity check succeeded. Proceeding with tests",
            "TLS connectivity check not-passed. Aborting test execution",
            "All tests completed",
            "Server ready to accept webhook requests",
        ) or "Deployment test suite not-passed" in msg:
            lifecycle.append(
                {
                    "msg": msg,
                    "status": o.get("status"),
                    "all": o.get("allTestsSuccess"),
                    "sdk": o.get("sdk"),
                    "native": o.get("native"),
                }
            )

        if msg.startswith("Starting test suite:"):
            current_suite = msg.split(":", 1)[1].strip()
            suites.setdefault(current_suite, {"outcome": "running"})
        elif msg.startswith("Running SDK-based ") and msg.endswith(" tests"):
            current_suite = "sdk_" + msg[len("Running SDK-based ") : -len(" tests")]
            suites.setdefault(current_suite, {"outcome": "running"})
        else:
            m = re.search(r"Running native(?:-based)? (\S+) tests", msg)
            if m:
                current_suite = "native_" + m.group(1)
                suites.setdefault(current_suite, {"outcome": "running"})

        m = re.match(
            r"Test suite outcome:\s*(passed|not-passed|skipped)\s*[—\-:]+\s*(.+)$",
            msg,
        )
        if m:
            suites[m.group(2).strip()] = {"outcome": m.group(1)}
            continue

        m = re.match(
            r"Test outcome:\s*(passed|not-passed|skipped)\s*[—\-:]+\s*(.+)$",
            msg,
        )
        if m:
            outcome, name = m.group(1), m.group(2).strip()
            key = None
            for k, v in reversed(list(tests.items())):
                if v["test"] == name:
                    key = k
                    break
            if key is None:
                key = f"{current_suite}|{name}|{len(tests)}"
                tests[key] = {
                    "suite": current_suite,
                    "module": module,
                    "test": name,
                    "outcome": outcome,
                    "error": None,
                }
            else:
                tests[key]["outcome"] = outcome
                if module:
                    tests[key]["module"] = module
            if outcome == "not-passed":
                err = o.get("error")
                if isinstance(err, dict):
                    err = err.get("message")
                not_passed.append(
                    {
                        "suite": tests[key]["suite"],
                        "test": name,
                        "module": module,
                        "error": err,
                        "statusCode": o.get("statusCode") or o.get("httpStatus"),
                        "details": o.get("details"),
                        "msg": msg,
                    }
                )
            continue

        if msg.startswith("Starting test:"):
            name = msg.split(":", 1)[1].strip()
            key = f"{current_suite}|{name}|{len(tests)}"
            tests[key] = {
                "suite": current_suite,
                "module": module,
                "test": name,
                "outcome": "running",
                "error": None,
            }

    print("Context")
    print(f"  contract: {contract}")
    print(f"  rodit: {rodit}")
    print(f"  api: {endpoint}")
    print()
    print("Lifecycle")
    for item in lifecycle:
        print(f"  - {item['msg']}")
        if item.get("all") is not None:
            print(f"    allTestsSuccess={item['all']} sdk={item.get('sdk')} native={item.get('native')}")
    print()
    by = Counter(v["outcome"] for v in tests.values())
    print(f"Overall so far: {len(tests)} tests — {dict(by)}")
    print()
    print("Suites")
    for suite_name, meta in suites.items():
        counts = Counter(v["outcome"] for v in tests.values() if v["suite"] == suite_name)
        print(f"  [{meta['outcome']}] {suite_name}: {dict(counts) if counts else '{}'}")
    print()
    print("Tests")
    for v in tests.values():
        print(f"  [{v['outcome']}] {v['suite']} :: {v['test']}")
    print()
    if not_passed:
        print("not-passed findings")
        for d in not_passed:
            print("###", d["test"])
            print("  Suite:", d["suite"])
            print("  What happened:", d.get("error") or d.get("msg"))
            if d.get("statusCode") is not None:
                print("  statusCode:", d["statusCode"])
            if d.get("details") is not None:
                print("  details:", d["details"])
    else:
        print("not-passed findings: none yet")

    # Current tip
    running = [v for v in tests.values() if v["outcome"] == "running"]
    if running:
        print()
        print("In progress:", ", ".join(v["test"] for v in running))


if __name__ == "__main__":
    main()
