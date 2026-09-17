export const MODULE_ID = "audio-codex";
export const COVER_FLAG = "cover";
export const INDEX_VERSION = 2;
export const SUPPORTED_INDEX_VERSIONS: readonly number[] = [1, 2];
export const INDEX_FILE = "index.json";
export const NOSCAN_FILE = "noscan.txt";
export const AUDIO_EXTENSIONS: readonly string[] = ["aac", "flac", "m4a", "mid", "mp3", "ogg", "opus", "wav", "webm"];
export const IMAGE_EXTENSIONS: readonly string[] = ["gif", "jpeg", "jpg", "png", "webp"];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(fileExtension(name));
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExtension(name));
}

export function chooseCover(names: readonly string[]): string | null {
  const images = names.filter(isImageFile).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const named = (base: string) => images.find((name) => stripExtension(name).toLowerCase() === base);
  return named("cover") ?? named("folder") ?? images[0] ?? null;
}
