import { expect, test } from "bun:test";
import { runtimeInUse } from "../src/runtime-processes.js";

test("runtime scan ignores specified inaccessible process entries but fails on unexpected errors", () => {
  for (const code of ["EACCES", "EPERM", "ENOENT", "ESRCH", "EIO"]) {
    const error = Object.assign(new Error("synthetic"), { code });
    const reader = {
      list: (path: string) => {
        if (path === "/proc") return ["123"];
        throw error;
      },
      read: () => {
        throw error;
      },
      link: () => {
        throw error;
      },
    };
    if (code === "EIO") {
      expect(() => runtimeInUse("/private/runtime", "marker", reader)).toThrow("synthetic");
    } else {
      expect(runtimeInUse("/private/runtime", "marker", reader)).toBe(false);
    }
  }
});

test("runtime scan detects tag, cwd and open files without matching sibling paths", () => {
  const access = (env: string, cwd: string, fd: string) => ({
    list: (path: string) => (path === "/proc" ? ["1"] : ["3"]),
    read: () => env,
    link: (path: string) => (path.endsWith("/cwd") ? cwd : fd),
  });
  expect(
    runtimeInUse(
      "/private/runtime",
      "marker",
      access("A2A_LITE_RUNTIME_ID=marker\0", "/", "/dev/null"),
    ),
  ).toBe(true);
  expect(
    runtimeInUse("/private/runtime", "marker", access("", "/private/runtime/home", "/dev/null")),
  ).toBe(true);
  expect(runtimeInUse("/private/runtime", "marker", access("", "/", "/private/runtime/file"))).toBe(
    true,
  );
  expect(
    runtimeInUse("/private/runtime", "marker", access("", "/", "/private/runtime-other/file")),
  ).toBe(false);
});
