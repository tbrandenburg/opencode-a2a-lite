import assert from "node:assert/strict";
import { expect, test } from "bun:test";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";
import { parseTurn } from "../../examples/agent-network/topology-evidence.js";

test("N18 real assertion failures retain an allowlisted source frame without private values", () => {
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
  const untrusted = new Error("private message");
  untrusted.name = "private name";
  untrusted.stack = "private message\n at private (/home/private/provider.ts:123:4)";
  expect(sanitizedFailure(untrusted)).toEqual({
    kind: "unknown",
    frame: null,
    criterion: "runtime-error",
  });
});
