import { describe, expect, it } from "vitest";
import { planTags } from "./diff";
import type { IndexedDir, LibraryIndex, Root } from "../types";

const r1: Root = { id: "r1", label: "R1", source: "data", bucket: null, prefix: "music" };
const r2: Root = { ...r1, id: "r2" };

const previous: LibraryIndex = {
  version: 1,
  generatedAt: 1,
  roots: [
    {
      rootId: "r1",
      urlBase: "",
      index: {
        dir: "",
        files: [{ name: "old.mp3", artist: "Kept", duration: 61 }],
        dirs: [{ dir: "A", files: [{ name: "flaky.mp3", pending: true }, { name: "gone.mp3", title: "Gone" }], dirs: [] }],
      },
    },
  ],
};

const crawled = (): IndexedDir => ({
  dir: "",
  files: [{ name: "old.mp3" }, { name: "new.mp3" }],
  dirs: [{ dir: "A", files: [{ name: "flaky.mp3" }], dirs: [] }],
});

describe("planTags", () => {
  it("carries tags for known paths and queues only new or pending ones", () => {
    const tree = crawled();
    const plan = planTags(r1, tree, previous);
    expect(plan.carried).toBe(1);
    expect(plan.jobs.map((job) => job.key)).toEqual(["music/new.mp3", "music/A/flaky.mp3"]);
    expect(tree.files[0]).toEqual({ name: "old.mp3", artist: "Kept", duration: 61 });
  });

  it("drops files that disappeared, because only crawled paths are walked", () => {
    const tree = crawled();
    planTags(r1, tree, previous);
    expect(JSON.stringify(tree)).not.toContain("gone.mp3");
  });

  it("queues everything for an unknown root or with no previous index", () => {
    expect(planTags(r2, crawled(), previous).jobs).toHaveLength(3);
    expect(planTags(r1, crawled(), null).jobs).toHaveLength(3);
  });

  it("queues everything on a forced rescan", () => {
    const plan = planTags(r1, crawled(), previous, true);
    expect(plan.carried).toBe(0);
    expect(plan.jobs).toHaveLength(3);
  });

  it("job files are the live tree entries so tag reads land in place", () => {
    const tree = crawled();
    const plan = planTags(r1, tree, null);
    Object.assign(plan.jobs[0].file, { title: "Read" });
    expect(tree.files[0].title).toBe("Read");
  });
});
