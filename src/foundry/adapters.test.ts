import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverLibrary } from "../playlist/cover-resolve";
import { playlistSources } from "./adapters";

interface StubSound {
  id: string;
  name: string;
  path: string;
  isOwner: boolean;
  playing: boolean;
  getFlag: () => string | null;
}

const sound = (id: string, name: string, isOwner: boolean, playing: boolean, cover: string | null = null, path = `music/${id}.mp3`): StubSound => ({
  id,
  name,
  path,
  isOwner,
  playing,
  getFlag: () => cover,
});

const library: CoverLibrary = {
  trackByUrl: (url) => (url === "music/indexed.mp3" ? { cover: "music/cover.png" } : null),
};

const playlist = (id: string, name: string, sounds: StubSound[], order: string[], visible = true, cover: string | null = null) => ({
  id,
  name,
  visible,
  sort: 0,
  playbackOrder: order,
  sounds: { get: (soundId: string) => sounds.find((candidate) => candidate.id === soundId) },
  getFlag: () => cover,
});

function stubGame(playlists: ReturnType<typeof playlist>[]): void {
  vi.stubGlobal("game", { i18n: { lang: "en" }, playlists: { contents: playlists, sortingMode: "m" } });
}

describe("playlistSources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a player only the playing sound of a playlist a GM started", () => {
    const sounds = [sound("s1", "One", false, false), sound("s2", "Two", false, true), sound("s3", "Three", false, false)];
    stubGame([playlist("p1", "Tavern", sounds, ["s1", "s2", "s3"])]);
    const [source] = playlistSources(new Set(["p1"]), library);
    expect(source.count).toBe(1);
    expect(source.sounds).toEqual([{ id: "s2", name: "Two", cover: null }]);
  });

  it("lists every sound in playback order for the owner", () => {
    const sounds = [sound("s1", "One", true, false), sound("s2", "Two", true, false, "https://cdn/two.jpg")];
    stubGame([playlist("p1", "Tavern", sounds, ["s2", "s1"])]);
    const [source] = playlistSources(new Set(["p1"]), library);
    expect(source.sounds.map((entry) => entry.id)).toEqual(["s2", "s1"]);
    expect(source.sounds[0].cover).toBe("https://cdn/two.jpg");
  });

  it("keeps the count but builds no sound list for a collapsed playlist", () => {
    const sounds = [sound("s1", "One", true, false), sound("s2", "Two", true, false)];
    stubGame([playlist("p1", "Tavern", sounds, ["s1", "s2"])]);
    const [source] = playlistSources(new Set(), library);
    expect(source.count).toBe(2);
    expect(source.sounds).toEqual([]);
  });

  it("skips playlists the user cannot see", () => {
    stubGame([playlist("p1", "Hidden", [], [], false), playlist("p2", "Shown", [], [])]);
    expect(playlistSources(new Set(), library).map((source) => source.id)).toEqual(["p2"]);
  });

  it("derives sound and playlist art from the library when no flag is set", () => {
    const sounds = [sound("s1", "One", true, false, null, "music/indexed.mp3")];
    stubGame([playlist("p1", "Tavern", sounds, ["s1"])]);
    const [source] = playlistSources(new Set(["p1"]), library);
    expect(source.cover).toBe("music/cover.png");
    expect(source.sounds[0].cover).toBe("music/cover.png");
  });

  it("falls a coverless sound back to the playlist art resolved from its siblings", () => {
    const sounds = [sound("s1", "One", true, false, null, "music/indexed.mp3"), sound("s2", "Two", true, false, null, "music/bare.mp3")];
    stubGame([playlist("p1", "Tavern", sounds, ["s1", "s2"])]);
    const [source] = playlistSources(new Set(["p1"]), library);
    expect(source.sounds.map((entry) => entry.cover)).toEqual(["music/cover.png", "music/cover.png"]);
  });

  it("prefers the playlist flag over library art for the playlist row", () => {
    const sounds = [sound("s1", "One", true, false, null, "music/indexed.mp3")];
    stubGame([playlist("p1", "Tavern", sounds, ["s1"], true, "https://cdn/list.jpg")]);
    const [source] = playlistSources(new Set(["p1"]), library);
    expect(source.cover).toBe("https://cdn/list.jpg");
    expect(source.sounds[0].cover).toBe("https://cdn/list.jpg");
  });
});
