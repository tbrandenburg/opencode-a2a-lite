import { expect, test } from "bun:test";
import { parseIdentity, validateIdentity, type WorkerIdentity } from "../src/identity.js";
import { createGateway } from "../src/server.js";
import { StartupError } from "../src/startup-error.js";

test("I1: normalizes copied identity data and accepts exact field limits", () => {
  const tags = [" planner ", "text", "planner", "Planner"];
  expect(validateIdentity({ name: " planner ", description: " plans ", tags })).toEqual({
    name: "planner",
    description: "plans",
    tags: ["planner", "text", "Planner"],
  });
  expect(tags).toEqual([" planner ", "text", "planner", "Planner"]);
  const bounded = {
    name: "n".repeat(128),
    description: "d".repeat(1024),
    tags: Array.from({ length: 16 }, (_, index) => String(index).padEnd(64, "t")),
  };
  expect(validateIdentity(bounded)).toEqual(bounded);
  expect(validateIdentity({ tags: [] })).toEqual({ tags: [] });
  expect(validateIdentity()).toEqual({});
  expect(parseIdentity({})).toBeUndefined();
});

test("I2: each identity field enforces its own bound before tag deduplication", () => {
  expect(() => validateIdentity({ name: "n".repeat(129) })).toThrow(StartupError);
  expect(() => validateIdentity({ description: "d".repeat(1025) })).toThrow(StartupError);
  expect(() => validateIdentity({ tags: ["t".repeat(65)] })).toThrow(StartupError);
  expect(() => validateIdentity({ tags: Array(17).fill("duplicate") })).toThrow(StartupError);
});

test("I3: runtime identity, tag container and tag element types are validated", () => {
  expect(() => validateIdentity(null as unknown as WorkerIdentity)).toThrow(StartupError);
  expect(() => validateIdentity({ tags: "private-marker" } as unknown as WorkerIdentity)).toThrow(
    StartupError,
  );
  expect(() => validateIdentity({ tags: [null] } as unknown as WorkerIdentity)).toThrow(
    StartupError,
  );
});

test("I4: controls fail sanitized gateway validation before workspace/ACP construction", () => {
  const construct = () =>
    createGateway({ workspace: "relative", identity: { name: "private-marker\u0085" } });
  expect(construct).toThrow(StartupError);
  expect(construct).toThrow("Invalid worker identity");
  expect(construct).not.toThrow("private-marker");
  expect(() => parseIdentity({ A2A_TAGS: "planner,,reviewer" })).toThrow("Invalid worker identity");
});
