/**
 * Runs tasks one at a time per channel, in the order they arrive, so two replies in the same
 * channel never read or write the history at the same time. Different channels don't wait for
 * each other.
 */
export class ChannelLock {
  /** The last task queued for each channel. */
  private readonly lastTask = new Map<string, Promise<unknown>>();

  run<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.lastTask.get(channelId) ?? Promise.resolve();
    // Run after the previous task whether it succeeded or failed.
    const result = previous.then(task, task);
    // The next task only waits; it shouldn't see this one's error. The caller does, via `result`.
    this.lastTask.set(
      channelId,
      result.catch(() => {}),
    );
    return result;
  }
}
