import { expect, test } from "bun:test";
import { parseIdentity, validateIdentity, type WorkerIdentity } from "../src/identity.js";
import { createGateway } from "../src/server.js";
import { StartupError } from "../src/startup-error.js";

test("normalizes bounded identity and copies tags without changing caller data", () => {
  const tags = [" planner ", "text", "planner", "Planner"];
  const identity = validateIdentity({ name: " planner ", description: " plans ", tags });
  expect(identity).toEqual({
    name: "planner",
    description: "plans",
    tags: ["planner", "text", "Planner"],
  });
  expect(tags).toEqual([" planner ", "text", "planner", "Planner"]);
  expect(validateIdentity()).toEqual({});
  expect(parseIdentity({})).toBeUndefined();
});

test("accepts exact limits and empty API tag lists", () => {
  const identity = {
    name: "n".repeat(128),
    description: "d".repeat(1024),
    tags: Array.from({ length: 16 }, (_, index) => String(index).padEnd(64, "t")),
  };
  expect(validateIdentity(identity)).toEqual(identity);
  expect(validateIdentity({ tags: [] })).toEqual({ tags: [] });
});

const invalid: unknown[] = [
  null,
  "private-marker",
  [],
  { name: "" },
  { name: "   " },
  { name: "n".repeat(129) },
  { name: 7 },
  { description: "" },
  { description: "d".repeat(1025) },
  { tags: "private-marker" },
  { tags: [""] },
  { tags: [" "] },
  { tags: [null] },
  { tags: ["t".repeat(65)] },
  { tags: Array(17).fill("duplicate") },
  ...["\n", "\t", "\r", "\u0000", "\u007f", "\u0085"].flatMap((control) => [
    { name: `private-marker${control}` },
    { description: `${control}private-marker` },
    { tags: [`private-marker${control}`] },
  ]),
];

test.each(invalid.map((identity, index) => ({ identity, index })))(
  "rejects malformed API identity $index before workspace/ACP construction without reflecting input",
  ({ identity }) => {
    const construct = () =>
      createGateway({ workspace: "relative", identity: identity as WorkerIdentity });
    expect(construct).toThrow(StartupError);
    expect(construct).toThrow("Invalid worker identity");
    try {
      construct();
    } catch (error) {
      expect(String(error)).not.toContain("private-marker");
    }
  },
);

test.each(["", " ", ",", "planner,", ",planner", "planner,,reviewer", "planner,\nreviewer"])(
  "rejects blank/control-containing comma fields %j",
  (tags) => {
    expect(() => parseIdentity({ A2A_TAGS: tags })).toThrow(StartupError);
    expect(() => parseIdentity({ A2A_TAGS: tags })).toThrow("Invalid worker identity");
  },
);
