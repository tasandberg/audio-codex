import { joinKey } from "../storage/file-location";
import type { IndexedDir, IndexedFile, LibraryIndex, Tags } from "../types";

export interface WalkedFile {
  key: string;
  dirKey: string;
  file: IndexedFile;
}

export interface WalkedDir {
  key: string;
  node: IndexedDir;
  depth: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function emptyDir(dir = ""): IndexedDir {
  return { dir, files: [], dirs: [] };
}

export function sortTree(node: IndexedDir): IndexedDir {
  node.files.sort((a, b) => byName(a.name, b.name));
  node.dirs.sort((a, b) => byName(a.dir, b.dir));
  for (const child of node.dirs) sortTree(child);
  return node;
}

export function* walkDirs(node: IndexedDir, key: string, depth = 0): Generator<WalkedDir> {
  yield { key, node, depth };
  for (const child of node.dirs) yield* walkDirs(child, joinKey(key, child.dir), depth + 1);
}

export function* walkFiles(node: IndexedDir, key: string): Generator<WalkedFile> {
  for (const { key: dirKey, node: dir } of walkDirs(node, key)) {
    for (const file of dir.files) yield { key: joinKey(dirKey, file.name), dirKey, file };
  }
}

export function countFiles(index: LibraryIndex): number {
  let total = 0;
  for (const root of index.roots) for (const _ of walkFiles(root.index, "")) total++;
  return total;
}

export function ensureDir(node: IndexedDir, segments: string[]): IndexedDir {
  let current = node;
  for (const segment of segments) {
    let child = current.dirs.find((candidate) => candidate.dir === segment);
    if (!child) {
      child = emptyDir(segment);
      current.dirs.push(child);
    }
    current = child;
  }
  return current;
}

export function putFile(dir: IndexedDir, name: string, tags: Tags): void {
  const entry: IndexedFile = { name, ...tags };
  const existing = dir.files.findIndex((file) => file.name === name);
  if (existing === -1) dir.files.push(entry);
  else dir.files[existing] = entry;
}
