import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { StartupError } from "./startup-error.js";

export const STANDALONE_AGENT = "a2a-standalone";
export const MAX_SYSTEM_PROMPT_BYTES = 64 * 1024;
export type NativeRole = { id: string; system?: string };

export function validateRoleOptions(agent?: string, file?: string, resume = false) {
  if (agent === undefined && file === undefined) return;
  if (agent !== undefined && file !== undefined) throw new StartupError("roleConflict");
  if (resume) throw new StartupError("roleResume");
  if (agent === undefined) return;
  if (!validAgent(agent)) throw new StartupError("role");
}

const validAgent = (agent: string) => Boolean(agent.trim()) && !/\p{Cc}/u.test(agent);

function readPrompt(descriptor: number) {
  const stat = fstatSync(descriptor);
  if (!stat.isFile() || stat.size > MAX_SYSTEM_PROMPT_BYTES) throw new Error("Invalid file");
  const buffer = Buffer.alloc(MAX_SYSTEM_PROMPT_BYTES + 1);
  let size = 0;
  while (size < buffer.length) {
    const count = readSync(descriptor, buffer, size, buffer.length - size, null);
    if (!count) break;
    size += count;
  }
  if (size > MAX_SYSTEM_PROMPT_BYTES) throw new Error("Invalid file");
  const system = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  if (!system.trim() || system.includes("\0")) throw new Error("Invalid file");
  return system;
}

export function loadNativeRole(agent?: string, file?: string): NativeRole | undefined {
  validateRoleOptions(agent, file);
  if (file === undefined) return agent === undefined ? undefined : { id: agent };
  let descriptor: number | undefined;
  try {
    // Nonblocking open prevents FIFOs/devices from hanging startup; only regular files are read.
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    return { id: STANDALONE_AGENT, system: readPrompt(descriptor) };
  } catch {
    throw new StartupError("systemPromptFile");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function rejectMarkdownCollision(directory: string, id: string) {
  for (const folder of ["agent", "agents", "mode", "modes"]) {
    try {
      lstatSync(join(directory, folder, `${id}.md`));
      throw new StartupError("role");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        throw new StartupError("role");
    }
  }
}

function definesRole(info: unknown, id: string) {
  if (!record(info)) return false;
  return ["agents", "agent"].some((field) => {
    const agents = info[field];
    return record(agents) && Object.hasOwn(agents, id);
  });
}

export function validateNativeRole(output: string, role: NativeRole) {
  const agents: unknown = JSON.parse(output);
  if (!Array.isArray(agents)) throw new StartupError("role");
  const selected: unknown = agents.find((agent: unknown) => record(agent) && agent.id === role.id);
  if (
    !record(selected) ||
    selected.hidden !== false ||
    (selected.mode !== "primary" && selected.mode !== "all") ||
    (role.system !== undefined && selected.system !== role.system)
  )
    throw new StartupError("role");
}

// Even an identical project definition is a collision: the standalone role belongs to this launch.
export function rejectRoleCollision(output: string, role: NativeRole, privatePath: string) {
  if (role.system === undefined) return;
  const sources: unknown = JSON.parse(output);
  if (!Array.isArray(sources)) throw new StartupError("role");
  for (const source of sources) {
    if (!record(source) || source.path === privatePath) continue;
    if (source.type === "directory" && typeof source.path === "string")
      rejectMarkdownCollision(source.path, role.id);
    if (definesRole(source.info, role.id)) throw new StartupError("role");
  }
}
