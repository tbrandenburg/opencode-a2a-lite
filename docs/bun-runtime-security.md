# Bun runtime security

Tracking: [issue #60](https://github.com/tbrandenburg/opencode-a2a-lite/issues/60).

## Runtime decision and security boundary

Pin the standalone Bun executable to **1.4.4**, the first patched release for
[GHSA-26q8-h657-pf84](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84).
The previous 1.3.9 pin is affected. This records exposure, not observed exploitation.
`@types/bun` is a development declaration package, not the executable runtime.
The dependency versions and frozen lockfile do not need changing for this pin.

Eight eMudhra intermediate CA keys were compromised; six issue TLS certificates.
Bun 1.4.4 removes three emSign roots, updates its bundle to NSS 3.131.1, and rejects
chains containing the compromised public keys with `CERT_REVOKED`. Key-based
rejection also covers cross-signed intermediates and explicitly supplied CAs.
The exposure includes outbound `fetch`, package downloads through `bun install`
and `bunx`, and other TLS APIs; a loopback-only inbound listener does not repair it.

OS CA updates, `--use-system-ca`, and `NODE_USE_SYSTEM_CA=1` alone do **not** repair
affected Bun releases: system certificates are added to the bundled store, not
used instead of it. Explicit per-connection CA lists can replace the default
store, but are not a process-wide repair. Do not disable certificate validation.

OpenCode is a separate executable/runtime boundary. Replacing standalone Bun does
not replace an embedded runtime in OpenCode; that assessment is tracked in
[issue #61](https://github.com/tbrandenburg/opencode-a2a-lite/issues/61).
The SDK cancellation adapter and its [independent removal gate](/docs/sdk-cancellation.md)
are unchanged.

## Verified release artifact

Use the exact [Bun 1.4.4 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4),
not an unversioned installer or a global upgrade. Linux x64 artifact reviewed:

| Artifact                      | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `bun-linux-x64.zip`           | `bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c` |
| extracted `bun-linux-x64/bun` | `10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235` |

The archive digest matched both GitHub release asset metadata and release
`SHASUMS256.txt`. These checks establish artifact consistency, not independent
publisher authenticity. Extract into a fresh private tools directory and put its
`bun-linux-x64` directory first on `PATH`; verify `bun --version` prints `1.4.4`.
Retain a supported Node executable on `PATH` for npm and the existing formatter.

## External TLS check (manual, no provider)

Run the actual candidate executable with a scrubbed environment:

```sh
env -i PATH="$BUN_TOOLS/bun-linux-x64:/usr/bin:/bin" bun scripts/bun-tls-probe.ts
```

`BUN_TOOLS` is the release extraction directory. The script makes five concurrent,
bounded, credential-free HTTPS requests with certificate verification explicitly
enabled, redirects disabled, and proxying disabled. It prints only host, status or
error code. It does not read response bodies or publish raw diagnostics.

| Control                                         | Observed on 1.4.4 | Required result                        |
| ----------------------------------------------- | ----------------- | -------------------------------------- |
| `example.com`                                   | HTTP 200          | Ordinary HTTPS succeeds                |
| `dv-g3b-emudhra.we-have-a-problem.com`          | `CERT_REVOKED`    | Original incident chain rejected       |
| `dv-g3b-aaa-emudhra.we-have-a-problem.com`      | `CERT_REVOKED`    | AAA cross-signed chain rejected        |
| `dv-g3b-noct-emudhra.we-have-a-problem.com`     | `CERT_REVOKED`    | Original chain without CT rejected     |
| `dv-g3b-aaa-noct-emudhra.we-have-a-problem.com` | `CERT_REVOKED`    | Cross-signed chain without CT rejected |

Exit 0 requires these five controls to pass. Unexpected acceptance fails. Other
errors, including timeout, refusal, DNS failure or a different certificate error,
are inconclusive for the compromised-key check and exit nonzero. These are spot
checks, not coverage of every compromised key or TLS API. The
[incident site's control instructions](https://emudhra.we-have-a-problem.com/#check)
describe the chains. External availability is not a deterministic CI dependency.

## Compatibility acceptance remains blocked

Security controls passed, but the standalone runtime upgrade cannot yet be
reported as fully accepted. Candidate validation found an HTTP shutdown
compatibility difference: `src/server.ts`'s Bun-specific path waits for `close`
after `closeAllConnections()` without calling `server.close()`. This relied on
Bun 1.3.9 closing the listener as a side effect. A provider-free minimal probe:

```sh
bun -e '
  import { createServer } from "node:http";
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const closed = new Promise(resolve => server.once("close", () => resolve("closed")));
  server.closeAllConnections();
  const outcome = await Promise.race([closed, Bun.sleep(200).then(() => "still-open")]);
  console.log(JSON.stringify({bun: Bun.version, outcome, listening: server.listening}));
  if (server.listening) await new Promise(resolve => server.close(resolve));
'
```

Observed: 1.3.9 reports `closed`/`false`; 1.4.4 reports `still-open`/`true`.
The isolated `bun test ./tests/server.test.ts --test-name-pattern H01` reaches
four assertions then times out during shutdown on 1.4.4. The integration fix must
explicitly close the listener without losing incomplete-client force-drain
ownership. Do not remove the patched runtime pin, loosen deadlines, or claim that
changing the pin alone fixes application compatibility.

Candidate evidence: frozen installation leaves `bun.lock` unchanged; isolated
ACP tests pass 8/8; formatting, lint, typecheck and build pass. The sequential
CI-equivalent suite reports 53 passed/13 failed (66 tests, 15 files), with HTTP
lifecycle/timeout failures. Package smoke fails at owned-process shutdown.
Verified a2abridge 4.0.2 interop reports its context checks but does not finish
within 180 seconds; cleanup/final acceptance is unproven. These failures are
release blockers, not substitutes for passing acceptance. Concurrent machine load
may affect the tight startup deadlines; the minimal listener difference does not
depend on those deadlines.

After integration, rerun these gates sequentially, retaining coverage/JUnit and
the final interop receipt:

```sh
bun --version
make install
git diff --exit-code -- bun.lock
make check LINT_FLAGS='--format github' TEST_FLAGS='--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=.test-results/junit.xml'
make package-smoke
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test
```

Keep test discovery scoped to `./tests`. Bridge checksums and private-environment
setup are in [the CI workflow](/.github/workflows/ci.yml). No live-provider
acceptance was executed by this runtime investigation; it requires separate
authorization and cannot be inferred from provider-free results.

## Distribution assessment

The current package uses `tsc` to emit JavaScript and a `#!/usr/bin/env bun` CLI;
it does not compile an embedded runtime. Package smoke verified its exact payload
allowlist and shebang before reaching the shutdown failure. Upgrading the
consumer's Bun executable is necessary; an old package manifest or type package
does not patch that executable.

The five reviewed GitHub releases (`v0.1.0` through `v0.1.4`) have one uploaded
package asset: `v0.1.1`'s `tbrandenburg-opencode-a2a-lite-0.1.1.tgz`, plus its
`SHA256SUMS`. The downloaded tarball matched that checksum; its eleven entries
are JavaScript, two manifests, README and LICENSE, with the Bun shebang in the CLI.
No embedded Bun executable was present in that tarball. Auto-generated source
archives are not compiled executables. This does not inventory private builds,
containers or npm registry artifacts. Any separately distributed
`bun build --compile` executable built with an affected runtime needs rebuilding
with the patched runtime and revalidation; changing host Bun does not repair it.

References: [advisory](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84),
[release notes](https://bun.com/blog/bun-v1.4.4),
[upstream key-blocking implementation](https://github.com/oven-sh/bun/pull/46300),
[distribution policy](/docs/distribution.md).
