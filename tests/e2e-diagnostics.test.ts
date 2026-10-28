import assert from "node:assert/strict";
import { TaskState } from "@a2a-js/sdk";
import { expect, test } from "bun:test";
import {
  cliFailure,
  cliSuccess,
  createDiagnostics,
  diagnostics,
  errorCategory,
  observationDeadline,
  rejected,
  task,
  text,
  withCleanup,
} from "./e2e-support.js";

const secret = "SECRET-provider-answer-credential";
const working = JSON.stringify({
  id: secret,
  contextId: secret,
  status: { state: "TASK_STATE_WORKING" },
  artifacts: [{ artifactId: secret, parts: [{ text: secret }] }],
  unexpected: secret,
});
const empty = {
  criterion: "E2E02.cli",
  lastTaskState: "unknown",
  taskPresent: false,
  contextPresent: false,
  textPresent: false,
  elapsedMs: 0,
  firstObservedTextMs: null,
};

async function caught(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected failure");
}

test("exact-text oracle failure retains finite evidence, not assertion or task values", async () => {
  let now = 100;
  const probe = createDiagnostics(() => now);
  const error = await caught(() =>
    probe.run(async () => {
      probe.at("E2E02.decode");
      const value = task(working.replace("TASK_STATE_WORKING", "TASK_STATE_COMPLETED"));
      now = 112;
      probe.observe(value);
      probe.at("E2E02.exact-text");
      now = 120;
      assert.equal(text(value), "intended-marker");
    }),
  );
  expect(diagnostics(error)).toEqual({
    criterion: "E2E02.exact-text",
    errorCategory: "assertion",
    lastTaskState: "completed",
    taskPresent: true,
    contextPresent: true,
    textPresent: true,
    elapsedMs: 20,
    firstObservedTextMs: 12,
    cleanupErrorCategory: null,
  });
  expect(JSON.stringify(diagnostics(error))).not.toContain(secret);
  const invalid = await caught(() =>
    probe.run(async () => {
      probe.at(secret as Parameters<typeof probe.at>[0]);
    }),
  );
  expect(diagnostics(invalid)).toEqual({
    criterion: "E2E02.exact-text",
    errorCategory: "assertion",
    lastTaskState: "completed",
    taskPresent: true,
    contextPresent: true,
    textPresent: true,
    elapsedMs: 20,
    firstObservedTextMs: 12,
    cleanupErrorCategory: null,
  });
  expect(JSON.stringify(diagnostics(invalid))).not.toContain(secret);
});

