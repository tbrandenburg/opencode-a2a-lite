import { afterAll, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOptions, PROVIDER_ENV } from "../src/cli-options.js";
import { policyConfig } from "../src/runtime-policy.js";
import { launchGateway } from "../src/server.js";
import { StartupError } from "../src/startup-error.js";

const parse = (args: string[], env: NodeJS.ProcessEnv) =>
  parseOptions(args, { A2A_WORKSPACE: "/trusted", ...env });
const names = (args: string[], env: NodeJS.ProcessEnv) => {
  const found = parse(args, env);
  return found.action === "run" ? found.server.passEnv : undefined;
};

test("the allowlist is a fixed, small set of well-known provider keys", () => {
  expect(PROVIDER_ENV.length).toBeLessThanOrEqual(6);
  expect(PROVIDER_ENV).toContain("OPENAI_API_KEY");
  expect(PROVIDER_ENV).toContain("ANTHROPIC_API_KEY");
});

test("allowlisted keys that are set are passed by name; unset or empty ones are skipped silently", () => {
  expect(names([], { OPENAI_API_KEY: "sk-secret", GROQ_API_KEY: "" })).toEqual(["OPENAI_API_KEY"]);
  expect(names([], {})).toBeUndefined();
  expect(JSON.stringify(parse([], { OPENAI_API_KEY: "sk-secret" }))).not.toContain("sk-secret");
});

