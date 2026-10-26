import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("../scripts/demo-stream.jq", import.meta.url));
const identity = { taskId: "task-one", contextId: "context-one" };
const status = (state: string) => ({ statusUpdate: { ...identity, status: { state } } });
const chunk = (text: string, append: boolean, lastChunk = false) => ({
  artifactUpdate: {
    ...identity,
    artifact: { artifactId: "artifact-one", parts: [{ text }] },
    append,
    lastChunk,
  },
});
function events() {
  return [
    {
      task: {
        id: identity.taskId,
        contextId: identity.contextId,
        status: { state: "TASK_STATE_SUBMITTED" },
      },
    },
    status("TASK_STATE_WORKING"),
    chunk("demo-", false),
    chunk("marker", true),
    chunk("", true, true),
    status("TASK_STATE_COMPLETED"),
  ];
}
function verify(input: unknown[]) {
  return spawnSync("jq", ["-es", "--arg", "marker", "demo-marker", "-f", verifier], {
    input: input.map((event) => JSON.stringify(event)).join("\n"),
    encoding: "utf8",
    timeout: 5_000,
  });
}

test("aggregates split text and returns identifiers from the initial real event shape", () => {
  const result = verify(events());
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ ...identity, chunks: 3 });
});

test("rejects corrupt IDs, append order, artifact identity, lifecycle, and marker text", () => {
  const invalid: unknown[][] = [
    [],
    events().slice(1),
    events().filter((_, index) => index !== 1),
    [...events(), status("TASK_STATE_COMPLETED")],
    [...events().slice(0, -1), status("TASK_STATE_FAILED")],
    [...events(), { unexpected: {} }],
    events().map((event, index) => (index === 3 ? chunk("wrong-marker", true) : event)),
    events().map((event, index) => (index === 3 ? chunk("marker", false) : event)),
    events().map((event, index) => (index === 4 ? chunk("", true, false) : event)),
    events().map((event, index) =>
      index === 3
        ? { artifactUpdate: { ...chunk("marker", true).artifactUpdate, taskId: "wrong-task" } }
        : event,
    ),
    events().map((event, index) =>
      index === 3
        ? {
            artifactUpdate: { ...chunk("marker", true).artifactUpdate, contextId: "wrong-context" },
          }
        : event,
    ),
    events().map((event, index) =>
      index === 3
        ? {
            artifactUpdate: {
              ...chunk("marker", true).artifactUpdate,
              artifact: { artifactId: "changed", parts: [{ text: "marker" }] },
            },
          }
        : event,
    ),
  ];
  for (const input of invalid) {
    const result = verify(input);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  }
});
