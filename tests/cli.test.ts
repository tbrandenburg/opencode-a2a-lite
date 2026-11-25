import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseOptions } from "../src/cli-options.js";
import { StartupError } from "../src/startup-error.js";

test("C1: explicit trusted paths override environment and normalize worker identity", () => {
  expect(
    parseOptions(["--workspace", "a path", "--port", "0"], {
      A2A_WORKSPACE: "invalid-relative-env",
      A2A_PORT: "bad",
      A2A_NAME: " planner ",
      A2A_DESCRIPTION: " Plans work ",
      A2A_TAGS: "planning, text,planning,review",
    }),
  ).toEqual({
    action: "run",
    server: {
      workspace: resolve("a path"),
      port: 0,
      identity: {
        name: "planner",
        description: "Plans work",
        tags: ["planning", "text", "review"],
      },
    },
  });
  expect(parseOptions([], { A2A_WORKSPACE: "/trusted" })).toEqual({
    action: "run",
    server: { workspace: "/trusted", port: 41241 },
  });
});

test("C3: unknown, duplicate and missing-value flags fail without reflecting input", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  expect(() => parseOptions(["--private-marker"], env)).toThrow(StartupError);
  expect(() => parseOptions(["--private-marker"], env)).toThrow("Use --help");
  expect(() => parseOptions(["--private-marker"], env)).not.toThrow("private-marker");
  expect(() => parseOptions(["--port", "0", "--port", "1"], env)).toThrow(StartupError);
  expect(() => parseOptions(["--port", "0", "--port", "1"], env)).toThrow("Use --help");
  expect(() => parseOptions(["--workspace"], env)).toThrow(StartupError);
  expect(() => parseOptions(["--workspace"], env)).toThrow("Use --help");
});

test("repeatable passthrough is explicit and rejects invalid names without revealing values", () => {
  const env = { A2A_WORKSPACE: "/trusted", FIRST_KEY: "private-value", SECOND_KEY: "another" };
  expect(parseOptions(["--pass-env", "FIRST_KEY", "--pass-env", "SECOND_KEY"], env)).toMatchObject({
    server: { passEnv: ["FIRST_KEY", "SECOND_KEY"] },
  });
  for (const args of [
    ["--pass-env", "MISSING"],
    ["--pass-env", "PATH"],
    ["--pass-env", "NODE_OPTIONS"],
    ["--pass-env", "FIRST_KEY", "--pass-env", "FIRST_KEY"],
    ["--pass-env", "FIRST_KEY,SECOND_KEY"],
  ]) {
    expect(() => parseOptions(args, env)).toThrow(StartupError);
    expect(() => parseOptions(args, env)).not.toThrow("private-value");
  }
  expect(parseOptions(["--help", "--pass-env", "MISSING"], {})).toEqual({ action: "help" });
});

test("C4: absent and relative environment workspaces never implicitly trust cwd", () => {
  expect(() => parseOptions([], {})).toThrow(StartupError);
  expect(() => parseOptions([], {})).toThrow("trusted absolute workspace");
  expect(() => parseOptions([], { A2A_WORKSPACE: "relative/path" })).toThrow(StartupError);
  expect(() => parseOptions([], { A2A_WORKSPACE: "relative/path" })).toThrow(
    "trusted absolute workspace",
  );
});

test("C5: ports require decimal syntax and the TCP range", () => {
  expect(() => parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: "1e3" })).toThrow(
    StartupError,
  );
  expect(() => parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: "1e3" })).toThrow(
    "Invalid port",
  );
  expect(() => parseOptions(["--port", "65536"], { A2A_WORKSPACE: "/trusted" })).toThrow(
    StartupError,
  );
  expect(() => parseOptions(["--port", "65536"], { A2A_WORKSPACE: "/trusted" })).toThrow(
    "Invalid port",
  );
  expect(parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: "65535" })).toMatchObject({
    server: { port: 65535 },
  });
});

test("C4: --publish-activity is a valueless, non-repeatable opt-in", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  expect(parseOptions(["--publish-activity"], env)).toEqual({
    action: "run",
    server: { workspace: "/trusted", port: 41241, executor: { activity: true } },
  });
  expect(parseOptions(["--port", "0", "--publish-activity"], env)).toMatchObject({
    server: { port: 0, executor: { activity: true } },
  });
  expect(() => parseOptions(["--publish-activity", "--publish-activity"], env)).toThrow(
    StartupError,
  );
  expect(() => parseOptions(["--publish-activity=1"], env)).toThrow(StartupError);
});

test("C5: --permissions takes exactly reject or ask and combines with --publish-activity", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  const base = { workspace: "/trusted", port: 41241 };
  expect(parseOptions(["--permissions", "ask"], env)).toEqual({
    action: "run",
    server: { ...base, executor: { permissions: "ask" } },
  });
  expect(parseOptions(["--permissions", "reject"], env)).toEqual({ action: "run", server: base });
  expect(parseOptions(["--publish-activity", "--permissions", "ask"], env)).toEqual({
    action: "run",
    server: { ...base, executor: { activity: true, permissions: "ask" } },
  });
  for (const bad of [
    ["--permissions"],
    ["--permissions", "allow"],
    ["--permissions", "ASK"],
    ["--permissions", "ask", "--permissions", "ask"],
  ])
    expect(() => parseOptions(bad, env)).toThrow(StartupError);
});

test("C6: --allow-resume is a valueless, non-repeatable opt-in", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  expect(parseOptions(["--allow-resume"], env)).toEqual({
    action: "run",
    server: { workspace: "/trusted", port: 41241, executor: { resume: true } },
  });
  expect(
    parseOptions(["--allow-resume", "--permissions", "ask", "--publish-activity"], env),
  ).toMatchObject({
    server: { executor: { resume: true, permissions: "ask", activity: true } },
  });
  expect(() => parseOptions(["--allow-resume", "--allow-resume"], env)).toThrow(StartupError);
  expect(() => parseOptions(["--allow-resume=1"], env)).toThrow(StartupError);
});

test("prompt timeout is a validated startup-only ACP option", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  for (const [value, ms] of [
    ["30ms", 30],
    ["120s", 120_000],
    ["60m", 3_600_000],
    ["1h", 3_600_000],
    ["2147483647ms", 2_147_483_647],
    ["unlimited", null],
  ] as const) {
    expect(parseOptions(["--prompt-timeout", value], env)).toMatchObject({
      server: { acp: { promptTimeoutMs: ms } },
    });
  }
  for (const value of [
    "0ms",
    "29ms",
    "-1s",
    "1.5m",
    "1e3s",
    "120",
    "1d",
    "2147483648ms",
    "Infinity",
    "UNLIMITED",
    "60m ",
    "60m\n",
  ]) {
    expect(() => parseOptions(["--prompt-timeout", value], env)).toThrow("Invalid prompt timeout");
  }
  expect(() => parseOptions(["--prompt-timeout"], env)).toThrow(StartupError);
  const duplicate = ["--prompt-timeout", "1m", "--prompt-timeout", "2m"];
  expect(() => parseOptions(duplicate, env)).toThrow(StartupError);
});
