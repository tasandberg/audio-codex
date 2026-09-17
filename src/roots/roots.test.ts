import { beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeRoot, rootFingerprint, rootLocation, validateRoot } from "./roots";
import type { Root } from "../types";

const endpoint = { protocol: "https:", host: "s3.us-east-1.amazonaws.com" };
const virtualHost = new RegExp(`^${endpoint.protocol}//(?<bucket>.*).${endpoint.host}/(?<key>.*)`);
const pathStyle = new RegExp(`^${endpoint.protocol}//${endpoint.host}/(?<bucket>[^/]+)/(?<key>.*)`);

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

const root = (overrides: Partial<Root> = {}): Root => ({
  id: "r1",
  label: "Music",
  source: "s3",
  bucket: "example-bucket",
  prefix: "audio",
  ...overrides,
});

describe("roots", () => {
  it("normalizes the prefix and never stores a slash root", () => {
    const normalized = normalizeRoot({ source: "s3", bucket: " b ", prefix: "/audio/music/" }, () => "new-id");
    expect(normalized).toEqual({ id: "new-id", label: "music", source: "s3", bucket: "b", prefix: "audio/music" });
    expect(normalizeRoot({ source: "s3", bucket: "b", prefix: "/" }, () => "x").prefix).toBe("");
  });

  it("collapses a full S3 URL from the folder picker into a bare decoded key", () => {
    const normalized = normalizeRoot(
      { source: "s3", bucket: "example-bucket", prefix: "https://example-bucket.s3.us-east-1.amazonaws.com/audio" },
      () => "new-id",
    );
    expect(normalized.prefix).toBe("audio");
  });

  it("drops the bucket for non-S3 sources and defaults the label", () => {
    const normalized = normalizeRoot({ id: "keep", source: "data", bucket: "ignored", prefix: "" }, () => "unused");
    expect(normalized).toEqual({ id: "keep", label: "data", source: "data", bucket: null, prefix: "" });
  });

  it("requires a bucket for S3 roots", () => {
    expect(validateRoot(root({ bucket: null }))).toBe("AUDIO_CODEX.Roots.Error.Bucket");
    expect(validateRoot(root())).toBeNull();
    expect(validateRoot(root({ source: "" }))).toBe("AUDIO_CODEX.Roots.Error.Source");
  });

  it("builds the storage location for a root", () => {
    const location = rootLocation(root());
    expect(location.source).toBe("s3");
    expect(location.bucket).toBe("example-bucket");
    expect(location.key).toBe("audio");
  });

  it("fingerprints storage identity, ignoring labels and order", () => {
    const a = root();
    const b = root({ id: "r2", source: "data", bucket: null, prefix: "music" });
    expect(rootFingerprint([a, b])).toBe(rootFingerprint([b, { ...a, label: "Renamed" }]));
    expect(rootFingerprint([a])).not.toBe(rootFingerprint([{ ...a, prefix: "audio/other" }]));
    expect(rootFingerprint([])).toMatch(/^[0-9a-f]{8}$/);
  });
});
