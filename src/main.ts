import "./styles/audio-codex.css";
import { LibraryApp } from "./app/library-app";
import { RootsMenu } from "./app/roots-app";
import { MODULE_ID } from "./constants";
import { decoratePlaylistDirectory } from "./foundry/sidebar-art";
import { coverChanged, playlistCover, soundCover } from "./playlist/cover-resolve";
import { service } from "./service";
import { registerSettings, userCanUseCodex } from "./settings";

const onPermissionChanged = (): void => {
  if (userCanUseCodex()) void service.ensureLoaded();
  else LibraryApp.closeIfOpen();
  void ui.playlists?.render({ parts: ["directory", "playing"] });
};

Hooks.once("init", () => {
  registerSettings(
    {
      roots: () => service.rebuild(),
      overrides: () => service.rebuild(),
      pointer: () => service.onPointerChanged(),
      minimumRole: () => onPermissionChanged(),
    },
    RootsMenu,
  );
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) Object.assign(module, { api: { open: () => LibraryApp.open(), sync: (force = false) => service.sync(force), service } });
  let rendered = service.library;
  service.subscribe(() => {
    if (service.library === rendered) return;
    rendered = service.library;
    void ui.playlists?.render({ parts: ["directory", "playing"] });
  });
  if (userCanUseCodex()) void service.ensureLoaded();
});

const coverFor = (playlistId: string, soundId: string | null): string | null => {
  const playlist = game.playlists.get(playlistId);
  if (!playlist) return null;
  const sound = soundId ? playlist.sounds.get(soundId) : undefined;
  return sound ? soundCover(sound, playlist, service.library) : playlistCover(playlist, service.library);
};

Hooks.on("updatePlaylist", (_playlist, changes) => {
  if (coverChanged(changes)) void ui.playlists?.render({ parts: ["directory", "playing"] });
});

Hooks.on("renderPlaylistDirectory", (_app, element) => {
  const actions = userCanUseCodex() ? element.querySelector(".header-actions") : null;
  if (actions && !actions.querySelector(".audio-codex-open")) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("audio-codex-open");
    button.innerHTML = `<i class="fa-solid fa-book-open" inert></i> ${game.i18n.localize("AUDIO_CODEX.Open")}`;
    button.addEventListener("click", () => void LibraryApp.open());
    actions.append(button);
  }
  decoratePlaylistDirectory(element, coverFor);
});
