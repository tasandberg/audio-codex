import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryService } from "./service";
import { FileLocation } from "./storage/file-location";
import { SyncCancelled, SyncControl } from "./sync/control";
import type { Root } from "./types";
import type { UploadedFile } from "./upload/uploader";

const captured = vi.hoisted(() => ({ onProgress: null as ((done: number, total: number) => void) | null, onExtract: null as (() => void) | null }));

vi.mock("./sync/covers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sync/covers")>();
  return {
    ...actual,
    extractCovers: (...args: Parameters<typeof actual.extractCovers>) => {
      captured.onProgress = args[3] ?? null;
      captured.onExtract?.();
      return actual.extractCovers(...args);
    },
  };
});

vi.mock("./sync/tag-reader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sync/tag-reader")>();
  return { ...actual, readTags: async () => ({ album: "LP" }) };
});

function stubFoundry() {
  const stored = new Map<string, unknown>();
  const upload = vi.fn(async () => ({ path: "worlds/w/audio-codex/index.json" }));
  vi.stubGlobal("game", {
    user: { isGM: true, role: 4 },
    world: { id: "w" },
    i18n: { localize: (key: string) => key, format: (key: string) => key },
    settings: {
      get: (_module: string, key: string) => stored.get(key),
      set: async (_module: string, key: string, value: unknown) => void stored.set(key, value),
    },
  });
  vi.stubGlobal("foundry", {
    applications: {
      apps: {
        FilePicker: { implementation: { createDirectory: vi.fn(async () => undefined), upload } },
      },
    },
  });
  vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  return { upload };
}

describe("LibraryService.sync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("claims the lock before awaiting, so overlapping calls write the index once", async () => {
    const { upload } = stubFoundry();
    const service = new LibraryService();
    const first = service.sync();
    const second = service.sync();
    expect(service.control).not.toBeNull();
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(secondOutcome).toBeNull();
    expect(firstOutcome).not.toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(service.control).toBeNull();
  });
});

describe("LibraryService.splice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    captured.onExtract = null;
  });

  it("clears progress and skips the index write when cancelled during cover extraction", async () => {
    const { upload } = stubFoundry();
    const service = new LibraryService();
    const root: Root = { id: "r1", label: "music", source: "data", bucket: null, prefix: "music" };
    const directory = new FileLocation("data", "music/Band");
    const uploaded: UploadedFile[] = [{ directory, file: new File(["x"], "01 a.mp3"), key: "music/Band/01 a.mp3", path: "music/Band/01%20a.mp3" }];
    const control = new SyncControl();
    captured.onExtract = () => control.cancel();
    await expect(service.splice(root, uploaded, control)).rejects.toBeInstanceOf(SyncCancelled);
    expect(service.progress).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(captured.onProgress).toBeTypeOf("function");
    captured.onProgress?.(3, 7);
    expect(service.progress).toBeNull();
  });
});
