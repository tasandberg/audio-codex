export type CoverLookup = (playlistId: string, soundId: string | null) => string | null;

const SOUND_ROW = "li.sound[data-sound-id]";
const PLAYLIST_ROW = "li.playlist[data-entry-id]";
const PLAYLIST_HEADER = ":scope > header.playlist-header";
const PLAYLIST_NAME = ":scope > .playlist-name, :scope > .entry-name";
const HIDDEN_CLASS = "ac-sidebar-hidden";
const ROW_ART = "ac-sidebar-art";
const PLAYLIST_ART = "ac-sidebar-playlist-art";
const NOW_ART = "ac-sidebar-now-art";

function artImage(owner: Document, cover: string, className: string): HTMLImageElement {
  const image = owner.createElement("img");
  image.className = className;
  image.src = cover;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  return image;
}

function decorateRow(row: HTMLElement, cover: string): void {
  const header = row.querySelector<HTMLElement>(":scope > header");
  if (!header || header.querySelector(`img.${ROW_ART}`)) return;
  const icon = header.querySelector<HTMLElement>(":scope > i");
  if (!icon) return;
  const image = artImage(row.ownerDocument, cover, ROW_ART);
  icon.classList.add(HIDDEN_CLASS);
  icon.before(image);
}

function decorateNowPlaying(row: HTMLElement, cover: string): void {
  if (row.querySelector(`:scope > img.${NOW_ART}`)) return;
  row.prepend(artImage(row.ownerDocument, cover, NOW_ART));
}

function decoratePlaylistRow(row: HTMLElement, cover: string): void {
  const header = row.querySelector<HTMLElement>(PLAYLIST_HEADER);
  if (!header || header.querySelector(`img.${PLAYLIST_ART}`)) return;
  const name = header.querySelector<HTMLElement>(PLAYLIST_NAME);
  if (!name) return;
  const image = artImage(row.ownerDocument, cover, `${ROW_ART} ${PLAYLIST_ART}`);
  name.before(image);
}

export function decoratePlaylistDirectory(root: ParentNode, coverFor: CoverLookup): void {
  for (const row of root.querySelectorAll<HTMLElement>(PLAYLIST_ROW)) {
    const cover = coverFor(row.dataset.entryId ?? "", null);
    if (cover) decoratePlaylistRow(row, cover);
  }
  for (const row of root.querySelectorAll<HTMLElement>(SOUND_ROW)) {
    const cover = coverFor(row.dataset.playlistId ?? "", row.dataset.soundId ?? null);
    if (!cover) continue;
    decorateRow(row, cover);
    if (row.closest(".currently-playing")) decorateNowPlaying(row, cover);
  }
}
