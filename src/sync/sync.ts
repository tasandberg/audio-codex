import { INDEX_VERSION, MODULE_ID } from "../constants";
import { countFiles } from "../index/tree";
import { rootFingerprint } from "../roots/roots";
import { FileLocation } from "../storage/file-location";
import type { LibraryIndex, Pointer, Root, RootIndex, Tags } from "../types";
import type { ByteSource } from "./byte-source";
import { type CoverPicture, extractCovers, planCovers } from "./covers";
import { SyncCancelled, type SyncControl } from "./control";
import { type Browse, crawlRoot } from "./crawler";
import { type TagJob, planTags } from "./diff";
import { runQueue } from "./queue";

export interface SyncDeps {
  roots: Root[];
  previous: LibraryIndex | null;
  previousCacheFile?: string | null;
  browse: Browse;
  openSource(url: string, signal: AbortSignal): ByteSource;
  readTags(source: ByteSource): Promise<Tags>;
  readCover(source: ByteSource): Promise<CoverPicture | null>;
  uploadCover(location: FileLocation, file: File): Promise<string | null>;
  write(index: LibraryIndex): Promise<string>;
  now(): number;
}

export const TAG_CONCURRENCY = 12;

export type SyncPhase = "crawl" | "tags" | "covers" | "write";

export interface SyncProgress {
  phase: SyncPhase;
  done: number;
  total: number;
}

export interface SyncOptions {
  force?: boolean;
  tagConcurrency?: number;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncOutcome {
  index: LibraryIndex;
  pointer: Pointer;
  tagged: number;
  carried: number;
  covered: number;
  failed: number;
}

function unchangedIndex(previous: LibraryIndex | null, cacheFile: string | null | undefined, roots: RootIndex[]): LibraryIndex | null {
  if (!previous || !cacheFile || previous.version !== INDEX_VERSION) return null;
  return canonical(previous.roots) === canonical(roots) ? previous : null;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
      : entry,
  );
}

export async function runSync(deps: SyncDeps, control: SyncControl, options: SyncOptions = {}): Promise<SyncOutcome> {
  const report = (progress: SyncProgress) => {
    if (!control.cancelled) options.onProgress?.(progress);
  };
  const roots: RootIndex[] = [];
  const partial: string[] = [];
  const jobs: Array<TagJob & { url: string }> = [];
  let carried = 0;

  for (const root of deps.roots) {
    report({ phase: "crawl", done: 0, total: 0 });
    const crawl = await crawlRoot(root, {
      browse: deps.browse,
      control,
      onProgress: (progress) => report({ phase: "crawl", done: progress.dirs, total: progress.files }),
    }).catch((error: unknown) => {
      if (error instanceof SyncCancelled) throw error;
      console.warn(`${MODULE_ID} | crawl failed for root ${root.label}`, error);
      return { tree: { dir: "", files: [], dirs: [] }, urlBase: null, errors: [root.prefix] };
    });
    const previousRoot = deps.previous?.roots.find((candidate) => candidate.rootId === root.id);
    if (crawl.errors.length) partial.push(root.id);
    if (crawl.errors.length && previousRoot) {
      roots.push(previousRoot);
      continue;
    }
    const plan = planTags(root, crawl.tree, deps.previous, options.force);
    carried += plan.carried;
    for (const job of plan.jobs) {
      jobs.push({ ...job, url: new FileLocation(root.source, job.key, root.bucket).url(crawl.urlBase) });
    }
    roots.push({ rootId: root.id, urlBase: crawl.urlBase, index: crawl.tree });
  }

  let tagged = 0;
  let failed = 0;
  report({ phase: "tags", done: 0, total: jobs.length });
  await runQueue(
    jobs,
    async (job) => {
      try {
        const tags = await deps.readTags(deps.openSource(job.url, control.signal));
        delete job.file.pending;
        Object.assign(job.file, tags);
        tagged++;
      } catch (error) {
        if (control.cancelled) throw new SyncCancelled();
        job.file.pending = true;
        failed++;
        console.warn(`${MODULE_ID} | cannot read tags for ${job.url}`, error);
      }
      report({ phase: "tags", done: tagged + failed, total: jobs.length });
    },
    { concurrency: options.tagConcurrency ?? TAG_CONCURRENCY, control },
  );

  const coverJobs = deps.roots.flatMap((root, position) => (partial.includes(root.id) ? [] : planCovers(root, roots[position])));
  report({ phase: "covers", done: 0, total: coverJobs.length });
  const covered = await extractCovers(
    coverJobs,
    { openSource: deps.openSource, readCover: deps.readCover, upload: deps.uploadCover },
    control,
    (done, total) => report({ phase: "covers", done, total }),
  );

  await control.checkpoint();
  report({ phase: "write", done: 0, total: 1 });
  const unchanged = unchangedIndex(deps.previous, deps.previousCacheFile, roots);
  const index: LibraryIndex = unchanged ?? { version: INDEX_VERSION, generatedAt: deps.now(), roots };
  const cacheFile = unchanged && deps.previousCacheFile ? deps.previousCacheFile : await deps.write(index);
  const pointer: Pointer = {
    version: INDEX_VERSION,
    generatedAt: index.generatedAt,
    rootFingerprint: rootFingerprint(deps.roots),
    fileCount: countFiles(index),
    cacheFile,
    partial,
  };
  report({ phase: "write", done: 1, total: 1 });
  return { index, pointer, tagged, carried, covered, failed };
}
