import { COVER_FLAG, MODULE_ID } from "../constants";
import { type Folder, type Library, type Track, folderId } from "../library/library";

export const DRAG_TYPE = "audio-codex";
const SORT_DENSITY = 100000;

export interface DragPayload {
  type: typeof DRAG_TYPE;
  rows?: Array<{ rootId: string; key: string }>;
  folders?: Array<{ rootId: string; dir: string }>;
}

export interface SoundData {
  name: string;
  path: string;
  sort: number;
  flags?: Record<string, { cover: string }>;
}

export interface Point {
  x: number;
  y: number;
}

export interface HitDocument {
  elementFromPoint(x: number, y: number): Element | null;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function resolvePayload(payload: DragPayload, library: Library): Track[] {
  const tracks: Track[] = [];
  for (const { rootId, dir } of payload.folders ?? []) {
    const folder: Folder | undefined = library.folder(folderId(rootId, dir));
    if (folder) tracks.push(...library.tracksBeneath(folder));
  }
  for (const { rootId, key } of payload.rows ?? []) {
    const track = library.track(rootId, key);
    if (track) tracks.push(track);
  }
  return tracks;
}

export function newTracks(tracks: Track[], library: Library, existingPaths: Iterable<string | null | undefined>): Track[] {
  const seen = new Set(existingPaths);
  return tracks.filter((track) => {
    const path = library.url(track);
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export function soundData(tracks: Track[], library: Library, existingSorts: number[]): SoundData[] {
  const start = existingSorts.length ? Math.max(...existingSorts) : 0;
  return tracks.map((track, index) => {
    const sound: SoundData = {
      name: track.label,
      path: library.url(track),
      sort: start + (index + 1) * SORT_DENSITY,
    };
    if (track.cover) sound.flags = { [MODULE_ID]: { [COVER_FLAG]: track.cover } };
    return sound;
  });
}

export function firstCover(tracks: Track[]): string | null {
  return tracks.find((track) => track.cover)?.cover ?? null;
}

export function coverUpdate(existing: string | null | undefined, tracks: Track[]): string | null {
  return existing ? null : firstCover(tracks);
}

export function within(point: Point, box: Box): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

export function dropTargetAt(point: Point, doc: HitDocument, windowRect: Box): string | null {
  const element = doc.elementFromPoint(point.x, point.y);
  const panel = element?.closest<HTMLElement>(".ac-playlist[data-playlist-id]")?.dataset.playlistId;
  if (panel) return panel;
  if (within(point, windowRect)) return null;
  return element?.closest<HTMLElement>(".document.playlist")?.dataset.entryId ?? null;
}

export function dropPoint(event: { clientX: number; clientY: number }, lastDragOver: Point | null): Point | null {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  return lastDragOver;
}
