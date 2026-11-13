# OpenCode specialist teams

**Experimental, trusted-local use only.** Known limitations: there is no independent supervision of task deadlines, polling or the eight-call reserve (the coordinator prompt asks for them, nothing enforces them), and teardown stops each recorded process and its process group but does not verify that every detached descendant exited.

Start independent OpenCode workers and open a coordinator for their roster. The coordinator reaches them through one guarded MCP-to-A2A bridge. Worker configs stay native to OpenCode.

## Prerequisites

Use Linux, the optional [A2A CLI](../../README.md) (used once per worker as a warm-up so its MCP servers are connected), Bun 1.4.4, stable OpenCode >=2.2.7, Bash, jq, curl, and the Linux tools flock, setsid, ss, and GNU timeout. Run `make install` and `make build` from the repository root. Put the [verified a2abridge binary](../../interop/README.md) on `PATH`, or set `A2ABRIDGE_BIN` to its path. Either way, the launcher verifies the pinned binary checksum. The sample profiles use the repository's OpenAI smoke model and read `OPENAI_API_KEY` from the environment. For a custom model config, `TEAM_PASS_ENV` can list its model API-key variable names.

The team launcher admits stable OpenCode 2.2.7 and later releases, including 2.3.0. Recorded live acceptance is for 2.2.7 only; passing the version check on another release is not evidence that every team has been validated with it. The production gateway retains its separate exact OpenCode 2.2.7 requirement.

