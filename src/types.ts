export interface Root {
  id: string;
  label: string;
  source: string;
  bucket: string | null;
  prefix: string;
}

export interface Tags {
  artist?: string;
  album?: string;
  title?: string;
  track?: number;
  duration?: number;
}

export interface IndexedFile extends Tags {
  name: string;
  pending?: true;
}

export interface IndexedDir {
  dir: string;
  files: IndexedFile[];
  dirs: IndexedDir[];
  cover?: string;
}

export interface RootIndex {
  rootId: string;
  urlBase: string | null;
  index: IndexedDir;
}

export interface LibraryIndex {
  version: number;
  generatedAt: number;
  roots: RootIndex[];
}

export type Pointer = {
  version: number;
  generatedAt: number;
  rootFingerprint: string;
  fileCount: number;
  cacheFile: string;
  partial: string[];
};

export type EditableField = "artist" | "album" | "title" | "track";

export type OverrideFields = Partial<Pick<Tags, EditableField>>;

export type Overrides = Record<string, Record<string, OverrideFields>>;
