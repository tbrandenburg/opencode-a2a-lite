import assert from "node:assert/strict";

export class SubmissionError extends Error {
  constructor(
    readonly criterion:
      | "submission-missing"
      | "submission-repeated"
      | "submission-modified"
      | "submission-binding",
    readonly mismatch?: ReturnType<typeof import("./topology-envelope.js").inputDifference>,
  ) {
    super(criterion);
    this.name = "SubmissionError";
  }
}

export class ContributionError extends Error {
  constructor(
    readonly counts: { missing: number; extra: number; changed: number; repeated: number },
    readonly identifiers: readonly string[],
  ) {
    super("Missing or conflicting contribution");
    this.name = "ContributionError";
  }
}

const files =
  "(?:readiness|profiles|workers|transport|lifecycle|collaborate|guard-task|bridge-proxy|topology-(?:run|runtime|session|stages|evidence|resources|prompts|failures))";
const location = new RegExp(
  `^[ \\t]+at [^\\n]*?\\bexamples/agent-network/(${files}\\.ts):([1-9]\\d{0,6})(?::[1-9]\\d{0,6})?(?=[:)\\s]|$)`,
  "m",
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
  const frame = error instanceof Error ? location.exec(error.stack ?? "") : undefined;
  const assertion = error instanceof assert.AssertionError;
  const kind =
    error instanceof SubmissionError
      ? "SubmissionError"
      : error instanceof ContributionError
        ? "ContributionError"
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
      : error instanceof ContributionError
        ? "contribution-mismatch"
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
    ...(error instanceof SubmissionError && error.mismatch ? { mismatch: error.mismatch } : {}),
    ...(error instanceof ContributionError
      ? { contributions: { ...error.counts, identifiers: error.identifiers } }
      : {}),
  };
}
