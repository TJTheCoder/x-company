export const DODGED_FLAG = "Dodged";
export const PARRIED_FLAG = "Parried";
export const ARTS_CHOSEN_FLAG = "Arts Chosen";

const INCOMING_PREFIX = "Incoming (";
const LEGACY_INCOMING_DAMAGE_PREFIX = "Incoming Damage (";
const INCOMING_META_PREFIX = "__Incoming Meta (";

export type IncomingDamageFlag = {
  type: string;
  successes: number;
  totalDamage: number | null;
};

export type IncomingDamageMeta = {
  attackerTokenId: string;
  attackId: string;
  weaponName: string;
  weaponBaseDamage?: number | null;
  rangeAtAttack: "Engaged" | "Near" | "Close" | "Long" | "Distant" | null;
  disarmTargetItemId?: string | null;
  disarmZoneId?: number | null;
};

const clampInt = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const parseRange = (
  raw: string
): "Engaged" | "Near" | "Close" | "Long" | "Distant" | null => {
  if (!raw) return null;
  if (raw === "Engaged" || raw === "Near" || raw === "Close" || raw === "Long" || raw === "Distant") {
    return raw;
  }
  return null;
};

const decodePart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const encodePart = (value: string): string => encodeURIComponent(value);

export const buildIncomingDamageFlag = (
  type: string,
  successes: number,
  totalDamage?: number | null
): string => {
  const normalizedType = String(type || "").trim() || "Unknown";
  if (typeof totalDamage === "number" && Number.isFinite(totalDamage)) {
    return `${INCOMING_PREFIX}${normalizedType} ${clampInt(successes)}/${clampInt(totalDamage)})`;
  }
  return `${INCOMING_PREFIX}${normalizedType} ${clampInt(successes)})`;
};

export const parseIncomingDamageFlag = (flag: string): IncomingDamageFlag | null => {
  const raw = String(flag || "").trim();
  if (!raw.endsWith(")")) return null;
  const prefix = raw.startsWith(INCOMING_PREFIX)
    ? INCOMING_PREFIX
    : raw.startsWith(LEGACY_INCOMING_DAMAGE_PREFIX)
      ? LEGACY_INCOMING_DAMAGE_PREFIX
      : null;
  if (!prefix) return null;
  const body = raw.slice(prefix.length, -1);
  const withTotal = body.match(/^(.+?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (withTotal) {
    return {
      type: withTotal[1].trim(),
      successes: clampInt(Number.parseInt(withTotal[2], 10)),
      totalDamage: clampInt(Number.parseInt(withTotal[3], 10)),
    };
  }
  const withoutTotal = body.match(/^(.+?)\s+(\d+)$/);
  if (!withoutTotal) return null;
  return {
    type: withoutTotal[1].trim(),
    successes: clampInt(Number.parseInt(withoutTotal[2], 10)),
    totalDamage: null,
  };
};

export const findIncomingDamageFlag = (
  flags: string[]
): { index: number; raw: string; value: IncomingDamageFlag } | null => {
  for (let i = 0; i < flags.length; i += 1) {
    const parsed = parseIncomingDamageFlag(flags[i]);
    if (parsed) {
      return { index: i, raw: flags[i], value: parsed };
    }
  }
  return null;
};

export const buildIncomingDamageMetaFlag = (meta: IncomingDamageMeta): string => {
  const serialized = [
    encodePart(meta.attackerTokenId || ""),
    encodePart(meta.attackId || ""),
    encodePart(meta.weaponName || ""),
    encodePart(
      typeof meta.weaponBaseDamage === "number" && Number.isFinite(meta.weaponBaseDamage)
        ? String(clampInt(meta.weaponBaseDamage))
        : ""
    ),
    encodePart(meta.rangeAtAttack || ""),
    encodePart(meta.disarmTargetItemId || ""),
    encodePart(
      typeof meta.disarmZoneId === "number" && Number.isFinite(meta.disarmZoneId)
        ? String(Math.trunc(meta.disarmZoneId))
        : ""
    ),
  ].join("|");
  return `${INCOMING_META_PREFIX}${serialized})`;
};

export const parseIncomingDamageMetaFlag = (flag: string): IncomingDamageMeta | null => {
  const raw = String(flag || "").trim();
  if (!raw.startsWith(INCOMING_META_PREFIX) || !raw.endsWith(")")) return null;
  const body = raw.slice(INCOMING_META_PREFIX.length, -1);
  const parts = body.split("|");
  const [attackerPart, attackPart, weaponPart, p4, p5, p6, p7] = parts;
  if (!attackerPart || !attackPart) return null;
  const hasWeaponBase = parts.length >= 7;
  const weaponBasePart = hasWeaponBase ? p4 : "";
  const rangePart = hasWeaponBase ? p5 : p4;
  const disarmItemPart = hasWeaponBase ? p6 : p5;
  const disarmZonePart = hasWeaponBase ? p7 : p6;
  const weaponBaseValue = decodePart(weaponBasePart || "").trim();
  const disarmItemValue = decodePart(disarmItemPart || "").trim();
  const disarmZoneValue = decodePart(disarmZonePart || "").trim();
  const parsedWeaponBase = weaponBaseValue ? Number.parseInt(weaponBaseValue, 10) : Number.NaN;
  const parsedDisarmZone = disarmZoneValue ? Number.parseInt(disarmZoneValue, 10) : Number.NaN;
  return {
    attackerTokenId: decodePart(attackerPart),
    attackId: decodePart(attackPart),
    weaponName: decodePart(weaponPart || ""),
    weaponBaseDamage: Number.isFinite(parsedWeaponBase) ? clampInt(parsedWeaponBase) : null,
    rangeAtAttack: parseRange(decodePart(rangePart || "")),
    disarmTargetItemId: disarmItemValue || null,
    disarmZoneId: Number.isFinite(parsedDisarmZone) ? Math.trunc(parsedDisarmZone) : null,
  };
};

export const findIncomingDamageMetaFlag = (
  flags: string[]
): { index: number; raw: string; value: IncomingDamageMeta } | null => {
  for (let i = 0; i < flags.length; i += 1) {
    const parsed = parseIncomingDamageMetaFlag(flags[i]);
    if (parsed) {
      return { index: i, raw: flags[i], value: parsed };
    }
  }
  return null;
};

export const isIncomingDamageMetaFlag = (flag: string): boolean =>
  String(flag || "").trim().startsWith(INCOMING_META_PREFIX);
