import { describe, expect, it, vi } from "vitest";
import type { FileLocation } from "../storage/file-location";
import type { ByteSource } from "./byte-source";
import { SyncCancelled, SyncControl } from "./control";
import { type CoverDeps, type CoverPicture, coverFile, extractCovers, planCovers } from "./covers";
import type { Root, RootIndex } from "../types";

const root: Root = { id: "r1", label: "Bucket", source: "s3", bucket: "bkt", prefix: "audio" };

const rootIndex = (): RootIndex => ({
  rootId: "r1",
  urlBase: "https://bkt.s3/",
  index: {
    dir: "",
    files: [],
    dirs: [
      { dir: "Album", files: [{ name: "01 a.mp3", album: "One" }, { name: "02 b.mp3", album: "One" }], dirs: [] },
      { dir: "Art", cover: "cover.jpg", files: [{ name: "01 c.mp3", album: "Two" }], dirs: [] },
      { dir: "Empty", files: [], dirs: [{ dir: "Deep", files: [{ name: "d.mp3", album: "Three" }], dirs: [] }] },
      { dir: "Loose", files: [{ name: "x.mp3", album: "One" }, { name: "y.mp3", album: "Two" }], dirs: [] },
      { dir: "Untagged", files: [{ name: "z.mp3" }], dirs: [] },
    ],
  },
});

const picture = (format: string): CoverPicture => ({ format, data: new Uint8Array([1, 2, 3]) });

function deps(overrides: Partial<CoverDeps> = {}): CoverDeps {
  return {
    openSource: (url) => ({ size: 3, read: async () => new TextEncoder().encode(url) }) as ByteSource,
    readCover: vi.fn(async () => picture("image/jpeg")),
    upload: vi.fn(async (location: FileLocation, file: File) => `${location.target}/${file.name}`),
    ...overrides,
  };
}

describe("planCovers", () => {
  it("queues one read per coverless album directory, skipping loose and untagged folders", () => {
    const jobs = planCovers(root, rootIndex());
    expect(jobs.map((job) => [job.dirKey, job.url])).toEqual([
      ["audio/Album", "https://bkt.s3/audio/Album/01%20a.mp3"],
      ["audio/Empty/Deep", "https://bkt.s3/audio/Empty/Deep/d.mp3"],
    ]);
  });

  it("skips Forge roots, which have no upload target", () => {
    expect(planCovers({ ...root, source: "forgevtt" }, rootIndex())).toEqual([]);
  });

  it("narrows to the directories asked for", () => {
    expect(planCovers(root, rootIndex(), new Set(["audio/Empty/Deep"])).map((job) => job.dirKey)).toEqual(["audio/Empty/Deep"]);
  });
});

describe("coverFile", () => {
  it("names the file from the picture format and rejects anything else", () => {
    expect(coverFile(picture("image/jpeg"))?.name).toBe("cover.jpg");
    expect(coverFile(picture("JPG"))?.name).toBe("cover.jpg");
    expect(coverFile(picture("image/png"))).toMatchObject({ name: "cover.png", type: "image/png" });
    expect(coverFile(picture("image/webp"))).toMatchObject({ name: "cover.webp", type: "image/webp" });
    expect(coverFile(picture("image/gif"))).toBeNull();
  });
});

describe("extractCovers", () => {
  it("uploads one cover per directory and records it on the node", async () => {
    const index = rootIndex();
    const jobs = planCovers(root, index);
    const d = deps();
    const progress = vi.fn();
    await expect(extractCovers(jobs, d, new SyncControl(), progress)).resolves.toBe(2);
    expect(d.readCover).toHaveBeenCalledTimes(2);
    expect((d.upload as ReturnType<typeof vi.fn>).mock.calls.map(([location, file]) => [location.key, file.name])).toEqual([
      ["audio/Album", "cover.jpg"],
      ["audio/Empty/Deep", "cover.jpg"],
    ]);
    expect(index.index.dirs[0].cover).toBe("cover.jpg");
    expect(index.index.dirs[2].dirs[0].cover).toBe("cover.jpg");
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("leaves a directory coverless when the read fails or there is no picture", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const index = rootIndex();
    const jobs = planCovers(root, index);
    const readCover = vi.fn(async (source: ByteSource) => {
      if (new TextDecoder().decode(await source.read(0, 2)).includes("Album")) throw new Error("503");
      return null;
    });
    await expect(extractCovers(jobs, deps({ readCover }), new SyncControl())).resolves.toBe(0);
    expect(index.index.dirs[0].cover).toBeUndefined();
    expect(index.index.dirs[2].dirs[0].cover).toBeUndefined();
    warn.mockRestore();
  });

  it("stops with SyncCancelled instead of swallowing the abort", async () => {
    const control = new SyncControl();
    const readCover = vi.fn(async () => {
      control.cancel();
      throw new Error("aborted");
    });
    await expect(extractCovers(planCovers(root, rootIndex()), deps({ readCover }), control)).rejects.toBeInstanceOf(SyncCancelled);
  });
});
