import { COVER_FLAG, MODULE_ID } from "../constants";

export interface ManagedPlaylist {
  name: string;
  update(data: { name: string }): Promise<unknown>;
  setFlag(scope: string, key: string, value: string): Promise<unknown>;
  unsetFlag(scope: string, key: string): Promise<unknown>;
  deleteDialog(): Promise<unknown>;
}

export interface ManagedSound {
  delete(): Promise<unknown>;
}

export function cleanName(raw: string | null | undefined, current = ""): string | null {
  const name = raw?.trim() ?? "";
  return name && name !== current ? name : null;
}

export function canManage(document: { isOwner: boolean } | null | undefined): boolean {
  return Boolean(document?.isOwner);
}

export async function renamePlaylist(playlist: ManagedPlaylist, raw: string | null | undefined): Promise<boolean> {
  const name = cleanName(raw, playlist.name);
  if (!name) return false;
  await playlist.update({ name });
  return true;
}

export async function setPlaylistCover(playlist: ManagedPlaylist, path: string | null): Promise<void> {
  if (path) await playlist.setFlag(MODULE_ID, COVER_FLAG, path);
  else await playlist.unsetFlag(MODULE_ID, COVER_FLAG);
}

export async function deletePlaylist(playlist: ManagedPlaylist): Promise<void> {
  await playlist.deleteDialog();
}

export async function removeSound(sound: ManagedSound): Promise<void> {
  await sound.delete();
}
