import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_FLAG, MODULE_ID } from "../constants";
import { Library, folderId } from "../library/library";
import { service } from "../service";
import { type RelinkLibrary, type RelinkPlaylist, type RelinkSound, createPlaylistFromFolder, dropOnPlaylist, relinkPlaylists } from "./playlist-actions";
import type { LibraryIndex, Root } from "../types";

const root: Root = { id: "r1", label: "Bucket", source: "s3", bucket: "bkt", prefix: "audio" };

const index: LibraryIndex = {
  version: 2,
  generatedAt: 1,
  roots: [
    {
      rootId: "r1",
      urlBase: "https://bkt.s3/",
      index: {
        dir: "",
        files: [],
        dirs: [
          { dir: "01 Spellwind", cover: "cover.jpg", files: [{ name: "a.mp3", album: "Spellwind", artist: "Fogweaver" }], dirs: [] },
          { dir: "Odds and Ends", files: [{ name: "a.mp3", album: "One" }, { name: "b.mp3", album: "Two" }], dirs: [] },
        ],
      },
    },
  ],
};

const create = vi.fn(async (data: { name: string }) => ({ name: data.name }));
const folder = (key: string) => service.library.folder(folderId("r1", key))!;
let previous: Library;

beforeEach(() => {
  previous = service.library;
  service.library = Library.build(index, [root], {});
  create.mockClear();
  vi.stubGlobal("foundry", { documents: { Playlist: { implementation: { create } } }, CONST: { PLAYLIST_SORT_MODES: { MANUAL: 2 } } });
  vi.stubGlobal("game", { i18n: { localize: (key: string) => key, format: (key: string) => key } });
  vi.stubGlobal("ui", { notifications: { info: vi.fn(), warn: vi.fn() } });
});

afterEach(() => {
  service.library = previous;
  vi.unstubAllGlobals();
});

describe("createPlaylistFromFolder", () => {
  it("names the playlist after the album, not the directory", async () => {
    await createPlaylistFromFolder(folder("audio/01 Spellwind"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ name: "Spellwind", sorting: 2 });
  });

  it("falls back to the folder name when the folder is not an album", async () => {
    await createPlaylistFromFolder(folder("audio/Odds and Ends"));
    expect(create.mock.calls[0][0]).toMatchObject({ name: "Odds and Ends" });
  });

  it("uses the singular message for a single track", async () => {
    await createPlaylistFromFolder(folder("audio/01 Spellwind"));
    expect(ui.notifications?.info).toHaveBeenCalledWith("AUDIO_CODEX.Drop.AddedOne");
    await createPlaylistFromFolder(folder("audio/Odds and Ends"));
    expect(ui.notifications?.info).toHaveBeenLastCalledWith("AUDIO_CODEX.Drop.Added");
  });
});

describe("dropOnPlaylist", () => {
  const target = (paths: string[]) => {
    const createEmbeddedDocuments = vi.fn(async (_name: string, _data: object[]) => []);
    const playlist = {
      name: "Mix",
      isOwner: true,
      sounds: paths.map((path, position) => ({ path, sort: (position + 1) * 100000 })),
      createEmbeddedDocuments,
      getFlag: () => "set.png",
      setFlag: vi.fn(),
    };
    vi.stubGlobal("game", { i18n: { localize: (key: string) => key, format: (key: string) => key }, playlists: { get: () => playlist } });
    return createEmbeddedDocuments;
  };
  const payload = { type: "audio-codex" as const, folders: [{ rootId: "r1", dir: "audio/Odds and Ends" }] };

  it("skips tracks whose path is already in the playlist", async () => {
    const create = target(["https://bkt.s3/audio/Odds%20and%20Ends/a.mp3"]);
    await expect(dropOnPlaylist("p1", payload)).resolves.toBe(1);
    expect(create.mock.calls[0][1]).toMatchObject([{ path: "https://bkt.s3/audio/Odds%20and%20Ends/b.mp3", sort: 200000 }]);
  });

  it("does nothing and says nothing when every track is already there", async () => {
    const create = target(["https://bkt.s3/audio/Odds%20and%20Ends/a.mp3", "https://bkt.s3/audio/Odds%20and%20Ends/b.mp3"]);
    await expect(dropOnPlaylist("p1", payload)).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(ui.notifications?.info).not.toHaveBeenCalled();
  });
});

