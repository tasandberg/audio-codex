import { isImageFile, stripExtension } from "../constants";
import { FileLocation, decode, joinKey } from "../storage/file-location";
import type { IndexedDir, LibraryIndex, Overrides, Root, Tags } from "../types";

export interface Track extends Tags {
  rootId: string;
  key: string;
  dirKey: string;
  name: string;
  label: string;
  cover: string | null;
  overridden: boolean;
  haystack: string;
}

export interface Album {
  title: string;
  artist: string;
}

export interface Folder {
  id: string;
  rootId: string;
  key: string;
  name: string;
  cover: string | null;
  album: Album | null;
  folders: Folder[];
  tracks: Track[];
  total: number;
}

export type SortColumn = "label" | "artist" | "album" | "track" | "duration";

export interface SortState {
  column: SortColumn;
  direction: 1 | -1;
}

export type Row =
  | { kind: "folder"; folder: Folder; depth: number; expanded: boolean }
  | { kind: "track"; track: Track; depth: number };

export const DEFAULT_SORT: SortState = { column: "track", direction: 1 };

export function folderId(rootId: string, key: string): string {
  return `${rootId}:${key}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const VARIOUS_ARTISTS = "Various";
export const SEARCH_LIMIT = 250;

export function albumOf(tracks: readonly Pick<Tags, "album" | "artist">[]): Album | null {
  const title = tracks[0]?.album;
  if (!title || !tracks.every((track) => track.album === title)) return null;
  const artist = tracks[0].artist ?? "";
  return { title, artist: tracks.every((track) => (track.artist ?? "") === artist) ? artist : VARIOUS_ARTISTS };
}

function compareTracks(a: Track, b: Track, { column, direction }: SortState): number {
  const left = a[column];
  const right = b[column];
  if (left !== right) {
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
    if (order) return order * direction;
  }
  return collator.compare(a.label, b.label) || collator.compare(a.key, b.key);
}

export class Library {
  readonly folders: Folder[];
  readonly #roots = new Map<string, { root: Root; urlBase: string | null }>();
  readonly #folders = new Map<string, Folder>();
  readonly #tracks = new Map<string, Track>();
  readonly #sorted = new Map<string, Track[]>();
  #byUrl: Map<string, Track> | null = null;
  #byDirUrl: Map<string, Folder> | null = null;

  static build(index: LibraryIndex | null, roots: Root[], overrides: Overrides): Library {
    return new Library(index, roots, overrides);
  }

  private constructor(index: LibraryIndex | null, roots: Root[], overrides: Overrides) {
    this.folders = roots.map((root) => {
      const rootIndex = index?.roots.find((candidate) => candidate.rootId === root.id);
      this.#roots.set(root.id, { root, urlBase: rootIndex?.urlBase ?? null });
      const tree: IndexedDir = rootIndex?.index ?? { dir: "", files: [], dirs: [] };
      return this.#folder(root, tree, root.prefix, root.label, overrides[root.id] ?? {}, null);
    });
  }

  #folder(root: Root, node: IndexedDir, key: string, name: string, overrides: Overrides[string], inherited: string | null): Folder {
    const cover = node.cover ? this.#url(root.id, joinKey(key, node.cover)) : null;
    const folder: Folder = { id: folderId(root.id, key), rootId: root.id, key, name, cover, album: null, folders: [], tracks: [], total: 0 };
    this.#folders.set(folder.id, folder);
    for (const child of node.dirs) {
      const sub = this.#folder(root, child, joinKey(key, child.dir), child.dir, overrides, cover ?? inherited);
      folder.folders.push(sub);
      folder.total += sub.total;
    }
    for (const file of node.files) {
      const fileKey = joinKey(key, file.name);
      const override = overrides[fileKey];
      const { name: _name, pending: _pending, ...tags } = file;
      const merged: Tags = { ...tags, ...override };
      const label = merged.title ?? stripExtension(file.name);
      const track: Track = {
        ...merged,
        rootId: root.id,
        key: fileKey,
        dirKey: key,
        name: file.name,
        label,
        cover: cover ?? inherited,
        overridden: Boolean(override && Object.keys(override).length),
        haystack: [file.name, fileKey, merged.artist, merged.album, merged.title].filter(Boolean).join("\n").toLowerCase(),
      };
      this.#tracks.set(folderId(root.id, fileKey), track);
      folder.tracks.push(track);
    }
    folder.total += folder.tracks.length;
    folder.album = albumOf(folder.tracks);
    return folder;
  }

  get size(): number {
    return this.#tracks.size;
  }

  folder(id: string): Folder | undefined {
    return this.#folders.get(id);
  }

  track(rootId: string, key: string): Track | undefined {
    return this.#tracks.get(folderId(rootId, key));
  }

  sortedTracks(folder: Folder, sort: SortState = DEFAULT_SORT): Track[] {
    const cacheKey = `${folder.id}|${sort.column}|${sort.direction}`;
    let sorted = this.#sorted.get(cacheKey);
    if (!sorted) {
      sorted = [...folder.tracks].sort((a, b) => compareTracks(a, b, sort));
      this.#sorted.set(cacheKey, sorted);
    }
    return sorted;
  }

  tracksBeneath(folder: Folder): Track[] {
    return [...this.sortedTracks(folder, DEFAULT_SORT), ...folder.folders.flatMap((child) => this.tracksBeneath(child))];
  }

  rows(expanded: ReadonlySet<string>, sort: SortState = DEFAULT_SORT): Row[] {
    const rows: Row[] = [];
    const visit = (folder: Folder, depth: number) => {
      const open = expanded.has(folder.id);
      rows.push({ kind: "folder", folder, depth, expanded: open });
      if (!open) return;
      for (const child of folder.folders) visit(child, depth + 1);
      for (const track of this.sortedTracks(folder, sort)) rows.push({ kind: "track", track, depth: depth + 1 });
    };
    for (const folder of this.folders) visit(folder, 0);
    return rows;
  }

  search(query: string, limit = SEARCH_LIMIT): Track[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results: Track[] = [];
    for (const track of this.#tracks.values()) {
      if (terms.every((term) => track.haystack.includes(term))) {
        results.push(track);
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  #url(rootId: string, key: string): string {
    const entry = this.#roots.get(rootId);
    if (!entry) return key;
    return new FileLocation(entry.root.source, key, entry.root.bucket).url(entry.urlBase);
  }

  url(track: Track): string {
    return this.#url(track.rootId, track.key);
  }

  trackByUrl(url: string | null | undefined): Track | null {
    if (!url) return null;
    if (!this.#byUrl) {
      this.#byUrl = new Map();
      for (const track of this.#tracks.values()) {
        const lookup = decode(this.url(track));
        if (!this.#byUrl.has(lookup)) this.#byUrl.set(lookup, track);
      }
    }
    return this.#byUrl.get(decode(url)) ?? null;
  }

  staleCover(url: string | null | undefined): boolean {
    if (!url) return false;
    const decoded = decode(url);
    const slash = decoded.lastIndexOf("/");
    const name = decoded.slice(slash + 1);
    if (!isImageFile(name) || stripExtension(name).toLowerCase() !== "cover") return false;
    if (!this.#byDirUrl) {
      this.#byDirUrl = new Map();
      for (const folder of this.#folders.values()) {
        const probe = decode(this.#url(folder.rootId, joinKey(folder.key, "_")));
        this.#byDirUrl.set(probe.slice(0, -1), folder);
      }
    }
    const folder = this.#byDirUrl.get(decoded.slice(0, slash + 1));
    return Boolean(folder) && decode(folder?.cover ?? "") !== decoded;
  }

  root(rootId: string): Root | undefined {
    return this.#roots.get(rootId)?.root;
  }
}
