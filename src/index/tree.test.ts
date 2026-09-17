import { describe, expect, it } from "vitest";
import { countFiles, emptyDir, ensureDir, putFile, sortTree, walkDirs, walkFiles } from "./tree";
import type { IndexedDir } from "../types";

const tree = (): IndexedDir => ({
  dir: "",
  files: [{ name: "b.mp3" }, { name: "a.mp3" }],
  dirs: [
    { dir: "Zed", files: [{ name: "z.mp3" }], dirs: [] },
    { dir: "Album 10", files: [], dirs: [] },
    { dir: "Album 9", files: [{ name: "Track 10.mp3" }, { name: "Track 2.mp3" }], dirs: [] },
  ],
});

describe("index tree", () => {
  it("sorts files and dirs naturally and recursively", () => {
    const sorted = sortTree(tree());
    expect(sorted.files.map((file) => file.name)).toEqual(["a.mp3", "b.mp3"]);
    expect(sorted.dirs.map((dir) => dir.dir)).toEqual(["Album 9", "Album 10", "Zed"]);
    expect(sorted.dirs[0].files.map((file) => file.name)).toEqual(["Track 2.mp3", "Track 10.mp3"]);
  });

  it("walks dirs and files with keys joined under a prefix", () => {
    const sorted = sortTree(tree());
    expect([...walkDirs(sorted, "audio")].map((dir) => [dir.key, dir.depth])).toEqual([
      ["audio", 0],
      ["audio/Album 9", 1],
      ["audio/Album 10", 1],
      ["audio/Zed", 1],
    ]);
    expect([...walkFiles(sorted, "")].map((file) => file.key)).toEqual([
      "a.mp3",
      "b.mp3",
      "Album 9/Track 2.mp3",
      "Album 9/Track 10.mp3",
      "Zed/z.mp3",
    ]);
  });

  it("counts files across roots", () => {
    expect(countFiles({ version: 1, generatedAt: 0, roots: [{ rootId: "a", urlBase: null, index: tree() }, { rootId: "b", urlBase: null, index: emptyDir() }] })).toBe(5);
  });

  it("ensureDir creates missing dirs and reuses existing ones", () => {
    const root = tree();
    const created = ensureDir(root, ["Zed", "New"]);
    expect(created.dir).toBe("New");
    expect(root.dirs.find((dir) => dir.dir === "Zed")?.dirs).toHaveLength(1);
    expect(ensureDir(root, ["Zed", "New"])).toBe(created);
    expect(ensureDir(root, [])).toBe(root);
  });

  it("putFile adds or replaces by name", () => {
    const dir = emptyDir("x");
    putFile(dir, "a.mp3", { title: "One" });
    putFile(dir, "a.mp3", { title: "Two" });
    expect(dir.files).toEqual([{ name: "a.mp3", title: "Two" }]);
  });
});
