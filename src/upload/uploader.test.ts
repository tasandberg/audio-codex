import { describe, expect, it, vi } from "vitest";
import { FileLocation } from "../storage/file-location";
import { SyncCancelled, SyncControl } from "../sync/control";
import { type EntryLike, collectFiles, hasAudioFile, keepCovers, planUpload, runUpload } from "./uploader";

const fileEntry = (name: string): EntryLike & { file: (ok: (file: File) => void) => void } => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok(new File(["x"], name)),
});

const dirEntry = (name: string, children: EntryLike[], batch = 100): EntryLike => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let offset = 0;
    return {
      readEntries: (ok: (entries: EntryLike[]) => void) => {
        const slice = children.slice(offset, offset + batch);
        offset += batch;
        ok(slice);
      },
    };
  },
} as EntryLike);

describe("collectFiles", () => {
  it("walks dropped folders, keeps relative paths and filters to audio and images", async () => {
    const dropped = [dirEntry("Band", [fileEntry("cover.jpg"), fileEntry("notes.txt"), fileEntry("01 a.mp3"), dirEntry("Disc 2", [fileEntry("01 b.flac")])])];
    const files = await collectFiles(dropped);
    expect(files.map(({ path, file }) => [path.join("/"), file.name])).toEqual([
      ["Band", "cover.jpg"],
      ["Band", "01 a.mp3"],
      ["Band/Disc 2", "01 b.flac"],
    ]);
  });

  it("keeps calling readEntries until it returns an empty batch", async () => {
    const many = Array.from({ length: 250 }, (_, n) => fileEntry(`${n}.mp3`));
    await expect(collectFiles([dirEntry("Big", many, 100)])).resolves.toHaveLength(250);
  });
});

describe("keepCovers", () => {
  it("keeps one image per directory, chosen by the cover rule, and every audio file", () => {
    const dropped = [
      { path: ["Band"], file: new File(["x"], "back.png") },
      { path: ["Band"], file: new File(["x"], "Cover.JPG") },
      { path: ["Band"], file: new File(["x"], "01 a.mp3") },
      { path: ["Band", "Disc 2"], file: new File(["x"], "zoo.png") },
      { path: ["Band", "Disc 2"], file: new File(["x"], "art.gif") },
      { path: ["Band", "Disc 2"], file: new File(["x"], "01 b.flac") },
    ];
    expect(keepCovers(dropped).map(({ path, file }) => [path.join("/"), file.name])).toEqual([
      ["Band", "Cover.JPG"],
      ["Band", "01 a.mp3"],
      ["Band/Disc 2", "art.gif"],
      ["Band/Disc 2", "01 b.flac"],
    ]);
  });

  it("drops every image in a directory that has no audio file", () => {
    const dropped = [
      { path: ["Band"], file: new File(["x"], "01 a.mp3") },
      { path: ["Band", "Scans"], file: new File(["x"], "front.jpg") },
      { path: ["Band", "Scans"], file: new File(["x"], "back.jpg") },
    ];
    expect(keepCovers(dropped).map(({ path, file }) => [path.join("/"), file.name])).toEqual([["Band", "01 a.mp3"]]);
  });
});

describe("hasAudioFile", () => {
  it("is false for an image-only drop and true once an audio file is present", () => {
    const images = [{ path: ["Band"], file: new File(["x"], "cover.jpg") }];
    expect(hasAudioFile(images)).toBe(false);
    expect(hasAudioFile([...images, { path: ["Band"], file: new File(["x"], "01 a.mp3") }])).toBe(true);
  });
});

describe("planUpload", () => {
  const files = [
    { path: ["Band"], file: new File(["x"], "01 a.mp3") },
    { path: ["Band", "Disc 2"], file: new File(["x"], "01 b.flac") },
  ];

  it("mirrors structure parent-first for data storage", () => {
    const plan = planUpload(files, new FileLocation("data", "music"));
    expect(plan.directories.map((dir) => dir.key)).toEqual(["music/Band", "music/Band/Disc 2"]);
    expect(plan.uploads.map((job) => [job.directory.key, job.key])).toEqual([
      ["music/Band", "music/Band/01 a.mp3"],
      ["music/Band/Disc 2", "music/Band/Disc 2/01 b.flac"],
    ]);
  });

  it("skips createDirectory on S3, where it slugifies names and prefixes are implicit", () => {
    const plan = planUpload(files, new FileLocation("s3", "audio", "bkt"));
    expect(plan.directories).toEqual([]);
    expect(plan.uploads[1].directory.target).toBe("audio/Band/Disc%202");
    expect(plan.uploads[1].directory.browseOptions).toEqual({ bucket: "bkt" });
  });
});

describe("runUpload", () => {
  const plan = planUpload(
    [
      { path: ["A"], file: new File(["x"], "1.mp3") },
      { path: ["A"], file: new File(["x"], "2.mp3") },
    ],
    new FileLocation("data", "music"),
  );

  it("creates directories first, then uploads, reporting progress", async () => {
    const calls: string[] = [];
    const deps = {
      createDirectory: vi.fn(async (location: FileLocation) => {
        calls.push(`mkdir ${location.key}`);
      }),
      upload: vi.fn(async (location: FileLocation, file: File) => {
        calls.push(`put ${location.key}/${file.name}`);
        return file.name === "2.mp3" ? null : `${location.target}/${file.name}`;
      }),
    };
    const progress = vi.fn();
    const result = await runUpload(plan, deps, new SyncControl(), progress);
    expect(calls[0]).toBe("mkdir music/A");
    expect(result.uploaded.map((job) => [job.key, job.path])).toEqual([["music/A/1.mp3", "music/A/1.mp3"]]);
    expect(result.failed.map((job) => job.key)).toEqual(["music/A/2.mp3"]);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("stops when cancelled", async () => {
    const control = new SyncControl();
    control.cancel();
    await expect(runUpload(plan, { createDirectory: async () => {}, upload: async () => "p" }, control)).rejects.toBeInstanceOf(SyncCancelled);
  });
});
