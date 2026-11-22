import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { validateRuntimePaths, validateRuntimeSources } from "../src/runtime-preflight.js";

test("runtime source validation rejects external, virtual and symlinked sources", () => {
  const root = mkdtempSync(join(realpathSync("/tmp"), "runtime-preflight-test-"));
  const workspace = join(root, "workspace");
  const runtime = join(root, "runtime");
  const outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(runtime);
  mkdirSync(outside);
  symlinkSync(outside, join(workspace, "redirect"));
  try {
    const privateSource = { type: "directory", path: runtime };
    const sources = (extra: object[]) => JSON.stringify([privateSource, ...extra]);
    expect(() => validateRuntimeSources(sources([]), runtime, workspace)).not.toThrow();
    expect(() =>
      validateRuntimeSources(
        sources([{ type: "document", path: join(workspace, "opencode.json") }]),
        runtime,
        workspace,
      ),
    ).not.toThrow();
    for (const entry of [
      { type: "document", path: join(outside, "opencode.json") },
      { type: "document", path: join(workspace, "redirect", "opencode.json") },
      { type: "remote", path: workspace },
      { type: "document" },
    ]) {
      expect(() => validateRuntimeSources(sources([entry]), runtime, workspace)).toThrow();
    }
    expect(() => validateRuntimeSources("[]", runtime, workspace)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime paths require a complete private path set", () => {
  const root = mkdtempSync(join(realpathSync("/tmp"), "runtime-paths-test-"));
  try {
    const keys = ["home", "data", "cache", "config", "state", "tmp", "db"];
    const paths = keys.map((key) => `${key} ${root}/${key}`).join("\n");
    expect(() => validateRuntimePaths(paths, root)).not.toThrow();
    expect(() => validateRuntimePaths(paths.replace(`${root}/db`, "/etc/db"), root)).toThrow();
    expect(() => validateRuntimePaths(paths.replace(`db ${root}/db`, ""), root)).toThrow();
    expect(() => validateRuntimePaths(`${paths}\nhome ${root}/other`, root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
