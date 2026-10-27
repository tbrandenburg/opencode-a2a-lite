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
