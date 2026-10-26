#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${1:-} != --isolated ]]; then
  for tool in bun opencode a2a jq timeout; do
    command -v "$tool" >/dev/null 2>&1 || { echo "demo: missing prerequisite: $tool" >&2; exit 1; }
  done
  [[ -n ${OPENAI_API_KEY:-} ]] || { echo 'demo: OPENAI_API_KEY must be set (never printed)' >&2; exit 1; }
  # prepare() checks the executable pin under the isolated environment before launch.
  cd "$(dirname "$0")/.."
  timeout --kill-after=5s 60s bun run build
  exec bun scripts/demo-workspace.ts
fi

: "${DEMO_ROOT:?}" "${DEMO_REPO:?}"
gateway=''
request=''
stage=startup
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n $request ]]; then
    kill -TERM "$request" 2>/dev/null || true
    wait "$request" 2>/dev/null || true
  fi
  if [[ -n $gateway ]]; then
    kill -TERM "$gateway" 2>/dev/null || true
    for ((attempt=0; attempt<200; attempt++)); do
      kill -0 "$gateway" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$gateway" 2>/dev/null; then
      echo 'demo: owned gateway shutdown deadline exceeded' >&2
      status=1
    else
      wait "$gateway" || status=1
    fi
  fi
  if ((status != 0)); then
    # Raw stderr can contain credentials or reasoning; report only the safe stage.
    echo "demo: failed at $stage (private diagnostics removed during cleanup)" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The production entrypoint owns its ACP process group and releases its private lease.
A2A_WORKSPACE="$PWD" A2A_PORT=0 bun "$DEMO_REPO/dist/src/server.js" \
  >"$DEMO_ROOT/gateway.jsonl" 2>"$DEMO_ROOT/gateway.stderr" &
gateway=$!
url=''
for ((attempt=0; attempt<400; attempt++)); do
  kill -0 "$gateway" 2>/dev/null || exit 1
  url=$(jq -r 'select(.ready == true) | .url' "$DEMO_ROOT/gateway.jsonl" 2>/dev/null) || true
  [[ $url =~ ^http://127\.0\.0\.1:[1-9][0-9]*/$ ]] && break
  sleep 0.1
done
[[ $url =~ ^http://127\.0\.0\.1:[1-9][0-9]*/$ ]] || exit 1
echo "demo: compiled gateway ready at $url"

cli() {
  local output=$1
  shift
  timeout --kill-after=5s 130s a2a "$@" --timeout 120s -o json \
    >"$output" 2>"$DEMO_ROOT/cli.stderr" &
  request=$!
  wait "$request"
  request=''
}
stage=card
cli "$DEMO_ROOT/card.json" card get "$url"
jq -e --arg url "$url" '.capabilities.streaming == true and
  any(.supportedInterfaces[]; .url == $url and .protocolBinding == "JSONRPC")' \
  "$DEMO_ROOT/card.json" >/dev/null
echo 'demo: official CLI card discovery verified'

marker="demo-$(bun -e 'console.log(crypto.randomUUID())')"
stage=stream
cli "$DEMO_ROOT/first.jsonl" send -a "$url" --stream \
  "Remember this marker for later: $marker. Reply with only the exact marker. Do not use tools."
stage=verify-stream
jq -es --arg marker "$marker" -f "$DEMO_REPO/scripts/demo-stream.jq" \
  "$DEMO_ROOT/first.jsonl" >"$DEMO_ROOT/first-verified.json"
context=$(jq -er '.contextId' "$DEMO_ROOT/first-verified.json")
echo 'demo: task snapshot, working, artifact appends, and exactly one completion verified'

stage=followup
cli "$DEMO_ROOT/followup.jsonl" send -a "$url" --stream --context-id "$context" \
  'What marker did I ask you to remember? Reply with only the exact marker. Do not use tools.'
stage=verify-followup
jq -es --arg marker "$marker" -f "$DEMO_REPO/scripts/demo-stream.jq" \
  "$DEMO_ROOT/followup.jsonl" >"$DEMO_ROOT/followup-verified.json"
jq -e --slurpfile first "$DEMO_ROOT/first-verified.json" \
  '.contextId == $first[0].contextId and .taskId != $first[0].taskId' \
  "$DEMO_ROOT/followup-verified.json" >/dev/null
echo 'demo: follow-up remembered the random marker in the returned context (new task)'
stage=shutdown
