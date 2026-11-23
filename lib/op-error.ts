// Kept apart from ops/core so the demo's limits, which core itself calls, can throw it without a cycle.
export class OpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
