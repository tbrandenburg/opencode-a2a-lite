import { expect, test } from "bun:test";
import { supportedOpenCode } from "../src/opencode-version.js";

test("admits stable OpenCode 2.2.7 and newer", () => {
  for (const version of ["2.2.7", "2.2.8", "2.2.10", "2.3.0", "2.10.0", "3.0.0", "10.0.0"])
    expect(supportedOpenCode(`opencode v${version}`)).toBe(true);
});

test("rejects older, prerelease and malformed versions", () => {
  for (const output of [
    "opencode v2.2.6",
    "opencode v2.1.99",
    "opencode v1.99.99",
    "opencode v2.3.0-beta.1",
    "opencode v2.3.0+build",
    "opencode v02.3.0",
    "opencode v2.3",
    "opencode 2.3.0",
    "v2.3.0",
    "opencode v2.3.0 extra",
    "",
  ])
    expect(supportedOpenCode(output)).toBe(false);
});
