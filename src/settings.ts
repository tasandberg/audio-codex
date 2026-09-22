import { MODULE_ID } from "./constants";
import { DEFAULT_MINIMUM_ROLE, MINIMUM_ROLE_CHOICES, canUseCodex, normalizeMinimumRole } from "./permissions";
import type { Overrides, Pointer, Root } from "./types";

export const EMPTY_POINTER: Pointer = { version: 0, generatedAt: 0, rootFingerprint: "", fileCount: 0, cacheFile: "", partial: [] };

export interface SettingListeners {
  roots(): void;
  overrides(): void;
  pointer(): void;
  minimumRole(): void;
}

export function registerSettings(listeners: SettingListeners, rootsMenu: new () => foundry.applications.api.ApplicationV2.Any): void {
  game.settings.register(MODULE_ID, "roots", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => listeners.roots(),
  });
  game.settings.register(MODULE_ID, "overrides", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => listeners.overrides(),
  });
  game.settings.register(MODULE_ID, "pointer", {
    scope: "world",
    config: false,
    type: Object,
    default: EMPTY_POINTER,
    onChange: () => listeners.pointer(),
  });
  game.settings.register(MODULE_ID, "minimumRole", {
    name: "AUDIO_CODEX.Permission.MinimumRole",
    hint: "AUDIO_CODEX.Permission.MinimumRoleHint",
    scope: "world",
    config: true,
    type: Number,
    choices: MINIMUM_ROLE_CHOICES as never,
    default: DEFAULT_MINIMUM_ROLE,
    onChange: () => listeners.minimumRole(),
  });
  game.settings.registerMenu(MODULE_ID, "rootsMenu", {
    name: "AUDIO_CODEX.Roots.Title",
    label: "AUDIO_CODEX.Roots.Label",
    hint: "AUDIO_CODEX.Roots.Hint",
    icon: "fa-solid fa-folder-tree",
    type: rootsMenu,
    restricted: true,
  });
}

export const getRoots = (): Root[] => [...(game.settings.get(MODULE_ID, "roots") ?? [])];
export const setRoots = async (roots: Root[]): Promise<void> => {
  await game.settings.set(MODULE_ID, "roots", roots);
};
export const getOverrides = (): Overrides => game.settings.get(MODULE_ID, "overrides") ?? {};
export const setOverrides = async (overrides: Overrides): Promise<void> => {
  await game.settings.set(MODULE_ID, "overrides", overrides);
};
export const getPointer = (): Pointer => game.settings.get(MODULE_ID, "pointer") ?? EMPTY_POINTER;
export const setPointer = async (pointer: Pointer): Promise<void> => {
  await game.settings.set(MODULE_ID, "pointer", pointer);
};
export const getMinimumRole = (): number => normalizeMinimumRole(game.settings.get(MODULE_ID, "minimumRole"));
export const userCanUseCodex = (): boolean => canUseCodex(game.user.role, getMinimumRole());
