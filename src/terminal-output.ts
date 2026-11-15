const statusWidth = 10;
const accent = "\u001b[1;36m";
const reset = "\u001b[0m";

export function formatStatus(label: string, detail: string, color: boolean): string {
  const status = label.padEnd(statusWidth);
  return color ? `  ${accent}${status}${reset} ${detail}` : `  ${status} ${detail}`;
}

export function supportsTerminalColor(
  stream: Pick<NodeJS.WriteStream, "isTTY">,
  env: NodeJS.ProcessEnv,
) {
  return Boolean(stream.isTTY && env.NO_COLOR === undefined && env.TERM !== "dumb");
}
