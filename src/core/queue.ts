export class ProviderQueue {
  private queues = new Map<string, Promise<void>>();

  async enqueue<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(providerId) ?? Promise.resolve();

    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    this.queues.set(providerId, next);

    try {
      await prev; // Wait for previous request to complete
      return await fn();
    } finally {
      resolve();
    }
  }

  get pendingCount(): number {
    return this.queues.size;
  }
}
