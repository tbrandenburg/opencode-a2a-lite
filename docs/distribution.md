# Distribution and manual npm release

## Status and package contract

`@tbrandenburg/opencode-a2a-lite` **0.1.2** is prepared for public distribution.
The maintainer has authorized removal of `private: true`; public npm access is
configured, but authenticated namespace ownership and actual registry acceptance
are not established. Do not publish to npm until ownership is verified, or mark
issue #6 complete based only on a local tarball or a GitHub release.

Supported runtime: Linux, Bun 1.3.9, exact `opencode v2.0.28` on PATH, an existing
explicitly trusted workspace, and reviewed provider/model configuration. npm/npx
also need Node; they do not replace Bun. The separate official `a2a` CLI is a client.
Production inherits OpenCode configuration/MCP/plugins; it provides neither
authentication nor sandboxing. Never expose it through a public proxy.

There is one executable, `opencode-a2a-lite`, with `#!/usr/bin/env bun`.
`prepack` cleans generated `dist/src`, rebuilds JavaScript, and sets the executable bit before `npm pack` or
directory publication. The `files` allowlist includes runtime `dist/src/*.js`,
the runtime package manifest, README and LICENSE; npm also includes root
`package.json`. Runtime dependencies are declared normally and installed by the
package runner. Tests, TypeScript sources, fixtures, scripts and development tools
are not payload. No consumer install/prepare build hook is required.

```sh
make install
make check
make package-smoke
```

The last command removes the emitted CLI and seeds an obsolete generated runtime file
before packing to verify that `prepack` rebuilds the CLI and removes stale output,
inspects the exact allowlist/shebang/permissions, and runs `npm exec` against the
tarball from a fresh external consumer directory with an isolated npm cache and
synthetic environment. It verifies help/version without OpenCode, argument/workspace/
port/executable failures, sanitized peer failures, CLI-over-env precedence, default
and ephemeral loopback ports, card URL/version, and owned-process SIGINT/SIGTERM
cleanup using a controlled ACP peer. The installed direct `server.js` entrypoint
is checked too. It requires outbound npm dependency access,
not provider credentials. The default-port scenario needs loopback port 41241 free;
the smoke never stops another listener. It does not validate a published package or real models.

## Secure manual publication

`make release` tags/pushes and creates a GitHub release; it does **not** publish npm.
This manual procedure is a separate maintainer action. Never put tokens, OTPs,
provider keys, private prompts, reasoning, or raw peer logs into commands/release
notes. Do not add registry credentials to the repository.

1. Authenticate to npm interactively using the maintainer's protected account with
   2FA. Inspect `npm whoami` privately and confirm that the publisher owns the chosen
   user scope (or has verified organization publish rights). A registry 404 or an
   available name is **not** proof of ownership. Inspect package/version availability
   using `npm view <verified-package> --json` without printing credential files.
2. Through a reviewed change, confirm the verified package name, intended release
   version and repository URL. Version 0.1.2 has public publication authorized and
   `private: true` removed; this does not establish npm scope ownership.
   Keep the single bin and public access setting. Refresh `bun.lock`
   with Bun and update the README to the verified name. Commit/push through normal
   repository review; start release verification from a clean checkout of that commit.
3. Remove stale generated output with `make clean`, then run `make install`,
   `make check`, `make package-smoke`, `npm pack --dry-run`, and
   `npm pack --json --pack-destination <external-artifact-directory>`.
   Inspect the tarball with `tar -tzf <artifact.tgz>`. Record its exact filename,
   version, size, integrity/digest and file list. Retain this exact verified artifact;
   do not rebuild it implicitly during publication.
4. In a fresh directory outside the source checkout, with reviewed isolated OpenCode
   config and securely supplied provider access, run:

   ```sh
   npm exec --yes --package=/absolute/path/to/artifact.tgz -- opencode-a2a-lite --help
   npm exec --yes --package=/absolute/path/to/artifact.tgz -- opencode-a2a-lite --version
   npm exec --yes --package=/absolute/path/to/artifact.tgz -- opencode-a2a-lite --workspace . --port 0
   ```

   Help/version must also work without OpenCode/provider access. Verify paths with
   spaces, absolute/env paths, precedence, missing/non-directory workspace, missing/
   wrong pinned OpenCode, malformed/occupied port and unknown flags. Capture the
   actual readiness URL, use `a2a card get <url>`, send a streamed greeting, and send
   a follow-up with the actual returned context ID and a unique continuity marker.
   Verify SIGINT/SIGTERM listener and owned ACP-group cleanup, then restart.
   Run `make demo` and `make e2e` using the documented isolated live configuration.

5. Ensure the GitHub tag/release identifies the same reviewed version/commit.
   If using `make release VERSION=<version>`, use the version in the verified
   artifact, not the default bump. It requires clean HEAD matching `origin` and
   performs GitHub writes; do not confuse those with npm publication.
6. Publish the retained tarball explicitly with
   `npm publish /absolute/path/to/artifact.tgz --access public` and the interactive
   protected-account authentication/2FA flow. Do not use a long-lived repository
   token. Local manual publishing does not establish CI provenance: do not claim
   provenance or add a misleading local `--provenance` workaround.
7. Verify `npm view <verified-package>@<version> version dist.integrity dist.tarball`
   against the retained artifact and verify installation from the registry, not a
   local npm link or warmed project dependency. From two fresh trusted external
   workspaces, separately run:

   ```sh
   bunx <verified-package>@<version> --workspace . --port 0
   npx --yes <verified-package>@<version> --workspace . --port 0
   ```

   For each, verify card discovery and real streamed completion; verify context
   continuity with the actual context ID, shutdown/owned-group cleanup and restart
   on the primary runner. Repeat missing/wrong OpenCode, workspace and occupied-port
   failures on the registry-installed executable. Verify the version matches the
   tag, CLI, card and published artifact. Do not expose a public listener/proxy.

8. Attach sanitized evidence to PR/release notes: OS, Bun/npm/npx/OpenCode/a2a
   versions, package version/digest, exact commands, pass/fail per scenario, process
   cleanup and registry links. Only then update the README's unreleased status and
   claim registry acceptance. Record a release-blocking exception explicitly if
   publication or live acceptance is deferred.

## Future trusted publishing

Prefer npm Trusted Publishing/OIDC with provenance once the verified npm package
has a configured trusted publisher and a reviewed protected GitHub release workflow.
That setup is follow-up work, not provided by ordinary CI or the existing GitHub
release command. Keep routine provider-free CI read-only and do not invent token
storage or custom release machinery for the first CLI distribution.

References: [Bun bunx/shebangs](https://bun.com/docs/pm/bunx),
[npm bin/files](https://docs.npmjs.com/cli/configuring-npm/package-json/),
[npm prepack lifecycle](https://docs.npmjs.com/cli/using-npm/scripts/),
[npm exec](https://docs.npmjs.com/cli/commands/npm-exec/),
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/).
