import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type ByteSource, blobSource, httpSource, totalFromContentRange } from "./byte-source";
import { HEAD_BYTES, lastGranule, metadataEnd, moovOffset, readCover, readTags, sniff } from "./tag-reader";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url)));

function recording(bytes: Uint8Array): ByteSource & { reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = [];
  return {
    reads,
    size: null,
    async read(start, end) {
      reads.push([start, end]);
      this.size = bytes.length;
      return bytes.slice(start, Math.min(end, bytes.length - 1) + 1);
    },
  };
}

const expected = { artist: "Test Artist", album: "Test Album", title: "Test Title", track: 3 };

describe("readTags", () => {
  it.each([
    ["cbr-xing.mp3"],
    ["cbr-noxing.mp3"],
    ["moov-start.m4a"],
    ["tone.flac"],
    ["tone.wav"],
  ])("reads %s from the 64 KB head alone", async (name) => {
    const source = recording(fixture(name));
    const tags = await readTags(source);
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
    expect(source.reads).toEqual([[0, HEAD_BYTES - 1]]);
  });

  it("grows the head to cover an ID3v2 tag bloated by cover art", async () => {
    const bytes = fixture("big-cover.mp3");
    const source = recording(bytes);
    const tags = await readTags(source);
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
    expect(source.reads).toHaveLength(2);
    expect(source.reads[1][1]).toBeGreaterThan(HEAD_BYTES);
    expect(source.reads[1][1]).toBeLessThan(bytes.length);
  });

  it("fetches the tail when an M4A stores moov after mdat", async () => {
    const bytes = fixture("moov-end.m4a");
    const source = recording(bytes);
    const tags = await readTags(source);
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
    expect(source.reads[1][1]).toBe(bytes.length - 1);
  });

  it("grows to cover a faststart moov whose cover art exceeds the head", async () => {
    const bytes = fixture("moov-start-big-cover.m4a");
    const source = recording(bytes);
    const tags = await readTags(source);
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
    expect(source.reads).toHaveLength(2);
    expect(source.reads[1][1]).toBeGreaterThan(HEAD_BYTES);
    expect(source.reads[1][1]).toBeLessThan(bytes.length - 1);
  });

  it("grows the head to cover a FLAC PICTURE block bloated by cover art", async () => {
    const bytes = fixture("big-cover.flac");
    const source = recording(bytes);
    const tags = await readTags(source);
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
    expect(source.reads.length).toBeGreaterThan(1);
    expect(source.reads.length).toBeLessThanOrEqual(4);
    const last = source.reads[source.reads.length - 1];
    expect(last[1]).toBeGreaterThan(HEAD_BYTES);
    expect(last[1]).toBeLessThan(bytes.length);
  });

  it.each([["vorbis.ogg"], ["tone.opus"]])("takes %s duration from the last Ogg page", async (name) => {
    const tags = await readTags(recording(fixture(name)));
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
  });

  it("ignores OpusHead's input sample rate and always divides the granule by 48 kHz", async () => {
    const bytes = fixture("tone.opus").slice();
    const marker = "OpusHead";
    let offset = -1;
    for (let i = 0; i + marker.length <= bytes.length; i++) {
      if (String.fromCharCode(...bytes.subarray(i, i + marker.length)) === marker) {
        offset = i;
        break;
      }
    }
    expect(offset).toBeGreaterThan(-1);
    new DataView(bytes.buffer, bytes.byteOffset + offset + 12, 4).setUint32(0, 44100, true);
    const tags = await readTags(recording(bytes));
    expect(tags).toMatchObject(expected);
    expect(tags.duration).toBeCloseTo(12, 0);
  });

  it("reads webm title, artist and duration", async () => {
    const tags = await readTags(recording(fixture("tone.webm")));
    expect(tags).toMatchObject({ artist: "Test Artist", title: "Test Title", track: 3 });
    expect(tags.duration).toBeCloseTo(12, 0);
  });

  it("returns only duration for an untagged file", async () => {
    const tags = await readTags(recording(fixture("untagged.mp3")));
    expect(Object.keys(tags)).toEqual(["duration"]);
  });

  it("returns empty tags for a file it cannot parse", async () => {
    await expect(readTags(recording(fixture("garbage.mp3")))).resolves.toEqual({});
  });

  it("propagates read failures so the file stays pending", async () => {
    const failing: ByteSource = { size: null, read: () => Promise.reject(new Error("HTTP 503")) };
    await expect(readTags(failing)).rejects.toThrow("HTTP 503");
  });

  it("reads tags from a local Blob for uploads", async () => {
    const tags = await readTags(blobSource(new Blob([fixture("cbr-xing.mp3")])));
    expect(tags).toMatchObject(expected);
  });
});

