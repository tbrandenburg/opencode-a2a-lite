# Passive supervision for the pipeline smoke

This is the infrastructure-only watchdog for the
[two-worker bootstrap](/docs/manual-two-worker-pipeline.md#6-supervise-and-run-once).
Review this file, then copy its single Python block into the owned `STATE/watchdog.py`.
It reads the existing guard's metadata receipts and signals only the owned resources
through `STATE/cleanup.sh`. It makes no MCP/A2A/ACP calls, chooses no stage or peer,
generates no prompt, and scores no answer. It is not a topology runner.

## Contents

- [Inputs and limits](#inputs-and-limits)
- [Watchdog](#watchdog)
- [Interpretation](#interpretation)

## Inputs and limits

Use a fresh private state directory. Start after same-server warmup but before the
model client. The bootstrap supplies `mcp-receipts.jsonl`, PID files, `cleanup.sh`,
and `client.exit`. Never reuse prior receipts, handles, or connections. The watchdog
uses the runbook's 30-second submit-plus-wait deadline, eight polls per task, and
32-attempt ordinary-work detection threshold (eight of 40 reserved), and at most two submissions.
The submission cap does not choose peers or enforce a stage order. Its separate 180-second
invocation safety cutoff does not extend an operation's deadline.

This is passive observation every 50ms, not a pre-dispatch quota guard. Concurrent
calls can pass the threshold before shutdown, and processing stops at the first
violation. `observed_attempts_at_stop` is only that processed prefix, never the final
attempt count. The existing endpoint guard forwards at most 40 tool requests per
connection; subsequent attempts are locally denied but still count as attempts.
It therefore does not hard-stop the caller itself at 40 attempts.
If the required gate is prevention before dispatch at either limit, this recipe is
unsupported: record BLOCKED **before submission**, not an enforcement claim.

Each accepted send has its own monotonic cutoff mapped from its timestamped guard
receipt. A result arriving after the cutoff fails even if the task completed.
Pending/uncertain operations remain pending/uncertain when owned cleanup interrupts
them; process shutdown is not evidence of remote cancellation.

## Watchdog

```python
import datetime
import hashlib
import json
import pathlib
import signal
import subprocess
import sys
import time

root = pathlib.Path(sys.argv[1]).resolve()
receipt = root / "mcp-receipts.jsonl"
offset = time.monotonic() - time.time()
started = time.monotonic()
linecount = 0
attempts = 0
submissions = 0
connection = None
requests = {}
active = {}
observing = set()
polls = {}


def moment(row):
    try:
        return datetime.datetime.fromisoformat(row["at"].replace("Z", "+00:00")).timestamp() + offset
    except (KeyError, TypeError, ValueError, AttributeError):
        stop("invalid-receipt-timestamp")


def stop(reason):
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    try:
        (root / "supervision.json").write_text(json.dumps({
            "interrupted": True, "reason": reason, "pending": len(active),
            "observed_attempts_at_stop": attempts,
        }))
    finally:
        output = None
        try:
            output = (root / "supervisor-cleanup.log").open("w")
        finally:
            try:
                result = subprocess.run(["bash", str(root / "cleanup.sh"), str(root)],
                    stdout=output if output is not None else subprocess.DEVNULL,
                    stderr=subprocess.STDOUT, timeout=45)
                (root / "supervisor-cleanup.exit").write_text(str(result.returncode))
            except subprocess.TimeoutExpired:
                (root / "supervisor-cleanup.exit").write_text("timeout; cleanup unverified")
            finally:
                if output is not None:
                    output.close()
    raise SystemExit(1)


signal.signal(signal.SIGINT, lambda number, frame: stop("supervisor-signal"))
signal.signal(signal.SIGTERM, lambda number, frame: stop("supervisor-signal"))
(root / "watchdog.ready").touch()
while True:
    try:
        data = receipt.read_text() if receipt.exists() else ""
    except OSError:
        stop("receipt-read-error")
    lines = data.splitlines(keepends=True)
    if len(lines) < linecount:
        stop("receipt-truncated")
    for line in lines[linecount:]:
        if not line.endswith("\n"):
            break
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            stop("malformed-complete-receipt")
        linecount += 1
        if not isinstance(row, dict):
            stop("unexpected-receipt-shape")
        event = row.get("event")
        if event not in ("call", "result", "rejected"):
            continue
        if not isinstance(row.get("connection"), str):
            stop("missing-connection")
        if connection is None:
            connection = row["connection"]
        if row["connection"] != connection:
            stop("connection-changed")
        if event in ("call", "rejected"):
            attempts += 1
            if attempts >= 32:
                stop("ordinary-call-reserve")
        if event == "rejected":
            stop("guard-denial")
        if not isinstance(row.get("id"), (str, int)) or not isinstance(row.get("tool"), str):
            stop("missing-request-binding")
        key = str(row["id"])
        if event == "call":
            requests[key] = row
            if row["tool"] == "a2a_send_streaming":
                stop("unexpected-streaming-submission")
            if row["tool"] == "a2a_cancel_task":
                stop("unexpected-cancellation-attempt")
            if row["tool"] == "a2a_send_message":
                active[key] = {"deadline": moment(row) + 30, "peer": row.get("peer")}
                submissions += 1
                if submissions > 2:
                    stop("submission-cap")
                if row.get("blocking") is not False:
                    stop("nonblocking-contract")
                if row.get("contextPresent") or row.get("taskPresent"):
                    stop("unexpected-continuation")
            if row["tool"] == "a2a_get_task":
                handle = (row.get("peer"), row.get("taskHash"))
                if not any(item.get("handle") == handle for item in active.values()):
                    stop("unbound-task-poll")
                if handle in observing:
                    stop("overlapping-task-polls")
                observing.add(handle)
                polls[handle] = polls.get(handle, 0) + 1
                if polls[handle] > 8:
                    stop("poll-cap")
            continue
        call = requests.pop(key, None)
        if call is None or call["tool"] != row.get("tool"):
            stop("unpaired-result")
        if row.get("ok") is not True:
            stop("tool-error-or-uncertain-submit")
        pending = key if call["tool"] == "a2a_send_message" else None
        if pending is not None:
            if not all(isinstance(row.get(name), str) and row[name] for name in ("taskId", "contextId")):
                stop("missing-returned-handle")
            digest = hashlib.sha256(row["taskId"].encode()).hexdigest()
            active[pending]["handle"] = (call.get("peer"), digest)
        if call["tool"] == "a2a_get_task":
            handle = (call.get("peer"), call.get("taskHash"))
            observing.discard(handle)
            pending = next((name for name, item in active.items()
                            if item.get("handle") == handle), None)
        if pending is not None:
            if moment(row) > active[pending]["deadline"]:
                stop("late-operation-result")
            if row.get("state") == "TASK_STATE_COMPLETED":
                del active[pending]
            elif row.get("state") != "TASK_STATE_SUBMITTED" and row.get("state") != "TASK_STATE_WORKING":
                stop("task-not-completed")
            elif call["tool"] == "a2a_get_task" and polls[handle] == 8:
                stop("poll-cap-with-pending-task")
    if any(time.monotonic() >= item["deadline"] for item in active.values()):
        stop("absolute-operation-deadline")
    if (root / "client.exit").exists():
        if active or requests:
            stop("client-ended-with-pending-evidence")
        try:
            (root / "supervision.json").write_text(json.dumps({
                "interrupted": False, "pending": 0, "observed_attempts_at_stop": attempts,
            }))
        except OSError:
            stop("supervision-report-error")
        break
    if time.monotonic() - started >= 180:
        stop("invocation-safety-cutoff")
    time.sleep(0.05)
```

## Interpretation

Require `interrupted:false` and `pending:0` for the supervision gate. This does not
prove two stages ran, inputs/artifacts matched, or a marker was correct: the executing
agent must inspect the actual sessions and paired receipts separately. No numeric
minimum poll gap is invented here; timestamps are retained and overlapping requests
for the same task fail. The model still owns polling decisions under the prompt's
spaced-poll instruction; publish observed gaps, never claim a prompt enforces time.

After the coordinator/MCP connection and receipt writers have exited, reconcile the
**complete final** receipt stream using the bootstrap's read-only final-count query.
Count `call` plus `rejected` per connection and across the run, including records
after the watchdog's processed prefix. A final total **>32 fails the reserve gate**;
**>40 also fails the overall-attempt gate**. Exactly 32 triggers passive shutdown
without itself proving a reserve overrun. Missing, malformed or trailing incomplete
receipts make reconciliation INCOMPLETE. Reconcile calls/results separately by
connection, MCP ID and tool: missing results remain missing/uncertain, not canceled,
even when the final count is within budget. Inspection must not reopen MCP; count
again after any standalone inspection to include its connection receipts.

An interruption is a supervision/caller/evidence finding, not automatically an
adapter defect. Preserve the private state and returned handles for review, execute
the bootstrap's remaining cleanup checks, and stop without another model attempt.
