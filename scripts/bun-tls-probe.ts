// Manual external-network check, deliberately separate from deterministic CI.
const controls = [
  { host: "example.com", negative: false },
  { host: "dv-g3b-emudhra.we-have-a-problem.com", negative: true },
  { host: "dv-g3b-aaa-emudhra.we-have-a-problem.com", negative: true },
  { host: "dv-g3b-noct-emudhra.we-have-a-problem.com", negative: true },
  { host: "dv-g3b-aaa-noct-emudhra.we-have-a-problem.com", negative: true },
];

const results = await Promise.all(
  controls.map(async (control) => {
    try {
      const response = await fetch(`https://${control.host}/`, {
        proxy: false,
        redirect: "manual",
        tls: { rejectUnauthorized: true },
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "opencode-a2a-lite-tls-probe" },
      });
      await response.body?.cancel();
      return {
        host: control.host,
        outcome: control.negative ? "unexpected-acceptance" : "positive-https",
        passed: !control.negative && response.ok,
        status: response.status,
      };
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "unclassified";
      const revoked = control.negative && code === "CERT_REVOKED";
      return {
        host: control.host,
        outcome: revoked ? "compromised-key-rejected" : "inconclusive",
        passed: revoked,
        code,
      };
    }
  }),
);

console.log(JSON.stringify({ bun: Bun.version, controls: results }, null, 2));
process.exitCode = results.every((result) => result.passed) ? 0 : 1;
