import { beforeAll, describe, expect, it, vi } from "vitest";
import { FileLocation, encodeKey, joinKey } from "./file-location";

const endpoint = { protocol: "https:", host: "s3.us-east-1.amazonaws.com" };
const virtualHost = new RegExp(`^${endpoint.protocol}//(?<bucket>.*).${endpoint.host}/(?<key>.*)`);
const pathStyle = new RegExp(`^${endpoint.protocol}//${endpoint.host}/(?<bucket>[^/]+)/(?<key>.*)`);
const BUCKET = "example-bucket";
const url = (key: string) => `https://${BUCKET}.${endpoint.host}/${key}`;

beforeAll(() => {
  vi.stubGlobal("game", { data: { files: { s3: { endpoint } } } });
  vi.stubGlobal("foundry", {
    applications: {
      apps: {
        FilePicker: {
          implementation: {
            matchS3URL: (value: string) => virtualHost.exec(value) ?? pathStyle.exec(value) ?? null,
          },
        },
      },
    },
  });
});

describe("FileLocation", () => {
  it("parses a virtual-host S3 URL", () => {
    const location = FileLocation.parse(url("audio/dungeon_synth/track.mp3"));
    expect(location.source).toBe("s3");
    expect(location.bucket).toBe(BUCKET);
    expect(location.key).toBe("audio/dungeon_synth/track.mp3");
    expect(location.browseOptions).toEqual({ bucket: BUCKET });
    expect(location.name).toBe("track.mp3");
  });

  it("parses a path-style S3 URL", () => {
    const location = FileLocation.parse(`https://${endpoint.host}/${BUCKET}/audio/track.mp3`);
    expect(location.source).toBe("s3");
    expect(location.bucket).toBe(BUCKET);
    expect(location.key).toBe("audio/track.mp3");
  });

  it("parses a plain data path", () => {
    const location = FileLocation.parse("modules/playlistenchantment/storage/track.mp3");
    expect(location.source).toBe("data");
    expect(location.bucket).toBeNull();
    expect(location.browseOptions).toEqual({});
    expect(location.key).toBe("modules/playlistenchantment/storage/track.mp3");
  });

  it("parse returns an existing FileLocation unchanged", () => {
    const location = FileLocation.parse(url("audio"));
    expect(FileLocation.parse(location)).toBe(location);
  });

  it("the S3 root normalizes to the empty string, never a slash", () => {
    const location = FileLocation.parse(url(""));
    expect(location.source).toBe("s3");
    expect(location.key).toBe("");
    expect(location.target).toBe("");
    expect(new FileLocation("s3", "/", BUCKET).key).toBe("");
  });

  it("parent drops the last segment", () => {
    const parent = new FileLocation("s3", "audio/dungeon_synth", BUCKET).parent();
    expect(parent.key).toBe("audio");
    expect(parent.source).toBe("s3");
    expect(parent.bucket).toBe(BUCKET);
  });

  it("parent clamps at the root and never returns null", () => {
    const root = new FileLocation("s3", "audio", BUCKET).parent();
    expect(root.key).toBe("");
    const above = root.parent();
    expect(above).toBeInstanceOf(FileLocation);
    expect(above.key).toBe("");
  });

  it("contains is true for a descendant and for itself", () => {
    const root = new FileLocation("s3", "audio", BUCKET);
    expect(root.contains(url("audio/dungeon_synth/track.mp3"))).toBe(true);
    expect(root.contains(url("audio"))).toBe(true);
    expect(root.contains(url("audiobooks/track.mp3"))).toBe(false);
  });

  it("the empty root contains everything in its own bucket", () => {
    expect(new FileLocation("s3", "", BUCKET).contains(url("audio/track.mp3"))).toBe(true);
  });

  it("contains is false across buckets and across sources", () => {
    const root = new FileLocation("s3", "audio", BUCKET);
    expect(root.contains(new FileLocation("s3", "audio/track.mp3", "other-bucket"))).toBe(false);
    expect(root.contains(new FileLocation("data", "audio/track.mp3"))).toBe(false);
    expect(new FileLocation("data", "audio").contains(url("audio/track.mp3"))).toBe(false);
  });

  it("join appends one segment and handles awkward names", () => {
    const root = new FileLocation("s3", "audio", BUCKET);
    expect(root.join("dungeon synth #2").key).toBe("audio/dungeon synth #2");
    expect(new FileLocation("s3", "", BUCKET).join("audio").key).toBe("audio");
    expect(root.join("/nested/").key).toBe("audio/nested");
    expect(root.join("")).toBe(root);
  });

  it("toString encodes the key and round-trips back through parse", () => {
    const location = new FileLocation("s3", "audio/dungeon synth #2", BUCKET);
    expect(location.toString()).toBe(url("audio/dungeon%20synth%20%232"));
    const reparsed = FileLocation.parse(location.toString());
    expect(reparsed.equals(location)).toBe(true);
    expect(reparsed.key).toBe(location.key);
    expect(reparsed.bucket).toBe(BUCKET);
  });

  it("toString on the S3 root ends at the bucket", () => {
    expect(new FileLocation("s3", "", BUCKET).toString()).toBe(url(""));
    expect(FileLocation.parse(url("")).equals(new FileLocation("s3", "", BUCKET))).toBe(true);
  });

  it("toString on a data path is the encoded relative path", () => {
    expect(new FileLocation("data", "audio/My Track's.mp3").toString()).toBe("audio/My%20Track%27s.mp3");
  });

  it("url prefers a learned base, which covers path-style and custom endpoints", () => {
    const location = new FileLocation("s3", "audio/a b.mp3", BUCKET);
    expect(location.url("http://minio.local:9000/example-bucket/")).toBe("http://minio.local:9000/example-bucket/audio/a%20b.mp3");
    expect(location.url(null)).toBe(url("audio/a%20b.mp3"));
    expect(new FileLocation("data", "audio/a b.mp3").url("")).toBe("audio/a%20b.mp3");
  });

  it("target is the encoded key Foundry's file API decodes", () => {
    expect(new FileLocation("data", "audio/100%/x y").target).toBe("audio/100%25/x%20y");
  });

  it("equals compares source, bucket and key", () => {
    const location = new FileLocation("s3", "audio", BUCKET);
    expect(location.equals(new FileLocation("s3", "audio", BUCKET))).toBe(true);
    expect(location.equals(new FileLocation("s3", "audio", "other"))).toBe(false);
    expect(location.equals(new FileLocation("data", "audio"))).toBe(false);
    expect(location.equals(new FileLocation("s3", "audio/x", BUCKET))).toBe(false);
    expect(location.equals(null)).toBe(false);
  });

  it("compareKey preserves case for S3 and lowercases for data", () => {
    expect(new FileLocation("s3", "Audio/Track.MP3", BUCKET).compareKey()).toBe(url("Audio/Track.MP3"));
    expect(new FileLocation("data", "Audio/Track.MP3").compareKey()).toBe("audio/track.mp3");
  });

  it("compareKey decodes percent escapes", () => {
    expect(FileLocation.parse("audio/My%20Track.mp3").compareKey()).toBe("audio/my track.mp3");
    expect(FileLocation.parse("audio/100%.mp3").compareKey()).toBe("audio/100%.mp3");
  });

  it("name decodes the last segment", () => {
    expect(FileLocation.parse(url("audio/My%20Track.mp3")).name).toBe("My Track.mp3");
    expect(new FileLocation("s3", "", BUCKET).name).toBe("");
  });

  it("a helper-shadowed data-path never resolves inside the upload root", () => {
    const root = new FileLocation("s3", "dev-audio", BUCKET);
    const corrupted = FileLocation.parse("/systems/ose/dist[object Object]");
    expect(corrupted.source).toBe("data");
    expect(corrupted.key).toBe("systems/ose/dist[object Object]");
    expect(root.contains(corrupted)).toBe(false);
    expect(root.contains("")).toBe(false);
  });

  it("contains accepts the browse dirs the upload dialog renders as folders", () => {
    const root = new FileLocation("s3", "dev-audio", BUCKET);
    const child = new FileLocation(root.source, "dev-audio/Fogweaver", root.bucket);
    expect(String(child)).toBe(url("dev-audio/Fogweaver"));
    expect(root.contains(String(child))).toBe(true);
    expect(root.contains(FileLocation.parse(String(child)))).toBe(true);
  });

  it("relative returns the segments beneath this location, or null outside it", () => {
    const root = new FileLocation("s3", "audio", BUCKET);
    expect(root.relative(new FileLocation("s3", "audio/a/b.mp3", BUCKET))).toEqual(["a", "b.mp3"]);
    expect(root.relative(root)).toEqual([]);
    expect(new FileLocation("s3", "", BUCKET).relative(new FileLocation("s3", "x/y", BUCKET))).toEqual(["x", "y"]);
    expect(root.relative(new FileLocation("data", "audio/a"))).toBeNull();
  });
});

describe("key helpers", () => {
  it("joinKey drops empty parts and stray slashes", () => {
    expect(joinKey("", "audio/", "/a", "b.mp3")).toBe("audio/a/b.mp3");
    expect(joinKey("", "")).toBe("");
  });

  it("encodeKey encodes each segment like Foundry's encodeURL", () => {
    expect(encodeKey("a b/c#d/e'f")).toBe("a%20b/c%23d/e%27f");
  });
});
