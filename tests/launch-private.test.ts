import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchGateway } from "../src/server.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "launch-private-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const workspace = join(base, "ws");
mkdirSync(workspace);
const policyFile = (body: object) => {
  const file = join(base, `p-${readdirSync(base).length}.json`);
  writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
};
const fails = (options: object) =>
  launchGateway({ workspace, port: 0, ...options }).then(
    () => "started",
    (error: Error) => error.message,
  );

test("a full-access policy file without the CLI profile fails before any runtime exists", async () => {
  const file = policyFile({ version: 1, base: "full-access", policies: [] });
  expect(await fails({ policyFile: file })).toMatch(/base must equal/);
  expect(await fails({ policyFile: file, policy: "full-access" })).toMatch(/--dangerously-skip/);
});

test("unsafe policy files and state directories fail before readiness", async () => {
  expect(await fails({ policyFile: join(workspace, "p.json") })).toMatch(/--policy-file/);
  expect(
    await fails({
      policyFile: policyFile({
        version: 1,
        base: "read-only",
        policies: [{ action: "mcp.use", resource: "*", effect: "allow" }],
      }),
    }),
  ).toMatch(/--policy-file/);
  expect(await fails({ stateDir: join(workspace, "state") })).toMatch(/--state-dir/);
  expect(existsSync(join(workspace, "state"))).toBe(false);
});

test("library callers with their own ACP environment cannot use the private options", async () => {
  expect(await fails({ stateDir: join(base, "s"), acp: { env: {} } })).toMatch(/private runtime/);
});

test("a failed startup keeps pre-existing state and releases its lock", async () => {
  const state = join(base, "state");
  mkdirSync(state, { mode: 0o700 });
  const marker = join(state, "binding.json");
  const result = await fails({
    stateDir: state,
    acp: undefined,
    passEnv: ["A2A_TEST_MISSING_VARIABLE"],
  });
  expect(result).toMatch(/pass-env|Invalid, duplicate/);
  expect(existsSync(join(state, "lock"))).toBe(false);
  expect(existsSync(marker)).toBe(true);
});
