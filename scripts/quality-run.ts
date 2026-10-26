import { mkdir, rm, writeFile } from "node:fs/promises";

const mode = process.argv[2];
if (mode !== "test" && mode !== "lint") throw new Error("Expected test or lint");
await mkdir(".test-results", { recursive: true });
if (mode === "test") {
  await Promise.all(
    ["coverage/lcov.info", ".test-results/junit.xml", ".test-results/test.json"].map((path) =>
      rm(path, { force: true }),
    ),
  );
}
const command =
  mode === "test" ? [process.execPath, "test", "./tests"] : ["node_modules/.bin/oxlint", "."];
const started = performance.now();
const child = Bun.spawn([...command, ...process.argv.slice(3)], {
  stdout: mode === "lint" ? "pipe" : "inherit",
  stderr: mode === "lint" ? "pipe" : "inherit",
});
const output =
  mode === "lint"
    ? await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
    : [];
const exit = await child.exited;
const seconds = (performance.now() - started) / 1_000;
if (mode === "lint") {
  const text = output.join("");
  process.stdout.write(text);
  await writeFile(".test-results/lint.txt", text);
}
await writeFile(`.test-results/${mode}.json`, JSON.stringify({ exit, seconds }, null, 2) + "\n");
console.log(`${mode}: exit ${exit}; whole-process wall time ${seconds.toFixed(3)}s`);
process.exit(exit);
