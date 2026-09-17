import { COVER_FLAG, MODULE_ID } from "../constants";
import { localize } from "../foundry/i18n";
import type { Folder } from "../library/library";
import { service } from "../service";
import { type DragPayload, coverUpdate, firstCover, newTracks, resolvePayload, soundData } from "./playlist-drop";

const addedMessage = (count: number, playlist: string | null) =>
  localize(count === 1 ? "AUDIO_CODEX.Drop.AddedOne" : "AUDIO_CODEX.Drop.Added", { count, playlist: playlist ?? "" });

export async function dropOnPlaylist(playlistId: string, payload: DragPayload): Promise<number> {
  const playlist = game.playlists.get(playlistId);
  if (!playlist) return 0;
  if (!playlist.isOwner) {
    ui.notifications?.warn(localize("AUDIO_CODEX.Drop.NotOwner"));
    return 0;
  }
  const tracks = newTracks(resolvePayload(payload, service.library), service.library, playlist.sounds.map((sound) => sound.path));
  if (!tracks.length) return 0;
  const sounds = soundData(tracks, service.library, playlist.sounds.map((sound) => sound.sort));
  await playlist.createEmbeddedDocuments("PlaylistSound", sounds);
  const cover = coverUpdate(playlist.getFlag(MODULE_ID, COVER_FLAG), tracks);
  if (cover) await playlist.setFlag(MODULE_ID, COVER_FLAG, cover);
  ui.notifications?.info(addedMessage(sounds.length, playlist.name));
  return sounds.length;
}

export async function createPlaylistFromFolder(folder: Folder): Promise<void> {
  const tracks = newTracks(service.library.tracksBeneath(folder), service.library, []);
  const sounds = soundData(tracks, service.library, []);
  const cover = folder.cover ?? firstCover(tracks);
  const playlist = await foundry.documents.Playlist.implementation.create({
    name: folder.album?.title ?? folder.name,
    sorting: foundry.CONST.PLAYLIST_SORT_MODES.MANUAL,
    sounds,
    ...(cover ? { flags: { [MODULE_ID]: { [COVER_FLAG]: cover } } } : {}),
  });
  if (playlist) ui.notifications?.info(addedMessage(sounds.length, playlist.name));
}

export interface RelinkLibrary {
  trackByUrl(url: string | null | undefined): { cover: string | null } | null;
  staleCover(url: string | null | undefined): boolean;
}

export interface RelinkSound {
  id: string | null;
  path: string | null;
  getFlag(scope: string, key: string): unknown;
}

export interface RelinkPlaylist {
  isOwner: boolean;
  sounds: { contents: RelinkSound[] };
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: string): Promise<unknown>;
  unsetFlag(scope: string, key: string): Promise<unknown>;
  updateEmbeddedDocuments(name: string, updates: Array<Record<string, unknown>>): Promise<unknown>;
}

export interface RelinkResult {
  sounds: number;
  playlists: number;
  unmatched: number;
}

export async function relinkPlaylists(playlists: readonly RelinkPlaylist[], library: RelinkLibrary): Promise<RelinkResult> {
  const result: RelinkResult = { sounds: 0, playlists: 0, unmatched: 0 };
  for (const playlist of playlists) {
    if (!playlist.isOwner) continue;
    const updates: Array<Record<string, unknown>> = [];
    let cover: string | null = null;
    for (const sound of playlist.sounds.contents) {
      const track = library.trackByUrl(sound.path);
      if (!track) {
        result.unmatched += 1;
        continue;
      }
      if (!track.cover) {
        if (sound.id && sound.getFlag(MODULE_ID, COVER_FLAG)) updates.push({ _id: sound.id, [`flags.${MODULE_ID}.-=${COVER_FLAG}`]: null });
        continue;
      }
      cover ??= track.cover;
      if (sound.getFlag(MODULE_ID, COVER_FLAG) === track.cover || !sound.id) continue;
      updates.push({ _id: sound.id, flags: { [MODULE_ID]: { [COVER_FLAG]: track.cover } } });
    }
    let changed = false;
    if (updates.length) {
      await playlist.updateEmbeddedDocuments("PlaylistSound", updates);
      result.sounds += updates.length;
      changed = true;
    }
    const current = playlist.getFlag(MODULE_ID, COVER_FLAG);
    const stale = typeof current === "string" && library.staleCover(current);
    if (cover && (!current || stale)) {
      await playlist.setFlag(MODULE_ID, COVER_FLAG, cover);
      changed = true;
    } else if (stale) {
      await playlist.unsetFlag(MODULE_ID, COVER_FLAG);
      changed = true;
    }
    if (changed) result.playlists += 1;
  }
  return result;
}
