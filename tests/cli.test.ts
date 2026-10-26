import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseOptions } from "../src/cli-options.js";
import { StartupError } from "../src/startup-error.js";

test("explicit flags resolve trusted paths and override environment", () => {
  expect(
    parseOptions(["--workspace", "a path", "--port", "0"], {
      A2A_WORKSPACE: "invalid-relative-env",
      A2A_PORT: "bad",
    }),
  ).toEqual({ action: "run", server: { workspace: resolve("a path"), port: 0 } });
  expect(parseOptions([], { A2A_WORKSPACE: "/trusted" })).toEqual({
    action: "run",
    server: { workspace: "/trusted", port: 41241 },
  });
  expect(parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: "65535" })).toEqual({
    action: "run",
    server: { workspace: "/trusted", port: 65535 },
  });
});

test.each(["--help", "-h", "--version", "-v"])("%s precedes resource validation", (flag) => {
  const options = parseOptions([flag], { A2A_WORKSPACE: "relative", A2A_PORT: "invalid" });
  expect(options.action).toBe(flag === "--help" || flag === "-h" ? "help" : "version");
  expect(options).not.toHaveProperty("server");
});

test.each(["--help", "-h", "--version", "-v"])(
  "%s permits syntactically valid flags before resource validation",
  (flag) => {
    const options = parseOptions(["--workspace", ".", flag, "--port", "invalid"], {
      A2A_WORKSPACE: "relative",
      A2A_PORT: "invalid",
    });
    expect(options.action).toBe(flag === "--help" || flag === "-h" ? "help" : "version");
    expect(options).not.toHaveProperty("server");
  },
);

test.each([undefined, "", ".", "relative/path"])(
  "env workspace %s never trusts cwd",
  (workspace) => {
    const env = workspace === undefined ? {} : { A2A_WORKSPACE: workspace };
    expect(() => parseOptions([], env)).toThrow(StartupError);
    expect(() => parseOptions([], env)).toThrow("trusted absolute workspace");
  },
);

test.each(["", " ", "-1", "1.5", "NaN", "Infinity", "1e3", "0x10", "65536", "1\n"])(
  "rejects non-decimal/out-of-range env port %j",
  (port) => {
    expect(() => parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: port })).toThrow(
      StartupError,
    );
    expect(() => parseOptions([], { A2A_WORKSPACE: "/trusted", A2A_PORT: port })).toThrow(
      "Invalid port",
    );
  },
);

test.each(
  [
    ["--unknown"],
    ["--unknown", "--help"],
    ["--workspace", "--version"],
    ["--port", "-v"],
    ["--help", "--workspace"],
    ["--help", "-h"],
    ["--version", "-v"],
    ["--help", "--port", "0", "--port", "1"],
    ["--workspace"],
    ["--port"],
    ["--workspace", ""],
    ["--workspace", "--port"],
    ["--port", "0", "--port", "1"],
    ["positional"],
    ["--port=0"],
  ].map((args) => ({ args })),
)("rejects malformed arguments %j without reflecting input", ({ args }) => {
  expect(() => parseOptions(args, { A2A_WORKSPACE: "/trusted" })).toThrow(StartupError);
  expect(() => parseOptions(args, { A2A_WORKSPACE: "/trusted" })).toThrow("Use --help");
});
