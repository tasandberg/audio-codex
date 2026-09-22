import { describe, expect, it } from "vitest";
import {
  DEFAULT_MINIMUM_ROLE,
  MINIMUM_ROLE_CHOICES,
  ROLE,
  canUseCodex,
  claimGamemasterOnlyKey,
  minimumRoleToMaterialize,
  normalizeMinimumRole,
} from "./permissions";

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

  it("denies an Assistant under a Gamemaster threshold and admits one at the Assistant threshold", () => {
    expect(canUseCodex(ROLE.ASSISTANT, ROLE.GAMEMASTER)).toBe(false);
    expect(canUseCodex(ROLE.ASSISTANT, ROLE.ASSISTANT)).toBe(true);
  });

  it("denies a Trusted at the Assistant threshold that admits an Assistant", () => {
    expect(canUseCodex(ROLE.TRUSTED, ROLE.ASSISTANT)).toBe(false);
    expect(canUseCodex(ROLE.ASSISTANT, ROLE.ASSISTANT)).toBe(true);
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

describe("claimGamemasterOnlyKey", () => {
  const KEY = "audio-codex.minimumRole";

  it("appends the key to a usable list", () => {
    const keys = ["core.permissions"];
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(true);
    expect(keys).toEqual(["core.permissions", KEY]);
  });

  it("appends to an empty list", () => {
    const keys: string[] = [];
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(true);
    expect(keys).toEqual([KEY]);
  });

  it("is idempotent when the key is already present", () => {
    const keys = ["core.permissions", KEY];
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(true);
    expect(keys).toEqual(["core.permissions", KEY]);
  });

  it("reports the key as claimed when a frozen list already contains it", () => {
    const keys = Object.freeze(["core.permissions", KEY]);
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(true);
  });

  it("declines a missing list", () => {
    expect(claimGamemasterOnlyKey(undefined, KEY)).toBe(false);
    expect(claimGamemasterOnlyKey(null, KEY)).toBe(false);
  });

  it("declines a non-array", () => {
    expect(claimGamemasterOnlyKey("core.permissions", KEY)).toBe(false);
    expect(claimGamemasterOnlyKey({ 0: "core.permissions", length: 1 }, KEY)).toBe(false);
    expect(claimGamemasterOnlyKey(new Set(["core.permissions"]), KEY)).toBe(false);
  });

  it("declines an array holding anything but strings", () => {
    const keys: unknown[] = ["core.permissions", { key: "core.time" }];
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(false);
    expect(keys).toEqual(["core.permissions", { key: "core.time" }]);
  });

  it("declines a frozen array without throwing", () => {
    const keys = Object.freeze(["core.permissions"]);
    expect(() => claimGamemasterOnlyKey(keys, KEY)).not.toThrow();
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(false);
    expect(keys).toEqual(["core.permissions"]);
  });

  it("declines a sealed array without throwing", () => {
    const keys = Object.seal(["core.permissions"]);
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(false);
    expect(keys).toEqual(["core.permissions"]);
  });

  it("mutates the caller's array in place, so every alias of it sees the key", () => {
    const base = { _GAMEMASTER_ONLY_KEYS: ["core.permissions"] };
    const subclass: typeof base = Object.create(base);
    expect(claimGamemasterOnlyKey(subclass._GAMEMASTER_ONLY_KEYS, KEY)).toBe(true);
    expect(base._GAMEMASTER_ONLY_KEYS).toContain(KEY);
    expect(Object.hasOwn(subclass, "_GAMEMASTER_ONLY_KEYS")).toBe(false);
  });

  it("declines an array whose writes are silently swallowed", () => {
    const target = ["core.permissions"];
    const keys = new Proxy(target, { set: () => true });
    expect(claimGamemasterOnlyKey(keys, KEY)).toBe(false);
    expect(target).toEqual(["core.permissions"]);
  });
});

describe("minimumRoleToMaterialize", () => {
  it("writes the effective value when a Gamemaster finds the setting absent", () => {
    expect(minimumRoleToMaterialize(ROLE.GAMEMASTER, false, ROLE.GAMEMASTER)).toBe(ROLE.GAMEMASTER);
    expect(minimumRoleToMaterialize(ROLE.GAMEMASTER, false, ROLE.TRUSTED)).toBe(ROLE.TRUSTED);
  });

  it("writes nothing when the setting already exists", () => {
    for (const current of ROLES) expect(minimumRoleToMaterialize(ROLE.GAMEMASTER, true, current)).toBeNull();
  });

  it("writes nothing for an Assistant, who is isGM but not a Gamemaster", () => {
    expect(minimumRoleToMaterialize(ROLE.ASSISTANT, false, ROLE.GAMEMASTER)).toBeNull();
  });

  it("writes nothing for any role below Gamemaster", () => {
    for (const role of [ROLE.NONE, ROLE.PLAYER, ROLE.TRUSTED, ROLE.ASSISTANT]) {
      expect(minimumRoleToMaterialize(role, false, ROLE.GAMEMASTER)).toBeNull();
    }
  });

  it("writes nothing for a role above the assignable range", () => {
    expect(minimumRoleToMaterialize(5, false, ROLE.GAMEMASTER)).toBeNull();
    expect(minimumRoleToMaterialize(Number.NaN, false, ROLE.GAMEMASTER)).toBeNull();
  });

  it("normalizes an unusable stored value to Gamemaster only", () => {
    for (const current of [undefined, null, {}, 0, 5, "nonsense"]) {
      expect(minimumRoleToMaterialize(ROLE.GAMEMASTER, false, current)).toBe(ROLE.GAMEMASTER);
    }
    expect(minimumRoleToMaterialize(ROLE.GAMEMASTER, false, "2")).toBe(ROLE.TRUSTED);
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
