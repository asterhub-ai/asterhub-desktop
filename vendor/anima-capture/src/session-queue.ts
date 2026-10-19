export interface QueuedTask<T> {
  promise: Promise<T>;
  completion: Promise<void>;
  settle(value: T): void;
  settled(): boolean;
}

/**
 * A small FIFO queue whose jobs execute one at a time.  Queues are keyed by
 * canonical session UID by CaptureCore; consequently only one session is
 * serialized while independent session queues can run concurrently.
 */
export class SessionQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private active = 0;

  get pending(): number {
    return this.active;
  }

  enqueue(work: () => Promise<T>, onReject?: (error: unknown) => T): QueuedTask<T> {
    let resolveTask!: (value: T) => void;
    let rejectTask!: (reason: unknown) => void;
    let resolveCompletion!: () => void;
    let isSettled = false;
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = (value) => {
        if (isSettled) return;
        isSettled = true;
        resolve(value);
      };
      rejectTask = (reason) => {
        if (isSettled) return;
        isSettled = true;
        reject(reason);
      };
    });
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    this.active += 1;
    const run = async (): Promise<void> => {
      try {
        const result = await work();
        resolveTask(result);
      } catch (error: unknown) {
        if (onReject === undefined) {
          rejectTask(error);
        } else {
          try {
            resolveTask(onReject(error));
          } catch (fallbackError: unknown) {
            rejectTask(fallbackError);
          }
        }
      } finally {
        this.active -= 1;
        resolveCompletion();
      }
    };
    this.tail = this.tail.then(run, run);
    return {
      promise,
      completion,
      settle: resolveTask,
      settled: () => isSettled,
    };
  }
}