| Team                 | Profiles                                           | Additional setup                                                                                                                                                                   |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research             | `research/scout.jsonc` and `research/verify.jsonc` | The public Exa and Firecrawl MCP endpoints use keyless access, subject to their limits.                                                                                            |
| Web                  | `web/browser.jsonc` and `web/diagnostics.jsonc`    | `npm i -g @playwright/mcp chrome-devtools-mcp` and Google Chrome at `/usr/bin/google-chrome` (edit the profiles for another path). These profiles start private headless browsers. |
| Software development | `swdev/repo.jsonc` and `swdev/docs.jsonc`          | An active `gh auth login` for github.com, the [local GitHub MCP binary](https://github.com/github/github-mcp-server) on PATH. Context7 is used keyless.                            |

The GitHub worker obtains the active `gh` credential before switching to its private home and supplies it to its local read-only MCP server. Check that the credential can access the chosen repository and CI results. The roster and terminal output contain process metadata and endpoints.

## Start and use a team

Start every worker profile in a folder with one command.

```bash
make team-up TEAM=examples/teams/research
make team-up TEAM=examples/teams/research MODE=run > answer.md
```

Folder mode starts one worker per `.json` or `.jsonc` file using its filename stem as the worker name. It skips `coordinator.json` and `coordinator.jsonc`. In headless mode it uses the folder's `brief.md` by default and accepts `PROMPT_FILE` as an override. Each invocation owns a temporary roster and tears down its workers when the session exits. For workers you want to reuse across sessions, use the persistent roster workflow below.

### Persistent roster

Run from the repository root. Create the roster in a directory you own with mode 0700 or stricter.

```bash
run_dir=$(mktemp -d /tmp/opencode-team.XXXXXXXX)
network="$run_dir/research.json"

make spawn-agent NAME=scout CONFIG=examples/teams/research/scout.jsonc NETWORK="$network"
make spawn-agent NAME=verify CONFIG=examples/teams/research/verify.jsonc NETWORK="$network"

make team-up NETWORK="$network"
# Exit the TUI before starting the headless session below.
make team-up NETWORK="$network" MODE=run \
  PROMPT_FILE=examples/teams/research/brief.md > answer.md

make team-down NETWORK="$network"
```

The launcher gives each worker a private workspace and HOME/XDG paths. It passes your native profile unchanged via `OPENCODE_CONFIG`. A sibling prompt can be referenced with `{file:./scout.md}`. For a custom profile that opts into `{file:{env:TEAM_SYSTEM_PROMPT_FILE}}`, use `SYSTEM_PROMPT=/path/to/prompt.md` or let the launcher use the sibling Markdown file. Configs and any referenced files are trusted inputs.

Team-up checks the roster's worker identities and Agent Cards, then warms one coordinator for those URLs. Workers added during a session become available on the next team-up. Exiting the coordinator leaves the workers up. Team-down checks the saved PID and process start time before signaling each process. If a process cannot be confirmed stopped, the roster retains its record for a retry. The stable lock file remains beside the roster so concurrent commands keep using the same lock. Coordinator state, including receipts and session data, remains in the private runtime directory after shutdown for inspection; it can contain sensitive material. Inspect and reconcile it privately before manually removing it. Folder mode prints the retained private directory.

## Receipts and telemetry

When a coordinator exits, the launcher keeps a private (mode 0600) copy of its bridge `receipts.jsonl` as `.test-results/teams/<UTC timestamp>-<random>.jsonl`, in both folder and roster mode, so it survives `team-down` and temporary-folder cleanup. The copy is never overwritten and a failed copy only prints a warning. Receipts hold task and context IDs (raw in results) and call metadata, no prompt text, so treat them as private; the report prints only counts, tool names, states and timings.

```bash
make team-report FILE=.test-results/teams/<name>.jsonl
```

The report is one `jq` script (`examples/teams/report.jq`). It prints calls per tool and peer, call-to-result durations, polls (`a2a_get_task`) per task, send-to-completed time per task, rejections by tool and reason, and attempts per bridge connection against the 40-call ceiling. Task numbers follow first submission time, and each final state is selected by the latest result timestamp. Tasks and connections are numbered instead of printing IDs; peers appear only as loopback `host:port`. Use it as a check, not enforcement: nothing stops a coordinator from exceeding its budget.

## Golden user journey

Use the research team for the walkthrough. Start both workers in one shell, open OpenCode, ask for three changes backed by the official release notes, then exit the TUI. Reuse those workers for the headless brief and shut down the roster. The ports below are illustrative. Use the endpoints your workers print.

```text
$ make spawn-agent NAME=scout CONFIG=examples/teams/research/scout.jsonc NETWORK="$network"
  ready      scout · http://127.0.0.1:41321/
  roster     research.json · workers 1

$ make spawn-agent NAME=verify CONFIG=examples/teams/research/verify.jsonc NETWORK="$network"
  ready      verify · http://127.0.0.1:41322/
  roster     research.json · workers 2

$ make team-up NETWORK="$network"
  registered scout · http://127.0.0.1:41321/
  registered verify · http://127.0.0.1:41322/
  ready      coordinator · 2 workers · http://127.0.0.1:41323
  opening    OpenCode TUI
```

In OpenCode, ask “Have scout find the latest stable Node.js release notes. Give the official URL to verify and ask for three documented changes. Cite the source.” Look for both calls in OpenCode’s tool activity and check that the answer cites the original release notes. Exit the TUI to return to the shell.

```text
$ make team-up NETWORK="$network" MODE=run PROMPT_FILE=examples/teams/research/brief.md > answer.md
  registered scout · http://127.0.0.1:41321/
  registered verify · http://127.0.0.1:41322/
  ready      coordinator · 2 workers · http://127.0.0.1:41324

$ make team-down NETWORK="$network"
  stopped    scout
  stopped    verify
  stopped    research.json · roster removed
```

### Terminal presentation

- Keep a single aligned status column and use short, lowercase verbs such as `ready`, `registered`, `opening`, and `stopped`. Put the worker name and endpoint on the same line. Keep ports and paths easy to copy.
- Use one accent on the status label when stderr is a terminal. Honor `NO_COLOR`, keep redirected output plain, and make every status understandable from its text alone.
- Keep launcher status on stderr. In headless mode, stdout is the coordinator's answer, so `> answer.md` captures clean Markdown. Let the native OpenCode TUI show tool activity and the response.
- Announce readiness after its check passes. Announce worker completion only when the corresponding A2A task outcome has been observed. For a failure, name the affected worker or service and give the next action, such as retrying `team-down` for a retained process record.
- Review the transcript in a narrow terminal, with `NO_COLOR=1`, and with stdout redirected. Confirm that the operator can see which workers joined, when OpenCode is ready, and whether teardown finished.

## Check the example

Run `make teams-test` for provider-free shell lifecycle coverage. For live checks follow the [manual acceptance matrix in issue #69](https://github.com/tbrandenburg/opencode-a2a-lite/issues/69). Inspect complete final receipts and actual worker sessions privately; do not infer completion or cancellation from process shutdown.

## Live acceptance (2026-11-11)

Headless folder runs (`make team-up TEAM=... MODE=run`) with the pinned Bun 1.4.4, OpenCode 2.2.7 and a2abridge 4.0.2 completed for all three teams. Each run showed real worker MCP calls (Exa and Firecrawl; Playwright and Chrome DevTools; GitHub and Context7) and a coordinator answer citing their results. The coordinator's answers honestly flagged what the workers could not confirm. Not run live: the TUI mode (covered only by the provider-free fixture) and a persistent roster across sessions.

Practical notes: OpenCode may drop MCP tools from the first session of a worker, so `spawn-agent` sends one throwaway warm-up task when the `a2a` CLI is installed. Run `npm i -g @playwright/mcp chrome-devtools-mcp` and put `github-mcp-server` on `PATH` before the web and swdev teams. Do not pipe `spawn-agent` output (`| tee`) on a terminal you need to keep: use redirection instead.
