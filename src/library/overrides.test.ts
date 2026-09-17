import { describe, expect, it } from "vitest";
import { getOverride, withOverrides, withoutOverride } from "./overrides";
import type { Overrides } from "../types";

describe("overrides", () => {
  it("stores only the fields a user set, keyed on rootId and key", () => {
    const next = withOverrides({}, [{ rootId: "r1", key: "a/b.mp3", fields: { artist: " Band ", track: "7" } }]);
    expect(next).toEqual({ r1: { "a/b.mp3": { artist: "Band", track: 7 } } });
    expect(getOverride(next, "r1", "a/b.mp3")).toEqual({ artist: "Band", track: 7 });
    expect(getOverride(next, "r1", "missing")).toBeUndefined();
  });

  it("merges into existing entries and never mutates the input", () => {
    const start: Overrides = { r1: { k: { artist: "A" } } };
    const next = withOverrides(start, [{ rootId: "r1", key: "k", fields: { album: "B" } }]);
    expect(next.r1.k).toEqual({ artist: "A", album: "B" });
    expect(start.r1.k).toEqual({ artist: "A" });
  });

  it("clearing a field removes it, and empty entries disappear", () => {
    const start: Overrides = { r1: { k: { artist: "A" } } };
    expect(withOverrides(start, [{ rootId: "r1", key: "k", fields: { artist: "  " } }])).toEqual({});
    expect(withOverrides(start, [{ rootId: "r1", key: "k", fields: { track: "zero" } }])).toEqual(start);
  });

  it("applies bulk edits across many files", () => {
    const edits = ["1.mp3", "2.mp3"].map((key) => ({ rootId: "r1", key, fields: { album: "Live" } }));
    expect(withOverrides({}, edits)).toEqual({ r1: { "1.mp3": { album: "Live" }, "2.mp3": { album: "Live" } } });
  });

  it("revert drops the whole entry for one file", () => {
    const start: Overrides = { r1: { k: { artist: "A" }, j: { title: "T" } } };
    expect(withoutOverride(start, "r1", "k")).toEqual({ r1: { j: { title: "T" } } });
    expect(withoutOverride(start, "r1", "j")).toEqual({ r1: { k: { artist: "A" } } });
    expect(withoutOverride({ r1: { k: {} } }, "r1", "k")).toEqual({});
    expect(withoutOverride({}, "nope", "k")).toEqual({});
  });
});
