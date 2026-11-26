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

test("C4: the workspace defaults to the current directory; a relative environment value is rejected", () => {
  expect(parseOptions([], {}, "/here")).toEqual({
    action: "run",
    server: { workspace: "/here", port: 41241 },
  });
  expect(parseOptions(["--workspace", "sub"], {}, "/here")).toMatchObject({
    server: { workspace: "/here/sub" },
  });
  expect(parseOptions([], { A2A_WORKSPACE: "/trusted" }, "/here")).toMatchObject({
    server: { workspace: "/trusted" },
  });
  expect(() => parseOptions([], { A2A_WORKSPACE: "relative/path" })).toThrow(StartupError);
  expect(() => parseOptions([], { A2A_WORKSPACE: "relative/path" })).toThrow("A2A_WORKSPACE");
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

const run = { workspace: "/trusted", port: 41241 };
const accepted = (args: string[]) => parseOptions(args, { A2A_WORKSPACE: "/trusted" });

test("--enable accepts each extra alone, all together and in any order", () => {
  expect(accepted(["--enable", "activity"])).toEqual({
    action: "run",
    server: { ...run, executor: { activity: true } },
  });
  expect(accepted(["--enable", "approve"])).toEqual({
    action: "run",
    server: { ...run, executor: { permissions: "ask" } },
  });
  expect(accepted(["--enable", "resume"])).toEqual({
    action: "run",
    server: { ...run, executor: { resume: true } },
  });
  const all = { server: { executor: { activity: true, permissions: "ask", resume: true } } };
  expect(
    accepted(["--enable", "activity", "--enable", "approve", "--enable", "resume"]),
  ).toMatchObject(all);
  expect(
    accepted(["--enable", "resume", "--port", "0", "--enable", "approve", "--enable", "activity"]),
  ).toMatchObject(all);
  expect(accepted([])).toEqual({ action: "run", server: run });
});

test("--enable rejects duplicates, unknown, missing and attached values", () => {
  for (const bad of [
    ["--enable", "activity", "--enable", "activity"],
    ["--enable", "Activity"],
    ["--enable", "shell"],
    ["--enable", "activity,resume"],
    ["--enable"],
    ["--enable="],
    ["--enable=activity"],
  ])
    expect(() => accepted(bad)).toThrow("Use --help");
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
