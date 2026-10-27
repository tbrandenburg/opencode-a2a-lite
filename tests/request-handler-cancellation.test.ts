import { expect, test } from "bun:test";
import { TaskState } from "@a2a-js/sdk";
import { TaskNotCancelableError, TaskNotFoundError } from "@a2a-js/sdk/errors";
import { cancellationProbe, params, parts, until } from "./fixtures/sdk-cancellation.js";

const chunks = ["A", "B", "B", ""];
const scenarios = [
  { id: "C01", mode: "stream", state: TaskState.TASK_STATE_CANCELED },
  { id: "C02", mode: "blocking", state: TaskState.TASK_STATE_COMPLETED },
  { id: "C03", mode: "nonblocking", state: TaskState.TASK_STATE_FAILED },
];

test.each(scenarios)(
  "$id $mode cancellation preserves appends and terminal truth",
  async ({ mode, state }) => {
    const probe = cancellationProbe();
    const request = params(mode === "nonblocking");
    const sending =
      mode === "stream"
        ? probe.consume(probe.handler.sendMessageStream(request, probe.context))
        : probe.handler.sendMessage(request, probe.context);
    await probe.started;
    await probe.ready();
    const cancellations = [
      probe.cancel().catch((error: unknown) => error),
      probe.cancel().catch((error: unknown) => error),
    ];
    await probe.waitCancels(2);
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
  },
);

test("C05 explicit generator return removes the original persistence owner", async () => {
  const probe = cancellationProbe();
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
  expect(result).toBeInstanceOf(TaskNotCancelableError);
  expect(stored.status?.state).toBe(TaskState.TASK_STATE_WORKING);
  expect(parts(stored)).toEqual(["A"]);
});

test("C06 hung cancellation is bounded without inventing terminal state", async () => {
  const probe = cancellationProbe("hang");
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
});
