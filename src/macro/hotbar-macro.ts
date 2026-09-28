import { MODULE_ID, TOGGLE_FLAG } from "../constants";

export const TOGGLE_TYPES = ["Playlist", "PlaylistSound"] as const;
export const FALLBACK_ICON = "icons/svg/sound.svg";
export const PLAYING_CLASS = "ac-hotbar-playing";

export type ToggleType = (typeof TOGGLE_TYPES)[number];

export interface ToggleTarget {
  type: ToggleType;
  uuid: string;
}

export interface MacroSource {
  name: string;
  type: "script";
  img: string;
  command: string;
  flags: Record<string, Record<string, string>>;
}

export interface ToggleMacro {
  isOwner: boolean;
  getFlag(scope: string, key: string): unknown;
}

export interface Playable {
  playing: boolean;
}

export interface ToggleablePlaylist extends Playable {
  isOwner: boolean;
  playAll(): Promise<unknown>;
  stopAll(): Promise<unknown>;
  playSound(sound: never): Promise<unknown>;
  stopSound(sound: never): Promise<unknown>;
}

export interface ToggleableSound extends Playable {
  isOwner: boolean;
  parent: ToggleablePlaylist | null;
}

export type Toggleable = ({ documentName: "Playlist" } & ToggleablePlaylist) | ({ documentName: "PlaylistSound" } & ToggleableSound);

export type ToggleOutcome = "played" | "stopped" | "missing" | "denied";

const isToggleType = (value: unknown): value is ToggleType => TOGGLE_TYPES.includes(value as ToggleType);

export function toggleTarget(data: unknown): ToggleTarget | null {
  if (!data || typeof data !== "object") return null;
  const { type, uuid } = data as { type?: unknown; uuid?: unknown };
  if (!isToggleType(type) || typeof uuid !== "string" || !uuid) return null;
  return { type, uuid };
}

export function toggleCommand(uuid: string): string {
  return `await game.modules.get(${JSON.stringify(MODULE_ID)})?.api?.toggle(${JSON.stringify(uuid)});`;
}

export function macroSource(name: string, uuid: string, img: string | null | undefined): MacroSource {
  return {
    name,
    type: "script",
    img: img || FALLBACK_ICON,
    command: toggleCommand(uuid),
    flags: { [MODULE_ID]: { [TOGGLE_FLAG]: uuid } },
  };
}

export function toggleUuid(macro: Pick<ToggleMacro, "getFlag"> | null | undefined): string | null {
  const value = macro?.getFlag(MODULE_ID, TOGGLE_FLAG);
  return typeof value === "string" && value ? value : null;
}

export function findToggleMacro<T extends ToggleMacro>(macros: Iterable<T>, uuid: string): T | null {
  for (const macro of macros) {
    if (macro.isOwner && toggleUuid(macro) === uuid) return macro;
  }
  return null;
}

export async function togglePlayback(doc: Toggleable | null | undefined): Promise<ToggleOutcome> {
  if (!doc) return "missing";
  if (doc.documentName === "Playlist") {
    if (!doc.isOwner) return "denied";
    if (doc.playing) {
      await doc.stopAll();
      return "stopped";
    }
    await doc.playAll();
    return "played";
  }
  const playlist = doc.parent;
  if (!playlist) return "missing";
  if (!doc.isOwner) return "denied";
  if (doc.playing) {
    await playlist.stopSound(doc as never);
    return "stopped";
  }
  await playlist.playSound(doc as never);
  return "played";
}

export function markPlayingSlots(root: ParentNode, isPlaying: (slot: string) => boolean): void {
  for (const slot of root.querySelectorAll<HTMLElement>(".slot[data-slot]")) {
    slot.classList.toggle(PLAYING_CLASS, isPlaying(slot.dataset.slot ?? ""));
  }
}
