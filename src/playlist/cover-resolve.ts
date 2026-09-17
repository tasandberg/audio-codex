import { COVER_FLAG, MODULE_ID } from "../constants";

export interface CoverLibrary {
  trackByUrl(url: string | null | undefined): { cover: string | null } | null;
}

export interface CoverFlagged {
  getFlag(scope: string, key: string): unknown;
}

export interface CoverSound extends CoverFlagged {
  path?: string | null | undefined;
}

export interface AudibleSound {
  isOwner: boolean;
  playing: boolean;
}

export interface CoverPlaylist extends CoverFlagged {
  playbackOrder: readonly string[];
  sounds: { get(id: string): (CoverSound & AudibleSound) | undefined };
}

export function coverFlag(document: CoverFlagged | null | undefined): string | null {
  const value = document?.getFlag(MODULE_ID, COVER_FLAG);
  return typeof value === "string" && value ? value : null;
}

export function coverChanged(changes: object | null | undefined): boolean {
  if (!changes) return false;
  if (Object.keys(changes).some((key) => key.startsWith(`flags.${MODULE_ID}.`))) return true;
  const flags = (changes as { flags?: Record<string, unknown> }).flags?.[MODULE_ID];
  if (!flags || typeof flags !== "object") return false;
  return COVER_FLAG in flags || `-=${COVER_FLAG}` in flags;
}

export function audibleSounds<T extends AudibleSound>(order: readonly string[], get: (id: string) => T | undefined): T[] {
  const sounds: T[] = [];
  for (const id of order) {
    const sound = get(id);
    if (sound && (sound.isOwner || sound.playing)) sounds.push(sound);
  }
  return sounds;
}

const ownCover = (sound: CoverSound | null | undefined, library: CoverLibrary): string | null =>
  coverFlag(sound) ?? library.trackByUrl(sound?.path)?.cover ?? null;

export function playlistCover(playlist: CoverPlaylist | null | undefined, library: CoverLibrary): string | null {
  const own = coverFlag(playlist);
  if (own) return own;
  if (!playlist) return null;
  for (const sound of audibleSounds(playlist.playbackOrder, (id) => playlist.sounds.get(id))) {
    const cover = ownCover(sound, library);
    if (cover) return cover;
  }
  return null;
}

export function soundCover(sound: CoverSound | null | undefined, playlist: CoverPlaylist | null | undefined, library: CoverLibrary): string | null {
  return coverFlag(sound) ?? coverFlag(playlist) ?? library.trackByUrl(sound?.path)?.cover ?? playlistCover(playlist, library);
}
