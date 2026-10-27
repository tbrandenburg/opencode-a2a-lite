# Repository guidance

## Lessons Learned

- 2026-10-27: Pitfall: Fast status polling exhausted a bounded MCP tool budget before intervention. Prevention: Derive polling intervals from startup deadlines and call budgets, reserving calls for cancellation and cleanup.
- 2026-10-27: Pitfall: Successful-run cleanup hid interrupted-run leaks and evidence-write failures. Prevention: Propagate signals to owned resources, drain cleanup independently of reporting, and test interruption with real child/TCP fixtures.
- 2026-10-26: Pitfall: Bun HTTP close ordering hides incomplete sockets and invalidates later force-close calls. Prevention rule/countermeasure: Verify shutdown against the pinned runtime with incomplete TCP headers; retain force-close capability through bounded draining.
- 2026-10-26: Pitfall: Incremental compilation leaves obsolete JavaScript eligible for wildcard npm inclusion. Prevention rule/countermeasure: Clean generated runtime output in prepack and seed a stale artifact in packaging acceptance to verify its exclusion.
- 2026-10-26: Pitfall: Temporary workspaces can inherit global OpenCode tools/plugins/MCP. Prevention: isolate HOME/config discovery and verify configuration sources before live prompts; inspect the pinned schema rather than interpreting source-list diagnostics as merged configuration.
- 2026-10-26: Pitfall: Compiled test copies inflated the Bun suite. Prevention: target `bun test ./tests` explicitly; verify test counts again after building, and exclude generated/user directories from formatter and linter discovery.
- 2026-10-26: Pitfall: Tight success-path subprocess deadlines failed during concurrent validation. Prevention: give normal fixture startup bounded scheduler headroom, retain separate short timeout tests, and measure runtime baselines without concurrent validation workloads.
- 2026-10-26: Pitfall: Reprinting captured GitHub workflow commands doubled annotations. Prevention: retain raw diagnostics in summary/artifact files and print only a completion notice from hosted reporting steps.
- 2026-10-26: Pitfall: Negated GitHub closing-keyword references still closed an unresolved issue. Prevention: use plain related-issue references for open dependencies; never combine a closing keyword and issue reference in negated prose.
