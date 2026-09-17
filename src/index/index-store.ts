import { INDEX_FILE, INDEX_VERSION, MODULE_ID, SUPPORTED_INDEX_VERSIONS, chooseCover } from "../constants";
import { FileLocation } from "../storage/file-location";
import type { LibraryIndex, Pointer, Root, Tags } from "../types";
import { ensureDir, putFile, sortTree } from "./tree";
import type { Fetch } from "../sync/byte-source";

export interface IndexWriter {
  createDirectory(path: string): Promise<void>;
  upload(path: string, file: File): Promise<string | null>;
}

const GZIP_MAGIC = [0x1f, 0x8b];

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeIndex(index: LibraryIndex): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(JSON.stringify(index)), new CompressionStream("gzip"));
}

export async function decodeIndex(bytes: Uint8Array): Promise<LibraryIndex> {
  const gzipped = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  const raw = gzipped ? await pipe(bytes, new DecompressionStream("gzip")) : bytes;
  const index = JSON.parse(new TextDecoder().decode(raw)) as LibraryIndex;
  if (!SUPPORTED_INDEX_VERSIONS.includes(index.version)) throw new Error(`${MODULE_ID} | unsupported index version ${index.version}`);
  return index;
}

export function indexDirectory(worldId: string): string {
  return `worlds/${worldId}/${MODULE_ID}`;
}

export async function writeIndex(index: LibraryIndex, directory: string, writer: IndexWriter): Promise<string> {
  await writer.createDirectory(directory);
  const bytes = await encodeIndex(index);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], INDEX_FILE, { type: "application/json" });
  const path = await writer.upload(directory, file);
  if (!path) throw new Error(`${MODULE_ID} | index upload failed`);
  return path;
}

export async function readIndex(pointer: Pointer | null, fetchFn: Fetch = (input, init) => fetch(input, init)): Promise<LibraryIndex | null> {
  if (!pointer?.cacheFile || !SUPPORTED_INDEX_VERSIONS.includes(pointer.version)) return null;
  const response = await fetchFn(`${pointer.cacheFile}?v=${pointer.generatedAt}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${MODULE_ID} | index fetch failed with HTTP ${response.status}`);
  return decodeIndex(new Uint8Array(await response.arrayBuffer()));
}

export interface SplicedFile {
  key: string;
  tags: Tags;
}

export function spliceFiles(index: LibraryIndex | null, root: Root, urlBase: string | null, files: SplicedFile[], now: number, covers: string[] = []): LibraryIndex {
  const next: LibraryIndex = structuredClone(index ?? { version: INDEX_VERSION, generatedAt: now, roots: [] });
  next.generatedAt = now;
  let rootIndex = next.roots.find((candidate) => candidate.rootId === root.id);
  if (!rootIndex) {
    rootIndex = { rootId: root.id, urlBase, index: { dir: "", files: [], dirs: [] } };
    next.roots.push(rootIndex);
  }
  rootIndex.urlBase ??= urlBase;
  const base = new FileLocation(root.source, root.prefix, root.bucket);
  for (const { key, tags } of files) {
    const segments = base.relative(new FileLocation(root.source, key, root.bucket));
    if (!segments?.length) continue;
    const name = segments.pop() as string;
    putFile(ensureDir(rootIndex.index, segments), name, tags);
  }
  for (const key of covers) {
    const segments = base.relative(new FileLocation(root.source, key, root.bucket));
    if (!segments?.length) continue;
    const name = segments.pop() as string;
    const dir = ensureDir(rootIndex.index, segments);
    const cover = chooseCover(dir.cover ? [dir.cover, name] : [name]);
    if (cover) dir.cover = cover;
  }
  sortTree(rootIndex.index);
  return next;
}
