import { describe, expect, it } from "vitest";
import { type FolderView, type PlaylistSource, columnViews, formatDuration, playlistViews, progressView, rowView, summaryLabel, trackView } from "./view";
import type { Folder, Track } from "../library/library";

const track: Track = { rootId: "r", key: "a/b.mp3", dirKey: "a", name: "b.mp3", label: "B", artist: "Art", track: 4, duration: 3725.4, cover: "https://cdn/a/cover.jpg", overridden: true, haystack: "" };
const folder: Folder = { id: "r:a", rootId: "r", key: "a", name: "a", cover: null, album: null, folders: [], tracks: [], total: 9 };
const localize = (key: string, data: Record<string, number>) => `${key} ${JSON.stringify(data)}`;
const folderView = (source: Folder, expanded = false) => rowView({ kind: "folder", folder: source, depth: 0, expanded }) as FolderView;

describe("view models", () => {
  it("formats durations as m:ss or h:mm:ss", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(61.4)).toBe("1:01");
    expect(formatDuration(3725.4)).toBe("1:02:05");
  });

  it("flattens tracks to display strings", () => {
    expect(trackView(track, 2)).toEqual({
      folder: false, rootId: "r", key: "a/b.mp3", depth: 2, label: "B", artist: "Art", album: "", track: "4", duration: "1:02:05", overridden: true, path: "", cover: "https://cdn/a/cover.jpg",
    });
    expect(trackView(track, 0, true).path).toBe("a");
  });

  it("maps folder rows with an open or closed icon", () => {
    expect(rowView({ kind: "folder", folder, depth: 1, expanded: true })).toMatchObject({ folder: true, id: "r:a", total: 9, icon: "fa-folder-open", depth: 1, cover: "" });
    expect(rowView({ kind: "folder", folder, depth: 1, expanded: false })).toMatchObject({ icon: "fa-folder" });
  });

  it("keeps the folder icon for a plain folder, whatever art the directory holds", () => {
    expect(folderView({ ...folder, cover: "https://cdn/a/cover.jpg" })).toMatchObject({
      name: "a", icon: "fa-folder", cover: "", album: false, artist: "", secondary: "",
    });
  });

  it("gives an album its cover, title, artist and the folder name as a secondary line", () => {
    const spellwind: Folder = { ...folder, name: "01 Spellwind", cover: "https://cdn/a/cover.jpg", album: { title: "Spellwind", artist: "Fogweaver" } };
    expect(folderView(spellwind)).toMatchObject({
      name: "Spellwind", icon: "", cover: "https://cdn/a/cover.jpg", album: true, artist: "Fogweaver", secondary: "01 Spellwind",
    });
    expect(folderView({ ...spellwind, name: "Spellwind" }).secondary).toBe("");
    expect(folderView({ ...spellwind, cover: null }).cover).toBe("");
  });

  it("marks the active sort column and direction", () => {
    const columns = columnViews({ column: "artist", direction: -1 });
    expect(columns.find((column) => column.active)).toMatchObject({ id: "artist", icon: "fa-caret-down" });
    expect(columns.filter((column) => column.active)).toHaveLength(1);
  });

  it("lists playlists flat, expanding only the open ones", () => {
    const sources: PlaylistSource[] = [
      { id: "p1", name: "Tavern", cover: "https://cdn/tavern.jpg", count: 2, sounds: [{ id: "s1", name: "Lute", cover: null, channel: "music" }, { id: "s2", name: "Drum", cover: "https://cdn/drum.png", channel: "environment" }] },
      { id: "p2", name: "Battle", cover: null, count: 7, sounds: [] },
    ];
    const views = playlistViews(sources, new Set(["p1"]));
    expect(views[0]).toMatchObject({ id: "p1", name: "Tavern", count: 2, cover: "https://cdn/tavern.jpg", expanded: true });
    expect(views[0].sounds).toEqual([
      { id: "s1", name: "Lute", cover: "", channel: "music", channelIcon: "fa-music", channelLabel: "AUDIO_CODEX.Channel.Music" },
      { id: "s2", name: "Drum", cover: "https://cdn/drum.png", channel: "environment", channelIcon: "fa-mountain", channelLabel: "AUDIO_CODEX.Channel.Environment" },
    ]);
    expect(views[1]).toMatchObject({ id: "p2", count: 7, cover: "", expanded: false, sounds: [] });
  });

  it("summarises the library, or the search matches when searching", () => {
    expect(summaryLabel(3144, null, 250, localize)).toBe('AUDIO_CODEX.Summary {"count":3144}');
    expect(summaryLabel(3144, 12, 250, localize)).toBe('AUDIO_CODEX.Matches {"count":12}');
    expect(summaryLabel(3144, 250, 250, localize)).toBe('AUDIO_CODEX.MatchesCapped {"count":250}');
  });

  it("describes progress for each phase, uploads first", () => {
    expect(progressView(null, null, localize)).toBeNull();
    expect(progressView({ phase: "tags", done: 3, total: 10 }, null, localize)).toEqual({ label: 'AUDIO_CODEX.Progress.Tags {"done":3,"total":10}', done: 3, total: 10 });
    expect(progressView({ phase: "crawl", done: 5, total: 40 }, null, localize)?.total).toBe(0);
    expect(progressView({ phase: "covers", done: 2, total: 4 }, null, localize)).toEqual({ label: 'AUDIO_CODEX.Progress.Covers {"done":2,"total":4}', done: 2, total: 4 });
    expect(progressView({ phase: "tags", done: 3, total: 10 }, { done: 1, total: 2 }, localize)?.label).toContain("Upload");
  });
});
