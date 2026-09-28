import { describe, expect, it, vi } from "vitest";
import { MODULE_ID, TOGGLE_FLAG } from "../constants";
import { FALLBACK_ICON, PLAYING_CLASS, type Toggleable, findToggleMacro, macroSource, markPlayingSlots, togglePlayback, toggleTarget, toggleUuid } from "./hotbar-macro";

const macro = (uuid: string | null, isOwner = true) => ({
  isOwner,
  getFlag: (scope: string, key: string) => (scope === MODULE_ID && key === TOGGLE_FLAG ? (uuid ?? undefined) : undefined),
});

const playlist = (playing: boolean, isOwner = true) => ({
  documentName: "Playlist" as const,
  playing,
  isOwner,
  playAll: vi.fn(async () => undefined),
  stopAll: vi.fn(async () => undefined),
  playSound: vi.fn(async () => undefined),
  stopSound: vi.fn(async () => undefined),
});

describe("toggleTarget", () => {
  it("accepts Playlist and PlaylistSound drops with a uuid", () => {
    expect(toggleTarget({ type: "Playlist", uuid: "Playlist.p1" })).toEqual({ type: "Playlist", uuid: "Playlist.p1" });
    expect(toggleTarget({ type: "PlaylistSound", uuid: "Playlist.p1.PlaylistSound.s1" })).toEqual({
      type: "PlaylistSound",
      uuid: "Playlist.p1.PlaylistSound.s1",
    });
  });

  it("ignores other drops", () => {
    expect(toggleTarget({ type: "Macro", uuid: "Macro.m1" })).toBeNull();
    expect(toggleTarget({ type: "audio-codex", rows: [] })).toBeNull();
    expect(toggleTarget({ type: "Playlist" })).toBeNull();
    expect(toggleTarget({ type: "Playlist", uuid: "" })).toBeNull();
    expect(toggleTarget(null)).toBeNull();
    expect(toggleTarget("Playlist")).toBeNull();
  });
});

describe("macroSource", () => {
  it("builds a flagged script macro calling the module toggle", () => {
    const source = macroSource("Tavern", "Playlist.p1", "art/cover.png");
    expect(source).toMatchObject({ name: "Tavern", type: "script", img: "art/cover.png", flags: { [MODULE_ID]: { [TOGGLE_FLAG]: "Playlist.p1" } } });
    expect(source.command).toBe('await game.modules.get("audio-codex")?.api?.togglePlayback("Playlist.p1");');
  });

  it("falls back to a sound icon without art", () => {
    expect(macroSource("Tavern", "Playlist.p1", null).img).toBe(FALLBACK_ICON);
    expect(macroSource("Tavern", "Playlist.p1", "").img).toBe(FALLBACK_ICON);
  });

  it("escapes the uuid inside the command", () => {
    expect(macroSource("x", 'a"b', null).command).toContain('togglePlayback("a\\"b")');
  });
});

describe("toggleUuid and findToggleMacro", () => {
  it("reads the toggle flag", () => {
    expect(toggleUuid(macro("Playlist.p1"))).toBe("Playlist.p1");
    expect(toggleUuid(macro(null))).toBeNull();
    expect(toggleUuid(null)).toBeNull();
  });

  it("reuses an owned macro for the same uuid", () => {
    const owned = macro("Playlist.p1");
    expect(findToggleMacro([macro("Playlist.p2"), macro("Playlist.p1", false), owned], "Playlist.p1")).toBe(owned);
    expect(findToggleMacro([macro("Playlist.p2")], "Playlist.p1")).toBeNull();
  });
});

describe("togglePlayback", () => {
  it("starts and stops a playlist", async () => {
    const idle = playlist(false);
    expect(await togglePlayback(idle)).toBe("played");
    expect(idle.playAll).toHaveBeenCalled();
    const playing = playlist(true);
    expect(await togglePlayback(playing)).toBe("stopped");
    expect(playing.stopAll).toHaveBeenCalled();
  });

  it("plays and stops a sound through its playlist", async () => {
    const parent = playlist(false);
    const idle = { documentName: "PlaylistSound" as const, playing: false, isOwner: true, parent };
    expect(await togglePlayback(idle)).toBe("played");
    expect(parent.playSound).toHaveBeenCalledWith(idle);
    const playing = { ...idle, playing: true };
    expect(await togglePlayback(playing)).toBe("stopped");
    expect(parent.stopSound).toHaveBeenCalledWith(playing);
  });

  it("reports missing or unowned documents without acting", async () => {
    const denied = playlist(false, false);
    expect(await togglePlayback(null)).toBe("missing");
    expect(await togglePlayback({ documentName: "PlaylistSound", playing: false, isOwner: true, parent: null })).toBe("missing");
    expect(await togglePlayback(denied)).toBe("denied");
    expect(denied.playAll).not.toHaveBeenCalled();
    const parent = playlist(false);
    expect(await togglePlayback({ documentName: "PlaylistSound", playing: false, isOwner: false, parent } as Toggleable)).toBe("denied");
    expect(parent.playSound).not.toHaveBeenCalled();
  });
});

describe("markPlayingSlots", () => {
  it("toggles the playing class per slot", () => {
    const slot = (id: string, initial: string[] = []) => {
      const classes = new Set(initial);
      return {
        dataset: { slot: id },
        classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
        classes,
      };
    };
    const slots = [slot("1"), slot("2", [PLAYING_CLASS]), slot("3")];
    const root = { querySelectorAll: () => slots } as unknown as ParentNode;
    markPlayingSlots(root, (id) => id === "1");
    expect(slots.map((entry) => entry.classes.has(PLAYING_CLASS))).toEqual([true, false, false]);
  });
});
