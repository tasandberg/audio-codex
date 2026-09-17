import type { SyncControl } from "./control";

export interface QueueOptions {
  concurrency: number;
  control: SyncControl;
}

export function runQueue<T>(
  initial: T[],
  worker: (item: T, enqueue: (item: T) => void) => Promise<void>,
  { concurrency, control }: QueueOptions,
): Promise<void> {
  const queue = [...initial];
  const enqueue = (item: T) => {
    queue.push(item);
  };
  let active = 0;
  let failed = false;
  return new Promise((resolve, reject) => {
    const pump = () => {
      if (failed) return;
      if (!queue.length && !active) {
        resolve();
        return;
      }
      while (active < concurrency && queue.length) {
        const item = queue.shift() as T;
        active++;
        control
          .checkpoint()
          .then(() => worker(item, enqueue))
          .then(
            () => {
              active--;
              pump();
            },
            (error: unknown) => {
              failed = true;
              reject(error);
            },
          );
      }
    };
    pump();
  });
}
