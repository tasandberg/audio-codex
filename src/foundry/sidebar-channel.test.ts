import { beforeEach, describe, expect, it } from "vitest";
import type { AudioChannel } from "../playlist/sound-channel";
import { decorateSoundChannels } from "./sidebar-channel";

const soundRow = (playlistId: string, soundId: string) => `
  <li class="sound" data-playlist-id="${playlistId}" data-sound-id="${soundId}">
    <header>
      <i class="fa-thin fa-music" inert></i>
      <label class="ellipsis">${soundId} name</label>
      <div class="sound-controls flexrow">
        <button type="button" class="inline-control sound-control icon fa-solid fa-play" data-action="soundPlay"></button>
      </div>
    </header>
  </li>`;

const sidebar = () => `
  <ol class="directory-list">
    <li class="directory-item document playlist" data-entry-id="p1">
      <header class="playlist-header"><label class="playlist-name">Tavern</label></header>
      <ol class="playlist-sounds plain">${soundRow("p1", "s1")}${soundRow("p1", "s2")}${soundRow("p1", "s3")}</ol>
    </li>
  </ol>`;

const channels: Record<string, AudioChannel> = { s1: "music", s2: "environment", s3: "interface" };

let lookup: (playlistId: string, soundId: string) => AudioChannel | null;
const channelFor = (playlistId: string, soundId: string) => lookup(playlistId, soundId);
const localize = (key: string) => `L:${key}`;
const iconOf = (soundId: string) => root.querySelector<HTMLElement>(`li.sound[data-sound-id="${soundId}"] header > i.ac-sound-channel`);

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML = sidebar();
  lookup = (playlistId, soundId) => (playlistId === "p1" ? (channels[soundId] ?? null) : null);
});

describe("decorateSoundChannels", () => {
  it("adds a channel icon with a localized tooltip before the sound controls", () => {
    decorateSoundChannels(root, channelFor, localize);
    const icon = iconOf("s2")!;
    expect(icon).not.toBeNull();
    expect(icon.classList.contains("fa-tree")).toBe(true);
    expect(icon.dataset.channel).toBe("environment");
    expect(icon.dataset.tooltip).toBe("L:AUDIO_CODEX.Channel.Environment");
    expect(icon.getAttribute("aria-label")).toBe("L:AUDIO_CODEX.Channel.Environment");
    expect(icon.hasAttribute("inert")).toBe(false);
    expect(icon.nextElementSibling?.classList.contains("sound-controls")).toBe(true);
  });

  it("uses a distinct icon per channel", () => {
    decorateSoundChannels(root, channelFor, localize);
    expect(iconOf("s1")!.classList.contains("fa-music")).toBe(true);
    expect(iconOf("s3")!.classList.contains("fa-bell")).toBe(true);
  });

  it("leaves Foundry's own music icon in place", () => {
    decorateSoundChannels(root, channelFor, localize);
    const row = root.querySelector<HTMLElement>('li.sound[data-sound-id="s1"]')!;
    expect(row.querySelector("header > i.fa-thin.fa-music")).not.toBeNull();
  });

  it("adds one icon across repeated renders and reflects a changed channel", () => {
    decorateSoundChannels(root, channelFor, localize);
    lookup = () => "interface";
    decorateSoundChannels(root, channelFor, localize);
    expect(root.querySelectorAll('li.sound[data-sound-id="s1"] i.ac-sound-channel')).toHaveLength(1);
    expect(iconOf("s1")!.dataset.channel).toBe("interface");
  });

  it("skips sounds whose channel is unknown", () => {
    lookup = () => null;
    decorateSoundChannels(root, channelFor, localize);
    expect(root.querySelectorAll("i.ac-sound-channel")).toHaveLength(0);
  });

  it("tolerates a sound row with no header or controls", () => {
    root.innerHTML = '<ol><li class="sound" data-playlist-id="p1" data-sound-id="s1"><header></header></li></ol>';
    expect(() => decorateSoundChannels(root, channelFor, localize)).not.toThrow();
    expect(root.querySelectorAll("i.ac-sound-channel")).toHaveLength(0);
  });
});
