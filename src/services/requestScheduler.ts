export type RequestPriority = 'critical' | 'interactive' | 'background';

export interface RequestSchedulerOptions {
  /** Maximum number of network requests allowed to run at the same time. */
  concurrency?: number;
  /** Maximum number of requests waiting for an execution slot. */
  maxQueued?: number;
}

export interface RequestScheduleOptions {
  priority?: RequestPriority;
  signal?: AbortSignal;
}

export interface RequestSchedulerSnapshot {
  active: number;
  queued: number;
  concurrency: number;
  maxQueued: number;
  activeByPriority: Record<RequestPriority, number>;
  queuedByPriority: Record<RequestPriority, number>;
}

export interface RequestScheduler {
  schedule<T>(
    task: (signal: AbortSignal) => T | PromiseLike<T>,
    options?: RequestScheduleOptions
  ): Promise<T>;
  cancelAll: (reason?: unknown) => void;
  getSnapshot: () => RequestSchedulerSnapshot;
}

interface RequestQueueEntry {
  id: number;
  sequence: number;
  priority: RequestPriority;
  task: (signal: AbortSignal) => unknown | PromiseLike<unknown>;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  externalSignal?: AbortSignal;
  externalAbortListener?: () => void;
  rejectAbort?: (reason: unknown) => void;
  started: boolean;
}

const PRIORITY_WEIGHT: Record<RequestPriority, number> = {
  critical: 3,
  interactive: 2,
  background: 1
};

function readAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error('Request aborted.');
}

function createPriorityCounts(): Record<RequestPriority, number> {
  return { critical: 0, interactive: 0, background: 0 };
}

/**
 * A small FIFO-within-priority scheduler for read-only transport work.
 *
 * Callers retain ownership of request identity, caching, timeouts and response
 * validation. The scheduler only bounds concurrency, orders queued work and
 * forwards cancellation to the underlying request.
 */
export function createRequestScheduler(options: RequestSchedulerOptions = {}): RequestScheduler {
  const requestedConcurrency = options.concurrency ?? 4;
  const requestedMaxQueued = options.maxQueued ?? 128;
  const concurrency = Number.isInteger(requestedConcurrency) && requestedConcurrency > 0
    ? Math.min(32, requestedConcurrency)
    : 4;
  const maxQueued = Number.isInteger(requestedMaxQueued) && requestedMaxQueued >= 0
    ? Math.min(2_048, requestedMaxQueued)
    : 128;
  const queue: RequestQueueEntry[] = [];
  const active = new Map<number, RequestQueueEntry>();
  let nextId = 1;
  let nextSequence = 1;

  const cleanup = (entry: RequestQueueEntry): void => {
    if (entry.externalSignal && entry.externalAbortListener) {
      entry.externalSignal.removeEventListener('abort', entry.externalAbortListener);
    }
    entry.externalAbortListener = undefined;
  };

  const cancelEntry = (entry: RequestQueueEntry, reason: unknown): void => {
    if (!entry.controller.signal.aborted) entry.controller.abort(reason);

    if (!entry.started) {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      cleanup(entry);
      entry.reject(reason);
      pump();
      return;
    }

    entry.rejectAbort?.(reason);
  };

  const pump = (): void => {
    queue.sort((left, right) =>
      PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] ||
      left.sequence - right.sequence
    );

    while (active.size < concurrency && queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.controller.signal.aborted) {
        cleanup(entry);
        entry.reject(readAbortReason(entry.controller.signal));
        continue;
      }

      entry.started = true;
      active.set(entry.id, entry);

      const aborted = new Promise<never>((_resolve, reject) => {
        entry.rejectAbort = reject;
        if (entry.controller.signal.aborted) {
          reject(readAbortReason(entry.controller.signal));
        }
      });
      const taskResult = Promise.resolve().then(() => {
        if (entry.controller.signal.aborted) throw readAbortReason(entry.controller.signal);
        return entry.task(entry.controller.signal);
      });

      void Promise.race([taskResult, aborted])
        .then(entry.resolve, entry.reject)
        .finally(() => {
          cleanup(entry);
          active.delete(entry.id);
          entry.rejectAbort = undefined;
          pump();
        });
    }
  };

  const schedule = <T>(
    task: (signal: AbortSignal) => T | PromiseLike<T>,
    scheduleOptions: RequestScheduleOptions = {}
  ): Promise<T> => new Promise<T>((resolve, reject) => {
    const externalSignal = scheduleOptions.signal;
    if (externalSignal?.aborted) {
      reject(readAbortReason(externalSignal));
      return;
    }

    const priority = scheduleOptions.priority ?? 'interactive';
    if (queue.length >= maxQueued && active.size >= concurrency) {
      const lowestQueuedPriority = queue.reduce(
        (lowest, entry) => Math.min(lowest, PRIORITY_WEIGHT[entry.priority]),
        Number.POSITIVE_INFINITY
      );
      if (PRIORITY_WEIGHT[priority] <= lowestQueuedPriority) {
        reject(new Error('Request queue is full.'));
        return;
      }

      // Keep critical work from being blocked by a full queue of background
      // reads. Evict the newest request at the lowest queued priority so FIFO
      // ordering is preserved for all work that remains in the queue.
      let evictionIndex = -1;
      let newestSequence = -1;
      queue.forEach((entry, index) => {
        if (
          PRIORITY_WEIGHT[entry.priority] === lowestQueuedPriority &&
          entry.sequence > newestSequence
        ) {
          evictionIndex = index;
          newestSequence = entry.sequence;
        }
      });
      if (evictionIndex < 0) {
        reject(new Error('Request queue is full.'));
        return;
      }
      const [evicted] = queue.splice(evictionIndex, 1);
      const evictionError = new Error('Request displaced by higher-priority work.');
      if (!evicted.controller.signal.aborted) evicted.controller.abort(evictionError);
      cleanup(evicted);
      evicted.reject(evictionError);
    }

    const entry: RequestQueueEntry = {
      id: nextId++,
      sequence: nextSequence++,
      priority,
      task: (signal) => task(signal),
      controller: new AbortController(),
      resolve: (value) => resolve(value as T),
      reject,
      externalSignal,
      started: false
    };

    if (externalSignal) {
      entry.externalAbortListener = () => cancelEntry(entry, readAbortReason(externalSignal));
      externalSignal.addEventListener('abort', entry.externalAbortListener, { once: true });
      if (externalSignal.aborted) {
        entry.externalAbortListener();
        return;
      }
    }

    queue.push(entry);
    pump();
  });

  const cancelAll = (reason: unknown = new Error('Request context was reset.')): void => {
    // Drain queued entries without pumping between removals; a reset must not
    // briefly start another request that is scheduled to be cancelled as well.
    const queuedEntries = queue.splice(0);
    for (const entry of queuedEntries) {
      if (!entry.controller.signal.aborted) entry.controller.abort(reason);
      cleanup(entry);
      entry.reject(reason);
    }
    for (const entry of [...active.values()]) cancelEntry(entry, reason);
  };

  const getSnapshot = (): RequestSchedulerSnapshot => {
    const activeByPriority = createPriorityCounts();
    const queuedByPriority = createPriorityCounts();
    active.forEach((entry) => { activeByPriority[entry.priority] += 1; });
    queue.forEach((entry) => { queuedByPriority[entry.priority] += 1; });
    return {
      active: active.size,
      queued: queue.length,
      concurrency,
      maxQueued,
      activeByPriority,
      queuedByPriority
    };
  };

  return { schedule, cancelAll, getSnapshot };
}
