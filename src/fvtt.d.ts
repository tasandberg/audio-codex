import type { COVER_FLAG } from "./constants";
import type { Overrides, Pointer, Root } from "./types";

declare module "fvtt-types/configuration" {
  interface AssumeHookRan {
    ready: never;
  }

  interface FlagConfig {
    Playlist: { "audio-codex": { [K in typeof COVER_FLAG]?: string } };
    PlaylistSound: { "audio-codex": { [K in typeof COVER_FLAG]?: string } };
  }

  interface SettingConfig {
    "audio-codex.roots": Root[];
    "audio-codex.overrides": Overrides;
    "audio-codex.pointer": Pointer;
    "audio-codex.minimumRole": number;
  }
}
