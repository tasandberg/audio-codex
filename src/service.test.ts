import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeIndex } from "./index/index-store";
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

function stubFoundry(options: { role?: number; settings?: Record<string, unknown> } = {}) {
  const role = options.role ?? 4;
  const stored = new Map<string, unknown>(Object.entries(options.settings ?? {}));
  const upload = vi.fn(async () => ({ path: "worlds/w/audio-codex/index.json" }));
  vi.stubGlobal("game", {
    user: { isGM: role >= 3, role },
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
  return { upload, stored };
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

describe("LibraryService access control", () => {
  const POINTER = { version: 2, generatedAt: 7, rootFingerprint: "f", fileCount: 0, cacheFile: "worlds/w/audio-codex/index.json", partial: [] };

  async function stubIndexFetch() {
    const bytes = await encodeIndex({ version: 2, generatedAt: 7, roots: [] });
    const fetchMock = vi.fn(async () => new Response(new Blob([bytes as Uint8Array<ArrayBuffer>])));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("never fetches or parses the index for an unpermitted client", async () => {
    const fetchMock = await stubIndexFetch();
    stubFoundry({ role: 1, settings: { pointer: POINTER } });
    const service = new LibraryService();
    await service.ensureLoaded();
    await service.load();
    service.onPointerChanged();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.index).toBeNull();
  });

  it("fetches the index once the threshold admits the client", async () => {
    const fetchMock = await stubIndexFetch();
    stubFoundry({ role: 1, settings: { pointer: POINTER, minimumRole: 1 } });
    const service = new LibraryService();
    await service.ensureLoaded();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.index?.generatedAt).toBe(7);
  });

  it("refuses to sync or write overrides for an unpermitted assistant", async () => {
    const { upload, stored } = stubFoundry({ role: 3, settings: { pointer: POINTER } });
    await stubIndexFetch();
    const service = new LibraryService();
    expect(game.user.isGM).toBe(true);
    expect(await service.sync()).toBeNull();
    await service.edit([{ rootId: "r1", key: "a.mp3", fields: { artist: "x" } }]);
    await service.revert("r1", "a.mp3");
    expect(upload).not.toHaveBeenCalled();
    expect(stored.get("overrides")).toBeUndefined();
  });

  it("leaves the auto-sync latch unspent when permission is denied", async () => {
    const { upload, stored } = stubFoundry({ role: 3 });
    const service = new LibraryService();
    await service.autoSync();
    expect(upload).not.toHaveBeenCalled();
    stored.set("minimumRole", 3);
    await service.autoSync();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight sync and drops the loaded library when revoked", async () => {
    await stubIndexFetch();
    const { upload } = stubFoundry({ settings: { pointer: POINTER } });
    const service = new LibraryService();
    await service.ensureLoaded();
    expect(service.index).not.toBeNull();
    const running = service.sync();
    service.revoke();
    expect(await running).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(service.index).toBeNull();
    expect(service.library.size).toBe(0);
  });
});
