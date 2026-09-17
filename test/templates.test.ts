import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HELPERS = new Set(["if", "unless", "each", "else", "localize"]);
const directory = new URL("../templates/", import.meta.url);

function unqualified(source: string): string[] {
  const found: string[] = [];
  for (const [, body] of source.matchAll(/\{\{\{?([^}]*)\}?\}\}/g)) {
    const content = body.replace(/^~|~$/g, "").trim();
    if (!content || content.startsWith("!")) continue;
    const tokens = content
      .replace(/^[#/^]/, "")
      .replace(/"[^"]*"|'[^']*'/g, " ")
      .split(/\s+/)
      .map((token) => token.replace(/^[\w-]+=/, ""))
      .filter(Boolean);
    tokens.forEach((token, position) => {
      if (/^(this\b|\.\.\/|@)/.test(token) || /^-?\d/.test(token) || token === "true" || token === "false") return;
      if (position === 0 && HELPERS.has(token)) return;
      found.push(token);
    });
  }
  return found;
}

describe("template hygiene", () => {
  it("flags bare lookups that a registered helper would shadow", () => {
    expect(unqualified('<a data-path="{{path}}">')).toEqual(["path"]);
    expect(unqualified("{{#each rows}}{{/each}}")).toEqual(["rows"]);
    expect(unqualified("{{localize label}}")).toEqual(["label"]);
    expect(unqualified('<a data-path="{{this.path}}">{{localize "KEY"}}{{@index}}{{#if this.x}}{{else}}{{/if}}')).toEqual([]);
  });

  const templates = readdirSync(directory).filter((name) => name.endsWith(".hbs"));

  it("finds the module templates", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)("%s qualifies every context lookup", (name) => {
    expect(unqualified(readFileSync(new URL(name, directory), "utf8"))).toEqual([]);
  });
});
