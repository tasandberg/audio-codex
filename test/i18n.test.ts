import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const lang = JSON.parse(readFileSync(new URL("lang/en.json", root), "utf8")) as Record<string, unknown>;

function files(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(new URL(`${entry.name}/`, directory)) : [new URL(entry.name, directory)],
  );
}

function lookup(key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], lang);
}

describe("localization", () => {
  const sources = [...files(new URL("src/", root)), ...files(new URL("templates/", root))].filter((url) => !url.pathname.endsWith(".test.ts"));
  const keys = new Set(sources.flatMap((url) => [...readFileSync(url, "utf8").matchAll(/AUDIO_CODEX(?:\.[A-Za-z]+)+/g)].map((match) => match[0])));

  it("uses at least one key", () => {
    expect(keys.size).toBeGreaterThan(0);
  });

  it.each([...keys])("%s exists in lang/en.json", (key) => {
    expect(typeof lookup(key)).toBe("string");
  });
});
