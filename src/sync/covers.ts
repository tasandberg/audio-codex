import { MODULE_ID } from "../constants";
import { walkDirs } from "../index/tree";
import { albumOf } from "../library/library";
import { FileLocation, joinKey } from "../storage/file-location";
import type { IndexedDir, Root, RootIndex } from "../types";
import type { ByteSource } from "./byte-source";
import { SyncCancelled, type SyncControl } from "./control";
import { runQueue } from "./queue";

export interface CoverPicture {
  format: string;
  data: Uint8Array;
}

export interface CoverJob {
  root: Root;
  dirKey: string;
  node: IndexedDir;
  url: string;
}

export interface CoverDeps {
  openSource(url: string, signal: AbortSignal): ByteSource;
  readCover(source: ByteSource): Promise<CoverPicture | null>;
  upload(location: FileLocation, file: File): Promise<string | null>;
}

const COVER_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const COVER_NAMES: Record<string, string> = {
  "image/jpeg": "cover.jpg",
  "image/png": "cover.png",
  "image/webp": "cover.webp",
};

export function coverFile(picture: CoverPicture): File | null {
  const type = COVER_TYPES[picture.format.trim().toLowerCase()];
  const name = type && COVER_NAMES[type];
  if (!type || !name) return null;
  return new File([picture.data as Uint8Array<ArrayBuffer>], name, { type });
}

export function planCovers(root: Root, rootIndex: RootIndex, only?: ReadonlySet<string>): CoverJob[] {
  if (root.source === "forgevtt") return [];
  const jobs: CoverJob[] = [];
  for (const { key, node } of walkDirs(rootIndex.index, root.prefix)) {
    if (node.cover || !albumOf(node.files)) continue;
    if (only && !only.has(key)) continue;
    const location = new FileLocation(root.source, joinKey(key, node.files[0].name), root.bucket);
    jobs.push({ root, dirKey: key, node, url: location.url(rootIndex.urlBase) });
  }
  return jobs;
}

export async function extractCovers(
  jobs: CoverJob[],
  deps: CoverDeps,
  control: SyncControl,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<number> {
  let done = 0;
  let extracted = 0;
  await runQueue(
    jobs,
    async (job) => {
      try {
        const picture = await deps.readCover(deps.openSource(job.url, control.signal));
        const file = picture && coverFile(picture);
        if (file && (await deps.upload(new FileLocation(job.root.source, job.dirKey, job.root.bucket), file))) {
          job.node.cover = file.name;
          extracted++;
        }
      } catch (error) {
        if (control.cancelled) throw new SyncCancelled();
        console.warn(`${MODULE_ID} | cannot extract a cover for ${job.dirKey}`, error);
      }
      done++;
      onProgress(done, jobs.length);
    },
    { concurrency: 3, control },
  );
  return extracted;
}
