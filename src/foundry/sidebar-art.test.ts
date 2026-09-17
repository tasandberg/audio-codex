import { beforeEach, describe, expect, it } from "vitest";
import { decoratePlaylistDirectory } from "./sidebar-art";

const soundRow = (playlistId: string, soundId: string, playback = false) => `
  <li class="sound" data-playlist-id="${playlistId}" data-sound-uuid="Playlist.${playlistId}.PlaylistSound.${soundId}" data-sound-id="${soundId}">
    <header>
      <i class="fa-thin fa-music" inert></i>
      <label class="ellipsis">${soundId} name</label>
      <div class="sound-controls flexrow">
        <button type="button" class="inline-control sound-control icon fa-solid fa-play" data-action="soundPlay"></button>
      </div>
    </header>
    ${playback ? '<div class="sound-playback flexrow"><div class="sound-timer"><span class="current">0:00</span></div></div>' : ""}
  </li>`;

const playlistRow = (playlistId: string, name: string, sounds: string) => `
  <li class="directory-item document playlist" data-entry-id="${playlistId}">
    <header class="playlist-header" data-action="activateEntry">
      <i class="expand fa-solid fa-angle-up" inert></i>
      <label class="entry-name playlist-name ellipsis">${name}</label>
      <div class="sound-controls playlist-controls flexrow"></div>
    </header>
    <div class="expandable">
      <div class="wrapper">
        <ol class="playlist-sounds plain">${sounds}</ol>
      </div>
    </div>
  </li>`;

const sidebar = (options: { playing?: boolean } = {}) => `
  <section class="playlists-sidebar">
    <ol class="directory-list">
      ${playlistRow("p1", "Fogweaver", `${soundRow("p1", "s1")}${soundRow("p1", "s2")}`)}
      ${playlistRow("p2", "Imageeze", soundRow("p2", "s3"))}
    </ol>
    ${
      options.playing
        ? `<div class="currently-playing global-control">
            <header class="playlist-header"><strong>Currently Playing</strong></header>
            <ol class="playlist-sounds plain">${soundRow("p1", "s1", true)}</ol>
          </div>`
        : ""
    }
  </section>`;

const covers: Record<string, string> = { s1: "https://cdn/one.jpg" };

const coverFor = (playlistId: string, soundId: string | null): string | null => {
  if (playlistId !== "p1") return null;
  if (!soundId) return "https://cdn/album.jpg";
  return covers[soundId] ?? null;
};

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
});

