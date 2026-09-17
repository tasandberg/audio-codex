declare const ForgeVTT: { usingTheForge?: boolean } | undefined;

interface S3Endpoint {
  protocol: string;
  host: string;
}

interface FoundryFilesGlobal {
  game?: { data?: { files?: { s3?: { endpoint?: S3Endpoint } | null } } };
}

const normalize = (value: unknown): string =>
  String(value ?? "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

export function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/'/g, "%27"))
    .join("/");
}

export function joinKey(...parts: string[]): string {
  return parts.map(normalize).filter(Boolean).join("/");
}

export class FileLocation {
  static parse(path: FileLocation | string | null | undefined): FileLocation {
    if (path instanceof FileLocation) return path;
    const raw = String(path ?? "");
    let match: RegExpMatchArray | null = null;
    try {
      match = foundry.applications.apps.FilePicker.implementation.matchS3URL(raw);
    } catch {
      match = null;
    }
    if (match?.groups) return new FileLocation("s3", decode(match.groups.key), match.groups.bucket);
    const forge = typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge;
    return new FileLocation(forge ? "forgevtt" : "data", decode(raw));
  }

  static #s3Url(bucket: string | null, key: string): string | null {
    const endpoint = (globalThis as FoundryFilesGlobal).game?.data?.files?.s3?.endpoint;
    if (!endpoint || !bucket) return null;
    return `${endpoint.protocol}//${bucket}.${endpoint.host}/${encodeKey(key)}`;
  }

  readonly #source: string;
  readonly #key: string;
  readonly #bucket: string | null;

  constructor(source: string, key: string, bucket: string | null = null) {
    this.#source = source;
    this.#key = normalize(key);
    this.#bucket = bucket ?? null;
    Object.freeze(this);
  }

  get source(): string {
    return this.#source;
  }

  get key(): string {
    return this.#key;
  }

  get bucket(): string | null {
    return this.#bucket;
  }

  get target(): string {
    return encodeKey(this.#key);
  }

  get #isS3(): boolean {
    return this.#source === "s3";
  }

  get browseOptions(): { bucket?: string } {
    return this.#isS3 && this.#bucket ? { bucket: this.#bucket } : {};
  }

  get name(): string {
    const segments = this.#key.split("/");
    return segments[segments.length - 1] ?? "";
  }

  toString(): string {
    if (!this.#isS3) return encodeKey(this.#key);
    return FileLocation.#s3Url(this.#bucket, this.#key) ?? encodeKey(this.#key);
  }

  url(base: string | null = null): string {
    return base === null ? this.toString() : `${base}${encodeKey(this.#key)}`;
  }

  join(name: string): FileLocation {
    const segment = normalize(name);
    if (!segment) return this;
    return new FileLocation(this.#source, joinKey(this.#key, segment), this.#bucket);
  }

  parent(): FileLocation {
    if (!this.#key) return new FileLocation(this.#source, "", this.#bucket);
    const segments = this.#key.split("/");
    segments.pop();
    return new FileLocation(this.#source, segments.join("/"), this.#bucket);
  }

  contains(other: FileLocation | string): boolean {
    const location = FileLocation.parse(other);
    if (location.source !== this.#source) return false;
    if (location.bucket !== this.#bucket) return false;
    if (!this.#key) return true;
    if (location.key === this.#key) return true;
    return location.key.startsWith(`${this.#key}/`);
  }

  relative(other: FileLocation | string): string[] | null {
    const location = FileLocation.parse(other);
    if (!this.contains(location)) return null;
    const rest = this.#key ? location.key.slice(this.#key.length) : location.key;
    return rest.split("/").filter(Boolean);
  }

  equals(other: FileLocation | string | null | undefined): boolean {
    if (!other) return false;
    const location = FileLocation.parse(other);
    return location.source === this.#source && location.bucket === this.#bucket && location.key === this.#key;
  }

  compareKey(): string {
    const key = decode(this.toString()).trim();
    return this.#isS3 ? key : key.toLowerCase();
  }
}