test("explicit names add to the allowlist without duplicating an allowlisted name", () => {
  const env = { OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b", EXTRA_KEY: "c" };
  expect(names(["--pass-env", "EXTRA_KEY"], env)).toEqual([
    "EXTRA_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ]);
  expect(names(["--pass-env", "OPENAI_API_KEY"], { OPENAI_API_KEY: "a" })).toEqual([
    "OPENAI_API_KEY",
  ]);
  expect(() =>
    parse(["--pass-env", "OPENAI_API_KEY", "--pass-env", "OPENAI_API_KEY"], env),
  ).toThrow(StartupError);
});

test('--no-env and --pass-env "" disable the automatic keys but keep explicit names', () => {
  const env = { OPENAI_API_KEY: "a", EXTRA_KEY: "c" };
  expect(names(["--no-env"], env)).toBeUndefined();
  expect(names(["--pass-env", ""], env)).toBeUndefined();
  expect(names(["--no-env", "--pass-env", "EXTRA_KEY"], env)).toEqual(["EXTRA_KEY"]);
  expect(() => parse(["--no-env", "--no-env"], env)).toThrow("Use --help");
});

test("danger-full-access passes nothing automatically, but named variables still pass", () => {
  const env = { OPENAI_API_KEY: "a", EXTRA_KEY: "c" };
  expect(names(["--access", "danger-full-access"], env)).toBeUndefined();
  expect(names(["--access", "danger-full-access", "--pass-env", "EXTRA_KEY"], env)).toEqual([
    "EXTRA_KEY",
  ]);
  expect(names(["--access", "edit"], env)).toEqual(["OPENAI_API_KEY"]);
});

test("reserved, endpoint and missing names are still rejected without revealing values", () => {
  const env = {
    OPENAI_API_KEY: "sk-secret",
    OPENAI_BASE_URL: "http://x",
    NODE_OPTIONS: "--inspect",
    NODE_EXTRA_CA_CERTS: "/operator/ca.crt",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  };
  for (const name of [
    "PATH",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
    "OPENAI_BASE_URL",
    "MISSING_KEY",
    "A2A_X",
  ])
    expect(() => parse(["--pass-env", name], env)).toThrow(StartupError);
  expect(() => parse(["--pass-env", "NODE_OPTIONS"], env)).not.toThrow("--inspect");
});

const linux = process.platform === "linux" ? test : test.skip;
const base = realpathSync(mkdtempSync(join(tmpdir(), "credentials-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const SECRET = "synthetic-secret-value-123";

// Fake opencode: valid preflight documents; records each call's environment; the ACP child exits.
function fakeOpenCode() {
  const dir = mkdtempSync(join(base, "fx-"));
  const rules = [
    ...policyConfig("read-only").permissions,
    { action: "execute", resource: "*", effect: "deny" },
    { action: "external_directory", resource: "*", effect: "deny" },
  ];
  writeFileSync(join(dir, "policy.json"), JSON.stringify(policyConfig("read-only")));
  writeFileSync(join(dir, "agents.json"), JSON.stringify([{ name: "build", permissions: rules }]));
  const file = join(dir, "opencode");
  writeFileSync(
    file,
    `#!/bin/sh
d="${dir}"
echo "CALL $*" >> "$d/calls"
env >> "$d/calls"
case "$*" in
  *--version*) echo "opencode v2.4.1" ;;
  *"debug paths"*) for n in data:.local/share/opencode cache:.cache/opencode config:.config/opencode state:.local/state/opencode; do echo "\${n%%:*} $HOME/\${n#*:}"; done; echo "home $HOME"; echo "tmp $TMPDIR"; echo "db $HOME/.local/share/opencode/opencode.db" ;;
  *"debug config"*) printf '[{"type":"document","path":"%s/.config/opencode/opencode.json","info":%s},{"type":"directory","path":"%s/.config/opencode"}]' "$HOME" "$(cat "$d/policy.json")" "$HOME" ;;
  *"debug agents"*) cat "$d/agents.json" ;;
  *) exit 1 ;;
esac
`,
  );
  chmodSync(file, 0o700);
  return { file, calls: () => readFileSync(join(dir, "calls"), "utf8") };
}

linux(
  "a launch passes the named key to the ACP child only, prints names, never values",
  async () => {
    const fake = fakeOpenCode();
    const workspace = join(base, "ws");
    mkdirSync(workspace, { recursive: true });
    const err = spyOn(console, "error").mockImplementation(() => undefined);
    const out = spyOn(console, "log").mockImplementation(() => undefined);
    process.env.SYNTHETIC_PROVIDER_KEY = SECRET;
    try {
      await launchGateway({
        workspace,
        port: 0,
        passEnv: ["SYNTHETIC_PROVIDER_KEY"],
        acp: { executable: fake.file },
      }).catch(() => undefined);
      const printed = [...err.mock.calls, ...out.mock.calls].flat().join("\n");
      expect(printed).not.toContain(SECRET);
      const calls = fake
        .calls()
        .split(/^CALL /m)
        .filter(Boolean);
      const probes = calls.filter((call) => /^(--version|--standalone|debug)/.test(call));
      const children = calls.filter((call) => !/^(--version|--standalone|debug)/.test(call));
      expect(probes.length).toBeGreaterThanOrEqual(4);
      expect(probes.some((call) => call.includes("SYNTHETIC_PROVIDER_KEY"))).toBe(false);
      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children.every((call) => call.includes(`SYNTHETIC_PROVIDER_KEY=${SECRET}`))).toBe(
        true,
      );
      expect(printed).toContain("passing SYNTHETIC_PROVIDER_KEY to OpenCode (names only)");
    } finally {
      delete process.env.SYNTHETIC_PROVIDER_KEY;
      err.mockRestore();
      out.mockRestore();
    }
  },
  60_000,
);

linux(
  "a launch with --no-env keeps operator CA trust in probes and ACP but passes no credentials",
  async () => {
    const fake = fakeOpenCode();
    const workspace = join(base, "ws");
    const ca = join(base, "operator-ca.crt");
    mkdirSync(workspace, { recursive: true });
    const err = spyOn(console, "error").mockImplementation(() => undefined);
    const previous = {
      SYNTHETIC_PROVIDER_KEY: process.env.SYNTHETIC_PROVIDER_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
    };
    process.env.SYNTHETIC_PROVIDER_KEY = SECRET;
    process.env.OPENAI_API_KEY = SECRET;
    process.env.NODE_EXTRA_CA_CERTS = ca;
    try {
      const options = parse(["--no-env"], {
        OPENAI_API_KEY: SECRET,
        NODE_EXTRA_CA_CERTS: ca,
      });
      if (options.action !== "run") throw new Error("expected run options");
      expect(options.server.passEnv).toBeUndefined();
      await launchGateway({
        ...options.server,
        workspace,
        port: 0,
        acp: { executable: fake.file },
      }).catch(() => undefined);
      expect(err.mock.calls.flat().join("\n")).toContain(
        "no provider variables passed to OpenCode",
      );
      const recorded = fake.calls();
      expect(recorded).not.toContain(SECRET);
      const calls = recorded.split(/^CALL /m).filter(Boolean);
      const probes = calls.filter((call) => /^(--version|--standalone|debug)/.test(call));
      const children = calls.filter((call) => !/^(--version|--standalone|debug)/.test(call));
      expect(probes.length).toBeGreaterThanOrEqual(4);
      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(calls.every((call) => call.split("\n").includes(`NODE_EXTRA_CA_CERTS=${ca}`))).toBe(
        true,
      );
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      err.mockRestore();
    }
  },
  60_000,
);
