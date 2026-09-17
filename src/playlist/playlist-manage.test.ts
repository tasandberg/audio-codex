import { describe, expect, it, vi } from "vitest";
import { type ManagedPlaylist, canManage, cleanName, deletePlaylist, removeSound, renamePlaylist, setPlaylistCover } from "./playlist-manage";

function stub(name = "Tavern"): ManagedPlaylist & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    name,
    update: vi.fn(async (data) => void calls.push(`update ${JSON.stringify(data)}`)),
    setFlag: vi.fn(async (scope, key, value) => void calls.push(`setFlag ${scope}.${key}=${value}`)),
    unsetFlag: vi.fn(async (scope, key) => void calls.push(`unsetFlag ${scope}.${key}`)),
    deleteDialog: vi.fn(async () => void calls.push("deleteDialog")),
  };
}

describe("cleanName", () => {
  it("trims, and rejects an empty or unchanged name", () => {
    expect(cleanName("  Battle  ")).toBe("Battle");
    expect(cleanName("Tavern", "Tavern")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(undefined)).toBeNull();
  });
});

describe("canManage", () => {
  it("is true only for a document the user owns", () => {
    expect(canManage({ isOwner: true })).toBe(true);
    expect(canManage({ isOwner: false })).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });
});

describe("playlist management", () => {
  it("renames through update, and does nothing for an empty or unchanged name", async () => {
    const playlist = stub();
    await expect(renamePlaylist(playlist, "  Battle ")).resolves.toBe(true);
    await expect(renamePlaylist(playlist, "Tavern")).resolves.toBe(false);
    await expect(renamePlaylist(playlist, "  ")).resolves.toBe(false);
    expect(playlist.calls).toEqual(['update {"name":"Battle"}']);
  });

  it("writes the cover flag, and clears it with unsetFlag", async () => {
    const playlist = stub();
    await setPlaylistCover(playlist, "worlds/w/art.png");
    await setPlaylistCover(playlist, null);
    expect(playlist.calls).toEqual(["setFlag audio-codex.cover=worlds/w/art.png", "unsetFlag audio-codex.cover"]);
  });

  it("deletes through core's own confirmation dialog", async () => {
    const playlist = stub();
    await deletePlaylist(playlist);
    expect(playlist.calls).toEqual(["deleteDialog"]);
  });

  it("removes a sound through its own delete", async () => {
    const sound = { delete: vi.fn(async () => {}) };
    await removeSound(sound);
    expect(sound.delete).toHaveBeenCalledTimes(1);
  });
});
