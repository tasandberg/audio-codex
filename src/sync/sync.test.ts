import { describe, expect, it, vi } from "vitest";
import type { ByteSource } from "./byte-source";
import { SyncCancelled, SyncControl } from "./control";
import type { Browse } from "./crawler";
import { type SyncDeps, runSync } from "./sync";
import type { LibraryIndex, Root } from "../types";
import type { FileLocation } from "../storage/file-location";

const roots: Root[] = [
  { id: "s3", label: "S3", source: "s3", bucket: "bkt", prefix: "audio" },
  { id: "data", label: "Data", source: "data", bucket: null, prefix: "music" },
];

const listing: Record<string, { dirs: string[]; files: string[] }> = {
  audio: { dirs: [], files: ["https://bkt.s3/audio/a.mp3", "https://bkt.s3/audio/b.mp3"] },
  music: { dirs: ["music/Album"], files: [] },
  "music/Album": { dirs: [], files: ["music/Album/01.mp3", "music/Album/02.mp3"] },
};

const browse: Browse = async (_source, target) => {
  const entry = listing[target];
  if (!entry) throw new Error(`missing ${target}`);
  return entry;
};

const albumTags = async () => ({ album: "LP" });

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    roots,
    previous: null,
    browse,
    openSource: (url) => ({ size: 1, read: async () => new TextEncoder().encode(url) }),
    readTags: vi.fn(async (source) => ({ title: new TextDecoder().decode(await source.read(0, 0)) })),
    readCover: vi.fn(async () => null),
    uploadCover: vi.fn(async () => null),
    write: vi.fn(async () => "worlds/w/audio-codex/index.json"),
    now: () => 1000,
    ...overrides,
  };
}

