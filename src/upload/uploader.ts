import { MODULE_ID, chooseCover, isAudioFile, isImageFile } from "../constants";
import type { FileLocation } from "../storage/file-location";
import type { SyncControl } from "../sync/control";
import { runQueue } from "../sync/queue";

export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

export interface FileEntryLike extends EntryLike {
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
}

export interface DirectoryEntryLike extends EntryLike {
  createReader(): { readEntries(success: (entries: EntryLike[]) => void, failure?: (error: unknown) => void): void };
}

export interface DroppedFile {
  path: string[];
  file: File;
}

export interface UploadJob {
  directory: FileLocation;
  file: File;
  key: string;
}

export interface UploadPlan {
  directories: FileLocation[];
  uploads: UploadJob[];
}

export interface UploadDeps {
  createDirectory(location: FileLocation): Promise<void>;
  upload(location: FileLocation, file: File): Promise<string | null>;
}

export interface UploadedFile extends UploadJob {
  path: string;
}

export interface UploadResult {
  uploaded: UploadedFile[];
  failed: UploadJob[];
}

function readAll(directory: DirectoryEntryLike): Promise<EntryLike[]> {
  const reader = directory.createReader();
  const entries: EntryLike[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(entries);
        entries.push(...batch);
        next();
      }, reject);
    next();
  });
}

export async function collectFiles(entries: EntryLike[], path: string[] = []): Promise<DroppedFile[]> {
  const found: DroppedFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      found.push(...(await collectFiles(await readAll(entry as DirectoryEntryLike), [...path, entry.name])));
    } else if (entry.isFile && (isAudioFile(entry.name) || isImageFile(entry.name))) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileEntryLike).file(resolve, reject));
      found.push({ path, file });
    }
  }
  return found;
}

export function hasAudioFile(files: DroppedFile[]): boolean {
  return files.some((dropped) => isAudioFile(dropped.file.name));
}

export function keepCovers(files: DroppedFile[]): DroppedFile[] {
  const images = new Map<string, DroppedFile[]>();
  const audioDirs = new Set<string>();
  for (const dropped of files) {
    const key = dropped.path.join("/");
    if (isImageFile(dropped.file.name)) {
      const group = images.get(key) ?? [];
      group.push(dropped);
      images.set(key, group);
    } else if (isAudioFile(dropped.file.name)) {
      audioDirs.add(key);
    }
  }
  const chosen = new Set<DroppedFile>();
  for (const [key, group] of images) {
    if (!audioDirs.has(key)) continue;
    const name = chooseCover(group.map((dropped) => dropped.file.name));
    const pick = group.find((dropped) => dropped.file.name === name);
    if (pick) chosen.add(pick);
  }
  return files.filter((dropped) => !isImageFile(dropped.file.name) || chosen.has(dropped));
}

export function planUpload(dropped: DroppedFile[], destination: FileLocation): UploadPlan {
  const files = keepCovers(dropped);
  const directories = new Map<string, FileLocation>();
  const uploads = files.map(({ path, file }) => {
    let directory = destination;
    for (const segment of path) {
      directory = directory.join(segment);
      directories.set(directory.key, directory);
    }
    return { directory, file, key: directory.join(file.name).key };
  });
  const needsDirectories = destination.source !== "s3";
  return { directories: needsDirectories ? [...directories.values()] : [], uploads };
}

export async function runUpload(
  plan: UploadPlan,
  deps: UploadDeps,
  control: SyncControl,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<UploadResult> {
  for (const directory of plan.directories) {
    await control.checkpoint();
    await deps.createDirectory(directory);
  }
  const uploaded: UploadedFile[] = [];
  const failed: UploadJob[] = [];
  await runQueue(
    plan.uploads,
    async (job) => {
      const path = await deps.upload(job.directory, job.file).catch((error: unknown) => {
        console.warn(`${MODULE_ID} | upload failed for ${job.key}`, error);
        return null;
      });
      if (path) uploaded.push({ ...job, path });
      else failed.push(job);
      onProgress(uploaded.length + failed.length, plan.uploads.length);
    },
    { concurrency: 3, control },
  );
  return { uploaded, failed };
}
