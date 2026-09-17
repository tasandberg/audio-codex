import type { IAudioMetadata } from "music-metadata";
import type { Tags } from "../types";
import type { ByteSource } from "./byte-source";
import type { CoverPicture } from "./covers";

export const HEAD_BYTES = 64 * 1024;
const PAD_BYTES = 16 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;

type Container = "id3" | "flac" | "ogg" | "mp4" | "ebml" | "other";

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const uint32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

export function sniff(bytes: Uint8Array): Container {
  if (ascii(bytes, 0, 3) === "ID3") return "id3";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (ascii(bytes, 4, 4) === "ftyp") return "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "ebml";
  return "other";
}

export function metadataEnd(bytes: Uint8Array): number {
  const container = sniff(bytes);
  if (container === "id3") {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  if (container === "flac") {
    let offset = 4;
    while (offset + 4 <= bytes.length) {
      const last = bytes[offset] & 0x80;
      offset += 4 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
      if (last) return offset;
    }
    return offset + 4;
  }
  return 0;
}

function boxEnd(bytes: Uint8Array, offset: number): number | null {
  if (offset + 8 > bytes.length) return null;
  let size = uint32(bytes, offset);
  if (size === 1 && offset + 16 <= bytes.length) size = uint32(bytes, offset + 8) * 2 ** 32 + uint32(bytes, offset + 12);
  return size < 8 ? null : offset + size;
}

export function moovOffset(bytes: Uint8Array): number | null {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = uint32(bytes, offset);
    if (size === 1 && offset + 16 <= bytes.length) size = uint32(bytes, offset + 8) * 2 ** 32 + uint32(bytes, offset + 12);
    if (ascii(bytes, offset + 4, 4) === "moov") return size >= 8 && offset + size <= bytes.length ? null : offset;
    if (size < 8) return null;
    offset += size;
  }
  return offset;
}

export function lastGranule(tail: Uint8Array): number | null {
  for (let offset = tail.length - 27; offset >= 0; offset--) {
    if (tail[offset] === 0x4f && tail[offset + 1] === 0x67 && tail[offset + 2] === 0x67 && tail[offset + 3] === 0x53) {
      const granule = new DataView(tail.buffer, tail.byteOffset + offset + 6, 8).getBigUint64(0, true);
      return granule > 0n ? Number(granule) : null;
    }
  }
  return null;
}

function toTags(metadata: IAudioMetadata, duration: number | undefined): Tags {
  const tags: Tags = {};
  const artist = metadata.common.artist ?? metadata.common.albumartist;
  if (artist) tags.artist = artist;
  if (metadata.common.album) tags.album = metadata.common.album;
  if (metadata.common.title) tags.title = metadata.common.title;
  if (metadata.common.track.no) tags.track = metadata.common.track.no;
  if (duration && Number.isFinite(duration)) tags.duration = Math.round(duration * 10) / 10;
  return tags;
}

async function withMoov(source: ByteSource, head: Uint8Array): Promise<Uint8Array> {
  const offset = moovOffset(head);
  const size = source.size;
  if (offset === null || size === null || offset >= size) return head;
  const end = offset + 8 <= head.length ? boxEnd(head, offset) : size;
  if (end === null || end > size || end - offset > MAX_BYTES) return head;
  const ftyp = head.subarray(0, uint32(head, 0));
  const moov = await source.read(offset, end - 1);
  const merged = new Uint8Array(ftyp.length + moov.length);
  merged.set(ftyp);
  merged.set(moov, ftyp.length);
  return merged;
}

const OPUS_RATE = 48000;

function opusPreSkip(head: Uint8Array): number {
  for (let offset = 0; offset + 12 <= head.length; offset++) {
    if (ascii(head, offset, 8) === "OpusHead") return head[offset + 10] | (head[offset + 11] << 8);
  }
  return 0;
}

async function oggDuration(source: ByteSource, head: Uint8Array, metadata: IAudioMetadata): Promise<number | undefined> {
  if (!source.size) return undefined;
  const tail = await source.read(Math.max(0, source.size - HEAD_BYTES), source.size - 1);
  const granule = lastGranule(tail);
  if (granule === null) return undefined;
  if (metadata.format.codec === "Opus") return (granule - opusPreSkip(head)) / OPUS_RATE;
  if (!metadata.format.sampleRate) return undefined;
  return granule / metadata.format.sampleRate;
}

async function readHead(source: ByteSource): Promise<{ bytes: Uint8Array; container: Container }> {
  let bytes = await source.read(0, HEAD_BYTES - 1);
  for (let attempt = 0; attempt < 4; attempt++) {
    const needed = metadataEnd(bytes) + PAD_BYTES;
    const size = source.size ?? Infinity;
    if (needed <= bytes.length || bytes.length >= size || needed > MAX_BYTES) break;
    bytes = await source.read(0, Math.min(size, needed) - 1);
  }
  const container = sniff(bytes);
  return { bytes: container === "mp4" ? await withMoov(source, bytes) : bytes, container };
}

async function parse(source: ByteSource, bytes: Uint8Array, container: Container, skipCovers: boolean): Promise<IAudioMetadata | null> {
  const { parseBuffer, parseWebStream } = await import("music-metadata");
  const options = { skipCovers, skipPostHeaders: true };
  try {
    return container === "mp4" || container === "ebml" || container === "ogg"
      ? await parseBuffer(bytes, {}, options)
      : await parseWebStream(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(), { size: source.size ?? undefined }, options);
  } catch {
    return null;
  }
}

export async function readTags(source: ByteSource): Promise<Tags> {
  const { bytes, container } = await readHead(source);
  const metadata = await parse(source, bytes, container, true);
  if (!metadata) return {};
  const duration = container === "ogg" ? await oggDuration(source, bytes, metadata) : metadata.format.duration;
  return toTags(metadata, duration);
}

export async function readCover(source: ByteSource): Promise<CoverPicture | null> {
  const { bytes, container } = await readHead(source);
  const metadata = await parse(source, bytes, container, false);
  const picture = metadata?.common.picture?.[0];
  return picture ? { format: picture.format, data: new Uint8Array(picture.data) } : null;
}
