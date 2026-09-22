export const ROLE = { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3, GAMEMASTER: 4 } as const;

export const DEFAULT_MINIMUM_ROLE: number = ROLE.GAMEMASTER;

export const MINIMUM_ROLE_CHOICES: Record<number, string> = {
  [ROLE.PLAYER]: "AUDIO_CODEX.Permission.Role.Player",
  [ROLE.TRUSTED]: "AUDIO_CODEX.Permission.Role.Trusted",
  [ROLE.ASSISTANT]: "AUDIO_CODEX.Permission.Role.Assistant",
  [ROLE.GAMEMASTER]: "AUDIO_CODEX.Permission.Role.Gamemaster",
};

const isAssignableRole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= ROLE.PLAYER && value <= ROLE.GAMEMASTER;

export function normalizeMinimumRole(value: unknown): number {
  const role = typeof value === "string" ? Number(value) : value;
  return isAssignableRole(role) ? role : DEFAULT_MINIMUM_ROLE;
}

export function canUseCodex(role: number, minimumRole: number): boolean {
  if (!isAssignableRole(role)) return false;
  if (role === ROLE.GAMEMASTER) return true;
  return role >= normalizeMinimumRole(minimumRole);
}

export function minimumRoleToMaterialize(role: number, exists: boolean, current: unknown): number | null {
  if (exists || role !== ROLE.GAMEMASTER) return null;
  return normalizeMinimumRole(current);
}

export function claimGamemasterOnlyKey(keys: unknown, key: string): boolean {
  if (!Array.isArray(keys) || !keys.every((entry) => typeof entry === "string")) return false;
  if (keys.includes(key)) return true;
  try {
    keys.push(key);
  } catch {
    return false;
  }
  return keys.includes(key);
}
