import { localize } from "../foundry/i18n";
import { playlistCover, soundCover } from "../playlist/cover-resolve";
import { service } from "../service";
import { userCanUseCodex } from "../settings";
import { type ToggleTarget, type Toggleable, findToggleMacro, macroSource, markPlayingSlots, togglePlayback, toggleTarget, toggleUuid } from "./hotbar-macro";

type Playlist = foundry.documents.Playlist.Implementation;
type PlaylistSound = foundry.documents.PlaylistSound.Implementation;
type Macro = foundry.documents.Macro.Implementation;

const OUTCOME_WARNINGS: Record<string, string> = {
  missing: "AUDIO_CODEX.Macro.Missing",
  denied: "AUDIO_CODEX.Macro.NotOwner",
};

export async function toggleByUuid(uuid: string): Promise<void> {
  const doc = (await fromUuid(uuid)) as unknown as Toggleable | null;
  const warning = OUTCOME_WARNINGS[await togglePlayback(doc)];
  if (warning) ui.notifications?.warn(localize(warning));
}

function artFor(target: ToggleTarget, doc: Playlist | PlaylistSound): string | null {
  if (target.type === "Playlist") return playlistCover(doc as Playlist, service.library);
  const sound = doc as PlaylistSound;
  return soundCover(sound, sound.parent, service.library);
}

async function assignToggleMacro(target: ToggleTarget, slot: number | string): Promise<void> {
  const doc = (await fromUuid(target.uuid)) as Playlist | PlaylistSound | null;
  if (!doc) return;
  const source = macroSource(doc.name ?? target.type, target.uuid, artFor(target, doc));
  const existing = findToggleMacro(game.macros as Iterable<Macro>, target.uuid);
  if (existing && existing.img !== source.img) await existing.update({ img: source.img });
  const macro = existing ?? (await foundry.documents.Macro.implementation.create(source as never));
  if (macro) await game.user.assignHotbarMacro(macro as never, Number(slot));
}

export function onHotbarDrop(hotbar: { locked: boolean }, data: unknown, slot: number | string): boolean | undefined {
  const target = toggleTarget(data);
  if (!target || !userCanUseCodex()) return undefined;
  if (!hotbar.locked) void assignToggleMacro(target, slot);
  return false;
}

function slotPlaying(slot: string): boolean {
  const macroId = (game.user.hotbar as Record<string, string | undefined>)[slot];
  const uuid = toggleUuid(macroId ? game.macros.get(macroId) : null);
  if (!uuid) return false;
  const doc = fromUuidSync(uuid) as { playing?: boolean } | null;
  return Boolean(doc?.playing);
}

export function refreshHotbar(): void {
  const root = ui.hotbar?.element;
  if (root) markPlayingSlots(root, slotPlaying);
}
