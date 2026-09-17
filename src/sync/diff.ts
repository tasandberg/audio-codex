import { walkFiles } from "../index/tree";
import type { IndexedDir, IndexedFile, LibraryIndex, Root } from "../types";

export interface TagJob {
  rootId: string;
  key: string;
  file: IndexedFile;
}

export interface TagPlan {
  jobs: TagJob[];
  carried: number;
}

export function previousFiles(previous: LibraryIndex | null, root: Root): Map<string, IndexedFile> {
  const files = new Map<string, IndexedFile>();
  const rootIndex = previous?.roots.find((candidate) => candidate.rootId === root.id);
  if (!rootIndex) return files;
  for (const { key, file } of walkFiles(rootIndex.index, root.prefix)) files.set(key, file);
  return files;
}

export function planTags(root: Root, tree: IndexedDir, previous: LibraryIndex | null, force = false): TagPlan {
  const known = previousFiles(previous, root);
  const jobs: TagJob[] = [];
  let carried = 0;
  for (const { key, file } of walkFiles(tree, root.prefix)) {
    const prior = known.get(key);
    if (prior && !prior.pending && !force) {
      Object.assign(file, prior);
      carried++;
    } else {
      jobs.push({ rootId: root.id, key, file });
    }
  }
  return { jobs, carried };
}