function sound(id: string, path: string, cover: string | null = null): RelinkSound {
  const flags: Record<string, string> = cover ? { [COVER_FLAG]: cover } : {};
  return {
    id,
    path,
    getFlag: (scope: string, key: string) => (scope === MODULE_ID ? flags[key] : undefined),
  };
}

function playlist(sounds: RelinkSound[], options: { isOwner?: boolean; cover?: string | null } = {}) {
  const flags: Record<string, string> = options.cover ? { [COVER_FLAG]: options.cover } : {};
  const updateEmbeddedDocuments = vi.fn(async (_name: string, updates: Array<Record<string, unknown>>) => {
    for (const update of updates) {
      const nested = update.flags as Record<string, Record<string, string>> | undefined;
      const flag = nested ? nested[MODULE_ID][COVER_FLAG] : undefined;
      const target = sounds.find((entry) => entry.id === update._id);
      if (target) Object.assign(target, { getFlag: (scope: string, key: string) => (scope === MODULE_ID && key === COVER_FLAG ? flag : undefined) });
    }
  });
  const setFlag = vi.fn(async (scope: string, key: string, value: string) => {
    if (scope === MODULE_ID) flags[key] = value;
  });
  const unsetFlag = vi.fn(async (scope: string, key: string) => {
    if (scope === MODULE_ID) delete flags[key];
  });
  const document: RelinkPlaylist = {
    isOwner: options.isOwner ?? true,
    sounds: { contents: sounds },
    getFlag: (scope: string, key: string) => (scope === MODULE_ID ? flags[key] : undefined),
    setFlag,
    unsetFlag,
    updateEmbeddedDocuments,
  };
  return { document, updateEmbeddedDocuments, setFlag, unsetFlag, flags };
}

const library: RelinkLibrary = {
  trackByUrl: (url) => {
    if (url === "music/a.mp3") return { cover: "music/cover.png" };
    if (url === "music/b.mp3") return { cover: "music/other.png" };
    if (url === "music/c.mp3") return { cover: null };
    return null;
  },
  staleCover: (url) => url === "music/gone.jpg",
};

