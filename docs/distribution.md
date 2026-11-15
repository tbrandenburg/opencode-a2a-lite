# Distribution and release

`@tbrandenburg/opencode-a2a-lite` ships JavaScript with a Bun shebang, not a
compiled Bun executable. Consumers need Bun 1.4.4 and stable OpenCode 2.2.7 or
newer separately; `npx` also needs Node 22+. See the [README](../README.md) for
the Linux and experimental macOS runtime contract. Old published versions without
the `darwin` manifest entry remain Linux-only. Upgrading the package does not
replace standalone Bun or OpenCode's embedded runtime; see
[runtime security evidence](bun-runtime-security.md).

The `prepack` hook deletes stale generated `dist/src`, rebuilds the executable and
sets its executable bit. The package allowlist includes the runtime files, README,
license and manifest, but not tests, scripts or development dependencies.

## Verify and release

```sh
make install
make check
make package-smoke
make release BUMP=patch # or BUMP=minor, BUMP=major, VERSION=x.y.z
```

`make package-smoke` packs and installs a local tarball into an isolated external
consumer, verifies its allowlist and CLI, and exercises controlled ACP startup,
errors, Agent Card, signal handling and owned-process cleanup. It needs npm
dependency access but no provider credentials. It does not validate a published
package or a real model. Live checks require separate authorization; see
[acceptance](acceptance.md).

`make release` requires a clean default branch matching origin, checks that the
tag is absent, reruns `make check`, creates the version commit and annotated tag,
and pushes both atomically. The [publish workflow](../.github/workflows/publish.yml)
requires Linux and macOS validation before npm Trusted Publishing and GitHub
Release creation. Verify scope ownership, intended version and trusted publisher
configuration before running it; monitor the workflow and check the published
version and integrity. npm may report that a newly published version is still
being processed before it becomes visible.

If the atomic push fails, inspect the local commit/tag and remote state; do not
discard them blindly. If publication fails, retain the tag and inspect the
registry before retrying the workflow against that tag. If npm publication
succeeded but GitHub Release creation failed, create the release for the existing
tag rather than republishing. The workflow skips an existing registry version only
if its integrity matches the packed artifact; mismatched integrity fails.

Never put npm tokens, OTPs, provider keys, raw prompts or diagnostics in commands,
logs, issues or release notes. Manual first-publication and historical acceptance
details remain in the [previous release guide](https://github.com/tbrandenburg/opencode-a2a-lite/blob/519075932bb8398b76407127bac593af2e29687b/docs/distribution.md).