describe("runSync", () => {
  it("crawls every root, tags every new file and writes one index", async () => {
    const d = deps();
    const outcome = await runSync(d, new SyncControl());
    expect(outcome.tagged).toBe(4);
    expect(outcome.carried).toBe(0);
    expect(outcome.pointer).toMatchObject({ version: 2, generatedAt: 1000, fileCount: 4, cacheFile: "worlds/w/audio-codex/index.json", partial: [] });
    expect(outcome.index.roots.map((root) => root.rootId)).toEqual(["s3", "data"]);
    expect(outcome.index.roots[0].index.files[0]).toEqual({ name: "a.mp3", title: "https://bkt.s3/audio/a.mp3" });
    expect(outcome.index.roots[1].index.dirs[0].files[1]).toEqual({ name: "02.mp3", title: "music/Album/02.mp3" });
    expect(d.write).toHaveBeenCalledTimes(1);
  });

  it("a second sync tags only files that were added", async () => {
    const first = await runSync(deps(), new SyncControl());
    listing.audio.files.push("https://bkt.s3/audio/c.mp3");
    const readTags = vi.fn(async () => ({ title: "C" }));
    const second = await runSync(deps({ previous: first.index, readTags }), new SyncControl());
    listing.audio.files.pop();
    expect(readTags).toHaveBeenCalledTimes(1);
    expect(second.tagged).toBe(1);
    expect(second.carried).toBe(4);
  });

  it("skips the write and keeps the pointer when nothing changed", async () => {
    const first = await runSync(deps(), new SyncControl());
    const write = vi.fn(async () => "worlds/w/audio-codex/other.json");
    const second = await runSync(deps({ previous: first.index, previousCacheFile: "worlds/w/audio-codex/index.json", write, now: () => 2000 }), new SyncControl());
    expect(write).not.toHaveBeenCalled();
    expect(second.index).toBe(first.index);
    expect(second.pointer).toMatchObject({ generatedAt: 1000, cacheFile: "worlds/w/audio-codex/index.json", fileCount: 4 });
  });

  it("treats an index whose tag keys are in a different order as unchanged", async () => {
    const tags = vi.fn(async () => ({ title: "T", artist: "A", album: "LP" }));
    const first = await runSync(deps({ readTags: tags }), new SyncControl());
    const reordered = vi.fn(async () => ({ album: "LP", artist: "A", title: "T" }));
    const write = vi.fn(async () => "worlds/w/audio-codex/other.json");
    const second = await runSync(
      deps({ previous: first.index, previousCacheFile: "worlds/w/audio-codex/index.json", readTags: reordered, write, now: () => 2000 }),
      new SyncControl(),
      { force: true },
    );
    expect(reordered).toHaveBeenCalledTimes(4);
    expect(write).not.toHaveBeenCalled();
    expect(second.pointer.generatedAt).toBe(1000);
  });

  it("still writes when files changed, the cache file is unknown or the previous index is an older version", async () => {
    const first = await runSync(deps(), new SyncControl());
    listing.audio.files.push("https://bkt.s3/audio/c.mp3");
    const added = deps({ previous: first.index, previousCacheFile: "worlds/w/audio-codex/index.json", now: () => 2000 });
    const changed = await runSync(added, new SyncControl());
    listing.audio.files.pop();
    expect(added.write).toHaveBeenCalledTimes(1);
    expect(changed.pointer.generatedAt).toBe(2000);

    const unknown = deps({ previous: first.index, previousCacheFile: null });
    await runSync(unknown, new SyncControl());
    expect(unknown.write).toHaveBeenCalledTimes(1);

    const older = deps({ previous: { ...first.index, version: 1 }, previousCacheFile: "worlds/w/audio-codex/index.json" });
    await runSync(older, new SyncControl());
    expect(older.write).toHaveBeenCalledTimes(1);
  });

  it("marks failed reads pending and retries them next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readTags = vi.fn(async () => {
      throw new Error("503");
    });
    const first = await runSync(deps({ readTags }), new SyncControl());
    expect(first.failed).toBe(4);
    expect(first.index.roots[0].index.files[0]).toEqual({ name: "a.mp3", pending: true });
    const retry = vi.fn(async () => ({ title: "ok" }));
    const second = await runSync(deps({ previous: first.index, readTags: retry }), new SyncControl());
    expect(retry).toHaveBeenCalledTimes(4);
    expect(second.index.roots[0].index.files[0]).toEqual({ name: "a.mp3", title: "ok" });
    warn.mockRestore();
  });

  it("keeps the previous index for an unreachable root and flags the result partial", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous: LibraryIndex = {
      version: 1,
      generatedAt: 1,
      roots: [{ rootId: "data", urlBase: "", index: { dir: "", files: [{ name: "kept.mp3", title: "Kept" }], dirs: [] } }],
    };
    const failing: Browse = async (source, target, options) => {
      if (source === "data") throw new Error("offline");
      return browse(source, target, options);
    };
    const outcome = await runSync(deps({ previous, browse: failing }), new SyncControl());
    expect(outcome.pointer.partial).toEqual(["data"]);
    expect(outcome.index.roots[1]).toEqual(previous.roots[0]);
    expect(outcome.index.roots[0].index.files).toHaveLength(2);
    warn.mockRestore();
  });

  it("cancelling writes nothing, so no partial index is ever marked complete", async () => {
    const control = new SyncControl();
    const write = vi.fn(async () => "x");
    const readTags = vi.fn(async () => {
      control.cancel();
      return {};
    });
    await expect(runSync(deps({ readTags, write }), control)).rejects.toBeInstanceOf(SyncCancelled);
    expect(write).not.toHaveBeenCalled();
  });

  it("stops reporting progress after cancel, even for reads still in flight", async () => {
    const control = new SyncControl();
    const progresses: { phase: string; done: number; total: number }[] = [];
    const readTags = vi.fn(async (source: ByteSource) => {
      const key = new TextDecoder().decode(await source.read(0, 0));
      if (key.endsWith("a.mp3")) {
        control.cancel();
        throw new Error("aborted");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {};
    });
    await expect(runSync(deps({ readTags }), control, { onProgress: (progress) => progresses.push(progress) })).rejects.toBeInstanceOf(SyncCancelled);
    const afterRejection = progresses.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(progresses.length).toBe(afterRejection);
  });

  it("a forced rescan re-reads every file", async () => {
    const first = await runSync(deps(), new SyncControl());
    const readTags = vi.fn(async () => ({}));
    await runSync(deps({ previous: first.index, readTags }), new SyncControl(), { force: true });
    expect(readTags).toHaveBeenCalledTimes(4);
  });

  it("reports progress through every phase", async () => {
    const phases = new Set<string>();
    await runSync(deps(), new SyncControl(), { onProgress: (progress) => phases.add(progress.phase) });
    expect([...phases]).toEqual(["crawl", "tags", "covers", "write"]);
  });

  it("does not probe folders that are not albums", async () => {
    const readCover = vi.fn(async () => ({ format: "image/jpeg", data: new Uint8Array([1]) }));
    const outcome = await runSync(deps({ readCover }), new SyncControl());
    expect(readCover).not.toHaveBeenCalled();
    expect(outcome.covered).toBe(0);
  });

  it("extracts a cover for each coverless album directory and records it in the index", async () => {
    const readCover = vi.fn(async () => ({ format: "image/jpeg", data: new Uint8Array([1]) }));
    const uploadCover = vi.fn(async (_location: FileLocation, _file: File) => "uploaded");
    const outcome = await runSync(deps({ readTags: albumTags, readCover, uploadCover }), new SyncControl());
    expect(outcome.covered).toBe(2);
    expect(readCover).toHaveBeenCalledTimes(2);
    expect(outcome.index.roots[0].index.cover).toBe("cover.jpg");
    expect(outcome.index.roots[1].index.dirs[0].cover).toBe("cover.jpg");
    expect(uploadCover.mock.calls.map(([location, file]) => [location.key, file.name])).toEqual([
      ["audio", "cover.jpg"],
      ["music/Album", "cover.jpg"],
    ]);
  });

  it("a second sync extracts nothing, because the crawl now finds the cover it wrote", async () => {
    const first = await runSync(deps({ readTags: albumTags, readCover: async () => ({ format: "image/jpeg", data: new Uint8Array([1]) }), uploadCover: async () => "uploaded" }), new SyncControl());
    listing.audio.files.push("https://bkt.s3/audio/cover.jpg");
    listing["music/Album"].files.push("music/Album/cover.jpg");
    const again = vi.fn(async () => null);
    const second = await runSync(deps({ previous: first.index, readCover: again }), new SyncControl());
    listing.audio.files.pop();
    listing["music/Album"].files.pop();
    expect(again).not.toHaveBeenCalled();
    expect(second.covered).toBe(0);
    expect(second.index.roots[0].index.cover).toBe("cover.jpg");
  });
});
