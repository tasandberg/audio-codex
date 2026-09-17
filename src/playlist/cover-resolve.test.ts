import { describe, expect, it } from "vitest";
import { COVER_FLAG, MODULE_ID } from "../constants";
import { type CoverFlagged, type CoverLibrary, audibleSounds, coverChanged, coverFlag, playlistCover, soundCover } from "./cover-resolve";

const flagged = (cover: string | null): CoverFlagged => ({
  getFlag: (scope: string, key: string) => (scope === MODULE_ID && key === COVER_FLAG ? (cover ?? undefined) : undefined),
});

const sound = (path: string | null, cover: string | null = null, isOwner = true, playing = false) => ({ path, isOwner, playing, ...flagged(cover) });

type Stub = ReturnType<typeof sound>;

const playlist = (cover: string | null, sounds: Stub[]) => ({
  ...flagged(cover),
  playbackOrder: sounds.map((_, index) => `s${index}`),
  sounds: { get: (id: string): Stub | undefined => sounds[Number(id.slice(1))] },
});

const library: CoverLibrary = {
  trackByUrl: (url) => {
    if (url === "music/a.mp3") return { cover: "music/cover.png" };
    if (url === "music/b.mp3") return { cover: "music/other.png" };
    if (url === "music/c.mp3") return { cover: null };
    return null;
  },
};

describe("coverFlag", () => {
  it("reads a non-empty string flag and nothing else", () => {
    expect(coverFlag(flagged("art.png"))).toBe("art.png");
    expect(coverFlag(flagged(null))).toBeNull();
    expect(coverFlag(flagged(""))).toBeNull();
    expect(coverFlag(null)).toBeNull();
  });
});

describe("coverChanged", () => {
  it("detects a set or removed cover flag in an update diff", () => {
    expect(coverChanged({ flags: { [MODULE_ID]: { [COVER_FLAG]: "art.png" } } })).toBe(true);
    expect(coverChanged({ flags: { [MODULE_ID]: { [`-=${COVER_FLAG}`]: null } } })).toBe(true);
    expect(coverChanged({ [`flags.${MODULE_ID}.${COVER_FLAG}`]: "art.png" })).toBe(true);
    expect(coverChanged({ flags: { [MODULE_ID]: { other: 1 } } })).toBe(false);
    expect(coverChanged({ flags: { core: { [COVER_FLAG]: "art.png" } } })).toBe(false);
    expect(coverChanged({ name: "Renamed" })).toBe(false);
    expect(coverChanged(null)).toBe(false);
  });
});

describe("audibleSounds", () => {
  it("follows the playback order, skips missing ids and sounds the user neither owns nor hears", () => {
    const sounds = [
      { id: "s1", isOwner: false, playing: false },
      { id: "s2", isOwner: false, playing: true },
      { id: "s3", isOwner: true, playing: false },
    ];
    const get = (id: string) => sounds.find((candidate) => candidate.id === id);
    expect(audibleSounds(["s3", "gone", "s2", "s1"], get).map((entry) => entry.id)).toEqual(["s3", "s2"]);
    expect(audibleSounds([], get)).toEqual([]);
  });
});

describe("playlistCover", () => {
  it("prefers the playlist flag", () => {
    expect(playlistCover(playlist("list.png", [sound("music/a.mp3")]), library)).toBe("list.png");
  });

  it("falls back to the first audible sound with resolvable art", () => {
    expect(playlistCover(playlist(null, [sound("music/missing.mp3"), sound("music/c.mp3"), sound("music/a.mp3")]), library)).toBe("music/cover.png");
    expect(playlistCover(playlist(null, [sound("music/missing.mp3", "own.png")]), library)).toBe("own.png");
  });

  it("ignores sounds the user neither owns nor hears", () => {
    expect(playlistCover(playlist(null, [sound("music/b.mp3", null, false, false), sound("music/a.mp3")]), library)).toBe("music/cover.png");
  });

  it("is null with no flag and no resolvable sound", () => {
    expect(playlistCover(playlist(null, [sound("music/c.mp3")]), library)).toBeNull();
    expect(playlistCover(playlist(null, []), library)).toBeNull();
    expect(playlistCover(null, library)).toBeNull();
  });
});

describe("soundCover", () => {
  it("prefers the sound flag over everything else", () => {
    expect(soundCover(sound("music/a.mp3", "own.png"), playlist("list.png", []), library)).toBe("own.png");
  });

  it("falls back to the playlist flag before the library", () => {
    expect(soundCover(sound("music/a.mp3"), playlist("list.png", []), library)).toBe("list.png");
  });

  it("falls back to the sound's own library art", () => {
    const own = sound("music/b.mp3");
    expect(soundCover(own, playlist(null, [sound("music/a.mp3"), own]), library)).toBe("music/other.png");
    expect(soundCover(own, null, library)).toBe("music/other.png");
  });

  it("falls back to the cover resolved for the playlist", () => {
    const bare = sound("music/missing.mp3");
    expect(soundCover(bare, playlist(null, [sound("music/a.mp3"), bare]), library)).toBe("music/cover.png");
  });

  it("is null when no source has art", () => {
    expect(soundCover(sound("music/c.mp3"), playlist(null, [sound("music/c.mp3")]), library)).toBeNull();
    expect(soundCover(sound(null), null, library)).toBeNull();
    expect(soundCover(null, null, library)).toBeNull();
  });
});
