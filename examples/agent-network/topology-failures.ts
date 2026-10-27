import assert from "node:assert/strict";

export class SubmissionError extends Error {
  constructor(
    readonly criterion: "submission-missing" | "submission-repeated" | "submission-modified",
  ) {
    super(criterion);
    this.name = "SubmissionError";
  }
}

const files =
  "(?:readiness|profiles|workers|transport|lifecycle|collaborate|guard-task|bridge-proxy|topology-(?:run|runtime|session|stages|evidence|resources|prompts|failures))";
const location = new RegExp(
  `\\bexamples/agent-network/(${files}\\.ts):([1-9]\\d{0,6})(?::[1-9]\\d{0,6})?(?=[:)\\s]|$)`,
);
const operators = new Set([
  "strictEqual",
  "deepStrictEqual",
  "==",
  "!=",
  "===",
  "!==",
  "ok",
  "fail",
]);

// Stack text and exception messages may contain private data: retain only a
// bounded, allowlisted repository location and a finite criterion identifier.
export function sanitizedFailure(error: unknown) {
  const frame =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .slice(1, 21)
          .map((line) => location.exec(line))
          .find(Boolean)
      : undefined;
  const assertion = error instanceof assert.AssertionError;
  const kind =
    error instanceof SubmissionError
      ? "SubmissionError"
      : assertion
        ? "AssertionError"
        : error instanceof SyntaxError
          ? "SyntaxError"
          : error instanceof Error && ["TimeoutError", "AbortError", "Error"].includes(error.name)
            ? error.name
            : "unknown";
  const criterion =
    error instanceof SubmissionError
      ? error.criterion
      : assertion
        ? `assert:${operators.has(error.operator) ? error.operator : "other"}`
        : kind === "SyntaxError"
          ? "malformed-json"
          : kind === "TimeoutError"
            ? "deadline"
            : kind === "AbortError"
              ? "interrupted"
              : "runtime-error";
  return {
    kind,
    frame: frame ? `examples/agent-network/${frame[1]}:${frame[2]}` : null,
    criterion,
  };
}
