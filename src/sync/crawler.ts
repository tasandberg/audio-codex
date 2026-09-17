import { MODULE_ID, NOSCAN_FILE, chooseCover, isAudioFile } from "../constants";
import { emptyDir, sortTree } from "../index/tree";
import { rootLocation } from "../roots/roots";
import { FileLocation, decode } from "../storage/file-location";
import type { IndexedDir, Root } from "../types";
import { SyncCancelled, type SyncControl } from "./control";
import { runQueue } from "./queue";

export interface BrowseResult {
  dirs: string[];
  files: string[];
}

export type Browse = (source: string, target: string, options: { bucket?: string }) => Promise<BrowseResult>;

export interface CrawlProgress {
  dirs: number;
  files: number;
}

export interface CrawlOptions {
  browse: Browse;
  control: SyncControl;
  concurrency?: number;
  onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlResult {
  tree: IndexedDir;
  urlBase: string | null;
  errors: string[];
}

interface Job {
  location: FileLocation;
  node: IndexedDir;
  parent: IndexedDir | null;
}

export function lastSegment(path: string): string {
  const clean = path.replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1);
}

export function deriveUrlBase(fileUrl: string, location: FileLocation): string | null {
  const encoded = location.target;
  return fileUrl.endsWith(encoded) ? fileUrl.slice(0, fileUrl.length - encoded.length) : null;
}

export async function crawlRoot(root: Root, options: CrawlOptions): Promise<CrawlResult> {
  const tree = emptyDir();
  const errors: string[] = [];
  let urlBase: string | null = null;
  const progress: CrawlProgress = { dirs: 0, files: 0 };

  await runQueue<Job>(
    [{ location: rootLocation(root), node: tree, parent: null }],
    async ({ location, node, parent }, enqueue) => {
      let result: BrowseResult;
      try {
        result = await options.browse(location.source, location.target, location.browseOptions);
      } catch (error) {
        if (error instanceof SyncCancelled) throw error;
        errors.push(location.key);
        console.warn(`${MODULE_ID} | cannot browse ${location.source}:${location.key}`, error);
        return;
      }
      const names = result.files.map((file) => decode(lastSegment(file)));
      if (names.includes(NOSCAN_FILE)) return;
      parent?.dirs.push(node);
      result.files.forEach((file, index) => {
        const name = names[index];
        if (!isAudioFile(name)) return;
        node.files.push({ name });
        urlBase ??= deriveUrlBase(file, location.join(name));
      });
      const cover = chooseCover(names);
      if (cover) node.cover = cover;
      for (const dir of result.dirs) {
        const raw = lastSegment(dir);
        const segment = location.source === "s3" ? raw : decode(raw);
        if (segment) enqueue({ location: location.join(segment), node: emptyDir(segment), parent: node });
      }
      progress.dirs++;
      progress.files += node.files.length;
      options.onProgress?.({ ...progress });
    },
    { concurrency: options.concurrency ?? 6, control: options.control },
  );

  return { tree: sortTree(tree), urlBase, errors };
}
