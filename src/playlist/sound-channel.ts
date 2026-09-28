export type AudioChannel = "music" | "environment" | "interface";

export interface ChannelSource {
  channel?: string | null | undefined;
}

const CHANNEL_ICONS: Readonly<Record<AudioChannel, string>> = {
  music: "fa-music",
  environment: "fa-mountain",
  interface: "fa-bell",
};

const CHANNEL_LABELS: Readonly<Record<AudioChannel, string>> = {
  music: "AUDIO_CODEX.Channel.Music",
  environment: "AUDIO_CODEX.Channel.Environment",
  interface: "AUDIO_CODEX.Channel.Interface",
};

const isChannel = (value: unknown): value is AudioChannel => typeof value === "string" && Object.hasOwn(CHANNEL_ICONS, value);

export function effectiveChannel(sound: ChannelSource | null | undefined, playlist: ChannelSource | null | undefined): AudioChannel {
  const own = sound?.channel;
  if (isChannel(own)) return own;
  const inherited = playlist?.channel;
  if (isChannel(inherited)) return inherited;
  return "music";
}

export function channelIcon(channel: AudioChannel): string {
  return CHANNEL_ICONS[channel];
}

export function channelLabel(channel: AudioChannel): string {
  return CHANNEL_LABELS[channel];
}
