import { describe, expect, it } from "vitest";
import { Library, VARIOUS_ARTISTS, folderId } from "./library";
import type { LibraryIndex, Overrides, Root } from "../types";

const roots: Root[] = [
  { id: "r1", label: "Bucket", source: "s3", bucket: "bkt", prefix: "audio" },
  { id: "r2", label: "Local", source: "data", bucket: null, prefix: "" },
];

const index: LibraryIndex = {
  version: 1,
  generatedAt: 1,
  roots: [
    {
      rootId: "r1",
      urlBase: "https://bkt.s3.us-west-1.amazonaws.com/",
      index: {
        dir: "",
        files: [{ name: "loose.mp3" }],
        dirs: [
          {
            dir: "Band",
            files: [],
            dirs: [
              {
                dir: "Album",
                files: [
                  { name: "b.mp3", title: "Second", track: 2, artist: "Band", album: "Album", duration: 200 },
                  { name: "a.mp3", title: "First", track: 1, artist: "Band", album: "Album", duration: 100 },
                  { name: "c.mp3", artist: "Band", album: "Album", duration: 50 },
                ],
                dirs: [],
              },
            ],
          },
        ],
      },
    },
    { rootId: "r2", urlBase: "", index: { dir: "", files: [{ name: "My Song.ogg", pending: true }], dirs: [] } },
  ],
};

const overrides: Overrides = { r1: { "audio/Band/Album/c.mp3": { title: "Third", track: 3 } } };

