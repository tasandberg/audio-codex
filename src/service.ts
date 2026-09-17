import { INDEX_VERSION, MODULE_ID, isImageFile } from "./constants";
import { browse, indexWriter, uploadDeps, worldId } from "./foundry/adapters";
import { localize } from "./foundry/i18n";
import { type SplicedFile, indexDirectory, readIndex, spliceFiles, writeIndex } from "./index/index-store";
import { countFiles } from "./index/tree";
import { Library } from "./library/library";
import { type OverrideEdit, withOverrides, withoutOverride } from "./library/overrides";
import { rootFingerprint } from "./roots/roots";
import { getOverrides, getPointer, getRoots, setOverrides, setPointer } from "./settings";
import { FileLocation } from "./storage/file-location";
import { blobSource, httpSource } from "./sync/byte-source";
import { SyncCancelled, SyncControl } from "./sync/control";
import { extractCovers, planCovers } from "./sync/covers";
import { deriveUrlBase } from "./sync/crawler";
import { runQueue } from "./sync/queue";
import { type SyncOutcome, type SyncProgress, TAG_CONCURRENCY, runSync } from "./sync/sync";
import { readCover, readTags } from "./sync/tag-reader";
import type { LibraryIndex, Root } from "./types";
import type { UploadedFile } from "./upload/uploader";

type Listener = () => void;

export class LibraryService {
  library: Library = Library.build(null, [], {});
  index: LibraryIndex | null = null;
  control: SyncControl | null = null;
  progress: SyncProgress | null = null;
  readonly #listeners = new Set<Listener>();
  #loading: Promise<void> | null = null;
  #autoSynced = false;
  #emitTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    if (this.#emitTimer) clearTimeout(this.#emitTimer);
    this.#emitTimer = null;
    for (const listener of this.#listeners) listener();
  }

  #emitSoon(): void {
    this.#emitTimer ??= setTimeout(() => this.#emit(), 200);
  }

  get stale(): boolean {
    const pointer = getPointer();
    return pointer.rootFingerprint !== rootFingerprint(getRoots()) || pointer.partial.length > 0;
  }

  ensureLoaded(): Promise<void> {
    this.#loading ??= this.load();
    return this.#loading;
  }

  async load(): Promise<void> {
    try {
      this.index = await readIndex(getPointer());
    } catch (error) {
      console.warn(`${MODULE_ID} | cannot load index`, error);
      this.index = null;
    }
    this.rebuild();
  }

  rebuild(): void {
    this.library = Library.build(this.index, getRoots(), getOverrides());
    this.#emit();
  }

  onPointerChanged(): void {
    if (getPointer().generatedAt !== this.index?.generatedAt) void this.load();
  }

  async autoSync(): Promise<void> {
    if (!game.user.isGM || this.#autoSynced) return;
    this.#autoSynced = true;
    await this.sync();
  }

  async sync(force = false): Promise<SyncOutcome | null> {
    if (!game.user.isGM || this.control) return null;
    const control = new SyncControl();
    this.control = control;
    this.#emit();
    try {
      await this.ensureLoaded();
      const outcome = await runSync(
        {
          roots: getRoots(),
          previous: this.index,
          previousCacheFile: getPointer().cacheFile,
          browse,
          openSource: (url, signal) => httpSource(url, undefined, signal),
          readTags,
          readCover,
          uploadCover: uploadDeps.upload,
          write: (index) => writeIndex(index, indexDirectory(worldId()), indexWriter),
          now: () => Date.now(),
        },
        control,
        {
          force,
          onProgress: (progress) => {
            this.progress = progress;
            this.#emitSoon();
          },
        },
      );
      this.index = outcome.index;
      await setPointer(outcome.pointer);
      this.rebuild();
      ui.notifications?.info(localize("AUDIO_CODEX.Sync.Done", { tagged: outcome.tagged, carried: outcome.carried, covered: outcome.covered, failed: outcome.failed }));
      if (outcome.pointer.partial.length) ui.notifications?.warn(localize("AUDIO_CODEX.Sync.Partial"));
      return outcome;
    } catch (error) {
      if (error instanceof SyncCancelled) ui.notifications?.warn(localize("AUDIO_CODEX.Sync.Cancelled"));
      else {
        console.error(`${MODULE_ID} | sync failed`, error);
        ui.notifications?.error(localize("AUDIO_CODEX.Sync.Failed"));
      }
      return null;
    } finally {
      this.control = null;
      this.progress = null;
      this.#emit();
    }
  }

  async edit(edits: OverrideEdit[]): Promise<void> {
    await this.ensureLoaded();
    await setOverrides(withOverrides(getOverrides(), edits));
  }

  async revert(rootId: string, key: string): Promise<void> {
    await this.ensureLoaded();
    await setOverrides(withoutOverride(getOverrides(), rootId, key));
  }

  async splice(root: Root, uploaded: UploadedFile[], control: SyncControl): Promise<void> {
    if (!uploaded.length) return;
    await this.ensureLoaded();
    const covers: string[] = [];
    const audio: UploadedFile[] = [];
    for (const job of uploaded) {
      if (isImageFile(job.file.name)) covers.push(job.key);
      else audio.push(job);
    }
    const entries = new Array<SplicedFile>(audio.length);
    await runQueue(
      audio.map((job, position) => ({ job, position })),
      async ({ job, position }) => {
        entries[position] = { key: job.key, tags: await readTags(blobSource(job.file)).catch(() => ({})) };
      },
      { concurrency: TAG_CONCURRENCY, control },
    );
    const first = uploaded[0];
    const urlBase = deriveUrlBase(first.path, new FileLocation(root.source, first.key, root.bucket));
    const index = spliceFiles(this.index, root, urlBase, entries, Date.now(), covers);
    const rootIndex = index.roots.find((candidate) => candidate.rootId === root.id);
    if (rootIndex) {
      const touched = new Set(uploaded.map((job) => job.directory.key));
      const jobs = planCovers(root, rootIndex, touched);
      this.progress = { phase: "covers", done: 0, total: jobs.length };
      this.#emit();
      try {
        await extractCovers(
          jobs,
          { openSource: (url, signal) => httpSource(url, undefined, signal), readCover, upload: uploadDeps.upload },
          control,
          (done, total) => {
            if (control.cancelled) return;
            this.progress = { phase: "covers", done, total };
            this.#emitSoon();
          },
        );
      } finally {
        this.progress = null;
        this.#emit();
      }
    }
    const cacheFile = await writeIndex(index, indexDirectory(worldId()), indexWriter);
    this.index = index;
    await setPointer({ ...getPointer(), version: INDEX_VERSION, generatedAt: index.generatedAt, fileCount: countFiles(index), cacheFile });
    this.rebuild();
  }
}

export const service = new LibraryService();
