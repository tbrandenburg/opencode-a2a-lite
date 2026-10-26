import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function command(args: string[], timeout = 120_000): string {
  const result = spawnSync(args[0]!, args.slice(1), {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function parts(version: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid version: ${version}; expected x.y.z without a v prefix`);
  }
  const values = version.split(".").map(Number);
  if (!values.every(Number.isSafeInteger))
    throw new Error("Version components exceed safe integers");
  return values;
}

export function releaseVersion(current: string, option: string): string {
  const values = parts(current);
  const index = ["major", "minor", "patch"].indexOf(option);
  const version =
    index < 0
      ? option
      : values
          .map((value, position) => (position < index ? value : position === index ? value + 1 : 0))
          .join(".");
  const next = parts(version);
  const difference = next
    .map((value, position) => value - values[position]!)
    .find((value) => value !== 0);
  if (difference !== undefined && difference < 0) throw new Error("Version cannot decrease");
  return version;
}

function release(option: string): void {
  const original = readFileSync("package.json", "utf8");
  const manifest: unknown = JSON.parse(original);
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("package.json must contain a version string");
  }
  const version = releaseVersion(manifest.version, option);
  const tag = `v${version}`;
  if (command(["git", "status", "--porcelain"]))
    throw new Error("Release requires a clean working tree");
  const branch = command(["git", "symbolic-ref", "--short", "HEAD"]);
  const repository = command(["git", "remote", "get-url", "origin"]);
  const remote = command([
    "gh",
    "repo",
    "view",
    repository,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  if (branch !== remote) throw new Error(`Release requires the default branch: ${remote}`);
  command(["git", "fetch", "origin"]);
  if (
    command(["git", "rev-parse", "HEAD"]) !==
    command(["git", "rev-parse", `refs/remotes/origin/${branch}`])
  ) {
    throw new Error("Release requires HEAD to match origin's default branch; push or pull first");
  }
  if (
    command(["git", "tag", "--list", tag]) ||
    command(["git", "ls-remote", "--tags", "origin", `refs/tags/${tag}`])
  ) {
    throw new Error(`Tag ${tag} exists; choose a new version`);
  }
  console.log(`Checking release ${tag}...`);
  const check = spawnSync("make", ["check"], { stdio: "inherit", timeout: 600_000 });
  if (check.error || check.status !== 0) throw new Error("make check failed; release not created");
  if (command(["git", "status", "--porcelain"]))
    throw new Error("Checks changed tracked or untracked files; release stopped");
  if (version !== manifest.version) {
    manifest.version = version;
    writeFileSync("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
    command(["git", "add", "--", "package.json"]);
    command(["git", "commit", "-m", `chore(release): ${tag}`]);
  }
  command(["git", "tag", "-a", tag, "-m", `Release ${tag}`]);
  console.log(
    `Publishing ${tag}; if publication fails, retain the commit/tag and follow README recovery instructions.`,
  );
  command(["git", "push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`]);
  console.log(
    command([
      "gh",
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--verify-tag",
      "--generate-notes",
      "--title",
      tag,
    ]),
  );
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Usage: bun scripts/release.ts patch|minor|major|x.y.z");
    release(process.argv[2]!);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