describe("Library", () => {
  const library = Library.build(index, roots, overrides);

  it("builds one folder tree per root, labelled by the root", () => {
    expect(library.folders.map((folder) => [folder.id, folder.name, folder.total])).toEqual([
      ["r1:audio", "Bucket", 4],
      ["r2:", "Local", 1],
    ]);
    expect(library.size).toBe(5);
  });

  it("overlays overrides on the derived index and marks the track", () => {
    const track = library.track("r1", "audio/Band/Album/c.mp3");
    expect(track).toMatchObject({ title: "Third", track: 3, label: "Third", overridden: true, artist: "Band" });
    expect(library.track("r1", "audio/Band/Album/a.mp3")?.overridden).toBe(false);
  });

  it("labels resolve override, then embedded title, then filename without extension", () => {
    expect(library.track("r1", "audio/Band/Album/a.mp3")?.label).toBe("First");
    expect(library.track("r2", "My Song.ogg")?.label).toBe("My Song");
  });

  it("renders nothing beneath a collapsed folder", () => {
    const rows = library.rows(new Set());
    expect(rows.map((row) => row.kind)).toEqual(["folder", "folder"]);
  });

  it("expanded folders list subfolders then tracks in track order", () => {
    const expanded = new Set([folderId("r1", "audio"), folderId("r1", "audio/Band"), folderId("r1", "audio/Band/Album")]);
    const rows = library.rows(expanded);
    expect(rows.map((row) => (row.kind === "folder" ? `+${row.folder.name}@${row.depth}` : `${row.track.label}@${row.depth}`))).toEqual([
      "+Bucket@0",
      "+Band@1",
      "+Album@2",
      "First@3",
      "Second@3",
      "Third@3",
      "loose@1",
      "+Local@0",
    ]);
  });

  it("sorts by any column with localeCompare and caches per folder and sort", () => {
    const album = library.folder(folderId("r1", "audio/Band/Album"))!;
    const byDuration = library.sortedTracks(album, { column: "duration", direction: -1 });
    expect(byDuration.map((track) => track.label)).toEqual(["Second", "First", "Third"]);
    expect(library.sortedTracks(album, { column: "duration", direction: -1 })).toBe(byDuration);
    expect(library.sortedTracks(album, { column: "label", direction: 1 }).map((track) => track.label)).toEqual(["First", "Second", "Third"]);
  });

  it("collects every track beneath a folder, flattened in album order", () => {
    const tracks = library.tracksBeneath(library.folders[0]);
    expect(tracks.map((track) => track.label)).toEqual(["loose", "First", "Second", "Third"]);
  });

  it("searches name, path and tags with every term required and a cap", () => {
    expect(library.search("band third").map((track) => track.label)).toEqual(["Third"]);
    expect(library.search("ALBUM").length).toBe(3);
    expect(library.search("album", 2).length).toBe(2);
    expect(library.search("   ")).toEqual([]);
    expect(library.search("my song").map((track) => track.key)).toEqual(["My Song.ogg"]);
  });

  it("rebuilds URLs from the root, using the learned base", () => {
    expect(library.url(library.track("r1", "audio/Band/Album/a.mp3")!)).toBe("https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/a.mp3");
    expect(library.url(library.track("r2", "My Song.ogg")!)).toBe("My%20Song.ogg");
  });

  it("finds a track by the URL core stored on the sound, encoded or decoded", () => {
    expect(library.trackByUrl("https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/a.mp3")?.key).toBe("audio/Band/Album/a.mp3");
    expect(library.trackByUrl("My%20Song.ogg")?.key).toBe("My Song.ogg");
    expect(library.trackByUrl("My Song.ogg")?.key).toBe("My Song.ogg");
    expect(library.trackByUrl("https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/missing.mp3")).toBeNull();
    expect(library.trackByUrl(null)).toBeNull();
  });

  it("calls a cover-named URL stale when its indexed folder no longer uses it", () => {
    const base = "https://bkt.s3.us-west-1.amazonaws.com/audio";
    const covered: LibraryIndex = {
      version: 2,
      generatedAt: 1,
      roots: [
        {
          rootId: "r1",
          urlBase: "https://bkt.s3.us-west-1.amazonaws.com/",
          index: { dir: "", files: [{ name: "loose.mp3" }], dirs: [{ dir: "My Album", cover: "cover.jpg", files: [{ name: "a.mp3" }], dirs: [] }] },
        },
      ],
    };
    const art = Library.build(covered, [roots[0]], {});
    expect(art.staleCover(`${base}/cover.jpg`)).toBe(true);
    expect(art.staleCover(`${base}/My%20Album/COVER.PNG`)).toBe(true);
    expect(art.staleCover(`${base}/My%20Album/cover.jpg`)).toBe(false);
    expect(art.staleCover(`${base}/My Album/cover.jpg`)).toBe(false);
    expect(art.staleCover(`${base}/My%20Album/back.jpg`)).toBe(false);
    expect(art.staleCover(`${base}/Elsewhere/cover.jpg`)).toBe(false);
    expect(art.staleCover("icons/svg/sound.svg")).toBe(false);
    expect(art.staleCover(null)).toBe(false);
  });

  it("keeps the first track when two roots resolve to the same URL", () => {
    const twin: Root = { id: "r3", label: "Copy", source: "data", bucket: null, prefix: "" };
    const shared: LibraryIndex = {
      version: 2,
      generatedAt: 1,
      roots: [
        { rootId: "r2", urlBase: "", index: { dir: "", files: [{ name: "twin.ogg" }], dirs: [] } },
        { rootId: "r3", urlBase: "", index: { dir: "", files: [{ name: "twin.ogg" }], dirs: [] } },
      ],
    };
    const collided = Library.build(shared, [roots[1], twin], {});
    expect(collided.trackByUrl("twin.ogg")?.rootId).toBe("r2");
  });

  it("shows registered roots even before the first sync", () => {
    const empty = Library.build(null, roots, {});
    expect(empty.folders.map((folder) => folder.total)).toEqual([0, 0]);
  });

  it("stays fast for a folder of 1000 tracks", () => {
    const files = Array.from({ length: 1000 }, (_, n) => ({ name: `${n}.mp3`, track: 1000 - n }));
    const big = Library.build({ version: 1, generatedAt: 1, roots: [{ rootId: "r2", urlBase: "", index: { dir: "", files, dirs: [] } }] }, [roots[1]], {});
    const started = performance.now();
    const rows = big.rows(new Set([folderId("r2", "")]));
    expect(rows).toHaveLength(1001);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("albums", () => {
  const tagged: LibraryIndex = {
    version: 2,
    generatedAt: 1,
    roots: [
      {
        rootId: "r1",
        urlBase: "",
        index: {
          dir: "",
          files: [],
          dirs: [
            { dir: "Spellwind", files: [{ name: "a.mp3", album: "Spellwind", artist: "Fogweaver" }, { name: "b.mp3", album: "Spellwind", artist: "Fogweaver" }], dirs: [] },
            { dir: "Hits", files: [{ name: "a.mp3", album: "Hits", artist: "One" }, { name: "b.mp3", album: "Hits", artist: "Two" }], dirs: [] },
            { dir: "Mixed", files: [{ name: "a.mp3", album: "One" }, { name: "b.mp3", album: "Two" }], dirs: [] },
            { dir: "Untagged", files: [{ name: "a.mp3" }, { name: "b.mp3", album: "" }], dirs: [] },
            { dir: "Patched", files: [{ name: "a.mp3", album: "Alpha", artist: "Solo" }, { name: "b.mp3", album: "Beta", artist: "Solo" }], dirs: [] },
            {
              dir: "Boxed",
              files: [{ name: "a.mp3", album: "Boxed", artist: "Solo" }, { name: "b.mp3", album: "Boxed", artist: "Solo" }],
              dirs: [{ dir: "Disc 2", files: [{ name: "c.mp3", album: "Boxed", artist: "Solo" }], dirs: [] }],
            },
          ],
        },
      },
    ],
  };
  const library = Library.build(tagged, [roots[0]], { r1: { "audio/Patched/b.mp3": { album: "Alpha" } } });
  const album = (key: string) => library.folder(folderId("r1", key))?.album;

  it("names a folder whose every track shares one album tag", () => {
    expect(album("audio/Spellwind")).toEqual({ title: "Spellwind", artist: "Fogweaver" });
  });

  it("calls the artist Various when the tracks disagree", () => {
    expect(album("audio/Hits")).toEqual({ title: "Hits", artist: VARIOUS_ARTISTS });
  });

  it("is not an album when the album tags differ or are empty", () => {
    expect(album("audio/Mixed")).toBeNull();
    expect(album("audio/Untagged")).toBeNull();
  });

  it("is not an album when the folder only holds subfolders", () => {
    expect(album("audio")).toBeNull();
  });

  it("is still an album when its own tracks agree and it also holds subfolders", () => {
    expect(album("audio/Boxed")).toEqual({ title: "Boxed", artist: "Solo" });
  });

  it("reads the merged tags, so an override can complete an album", () => {
    expect(album("audio/Patched")).toEqual({ title: "Alpha", artist: "Solo" });
  });
});

describe("cover inheritance", () => {
  const covered: LibraryIndex = {
    version: 2,
    generatedAt: 1,
    roots: [
      {
        rootId: "r1",
        urlBase: "https://bkt.s3.us-west-1.amazonaws.com/",
        index: {
          dir: "",
          files: [{ name: "loose.mp3" }],
          dirs: [
            {
              dir: "Band",
              files: [],
              dirs: [
                {
                  dir: "Album",
                  cover: "cover.jpg",
                  files: [{ name: "a.mp3" }],
                  dirs: [{ dir: "Disc 2", files: [{ name: "b.mp3" }], dirs: [{ dir: "Bonus", cover: "folder.png", files: [{ name: "c.mp3" }], dirs: [] }] }],
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const library = Library.build(covered, [roots[0]], {});

  it("builds folder covers as URLs from the root, and none where the directory has no image", () => {
    expect(library.folder(folderId("r1", "audio/Band/Album"))?.cover).toBe("https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/cover.jpg");
    expect(library.folder(folderId("r1", "audio/Band/Album/Disc 2"))?.cover).toBeNull();
    expect(library.folder(folderId("r1", "audio"))?.cover).toBeNull();
  });

  it("gives every track its nearest ancestor cover, own directory first", () => {
    const album = "https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/cover.jpg";
    expect(library.track("r1", "audio/Band/Album/a.mp3")?.cover).toBe(album);
    expect(library.track("r1", "audio/Band/Album/Disc 2/b.mp3")?.cover).toBe(album);
    expect(library.track("r1", "audio/Band/Album/Disc 2/Bonus/c.mp3")?.cover).toBe(
      "https://bkt.s3.us-west-1.amazonaws.com/audio/Band/Album/Disc%202/Bonus/folder.png",
    );
    expect(library.track("r1", "audio/loose.mp3")?.cover).toBeNull();
  });
});
