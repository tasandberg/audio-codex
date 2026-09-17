export class SyncCancelled extends Error {
  constructor() {
    super("Audio Codex sync cancelled");
    this.name = "SyncCancelled";
  }
}

export class SyncControl {
  #paused = false;
  #cancelled = false;
  #waiters: Array<() => void> = [];
  readonly #abort = new AbortController();

  get paused(): boolean {
    return this.#paused;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  pause(): void {
    if (!this.#cancelled) this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    this.#release();
  }

  cancel(): void {
    this.#cancelled = true;
    this.#paused = false;
    this.#abort.abort(new SyncCancelled());
    this.#release();
  }

  async checkpoint(): Promise<void> {
    while (this.#paused && !this.#cancelled) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
    if (this.#cancelled) throw new SyncCancelled();
  }

  #release(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const wake of waiters) wake();
  }
}
