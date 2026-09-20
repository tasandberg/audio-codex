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
  it("grants access at or above the threshold", () => {
    for (const minimum of ROLES) {
      for (const role of ROLES) {
        expect(canUseCodex(role, minimum)).toBe(role >= minimum);
      }
    }
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