describe("container helpers", () => {
  it("sniffs containers from magic bytes", () => {
    expect(sniff(fixture("cbr-xing.mp3"))).toBe("id3");
    expect(sniff(fixture("tone.flac"))).toBe("flac");
    expect(sniff(fixture("vorbis.ogg"))).toBe("ogg");
    expect(sniff(fixture("moov-end.m4a"))).toBe("mp4");
    expect(sniff(fixture("tone.webm"))).toBe("ebml");
    expect(sniff(fixture("tone.wav"))).toBe("other");
  });

  it("computes the ID3v2 end from its syncsafe size", () => {
    expect(metadataEnd(fixture("big-cover.mp3"))).toBeGreaterThan(HEAD_BYTES);
    expect(metadataEnd(fixture("tone.wav"))).toBe(0);
  });

  it("finds moov only when it lies past the head", () => {
    expect(moovOffset(fixture("moov-start.m4a"))).toBeNull();
    const head = fixture("moov-end.m4a").subarray(0, HEAD_BYTES);
    expect(moovOffset(head)).toBeGreaterThan(HEAD_BYTES);
  });

  it("finds moov when its header is in the head but its body overruns it", () => {
    const head = fixture("moov-start-big-cover.m4a").subarray(0, HEAD_BYTES);
    const offset = moovOffset(head);
    expect(offset).not.toBeNull();
    expect(offset).toBeLessThan(HEAD_BYTES);
  });

  it("returns null when no Ogg page is present", () => {
    expect(lastGranule(new Uint8Array(100))).toBeNull();
  });
});

describe("readCover", () => {
  const blob = (name: string) => blobSource(new Blob([fixture(name) as Uint8Array<ArrayBuffer>]));

  it("returns the first embedded picture with its MIME type", async () => {
    const mp3 = await readCover(blob("big-cover.mp3"));
    expect(mp3?.format).toBe("image/png");
    expect(mp3?.data.length).toBeGreaterThan(200_000);
    expect(await readCover(blob("moov-start-big-cover.m4a"))).toMatchObject({ format: "image/png" });
    const flac = await readCover(blob("big-cover.flac"));
    expect(flac?.format).toBe("image/png");
    expect(flac?.data.length).toBeGreaterThan(200_000);
  });

  it("returns null for files with no art and for unreadable bytes", async () => {
    await expect(readCover(blob("cbr-xing.mp3"))).resolves.toBeNull();
    await expect(readCover(blob("tone.flac"))).resolves.toBeNull();
    await expect(readCover(blob("garbage.mp3"))).resolves.toBeNull();
  });

  it("grows the same head the tag reader does, so one directory costs one ranged read", async () => {
    const source = recording(fixture("big-cover.mp3"));
    await expect(readCover(source)).resolves.toMatchObject({ format: "image/png" });
    expect(source.reads[0]).toEqual([0, HEAD_BYTES - 1]);
    expect(source.reads.length).toBeLessThanOrEqual(4);
  });
});

describe("httpSource", () => {
  const bytes = fixture("cbr-xing.mp3");

  const server = (exposeContentRange: boolean, honourRange = true) =>
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Length": String(bytes.length) } });
      const range = new Headers(init?.headers).get("Range");
      const [start, end] = range!.replace("bytes=", "").split("-").map(Number);
      if (!honourRange) return new Response(bytes, { status: 200 });
      const body = bytes.slice(start, end + 1);
      const headers: Record<string, string> = {};
      if (exposeContentRange) headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
      return new Response(body, { status: 206, headers });
    });

  it("takes the size from Content-Range when the header is exposed", async () => {
    const fetchFn = server(true);
    const source = httpSource("https://x/a.mp3", fetchFn);
    await source.read(0, 99);
    expect(source.size).toBe(bytes.length);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to a HEAD request when CORS hides Content-Range", async () => {
    const fetchFn = server(false);
    const source = httpSource("https://x/a.mp3", fetchFn);
    await source.read(0, 99);
    expect(source.size).toBe(bytes.length);
    expect(fetchFn).toHaveBeenLastCalledWith("https://x/a.mp3", expect.objectContaining({ method: "HEAD" }));
  });

  it("slices a full 200 response from a server that ignores Range", async () => {
    const source = httpSource("https://x/a.mp3", server(true, false));
    const head = await source.read(0, 9);
    expect(head).toHaveLength(10);
    expect(source.size).toBe(bytes.length);
  });

  it("throws on HTTP errors", async () => {
    const source = httpSource("https://x/a.mp3", async () => new Response(null, { status: 403 }));
    await expect(source.read(0, 9)).rejects.toThrow("HTTP 403");
  });

  it("parses Content-Range totals", () => {
    expect(totalFromContentRange("bytes 0-65535/835304")).toBe(835304);
    expect(totalFromContentRange("bytes 0-1/*")).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });
});
