import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

const expected = [
  "src/acp-client.ts",
  "src/executor.ts",
  "src/request-handler.ts",
  "src/server.ts",
];
async function optional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function version(command: string[]) {
  const result = Bun.spawnSync(command);
  if (result.exitCode !== 0) throw new Error(`Version command failed: ${command[0]}`);
  return result.stdout.toString().trim();
}
async function inventory(pattern: string) {
  const files = Array.from(new Bun.Glob(pattern).scanSync(".")).sort();
  return Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, "utf8");
      const lines = text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
      return { file, lines };
    }),
  );
}
const source = await inventory("src/**/*.ts");
const tests = await inventory("tests/**/*.test.ts");
const lint = await optional(".test-results/lint.txt");
const test = await optional(".test-results/test.json");
const lcov = await optional("coverage/lcov.info");
const records = lcov?.split("end_of_record").filter((record) => record.includes("SF:")) ?? [];
const covered = records.map((record) => record.match(/^SF:(.+)$/m)?.[1]?.replace(/^\.\//, ""));
const missing = source.filter((entry) => !covered.includes(entry.file));
const unexpected = source.filter((entry) => !expected.includes(entry.file));
const absent = expected.filter((file) => !source.some((entry) => entry.file === file));
function counter(record: string, name: string) {
  const value = record.match(new RegExp(`^${name}:(\\d+)$`, "m"))?.[1];
  return value === undefined ? undefined : Number(value);
}
function coverage(record: string, hit: string, found: string) {
  const numerator = counter(record, hit);
  const denominator = counter(record, found);
  if (numerator === undefined || denominator === undefined) return "unmeasured";
  return `${numerator}/${denominator} (${denominator ? ((100 * numerator) / denominator).toFixed(2) : "n/a"}%)`;
}
const lines = [
  "# Local quality baseline",
  "",
  `Commit: ${version(["git", "rev-parse", "HEAD"])} (working-tree changes are not represented by the SHA).`,
  `Bun: ${Bun.version}; Oxlint ${version(["node_modules/.bin/oxlint", "--version"])}; Oxfmt ${version(["node_modules/.bin/oxfmt", "--version"])}; TypeScript ${version(["node_modules/.bin/tsc", "--version"])}.`,
  "",
  `Test process: ${test ? JSON.stringify(JSON.parse(test)) : "not run / report unavailable"}. Seconds are whole-process wall time, not summed JUnit suite times.`,
  "Runtime is informational; no warning budget or ratchet is selected.",
  "",
  "## Physical inventory",
  "",
  "Blank and comment lines count; a trailing newline does not add a line. Fixtures, scripts, live harnesses, dependencies, worktrees and generated output are excluded.",
  "",
  "| File | Physical lines |",
  "| --- | ---: |",
  ...[...source, ...tests].map((entry) => `| ${entry.file} | ${entry.lines} |`),
  "",
  `Production: ${source.length} files / ${source.reduce((sum, entry) => sum + entry.lines, 0)} lines. Deterministic tests: ${tests.length} files / ${tests.reduce((sum, entry) => sum + entry.lines, 0)} lines.`,
  `Expected production inventory: ${expected.join(", ")}.`,
  `Inventory differences: missing expected [${absent.join(", ")}]; unexpected [${unexpected.map((entry) => entry.file).join(", ")}].`,
  "",
  "## Native coverage",
  "",
  "Function/line counters only; per-file LCOV counts, not Bun's displayed per-file-average aggregate. Branch coverage: **unmeasured**. Mutation score: **unmeasured**.",
  "",
  lcov
    ? `Source files missing from LCOV: [${missing.map((entry) => entry.file).join(", ")}].`
    : "Coverage not requested or report unavailable (not 0%).",
  "",
  "| Production file | Functions hit/found | Lines hit/found |",
  "| --- | ---: | ---: |",
  ...source.map((entry) => {
    const record =
      records.find(
        (value) => value.match(/^SF:(.+)$/m)?.[1]?.replace(/^\.\//, "") === entry.file,
      ) ?? "";
    return `| ${entry.file} | ${coverage(record, "FNH", "FNF")} | ${coverage(record, "LH", "LF")} |`;
  }),
  "",
  "## Oxlint diagnostics (warning-only structural guidelines)",
  "",
  "Source complexity >10, source physical lines >200, deterministic test physical lines >500. Existing error rules remain gates. No max-lines-per-function rule.",
  "",
  "```text",
  lint ?? "Lint not run / report unavailable.",
  "```",
  "",
];
if (absent.length || unexpected.length || (lcov && missing.length)) {
  console.warn("::warning::Quality report production/coverage inventory differs; inspect summary.");
}
await mkdir(".test-results", { recursive: true });
const markdown = lines.join("\n");
await writeFile(".test-results/quality-summary.md", markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
