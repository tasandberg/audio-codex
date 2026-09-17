import { describe, expect, it } from "vitest";
import { Library } from "../library/library";
import { DRAG_TYPE, type HitDocument, coverUpdate, dropPoint, dropTargetAt, firstCover, newTracks, resolvePayload, soundData, within } from "./playlist-drop";
import type { LibraryIndex, Root } from "../types";

const root: Root = { id: "r1", label: "Bucket", source: "s3", bucket: "bkt", prefix: "audio" };
const files = Array.from({ length: 40 }, (_, n) => ({ name: `${String(40 - n).padStart(2, "0")} x.mp3`, title: `Song ${40 - n}`, track: 40 - n }));
const index: LibraryIndex = {
  version: 1,
  generatedAt: 1,
  roots: [
    {
      rootId: "r1",
      urlBase: "https://bkt.s3/",
      index: {
        dir: "",
        files: [{ name: "single.mp3" }],
        dirs: [
          {
            dir: "Album",
            files,
            dirs: [
              {
                dir: "Disc 2",
                cover: "cover.jpg",
                files: [{ name: "bonus.mp3", track: 1 }],
                dirs: [{ dir: "Deluxe", files: [{ name: "hidden.mp3", track: 5 }], dirs: [] }],
              },
            ],
          },
        ],
      },
    },
  ],
};
const library = Library.build(index, [root], {});

describe("resolvePayload", () => {
  it("expands a folder recursively through nested subfolders and flattens it in track order", () => {
    const tracks = resolvePayload({ type: DRAG_TYPE, folders: [{ rootId: "r1", dir: "audio/Album" }] }, library);
    expect(tracks).toHaveLength(42);
    expect(tracks.slice(0, 3).map((track) => track.track)).toEqual([1, 2, 3]);
    expect(tracks[39].track).toBe(40);
    expect(tracks[40].name).toBe("bonus.mp3");
    expect(tracks[41].name).toBe("hidden.mp3");
  });

  it("resolves single rows to the same track identity the library holds and skips unknown ones", () => {
    const tracks = resolvePayload({ type: DRAG_TYPE, rows: [{ rootId: "r1", key: "audio/single.mp3" }, { rootId: "r1", key: "gone.mp3" }] }, library);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toBe(library.track("r1", "audio/single.mp3"));
  });
});

describe("soundData", () => {
  it("creates one sound per track, no dedupe, sorted after existing sounds", () => {
    const tracks = resolvePayload({ type: DRAG_TYPE, folders: [{ rootId: "r1", dir: "audio/Album" }] }, library).slice(0, 40);
    const sounds = soundData([...tracks, tracks[0]], library, [100000, 300000]);
    expect(sounds).toHaveLength(41);
    expect(sounds[0]).toEqual({ name: "Song 1", path: "https://bkt.s3/audio/Album/01%20x.mp3", sort: 400000 });
    expect(sounds[1].sort).toBe(500000);
    expect(sounds.map((sound) => sound.sort)).toEqual([...sounds.map((sound) => sound.sort)].sort((a, b) => a - b));
  });

  it("starts from zero for an empty playlist", () => {
    expect(soundData([library.track("r1", "audio/single.mp3")!], library, [])[0]).toEqual({ name: "single", path: "https://bkt.s3/audio/single.mp3", sort: 100000 });
  });

  it("carries the track's cover as a module flag, and no flag at all without one", () => {
    const covered = soundData([library.track("r1", "audio/Album/Disc 2/bonus.mp3")!], library, [])[0];
    expect(covered.flags).toEqual({ "audio-codex": { cover: "https://bkt.s3/audio/Album/Disc%202/cover.jpg" } });
    expect(soundData([library.track("r1", "audio/single.mp3")!], library, [])[0].flags).toBeUndefined();
  });
});

describe("newTracks", () => {
  it("drops tracks already in the playlist and repeats within the drop, keeping order", () => {
    const single = library.track("r1", "audio/single.mp3")!;
    const bonus = library.track("r1", "audio/Album/Disc 2/bonus.mp3")!;
    const hidden = library.track("r1", "audio/Album/Disc 2/Deluxe/hidden.mp3")!;
    expect(newTracks([bonus, single, bonus, hidden, single], library, ["https://bkt.s3/audio/single.mp3"])).toEqual([bonus, hidden]);
    expect(newTracks([single], library, [null, undefined])).toEqual([single]);
    expect(newTracks([], library, [])).toEqual([]);
  });
});

describe("playlist covers", () => {
  const covered = library.track("r1", "audio/Album/Disc 2/bonus.mp3")!;
  const bare = library.track("r1", "audio/single.mp3")!;

  it("takes the first track that has one", () => {
    expect(firstCover([bare, covered])).toBe("https://bkt.s3/audio/Album/Disc%202/cover.jpg");
    expect(firstCover([bare])).toBeNull();
  });

  it("never overwrites a cover the playlist already has", () => {
    expect(coverUpdate(null, [covered])).toBe("https://bkt.s3/audio/Album/Disc%202/cover.jpg");
    expect(coverUpdate(undefined, [bare])).toBeNull();
    expect(coverUpdate("https://kept/art.png", [covered])).toBeNull();
  });
});

describe("drop targeting", () => {
  const hit = (closest: (selector: string) => unknown): HitDocument => ({ elementFromPoint: () => ({ closest }) as unknown as Element });
  const windowRect = { left: 0, top: 0, right: 1000, bottom: 600 };
  const panelRow = (selector: string) => (selector === ".ac-playlist[data-playlist-id]" ? { dataset: { playlistId: "panel" } } : { dataset: { entryId: "sidebar" } });
  const sidebarRow = (selector: string) => (selector === ".document.playlist" ? { dataset: { entryId: "sidebar" } } : null);

  it("takes a panel row ahead of anything behind it, inside the window or out", () => {
    expect(dropTargetAt({ x: 100, y: 300 }, hit(panelRow), windowRect)).toBe("panel");
    expect(dropTargetAt({ x: 1500, y: 300 }, hit(panelRow), windowRect)).toBe("panel");
  });

  it("ignores a release anywhere inside the window that is not a panel row, whatever sits behind it", () => {
    expect(dropTargetAt({ x: 400, y: 20 }, hit(sidebarRow), windowRect)).toBeNull();
    expect(dropTargetAt({ x: 400, y: 300 }, hit(() => null), windowRect)).toBeNull();
  });

  it("drops on a sidebar playlist when the release is outside the window", () => {
    expect(dropTargetAt({ x: 1500, y: 300 }, hit(sidebarRow), windowRect)).toBe("sidebar");
  });

  it("is null when nothing under the pointer is a playlist", () => {
    expect(dropTargetAt({ x: 1500, y: 300 }, hit(() => null), windowRect)).toBeNull();
    expect(dropTargetAt({ x: 1500, y: 300 }, { elementFromPoint: () => null }, windowRect)).toBeNull();
  });

  it("tells a point inside the window box from one outside it", () => {
    expect(within({ x: 50, y: 50 }, windowRect)).toBe(true);
    expect(within({ x: 1500, y: 50 }, windowRect)).toBe(false);
  });

  it("falls back to the last dragover point when dragend reports 0,0", () => {
    expect(dropPoint({ clientX: 10, clientY: 20 }, { x: 1, y: 1 })).toEqual({ x: 10, y: 20 });
    expect(dropPoint({ clientX: 0, clientY: 0 }, { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
    expect(dropPoint({ clientX: 0, clientY: 0 }, null)).toBeNull();
  });
});
