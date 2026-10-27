import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { record, tools } from "./profiles.js";
import { mcp, payloadText } from "./transport.js";
import { createTaskClient } from "./task-client.js";
import type { Worker } from "./workers.js";

type Connection = Awaited<ReturnType<typeof mcp>>;
export function task(value: unknown) {
  const result = record(value);
  return record(result.task ?? result);
}
export function state(value: unknown) {
  return record(task(value).status).state;
}

export async function interoperability(connection: Connection, workers: Worker[]) {
  const catalog = await connection.client.listTools();
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), [...tools].sort());
  const peers = await connection.call("a2a_list_agents", {});
  assert(Array.isArray(peers));
  for (const worker of workers) {
    const peer: Record<string, unknown> | undefined = peers
      .map(record)
      .find((entry) => entry.url === worker.url);
    assert(peer);
    assert.equal(record(peer.card).name, worker.id);
  }
  const planner = workers[0]!;
  const reviewer = workers[1]!;
  const marker = `continuity-${randomUUID()}`;
  const client = createTaskClient(connection, planner.url);
  const options = { deadline: performance.now() + 90_000 };
  const submitted = await client.submit(
    `Remember acceptance token ${marker}. Reply only with the exact token.`,
    options,
  );
  assert(submitted.outcome !== "uncertain", "Submission uncertain; do not retry");
  const first = await client.wait(submitted, options);
  assert.equal(first.outcome, "completed");
  assert.equal(payloadText(first.task), marker);
  const followOptions = { deadline: performance.now() + 90_000 };
  const continued = await client.submit(
    "Recall the acceptance token from my earlier message. Reply only with the exact token.",
    followOptions,
    first.handle,
  );
  assert(continued.outcome !== "uncertain", "Continuation uncertain; do not retry");
  const followup = await client.wait(continued, followOptions);
  assert.equal(followup.outcome, "completed");
  assert.equal(payloadText(followup.task), marker);
  assert.equal(followup.handle.contextId, first.handle.contextId);
  assert.notEqual(followup.handle.taskId, first.handle.taskId);
  const streamMarker = `stream-${randomUUID()}`;
  const events = await connection.call(
    "a2a_send_streaming",
    {
      peer_url: reviewer.url,
      text: `Reply only with the exact acceptance token ${streamMarker}.`,
      timeout_s: 120,
    },
    false,
    { deadline: performance.now() + 120_000 },
  );
  assert(Array.isArray(events));
  const updates = events.map(record);
  assert(
    updates.some((event) =>
      event.statusUpdate
        ? record(record(event.statusUpdate).status).state === "TASK_STATE_COMPLETED"
        : false,
    ),
  );
  const streamed = updates
    .filter((event) => event.artifactUpdate)
    .map((event) => payloadText({ artifacts: [record(event.artifactUpdate).artifact] }))
    .join("");
  assert.equal(streamed, streamMarker);
  const unknown = await connection.call(
    "a2a_get_task",
    { peer_url: planner.url, task_id: randomUUID() },
    true,
  );
  assert.match(String(unknown), /not found|not exist/i);
  await connection.call(
    "a2a_get_task",
    { peer_url: "http://127.0.0.1:1/", task_id: "missing" },
    true,
  );
  await connection.call("a2a_complete_task", { task_id: "missing", text: "not allowed" }, true);
  return {
    discovery: true,
    exactStreaming: true,
    returnedContextContinuity: true,
    negativeCases: 3,
  };
}

export async function cancellation(connection: Connection, workers: Worker[]) {
  const planner = workers[0]!;
  const reviewer = workers[1]!;
  const client = createTaskClient(connection, planner.url);
  const options = { deadline: performance.now() + 90_000 };
  const active = await client.submit(
    "Lifecycle probe: write an original story of at least 8000 words. Start immediately. Do not stop early or use tools.",
    options,
  );
  assert(active.outcome !== "uncertain", "Submission uncertain; do not retry");
  const partial = await client.wait(active, {
    ...options,
    stopWhen: (current) => !!payloadText(current.task),
  });
  assert.equal(partial.outcome, "pending", "Long task ended before intervention");
  assert(payloadText(partial.task), "No real text before cancellation");
  const get = () => client.get(active.handle, { deadline: performance.now() + 10_000 });
  const busy = task(
    await connection.call("a2a_send_message", {
      peer_url: planner.url,
      text: "Reply only BUSY-MUST-NOT-RUN.",
      blocking: true,
    }),
  );
  assert.equal(state(busy), "TASK_STATE_FAILED");
  assert.equal(payloadText(busy), "");
  const other = task(
    await connection.call("a2a_send_message", {
      peer_url: reviewer.url,
      text: "Reply only with the exact acceptance token OTHER-WORKER-AVAILABLE.",
      blocking: true,
    }),
  );
  assert.equal(payloadText(other), "OTHER-WORKER-AVAILABLE");
  assert.equal((await get()).outcome, "pending");
  const canceled = await client.cancel(active.handle, { deadline: performance.now() + 10_000 });
  assert.equal(canceled.outcome, "canceled");
  const stored = await get();
  assert.equal(stored.outcome, "canceled");
  assert(payloadText(stored.task).length > 0);
  return { actualCancellation: true, busyRejected: true, independentWorkerAvailable: true };
}
