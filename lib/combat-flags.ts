export const DODGED_FLAG = "Dodged";
export const PARRIED_FLAG = "Parried";
export const ARTS_CHOSEN_FLAG = "Arts Chosen";

const INCOMING_DAMAGE_PREFIX = "Incoming Damage (";
const INCOMING_META_PREFIX = "__Incoming Meta (";

export type IncomingDamageFlag = {
  type: string;
  successes: number;
  totalDamage: number;
};

export type IncomingDamageMeta = {
  attackerTokenId: string;
  attackId: string;
  weaponName: string;
  rangeAtAttack: "Engaged" | "Near" | "Close" | "Long" | "Distant" | null;
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
  totalDamage: number
): string => {
  const normalizedType = String(type || "").trim() || "Unknown";
  return `${INCOMING_DAMAGE_PREFIX}${normalizedType} ${clampInt(successes)}/${clampInt(totalDamage)})`;
};

export const parseIncomingDamageFlag = (flag: string): IncomingDamageFlag | null => {
  const raw = String(flag || "").trim();
  if (!raw.startsWith(INCOMING_DAMAGE_PREFIX) || !raw.endsWith(")")) return null;
  const body = raw.slice(INCOMING_DAMAGE_PREFIX.length, -1);
  const match = body.match(/^(.+?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return {
    type: match[1].trim(),
    successes: clampInt(Number.parseInt(match[2], 10)),
    totalDamage: clampInt(Number.parseInt(match[3], 10)),
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
    encodePart(meta.rangeAtAttack || ""),
  ].join("|");
  return `${INCOMING_META_PREFIX}${serialized})`;
};

export const parseIncomingDamageMetaFlag = (flag: string): IncomingDamageMeta | null => {
  const raw = String(flag || "").trim();
  if (!raw.startsWith(INCOMING_META_PREFIX) || !raw.endsWith(")")) return null;
  const body = raw.slice(INCOMING_META_PREFIX.length, -1);
  const [attackerPart, attackPart, weaponPart, rangePart] = body.split("|");
  if (!attackerPart || !attackPart) return null;
  return {
    attackerTokenId: decodePart(attackerPart),
    attackId: decodePart(attackPart),
    weaponName: decodePart(weaponPart || ""),
    rangeAtAttack: parseRange(decodePart(rangePart || "")),
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
