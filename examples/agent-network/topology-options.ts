import { CASE_MATRIX } from "./topology-cases.js";
import { validateControls } from "./topology-runtime.js";

export function investigationOptions(args: readonly string[]) {
  const flags = new Set(["--live", "--list", "--faults", "--allow-cancel"]);
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (flags.has(key)) {
      if (switches.has(key)) throw new Error("Duplicate flag");
      switches.add(key);
      continue;
    }
    if (!["--case", "--variant", "--case-ms", "--turn-ms"].includes(key))
      throw new Error("Unknown option");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("Missing option value");
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  if (!switches.has("--list") && !switches.has("--live") && !switches.has("--faults"))
    throw new Error("Explicit --live or --faults required; --list is provider-free");
  if (switches.has("--faults") && !switches.has("--allow-cancel"))
    throw new Error("Controlled fixtures include explicit remote cancel; add --allow-cancel");
  const cases = values.get("--case") ?? [];
  const variants = values.get("--variant") ?? [];
  if (new Set(cases).size !== cases.length || new Set(variants).size !== variants.length)
    throw new Error("Duplicate selection");
  if (
    cases.some((id) => !CASE_MATRIX.some((test) => test.id === id)) ||
    variants.some((id) => !["V1", "V2", "V3"].includes(id))
  )
    throw new Error("Unknown selection");
  const selected = CASE_MATRIX.filter(
    (test) =>
      (!cases.length || cases.includes(test.id)) &&
      (!variants.length || variants.includes(test.variant)),
  );
  if (!selected.length || cases.some((id) => !selected.some((test) => test.id === id)))
    throw new Error("Selection conflicts or selects no cases");
  const number = (key: string, fallback: number) => {
    const found = values.get(key);
    if (found && (found.length !== 1 || !/^\d+$/.test(found[0]!)))
      throw new Error("Invalid deadline");
    return found ? Number(found[0]) : fallback;
  };
  const limits = validateControls({
    optIn: true,
    caseMs: number("--case-ms", 900_000),
    turnMs: number("--turn-ms", 180_000),
  });
  return {
    list: switches.has("--list"),
    live: switches.has("--live"),
    faults: switches.has("--faults"),
    selected,
    ...limits,
  };
}
