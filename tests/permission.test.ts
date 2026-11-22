import { expect, test } from "bun:test";
import type { Part } from "@a2a-js/sdk";
import { createPermissionDesk } from "../src/permission-desk.js";
import { decide, offeredOptions, parseAnswer } from "../src/permission.js";

const options = [
  { optionId: "once", kind: "allow_once" },
  { optionId: "always", kind: "allow_always" },
  { optionId: "no", kind: "reject_once" },
];
const text = (value: string): Part => ({
  content: { $case: "text", value },
  mediaType: "text/plain",
  filename: "",
  metadata: undefined,
});
const data = (value: unknown): Part => ({
  content: { $case: "data", value },
  mediaType: "application/json",
  filename: "",
  metadata: undefined,
});

test("P1: allow_always is never offered and never selectable", () => {
  expect(offeredOptions(options).map((option) => option.optionId)).toEqual(["once", "no"]);
  expect(decide(options, "always")).toEqual({ outcome: "selected", optionId: "no", denied: true });
  expect(decide(options, "once")).toEqual({ outcome: "selected", optionId: "once", denied: false });
  expect(decide(options, "no")).toEqual({ outcome: "selected", optionId: "no", denied: true });
  expect(decide(options, "unknown")).toMatchObject({ optionId: "no", denied: true });
  expect(decide(options, undefined)).toMatchObject({ optionId: "no", denied: true });
  expect(decide([{ optionId: "once", kind: "allow_once" }], undefined)).toEqual({
    outcome: "cancelled",
    denied: true,
  });
});

test("P2: answers must quote the request id and an offered option", () => {
  const answer = (optionId: string, requestId = "r1") =>
    parseAnswer([data({ permissionResponse: { requestId, optionId } })], "r1", options);
  expect(answer("once")).toEqual({ optionId: "once" });
  expect(answer("no")).toEqual({ optionId: "no" });
  expect(answer("always")).toEqual({ error: "The option is not offered" });
  expect(answer("once", "stale")).toEqual({ error: "The permission request id does not match" });
  expect(parseAnswer([data({ permissionResponse: { optionId: "once" } })], "r1", options)).toEqual({
    error: "The permission request id does not match",
  });
});

test("P3: plain text answers map only allow and reject words", () => {
  expect(parseAnswer([text(" Allow ")], "r1", options)).toEqual({ optionId: "once" });
  expect(parseAnswer([text("DENY")], "r1", options)).toEqual({ optionId: "no" });
  expect(parseAnswer([text("allow always")], "r1", options)).toEqual({
    error: "Unrecognized answer",
  });
  expect(parseAnswer([text("")], "r1", options)).toEqual({ error: "Unrecognized answer" });
  expect(parseAnswer([text("allow")], "r1", [{ optionId: "no", kind: "reject_once" }])).toEqual({
    error: "Unrecognized answer",
  });
});

test("P4: the desk accepts one answer, times out, and forgets released requests", async () => {
  const desk = createPermissionDesk(40);
  const finished = Promise.resolve();
  const first = desk.open("task", options, finished);
  expect(desk.pending("task")).toBe(first);
  first.settle("once");
  first.settle("no");
  expect(await first.answer).toBe("once");
  expect(desk.pending("task")).toBeUndefined();
  const slow = desk.open("task", options, finished);
  expect(await slow.answer).toBeUndefined();
  expect(desk.pending("task")).toBeUndefined();
  const released = desk.open("other", options, finished);
  desk.release("other");
  expect(await released.answer).toBeUndefined();
  expect(desk.pending("other")).toBeUndefined();
});
