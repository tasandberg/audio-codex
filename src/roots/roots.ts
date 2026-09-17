import { FileLocation } from "../storage/file-location";
import type { Root } from "../types";

export interface RootInput {
  id?: string;
  label?: string;
  source: string;
  bucket?: string | null;
  prefix?: string;
}

export function rootLocation(root: Root): FileLocation {
  return new FileLocation(root.source, root.prefix, root.bucket);
}

export function normalizeRoot(input: RootInput, makeId: () => string): Root {
  const source = input.source.trim();
  const bucket = source === "s3" ? input.bucket?.trim() || null : null;
  const prefix = FileLocation.parse(input.prefix ?? "").key;
  const label = input.label?.trim() || prefix.split("/").pop() || bucket || source;
  return { id: input.id || makeId(), label, source, bucket, prefix };
}

export function validateRoot(root: Root): string | null {
  if (!root.source) return "AUDIO_CODEX.Roots.Error.Source";
  if (root.source === "s3" && !root.bucket) return "AUDIO_CODEX.Roots.Error.Bucket";
  return null;
}

export function rootFingerprint(roots: Root[]): string {
  const canonical = JSON.stringify(
    roots.map((root) => [root.id, root.source, root.bucket, root.prefix]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
