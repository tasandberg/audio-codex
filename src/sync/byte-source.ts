export interface ByteSource {
  size: number | null;
  read(start: number, end: number): Promise<Uint8Array>;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(start, end + 1).arrayBuffer()),
  };
}

export function totalFromContentRange(header: string | null): number | null {
  const total = header?.match(/\/(\d+)\s*$/)?.[1];
  return total ? Number(total) : null;
}

async function headSize(url: string, fetchFn: Fetch, signal?: AbortSignal): Promise<number | null> {
  const response = await fetchFn(url, { method: "HEAD", signal });
  const length = Number(response.headers.get("Content-Length"));
  return response.ok && length > 0 ? length : null;
}

export function httpSource(url: string, fetchFn: Fetch = (input, init) => fetch(input, init), signal?: AbortSignal): ByteSource {
  const source: ByteSource = {
    size: null,
    async read(start, end) {
      const response = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} reading ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.status !== 206) {
        source.size = bytes.length;
        return bytes.subarray(start, end + 1);
      }
      source.size ??= totalFromContentRange(response.headers.get("Content-Range")) ?? (await headSize(url, fetchFn, signal).catch(() => null));
      return bytes;
    },
  };
  return source;
}
