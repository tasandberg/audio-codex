import { MODULE_ID } from "../constants";
import type { PlaylistSource } from "../app/view";
import type { IndexWriter } from "../index/index-store";
import { type CoverLibrary, audibleSounds, playlistCover, soundCover } from "../playlist/cover-resolve";
import type { FileLocation } from "../storage/file-location";
import type { Browse } from "../sync/crawler";
import type { UploadDeps } from "../upload/uploader";

const picker = () => foundry.applications.apps.FilePicker.implementation;

const isExisting = (error: unknown) => /EEXIST|already exists/i.test(String((error as Error)?.message ?? error));

async function createDirectory(source: string, target: string, options: { bucket?: string }): Promise<void> {
  try {
    await picker().createDirectory(source, target, options);
  } catch (error) {
    if (!isExisting(error)) throw error;
  }
}

export const browse: Browse = async (source, target, options) => {
  const result = await picker().browse(source, target, options);
  return { dirs: result.dirs ?? [], files: result.files ?? [] };
};

async function uploadFile(source: string, target: string, file: File, bucket: string | undefined): Promise<string | null> {
  const body = bucket ? { bucket } : {};
  const response = await picker().upload(source, target, file, body, { notify: false });
  return response && typeof response === "object" && "path" in response && typeof response.path === "string" ? response.path : null;
}

export const indexWriter: IndexWriter = {
  createDirectory: (path) => createDirectory("data", path, {}),
  upload: (path, file) => uploadFile("data", path, file, undefined),
};

export const uploadDeps: UploadDeps = {
  createDirectory: (location: FileLocation) => createDirectory(location.source, location.target, location.browseOptions),
  async upload(location: FileLocation, file: File) {
    const path = await uploadFile(location.source, location.target, file, location.browseOptions.bucket);
    if (!path) console.warn(`${MODULE_ID} | upload returned no path for ${location.key}/${file.name}`);
    return path;
  },
};

const byName = (a: Playlist.Implementation, b: Playlist.Implementation) => (a.name ?? "").localeCompare(b.name ?? "", game.i18n.lang);
const bySort = (a: Playlist.Implementation, b: Playlist.Implementation) => (a.sort ?? 0) - (b.sort ?? 0);

export const playlistSources = (expanded: ReadonlySet<string>, library: CoverLibrary): PlaylistSource[] =>
  game.playlists.contents
    .filter((playlist) => playlist.visible)
    .sort(game.playlists.sortingMode === "a" ? byName : bySort)
    .map((playlist) => {
      const sounds = audibleSounds(playlist.playbackOrder, (id) => playlist.sounds.get(id));
      return {
        id: playlist.id,
        name: playlist.name,
        cover: playlistCover(playlist, library),
        count: sounds.length,
        sounds: expanded.has(playlist.id) ? sounds.map((sound) => ({ id: sound.id, name: sound.name, cover: soundCover(sound, playlist, library) })) : [],
      };
    });

export const worldId = (): string => game.world.id;
