import { describe, expect, it, vi } from "vitest";
import { decodeIndex, encodeIndex, indexDirectory, readIndex, spliceFiles, writeIndex } from "./index-store";
import type { LibraryIndex, Pointer, Root } from "../types";

const index: LibraryIndex = {
  version: 2,
  generatedAt: 42,
  roots: [{ rootId: "r1", urlBase: "", index: { dir: "", files: [{ name: "a.mp3", artist: "A" }], dirs: [] } }],
};

const pointer = (cacheFile: string): Pointer => ({ version: 2, generatedAt: 42, rootFingerprint: "x", fileCount: 1, cacheFile, partial: [] });

describe("index store", () => {
  it("round-trips through gzip", async () => {
    const bytes = await encodeIndex(index);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    await expect(decodeIndex(bytes)).resolves.toEqual(index);
  });

  it("also accepts plain JSON, in case a proxy decompressed it", async () => {
    await expect(decodeIndex(new TextEncoder().encode(JSON.stringify(index)))).resolves.toEqual(index);
  });

  it("rejects an index from another format version", async () => {
    await expect(decodeIndex(await encodeIndex({ ...index, version: 99 }))).rejects.toThrow("unsupported index version 99");
  });

  it("still reads a version 1 index, which simply has no covers", async () => {
    const legacy: LibraryIndex = { ...index, version: 1 };
    const loaded = await decodeIndex(await encodeIndex(legacy));
    expect(loaded.version).toBe(1);
    expect(loaded.roots[0].index.cover).toBeUndefined();
    const fetchFn = vi.fn(async () => new Response((await encodeIndex(legacy)) as Uint8Array<ArrayBuffer>));
    await expect(readIndex({ ...pointer("worlds/w/audio-codex/index.json"), version: 1 }, fetchFn)).resolves.toEqual(legacy);
  });

  it("writes into the world folder, never modules/", async () => {
    expect(indexDirectory("module-dev-ose")).toBe("worlds/module-dev-ose/audio-codex");
    const writer = {
      createDirectory: vi.fn(async () => {}),
      upload: vi.fn(async (path: string, file: File) => `${path}/${file.name}`),
    };
    const path = await writeIndex(index, "worlds/w/audio-codex", writer);
    expect(path).toBe("worlds/w/audio-codex/index.json");
    expect(writer.createDirectory).toHaveBeenCalledWith("worlds/w/audio-codex");
    const file = writer.upload.mock.calls[0][1];
    expect(file.type).toBe("application/json");
    await expect(decodeIndex(new Uint8Array(await file.arrayBuffer()))).resolves.toEqual(index);
  });

  it("throws when the upload returns no path", async () => {
    await expect(writeIndex(index, "d", { createDirectory: async () => {}, upload: async () => null })).rejects.toThrow("index upload failed");
  });

  it("reads the index over plain HTTP with a cache-busting query", async () => {
    const bytes = await encodeIndex(index);
    const fetchFn = vi.fn(async () => new Response(bytes as Uint8Array<ArrayBuffer>));
    await expect(readIndex(pointer("worlds/w/audio-codex/index.json"), fetchFn)).resolves.toEqual(index);
    expect(fetchFn).toHaveBeenCalledWith("worlds/w/audio-codex/index.json?v=42", { cache: "no-store" });
  });

  it("returns null without a pointer", async () => {
    await expect(readIndex(null)).resolves.toBeNull();
  });
});

describe("spliceFiles", () => {
  const root: Root = { id: "r1", label: "R", source: "s3", bucket: "b", prefix: "audio" };

  it("adds uploaded files under their folders without touching the rest", () => {
    const next = spliceFiles(index, root, "https://b.s3/", [
      { key: "audio/Band/Live/01 Open.mp3", tags: { title: "Open", track: 1 } },
      { key: "audio/b.mp3", tags: {} },
    ], 99);
    expect(next.generatedAt).toBe(99);
    expect(next.roots[0].index).toEqual({
      dir: "",
      files: [{ name: "a.mp3", artist: "A" }, { name: "b.mp3" }],
      dirs: [{ dir: "Band", files: [], dirs: [{ dir: "Live", files: [{ name: "01 Open.mp3", title: "Open", track: 1 }], dirs: [] }] }],
    });
    expect(index.roots[0].index.files).toHaveLength(1);
  });

  it("creates the root entry when the root was never synced", () => {
    const next = spliceFiles(null, root, "https://b.s3/", [{ key: "audio/x.mp3", tags: {} }], 5);
    expect(next.roots).toEqual([{ rootId: "r1", urlBase: "https://b.s3/", index: { dir: "", files: [{ name: "x.mp3" }], dirs: [] } }]);
  });

  it("records an uploaded image as the directory cover, keeping a better existing one", () => {
    const withCover = spliceFiles(index, root, null, [{ key: "audio/Band/01.mp3", tags: {} }], 5, ["audio/Band/art.png"]);
    expect(withCover.roots[0].index.dirs[0]).toMatchObject({ dir: "Band", cover: "art.png" });
    const keepsCover = spliceFiles(withCover, root, null, [], 6, ["audio/Band/cover.jpg", "audio/Band/zzz.png"]);
    expect(keepsCover.roots[0].index.dirs[0].cover).toBe("cover.jpg");
  });

  it("never makes a non-image key the cover", () => {
    const next = spliceFiles(index, root, null, [], 5, ["audio/Band/notes.txt"]);
    expect(next.roots[0].index.dirs[0].cover).toBeUndefined();
    const kept = spliceFiles(next, root, null, [], 6, ["audio/Band/art.png", "audio/Band/notes.txt"]);
    expect(kept.roots[0].index.dirs[0].cover).toBe("art.png");
  });

  it("ignores keys outside the root", () => {
    const next = spliceFiles(index, root, null, [{ key: "elsewhere/x.mp3", tags: {} }], 5);
    expect(next.roots[0].index.files).toHaveLength(1);
  });
});
