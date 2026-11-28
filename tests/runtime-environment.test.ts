import { expect, test } from "bun:test";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createRuntimeEnvironment, validatePassEnv } from "../src/runtime-environment.js";

test("private environment contains only runtime paths and named credentials", () => {
  const runtime = createRuntimeEnvironment(["OPENAI_API_KEY"], {
    PATH: "/usr/bin:/bin",
    OPENAI_API_KEY: "test-key",
    OPENCODE_CONFIG_CONTENT: "private-marker",
    UNRELATED_TOKEN: "other-marker",
    ALL_PROXY: "proxy-marker",
  });
  try {
    expect(statSync(runtime.root).mode & 0o777).toBe(0o700);
    expect(realpathSync(runtime.root)).toBe(runtime.root);
    expect(runtime.env.OPENAI_API_KEY).toBe("test-key");
    expect(runtime.env.HOME).toBe(`${runtime.root}/home`);
    expect(runtime.env.A2A_LITE_RUNTIME_ID).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
    expect(runtime.env.UNRELATED_TOKEN).toBeUndefined();
    expect(runtime.env.ALL_PROXY).toBeUndefined();
  } finally {
    runtime.remove();
  }
  expect(existsSync(runtime.root)).toBe(false);
});

test("only an absolute operator CA path is inherited, never other trust overrides", () => {
  for (const ca of [undefined, "", "relative/ca.crt", "/operator/ca.crt"]) {
    const source = {
      PATH: "/usr/bin:/bin",
      ...(ca === undefined ? {} : { NODE_EXTRA_CA_CERTS: ca }),
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      NODE_OPTIONS: "--inspect",
      SSL_CERT_FILE: "/other/ca.crt",
      BUN_TLS_REJECT_UNAUTHORIZED: "0",
      OPENSSL_CONF: "/other/openssl.cnf",
    };
    const runtime = createRuntimeEnvironment([], source);
    try {
      expect(runtime.env.NODE_EXTRA_CA_CERTS).toBe(ca === "/operator/ca.crt" ? ca : undefined);
      expect(Object.hasOwn(runtime.env, "NODE_EXTRA_CA_CERTS")).toBe(ca === "/operator/ca.crt");
      for (const name of [
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "NODE_OPTIONS",
        "SSL_CERT_FILE",
        "BUN_TLS_REJECT_UNAUTHORIZED",
        "OPENSSL_CONF",
      ]) {
        expect(runtime.env[name]).toBeUndefined();
        expect(() => validatePassEnv([name], source)).toThrow();
      }
    } finally {
      runtime.remove();
    }
  }
  expect(() =>
    validatePassEnv(["NODE_EXTRA_CA_CERTS"], { NODE_EXTRA_CA_CERTS: "/operator/ca.crt" }),
  ).toThrow();
});

test("system CA trust is inherited only with the explicit value 1", () => {
  for (const value of [undefined, "", "0", "true", "1"]) {
    const source = {
      PATH: "/usr/bin:/bin",
      ...(value === undefined ? {} : { NODE_USE_SYSTEM_CA: value }),
    };
    const runtime = createRuntimeEnvironment([], source);
    try {
      expect(runtime.env.NODE_USE_SYSTEM_CA).toBe(value === "1" ? "1" : undefined);
      expect(Object.hasOwn(runtime.env, "NODE_USE_SYSTEM_CA")).toBe(value === "1");
    } finally {
      runtime.remove();
    }
  }
  expect(() => validatePassEnv(["NODE_USE_SYSTEM_CA"], { NODE_USE_SYSTEM_CA: "1" })).toThrow();
});

test("operator proxy settings preserve loopback bypasses and block credential passthrough", () => {
  const source = {
    PATH: "/usr/bin:/bin",
    HTTP_PROXY: "http://proxy.example:8080",
    HTTPS_PROXY: "http://unused.example:8080",
    https_proxy: "http://secure.example:8080",
    NO_PROXY: ".internal.example",
    ALL_PROXY: "http://blocked.example:8080",
  };
  const runtime = createRuntimeEnvironment([], source);
  try {
    expect(runtime.env.HTTP_PROXY).toBe(source.HTTP_PROXY);
    expect(runtime.env.http_proxy).toBe(source.HTTP_PROXY);
    expect(runtime.env.HTTPS_PROXY).toBe(source.https_proxy);
    expect(runtime.env.https_proxy).toBe(source.https_proxy);
    expect(runtime.env.NO_PROXY).toBe(".internal.example,localhost,127.0.0.1,::1");
    expect(runtime.env.no_proxy).toBe(runtime.env.NO_PROXY);
    expect(runtime.env.ALL_PROXY).toBeUndefined();
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "ALL_PROXY"]) {
      expect(() => validatePassEnv([name], source)).toThrow();
    }
  } finally {
    runtime.remove();
  }
  const empty = createRuntimeEnvironment([], {
    PATH: "/usr/bin:/bin",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    NO_PROXY: "",
  });
  try {
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
      expect(Object.hasOwn(empty.env, name)).toBe(false);
    }
  } finally {
    empty.remove();
  }
});

test("loopback fetch bypasses the operator HTTP proxy", async () => {
  const origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("direct"),
  });
  let proxyHits = 0;
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      proxyHits++;
      return new Response("proxy");
    },
  });
  const runtime = createRuntimeEnvironment([], {
    PATH: "/usr/bin:/bin",
    HTTP_PROXY: proxy.url.href,
  });
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `console.log(await (await fetch(${JSON.stringify(origin.url.href)}, { signal: AbortSignal.timeout(3000) })).text())`,
      ],
      { env: runtime.env, stdout: "pipe", stderr: "pipe" },
    );
    expect((await new Response(child.stdout).text()).trim()).toBe("direct");
    expect(await child.exited).toBe(0);
    expect(proxyHits).toBe(0);
  } finally {
    runtime.remove();
    origin.stop(true);
    proxy.stop(true);
  }
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
    "_PRIVATE",
    "GLIBC_TUNABLES",
    "MALLOC_CHECK_",
    "TERMINFO",
    "TERMINFO_DIRS",
    "TZDIR",
    "TZ",
    "SSH_ASKPASS",
    "SSH_ASKPASS_REQUIRE",
  ]) {
    const source = { [name]: "sensitive-value" };
    expect(() => validatePassEnv([name], source)).toThrow();
    expect(() => validatePassEnv([name], source)).not.toThrow("sensitive-value");
  }
  expect(
    validatePassEnv(["OPENAI_API_KEY", "ANTHROPIC_API_KEY"], {
      OPENAI_API_KEY: "first",
      ANTHROPIC_API_KEY: "second",
    }),
  ).toEqual({ OPENAI_API_KEY: "first", ANTHROPIC_API_KEY: "second" });
});
