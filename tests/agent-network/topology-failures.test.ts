import assert from "node:assert/strict";
import { expect, test } from "bun:test";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";
import { parseTurn } from "../../examples/agent-network/topology-evidence.js";

test("real envelope assertions retain a bounded repository frame, not assertion values", () => {
  try {
    parseTurn('{"private-answer":"private-provider-diagnostic"}');
    throw new Error("Expected invalid envelope rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(assert.AssertionError);
    const failure = sanitizedFailure(error);
    expect(failure.kind).toBe("AssertionError");
    expect(failure.criterion).toBe("assert:strictEqual");
    expect(failure.frame).toMatch(/^examples\/agent-network\/topology-evidence\.ts:\d+$/);
    expect(JSON.stringify(failure)).not.toMatch(
      /private-answer|private-provider-diagnostic|\/home\//,
    );
  }
});

test("failure metadata rejects arbitrary names, frames, operators, and non-errors", () => {
  const error = new Error("private message");
  error.name = "private name";
  error.stack =
    "private message\n at private (/home/private/provider.ts:123:4)\n at fake (examples/agent-network/private-token.ts:1:2)";
  expect(sanitizedFailure(error)).toEqual({
    kind: "unknown",
    frame: null,
    criterion: "runtime-error",
  });
  const assertion = new assert.AssertionError({
    message: "private",
    actual: "private-answer",
    expected: "other-private",
    operator: "private operator",
  });
  assertion.stack = "private\n at runtime (/any/root/examples/agent-network/topology-run.ts:112:4)";
  expect(sanitizedFailure(assertion)).toEqual({
    kind: "AssertionError",
    frame: "examples/agent-network/topology-run.ts:112",
    criterion: "assert:other",
  });
  expect(sanitizedFailure("private string")).toEqual({
    kind: "unknown",
    frame: null,
    criterion: "runtime-error",
  });
  expect(sanitizedFailure(new SyntaxError("private-json")).criterion).toBe("malformed-json");
});
