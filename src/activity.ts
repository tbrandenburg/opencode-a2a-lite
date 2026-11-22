import type * as acp from "@agentclientprotocol/sdk";

export interface ToolActivity {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
}

export interface ThoughtActivity {
  thought: string;
}

export type Activity = ToolActivity | ThoughtActivity;

function thoughtOf(update: acp.SessionUpdate): ThoughtActivity | undefined {
  if (update.sessionUpdate !== "agent_thought_chunk") return;
  if (update.content.type !== "text" || !update.content.text) return;
  if (update.content._meta?.["opencode/child-session"] !== undefined) return;
  return { thought: update.content.text };
}

function toolOf(update: acp.SessionUpdate): ToolActivity | undefined {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
  return {
    toolCallId: update.toolCallId,
    ...(update.title ? { title: update.title } : {}),
    ...(update.kind ? { kind: update.kind } : {}),
    ...(update.status ? { status: update.status } : {}),
  };
}

// Tool inputs and outputs never leave the bridge: only identifying fields and thought text do.
export function activityOf(update: acp.SessionUpdate): Activity | undefined {
  return thoughtOf(update) ?? toolOf(update);
}
