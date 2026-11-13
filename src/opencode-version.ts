const stable = /^opencode v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const floor = [2, 2, 7] as const;

export function supportedOpenCode(output: string): boolean {
  const match = stable.exec(output);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (const [index, minimum] of floor.entries()) {
    const part = parts[index] ?? 0;
    if (part !== minimum) return part > minimum;
  }
  return true;
}
