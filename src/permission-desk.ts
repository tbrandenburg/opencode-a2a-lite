import { randomUUID } from "node:crypto";
import type { PermissionOption } from "./permission.js";

export interface PendingPermission {
  requestId: string;
  options: PermissionOption[];
  answer: Promise<string | undefined>;
  finished: Promise<void>;
  settle(optionId: string | undefined): void;
}

/** Tracks the one permission request awaiting a human answer per task. */
export function createPermissionDesk(timeoutMs: number) {
  const waiting = new Map<
    string,
    PendingPermission & { answered: boolean; timer: ReturnType<typeof setTimeout> }
  >();

  function open(taskId: string, options: PermissionOption[], finished: Promise<void>) {
    const gate = Promise.withResolvers<string | undefined>();
    const entry = {
      requestId: randomUUID(),
      options,
      answer: gate.promise,
      finished,
      answered: false,
      timer: setTimeout(() => entry.settle(undefined), timeoutMs),
      settle(optionId: string | undefined) {
        if (entry.answered) return;
        entry.answered = true;
        clearTimeout(entry.timer);
        gate.resolve(optionId);
      },
    };
    waiting.set(taskId, entry);
    return entry;
  }

  return {
    open,
    // Only an unanswered request can accept an answer; a second answer finds nothing.
    pending(taskId: string): PendingPermission | undefined {
      const entry = waiting.get(taskId);
      return entry && !entry.answered ? entry : undefined;
    },
    release(taskId: string) {
      waiting.get(taskId)?.settle(undefined);
      waiting.delete(taskId);
    },
  };
}
