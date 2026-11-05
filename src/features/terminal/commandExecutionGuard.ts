/**
 * Prevents the same terminal command from being applied more than once while
 * its first execution is awaiting quote refresh or persistence follow-up.
 */
export class CommandExecutionGuard {
  private readonly inFlight = new Set<string>();

  async run<T>(
    command: string,
    execute: () => Promise<T> | T
  ): Promise<{ status: 'executed'; value: T } | { status: 'duplicate' }> {
    const key = command.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key || this.inFlight.has(key)) return { status: 'duplicate' };

    this.inFlight.add(key);
    try {
      return { status: 'executed', value: await execute() };
    } finally {
      this.inFlight.delete(key);
    }
  }
}
