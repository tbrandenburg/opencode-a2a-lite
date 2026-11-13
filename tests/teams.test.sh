#!/usr/bin/env bash
# Provider-free coverage. Real child processes, stubbed runtime and network probes.
set -euo pipefail
umask 077

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
real_opencode=$(command -v opencode || true)
mkdir -p -- "$repo/.test-results"
fixture=$(mktemp -d -- "$repo/.test-results/teams.XXXXXXXX")
mkdir -- "$fixture/bin" "$fixture/listeners" "$fixture/tmp" "$fixture/checkout"
mkdir -p -- "$fixture/checkout/examples" "$fixture/checkout/dist/src"
cp -- "$repo/Makefile" "$fixture/checkout/"
cp -R -- "$repo/examples/teams" "$fixture/checkout/examples/"
touch -- "$fixture/checkout/dist/src/cli.js"
export TMPDIR="$fixture/tmp"
export PATH="$fixture/bin:$PATH"
export A2ABRIDGE_BIN="$fixture/bin/bridge"

cleanup() {
  local result=$? file pid
  if (( result )); then
    for file in "$fixture/"*.err "$fixture/status"; do
      [[ ! -s $file ]] || { printf '\n%s\n' "${file##*/}"; cat -- "$file"; }
    done >&2
  fi
  for file in "$fixture/listeners/"*.json; do
    [[ -f $file ]] || continue
    pid=$(jq -r .pid "$file")
    if [[ -r /proc/$pid/stat && $(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null) == "$(jq -r .startTicks "$file")" ]]; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  for record in "${foreign_record:-}" "${run_record:-}"; do
    [[ -n $record ]] || continue
    pid=${record%%:*}
    if [[ -r /proc/$pid/stat && $(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null) == "${record#*:}" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf -- "$fixture"
}
trap cleanup EXIT

# Probe the actual compatible-version parser without a provider or a running server.
python3 - "$real_opencode" "$fixture" <<'PY'
import os, pathlib, re, socket, subprocess, sys

binary, root = sys.argv[1:]
version = subprocess.run([binary, '--version'], capture_output=True, text=True, timeout=5).stdout.strip() if binary else ''
match = re.fullmatch(r'opencode v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version)
if not binary or not match or tuple(map(int, match.groups())) < (2, 2, 7):
    print('OpenCode >=2.2.7 parser probe skipped: compatible executable unavailable.')
    sys.exit(0)
home = pathlib.Path(root) / 'parser-home'
home.mkdir()
env = {'PATH': '/usr/bin:/bin', 'HOME': str(home),
       'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'),
       'XDG_STATE_HOME': str(home / '.local/state'), 'XDG_CACHE_HOME': str(home / '.cache')}
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    url = 'http://127.0.0.1:' + str(sock.getsockname()[1])
    base = [binary, 'run', '--server', url, '--agent', 'coordinator']
    def run(args):
        return subprocess.run(base + args, cwd=home, env=env, capture_output=True, text=True, timeout=10)
    control = run(['--not-a-real-flag'])
    assert control.returncode != 0 and 'Unrecognized flag' in control.stderr
    for brief in ('--not-a-real-flag', '--help'):
        result = run(['--', brief])
        assert result.returncode != 0 and 'Could not reach server' in result.stderr
        assert 'Unrecognized flag' not in result.stderr and 'USAGE' not in result.stdout
print('OpenCode >=2.2.7 parser probe passed without a provider.')
PY

cat >"$fixture/bin/stub" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
fixture=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
register() {
  local name=$1 port=$2
  jq -cn --arg name "$name" --argjson pid "$$" --arg port "$port" \
    --arg ticks "$(awk '{print $22}' "/proc/$$/stat")" \
    '{name:$name,pid:$pid,port:$port,startTicks:$ticks}' >"$fixture/listeners/$port.tmp"
  /usr/bin/mv -- "$fixture/listeners/$port.tmp" "$fixture/listeners/$port.json"
}
case ${0##*/} in
  bun)
    if [[ $1 == --version ]]; then echo 1.4.4; exit; fi
    [[ ( $OPENCODE_CONFIG == *.json || $OPENCODE_CONFIG == *.jsonc ) && $HOME == */worker.*/home && ! ${OPENCODE_CONFIG_CONTENT+x} ]]
    [[ $OPENAI_API_KEY == test-model ]]
    case $A2A_NAME in
      scout) port=41321 ;;
      verify) port=41322 ;;
      bad-card) port=41323 ;;
      silent) port=41324 ;;
      stubborn) port=41325 ;;
      record-fail) port=41332; trap '' TERM ;;
      rollback) port=41326 ;;
      override) port=41327; [[ $TEAM_SYSTEM_PROMPT_FILE == */override.md ]] ;;
      repo) port=41328; [[ $GITHUB_PERSONAL_ACCESS_TOKEN == test-gh-token ]] ;;
      docs) port=41329 ;;
      *) exit 2 ;;
    esac
    if [[ $A2A_NAME != repo ]]; then [[ ! ${GITHUB_PERSONAL_ACCESS_TOKEN+x} ]]; fi
    card=$A2A_NAME
    if [[ $card == bad-card ]]; then card=wrong; fi
    register "$card" "$port"
    if [[ $A2A_NAME != silent ]]; then
      printf '{"ready":true,"url":"http://127.0.0.1:%s/"}\n' "$port"
    fi
    if [[ $A2A_NAME == bad-card ]]; then exec sleep .6; fi
    if [[ $A2A_NAME == stubborn ]]; then trap '' TERM; fi
    exec sleep 120
    ;;
  opencode)
    case $1 in
      --version) cat "$fixture/opencode-version" ;;
      service) jq -r .disabled "$XDG_CONFIG_HOME/opencode/service.json" ;;
      debug) jq -cn --arg path "$OPENCODE_CONFIG" '[{type:"document",path:$path}]' ;;
      serve)
        [[ $OPENCODE_PASSWORD && $OPENAI_API_KEY == test-model && ! ${GITHUB_PERSONAL_ACCESS_TOKEN+x} ]]
        jq -e 'length == 2' <<<"$TEAM_PEERS" >/dev/null
        printf '%s\n' '{"event":"catalog","tools":["a2a_list_agents","a2a_send_message","a2a_get_task"]}' >"$TEAM_RECEIPTS"
        register server 41331
        exec sleep 120
        ;;
      api)
        case $4 in
          config.get) jq -cn --arg path "$OPENCODE_CONFIG" '[{type:"document",path:$path}]' ;;
          agent.get) printf '%s\n' '{"data":{"id":"coordinator","mode":"primary"}}' ;;
          mcp.list) printf '%s\n' '{"data":[{"name":"network","status":{"status":"connected"}}]}' ;;
          *) exit 2 ;;
        esac
        ;;
      run)
        [[ ! -t 1 && $3 == http://127.0.0.1:41331 ]]
        [[ $4 == --agent && $5 == coordinator && $6 == -- && $# == 7 ]]
        brief=$7
        if [[ $brief == hold ]]; then
          : >"$fixture/client-ready"
          exec sleep 120
        fi
        printf 'Answer for %s\n' "$brief"
        ;;
      --server)
        [[ $2 == http://127.0.0.1:41331 && $# == 2 ]]
        [[ -t 0 && -t 1 ]]
        printf 'Interactive fixture\n'
        ;;
      *) exit 2 ;;
    esac
    ;;
  bridge|a2abridge)
    [[ $1 == directory && ! ${OPENAI_API_KEY+x} && ! ${GITHUB_PERSONAL_ACCESS_TOKEN+x} ]]
    register directory 41330
    exec sleep 120
    ;;
  gh)
    [[ $* == 'auth token --hostname github.com' && $HOME != */worker.*/home ]]
    printf '%s\n' test-gh-token
    ;;
  a2a|github-mcp-server) exit 0 ;;
  sha256sum) printf 'bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2  %s\n' "$2" ;;
  ss)
    for file in "$fixture/listeners/"*.json; do
      [[ -f $file ]] || continue
      pid=$(jq -r .pid "$file")
      port=$(jq -r .port "$file")
      if [[ -r /proc/$pid/stat ]] && ! grep -q ') Z ' "/proc/$pid/stat" 2>/dev/null; then
        printf 'LISTEN 0 100 127.0.0.1:%s 0.0.0.0:* users:(("fixture",pid=%s,fd=3))\n' "$port" "$pid"
      fi
    done
    ;;
  curl)
    url=${!#}
    case $url in
      */.well-known/agent-card.json)
        port=${url#http://127.0.0.1:}
        port=${port%%/*}
        name=$(jq -r .name "$fixture/listeners/$port.json")
        jq -cn --arg name "$name" --arg url "${url%.well-known/agent-card.json}" \
          '{name:$name,supportedInterfaces:[{url:$url,protocolVersion:"1.0",protocolBinding:"JSONRPC"}]}'
        ;;
      */healthz) printf ok ;;
      */register|*/heartbeat) printf 204 ;;
      *) exit 2 ;;
    esac
    ;;
  mv)
    [[ ${!#} != */fail.json ]] || exit 1
    exec /usr/bin/mv "$@"
    ;;
  jq)
    if [[ -e $fixture/fail-record && " $* " == *' --arg ticks '* && " $* " != *' --arg name '* ]]; then
      for ((i=0; i<100; i++)); do
        [[ -e $fixture/listeners/41332.json ]] && break
        sleep .02
      done
      for path in "$fixture/fail-record.json.state/worker."*; do
        [[ -d $path ]] && mkdir -p -- "$path/worker.process"
      done
    fi
    exec /usr/bin/jq "$@"
    ;;
  *) exit 2 ;;
esac
STUB
chmod +x -- "$fixture/bin/stub"
cp -- "$fixture/bin/stub" "$fixture/bin/bridge"
cp -- "$fixture/bin/stub" "$fixture/bin/a2abridge"
for stub in a2a bun opencode gh github-mcp-server sha256sum ss curl mv jq; do
  ln -s stub "$fixture/bin/$stub"
done

cd -- "$fixture/checkout"
export OPENAI_API_KEY=test-model
export GITHUB_PERSONAL_ACCESS_TOKEN=ambient-token OPENCODE_CONFIG_CONTENT=ambient-config
export NETWORK=ambient-network
printf '%s\n' 'opencode v2.2.7' >"$fixture/opencode-version"
network="$fixture/roster.json"
spawn() {
  make --no-print-directory spawn-agent NAME="$1" CONFIG="$2" NETWORK="${3:-$network}"
}
down() { make --no-print-directory team-down NETWORK="${1:-$network}"; }
reject() {
  if "$@" >"$fixture/rejected.out" 2>"$fixture/rejected.err"; then
    printf 'Expected a failure from %s\n' "$*" >&2
    exit 1
  fi
}
profile=examples/teams/research/scout.jsonc

printf '%s\n' 'opencode v2.2.6' >"$fixture/opencode-version"
reject spawn rejected-version "$profile" "$fixture/rejected-version.json"
grep -q '>=2.2.7' "$fixture/rejected.err"
printf '%s\n' 'opencode v2.3.0-beta.1' >"$fixture/opencode-version"
reject spawn rejected-prerelease "$profile" "$fixture/rejected-prerelease.json"
grep -q '>=2.2.7' "$fixture/rejected.err"
printf '%s\n' 'opencode v2.2.7' >"$fixture/opencode-version"

spawn scout "$profile" >"$fixture/scout.out" 2>"$fixture/scout.err" & scout=$!
spawn verify examples/teams/research/verify.jsonc >"$fixture/verify.out" 2>"$fixture/verify.err" & verify=$!
wait "$scout"
wait "$verify"
jq -e '(.workers | keys) == ["scout","verify"] and .coordinator == null' "$network" >/dev/null
grep -q 'ready.*scout.*41321' "$fixture/scout.err"
[[ ! -s $fixture/scout.out && ! -s $fixture/verify.out ]]
reject spawn scout "$profile"
grep -q 'already has a worker' "$fixture/rejected.err"

reject spawn bad-card "$profile" "$fixture/bad-card.json"
[[ ! -e $fixture/bad-card.json ]]
reject spawn rollback "$profile" "$fixture/fail.json"
[[ ! -e $fixture/fail.json ]]
rollback_pid=$(jq -r .pid "$fixture/listeners/41326.json")
if [[ -r /proc/$rollback_pid/stat ]]; then grep -q ') Z ' "/proc/$rollback_pid/stat"; fi

# A record-write failure must retain the live child's exact identity when TERM fails.
touch "$fixture/fail-record"
reject spawn record-fail "$profile" "$fixture/fail-record.json"
rm -- "$fixture/fail-record"
recovery=("$fixture/fail-record.json.state/worker."*/unverified.process)
[[ ${#recovery[@]} == 1 && -f ${recovery[0]} ]]
failure_pid=$(jq -er .pid "${recovery[0]}")
[[ $(jq -er .startTicks "${recovery[0]}") == "$(awk '{print $22}' "/proc/$failure_pid/stat")" ]]
kill -0 "$failure_pid"
kill -KILL "$failure_pid"
grep -q 'Unverified worker process' "$fixture/rejected.err"

# Exercise startup timeout without leaving an asynchronous fixture behind on failure.
if spawn silent "$profile" "$fixture/silent.json" >"$fixture/silent.out" 2>"$fixture/silent.err"; then exit 1; fi
grep -q 'did not become ready' "$fixture/silent.err"
[[ ! -e $fixture/silent.json ]]

printf 'fixture brief\n' >"$fixture/brief with spaces.md"
printf '%s\n' 'opencode v2.3.0' >"$fixture/opencode-version"
env -u A2ABRIDGE_BIN make --no-print-directory team-up NETWORK="$network" MODE=run \
  PROMPT_FILE="$fixture/brief with spaces.md" >"$fixture/answer" 2>"$fixture/status"
[[ $(<"$fixture/answer") == 'Answer for fixture brief' ]]
grep -q 'ready.*coordinator' "$fixture/status"
jq -e '.coordinator == null and (.workers | length == 2)' "$network" >/dev/null
evidence=("$network.state/"coordinator.*/receipts.jsonl)
[[ ${#evidence[@]} == 1 && -s ${evidence[0]} ]]

printf '%s\n' '--not-a-real-flag' >"$fixture/option-brief"
make --no-print-directory team-up NETWORK="$network" MODE=run \
  PROMPT_FILE="$fixture/option-brief" >"$fixture/option-answer" 2>"$fixture/option-status"
[[ $(<"$fixture/option-answer") == 'Answer for --not-a-real-flag' ]]

if command -v script >/dev/null; then
  script -qec "make --no-print-directory team-up NETWORK='$network'" /dev/null >"$fixture/tui"
  grep -q 'Interactive fixture' "$fixture/tui"
  jq -e '.coordinator == null' "$network" >/dev/null
fi

printf 'hold\n' >"$fixture/hold"
make --no-print-directory team-up NETWORK="$network" MODE=run PROMPT_FILE="$fixture/hold" \
  >"$fixture/held.out" 2>"$fixture/held.err" & run_pid=$!
run_record="$run_pid:$(awk '{print $22}' "/proc/$run_pid/stat")"
deadline=$((SECONDS + 12))
until [[ -e $fixture/client-ready ]]; do
  (( SECONDS < deadline )) || { cat "$fixture/held.err" >&2; exit 1; }
  sleep .1
done
reject make --no-print-directory team-up NETWORK="$network" MODE=run PROMPT_FILE="$fixture/hold"
grep -q 'active coordinator' "$fixture/rejected.err"
down
wait "$run_pid" && exit 1
run_pid=
run_record=
[[ ! -e $network && -s ${evidence[0]} ]]
kept=(.test-results/teams/*.jsonl)
(( ${#kept[@]} >= 3 ))
[[ $(stat -c %a .test-results/teams) == 700 && $(stat -c %a "${kept[0]}") == 600 ]]
cmp -- "${kept[0]}" "${evidence[0]}"
down "$fixture/no-team.json" 2>"$fixture/no-team.err"
grep -q 'No team is registered' "$fixture/no-team.err"
[[ ! -e $fixture/no-team.json ]]

make --no-print-directory team-up TEAM=examples/teams/research MODE=run \
  >"$fixture/folder.out" 2>"$fixture/folder.err"
[[ $(<"$fixture/folder.out") == "Answer for $(head -n 1 examples/teams/research/brief.md)" ]]
grep -q 'stopped.*scout' "$fixture/folder.err"
grep -q 'stopped.*verify' "$fixture/folder.err"
[[ -n $(find "$TMPDIR" -name receipts.jsonl -print -quit) ]]
folder_kept=(.test-results/teams/*.jsonl)
(( ${#folder_kept[@]} == ${#kept[@]} + 1 ))
reject make --no-print-directory team-up TEAM=examples/teams/research NETWORK="$network" MODE=run
grep -q 'Choose TEAM.*or NETWORK' "$fixture/rejected.err"

if command -v script >/dev/null; then
  script -qec 'make --no-print-directory team-up TEAM=examples/teams/research' /dev/null >"$fixture/folder-tui"
  grep -q 'Interactive fixture' "$fixture/folder-tui"
  [[ -n $(find "$TMPDIR" -name receipts.jsonl -print -quit) ]]
fi

reject make --no-print-directory team-report
grep -q 'Supply an existing FILE' "$fixture/rejected.err"
reject make --no-print-directory team-report FILE="$fixture/missing.jsonl"
grep -q 'Supply an existing FILE' "$fixture/rejected.err"
cat >"$fixture/receipts.jsonl" <<'JSONL'
{"connection":"c1","event":"catalog","tools":["a2a_send_message"]}
{"connection":"c1","event":"call","id":"1","tool":"a2a_send_message","peer":"http://127.0.0.1:41321/","inputHash":"aa","blocking":false,"at":"2026-11-11T10:00:00.500Z"}
{"connection":"c1","event":"result","id":"1","tool":"a2a_send_message","ok":true,"taskId":"RAW-TASK-ID","contextId":"RAW-CONTEXT-ID","state":"TASK_STATE_WORKING","at":"2026-11-11T10:00:01.000Z"}
{"connection":"c1","event":"call","id":"2","tool":"a2a_get_task","peer":"http://127.0.0.1:41321/","taskHash":"hash1","at":"2026-11-11T10:00:10.000Z"}
{"connection":"c1","event":"result","id":"2","tool":"a2a_get_task","ok":true,"taskId":"RAW-TASK-ID","state":"TASK_STATE_WORKING","at":"2026-11-11T10:00:10.100Z"}
{"connection":"c1","event":"call","id":"3","tool":"a2a_get_task","peer":"http://127.0.0.1:41321/","taskHash":"hash1","at":"2026-11-11T10:00:20.000Z"}
{"connection":"c1","event":"result","id":"3","tool":"a2a_get_task","ok":true,"taskId":"RAW-TASK-ID","state":"TASK_STATE_COMPLETED","at":"2026-11-11T10:00:20.200Z"}
{"connection":"c1","event":"call","id":"4","tool":"a2a_get_task","peer":"http://127.0.0.1:41321/","taskHash":"hash1","at":"2026-11-11T10:00:30.000Z"}
{"connection":"c1","event":"result","id":"4","tool":"a2a_get_task","ok":false,"state":"TASK_STATE_COMPLETED","at":"2026-11-11T10:00:30.100Z"}
{"connection":"c1","event":"rejected","tool":"a2a_send_message","reason":"mode","prompt":"SECRET-PROMPT"}
JSONL
make --no-print-directory team-report FILE="$fixture/receipts.jsonl" >"$fixture/report.out"
grep -q $'^  3\ta2a_get_task\t127.0.0.1:41321$' "$fixture/report.out"
grep -q $'^  task-1\t3$' "$fixture/report.out"
[[ $(grep -c $'^  task-' "$fixture/report.out") == 2 ]]
grep -q $'^  task-1\t19.7s\tlast state TASK_STATE_COMPLETED$' "$fixture/report.out"
grep -q $'^  1\ta2a_send_message\tmode$' "$fixture/report.out"
grep -q $'^  connection-1\t5/40$' "$fixture/report.out"
if grep -Eq 'RAW-|SECRET|hash1|http://|c1' "$fixture/report.out"; then exit 1; fi

# Task labels follow submission time, and the reported final state follows result time,
# not the lexical order of bridge request IDs.
cat >"$fixture/report-order.jsonl" <<'JSONL'
{"connection":"c1","event":"call","id":"z-send","tool":"a2a_send_message","peer":"http://127.0.0.1:41321/","blocking":false,"at":"2026-11-11T10:00:00.000Z"}
{"connection":"c1","event":"result","id":"z-send","tool":"a2a_send_message","ok":true,"taskId":"Z-TASK","state":"TASK_STATE_SUBMITTED","at":"2026-11-11T10:00:00.100Z"}
{"connection":"c1","event":"call","id":"a-send","tool":"a2a_send_message","peer":"http://127.0.0.1:41322/","blocking":false,"at":"2026-11-11T10:00:05.000Z"}
{"connection":"c1","event":"result","id":"a-send","tool":"a2a_send_message","ok":true,"taskId":"A-TASK","state":"TASK_STATE_SUBMITTED","at":"2026-11-11T10:00:05.100Z"}
{"connection":"c1","event":"call","id":"z-poll","tool":"a2a_get_task","peer":"http://127.0.0.1:41321/","taskHash":"hash-z","at":"2026-11-11T10:00:10.000Z"}
{"connection":"c1","event":"result","id":"z-poll","tool":"a2a_get_task","ok":true,"taskId":"Z-TASK","state":"TASK_STATE_WORKING","at":"2026-11-11T10:00:10.100Z"}
{"connection":"c1","event":"call","id":"a-poll","tool":"a2a_get_task","peer":"http://127.0.0.1:41321/","taskHash":"hash-z","at":"2026-11-11T10:00:20.000Z"}
{"connection":"c1","event":"result","id":"a-poll","tool":"a2a_get_task","ok":true,"taskId":"Z-TASK","state":"TASK_STATE_COMPLETED","at":"2026-11-11T10:00:20.200Z"}
{"connection":"c1","event":"call","id":"m-poll","tool":"a2a_get_task","peer":"http://127.0.0.1:41322/","taskHash":"hash-a","at":"2026-11-11T10:00:06.000Z"}
{"connection":"c1","event":"result","id":"m-poll","tool":"a2a_get_task","ok":true,"taskId":"A-TASK","state":"TASK_STATE_FAILED","at":"2026-11-11T10:00:06.100Z"}
JSONL
make --no-print-directory team-report FILE="$fixture/report-order.jsonl" >"$fixture/report-order.out"
grep -q $'^  task-1\t20.2s\tlast state TASK_STATE_COMPLETED$' "$fixture/report-order.out"
grep -q $'^  task-2\tnot completed\tlast state TASK_STATE_FAILED$' "$fixture/report-order.out"

mkdir -- "$fixture/mixed-profiles"
cp -- "$profile" "$fixture/mixed-profiles/scout.json"
cp -- "$profile" "$fixture/mixed-profiles/bad-card.jsonc"
reject make --no-print-directory team-up TEAM="$fixture/mixed-profiles" MODE=run \
  PROMPT_FILE="$fixture/brief with spaces.md"
grep -q 'Worker bad-card did not become ready' "$fixture/rejected.err"
grep -q 'stopped.*scout' "$fixture/rejected.err"

spawn repo examples/teams/swdev/repo.jsonc
spawn docs examples/teams/swdev/docs.jsonc
down

cp -- "$profile" "$fixture/custom profile.jsonc"
sed -i 's|{file:./scout.md}|{file:{env:TEAM_SYSTEM_PROMPT_FILE}}|' "$fixture/custom profile.jsonc"
printf 'override prompt\n' >"$fixture/override.md"
make --no-print-directory spawn-agent NAME=override CONFIG="$fixture/custom profile.jsonc" \
  SYSTEM_PROMPT="$fixture/override.md" NETWORK="$network"
down

python3 - "$fixture/foreign-port" <<'PY' &
import pathlib, socket, sys, time
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    pathlib.Path(sys.argv[1]).write_text(str(listener.getsockname()[1]))
    time.sleep(120)
PY
foreign=$!
foreign_record="$foreign:$(awk '{print $22}' "/proc/$foreign/stat")"
deadline=$((SECONDS + 5))
until [[ -s $fixture/foreign-port ]]; do
  (( SECONDS < deadline )) || exit 1
  sleep .1
done
spawn scout "$profile"
gateway_pid=$(jq -r '.workers.scout.pid' "$network")
kill -TERM "$gateway_pid"
jq --argjson pid "$foreign" '.workers.scout |= (.pid=$pid | .startTicks="0")' "$network" >"$fixture/stale.json"
mv -- "$fixture/stale.json" "$network"
reject make --no-print-directory team-up NETWORK="$network" MODE=run PROMPT_FILE="$fixture/brief with spaces.md"
grep -q 'Stale worker scout' "$fixture/rejected.err"
down
kill -0 "$foreign"
python3 - "$(<"$fixture/foreign-port")" <<'PY'
import socket, sys
with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=2):
    pass
PY
[[ ! -e $network ]]

spawn stubborn "$profile"
spawn verify examples/teams/research/verify.jsonc
reject down
jq -e '(.workers | keys) == ["stubborn"]' "$network" >/dev/null
kill -KILL "$(jq -r '.workers.stubborn.pid' "$network")"
down
[[ ! -e $network ]]

printf '%s\n' 'Provider-free team lifecycle checks passed.'
