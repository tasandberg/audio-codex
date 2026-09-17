import { describe, expect, it } from "vitest";
import { SyncCancelled, SyncControl } from "./control";
import { runQueue } from "./queue";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runQueue", () => {
  it("processes every item, including ones enqueued by workers", async () => {
    const seen: number[] = [];
    await runQueue(
      [1],
      async (item, enqueue) => {
        seen.push(item);
        if (item < 5) enqueue(item + 1);
      },
      { concurrency: 3, control: new SyncControl() },
    );
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency bound", async () => {
    let active = 0;
    let peak = 0;
    await runQueue(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
      },
      { concurrency: 4, control: new SyncControl() },
    );
    expect(peak).toBe(4);
  });

  it("resolves immediately for an empty queue", async () => {
    await expect(runQueue([], async () => {}, { concurrency: 2, control: new SyncControl() })).resolves.toBeUndefined();
  });

  it("rejects with SyncCancelled and starts nothing new after cancel", async () => {
    const control = new SyncControl();
    const started: number[] = [];
    const run = runQueue(
      Array.from({ length: 10 }, (_, index) => index),
      async (item) => {
        started.push(item);
        if (item === 1) control.cancel();
        await tick();
      },
      { concurrency: 2, control },
    );
    await expect(run).rejects.toBeInstanceOf(SyncCancelled);
    expect(started).toEqual([0, 1]);
  });

  it("holds new work while paused and continues on resume", async () => {
    const control = new SyncControl();
    const started: number[] = [];
    control.pause();
    const run = runQueue([1, 2, 3], async (item) => {
      started.push(item);
    }, { concurrency: 1, control });
    await tick();
    expect(started).toEqual([]);
    control.resume();
    await run;
    expect(started).toEqual([1, 2, 3]);
  });

  it("cancel wakes a paused queue and rejects it", async () => {
    const control = new SyncControl();
    control.pause();
    const run = runQueue([1], async () => {}, { concurrency: 1, control });
    control.cancel();
    await expect(run).rejects.toBeInstanceOf(SyncCancelled);
    expect(control.signal.aborted).toBe(true);
  });
});
