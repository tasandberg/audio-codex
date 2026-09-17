import type { Row, SortColumn, SortState, Track } from "../library/library";
import type { SyncProgress } from "../sync/sync";

export interface FolderView {
  folder: true;
  id: string;
  rootId: string;
  key: string;
  name: string;
  depth: number;
  total: number;
  icon: string;
  caret: string;
  cover: string;
  album: boolean;
  artist: string;
  secondary: string;
}

export interface TrackView {
  folder: false;
  rootId: string;
  key: string;
  depth: number;
  label: string;
  artist: string;
  album: string;
  track: string;
  duration: string;
  overridden: boolean;
  path: string;
  cover: string;
}

export type RowView = FolderView | TrackView;

export interface SoundView {
  id: string;
  name: string;
  cover: string;
}

export interface PlaylistView {
  id: string;
  name: string;
  count: number;
  cover: string;
  expanded: boolean;
  sounds: SoundView[];
}

export interface PlaylistSource {
  id: string;
  name: string;
  cover: string | null;
  count: number;
  sounds: Array<{ id: string; name: string; cover: string | null }>;
}

export interface ColumnView {
  id: SortColumn;
  label: string;
  active: boolean;
  icon: string;
}

export interface ProgressView {
  label: string;
  done: number;
  total: number;
}

export interface UploadProgress {
  done: number;
  total: number;
}

export const COLUMNS: ReadonlyArray<{ id: SortColumn; label: string }> = [
  { id: "label", label: "AUDIO_CODEX.Column.Title" },
  { id: "artist", label: "AUDIO_CODEX.Column.Artist" },
  { id: "album", label: "AUDIO_CODEX.Column.Album" },
  { id: "track", label: "AUDIO_CODEX.Column.Track" },
  { id: "duration", label: "AUDIO_CODEX.Column.Duration" },
];

export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function trackView(track: Track, depth: number, withPath = false): TrackView {
  return {
    folder: false,
    rootId: track.rootId,
    key: track.key,
    depth,
    label: track.label,
    artist: track.artist ?? "",
    album: track.album ?? "",
    track: track.track ? String(track.track) : "",
    duration: formatDuration(track.duration),
    overridden: track.overridden,
    path: withPath ? track.dirKey : "",
    cover: track.cover ?? "",
  };
}

export function rowView(row: Row): RowView {
  if (row.kind === "track") return trackView(row.track, row.depth);
  const { folder } = row;
  const album = folder.album;
  const name = album?.title ?? folder.name;
  return {
    folder: true,
    id: folder.id,
    rootId: folder.rootId,
    key: folder.key,
    name,
    depth: row.depth,
    total: folder.total,
    icon: album ? "" : row.expanded ? "fa-folder-open" : "fa-folder",
    caret: row.expanded ? "fa-caret-down" : "fa-caret-right",
    cover: album ? (folder.cover ?? "") : "",
    album: Boolean(album),
    artist: album?.artist ?? "",
    secondary: album && folder.name !== name ? folder.name : "",
  };
}

export function playlistViews(playlists: PlaylistSource[], expanded: ReadonlySet<string>): PlaylistView[] {
  return playlists.map((playlist) => {
    const open = expanded.has(playlist.id);
    return {
      id: playlist.id,
      name: playlist.name,
      count: playlist.count,
      cover: playlist.cover ?? "",
      expanded: open,
      sounds: open ? playlist.sounds.map((sound) => ({ id: sound.id, name: sound.name, cover: sound.cover ?? "" })) : [],
    };
  });
}

export function columnViews(sort: SortState): ColumnView[] {
  return COLUMNS.map((column) => ({
    ...column,
    active: column.id === sort.column,
    icon: sort.direction === 1 ? "fa-caret-up" : "fa-caret-down",
  }));
}

export function summaryLabel(total: number, matches: number | null, limit: number, localize: (key: string, data: Record<string, number>) => string): string {
  if (matches === null) return localize("AUDIO_CODEX.Summary", { count: total });
  return localize(matches >= limit ? "AUDIO_CODEX.MatchesCapped" : "AUDIO_CODEX.Matches", { count: matches });
}

export function progressView(
  sync: SyncProgress | null,
  upload: UploadProgress | null,
  localize: (key: string, data: Record<string, number>) => string,
): ProgressView | null {
  if (upload) return { label: localize("AUDIO_CODEX.Progress.Upload", { done: upload.done, total: upload.total }), done: upload.done, total: upload.total };
  if (!sync) return null;
  if (sync.phase === "crawl") return { label: localize("AUDIO_CODEX.Progress.Crawl", { dirs: sync.done, files: sync.total }), done: 0, total: 0 };
  if (sync.phase === "tags") return { label: localize("AUDIO_CODEX.Progress.Tags", { done: sync.done, total: sync.total }), done: sync.done, total: sync.total };
  if (sync.phase === "covers") return { label: localize("AUDIO_CODEX.Progress.Covers", { done: sync.done, total: sync.total }), done: sync.done, total: sync.total };
  return { label: localize("AUDIO_CODEX.Progress.Write", {}), done: sync.done, total: sync.total };
}
