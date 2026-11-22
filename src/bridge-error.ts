/** Failure whose message is gateway-authored, phase-level and safe to publish to A2A clients. */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}
