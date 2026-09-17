import type { EditableField, OverrideFields, Overrides } from "../types";

export interface OverrideEdit {
  rootId: string;
  key: string;
  fields: Partial<Record<EditableField, string | number | null>>;
}

export const EDITABLE_FIELDS: readonly EditableField[] = ["artist", "album", "title", "track"];

export function getOverride(overrides: Overrides, rootId: string, key: string): OverrideFields | undefined {
  return overrides[rootId]?.[key];
}

function cleanValue(field: EditableField, value: string | number | null | undefined): string | number | undefined {
  if (value === null || value === undefined) return undefined;
  if (field === "track") {
    const track = Number.parseInt(String(value), 10);
    return Number.isFinite(track) && track > 0 ? track : undefined;
  }
  const text = String(value).trim();
  return text || undefined;
}

export function withOverrides(overrides: Overrides, edits: OverrideEdit[]): Overrides {
  const next: Overrides = structuredClone(overrides);
  for (const { rootId, key, fields } of edits) {
    const entry: Record<string, string | number> = { ...next[rootId]?.[key] };
    for (const field of EDITABLE_FIELDS) {
      if (!(field in fields)) continue;
      const value = cleanValue(field, fields[field]);
      if (value === undefined) delete entry[field];
      else entry[field] = value;
    }
    next[rootId] ??= {};
    if (Object.keys(entry).length) next[rootId][key] = entry as OverrideFields;
    else delete next[rootId][key];
    if (!Object.keys(next[rootId]).length) delete next[rootId];
  }
  return next;
}

export function withoutOverride(overrides: Overrides, rootId: string, key: string): Overrides {
  const next: Overrides = structuredClone(overrides);
  if (next[rootId]) {
    delete next[rootId][key];
    if (!Object.keys(next[rootId]).length) delete next[rootId];
  }
  return next;
}
