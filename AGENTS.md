# Repository guidance

## Lessons Learned

- 2026-10-26: Pitfall: Temporary workspaces can inherit global OpenCode tools/plugins/MCP. Prevention: isolate HOME/config discovery and verify configuration sources before live prompts; inspect the pinned schema rather than interpreting source-list diagnostics as merged configuration.
- 2026-10-26: Pitfall: Compiled test copies inflated the Bun suite. Prevention: target `bun test ./tests` explicitly; verify test counts again after building, and exclude generated/user directories from formatter and linter discovery.
- 2026-10-26: Pitfall: Tight success-path subprocess deadlines failed during concurrent validation. Prevention: give normal fixture startup bounded scheduler headroom, retain separate short timeout tests, and measure runtime baselines without concurrent validation workloads.
