#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

status() {
  if [[ -t 2 && ! ${NO_COLOR+x} ]]; then
    printf '\033[1;36m  %-10s\033[0m %s\n' "$1" "$2" >&2
  else
    printf '  %-10s %s\n' "$1" "$2" >&2
  fi
}
die() { status error "$*"; exit 1; }
signal_traps() { trap 'exit 130' INT; trap 'exit 143' TERM; }

action=${1:-}
case $action in
  spawn-agent|team-up|team-down) ;;
  *) die 'Use make spawn-agent, make team-up, or make team-down.' ;;
esac

check_mode() {
  case $1 in
    tui) [[ -t 0 && -t 1 ]] || die 'Open a terminal for TUI mode or use MODE=run.' ;;
    run) [[ -n ${TEAM_PROMPT_FILE:-} && -f $TEAM_PROMPT_FILE && -r $TEAM_PROMPT_FILE && -s $TEAM_PROMPT_FILE ]] ||
      die 'Supply a readable, nonempty PROMPT_FILE.' ;;
    *) die 'Use MODE=tui or MODE=run.' ;;
  esac
}

folder_step() {
  local result=0 pending=0
  trap 'pending=130' INT
  trap 'pending=143' TERM
  exec 8<&0
  bash "$launcher" "$@" <&8 8<&- &
  folder_child=$!
  exec 8<&-
  signal_traps
  (( pending == 0 )) || exit "$pending"
  wait "$folder_child" || result=$?
  folder_child=
  return "$result"
}

folder_cleanup() {
  local result=$?
  trap - EXIT
  trap '' INT TERM
  if [[ -n $folder_child ]]; then
    kill -TERM "$folder_child" 2>/dev/null || true
    wait "$folder_child" || true
  fi
  if bash "$launcher" team-down; then
    if [[ -d $TEAM_NETWORK.state ]]; then rmdir -- "$TEAM_NETWORK.state" 2>/dev/null || true; fi
    if [[ ! -e $TEAM_NETWORK.state ]]; then
      rm -f -- "$TEAM_NETWORK.lock"
      rmdir -- "$folder_state"
      exit "$result"
    fi
    status cleanup "Private evidence remains at $folder_state. Inspect it before removal."
    exit "$result"
  fi
  status cleanup "Team state remains at $folder_state. Roster path is $TEAM_NETWORK."
  (( result != 0 )) || result=1
  exit "$result"
}

