import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { releaseVersion } from "../scripts/release.js";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })),
);

test("REL01: release arithmetic resets subordinate version components", () => {
  expect(releaseVersion("1.2.3", "patch")).toBe("1.2.4");
  expect(releaseVersion("1.2.3", "minor")).toBe("1.3.0");
  expect(releaseVersion("1.2.3", "major")).toBe("2.0.0");
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "release-test-"));
  directories.push(directory);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GH_PROMPT_DISABLED: "1",
  };
  ["MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES", "VERSION", "BUMP"].forEach((key) =>
    Reflect.deleteProperty(env, key),
  );
  Object.keys(env)
    .filter(
      (key) =>
        key.startsWith("GIT_") && !["GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"].includes(key),
    )
    .forEach((key) => Reflect.deleteProperty(env, key));
  const run = (args: string[]) =>
    spawnSync(args[0]!, args.slice(1), { cwd: directory, env, encoding: "utf8", timeout: 20_000 });
  const git = (...args: string[]) => {
    const result = run(["git", ...args]);
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "--bare", join(directory, "remote.git"));
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  writeFileSync(join(directory, ".gitignore"), "remote.git/\ngh\ngh-args.json\nchecked\n");
  writeFileSync(join(directory, "package.json"), '{"name":"fixture","version":"0.1.0"}\n');
  writeFileSync(
    join(directory, "Makefile"),
    `check:\n\t@touch checked\nrelease:\n\t${process.execPath} ${resolve("scripts/release.ts")} "$(or $(VERSION),$(BUMP),patch)"\n`,
  );
  // The CLI contract is the subject of this stand-in; Git operations use a real bare remote.
  writeFileSync(
    join(directory, "gh"),
    `#!${process.execPath}\nimport {writeFileSync} from "node:fs";\nconst args = process.argv.slice(2);\nif (args[0] === "repo") { console.log("main"); process.exit(0); }\nwriteFileSync("gh-args.json", JSON.stringify(args));\nif (process.env.FAIL_PUBLICATION) process.exit(1);\nconsole.log("https://github.com/example/fixture/releases/tag/" + args[2]);\n`,
  );
  chmodSync(join(directory, "gh"), 0o755);
  env.PATH = `${directory}:${process.env.PATH}`;
  git("add", "package.json", "Makefile", ".gitignore");
  git("commit", "-m", "Initial fixture");
  git("remote", "add", "origin", join(directory, "remote.git"));
  git("push", "-u", "origin", "main");
  return { directory, env, run, git };
}

test("REL03: release pushes the annotated tag and invokes GitHub publication", () => {
  const version = "0.1.1";
  const context = fixture();
  const result = context.run(["make", "release", "BUMP=patch"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`/releases/tag/v${version}`);
  expect(JSON.parse(readFileSync(join(context.directory, "package.json"), "utf8")).version).toBe(
    version,
  );
  expect(context.git("cat-file", "-t", `v${version}`)).toBe("tag");
  expect(context.git("rev-parse", `v${version}^{commit}`)).toBe(
    context.git("rev-parse", "origin/main"),
  );
  expect(context.git("ls-remote", "origin", `refs/tags/v${version}`)).toContain(
    `refs/tags/v${version}`,
  );
  expect(context.git("status", "--porcelain")).toBe("");
  expect(readFileSync(join(context.directory, "checked"), "utf8")).toBe("");
  expect(JSON.parse(readFileSync(join(context.directory, "gh-args.json"), "utf8"))).toEqual([
    "release",
    "create",
    `v${version}`,
    "--repo",
    join(context.directory, "remote.git"),
    "--verify-tag",
    "--generate-notes",
    "--title",
    `v${version}`,
  ]);
});

test.each(["dirty", "check"])("REL04: rejects %s state before creating a release", (failure) => {
  const context = fixture();
  if (failure === "dirty") writeFileSync(join(context.directory, "untracked"), "dirty");
  if (failure === "check") {
    writeFileSync(
      join(context.directory, "Makefile"),
      readFileSync(join(context.directory, "Makefile"), "utf8").replace(
        "@touch checked",
        "@exit 1",
      ),
    );
    context.git("add", "Makefile");
    context.git("commit", "-m", "Fail checks");
    context.git("push", "origin", "main");
  }
  const before = context.git("rev-parse", "HEAD");
  const result = context.run(["make", "release", "BUMP=patch"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(failure === "check" ? "make check failed" : "Release requires");
  expect(context.git("rev-parse", "HEAD")).toBe(before);
  expect(context.git("ls-remote", "origin", "refs/tags/v0.1.1")).toBe("");
});

test("REL05: publication failure retains the pushed commit and tag for recovery", () => {
  const context = fixture();
  Object.assign(context.env, { FAIL_PUBLICATION: "1" });
  const result = context.run(["make", "release", "BUMP=patch"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("gh release create v0.1.1");
  expect(context.git("ls-remote", "origin", "refs/tags/v0.1.1")).toContain("refs/tags/v0.1.1");
  expect(context.git("rev-parse", "v0.1.1^{commit}")).toBe(context.git("rev-parse", "origin/main"));
  expect(context.git("status", "--porcelain")).toBe("");
});

test("REL06: remote rejection retains local release state without publishing or partially pushing", () => {
  const context = fixture();
  const before = context.git("rev-parse", "origin/main");
  const hook = join(context.directory, "remote.git/hooks/pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  const result = context.run(["make", "release", "BUMP=patch"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("git push --atomic");
  expect(context.git("rev-parse", "v0.1.1^{commit}")).toBe(context.git("rev-parse", "HEAD"));
  expect(context.git("ls-remote", "origin", "refs/heads/main")).toContain(before);
  expect(context.git("ls-remote", "origin", "refs/tags/v0.1.1")).toBe("");
  expect(() => readFileSync(join(context.directory, "gh-args.json"))).toThrow();
});