describe("relinkPlaylists", () => {
  it("replaces a playlist cover that points at art the library no longer has", async () => {
    const { document, setFlag, unsetFlag, flags } = playlist([sound("s1", "music/c.mp3"), sound("s2", "music/a.mp3", "music/cover.png")], { cover: "music/gone.jpg" });
    const result = await relinkPlaylists([document], library);
    expect(unsetFlag).not.toHaveBeenCalled();
    expect(setFlag).toHaveBeenCalledWith(MODULE_ID, COVER_FLAG, "music/cover.png");
    expect(flags[COVER_FLAG]).toBe("music/cover.png");
    expect(result).toEqual({ sounds: 0, playlists: 1, unmatched: 0 });
  });

  it("removes a stale playlist cover when no sound has art, and keeps manual covers", async () => {
    const stale = playlist([sound("s1", "music/c.mp3")], { cover: "music/gone.jpg" });
    const manual = playlist([sound("s2", "music/c.mp3")], { cover: "icons/svg/sound.svg" });
    const result = await relinkPlaylists([stale.document, manual.document], library);
    expect(stale.unsetFlag).toHaveBeenCalledWith(MODULE_ID, COVER_FLAG);
    expect(stale.flags[COVER_FLAG]).toBeUndefined();
    expect(manual.unsetFlag).not.toHaveBeenCalled();
    expect(manual.setFlag).not.toHaveBeenCalled();
    expect(result).toEqual({ sounds: 0, playlists: 1, unmatched: 0 });
  });

  it("updates only the sounds whose cover flag is missing or different", async () => {
    const sounds = [sound("s1", "music/a.mp3"), sound("s2", "music/b.mp3", "music/other.png"), sound("s3", "music/c.mp3")];
    const { document, updateEmbeddedDocuments } = playlist(sounds, { cover: "music/set.png" });
    const result = await relinkPlaylists([document], library);
    expect(updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
    expect(updateEmbeddedDocuments.mock.calls[0][0]).toBe("PlaylistSound");
    expect(updateEmbeddedDocuments.mock.calls[0][1]).toEqual([{ _id: "s1", flags: { [MODULE_ID]: { [COVER_FLAG]: "music/cover.png" } } }]);
    expect(result).toEqual({ sounds: 1, playlists: 1, unmatched: 0 });
  });

  it("rewrites a stale cover flag", async () => {
    const { document, updateEmbeddedDocuments } = playlist([sound("s1", "music/a.mp3", "music/stale.png")], { cover: "music/set.png" });
    await relinkPlaylists([document], library);
    expect(updateEmbeddedDocuments.mock.calls[0][1]).toEqual([{ _id: "s1", flags: { [MODULE_ID]: { [COVER_FLAG]: "music/cover.png" } } }]);
  });

  it("removes a cover flag whose track no longer has art", async () => {
    const { document, updateEmbeddedDocuments } = playlist([sound("s1", "music/c.mp3", "music/gone.png")], { cover: "music/set.png" });
    const result = await relinkPlaylists([document], library);
    expect(updateEmbeddedDocuments.mock.calls[0][1]).toEqual([{ _id: "s1", [`flags.${MODULE_ID}.-=${COVER_FLAG}`]: null }]);
    expect(result).toEqual({ sounds: 1, playlists: 1, unmatched: 0 });

    updateEmbeddedDocuments.mockClear();
    expect(await relinkPlaylists([document], library)).toEqual({ sounds: 0, playlists: 0, unmatched: 0 });
    expect(updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("sets the playlist cover from the first covered sound only when it has none", async () => {
    const withoutCover = playlist([sound("s1", "music/c.mp3"), sound("s2", "music/a.mp3"), sound("s3", "music/b.mp3")]);
    await relinkPlaylists([withoutCover.document], library);
    expect(withoutCover.setFlag).toHaveBeenCalledWith(MODULE_ID, COVER_FLAG, "music/cover.png");

    const withCover = playlist([sound("s1", "music/a.mp3")], { cover: "music/set.png" });
    await relinkPlaylists([withCover.document], library);
    expect(withCover.setFlag).not.toHaveBeenCalled();
  });

  it("skips playlists the user does not own", async () => {
    const { document, updateEmbeddedDocuments, setFlag } = playlist([sound("s1", "music/a.mp3")], { isOwner: false });
    const result = await relinkPlaylists([document], library);
    expect(updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(setFlag).not.toHaveBeenCalled();
    expect(result).toEqual({ sounds: 0, playlists: 0, unmatched: 0 });
  });

  it("counts unmatched sounds and leaves them untouched", async () => {
    const { document, updateEmbeddedDocuments, setFlag } = playlist([sound("s1", "dev-audio/x.mp3"), sound("s2", "dev-audio/y.mp3")]);
    const result = await relinkPlaylists([document], library);
    expect(updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(setFlag).not.toHaveBeenCalled();
    expect(result).toEqual({ sounds: 0, playlists: 0, unmatched: 2 });
  });

  it("counts each changed playlist once and is a no-op on a second run", async () => {
    const first = playlist([sound("s1", "music/a.mp3"), sound("s2", "music/z.mp3")]);
    const second = playlist([sound("s3", "music/b.mp3")]);
    const before = await relinkPlaylists([first.document, second.document], library);
    expect(before).toEqual({ sounds: 2, playlists: 2, unmatched: 1 });

    first.updateEmbeddedDocuments.mockClear();
    second.updateEmbeddedDocuments.mockClear();
    first.setFlag.mockClear();
    second.setFlag.mockClear();
    const after = await relinkPlaylists([first.document, second.document], library);
    expect(after).toEqual({ sounds: 0, playlists: 0, unmatched: 1 });
    expect(first.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(second.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(first.setFlag).not.toHaveBeenCalled();
    expect(second.setFlag).not.toHaveBeenCalled();
  });
});
