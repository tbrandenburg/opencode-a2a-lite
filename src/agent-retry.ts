import { StartupError } from "./startup-error.js";
import { validateAgentPermissions } from "./runtime-policy-check.js";
import type { Exception } from "./policy-file.js";
import type { PolicyProfile } from "./runtime-policy.js";
import { validateNativeRole, type NativeRole } from "./native-role.js";

const POLICY_MESSAGE = new StartupError("policy").message;

export type AgentRetry = {
  deadlineMs: number;
  maxAttempts: number;
  delayMs: number;
};

// Probes take 10-36s on a slow cold host (#93), so the budget covers about five of them.
export const AGENT_RETRY: AgentRetry = {
  deadlineMs: 180_000,
  maxAttempts: 10,
  delayMs: 250,
};
const AGENT_RETRY_DELAY_CAP_MS = 4_000;
// Probes passed in about 5s and failed at 7s or more on a loaded host (#93, #103).
export const SLOW_PROBE_MS = 7_000;

function pause(ms: number, abort: AbortSignal) {
  return new Promise<void>((done, fail) => {
    if (abort.aborted) return fail(new StartupError("runtime"));
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", stop);
      done();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      fail(new StartupError("runtime"));
    };
    abort.addEventListener("abort", stop, { once: true });
  });
}

// OpenCode 2.3.x/2.4.x intermittently report `debug agents` without the private global config for
// one process. Only this probe is retried, each time in a fresh process, with capped exponential
// backoff until a monotonic deadline or attempt cap. A deterministic weakening fails every attempt
// and keeps the sanitized policy error.
export async function verifyAgents(
  run: (args: string[]) => Promise<string>,
  policy: PolicyProfile,
  exceptions: readonly Exception[] | undefined,
  abort: AbortSignal,
  retry: AgentRetry,
  lastProbeMs: () => number = () => 0,
  role?: NativeRole,
) {
  const started = performance.now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = await run(["--standalone", "debug", "agents"]);
      validateAgentPermissions(output, policy, exceptions);
      if (role) validateNativeRole(output, role);
      if (attempt > 1)
        console.error(`Private runtime preflight: agent check passed on attempt ${attempt}`);
      return;
    } catch (error) {
      const weakened = error instanceof StartupError && error.message === POLICY_MESSAGE;
      if (!weakened) throw error;
      const wait = Math.min(retry.delayMs * 2 ** (attempt - 1), AGENT_RETRY_DELAY_CAP_MS);
      if (attempt >= retry.maxAttempts || performance.now() - started + wait >= retry.deadlineMs) {
        const slow = lastProbeMs() >= SLOW_PROBE_MS;
        const elapsed = Math.round(performance.now() - started);
        if (slow) {
          console.error(
            `Private runtime preflight: ${attempt} agent check attempt(s) over ${elapsed}ms, last probe took ${Math.round(lastProbeMs())}ms; host appears overloaded; start fewer gateways at once`,
          );
          throw new StartupError("overloaded");
        }
        console.error(
          `Private runtime preflight: the agent check is known to be intermittent on OpenCode 2.3.x and 2.4.x; ${attempt} attempt(s) over ${Math.round(performance.now() - started)}ms none reported the private policy`,
        );
        throw error;
      }
      console.error(
        `Private runtime preflight: agent check attempt ${attempt} did not report the private policy; retrying`,
      );
      await pause(wait, abort);
    }
  }
}
