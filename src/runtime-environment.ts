import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Exception } from "./policy-file.js";
import { policyConfig, type PolicyProfile } from "./runtime-policy.js";

// Names affecting process startup, executable discovery, configuration, trust or
// network routing cannot be delegated through the credential passthrough.
const reserved =
  /^(?:A2A_|OPENCODE_|XDG_|LD_|DYLD_|GLIBC_|MALLOC_|BUN_|NODE_|NPM_|BASH_FUNC_|SSL_|OPENSSL_|CURL_|GIT_|PYTHON|RUBY|PERL|JAVA_|JDK_|AWS_CONFIG|AWS_SHARED_CREDENTIALS|GOOGLE_APPLICATION_CREDENTIALS|GCONV_PATH$|LOCPATH$|NLSPATH$|GETCONF_DIR$|HOSTALIASES$|RES_OPTIONS$|LOCALDOMAIN$|TERMINFO|TZDIR$|TZ$|SSH_ASKPASS|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|HOME$|PATH$|SHELL$|ENV$|BASH_ENV$|CDPATH$|IFS$|TMPDIR$|TMP$|TEMP$|LANG$|LC_)/i;

export function validatePassEnv(names: readonly string[], source: NodeJS.ProcessEnv) {
  const values: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const seen = new Set<string>();
  for (const name of names) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      name.startsWith("_") ||
      reserved.test(name) ||
      /(?:^|_)(?:ENDPOINT|BASE|URL|URI|HOST|PROXY)(?:_|$)/i.test(name) ||
      seen.has(name) ||
      !Object.hasOwn(source, name) ||
      typeof source[name] !== "string" ||
      source[name] === ""
    )
      throw new Error("Invalid, duplicate, reserved or missing --pass-env variable");
    seen.add(name);
    values[name] = source[name];
  }
  return values;
}

export function createRuntimeEnvironment(
  names: readonly string[],
  source: NodeJS.ProcessEnv,
  policy?: PolicyProfile,
  extra: { exceptions?: readonly Exception[]; data?: string } = {},
) {
  const passed = validatePassEnv(names, source);
  const path = source.PATH;
  if (!path || path.split(":").some((entry) => !entry || !isAbsolute(entry)))
    throw new Error("A PATH containing only absolute directories is required");
  const root = mkdtempSync(join(realpathSync("/tmp"), "opencode-a2a-runtime-"));
  try {
    chmodSync(root, 0o700);
    const home = join(root, "home");
    const temporary = join(root, "tmp");
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(temporary, { mode: 0o700 });
    if (policy) {
      const config = join(home, ".config", "opencode");
      mkdirSync(config, { recursive: true, mode: 0o700 });
      writeFileSync(
        join(config, "opencode.json"),
        JSON.stringify(policyConfig(policy, extra.exceptions)),
        {
          mode: 0o600,
        },
      );
    }
    const env: NodeJS.ProcessEnv = {
      PATH: path,
      LANG: "C",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: extra.data ?? join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      XDG_RUNTIME_DIR: temporary,
      TMPDIR: temporary,
      // Operator trust settings, not credential passthrough exceptions.
      ...(isAbsolute(source.NODE_EXTRA_CA_CERTS ?? "")
        ? { NODE_EXTRA_CA_CERTS: source.NODE_EXTRA_CA_CERTS }
        : {}),
      ...(source.NODE_USE_SYSTEM_CA === "1" ? { NODE_USE_SYSTEM_CA: "1" } : {}),
      ...passed,
      A2A_LITE_RUNTIME_ID: randomBytes(32).toString("hex"),
    };
    return { root, env, remove: () => rmSync(root, { recursive: true }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
