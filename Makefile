.DEFAULT_GOAL := help
.PHONY: help install dev build run fmt fmt-check lint typecheck test check package-smoke release doctor demo interop-test e2e e2e-tck clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install locked Bun dependencies
	bun install --frozen-lockfile

dev: ## Start the gateway in foreground watch mode (requires A2A_WORKSPACE)
	bun run dev

build: ## Build the TypeScript project
	bun run build

run: build ## Run the compiled gateway in the foreground (requires A2A_WORKSPACE)
	bun run start

fmt: ## Format source files
	bun run fmt

fmt-check: ## Check formatting without changing files
	bun run fmt-check

lint: ## Lint the project
	bun scripts/quality-run.ts lint $(LINT_FLAGS)

typecheck: ## Type-check the project
	bun run typecheck

test: ## Run tests
	bun scripts/quality-run.ts test $(TEST_FLAGS)

check: fmt-check lint typecheck test build ## Run deterministic local checks

package-smoke: ## Pack and test the installed tarball outside the checkout (npm required; no provider)
	bun run package-smoke

release: ## Bump, check, commit, tag, push and create a GitHub release, not npm (BUMP=patch|minor|major or VERSION=x.y.z)
	bun scripts/release.ts "$(or $(VERSION),$(BUMP),patch)"

doctor: ## Check local development prerequisites
	@status=0; \
	if ! command -v bun >/dev/null 2>&1; then echo "missing prerequisite: bun" >&2; status=1; else echo "bun: $$(bun --version)"; fi; \
	if ! command -v jq >/dev/null 2>&1; then echo "missing prerequisite: jq (required by stream-verifier tests and live demo)" >&2; status=1; else echo "jq: $$(jq --version)"; fi; \
	if ! command -v timeout >/dev/null 2>&1; then echo "missing prerequisite: GNU timeout (required by live demo)" >&2; status=1; else echo "timeout: available"; fi; \
	if ! command -v opencode >/dev/null 2>&1; then echo "missing prerequisite: opencode" >&2; status=1; else echo "opencode: available"; fi; \
	if ! command -v a2a >/dev/null 2>&1; then echo "missing prerequisite: a2a CLI (install it to use live A2A workflows)" >&2; status=1; else echo "a2a: available"; fi; \
	exit $$status

demo: ## Build and verify a real isolated A2A CLI conversation (uses live credentials)
	bash scripts/demo.sh

interop-test: ## Check context/deadline contracts through pinned real MCP/A2A bridge (no provider)
	bun tests/agent-network/interop.ts

e2e: build ## Run isolated real-model acceptance (billable; requires Linux and live credentials)
	bun tests/e2e.ts

e2e-tck: build ## Run applicable official external TCK checks (requires pinned TCK_DIR)
	bun tests/e2e-tck.ts

clean: ## Remove generated build and test artifacts
	rm -rf dist coverage .test-results

.PHONY: spawn-agent team-up team-down team-report teams-test
spawn-agent team-down: export TEAM_NETWORK := $(value NETWORK)
team-up: export TEAM_NETWORK := $(if $(and $(value TEAM),$(filter environment,$(origin NETWORK))),,$(value NETWORK))
spawn-agent: export TEAM_NAME := $(value NAME)
spawn-agent: export TEAM_CONFIG := $(value CONFIG)
spawn-agent: export TEAM_SYSTEM_PROMPT := $(value SYSTEM_PROMPT)
team-up: export TEAM_MODE := $(value MODE)
team-up: export TEAM_PROMPT_FILE := $(value PROMPT_FILE)
team-up: export TEAM_FOLDER := $(value TEAM)

spawn-agent: ## Start a specialist and add it to NETWORK
	@bash examples/teams/team.sh spawn-agent

team-up: ## Open a coordinator for NETWORK or start a temporary team from TEAM
	@bash examples/teams/team.sh team-up

team-down: ## Stop the owned coordinator and workers in NETWORK
	@bash examples/teams/team.sh team-down

team-report: export TEAM_REPORT_FILE := $(value FILE)
team-report: ## Summarize bridge receipts: make team-report FILE=.test-results/teams/<name>.jsonl
	@[ -f "$$TEAM_REPORT_FILE" ] || { echo 'Supply an existing FILE=<receipts.jsonl>, for example a copy in .test-results/teams/.' >&2; exit 1; }
	@jq -rs -f examples/teams/report.jq -- "$$TEAM_REPORT_FILE"

teams-test: ## Test the example team launcher with provider-free fixtures
	@bash tests/teams.test.sh
