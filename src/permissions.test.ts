import { describe, expect, it } from "vitest";
import { DEFAULT_MINIMUM_ROLE, MINIMUM_ROLE_CHOICES, ROLE, canUseCodex, normalizeMinimumRole } from "./permissions";

const ROLES = [ROLE.PLAYER, ROLE.TRUSTED, ROLE.ASSISTANT, ROLE.GAMEMASTER];

describe("minimum role choices", () => {
  it("offers every assignable role keyed by its numeric value", () => {
    expect(Object.keys(MINIMUM_ROLE_CHOICES)).toEqual(["1", "2", "3", "4"]);
    expect(MINIMUM_ROLE_CHOICES[ROLE.PLAYER]).toBe("AUDIO_CODEX.Permission.Role.Player");
    expect(MINIMUM_ROLE_CHOICES[ROLE.GAMEMASTER]).toBe("AUDIO_CODEX.Permission.Role.Gamemaster");
  });

  it("defaults to Gamemaster only", () => {
    expect(DEFAULT_MINIMUM_ROLE).toBe(ROLE.GAMEMASTER);
  });
});

describe("canUseCodex", () => {
  const GRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
    [ROLE.PLAYER]: [true, true, true, true],
    [ROLE.TRUSTED]: [false, true, true, true],
    [ROLE.ASSISTANT]: [false, false, true, true],
    [ROLE.GAMEMASTER]: [false, false, false, true],
  };

  it.each(ROLES)("threshold %i admits exactly the roles at or above it", (minimum) => {
    expect(ROLES.map((role) => canUseCodex(role, minimum))).toEqual(GRANTS[minimum]);
  });

  it("denies a Player under a Trusted threshold and admits a Trusted", () => {
    expect(canUseCodex(ROLE.PLAYER, ROLE.TRUSTED)).toBe(false);
    expect(canUseCodex(ROLE.TRUSTED, ROLE.TRUSTED)).toBe(true);
  });

  it("never grants access to the NONE role", () => {
    for (const minimum of ROLES) expect(canUseCodex(ROLE.NONE, minimum)).toBe(false);
    expect(canUseCodex(ROLE.NONE, ROLE.NONE)).toBe(false);
  });

  it("always grants access to a Gamemaster", () => {
    expect(canUseCodex(ROLE.GAMEMASTER, 99)).toBe(true);
    expect(canUseCodex(ROLE.GAMEMASTER, Number.NaN)).toBe(true);
    expect(canUseCodex(ROLE.GAMEMASTER, "nonsense" as unknown as number)).toBe(true);
  });

  it("falls back to Gamemaster only when the stored threshold is unusable", () => {
    for (const minimum of [0, -1, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canUseCodex(ROLE.PLAYER, minimum)).toBe(false);
      expect(canUseCodex(ROLE.ASSISTANT, minimum)).toBe(false);
    }
    expect(canUseCodex(ROLE.TRUSTED, null as unknown as number)).toBe(false);
    expect(canUseCodex(ROLE.TRUSTED, "2" as unknown as number)).toBe(true);
  });

  it("rejects roles outside the assignable range", () => {
    expect(canUseCodex(5, ROLE.PLAYER)).toBe(false);
    expect(canUseCodex(-1, ROLE.PLAYER)).toBe(false);
    expect(canUseCodex(Number.NaN, ROLE.PLAYER)).toBe(false);
    expect(canUseCodex(undefined as unknown as number, ROLE.PLAYER)).toBe(false);
  });
});

describe("normalizeMinimumRole", () => {
  it("keeps assignable roles and coerces anything else to Gamemaster", () => {
    for (const role of ROLES) expect(normalizeMinimumRole(role)).toBe(role);
    expect(normalizeMinimumRole("3")).toBe(ROLE.ASSISTANT);
    expect(normalizeMinimumRole(undefined)).toBe(ROLE.GAMEMASTER);
    expect(normalizeMinimumRole({})).toBe(ROLE.GAMEMASTER);
    expect(normalizeMinimumRole(0)).toBe(ROLE.GAMEMASTER);
  });
});
