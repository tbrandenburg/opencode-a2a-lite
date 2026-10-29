# Fresh-session two-worker pipeline bootstrap

Use this recipe only for a currently user-requested, billable two-worker smoke.
It is a new bounded usability test, not a retry or budget reset for closed issues.
The executing agent creates and reviews the disposable setup; the user need not
supply configured projects, model settings, peer maps, or a watchdog. This recipe
does not authorize another topology, a new model, or a host-side topology runner.

## Contents

1. [Contract and prerequisites](#1-contract-and-prerequisites)
2. [Create private projects and complete configuration](#2-create-private-projects-and-complete-configuration)
3. [Start only owned infrastructure](#3-start-only-owned-infrastructure)
4. [Register both workers and start heartbeat](#4-register-both-workers-and-start-heartbeat)
5. [Warm and review the actual coordinator](#5-warm-and-review-the-actual-coordinator)
6. [Supervise and run once](#6-supervise-and-run-once)
7. [Inspect actual sessions and artifacts](#7-inspect-actual-sessions-and-artifacts)
8. [Cleanup and report](#8-cleanup-and-report)

- [Observed validation](#observed-validation)

## 1. Contract and prerequisites

The complete minimal specification is **C→W1, then C→W2**, with no worker-to-worker
links. C submits W1 a synthetic marker-copy task, waits for its stored completed
artifact, then submits that exact artifact to W2 as a new independent task. C
collects W2's completed artifact and stops. Both sends explicitly use `blocking:false`
and omit context/task IDs. Each task has a 30-second submit-plus-wait deadline and
at most eight spaced polls; stop ordinary work at 32 of 40 attempts, reserving eight.
The watchdog detects this threshold passively, not before dispatch. Neither it nor
the endpoint guard guarantees a hard 40-attempt quota. If pre-dispatch prevention
is a required gate, record unsupported/BLOCKED before submitting. Otherwise require
final receipt reconciliation after shutdown: >32 fails reserve, >40 also fails the
overall-attempt gate; missing results remain uncertain, never implicitly canceled.
Make one baseline attempt; on a failure or undocumented essential step, clean up,
record the gap, and stop without a corrective live run.

Use Linux, Python 3, Bash, tmux, jq, curl, GNU timeout, Bun **1.3.9**, OpenCode **2.0.28**, and
the existing **openai/gpt-6-luna** smoke model with `OPENAI_API_KEY` present in the
launch environment. This model is selected explicitly below, as in the repository's
[isolation probe](/scripts/acp-smoke-config.ts); a different global model is irrelevant.
Do not copy auth stores, print credentials, add a provider/model, or edit global config.
Presence of the key is not proof of provider access; the first real task tests access.

Obtain/verify **a2abridge 4.0.2** with the exact archive and binary checksum commands
under [prerequisites](/docs/manual-one-worker.md#prerequisites), without running that
page's one-worker smoke. Then run from the trusted repository in a control shell:

```bash
set -euo pipefail
umask 077
export REPO="$PWD"
mkdir -p /tmp/opencode
export STATE="$(mktemp -d /tmp/opencode/pipeline-smoke.XXXXXXXX)"
export BRIDGE="$REPO/.test-results/agent-network-tools/a2abridge"
export BUN="$(command -v bun)"
export W1_PORT=41241 W2_PORT=41242 DIRECTORY_PORT=7777 COORDINATOR_PORT=41244
test "$(bun --version)" = 1.3.9
test "$(opencode --version)" = 'opencode v2.0.28'
test -n "${OPENAI_API_KEY:-}"  # presence only; never echo it
for tool in python3 tmux jq curl timeout; do command -v "$tool" >/dev/null; done
printf '%s  %s\n' bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2 "$BRIDGE" | sha256sum --check
make install
make build
```

Retain `STATE` privately. It must be new and mode 0700. Minimal empty projects are
intentional; playground clones are optional, not a prerequisite. If using a seed,
inspect its files before adapting these configs; never overwrite unfamiliar config.

## 2. Create private projects and complete configuration

This block instantiates the existing model/agent settings only in the new projects.
It also declares the ordered peer list, two-peer guard, exact stage inputs, and
stop policy. Read the resulting three configs and prompt before running them.

```python
import json
import os
import pathlib
import shlex
import socket
import uuid

root = pathlib.Path(os.environ["STATE"]).resolve()
repo = pathlib.Path(os.environ["REPO"]).resolve()
ports = {name: int(os.environ[key]) for name, key in (
    ("worker1", "W1_PORT"), ("worker2", "W2_PORT"),
    ("directory", "DIRECTORY_PORT"), ("coordinator", "COORDINATOR_PORT"))}
assert len(set(ports.values())) == 4
for port in ports.values():
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", port))
        print("free loopback port:", port)
for role in ports:
    (root / role).mkdir(mode=0o700)
    (root / "homes" / role).mkdir(parents=True, mode=0o700)
peers = [f"http://127.0.0.1:{ports[name]}/" for name in ("worker1", "worker2")]
directory = f"http://127.0.0.1:{ports['directory']}"
server = f"http://127.0.0.1:{ports['coordinator']}"
deny = {"action": "*", "resource": "*", "effect": "deny"}
tools = ["whoami", "list_agents", "send_message", "send_streaming", "get_task", "cancel_task"]
for role in ("worker1", "worker2", "coordinator"):
    agent = "coordinator" if role == "coordinator" else "worker"
    permissions = [deny] + ([{"action": "network_a2a_" + name,
                            "resource": "*", "effect": "allow"} for name in tools]
                          if role == "coordinator" else [])
    config = {
        "$schema": "https://opencode.ai/config.json",
        "model": {"providerID": "openai", "model": "gpt-6-luna"},
        "default_agent": agent, "permissions": [deny],
        "agents": {agent: {"mode": "primary", "description": "Disposable pipeline " + role,
            "system": ("Use only the six network tools. Submit W1, collect its completed artifact, "
                       "then relay it unchanged to W2. Explicit blocking:false; no native subagents, "
                       "retries, reconnects or cancellation. Preserve eight calls within forty."
                       if role == "coordinator" else "Answer concisely. Never use tools or delegate."),
            "permissions": permissions}},
        "plugins": [], "skills": [], "instructions": [], "snapshots": False, "warming": False,
    }
    if role == "coordinator":
        config["mcp"] = {"servers": {"network": {
            "type": "local", "command": [os.environ["BUN"],
                str(repo / "interop/bridge-proxy.ts"), os.environ["BRIDGE"], directory,
                str(root / "mcp-receipts.jsonl"), json.dumps(peers)],
            "cwd": str(root / role), "codemode": False,
            "timeout": {"startup": 30000, "catalog": 30000, "execution": 150000},
        }}}
    (root / role / "opencode.json").write_text(json.dumps(config, indent=2) + "\n")
exports = {"STATE": str(root), "REPO": str(repo), "BRIDGE": os.environ["BRIDGE"],
           "BUN": os.environ["BUN"], "SERVER": server, "DIRECTORY": directory,
           **{name.upper() + "_PORT": str(port) for name, port in ports.items()}}
environment = "\n".join("export " + name + "=" + shlex.quote(value) for name, value in exports.items())
environment += '''
case "$1" in worker1|worker2|coordinator|directory) ;; *) return 1 ;; esac
export HOME="$STATE/homes/$1"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state" XDG_CACHE_HOME="$HOME/.cache"
cd "$STATE/$1"
umask 077
'''
(root / "environment.sh").write_text(environment)
marker = "pipeline-" + uuid.uuid4().hex
(root / "marker.txt").write_text(marker)
prompt = f'''Use only the six configured network_a2a_* tools. Call whoami and list_agents;
verify pipeline-worker1 at {peers[0]} and pipeline-worker2 at {peers[1]}.
Submit exactly one send_message to worker1 with exactly this text:
"Reply with exactly this synthetic marker and nothing else: {marker}"
Set blocking:false and omit context_id/task_id. Retain the actual returned binding.
Poll get_task on that exact peer/task until terminal, at most eight spaced polls,
within one absolute 30-second submit-plus-wait deadline. Stop on failure or uncertainty.
Only after completed with an observed stored text artifact, submit one new task to worker2:
"Copy exactly the payload after PAYLOAD: and return only it. PAYLOAD:<exact first artifact>"
Substitute the actual artifact unchanged. Set blocking:false, omit context_id/task_id,
and poll its actual returned peer/task under a separate 30-second deadline and eight-poll cap.
Stop after the second terminal artifact. No other tasks, retries, resends, reconnect,
cancellation or native subagents. Count errors/denials; stop ordinary work at 32/40 calls.
If tools or terminal artifacts are missing, report BLOCKED/INCOMPLETE, not success.'''
(root / "prompt.txt").write_text(prompt)
(root / "parameters.json").write_text(json.dumps({"ports": ports, "peers": peers,
    "server": server, "directory": directory, "tmux": "pipeline-" + root.name}))
```

Execute this Python block from the control shell (for example via `python3 - <<'PY'`).
It contains no secret values. If a port is occupied, choose a free set and a fresh
STATE before starting anything; never kill the occupant. Review the rendered JSON:
workers must have no MCP server or tool grants; C must have exactly the two peers.
Read the remaining sections once and prepare `start.sh`, `heartbeat.sh`, `warmup.py`, `client.sh`,
`cleanup.sh`, and the documented watchdog before starting infrastructure. They are
disposable infrastructure templates, not installed services or topology callers.

## 3. Start only owned infrastructure

First save this exact environment-review/launch fragment as `STATE/start.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "${STATE:?}/environment.sh" "$1"
role=$1
if test "$role" = directory; then
  exec env -i PATH="$PATH" HOME="$HOME" "$BRIDGE" directory --addr "127.0.0.1:$DIRECTORY_PORT"
fi
opencode debug paths >"$STATE/$role-paths.txt"
python3 - "$HOME" "$STATE/$role-paths.txt" <<'PY'
import pathlib, sys
home = pathlib.Path(sys.argv[1])
paths = dict(line.split(None, 1) for line in pathlib.Path(sys.argv[2]).read_text().splitlines() if line.strip())
assert paths["home"] == str(home)
assert paths["config"] == str(home / ".config/opencode")
assert paths["state"] == str(home / ".local/state/opencode")
assert paths["data"] == str(home / ".local/share/opencode")
PY
opencode service set disabled true
opencode debug config >"$STATE/$role-sources.json"
python3 - "$STATE" "$STATE/$role-sources.json" "$PWD/opencode.json" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
documents = []
for entry in json.loads(pathlib.Path(sys.argv[2]).read_text()):
    source = pathlib.Path(entry["path"]).resolve()
    assert root in source.parents, "External configuration requires separate review"
    if entry["type"] == "document":
        assert source == pathlib.Path(sys.argv[3]).resolve()
        assert entry["info"]["model"] == {"providerID": "openai", "model": "gpt-6-luna"}
        documents.append(entry)
assert len(documents) == 1
PY
if test "$role" = coordinator; then
  exec opencode serve --hostname 127.0.0.1 --port "$COORDINATOR_PORT"
fi
port=$WORKER1_PORT
if test "$role" = worker2; then port=$WORKER2_PORT; fi
exec env A2A_NAME="pipeline-$role" A2A_DESCRIPTION='Disposable pipeline worker' \
  "$BUN" "$REPO/dist/src/cli.js" --workspace "$PWD" --port "$port"
```

Review `/etc/opencode` if it exists; stop for unsafe managed settings rather than
changing them. The next block creates an owned tmux server with a clean environment.
Only the existing provider key is inherited, in memory—not in files or command argv.
A fresh coordinator password is likewise passed in memory. All process panes start
under STATE, and their exact PIDs are recorded. No shared tmux server is touched.

```python
import json
import os
import pathlib
import secrets
import shlex
import subprocess

root = pathlib.Path(os.environ["STATE"]).resolve()
parameters = json.loads((root / "parameters.json").read_text())
name = parameters["tmux"]
environment = {"PATH": os.environ["PATH"], "STATE": str(root),
               "HOME": str(root / "homes/coordinator"),
               "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
               "OPENCODE_PASSWORD": secrets.token_urlsafe(32)}
def tmux(arguments):
    return subprocess.check_output(["tmux", "-L", name, *arguments], cwd=root,
                                   env=environment, text=True, timeout=5).strip()
existing = subprocess.run(["tmux", "-L", name, "list-sessions"], cwd=root, env=environment,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
assert existing.returncode != 0, "Refuse to modify an existing tmux server"
for index, role in enumerate(("directory", "worker1", "worker2", "coordinator")):
    command = "exec bash " + shlex.quote(str(root / "start.sh")) + " " + role
    command += " >" + shlex.quote(str(root / (role + ".log"))) + " 2>&1"
    tmux((["-f", "/dev/null"] if index == 0 else []) +
         ["new-session", "-d", "-s", role, "-c", str(root), command])
    if index == 0:
        tmux(["set-window-option", "-g", "remain-on-exit", "on"])
    (root / (role + ".pid")).write_text(tmux(["display-message", "-p", "-t", role, "#{pane_pid}"]))
tmux(["new-session", "-d", "-s", "control", "-c", str(root), "bash --noprofile --norc -i"])
print("owned tmux server:", name)
```

Read `*-paths.txt` and `*-sources.json` privately. Require paths beneath STATE, only
the expected project config document, the explicit approved model, and the intended
agent/permissions. These are configuration sources, not a merged effective-config
report. Effective agent/MCP readiness is checked below. A startup error is not readiness:
inspect only owned panes/logs and do not print raw diagnostics into public reports.

## 4. Register both workers and start heartbeat

From the control shell, probe readiness within one absolute 30-second startup window:

```python
import json, os, pathlib, re, subprocess, time, urllib.request
root = pathlib.Path(os.environ["STATE"])
p = json.loads((root / "parameters.json").read_text())
deadline = time.monotonic() + 30
while True:
    try:
        # A successful bind probe was not a reservation: do not contact another owner.
        listeners = subprocess.check_output(["ss", "-H", "-ltnp"], text=True, timeout=1)
        for role in ("directory", "worker1", "worker2"):
            pid = int((root / (role + ".pid")).read_text())
            process = pathlib.Path("/proc") / str(pid)
            fields = (process / "stat").read_text().rsplit(")", 1)[1].split()
            if fields[0] == "Z":
                raise SystemExit("Owned infrastructure process exited; inspect and clean up")
            cwd = pathlib.Path(os.readlink(process / "cwd"))
            assert (cwd == root or root in cwd.parents) and int(fields[2]) == pid
            port = p["ports"][role]
            if not any(row.split()[3] == "127.0.0.1:" + str(port)
                       and re.search(r"pid=" + str(pid) + r",", row) for row in listeners.splitlines()):
                raise OSError("Owned listener not ready")
        with urllib.request.urlopen(p["directory"] + "/agents", timeout=1) as response:
            assert response.status == 200
        for role, peer in zip(("worker1", "worker2"), p["peers"]):
            with urllib.request.urlopen(peer + ".well-known/agent-card.json", timeout=1) as response:
                card = json.load(response)
            assert card["name"] == "pipeline-" + role
            assert card["supportedInterfaces"][0]["url"] == peer
            assert card["supportedInterfaces"][0]["protocolVersion"] == "1.0"
        break
    except (OSError, ValueError):
        if time.monotonic() >= deadline:
            raise SystemExit("Owned infrastructure readiness deadline expired; inspect and clean up")
        time.sleep(0.2)
for peer in p["peers"]:
    request = urllib.request.Request(p["directory"] + "/register",
        data=json.dumps({"url": peer}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        assert response.status == 204
    with (root / "registered-peers").open("a") as output:
        output.write(peer + "\n")
print("two cards verified; both registrations HTTP 204")
```

Save as `STATE/heartbeat.sh`, then start it in a dedicated owned pane:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "${STATE:?}/environment.sh" directory
while :; do
  for port in "$WORKER1_PORT" "$WORKER2_PORT"; do
    code=$(curl --fail --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}' \
      -H 'Content-Type: application/json' --data "{\"url\":\"http://127.0.0.1:$port/\"}" "$DIRECTORY/heartbeat")
    test "$code" = 204
  done
  sleep 20
done
```

```bash
SOCKET=$(jq -r .tmux "$STATE/parameters.json")
tmux -L "$SOCKET" new-session -d -s heartbeat -c "$STATE" "exec bash '$STATE/heartbeat.sh' >'$STATE/heartbeat.log' 2>&1"
tmux -L "$SOCKET" display-message -p -t heartbeat '#{pane_pid}' >"$STATE/heartbeat.pid"
```

## 5. Warm and review the actual coordinator

Use the owned `control` pane so API clients inherit the fresh server password.
Save this read-only probe as `STATE/warmup.py`; it uses the pinned operation IDs,
one absolute startup deadline, and atomic publication of complete JSON responses:

```python
import json
import os
import pathlib
import re
import subprocess
import time

root = pathlib.Path(os.environ["STATE"])
deadline = time.monotonic() + 30
expected = {"a2a_" + name for name in (
    "whoami", "list_agents", "send_message", "send_streaming", "get_task", "cancel_task")}

def summary(status, reason):
    # Only fixed labels; never retain CLI output, errors, environment or credentials.
    (root / "warmup-summary.json").write_text(json.dumps({"status": status, "reason": reason}))

def reject(reason):
    summary("rejected", reason)
    raise SystemExit("Warmup rejected: " + reason)

while time.monotonic() < deadline:
    # Verify the reviewed endpoint still belongs to this launch before any HTTP probe.
    try:
        pid = int((root / "coordinator.pid").read_text())
        process = pathlib.Path("/proc") / str(pid)
        fields = (process / "stat").read_text().rsplit(")", 1)[1].split()
        cwd = pathlib.Path(os.readlink(process / "cwd"))
        if fields[0] == "Z" or int(fields[2]) != pid or not (cwd == root or root in cwd.parents):
            reject("owned-server-identity")
        listeners = subprocess.check_output(["ss", "-H", "-ltnp"], text=True,
            timeout=min(1, max(0.01, deadline - time.monotonic())))
    except (OSError, ValueError, subprocess.SubprocessError):
        summary("pending", "owned-server-not-ready")
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))
        continue
    port = json.loads((root / "parameters.json").read_text())["ports"]["coordinator"]
    if not any(row.split()[3] == "127.0.0.1:" + str(port)
               and re.search(r"pid=" + str(pid) + r",", row) for row in listeners.splitlines()):
        summary("pending", "owned-listener-not-ready")
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))
        continue
    probes = {}
    for operation, extra in (("config.get", []),
            ("agent.get", ["--param", "agentID=coordinator"]), ("mcp.list", [])):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            result = subprocess.run(["opencode", "api", "--server", os.environ["SERVER"],
                operation, *extra, "--param", "location[directory]=" + str(root / "coordinator")],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=remaining)
        except subprocess.TimeoutExpired:
            summary("pending", "probe-timeout")
            break
        try:
            value = json.loads(result.stdout)
        except (json.JSONDecodeError, UnicodeDecodeError):
            summary("pending", "cli-failed" if result.returncode else "empty-or-non-json")
            break
        tag = value.get("_tag") if isinstance(value, dict) else None
        if tag in ("AgentNotFoundError", "LocationNotFoundError", "ServiceUnavailableError"):
            summary("pending", "startup-not-found-or-unavailable")
            break
        if tag:
            reject("api-rejection")
        error = value.get("error") if isinstance(value, dict) else None
        if error is not None:
            if isinstance(error, dict) and error.get("status") == 404:
                summary("pending", "not-found")
                break
            reject("api-error")
        if result.returncode:
            summary("pending", "cli-failed")
            break
        if operation == "config.get":
            # The pinned V2 operation returns a source ARRAY, not a {data: ...} envelope.
            if not isinstance(value, list):
                reject("unexpected-config-shape")
            documents = []
            for entry in value:
                if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                    reject("unexpected-config-source")
                source = pathlib.Path(entry["path"]).resolve()
                if root.resolve() not in source.parents:
                    reject("external-config-source")
                if entry.get("type") == "document":
                    if source != (root / "coordinator/opencode.json").resolve():
                        reject("unexpected-config-document")
                    info = entry.get("info")
                    if not isinstance(info, dict) or info.get("model") != {"providerID": "openai", "model": "gpt-6-luna"}:
                        reject("unexpected-model")
                    documents.append(entry)
            if len(documents) != 1:
                reject("missing-private-config")
        elif not isinstance(value, dict):
            reject("unexpected-response-shape")
        elif value.get("data") is None:
            summary("pending", "empty-response")
            break
        temporary = root / (operation + ".tmp")
        temporary.write_text(json.dumps(value))
        temporary.replace(root / (operation + ".json"))
        probes[operation] = value
    if len(probes) != 3:
        time.sleep(min(0.2, max(0, deadline - time.monotonic())))
        continue
    agent = probes["agent.get"].get("data", {})
    servers = probes["mcp.list"].get("data", [])
    if not isinstance(agent, dict) or not isinstance(servers, list):
        reject("unexpected-data-shape")
    if agent and (agent.get("id") != "coordinator" or agent.get("mode") != "primary"):
        reject("wrong-agent")
    for server in servers:
        if server.get("name") != "network":
            reject("unexpected-mcp-server")
        if server.get("status", {}).get("status") not in ("connected", "connecting", "pending", "starting"):
            reject("mcp-connection-rejected")
    receipt = root / "mcp-receipts.jsonl"
    catalogs = []
    if receipt.exists():
        for line in receipt.read_text().splitlines(keepends=True):
            if line.endswith("\n"):
                row = json.loads(line)
                if row.get("event") == "catalog":
                    catalogs.append(set(row["tools"]))
    if (agent.get("id") == "coordinator" and agent.get("mode") == "primary"
            and any(s.get("name") == "network" and s.get("status", {}).get("status") == "connected" for s in servers)
            and expected in catalogs):
        (root / "warmup.ready").touch()
        summary("ready", "agent-and-catalog-observed")
        break
    summary("pending", "agent-or-catalog-pending")
    time.sleep(min(0.2, max(0, deadline - time.monotonic())))
else:
    summary("blocked", "startup-deadline")
    raise SystemExit("Warmup deadline expired")
```

```bash
tmux -L "$SOCKET" send-keys -t control "source '$STATE/environment.sh' coordinator; python3 '$STATE/warmup.py' >'$STATE/warmup.log' 2>&1" C-m
```

An initial not-found/empty/non-JSON response or failed CLI invocation may precede
activation; repeat only these
read-only probes within that absolute 30-second warmup deadline. Require `warmup.ready`, the exact
agent, `network` status `connected`, and an actual six-tool catalog receipt. Inspect
the rendered two-peer command and worker source configs again. Never submit while
the wrong agent, external config, failed connection, or missing catalog is unresolved.
Do not use the shared service, cold `run --standalone`, or a fixed sleep as proof.
The retry delay only spaces probes. `warmup-summary.json` retains fixed sanitized
status/reason labels, not stdout/stderr or environment. A concrete API rejection
(other than startup 404), wrong agent or rejected MCP connection fails closed;
unsafe configuration/path/source checks in section 3 are never retried as readiness.

## 6. Supervise and run once

Before a model task, save the cleanup block in section 8 as `STATE/cleanup.sh`.
Read [the passive watchdog](/docs/passive-mcp-supervision.md) and copy its single
Python block to `STATE/watchdog.py`. No new supervision logic must be invented.
For example, after reviewing that source:

````bash
python3 - "$REPO/docs/passive-mcp-supervision.md" "$STATE/watchdog.py" <<'PY'
import pathlib, re, sys
blocks = re.findall(r'^```python\n(.*?)^```', pathlib.Path(sys.argv[1]).read_text(), re.M | re.S)
assert len(blocks) == 1
pathlib.Path(sys.argv[2]).write_text(blocks[0])
PY
python3 -m py_compile "$STATE/watchdog.py"
bash "$STATE/cleanup.sh" "$STATE" --snapshot
tmux -L "$SOCKET" new-session -d -s watchdog -c "$STATE" "exec python3 '$STATE/watchdog.py' '$STATE' >'$STATE/watchdog.log' 2>&1"
tmux -L "$SOCKET" display-message -p -t watchdog '#{pane_pid}' >"$STATE/watchdog.pid"
for i in $(seq 1 50); do test -e "$STATE/watchdog.ready" && break; sleep 0.02; done
test -e "$STATE/watchdog.ready"
kill -0 "$(cat "$STATE/watchdog.pid")"
````

Require `watchdog.ready` and a live watchdog PID before starting the client. Save
the following as `STATE/client.sh`; its only task submission is `opencode run`.
OpenCode, not this shell, decides and issues every topology MCP call.

```bash
#!/usr/bin/env bash
set -u
source "${STATE:?}/environment.sh" coordinator
opencode run --server "$SERVER" --agent coordinator --format json \
  --title "pipeline-$(cat "$STATE/marker.txt")" "$(cat "$STATE/prompt.txt")" \
  >"$STATE/coordinator.jsonl" 2>"$STATE/client.stderr"
printf '%s\n' "$?" >"$STATE/client.exit"
```

```bash
tmux -L "$SOCKET" new-session -d -s client -c "$STATE" "exec bash '$STATE/client.sh'"
tmux -L "$SOCKET" display-message -p -t client '#{pane_pid}' >"$STATE/client.pid"
bash "$STATE/cleanup.sh" "$STATE" --snapshot
```

Monitor `supervision.json`, the
timestamped receipts and exact owned process states; the watchdog must remain alive
until it reports. A tool catalog, CLI exit zero, or `interrupted:false` is not pipeline
acceptance. On a watchdog interruption or missing evidence, stop and preserve the
private state; do not resubmit, reconnect, or silently change the instructions.

## 7. Inspect actual sessions and artifacts

For acceptance require `client.exit` equal to zero and `supervision.json` with
`interrupted:false, pending:0`; these are **not prerequisites for gathering evidence**
after failure. Execute these read-only commands in the owned control pane (whose
environment retains the coordinator password). They apply the existing V2 API/filter
to the three explicit private projects; they do not interpret or score the topology:

After watchdog interruption, wait for `supervisor-cleanup.exit` and confirm cleanup
has finished, or complete it from the original outer shell first. Do not start
inspection concurrently with shutdown. If cleanup closed the old control pane,
create a new owned `control` pane under STATE and source `environment.sh coordinator`;
stopped-server inspection uses private standalone mode and needs no old server password.

```bash
set -euo pipefail
cat >"$STATE/review.jq" <<'JQ'
{cursor, data: [.data[] |
 if .type == "user" then {id,type,text}
 elif .type == "assistant" then
  {id,type,agent,model,content:[.content[] |
   select(.type == "text" or .type == "tool") |
   if .type == "tool" then {type,id,name,state:(.state|{status,input,content,error})}
   else {type,text} end]}
 else {id,type} end]}
JQ
SOCKET=$(jq -r .tmux "$STATE/parameters.json")
tmux -L "$SOCKET" display-message -p -t control '#{pane_pid}' >"$STATE/inspection.pid"
# Record this owned inspection root before its clients; keep it separate from cleanup.
bash "$STATE/cleanup.sh" "$STATE" --snapshot
rm -f "$STATE/inspection.finished" "$STATE/inspection.done"
# Sample only OS ownership while inspection clients run; this issues no protocol calls.
(
  while test ! -e "$STATE/inspection.finished"; do
    bash "$STATE/cleanup.sh" "$STATE" --snapshot || exit 1
    sleep 0.1
  done
) >"$STATE/inspection-snapshot.log" 2>&1 &
sampler=$!
inspection_deadline=$(python3 -c 'import time; print(time.monotonic()+90)')
inspection_cli() {
  local remaining
  remaining=$(python3 - "$inspection_deadline" <<'PY'
import math, sys, time
remaining = float(sys.argv[1]) - time.monotonic()
if remaining <= 0:
    raise SystemExit(124)
print(f"{max(1, math.ceil(remaining*1000))/1000:.3f}")
PY
  ) || return 124
  timeout --signal=TERM --kill-after=3s "${remaining}s" opencode "$@"
}
inspect_sessions() (
set -euo pipefail
missing=0
for role in coordinator worker1 worker2; do
  source "$STATE/environment.sh" "$role"
  connection=(--standalone)
  if test "$role" = coordinator; then
    # Inspect the recorded owned PID, not service discovery or a failed HTTP fallback.
    pid=$(cat "$STATE/coordinator.pid")
    [[ "$pid" =~ ^[0-9]+$ ]]
    python3 - "$STATE" "$pid" <<'PY'
import json, pathlib, sys
root, pid = pathlib.Path(sys.argv[1]), sys.argv[2]
saved = json.loads((root / "owned-processes.json").read_text())[pid]
assert saved["role"] == "coordinator"
stat = pathlib.Path("/proc") / pid / "stat"
if stat.exists():
    assert stat.read_text().rsplit(")", 1)[1].split()[19] == saved["start"], "PID reused"
PY
    status=$(ps -o state= -p "$pid" | tr -d ' ' || true)
    printf 'pid=%s state=%s\n' "$pid" "${status:-absent}" >"$STATE/inspection-coordinator-status.txt"
    if test -n "$status" && [[ "$status" != Z* ]]; then
      test "$(readlink "/proc/$pid/cwd")" = "$STATE/coordinator"
      connection=(--server "$SERVER")
    else
      # Preserve the run config, then prevent read-only standalone inspection reopening MCP.
      python3 - "$STATE" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
path = root / "coordinator/opencode.json"
backup = root / "coordinator-config-before-inspection.json"
if not backup.exists():
    backup.write_bytes(path.read_bytes())
config = json.loads(path.read_text())
config["mcp"]["servers"]["network"]["disabled"] = True
path.write_text(json.dumps(config, indent=2) + "\n")
PY
    fi
    # Absent/zombie owned server: exact private HOME/XDG/project, --standalone only.
  fi
  inspection_cli session list "${connection[@]}" --max-count 20 --format json >"$STATE/$role-sessions.json"
  if test "$(jq 'length' "$STATE/$role-sessions.json")" = 0; then
    printf 'missing-session-evidence\n' >"$STATE/$role-inspection-status.txt"
    missing=1
    continue
  fi
  SESSION=$(jq -er --arg directory "$PWD" \
    'if length==1 and .[0].directory==$directory then .[0].id else error("ambiguous private session") end' \
    "$STATE/$role-sessions.json")
  inspection_cli api "${connection[@]}" session.message.list --param "sessionID=$SESSION" \
    --param limit=100 --param order=asc | jq -f "$STATE/review.jq" >"$STATE/$role-page1.json"
  page=1
  printf '[]\n' >"$STATE/$role-seen-cursors.json"
  CURSOR=$(jq -r '.cursor.next // empty' "$STATE/$role-page1.json")
  while test -n "$CURSOR"; do
    python3 - "$STATE/$role-seen-cursors.json" "$CURSOR" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
seen = json.loads(path.read_text())
assert sys.argv[2] not in seen, "Repeated inspection cursor; evidence incomplete"
seen.append(sys.argv[2])
path.write_text(json.dumps(seen))
PY
    page=$((page+1))
    inspection_cli api "${connection[@]}" session.message.list --param "sessionID=$SESSION" \
      --param limit=100 --param "cursor=$CURSOR" | jq -f "$STATE/review.jq" >"$STATE/$role-page$page.json"
    CURSOR=$(jq -r '.cursor.next // empty' "$STATE/$role-page$page.json")
  done
done
exit "$missing"
)
set +e
inspect_sessions
result=$?
touch "$STATE/inspection.finished"
wait "$sampler"
sampler_status=$?
if test "$sampler_status" != 0; then result=1; fi
if test "$result" != 0; then
  # This mode excludes the control/cleanup ancestry and never stops other roles.
  bash "$STATE/cleanup.sh" "$STATE" --inspection-stop >"$STATE/inspection-cleanup.log" 2>&1
  printf '%s\n' "$?" >"$STATE/inspection-cleanup.exit"
fi
set -e
printf '%s\n' "$result" >"$STATE/inspection.exit"
test "$result" = 0 && touch "$STATE/inspection.done"
```

Use the already observed IDs, exact project and launch time plus the unique marker
to correlate the sessions. Never infer a worker session ID from an A2A handle or
select the newest unrelated session. Each private worker home contains just this
smoke's root session; ambiguity is missing evidence, not permission to guess.
When the observed coordinator PID is absent/zombie, the exact commands expand to
`opencode session list --standalone --max-count 20 --format json` and
`opencode api --standalone session.message.list --param "sessionID=$SESSION" ...`
in `STATE/coordinator`, with `HOME=STATE/homes/coordinator` and its private XDG
paths from `environment.sh`. Never fall back to a shared service. A live but
unresponsive owned server is a finding, not permission to change connections.
Require the saved ownership/start-time record below to rule out PID reuse before
using its status; a missing/unverifiable PID file is missing evidence, not a guess.
The worker and stopped-coordinator `--standalone` calls are read-only inspection,
not prompts, continuations or topology calls. Only after the recorded coordinator
has stopped, the inspection block preserves its run config and disables that owned
project's MCP entry; it does not change a live connection or global config.
Zero sessions explicitly means missing
evidence; ambiguous sessions also block correlation. Retain `cursor.next` handling.
Record `inspection.exit` even on failure. Wait for CLI and their private inspection
servers to exit; capture their actual descendant PIDs/start times/ports while running
as below and verify release. CLI exit alone does not establish server exit. Preserve
the successful live-server inspection path when the owned coordinator is still up.
The inspection-only absolute deadline is 90 seconds; GNU timeout allows up to three
additional seconds to kill an unresponsive reader. This does not extend model-task
deadlines. Repeated cursors fail immediately. A failure stops only the recorded
inspection descendants (at most six seconds of extra cleanup), not the control shell
or coordinator/gateway roles. Preserve partial evidence and require reader/server
exit; do not restart the model or loop on a cursor to obtain more favorable evidence.

The executing agent must inspect and correlate, not run a topology scorer:

- C actually invoked the configured network tools; sends were `blocking:false` with
  fresh contexts, distinct peer/context/task bindings, and only the two approved peers.
- Both tasks reached terminal `TASK_STATE_COMPLETED`; every poll used its actual
  returned task on the same peer with stable context/task identity. Pair receipts
  by connection, MCP ID and tool—not provider tool-call ID.
- The first send text contains the intended marker. Compare coordinator tool text,
  dispatched `inputHash`, and worker user text independently (SHA-256 of exact text).
  Compare each worker's root assistant text with the terminal `artifactHash`.
- W2's input contains the actual W1 stored artifact unchanged after `PAYLOAD:`.
  Marker equality is a separate model/task check, not a substitute for artifact provenance.
- Two stages were observed; report actual submit-to-terminal times and same-task
  poll gaps, per-connection attempts including denials, and unobserved surfaces.

Do not publish raw prompts/answers, handles, receipts, databases or provider errors.
Keep model/task quality separate from transport, topology and operations findings.

## 8. Cleanup and report

Save this as `STATE/cleanup.sh` before starting the watchdog. It stops only the
verified owned roots and recorded descendants, including detached ACP groups.
`--snapshot` only records infrastructure ownership/listeners; it makes no topology
calls. Run it before submission, periodically while inspection/submission processes
are alive, and immediately before shutdown. Retain start times to detect PID reuse.

```bash
#!/usr/bin/env bash
set -euo pipefail
export STATE=${1:?owned state path required}
python3 - "$STATE" "${2:-cleanup}" <<'PY'
import json, os, pathlib, re, signal, socket, subprocess, sys, time, urllib.request
root = pathlib.Path(sys.argv[1]).resolve()
p = json.loads((root / "parameters.json").read_text())
deadline = time.monotonic() + 38  # leaves headroom beneath the watchdog's 45s timeout
ledger = root / "owned-processes.json"
saved = json.loads(ledger.read_text()) if ledger.exists() else {}
failures = []
roles = ("client", "coordinator", "heartbeat", "worker1", "worker2", "directory", "inspection")

def fail(label):
    failures.append(label)
    # Append immediately; later cleanup/report success must not erase a failure.
    try:
        with (root / "cleanup-failures.jsonl").open("a") as output:
            output.write(json.dumps({"failure": label}) + "\n")
    except OSError:
        print("cleanup failure; evidence write failed", file=sys.stderr)

def processes():
    rows = {}
    for path in pathlib.Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            rows[int(path.parent.name)] = {"state": fields[0], "parent": int(fields[1]),
                "group": int(fields[2]), "start": fields[19]}
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            if path.parent.name in saved:
                fail("owned-process-status-unreadable")
    return rows

def same(pid, row):
    return str(pid) in saved and saved[str(pid)]["start"] == row["start"]

def snapshot(record_ports=False):
    rows = processes()
    for role in roles:
        file = root / (role + ".pid")
        if not file.exists():
            continue  # partial setup; final listener checks still apply
        try:
            pid = int(file.read_text().strip())
        except (OSError, ValueError):
            fail(role + "-pid-file-invalid")
            continue
        row = rows.get(pid)
        if row is None or row["state"] == "Z":
            continue
        if str(pid) in saved and not same(pid, row):
            fail(role + "-pid-reused")
            continue
        try:
            cwd = pathlib.Path(os.readlink(f"/proc/{pid}/cwd"))
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            fail(role + "-cwd-unreadable")
            continue
        if (cwd != root and root not in cwd.parents) or row["group"] != pid:
            fail(role + "-ownership-unverified")
            continue
        saved[str(pid)] = {**row, "role": role}
    changed = True
    while changed:
        changed = False
        for pid, row in rows.items():
            parent = rows.get(row["parent"])
            if parent and same(row["parent"], parent) and not same(pid, row):
                saved[str(pid)] = {**row, "role": saved[str(row["parent"])]["role"]}
                changed = True
    try:
        temporary = ledger.with_suffix("." + str(os.getpid()) + ".tmp")
        temporary.write_text(json.dumps(saved))
        temporary.replace(ledger)
    except OSError:
        fail("ownership-write-failed")
    if record_ports:
        try:
            result = subprocess.run(["ss", "-H", "-ltnp"], capture_output=True, timeout=1)
            if result.returncode:
                fail("listener-snapshot-failed")
            portsfile = root / "recorded-ports.json"
            ports = set(json.loads(portsfile.read_text()) if portsfile.exists() else [])
            for line in result.stdout.decode().splitlines():
                if any(same(int(pid), rows[int(pid)]) for pid in re.findall(r"pid=(\d+)", line)
                       if int(pid) in rows):
                    ports.add(int(line.split()[3].rsplit(":", 1)[1]))
            temporary = portsfile.with_suffix("." + str(os.getpid()) + ".tmp")
            temporary.write_text(json.dumps(sorted(ports)))
            temporary.replace(portsfile)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            fail("listener-snapshot-unverified")
    return rows

def live(selected, excluded=()):
    rows = snapshot()
    groups = {item["group"] for item in saved.values() if item["role"] in selected}
    for pid, row in rows.items():
        if row["group"] in groups and row["state"] != "Z" and not same(pid, row):
            fail("unverified-group-member")  # never signal unknown/reused members
    return {pid: row for pid, row in rows.items() if same(pid, row)
            and saved[str(pid)]["role"] in selected and row["state"] != "Z" and pid not in excluded}

def stop(selected, seconds, descendants_only=False):
    end = min(deadline, time.monotonic() + seconds)
    ancestry = {os.getpid()}
    rows = processes()
    parent = os.getppid()
    while parent in rows and parent not in ancestry:
        ancestry.add(parent)
        parent = rows[parent]["parent"]
    excluded = ancestry if descendants_only else set()
    for sig, duration in ((signal.SIGTERM, seconds - 1), (signal.SIGKILL, 1)):
        # Exact PID + start-time revalidation; never global names or unchecked killpg.
        for pid in live(selected, excluded):
            if pid in ancestry:
                fail("cleanup-in-selected-tree-use-outer-shell")
                continue
            current = processes().get(pid)
            if current and same(pid, current) and current["state"] != "Z":
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass  # exit raced the verified signal
                except PermissionError:
                    fail("signal-denied")
        until = min(end, time.monotonic() + duration)
        while time.monotonic() < until:
            if not live(selected, excluded):
                return
            time.sleep(min(0.1, max(0, until - time.monotonic())))
    if live(selected, excluded):
        fail("shutdown-timeout-" + "-".join(selected))

snapshot(record_ports=True)
if sys.argv[2] == "--snapshot":
    raise SystemExit(bool(failures))
if sys.argv[2] == "--inspection-stop":
    stop(("inspection",), 6, descendants_only=True)
    (root / "inspection-cleanup-summary.json").write_text(json.dumps({"failures": failures}))
    raise SystemExit(bool(failures))
# Stage waits/HTTP: 6 + 3 + 6 + 7 + 5 = 27s; listener probes use remaining 38/45s budget.
for selected, seconds in ((("client", "coordinator", "inspection"), 6), (("heartbeat",), 3)):
    stop(selected, seconds)
# This boundary must close coordinator/MCP descendants before unregistering.
if live(("client", "coordinator", "inspection", "heartbeat")):
    fail("pre-unregister-closure-unverified")
registrations = root / "registered-peers"
try:
    registered = registrations.read_text().splitlines() if registrations.exists() else []
except OSError:
    fail("registration-evidence-unreadable")
    registered = []  # unknown membership; retain failure and continue owned shutdown
for peer in p["peers"]:
    if peer not in registered:
        continue  # no recorded successful registration in this partial setup
    try:
        request = urllib.request.Request(p["directory"] + "/unregister",
            data=json.dumps({"url": peer}).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=min(3, max(0.01, deadline-time.monotonic()))) as response:
            if response.status != 204:
                fail("unregister-not-204")
            else:
                print("unregister HTTP 204")
    except (OSError, ValueError):
        fail("unregister-failed")
stop(("worker1", "worker2"), 7)
if live(("worker1", "worker2")):
    fail("worker-exit-unverified")
for port in (p["ports"]["worker1"], p["ports"]["worker2"]):
    try:
        check = subprocess.run(["ss", "-H", "-ltn", "sport = :" + str(port)],
            capture_output=True, timeout=min(1, max(0.01, deadline-time.monotonic())))
        if check.returncode or check.stdout.strip():
            fail("worker-listener-not-released")
    except (OSError, subprocess.TimeoutExpired):
        fail("worker-listener-check-failed")
stop(("directory",), 5)
# recorded-ports.json contains the actual observed private/ephemeral listeners too.
portsfile = root / "recorded-ports.json"
if not portsfile.exists():
    fail("recorded-listener-evidence-missing")
ports = set(p["ports"].values()) | set(json.loads(portsfile.read_text()) if portsfile.exists() else [])
for port in sorted(ports):
    if time.monotonic() >= deadline:
        fail("port-check-deadline")
        break
    try:
        result = subprocess.run(["ss", "-H", "-ltn", "sport = :" + str(port)],
            capture_output=True, timeout=min(1, max(0.01, deadline-time.monotonic())))
        if result.returncode or result.stdout.strip():
            fail("listener-not-released")
            continue
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
    except (OSError, subprocess.TimeoutExpired):
        fail("port-release-unverified")
if time.monotonic() > deadline:
    fail("cleanup-inner-deadline")
(root / "cleanup-summary.json").write_text(json.dumps({"failures": failures,
    "missing_pid_files": [role for role in roles if not (root / (role + ".pid")).exists()],
    "registration_record_missing": not registrations.exists(),
    "zombies": sum(row["state"] == "Z" and same(pid, row) for pid, row in processes().items())}))
raise SystemExit(bool(failures))
PY
```

Before submission and while owned processes are still observable, run
`bash "$STATE/cleanup.sh" "$STATE" --snapshot`. For read-only inspection, record
the inspection shell's actual PID in `inspection.pid` before invoking its clients,
and snapshot while it is alive (a dedicated owned tmux pane supplies the root/group).
If descendants escaped observation, their exit is unverified; do not infer closure.
From the original outer control shell, **not an owned inspection/control pane**,
on success run `bash "$STATE/cleanup.sh" "$STATE" >"$STATE/cleanup.log" 2>&1` and
retain its exit code. Nonzero/timeout is failed cleanup, not successful shutdown.
On failure the watchdog runs it; inspect its log and finish cleanup independently
even if reporting failed. Require both unregister responses HTTP 204; retain any
failure, never hide it behind later successful tasks. Close the dedicated tmux server
only after workers/directory stop. It may have exited after its last pane closed:

```bash
if tmux -L "$SOCKET" has-session 2>/dev/null; then
  tmux -L "$SOCKET" kill-server
fi
```

Recheck the
recorded exact PIDs/start times afterward to require zombie reaping. Missing PID or
registration files are tolerated during partial setup, not evidence that no resource
or membership existed; report any unresolved ownership/membership as INCOMPLETE.
Run the final receipt query below only after receipt writers/inspection servers exit.

The helper signals exact revalidated PIDs rather than whole process groups; it also
checks recorded group membership and detached descendants at each boundary. No
unknown member is killed. TERM waits escalate to KILL only for those same verified
owned identities. Timeout, ownership, signal, unregister and listener failures are
retained; continue best-effort cleanup independently of reporting and preserve state.
If evidence publication itself fails, do not stop cleanup: retain the nonzero exit
and perform the remaining exact-owned checks manually. The watchdog's outer 45s
timeout is not permission to extend stage limits; the helper uses a 38s total budget
and stage waits/HTTP totaling at most 27s, plus bounded listener checks in the remaining
budget. If inner/outer bounds expire,
record unverified cleanup and finish it independently, never label timeout success.

Before live submission and again before shutdown, retain private process/listener
snapshots; the process listing deliberately omits argv and environments:

```bash
ps -eo pid,ppid,pgid,comm >"$STATE/processes-before.txt"
ss -ltnp >"$STATE/listeners-before.txt"
```

Read the exact root PIDs from `directory.pid`, `worker1.pid`, `worker2.pid`,
`coordinator.pid`, `heartbeat.pid`, and, once started, `client.pid`/`watchdog.pid`.
Follow only their PPID descendants in the snapshot; ACP may create its own process
group, so a group check alone is insufficient. Record their actual listener ports,
including ephemeral private servers/bridge listeners. Repeat into `*-after.txt`
before shutdown to include later descendants; never publish the raw host snapshots.
Use `ps -o pid,ppid,pgid,comm -p <observed-owned-pids>` for targeted final checks. On cleanup,
verify their exit and no listener on each recorded port, then rebind those ports with
the same socket-reuse semantics. A zombie is not a running listener, but still must
be reaped by the owning tmux server before accepting PID cleanup. Never use broad
process-name kills or touch a process whose ownership cannot be established.

After shutdown and inspection, use this **read-only** final reconciliation query.
It reads the entire final stream, not the watchdog prefix. First require verified
writer exit: stable size alone cannot prove a complete stream. This query does not
submit, reconnect, cancel, or infer task completion from missing results.

```bash
python3 - "$STATE/mcp-receipts.jsonl" <<'PY'
import collections, json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    raw = path.read_bytes()
    if not raw or not raw.endswith(b"\n"):
        raise ValueError("missing-or-incomplete-stream")
    rows = [json.loads(line) for line in raw.splitlines()]
    counts = collections.defaultdict(collections.Counter)
    bindings = collections.defaultdict(collections.Counter)
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid-row")
        event = row.get("event")
        connection = row.get("connection")
        if isinstance(connection, str) and connection:
            counts[connection]  # include catalog-only connections with zero attempts
        if event not in ("call", "rejected", "result"):
            continue
        if not isinstance(connection, str) or not connection:
            raise ValueError("missing-connection")
        counts[connection][event] += 1
        if event in ("call", "result"):
            if not isinstance(row.get("id"), (str, int)) or not isinstance(row.get("tool"), str):
                raise ValueError("missing-binding")
            bindings[(connection, str(row["id"]), row["tool"])][event] += 1
    total = sum(c["call"] + c["rejected"] for c in counts.values())
    unpaired = sum(c["call"] != 1 or c["result"] != 1 for c in bindings.values())
    report = {"attempts_final": total, "reserve_gate_failed": total > 32,
        "overall_attempt_gate_failed": total > 40, "unpaired_bindings": unpaired,
        "per_connection": [{"connection_index": index,
            "calls": c["call"], "rejected": c["rejected"], "results": c["result"],
            "attempts_final": c["call"] + c["rejected"]} for index, c in enumerate(counts.values(), 1)]}
    if not total:
        raise ValueError("missing-attempt-evidence")
except (OSError, ValueError, UnicodeDecodeError):
    print(json.dumps({"reconciliation": "INCOMPLETE"}))
    raise SystemExit(1)
print(json.dumps(report, indent=2))
raise SystemExit(bool(total > 32 or unpaired))
PY
```

Record final counts per connection **and combined**, including denials and any
post-threshold records. >32 fails reserve; >40 also fails the overall-attempt gate.
Exactly 32 alone is not an overrun, but still triggers the passive watchdog. A
within-budget count does not repair supervision failure, unpaired/late results or
missing session/artifact evidence. Preserve uncertain outcomes without relabeling
them canceled. If an inspection opened another connection, include its final
receipts; catalog-only connections have zero attempts and are not extra task sends.

Retain private evidence/state for an incomplete run. Delete disposable state only
after session review and verified cleanup. Report documentation usability, actual
OpenCode/MCP use, observed adapter behavior, two-stage completion and owned cleanup
separately. If an essential command/configuration needed improvisation, report the
skill-only usability gate INCOMPLETE even if the adapter worked. Do not retry until
the user separately requests another test; a fresh session does not reset old limits.

## Observed validation

On 2026-10-29, the recipe's rendered configuration, private path/source assertions, card/discovery
registration, same-server warmup, documented session inspection, and cleanup commands
were exercised during author validation. One real two-worker pipeline baseline
completed with **11 paired calls/results**, zero denials, explicit `blocking:false`
on both sends, and no pending operations in the passive supervisor. The two observed
submit-to-terminal times were **9.130s** and **9.124s**, with two and five polls.
Model arguments, dispatched hashes, received worker inputs and stored artifacts
correlated; W2 received the exact W1 artifact. Three sessions used the approved model.
Both unregister responses were HTTP 204; 15 recorded PIDs were absent and seven
recorded ports rebound. Shared listeners were untouched.

The watchdog/cleanup templates were also exercised against real owned sleep-process
groups and synthetic metadata fixtures for expired sends, eight nonterminal polls,
the 32-attempt reserve boundary, unpaired results, unexpected submissions/signals,
reporting failure and completed operations. Those
are supervisor fixture tests, not mock-based adapter E2E evidence.

This is author-run operational validation, **not an independent fresh-session
usability pass**, a repeated-model reliability result, or validation of another
topology. The earlier failed fresh-session report remains evidence of the gaps that
motivated this recipe; rerun that usability prompt separately to test the revised
instructions without prior context. No historical investigation limits are reset.
The subsequent defensive revisions were exercised with the real pinned read-only
OpenCode API (startup pending→ready and stopped-server private inspection), 11
supervisor fixture cases, full-stream overrun reconciliation, a refused foreign-context
PID, a real detached child/TCP listener, and bounded inspection/cursor/scoped-stop
checks. These submitted no model task. They
validate those helper paths, not a second live pipeline or independent fresh-session
usability. The reserve remains an observed final-count gate, not a hard pre-dispatch guarantee.
