import { type AudioChannel, channelIcon, channelLabel } from "../playlist/sound-channel";

export type ChannelLookup = (playlistId: string, soundId: string) => AudioChannel | null;

const SOUND_ROW = "li.sound[data-sound-id]";
const CHANNEL_ICON = "ac-sound-channel";

function channelElement(owner: Document, channel: AudioChannel, localize: (key: string) => string): HTMLElement {
  const label = localize(channelLabel(channel));
  const icon = owner.createElement("i");
  icon.className = `fa-solid fa-fw ${channelIcon(channel)} ${CHANNEL_ICON}`;
  icon.dataset.channel = channel;
  icon.dataset.tooltip = label;
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", label);
  return icon;
}

export function decorateSoundChannels(root: ParentNode, channelFor: ChannelLookup, localize: (key: string) => string): void {
  for (const row of root.querySelectorAll<HTMLElement>(SOUND_ROW)) {
    const controls = row.querySelector<HTMLElement>(":scope > header > .sound-controls");
    if (!controls) continue;
    controls.parentElement?.querySelector(`:scope > i.${CHANNEL_ICON}`)?.remove();
    const channel = channelFor(row.dataset.playlistId ?? "", row.dataset.soundId ?? "");
    if (channel) controls.before(channelElement(row.ownerDocument, channel, localize));
  }
}
