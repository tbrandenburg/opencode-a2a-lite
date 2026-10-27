import { StartupError } from "./startup-error.js";

export interface WorkerIdentity {
  name?: string;
  description?: string;
  tags?: readonly string[];
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) throw new StartupError("identity");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) throw new StartupError("identity");
  return trimmed;
}

export function validateIdentity(identity: WorkerIdentity = {}): WorkerIdentity {
  if (!identity || typeof identity !== "object" || Array.isArray(identity))
    throw new StartupError("identity");
  const result: WorkerIdentity = {};
  if (identity.name !== undefined) result.name = text(identity.name, 128);
  if (identity.description !== undefined) result.description = text(identity.description, 1_024);
  if (identity.tags !== undefined) {
    if (!Array.isArray(identity.tags) || identity.tags.length > 16)
      throw new StartupError("identity");
    result.tags = [...new Set(Array.from(identity.tags, (tag: unknown) => text(tag, 64)))];
  }
  return result;
}

export function parseIdentity(env: NodeJS.ProcessEnv): WorkerIdentity | undefined {
  if ([env.A2A_NAME, env.A2A_DESCRIPTION, env.A2A_TAGS].every((value) => value === undefined))
    return undefined;
  return validateIdentity({
    ...(env.A2A_NAME === undefined ? {} : { name: env.A2A_NAME }),
    ...(env.A2A_DESCRIPTION === undefined ? {} : { description: env.A2A_DESCRIPTION }),
    ...(env.A2A_TAGS === undefined ? {} : { tags: env.A2A_TAGS.split(",") }),
  });
}