up_folder() {
  [[ -z ${TEAM_NETWORK:-} ]] || die 'Choose TEAM for a temporary team or NETWORK for an existing roster.'
  local folder profile name
  local -a profiles=()
  local -A seen=()
  if ! folder=$(realpath -e -- "$TEAM_FOLDER") || [[ ! -d $folder ]]; then
    die 'TEAM must be a worker profile directory.'
  fi
  launcher=$(realpath -e -- "${BASH_SOURCE[0]}")
  shopt -s nullglob
  for profile in "$folder"/*.json "$folder"/*.jsonc; do
    name=${profile##*/}
    name=${name%.*}
    [[ $name != coordinator ]] || continue
    [[ -f $profile && -r $profile && $name =~ ^[a-z][a-z0-9-]{0,31}$ ]] || die "Invalid worker profile $profile."
    [[ ! ${seen[$name]+x} ]] || die "Duplicate worker profile for $name."
    seen[$name]=1
    profiles+=("$profile")
  done
  (( ${#profiles[@]} > 0 )) || die 'TEAM contains no worker profiles.'
  if [[ ${TEAM_MODE:-tui} == run ]]; then
    export TEAM_PROMPT_FILE="${TEAM_PROMPT_FILE:-$folder/brief.md}"
  fi
  check_mode "${TEAM_MODE:-tui}"

  folder_state=$(mktemp -d "${TMPDIR:-/tmp}/opencode-team.XXXXXXXX")
  folder_child=
  export TEAM_NETWORK="$folder_state/team.json" TEAM_FOLDER=
  signal_traps
  trap folder_cleanup EXIT
  for profile in "${profiles[@]}"; do
    name=${profile##*/}
    TEAM_NAME="${name%.*}" TEAM_CONFIG="$profile" TEAM_SYSTEM_PROMPT='' folder_step spawn-agent
  done
  folder_step team-up
}

if [[ $action == team-up && -n ${TEAM_FOLDER:-} ]]; then
  up_folder
  exit
fi

for tool in jq flock realpath stat ss; do
  command -v "$tool" >/dev/null || die "Missing $tool."
done
[[ -n ${TEAM_NETWORK:-} ]] || die 'Supply NETWORK=/path/to/private/roster.json.'
parent=$(realpath -e -- "$(dirname -- "$TEAM_NETWORK")") || die 'Create the private roster directory first.'
private_directory() {
  local permissions
  [[ -d $1 && -O $1 && ! -L $1 ]] || return 1
  permissions=$(stat -c %a -- "$1") || return 1
  (( (8#$permissions & 077) == 0 ))
}
private_directory "$parent" || die 'The roster directory must be yours and have mode 0700 or stricter.'
filename=$(basename -- "$TEAM_NETWORK")
[[ $filename =~ ^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$ ]] || die 'Use a simple roster filename ending in .json.'
network="$parent/$filename"
runtime="$network.state"
examples=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo=$(cd -- "$examples/../.." && pwd -P)
npm_cache=${npm_config_cache:-$HOME/.npm}
read -r boot_id < /proc/sys/kernel/random/boot_id
for file in "$network" "$network.lock"; do
  [[ ! -L $file && ( ! -e $file || ( -f $file && -O $file ) ) ]] || die 'Invalid roster or lock file.'
done
exec 9>>"$network.lock"
lock() { flock -w 90 9 || die 'Timed out waiting for the roster lock.'; }
unlock() { flock -u 9; }
signal_traps

read_roster() {
  if [[ -f $network ]]; then
    roster=$(<"$network")
  else
    roster=$(jq -cn --arg boot "$boot_id" \
      '{version:1,bootId:$boot,workers:{},coordinator:null,stopping:null}')
  fi
  jq -e '
    def identity:
      type == "object" and (.pid | type == "number" and . > 1 and . == floor)
      and (.startTicks | type == "string" and test("^[0-9]+$"));
    def state($prefix):
      type == "string" and test("^" + $prefix + "\\.[a-zA-Z0-9]+$");
    .version == 1 and (.bootId | type == "string") and
    (.workers | type == "object" and all(to_entries[];
      (.key | test("^[a-z][a-z0-9-]{0,31}$")) and
      (.value | identity and (.state | state("worker")) and (.url | type == "string")))) and
    (.coordinator | . == null or (identity and (.state | state("coordinator")))) and
    (.stopping | . == null or identity)
  ' <<<"$roster" >/dev/null || die 'Invalid roster JSON.'
}

write_roster() {
  local temp
  temp=$(mktemp -- "$network.tmp.XXXXXXXX") || return 1
  if printf '%s\n' "$1" >"$temp" && mv -fT -- "$temp" "$network"; then return 0; fi
  rm -f -- "$temp"
  return 1
}

# Linux /proc stat field 22 is start time. The command name may contain spaces.
start_ticks() {
  local line fields
  [[ $1 =~ ^[1-9][0-9]*$ && -O /proc/$1 ]] || return 1
  IFS= read -r line 2>/dev/null <"/proc/$1/stat" || return 1
  read -ra fields <<<"${line##*) }"
  [[ ${fields[0]:-Z} != Z && ${fields[19]:-} =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${fields[19]}"
}

identity() {
  local ticks
  ticks=$(start_ticks "$1") || return 1
  jq -cn --argjson pid "$1" --arg ticks "$ticks" '{pid:$pid,startTicks:$ticks}'
}

live() {
  local pid ticks actual
  IFS=$'\t' read -r pid ticks < <(jq -er '[.pid,.startTicks] | @tsv' <<<"$1") || return 2
  [[ -d /proc/$pid ]] || return 1
  if ! actual=$(start_ticks "$pid"); then
    [[ ! -d /proc/$pid ]] && return 1
    [[ -r /proc/$pid/stat ]] || return 2
    grep -q ') Z ' "/proc/$pid/stat" && return 1
    return 2
  fi
  [[ $actual == "$ticks" ]]
}

stop_process() {
  local record=$1 pid deadline state
  pid=$(jq -er '.pid' <<<"$record") || return 1
  [[ $pid =~ ^[1-9][0-9]*$ && $pid != 1 ]] || return 1
  if live "$record"; then state=0; else state=$?; fi
  (( state == 1 )) && return 0
  (( state == 0 )) || return 1
  kill -TERM -- "-$pid" 2>/dev/null || true
  if ! kill -TERM "$pid" 2>/dev/null; then
    if live "$record"; then return 1; else state=$?; fi
    (( state == 1 ))
    return
  fi
  deadline=$((SECONDS + $2))
  while live "$record" && (( SECONDS < deadline )); do sleep .1; done
  if live "$record"; then return 1; else state=$?; fi
  (( state == 1 ))
}

same_boot() { [[ $(jq -r '.bootId' <<<"$roster") == "$boot_id" ]]; }

prepare_root() {
  if [[ ! -e $runtime && ! -L $runtime ]]; then mkdir -- "$runtime"; fi
  private_directory "$runtime" || die 'Invalid private runtime directory.'
}

prepare_workspace() {
  mkdir -p -- "$state/project" "$state/home/.config/opencode" "$state/run"
  # The pinned CLI reads this private file and leases a standalone ACP server.
  printf '%s\n' '{"disabled":true}' >"$state/home/.config/opencode/service.json"
}

require_runtime() {
  local tool key version major minor patch
  for tool in bun opencode curl timeout setsid; do
    command -v "$tool" >/dev/null || die "Missing $tool."
  done
  bun=$(command -v bun)
  opencode=$(command -v opencode)
  [[ $("$bun" --version) == 1.4.4 ]] || die 'Expected Bun 1.4.4.'
  if ! version=$("$opencode" --version); then die 'Could not read OpenCode version; expected stable OpenCode >=2.2.7.'; fi
  [[ $version =~ ^opencode\ v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    die 'Expected stable OpenCode >=2.2.7.'
  major=$((10#${BASH_REMATCH[1]}))
  minor=$((10#${BASH_REMATCH[2]}))
  patch=$((10#${BASH_REMATCH[3]}))
  (( major > 2 || (major == 2 && minor > 2) || (major == 2 && minor == 2 && patch >= 7) )) ||
    die 'Expected stable OpenCode >=2.2.7.'
  [[ ! -e /etc/opencode && ! -L /etc/opencode ]] || die 'Managed OpenCode settings require separate review.'
  read -ra forward <<<"${TEAM_PASS_ENV:-OPENAI_API_KEY}"
  for key in "${forward[@]}"; do
    [[ $key =~ ^[A-Z][A-Z0-9_]*_API_KEY$ ]] ||
      die 'TEAM_PASS_ENV accepts model API key variable names.'
  done
}

private() {
  local key
  while IFS= read -r key; do export -n "${key?}"; done < <(compgen -e)
  export PATH TERM NO_COLOR
  export HOME="$state/home" XDG_CONFIG_HOME="$state/home/.config"
  export XDG_DATA_HOME="$state/home/.local/share" XDG_STATE_HOME="$state/home/.local/state"
  export XDG_CACHE_HOME="$state/home/.cache" XDG_RUNTIME_DIR="$state/run" OPENCODE_CONFIG="$config"
  # Share the npm cache so npx-based MCP servers start before the first task.
  export npm_config_cache="$npm_cache"
  for key in "${forward[@]}"; do export "${key?}"; done
  if [[ $action == spawn-agent ]]; then
    export A2A_NAME="$name" TEAM_SYSTEM_PROMPT_FILE="$prompt"
    if [[ -n $github_token ]]; then export GITHUB_PERSONAL_ACCESS_TOKEN="$github_token"; fi
  else
    export OPENCODE_PASSWORD="$password"
    export TEAM_BUN="$bun" TEAM_PROXY="$repo/interop/bridge-proxy.ts" TEAM_BRIDGE="$bridge"
    export TEAM_DIRECTORY="$directory" TEAM_PEERS="$peer_json" TEAM_RECEIPTS="$state/receipts.jsonl"
  fi
  cd -- "$state/project"
  exec 9>&-
  exec "$@"
}

sources_ok() {
  jq -e --arg config "$config" --arg prefix "$state/" '
    type == "array" and ([.[] | select(.type == "document") | .path] == [$config]) and
    all(.[]; .type == "document" or (.type == "directory" and (.path | startswith($prefix))))
  ' >/dev/null
}

curl_local() { curl -q --noproxy '*' -fsS --max-time 2 "$@"; }

owned_url() {
  local port
  port=$(ss -H -ltnp | awk -v pid="$1" '
    !found && $4 ~ /^127\.0\.0\.1:[1-9][0-9]*$/ && index($0, "pid=" pid ",") {
      split($4, address, ":"); print address[2]; found = 1
    }
  ') || return 1
  [[ $port =~ ^[1-9][0-9]{0,4}$ ]] && printf 'http://127.0.0.1:%s/\n' "$port"
}

card_ok() {
  [[ $2 =~ ^http://127\.0\.0\.1:[1-9][0-9]{0,4}/$ ]] || return 1
  curl_local "$2.well-known/agent-card.json" 2>/dev/null |
    jq -e --arg name "$1" --arg url "$2" '
      .name == $name and any(.supportedInterfaces[];
        .url == $url and .protocolVersion == "1.0" and .protocolBinding == "JSONRPC")
    ' >/dev/null
}

wait_for() {
  local record=$1 deadline=$((SECONDS + $2))
  shift 2
  while live "$record" && (( SECONDS < deadline )); do
    if "$@"; then return 0; fi
    sleep .2
  done
  return 1
}

worker_ready() {
  local url owned
  url=$(jq -Rr 'fromjson? | select(.ready == true) | .url' "$state/ready.jsonl") || return 1
  owned=$(owned_url "$worker_pid") || return 1
  [[ $url == "$owned" ]] && card_ok "$name" "$url" && printf '%s\n' "$url"
}

# Defer signals until the child identity is recorded, and preserve TUI input.
launch_child() {
  local file="$state/$1.process" pending=0 record result=0
  shift
  # Create the retention marker before starting a process: even a failed record
  # write must not permit cleanup to remove the only recovery location.
  : >"$state/unverified.process" || return 1
  trap 'pending=130' INT
  trap 'pending=143' TERM
  exec 8<&0
  "$@" <&8 8<&- &
  child_pid=$!
  exec 8<&-
  if ! record=$(identity "$child_pid"); then
    printf 'pid=%s; start time unavailable; do not signal without verification\n' "$child_pid" >"$state/unverified.process" || true
    status cleanup "Could not verify child PID $child_pid; inspect private state at $state."
    result=1
  elif ! printf '%s\n' "$record" >"$file"; then
    printf '%s\n' "$record" >"$state/unverified.process" || true
    status cleanup "Child identity $record; private recovery state at $state."
    if stop_process "$record" 8; then
      rm -f -- "$state/unverified.process"
    else
      status cleanup "Could not stop child PID $child_pid; retain its identity for inspection."
    fi
    result=1
  else
    rm -f -- "$state/unverified.process"
  fi
  signal_traps
  (( pending == 0 )) || exit "$pending"
  return "$result"
}

spawn_cleanup() {
  local result=$?
  trap - EXIT
  trap '' INT TERM
  if [[ $published == false ]]; then
    if [[ -e $state/unverified.process ]]; then
      status cleanup "Unverified worker process; private state remains at $state."
      exit 1
    fi
    if [[ -f $state/worker.process ]] && ! stop_process "$(<"$state/worker.process")" 8; then
      status cleanup "Could not stop the unregistered worker. Private state remains at $state."
      exit 1
    fi
    rm -rf -- "$state"
  fi
  exit "$result"
}

spawn() {
  name=${TEAM_NAME:-}
  [[ $name =~ ^[a-z][a-z0-9-]{0,31}$ ]] || die 'Use a lowercase NAME such as scout or release-notes.'
  if ! config=$(realpath -e -- "${TEAM_CONFIG:-}") || [[ ! -f $config || ! -r $config ]]; then
    die 'Supply a readable native OpenCode CONFIG file.'
  fi
  prompt=
  if grep -Fq '{file:{env:TEAM_SYSTEM_PROMPT_FILE}}' "$config"; then
    if ! prompt=$(realpath -e -- "${TEAM_SYSTEM_PROMPT:-${config%.*}.md}") || [[ ! -f $prompt || ! -r $prompt ]]; then
      die 'The selected system prompt file is unreadable.'
    fi
  elif [[ -n ${TEAM_SYSTEM_PROMPT:-} ]]; then
    die 'This profile needs a native TEAM_SYSTEM_PROMPT_FILE reference to accept SYSTEM_PROMPT.'
  fi
  require_runtime
  [[ -r $repo/dist/src/cli.js ]] || die 'Run make install and make build first.'
  github_token=
  case $config in
    "$examples/swdev/repo.jsonc")
      if ! command -v gh >/dev/null || ! command -v github-mcp-server >/dev/null; then
        die 'Install gh and the local github-mcp-server binary.'
      fi
      if ! github_token=$(timeout 10s gh auth token --hostname github.com 2>/dev/null) || [[ -z $github_token ]]; then
        die 'Log in with gh auth login before starting the GitHub worker.'
      fi
      ;;
    "$examples"/web/*)
      command -v playwright-mcp >/dev/null || die 'Install the browser MCPs: npm i -g @playwright/mcp chrome-devtools-mcp.'
      command -v chrome-devtools-mcp >/dev/null || die 'Install the browser MCPs: npm i -g @playwright/mcp chrome-devtools-mcp.'
      ;;
  esac
  lock
  read_roster
  same_boot || die 'The roster is from a different boot. Run team-down first.'
  jq -e '.stopping == null' <<<"$roster" >/dev/null || die 'Team teardown is in progress. Finish team-down first.'
  if jq -e --arg name "$name" '.workers | has($name)' <<<"$roster" >/dev/null; then
    die "The roster already has a worker named $name. Use another name or run team-down."
  fi
  prepare_root
  state=$(mktemp -d -- "$runtime/worker.XXXXXXXX")
  published=false
  trap spawn_cleanup EXIT
  prepare_workspace
  [[ $(private timeout 4s "$opencode" service get disabled 2>/dev/null) == true ]] ||
    die 'Private OpenCode service configuration was not recognized.'
  private timeout 15s "$opencode" debug config 2>/dev/null | sources_ok ||
    die 'OpenCode did not report only the supplied profile and private sources.'

  launch_child worker private setsid "$bun" "$repo/dist/src/cli.js" --workspace "$state/project" --port 0 \
    </dev/null >"$state/ready.jsonl" 2>"$state/worker.err" || die "Could not record worker $name."
  worker_pid=$child_pid
  [[ -f $state/worker.process ]] || die "Worker $name exited during launch."
  worker_record=$(<"$state/worker.process")
  url=$(wait_for "$worker_record" 35 worker_ready) || die "Worker $name did not become ready."
  # A throwaway first task lets OpenCode connect the profile's MCP servers before real work.
  if command -v a2a >/dev/null; then
    timeout 90 a2a send -a "$url" 'Reply with the single word OK.' >/dev/null 2>&1 || status warn "$name warm-up did not finish."
  fi
  next=$(jq -c --arg name "$name" --arg url "$url" --arg state "${state##*/}" \
    --argjson process "$worker_record" '.workers[$name] = ($process + {url:$url,state:$state})' <<<"$roster")
  # Defer ordinary signals across publication and ownership transfer.
  trap '' INT TERM
  write_roster "$next" || die 'Could not publish the worker in the roster.'
  published=true
  unlock
  status ready "$name · $url"
  status roster "$filename · workers $(jq '.workers | length' <<<"$next")"
}

directory_post() {
  local method=$1 url=$2
  [[ $(curl_local -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    --data "$(jq -cn --arg url "$url" '{url:$url}')" "$directory$method" 2>/dev/null) == 204 ]]
}

heartbeat() {
  local timer='' peer
  exec 9>&-
  trap 'if [[ -n $timer ]]; then kill "$timer" 2>/dev/null || true; fi; exit 0' TERM
  while :; do
    sleep 20 & timer=$!
    wait "$timer"
    timer=
    for peer in "${peers[@]}"; do
      directory_post heartbeat "$peer" || { status error 'A2A directory heartbeat failed.'; return 1; }
    done
  done
}

stop_services() {
  local service record failed=0
  if [[ -e $1/unverified.process ]]; then
    status cleanup "An unverified child requires manual inspection at $1."
    failed=1
  fi
  for service in client heartbeat server directory; do
    [[ -f $1/$service.process ]] || continue
    record=$(<"$1/$service.process")
    if stop_process "$record" 8; then
      rm -f -- "$1/$service.process"
    else
      status cleanup "Could not stop the coordinator's $service process."
      failed=1
    fi
  done
  (( failed == 0 ))
}

keep_receipts() {
  local dir="$repo/.test-results/teams" copy
  [[ -s $state/receipts.jsonl ]] || return 0
  if mkdir -p -- "$dir" && copy=$(mktemp --suffix=.jsonl -- "$dir/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX"); then
    if cat -- "$state/receipts.jsonl" >"$copy"; then
      status receipts "Kept a private copy at $copy. Summarize with make team-report FILE=<path>."
      return 0
    fi
    rm -f -- "$copy"
  fi
  status warn "Could not keep a copy of the receipts; the originals remain in $state."
}

coordinator_cleanup() {
  local result=$?
  trap - EXIT
  trap '' INT TERM
  local stopped=0
  stop_services "$state" || stopped=1
  keep_receipts
  if (( stopped == 0 )); then
    lock
    read_roster
    if [[ $(jq -r '.coordinator.state // ""' <<<"$roster") == "${state##*/}" ]]; then
      write_roster "$(jq -c '.coordinator = null' <<<"$roster")" ||
        { status cleanup 'Could not clear the coordinator entry.'; exit 1; }
    fi
    status cleanup "Coordinator evidence retained privately at $state."
    unlock
  else
    status cleanup 'Coordinator state retained. Retry with team-down.'
    (( result != 0 )) || result=1
  fi
  exit "$result"
}

directory_ready() {
  local url
  url=$(owned_url "$directory_pid") || return 1
  curl_local "$url"healthz >/dev/null 2>&1 && printf '%s\n' "$url"
}

api() {
  private timeout 3s "$opencode" api --server "$server" "$@" \
    --param "location[directory]=$state/project" 2>/dev/null
}

bridge_ready() {
  api config.get | sources_ok &&
    api agent.get --param agentID=coordinator |
    jq -e '.data.id == "coordinator" and .data.mode == "primary"' >/dev/null &&
    api mcp.list | jq -e '[.data[] | [.name, .status.status]] == [["network", "connected"]]' >/dev/null &&
    [[ -s $state/receipts.jsonl ]] && jq -se '
      any(.[]; .event == "catalog" and
        (["a2a_list_agents", "a2a_send_message", "a2a_get_task"] - .tools | length == 0))
    ' "$state/receipts.jsonl" >/dev/null
}

up() {
  local mode=${TEAM_MODE:-tui} owner next entry name url record i bridge_candidate
  local -a names=() peers=()
  check_mode "$mode"
  require_runtime
  config="$examples/coordinator.jsonc"
  bridge_candidate=${A2ABRIDGE_BIN:-}
  if [[ -z $bridge_candidate ]]; then bridge_candidate=$(type -P a2abridge || true); fi
  if ! bridge=$(realpath -e -- "$bridge_candidate") || [[ ! -f $bridge || ! -x $bridge ]]; then
    die 'Set A2ABRIDGE_BIN or put the verified a2abridge binary on PATH.'
  fi
  [[ $(sha256sum -- "$bridge" | cut -d ' ' -f 1) == bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2 ]] ||
    die 'Expected the pinned a2abridge 4.0.2 Linux amd64 checksum.'
  read -r password < /proc/sys/kernel/random/uuid
  lock
  read_roster
  same_boot || die 'The roster is from a different boot. Run team-down first.'
  jq -e '.stopping == null and .coordinator == null' <<<"$roster" >/dev/null ||
    die 'The roster has an active coordinator or incomplete teardown. Run team-down if it is stale.'
  jq -e '.workers | length > 0' <<<"$roster" >/dev/null || die 'Spawn at least one worker first.'
  while IFS= read -r entry; do
    name=$(jq -r '.key' <<<"$entry")
    url=$(jq -r '.value.url' <<<"$entry")
    record=$(jq -c '.value' <<<"$entry")
    if ! live "$record" || [[ $(owned_url "$(jq -r '.pid' <<<"$record")") != "$url" ]] || ! card_ok "$name" "$url"; then
      die "Stale worker $name. Run team-down before recreating the roster."
    fi
    names+=("$name")
    peers+=("$url")
  done < <(jq -c '.workers | to_entries[]' <<<"$roster")
  peer_json=$(jq -cn '$ARGS.positional' --args "${peers[@]}")
  owner=$(identity "$$") || die 'Could not identify the coordinator launcher.'
  prepare_root
  state=$(mktemp -d -- "$runtime/coordinator.XXXXXXXX")
  trap coordinator_cleanup EXIT
  next=$(jq -c --arg state "${state##*/}" --argjson owner "$owner" \
    '.coordinator = ($owner + {state:$state})' <<<"$roster")
  write_roster "$next" || die 'Could not reserve the coordinator.'
  unlock
  prepare_workspace

  mkdir -- "$state/directory-home"
  launch_child directory setsid env -i PATH="$PATH" HOME="$state/directory-home" \
    "$bridge" directory --addr 127.0.0.1:0 9>&- </dev/null >/dev/null 2>&1 ||
    die 'Could not record the private A2A directory.'
  directory_pid=$child_pid
  [[ -f $state/directory.process ]] || die 'Private A2A directory exited during launch.'
  directory=$(wait_for "$(<"$state/directory.process")" 10 directory_ready) ||
    die 'The private A2A directory did not become ready.'
  for i in "${!peers[@]}"; do
    directory_post register "${peers[i]}" || die "Could not register ${names[i]}."
    status registered "${names[i]} · ${peers[i]}"
  done
  launch_child heartbeat heartbeat || die 'Could not record the directory heartbeat.'
  [[ -f $state/heartbeat.process ]] || die 'The directory heartbeat exited during launch.'

  [[ $(private timeout 4s "$opencode" service get disabled 2>/dev/null) == true ]] ||
    die 'Private OpenCode service configuration was not recognized.'
  private timeout 15s "$opencode" debug config 2>/dev/null | sources_ok ||
    die 'OpenCode did not report only the supplied profile and private sources.'

  launch_child server private setsid "$opencode" serve --hostname 127.0.0.1 --port 0 \
    </dev/null >/dev/null 2>&1 || die 'Could not record the private OpenCode server.'
  server_pid=$child_pid
  [[ -f $state/server.process ]] || die 'Private OpenCode server exited during launch.'
  server=$(wait_for "$(<"$state/server.process")" 25 owned_url "$server_pid") ||
    die 'Private OpenCode server did not bind to loopback.'
  server=${server%/}
  wait_for "$(<"$state/server.process")" 35 bridge_ready 2>/dev/null ||
    die 'Coordinator config, agent, or bridge readiness check failed.'
  status ready "coordinator · ${#peers[@]} workers · $server"

  if [[ $mode == tui ]]; then
    status opening 'OpenCode TUI'
    launch_child client private "$opencode" --server "$server" ||
      die 'Could not record the OpenCode TUI.'
    wait "$child_pid"
  else
    # A file keeps OpenCode's stdout in text-output mode even in a terminal.
    launch_child client private timeout --foreground --kill-after=5s 300s \
      "$opencode" run --server "$server" --agent coordinator -- "$(cat -- "$TEAM_PROMPT_FILE")" </dev/null >"$state/answer" ||
      die 'Could not record the OpenCode run.'
    wait "$child_pid"
    [[ -s $state/answer ]] || die 'OpenCode finished without an answer.'
    cat -- "$state/answer"
  fi
}

down() {
  local owner coordinator entry name worker state_path next failed=0 boot_matches=false
  lock
  [[ -f $network ]] || { status stopped 'No team is registered.'; return 0; }
  read_roster
  if same_boot; then boot_matches=true; fi
  owner=$(jq -c --arg boot "$boot_id" '.stopping | select(.bootId == $boot)' <<<"$roster")
  [[ -z $owner ]] || ! live "$owner" || die 'Another team-down is in progress.'
  if [[ -e $runtime || -L $runtime ]]; then
    private_directory "$runtime" || die 'Invalid private runtime directory.'
  fi
  owner=$(identity "$$") || die 'Could not identify the teardown process.'
  write_roster "$(jq -c --argjson owner "$owner" --arg boot "$boot_id" \
    '.stopping = ($owner + {bootId:$boot})' <<<"$roster")" ||
    die 'Could not reserve the roster for teardown.'
  unlock

  coordinator=$(jq -c '.coordinator' <<<"$roster")
  if [[ $coordinator != null ]]; then
    state_path="$runtime/$(jq -r '.state' <<<"$coordinator")"
    if [[ -e $state_path || -L $state_path ]]; then
      private_directory "$state_path" || die 'Invalid private coordinator state.'
    fi
    if [[ $boot_matches == true ]]; then
      if ! stop_process "$coordinator" 45 || ! stop_services "$state_path"; then
        die 'Coordinator shutdown was not confirmed. Retry team-down.'
      fi
    fi
    status cleanup "Coordinator evidence retained privately at $state_path."
    status stopped 'coordinator and directory'
  fi

  lock
  read_roster
  unlock
  next=$(jq -c '.coordinator = null' <<<"$roster")
  while IFS= read -r entry; do
    name=$(jq -r '.key' <<<"$entry")
    worker=$(jq -c '.value' <<<"$entry")
    state_path="$runtime/$(jq -r '.state' <<<"$worker")"
    if [[ $boot_matches == true ]]; then
      if ! stop_process "$worker" 8; then
        status cleanup "$name is still running. Retry team-down."
        failed=1
        continue
      fi
      status stopped "$name"
    else
      status stale "$name · cleared its old process record"
    fi
    rm -rf -- "$state_path"
    next=$(jq -c --arg name "$name" 'del(.workers[$name])' <<<"$next")
  done < <(jq -c '.workers | to_entries[]' <<<"$roster")
  lock
  if (( failed )); then
    write_roster "$next" || die 'Could not save the partial cleanup state.'
    die 'Roster retained for the remaining workers.'
  fi
  rm -f -- "$network"
  if [[ -d $runtime ]]; then rmdir -- "$runtime" 2>/dev/null || status cleanup "Private state remains at $runtime."; fi
  status stopped "$filename · roster removed"
}

case $action in
  spawn-agent) spawn ;;
  team-up) up ;;
  team-down) down ;;
esac
