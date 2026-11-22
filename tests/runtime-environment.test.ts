import { expect, test } from "bun:test";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRuntimeEnvironment, validatePassEnv } from "../src/runtime-environment.js";

test("private environment contains only runtime paths and named credentials", () => {
  const runtime = createRuntimeEnvironment(["OPENAI_API_KEY"], {
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "test-key",
    OPENCODE_CONFIG_CONTENT: "private-marker",
    UNRELATED_TOKEN: "other-marker",
    HTTPS_PROXY: "proxy-marker",
  });
  try {
    expect(statSync(runtime.root).mode & 0o777).toBe(0o700);
    expect(realpathSync(runtime.root)).toBe(runtime.root);
    expect(runtime.env.OPENAI_API_KEY).toBe("test-key");
    expect(runtime.env.HOME).toBe(`${runtime.root}/home`);
    expect(runtime.env.A2A_LITE_RUNTIME_ID).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(runtime.env.UNRELATED_TOKEN).toBeUndefined();
    expect(runtime.env.HTTPS_PROXY).toBeUndefined();
  } finally {
    runtime.remove();
  }
  expect(existsSync(runtime.root)).toBe(false);
});

test("runtime markers are newly generated rather than inherited", () => {
  const source = { PATH: "/usr/bin:/bin", A2A_LITE_RUNTIME_ID: "ambient" };
  const first = createRuntimeEnvironment([], source);
  const second = createRuntimeEnvironment([], source);
  try {
    expect(first.env.A2A_LITE_RUNTIME_ID).not.toBe("ambient");
    expect(first.env.A2A_LITE_RUNTIME_ID).not.toBe(second.env.A2A_LITE_RUNTIME_ID);
  } finally {
    first.remove();
    second.remove();
  }
});

test("routing overrides are rejected while provider credentials remain usable", () => {
  for (const name of [
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "ANTHROPIC_API_URL",
    "AZURE_OPENAI_ENDPOINT",
    "provider_host",
  ]) {
    expect(() => validatePassEnv([name], { [name]: "sensitive-value" })).toThrow();
    expect(() => validatePassEnv([name], { [name]: "sensitive-value" })).not.toThrow(
      "sensitive-value",
    );
  }
  expect(
    validatePassEnv(["AWS_ACCESS_KEY_ID", "OPENAI_API_KEY"], {
      AWS_ACCESS_KEY_ID: "key",
      OPENAI_API_KEY: "key",
    }),
  ).toEqual({ AWS_ACCESS_KEY_ID: "key", OPENAI_API_KEY: "key" });
});

test("passthrough rejects missing, duplicate and injection-sensitive names without values", () => {
  const source = { OPENAI_API_KEY: "sensitive-value", NODE_OPTIONS: "sensitive-value" };
  for (const names of [
    ["OPENAI_API_KEY", "OPENAI_API_KEY"],
    ["MISSING"],
    ["NODE_OPTIONS"],
    ["OPENCODE_CONFIG"],
    ["A2A_LITE_RUNTIME_ID"],
    ["HTTPS_PROXY"],
    ["PATH"],
    ["bad-name"],
  ]) {
    expect(() => validatePassEnv(names, source)).toThrow();
    expect(() => validatePassEnv(names, source)).not.toThrow("sensitive-value");
  }
  expect(() => createRuntimeEnvironment([], { PATH: "/usr/bin::/bin" })).toThrow("PATH");
  expect(() => createRuntimeEnvironment([], { PATH: "relative" })).toThrow("PATH");
});

test("loader and locale search paths are rejected even when present", () => {
  for (const name of [
    "GCONV_PATH",
    "gconv_path",
    "LOCPATH",
    "NLSPATH",
    "GETCONF_DIR",
    "HOSTALIASES",
    "RES_OPTIONS",
    "LOCALDOMAIN",
  ]) {
    const source = { [name]: "sensitive-value" };
    expect(() => validatePassEnv([name], source)).toThrow();
    expect(() => validatePassEnv([name], source)).not.toThrow("sensitive-value");
  }
});
