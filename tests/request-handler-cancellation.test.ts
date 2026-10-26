import { expect, test } from "bun:test";
import { TaskState } from "@a2a-js/sdk";
import { TaskNotCancelableError, TaskNotFoundError } from "@a2a-js/sdk/errors";
import { cancellationProbe, params, parts, until } from "./fixtures/sdk-cancellation.js";

const chunks = ["A", "B", "B", ""];
const states = [
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
];
const scenarios = ["stream", "blocking", "nonblocking"].flatMap((mode) =>
  [0, 1, 2].flatMap((count) => states.map((state) => ({ mode, count, state }))),
);

test.each(scenarios)("wrapper preserves exact appends: %j", async ({ mode, count, state }) => {
  const probe = cancellationProbe();
  const request = params(mode === "nonblocking");
  const sending =
    mode === "stream"
      ? probe.consume(probe.handler.sendMessageStream(request, probe.context))
      : probe.handler.sendMessage(request, probe.context);
  await probe.started;
  await probe.ready();
  const cancellations = Array.from({ length: count }, () =>
    probe.cancel().catch((error: unknown) => error),
  );
  await probe.waitCancels(count);
  probe.settle(state);
  const results = await Promise.all(cancellations);
  await sending;
  await until(async () => (await probe.snapshot()).status?.state === state);
  const stored = await probe.snapshot();
  expect(parts(stored)).toEqual(chunks);
  expect(stored.status?.state).toBe(state);
  for (const result of results) {
    if (state === TaskState.TASK_STATE_CANCELED)
      expect(result).toMatchObject({ status: { state } });
    else expect(result).toBeInstanceOf(TaskNotCancelableError);
  }
  if (mode === "stream") {
    const updates = probe.events.flatMap((event) =>
      event.payload?.$case === "artifactUpdate" ? [event.payload.value] : [],
    );
    expect(updates.map((update) => update.artifact?.parts[0]?.content)).toEqual(
      chunks.map((value) => ({ $case: "text", value })),
    );
    expect(updates.map((update) => [update.append, update.lastChunk])).toEqual([
      [false, false],
      [true, false],
      [true, false],
      [true, true],
    ]);
  }
  if (state === TaskState.TASK_STATE_CANCELED) {
    expect(parts(await probe.cancel())).toEqual(chunks);
  } else {
    await expect(probe.cancel()).rejects.toBeInstanceOf(TaskNotCancelableError);
  }
});

test.each([1, 2])(
  "stock SDK 1.3.0 reproduces %i extra append consumers (known defect)",
  async (count) => {
    const probe = cancellationProbe(true);
    const sending = probe.consume(probe.handler.sendMessageStream(params(), probe.context));
    await probe.started;
    await probe.ready();
    const cancellations = Array.from({ length: count }, () => probe.cancel());
    await probe.waitCancels(count);
    probe.settle();
    await Promise.all([sending, ...cancellations]);
    expect(parts(await probe.snapshot())).toEqual([
      "A",
      ...["B", "B", ""].flatMap((text) => Array(count + 1).fill(text)),
    ]);
    expect((await probe.snapshot()).status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(probe.events.filter((event) => event.payload?.$case === "artifactUpdate")).toHaveLength(
      4,
    );
  },
);

test.each([false, true])(
  "explicit generator return removes original persistence owner; stock=%s",
  async (stock) => {
    const probe = cancellationProbe(stock);
    const stream = probe.handler.sendMessageStream(params(), probe.context);
    while (true) {
      const item = await stream.next();
      if (item.done) throw new Error("Stream ended before initial artifact");
      if (item.value.payload?.$case === "artifactUpdate") break;
    }
    await stream.return();
    const cancellation = probe.cancel().catch((error: unknown) => error);
    await probe.waitCancels(1);
    probe.settle();
    const result = await cancellation;
    const stored = await probe.snapshot();
    if (stock) {
      expect(result).toMatchObject({ status: { state: TaskState.TASK_STATE_CANCELED } });
      expect(parts(stored)).toEqual(chunks);
    } else {
      expect(result).toBeInstanceOf(TaskNotCancelableError);
      expect(stored.status?.state).toBe(TaskState.TASK_STATE_WORKING);
      expect(parts(stored)).toEqual(["A"]);
    }
  },
);

test("paused public generator retains queued events but cancellation needs its owner to resume", async () => {
  const probe = cancellationProbe();
  const stream = probe.handler.sendMessageStream(params(), probe.context);
  while (true) {
    const item = await stream.next();
    if (item.done) throw new Error("Stream ended before initial artifact");
    if (item.value.payload?.$case === "artifactUpdate") break;
  }
  const cancellation = probe.cancel();
  await probe.waitCancels(1);
  probe.settle();
  expect(parts(await probe.snapshot())).toEqual(["A"]);
  expect((await probe.snapshot()).status?.state).toBe(TaskState.TASK_STATE_WORKING);
  await probe.consume(stream);
  expect(parts(await cancellation)).toEqual(chunks);
  expect((await probe.snapshot()).status?.state).toBe(TaskState.TASK_STATE_CANCELED);
});

test.each(["throw", "hang"] as const)(
  "wrapper bounds %s cancellation without inventing terminal state",
  async (failure) => {
    const probe = cancellationProbe(false, failure);
    const sending = probe.consume(probe.handler.sendMessageStream(params(), probe.context));
    await probe.started;
    await probe.ready();
    await expect(
      probe.handler.cancelTask({ id: "missing", tenant: "", metadata: undefined }, probe.context),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    const start = performance.now();
    const result = await probe.cancel().catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Error);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect((await probe.snapshot()).status?.state).toBe(TaskState.TASK_STATE_WORKING);
    probe.settle(TaskState.TASK_STATE_COMPLETED);
    await sending;
    expect(parts(await probe.snapshot())).toEqual(chunks);
    expect((await probe.snapshot()).status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  },
);
