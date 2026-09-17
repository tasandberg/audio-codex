export function localize(key: string, data?: Record<string, string | number>): string {
  if (!data) return game.i18n.localize(key);
  return game.i18n.format(key, Object.fromEntries(Object.entries(data).map(([name, value]) => [name, String(value)])));
}