describe("decoratePlaylistDirectory", () => {
  it("replaces the music icon of a sound row that has a cover", () => {
    root.innerHTML = sidebar();
    decoratePlaylistDirectory(root, coverFor);
    const row = root.querySelector<HTMLElement>('li.sound[data-sound-id="s1"]')!;
    const image = row.querySelector<HTMLImageElement>("header img.ac-sidebar-art")!;
    expect(image).not.toBeNull();
    expect(image.getAttribute("src")).toBe("https://cdn/one.jpg");
    expect(image.getAttribute("alt")).toBe("");
    expect(image.draggable).toBe(false);
    expect(image.loading).toBe("lazy");
    const icon = row.querySelector<HTMLElement>("header > i")!;
    expect(icon).not.toBeNull();
    expect(icon.classList.contains("ac-sidebar-hidden")).toBe(true);
    expect(image.nextElementSibling).toBe(icon);
  });

  it("leaves a sound row without a cover untouched", () => {
    root.innerHTML = sidebar();
    const row = root.querySelector<HTMLElement>('li.sound[data-sound-id="s2"]')!;
    const before = row.innerHTML;
    decoratePlaylistDirectory(root, coverFor);
    expect(row.querySelector("img")).toBeNull();
    expect(row.innerHTML).toBe(before);
  });

  it("inserts a large cover above the name and controls of a currently playing sound", () => {
    root.innerHTML = sidebar({ playing: true });
    decoratePlaylistDirectory(root, coverFor);
    const row = root.querySelector<HTMLElement>('.currently-playing li.sound[data-sound-id="s1"]')!;
    const large = row.querySelectorAll<HTMLImageElement>(":scope > img.ac-sidebar-now-art");
    expect(large).toHaveLength(1);
    expect(large[0]!.getAttribute("src")).toBe("https://cdn/one.jpg");
    expect(row.firstElementChild).toBe(large[0]);
    expect(large[0]!.nextElementSibling?.tagName.toLowerCase()).toBe("header");
  });

  it("does not add a large cover to rows outside Currently Playing", () => {
    root.innerHTML = sidebar({ playing: true });
    decoratePlaylistDirectory(root, coverFor);
    expect(root.querySelectorAll(".directory-list img.ac-sidebar-now-art")).toHaveLength(0);
  });

  it("inserts one cover before the name of a playlist header that has a cover", () => {
    root.innerHTML = sidebar();
    decoratePlaylistDirectory(root, coverFor);
    const header = root.querySelector<HTMLElement>('li.playlist[data-entry-id="p1"] > header.playlist-header')!;
    const images = header.querySelectorAll<HTMLImageElement>("img.ac-sidebar-playlist-art");
    expect(images).toHaveLength(1);
    expect(images[0]!.getAttribute("src")).toBe("https://cdn/album.jpg");
    expect(images[0]!.draggable).toBe(false);
    expect(images[0]!.classList.contains("ac-sidebar-art")).toBe(true);
    expect(images[0]!.nextElementSibling).toBe(header.querySelector(".playlist-name"));
  });

  it("keeps the collapse chevron on a decorated playlist header", () => {
    root.innerHTML = sidebar();
    decoratePlaylistDirectory(root, coverFor);
    const header = root.querySelector<HTMLElement>('li.playlist[data-entry-id="p1"] > header.playlist-header')!;
    const chevron = header.querySelector<HTMLElement>("i.expand")!;
    expect(chevron).not.toBeNull();
    expect(chevron.classList.contains("ac-sidebar-hidden")).toBe(false);
    expect(header.firstElementChild).toBe(chevron);
  });

  it("leaves a playlist header without a cover untouched", () => {
    root.innerHTML = sidebar();
    const header = root.querySelector<HTMLElement>('li.playlist[data-entry-id="p2"] > header.playlist-header')!;
    const before = header.innerHTML;
    decoratePlaylistDirectory(root, coverFor);
    expect(header.querySelector("img")).toBeNull();
    expect(header.innerHTML).toBe(before);
  });

  it("does not decorate the Currently Playing header", () => {
    root.innerHTML = sidebar({ playing: true });
    decoratePlaylistDirectory(root, coverFor);
    expect(root.querySelectorAll(".currently-playing img.ac-sidebar-playlist-art")).toHaveLength(0);
  });

  it("adds only one playlist cover across repeated renders", () => {
    root.innerHTML = sidebar();
    decoratePlaylistDirectory(root, coverFor);
    decoratePlaylistDirectory(root, coverFor);
    expect(root.querySelectorAll('li.playlist[data-entry-id="p1"] img.ac-sidebar-playlist-art')).toHaveLength(1);
  });

  it("tolerates a playlist row with no header or name", () => {
    root.innerHTML = '<ol class="directory-list"><li class="playlist" data-entry-id="p1"></li></ol>';
    expect(() => decoratePlaylistDirectory(root, coverFor)).not.toThrow();
    expect(root.querySelectorAll("img.ac-sidebar-playlist-art")).toHaveLength(0);
  });

  it("is idempotent across repeated renders", () => {
    root.innerHTML = sidebar({ playing: true });
    decoratePlaylistDirectory(root, coverFor);
    const once = root.innerHTML;
    decoratePlaylistDirectory(root, coverFor);
    decoratePlaylistDirectory(root, coverFor);
    expect(root.innerHTML).toBe(once);
  });

  it("does nothing when the expected selectors are missing", () => {
    root.innerHTML = '<section class="playlists-sidebar"><ol class="directory-list"></ol></section>';
    const before = root.innerHTML;
    expect(() => decoratePlaylistDirectory(root, coverFor)).not.toThrow();
    expect(root.innerHTML).toBe(before);
  });

  it("tolerates a sound row with no header or icon", () => {
    root.innerHTML = '<ol class="playlist-sounds"><li class="sound" data-playlist-id="p1" data-sound-id="s1"></li></ol>';
    expect(() => decoratePlaylistDirectory(root, coverFor)).not.toThrow();
    expect(root.querySelectorAll("img.ac-sidebar-art")).toHaveLength(0);
  });
});
