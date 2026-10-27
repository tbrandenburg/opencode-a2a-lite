.DEFAULT_GOAL := help
.PHONY: help install dev build run fmt fmt-check lint typecheck test check package-smoke release doctor demo network-demo e2e e2e-tck clean

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

network-demo: ## Run an isolated real OpenCode/MCP/A2A team (A2ABRIDGE_BIN and live credentials required)
	bun run network-demo

e2e: build ## Run isolated real-model acceptance (billable; requires Linux and live credentials)
	bun tests/e2e.ts

e2e-tck: build ## Run applicable official external TCK checks (requires pinned TCK_DIR)
	bun tests/e2e-tck.ts

clean: ## Remove generated build and test artifacts
	rm -rf dist coverage .test-results
