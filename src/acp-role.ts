import * as acp from "@agentclientprotocol/sdk";
import { StartupError } from "./startup-error.js";

export function verifyMode(
  options: acp.SessionConfigOption[] | null | undefined,
  agent: string,
  selected = false,
) {
  const modes = (options ?? []).filter((option) => option.id === "mode");
  if (modes.length !== 1) throw new StartupError("role");
  const mode = modes[0]!;
  if (mode.type !== "select") throw new StartupError("role");
  const choices = mode.options.flatMap((option) => ("group" in option ? option.options : [option]));
  if (
    !choices.some((option) => option.value === agent) ||
    (selected && mode.currentValue !== agent)
  )
    throw new StartupError("role");
}

export async function selectNativeRole(
  connection: acp.ClientConnection,
  response: acp.NewSessionResponse,
  agent: string,
) {
  verifyMode(response.configOptions, agent);
  const selected = await connection.agent.request(acp.methods.agent.session.setConfigOption, {
    sessionId: response.sessionId,
    configId: "mode",
    value: agent,
  });
  verifyMode(selected.configOptions, agent, true);
  return { ...response, configOptions: selected.configOptions };
}
