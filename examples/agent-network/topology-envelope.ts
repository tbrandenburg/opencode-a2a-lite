import { createHash } from "node:crypto";
import { isRecord, ITEM_IDS } from "./topology-workloads.js";

export const envelopeFields = [
  "instructions",
  "stepId",
  "role",
  "roleInstructions",
  "marker",
  "final",
  "inputHashes",
  "inbound",
  "privateFacts",
] as const;
export interface EnvelopeMetadata {
  readonly kind: "known" | "invalid" | "text";
  readonly rawHash: string;
  readonly contract?: "topology-envelope-v1";
  readonly digest?: string;
  readonly fields?: Readonly<Record<string, string>>;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const encoded = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(encoded).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encoded(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const keys = (value: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(value).sort().join() === [...names].sort().join();
const item = (value: unknown) => ITEM_IDS.some((id) => id === value);
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
function fact(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (value.kind === "item")
    return (
      keys(value, ["id", "kind", "item", "cost", "value"]) &&
      item(value.item) &&
      integer(value.cost) &&
      integer(value.value)
    );
  if (value.kind === "bounds")
    return (
      keys(value, ["id", "kind", "minCost", "capacity"]) &&
      integer(value.minCost) &&
      value.minCost === 0 &&
      integer(value.capacity)
    );
  if (value.kind === "dependency")
    return (
      keys(value, ["id", "kind", "item", "requires"]) && item(value.item) && item(value.requires)
    );
  return (
    value.kind === "incompatibility" &&
    keys(value, ["id", "kind", "left", "right"]) &&
    item(value.left) &&
    item(value.right)
  );
}

// JSON.parse alone silently accepts duplicate keys. Scan syntax tokens (never
// string contents) first; input bytes, nesting and token count are bounded.
function unambiguous(text: string): boolean {
  const tokens: string[] = [];
  const lexer =
    /[ \t\r\n]+|"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  while (lexer.lastIndex < text.length) {
    const match = lexer.exec(text);
    if (!match) return false;
    if (/^[ \t\r\n]/.test(match[0])) continue;
    if (tokens.length === 4096) return false;
    tokens.push(match[0]);
  }
  if (!tokens.length) return false;
  const stack: Set<string>[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "{" || token === "[") stack.push(new Set());
    if (stack.length > 8) return false;
    if (token === "}" || token === "]") stack.pop();
    if (tokens[index + 1] !== ":") continue;
    if (!token.startsWith('"')) return false;
    const key: unknown = JSON.parse(token);
    const seen = stack.at(-1);
    if (typeof key !== "string" || !seen || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function envelopeMetadata(text: string): EnvelopeMetadata {
  const rawHash = hash(text);
  if (!/^\s*(?:\{|\[)/.test(text)) return { kind: "text", rawHash };
  const invalid = { kind: "invalid", rawHash } as const;
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) return invalid;
  try {
    if (!unambiguous(text)) return invalid;
    const value: unknown = JSON.parse(text);
    if (
      !isRecord(value) ||
      !keys(
        value,
        envelopeFields.filter((key) => key !== "privateFacts" || Object.hasOwn(value, key)),
      )
    )
      return invalid;
    if (
      !["instructions", "stepId", "role", "roleInstructions", "marker"].every(
        (key) => typeof value[key] === "string",
      ) ||
      typeof value.final !== "boolean"
    )
      return invalid;
    if (
      !isRecord(value.inputHashes) ||
      !isRecord(value.inbound) ||
      !keys(value.inputHashes, Object.keys(value.inbound))
    )
      return invalid;
    if (
      !Object.values(value.inputHashes).every(
        (entry) => typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry),
      ) ||
      !Object.values(value.inbound).every((entry) => typeof entry === "string")
    )
      return invalid;
    if (
      Object.hasOwn(value, "privateFacts") &&
      (!Array.isArray(value.privateFacts) ||
        value.privateFacts.length > 11 ||
        !value.privateFacts.every(fact))
    )
      return invalid;
    return {
      kind: "known",
      contract: "topology-envelope-v1",
      rawHash,
      digest: hash(encoded(value)),
      fields: Object.fromEntries(
        envelopeFields
          .filter((key) => Object.hasOwn(value, key))
          .map((key) => [key, hash(encoded(value[key]))]),
      ),
    };
  } catch {
    return invalid;
  }
}

export function equivalentInput(
  expected: EnvelopeMetadata,
  rawHash: unknown,
  observed?: unknown,
): boolean {
  if (expected.kind === "invalid") return false;
  if (expected.rawHash === rawHash) return true;
  return (
    expected.kind === "known" &&
    expected.contract === "topology-envelope-v1" &&
    isRecord(observed) &&
    observed.kind === "known" &&
    observed.contract === expected.contract &&
    observed.rawHash === rawHash &&
    observed.digest === expected.digest
  );
}

export function inputDifference(expected: EnvelopeMetadata, rawHash: unknown, observed: unknown) {
  const fields = isRecord(observed) && isRecord(observed.fields) ? observed.fields : {};
  return {
    expectedRawHash: expected.rawHash,
    observedRawHash: typeof rawHash === "string" && /^[a-f0-9]{64}$/.test(rawHash) ? rawHash : null,
    encodingOnly: expected.rawHash !== rawHash && equivalentInput(expected, rawHash, observed),
    changedFields: envelopeFields.filter((key) => expected.fields?.[key] !== fields[key]),
    malformedEnvelope:
      expected.kind === "invalid" || (isRecord(observed) && observed.kind === "invalid"),
  };
}