test("CLI timeout, numeric exit, decode and unknown stay distinct without error passthrough", async () => {
  const inputs = [
    { code: null, killed: true, signal: "SIGTERM", stdout: secret },
    { code: 7, killed: true, signal: "SIGTERM", stderr: secret },
    { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGTERM", message: secret },
    { code: Infinity, name: secret },
  ];
  expect(inputs.map((input) => errorCategory(cliFailure(input)))).toEqual([
    "cli-timeout",
    "cli-exit",
    "unknown",
    "unknown",
  ]);
  const probe = createDiagnostics(() => 0);
  const error = await caught(() =>
    probe.run(async () => {
      probe.at("E2E02.decode");
      task(`not-json-${secret}`);
    }),
  );
  expect(diagnostics(error)).toEqual({
    ...empty,
    criterion: "E2E02.decode",
    errorCategory: "decode",
    cleanupErrorCategory: null,
  });
  expect(JSON.stringify(diagnostics(error))).not.toContain(secret);
});

test("no-text observation deadline preserves unknown cause and nullable first observation", async () => {
  const probe = createDiagnostics(() => 0);
  const error = await caught(() =>
    probe.run(async () => {
      probe.at("E2E06.first-text");
      probe.observe(
        task(
          JSON.stringify({
            id: secret,
            contextId: secret,
            status: { state: "TASK_STATE_WORKING" },
          }),
        ),
      );
      throw observationDeadline();
    }),
  );
  expect(diagnostics(error)).toEqual({
    ...empty,
    criterion: "E2E06.first-text",
    lastTaskState: "working",
    taskPresent: true,
    contextPresent: true,
    errorCategory: "observation-deadline",
    cleanupErrorCategory: null,
  });
  expect(JSON.stringify(diagnostics(error))).not.toContain(secret);
});

test("unexpected scalar values cannot smuggle diagnostics and elapsed values remain finite", async () => {
  const probe = createDiagnostics(() => NaN);
  const error = await caught(() =>
    probe.run(async () => {
      probe.at("E2E06.handles");
      probe.observe(
        task(JSON.stringify({ id: secret, contextId: secret, status: { state: secret } })),
      );
      throw {
        ...empty,
        criterion: secret,
        errorCategory: secret,
        elapsedMs: secret,
        firstObservedTextMs: secret,
        textPresent: secret,
        message: secret,
      };
    }),
  );
  expect(diagnostics(error)).toEqual({
    ...empty,
    criterion: "E2E06.handles",
    taskPresent: true,
    contextPresent: true,
    errorCategory: "unknown",
    cleanupErrorCategory: null,
  });
  expect(JSON.stringify(diagnostics(error))).not.toContain(secret);
  probe.observe(task(working));
  expect(probe.snapshot()).toEqual({
    ...empty,
    criterion: "E2E06.handles",
    lastTaskState: "working",
    taskPresent: true,
    contextPresent: true,
    textPresent: true,
    firstObservedTextMs: 0,
  });
  expect(JSON.stringify(probe.snapshot())).not.toContain(secret);
});

test("cleanup failure retains primary criterion and also fails after successful operation", async () => {
  const probe = createDiagnostics(() => 0);
  const primary = await caught(() =>
    probe.run(async () => {
      probe.at("E2E02.cli");
      cliSuccess({ code: 9 }, secret);
    }),
  );
  let closed = 0;
  const close = async () => {
    closed++;
    throw new Error(secret);
  };
  const retained = await caught(() =>
    withCleanup(
      () =>
        withCleanup(async () => {
          throw primary;
        }, close),
      close,
    ),
  );
  expect(retained).toBe(primary);
  expect(diagnostics(retained)).toEqual({
    ...empty,
    errorCategory: "cli-exit",
    cleanupErrorCategory: "cleanup",
  });
  const cleanup = await caught(() => withCleanup(async () => "success", close));
  expect(errorCategory(cleanup)).toBe("cleanup");
  expect(closed).toBe(3);
  expect(JSON.stringify(diagnostics(retained))).not.toContain(secret);
});

test("successful wrapper returns original result and expected failed-task rejection stays valid", async () => {
  const probe = createDiagnostics(() => 5);
  const value = task(working);
  let closed = false;
  const result = await withCleanup(
    () =>
      probe.run(async () => {
        probe.at("E2E06.original-working");
        probe.observe(value);
        return value;
      }),
    async () => {
      closed = true;
    },
  );
  expect(result).toBe(value);
  expect(closed).toBe(true);
  const busy = rejected(
    {
      code: 0,
      stdout: JSON.stringify({
        id: secret,
        status: { state: "TASK_STATE_FAILED", message: { parts: [{ text: "Gateway busy" }] } },
      }),
    },
    /Gateway busy/,
  );
  expect(busy.artifacts).toEqual([]);
  expect(probe.snapshot()).toEqual({
    criterion: "E2E06.original-working",
    lastTaskState: "working",
    taskPresent: true,
    contextPresent: true,
    textPresent: true,
    elapsedMs: 0,
    firstObservedTextMs: 0,
  });
  const states: [TaskState, string][] = [
    [TaskState.TASK_STATE_INPUT_REQUIRED, "input-required"],
    [TaskState.TASK_STATE_REJECTED, "rejected"],
    [TaskState.TASK_STATE_AUTH_REQUIRED, "auth-required"],
    [TaskState.TASK_STATE_UNSPECIFIED, "unknown"],
    [TaskState.UNRECOGNIZED, "unknown"],
  ];
  for (const [state, expected] of states) {
    probe.observe({ ...value, status: { state, message: undefined, timestamp: "" } });
    expect(probe.snapshot().lastTaskState).toBe(expected);
  }
});
