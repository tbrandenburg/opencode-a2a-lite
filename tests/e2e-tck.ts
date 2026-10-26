import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exec, isolated, launch } from "./e2e-support.js";

// External pinned TCK; never install Python dependencies into the gateway project.
const revision = "d4d6fae7887f88ef607fb461c13e3b0e1802f19b";
async function main() {
  const directory = process.env.TCK_DIR;
  assert(directory, "TCK_DIR must point to the externally installed pinned official TCK");
  assert.equal(
    (await exec("git", ["rev-parse", "HEAD"], { cwd: directory, timeout: 10_000 })).stdout.trim(),
    revision,
  );
  assert.equal(
    (
      await exec("git", ["diff", "--name-only", "HEAD"], { cwd: directory, timeout: 10_000 })
    ).stdout.trim(),
    "",
  );
  await isolated(async (workspace) => {
    const gateway = await launch(workspace);
    try {
      // run_tck.py always prepends the entire suite, even with explicit paths.
      // Invoke official pytest modules directly to select only applicable checks.
      const args = [
        "-m",
        "pytest",
        "--sut-host",
        gateway.url,
        "--transport",
        "jsonrpc",
        "-m",
        "must",
        "tests/compatibility/agent_card/test_agent_card.py",
        "tests/compatibility/jsonrpc/test_error_codes.py",
        "tests/compatibility/jsonrpc/test_sse_streaming.py::TestSseStreamingFormat",
        "tests/compatibility/jsonrpc/test_sse_streaming.py::TestSseSubscribeToTask::test_subscribe_nonexistent_task_returns_error",
        "-k",
        "not unsupported_operation_error",
        "-q",
        "--compatibility-report=reports/applicable",
        "--junitxml=reports/applicable.xml",
      ];
      const result = await exec(resolve(directory, ".venv/bin/python"), args, {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: workspace.env.HOME },
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      // Publish only pytest totals. Detailed TCK reports remain outside this repository.
      const summary = result.stdout
        .split("\n")
        .filter((line) => /\d+ passed|\d+ failed|\d+ skipped/.test(line));
      assert(summary.length > 0, "TCK must produce a real pytest result summary");
      const xml = await readFile(resolve(directory, "reports/applicable.xml"), "utf8");
      const suite = xml.match(/<testsuite\s[^>]+>/)?.[0] ?? "";
      assert.match(suite, /tests="17"/);
      assert.match(suite, /failures="0"/);
      assert.match(suite, /errors="0"/);
      assert.match(suite, /skipped="0"/);
      console.log(JSON.stringify({ officialTck: true, revision, transport: "jsonrpc", summary }));
    } finally {
      await gateway.close();
    }
  });
}
try {
  await main();
} catch {
  console.error(
    JSON.stringify({
      officialTck: false,
      revision,
      failure:
        "External TCK failed; inspect its private reports locally. No conformance pass claimed.",
    }),
  );
  process.exitCode = 1;
}
