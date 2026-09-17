import { describe, expect, it, vi } from "vitest";
import { SyncCancelled, SyncControl } from "./control";
import { type Browse, crawlRoot, deriveUrlBase, lastSegment } from "./crawler";
import { FileLocation } from "../storage/file-location";
import type { Root } from "../types";

const s3Root: Root = { id: "s3", label: "S3", source: "s3", bucket: "bkt", prefix: "audio" };
const base = "https://bkt.s3.us-west-1.amazonaws.com/";

const s3Listing: Record<string, { dirs: string[]; files: string[] }> = {
  audio: { dirs: ["audio/Artist A", "audio/Skip"], files: [`${base}audio/intro.mp3`, `${base}audio/cover.jpg`] },
  "audio/Artist%20A": { dirs: ["audio/Artist A/Album #1"], files: [] },
  "audio/Artist%20A/Album%20%231": { dirs: [], files: [`${base}audio/Artist%20A/Album%20%231/02%20Two.mp3`, `${base}audio/Artist%20A/Album%20%231/01%20One.flac`] },
  "audio/Skip": { dirs: ["audio/Skip/Nested"], files: [`${base}audio/Skip/noscan.txt`, `${base}audio/Skip/hidden.mp3`] },
};

const browseFrom = (listing: typeof s3Listing): Browse =>
  vi.fn(async (_source, target) => {
    const entry = listing[target];
    if (!entry) throw new Error(`missing ${target}`);
    return entry;
  });

describe("crawlRoot", () => {
  it("keeps directory structure, filters audio, honours noscan.txt and learns the URL base", async () => {
    const browse = browseFrom(s3Listing);
    const result = await crawlRoot(s3Root, { browse, control: new SyncControl() });
    expect(result.errors).toEqual([]);
    expect(result.urlBase).toBe(base);
    expect(result.tree).toEqual({
      dir: "",
      cover: "cover.jpg",
      files: [{ name: "intro.mp3" }],
      dirs: [{ dir: "Artist A", files: [], dirs: [{ dir: "Album #1", files: [{ name: "01 One.flac" }, { name: "02 Two.mp3" }], dirs: [] }] }],
    });
    expect(browse).not.toHaveBeenCalledWith("s3", "audio/Skip/Nested", expect.anything());
    expect(browse).toHaveBeenCalledWith("s3", "audio", { bucket: "bkt" });
  });

  it("decodes data-source dirs and files, whose paths come back URL-encoded", async () => {
    const root: Root = { id: "d", label: "Data", source: "data", bucket: null, prefix: "" };
    const browse = browseFrom({
      "": { dirs: ["My%20Music"], files: [] },
      "My%20Music": { dirs: [], files: ["My%20Music/Song%20%231.ogg"] },
    });
    const result = await crawlRoot(root, { browse, control: new SyncControl() });
    expect(result.tree.dirs[0]).toEqual({ dir: "My Music", files: [{ name: "Song #1.ogg" }], dirs: [] });
    expect(result.urlBase).toBe("");
    expect(browse).toHaveBeenCalledWith("data", "", {});
  });

  it("records a failing directory and carries on with the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listing = { ...s3Listing };
    delete (listing as Record<string, unknown>)["audio/Artist%20A"];
    const result = await crawlRoot(s3Root, { browse: browseFrom(listing), control: new SyncControl() });
    expect(result.errors).toEqual(["audio/Artist A"]);
    expect(result.tree.files).toEqual([{ name: "intro.mp3" }]);
    expect(result.tree.dirs).toEqual([]);
    warn.mockRestore();
  });

  it("reports progress per directory", async () => {
    const onProgress = vi.fn();
    await crawlRoot(s3Root, { browse: browseFrom(s3Listing), control: new SyncControl(), onProgress });
    expect(onProgress).toHaveBeenLastCalledWith({ dirs: 3, files: 3 });
  });

  it("stops with SyncCancelled when cancelled mid-crawl", async () => {
    const control = new SyncControl();
    const browse: Browse = async (source, target, options) => {
      control.cancel();
      return browseFrom(s3Listing)(source, target, options);
    };
    await expect(crawlRoot(s3Root, { browse, control })).rejects.toBeInstanceOf(SyncCancelled);
  });
});

describe("crawl helpers", () => {
  it("lastSegment keeps # and ? and strips trailing slashes", () => {
    expect(lastSegment("audio/Album #1")).toBe("Album #1");
    expect(lastSegment("audio/Artist/")).toBe("Artist");
    expect(lastSegment("top")).toBe("top");
  });

  it("deriveUrlBase returns null when the URL does not end with the encoded key", () => {
    expect(deriveUrlBase("https://cdn/x/other.mp3", new FileLocation("s3", "a/b.mp3", "bkt"))).toBeNull();
    expect(deriveUrlBase("http://minio:9000/bkt/a/b%20c.mp3", new FileLocation("s3", "a/b c.mp3", "bkt"))).toBe("http://minio:9000/bkt/");
  });
});
