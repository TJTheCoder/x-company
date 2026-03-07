import { Art, InventoryItem } from "@/app/protected/page";
import { buildItemFromForm, getImplementedItemAutofill } from "@/lib/item-catalog";
import artsCatalogData from "@/data/arts.json";
import talentsCatalogData from "@/data/talents.json";

export type MonsterRangeBand = "Engaged" | "Near" | "Close" | "Long";
export const MONSTER_TALENT_MAX_LEVEL = 6;

export type MonsterTalentProgress = {
  id: string;
  level: number;
};

export type MonsterTemplate = {
  id: string;
  name: string;
  str: number;
  agl: number;
  wit: number;
  emp: number;
  skill: number;
  starting_spirits: number;
  natural_armor: number;
  size: number;
  gear: InventoryItem[];
  arts: Art[];
  range_band: MonsterRangeBand;
  traits: string[];
  talent_levels?: Record<string, number>;
  talents?: MonsterTalentProgress[];
  icon_url: string | null;
  physical?: number;
  mental?: number;
  special?: number;
  created_at?: string;
  updated_at?: string;
};

export type MonsterSnapshot = {
  template_id: string;
  name: string;
  size: number;
  skill: number;
  natural_armor: number;
  str: number;
  agl: number;
  wit: number;
  emp: number;
  max_str: number;
  max_agl: number;
  max_wit: number;
  max_emp: number;
  starting_spirits: number;
  spirits_current?: number;
  dead?: boolean;
  gear: InventoryItem[];
  arts: Art[];
  equipment_slots: MonsterEquipmentSlots;
  range_band: MonsterRangeBand;
  traits: string[];
  talent_levels?: Record<string, number>;
  talents?: MonsterTalentProgress[];
  physical?: number;
  mental?: number;
  special?: number;
};

export type MonsterEquipmentSlots = {
  armor: string | null;
  helmet: string | null;
  left: string | null;
  right: string | null;
};

const normalizeTrait = (trait: string): string => {
  const t = trait.trim();
  if (!t) return "";
  return `${t.slice(0, 1).toUpperCase()}${t.slice(1).toLowerCase()}`;
};

const makeGearId = (name: string, idx: number): string =>
  `monster-gear:${name.toLowerCase().replace(/\s+/g, "-")}:${Date.now()}:${idx}`;
const gearGroupKey = (item: InventoryItem): string => {
  const gear = typeof item.gearBonus === "number" && !Number.isNaN(item.gearBonus) ? Math.trunc(item.gearBonus) : null;
  return `${String(item.name || "").trim().toLowerCase()}::${gear ?? "none"}`;
};
const gearGroupLabel = (item: InventoryItem): string => {
  const gear = typeof item.gearBonus === "number" && !Number.isNaN(item.gearBonus) ? Math.trunc(item.gearBonus) : null;
  if (gear !== null) return `${item.name} (+${gear})`;
  return item.name;
};
const summarizeGearForDisplay = (gear: InventoryItem[]): string => {
  if (!gear || gear.length === 0) return "None";
  const grouped = new Map<string, { label: string; count: number }>();
  for (const item of gear) {
    const key = gearGroupKey(item);
    const count = Math.max(1, Math.trunc(item.quantity ?? 1));
    const existing = grouped.get(key);
    if (existing) {
      existing.count += count;
      continue;
    }
    grouped.set(key, { label: gearGroupLabel(item), count });
  }
  return Array.from(grouped.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry) => (entry.count > 1 ? `${entry.label} x${entry.count}` : entry.label))
    .join(", ");
};
const artsCatalog = artsCatalogData as Art[];
const artByName = new Map(artsCatalog.map((art) => [art.name.trim().toLowerCase(), art]));
const talentsCatalog = talentsCatalogData as Array<{ id: string; name: string }>;
const talentByName = new Map(talentsCatalog.map((talent) => [talent.name.trim().toLowerCase(), talent]));
const talentNameById = new Map(talentsCatalog.map((talent) => [talent.id, talent.name]));

const normalizeMonsterInt = (
  value: unknown,
  fallback: number,
  options?: { min?: number }
): number => {
  const min = options?.min ?? 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(min, Math.trunc(fallback));
  return Math.max(min, Math.trunc(parsed));
};

const clampMonsterTalentLevel = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MONSTER_TALENT_MAX_LEVEL, Math.trunc(parsed)));
};

const normalizeMonsterTalentData = (
  talentLevels: Record<string, unknown> | null | undefined,
  talents: Array<{ id?: string | null; level?: unknown } | null | undefined> | null | undefined
): { talent_levels: Record<string, number>; talents: MonsterTalentProgress[] } => {
  const merged = new Map<string, number>();

  if (talentLevels && typeof talentLevels === "object") {
    for (const [id, level] of Object.entries(talentLevels)) {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) continue;
      merged.set(normalizedId, clampMonsterTalentLevel(level));
    }
  }

  for (const talent of talents || []) {
    const normalizedId = String(talent?.id || "").trim();
    if (!normalizedId) continue;
    merged.set(normalizedId, clampMonsterTalentLevel(talent?.level ?? 1));
  }

  const ordered = Array.from(merged.entries()).sort((a, b) => {
    const aName = talentNameById.get(a[0]) || a[0];
    const bName = talentNameById.get(b[0]) || b[0];
    return aName.localeCompare(bName);
  });

  return {
    talent_levels: Object.fromEntries(ordered),
    talents: ordered.map(([id, level]) => ({ id, level })),
  };
};

const legacyPhysicalForTemplate = (str: number, agl: number): number =>
  Math.max(1, Math.ceil(Math.max(str, agl) / 2));

const legacyMentalForTemplate = (wit: number, emp: number): number =>
  Math.max(1, Math.ceil(Math.max(wit, emp) / 2));

export function parseMonsterGearCsv(csv: string): InventoryItem[] {
  const names = csv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const parsed: InventoryItem[] = [];

  names.forEach((rawName, idx) => {
    const qtyMatch = rawName.match(/^(.*?)\s*x\s*(\d+)$/i);
    const baseName = (qtyMatch?.[1] ?? rawName).trim();
    const quantity = qtyMatch ? Math.max(1, Number.parseInt(qtyMatch[2], 10) || 1) : 1;
    const canonical = getImplementedItemAutofill(baseName);
    if (!canonical) return;
    parsed.push(
      buildItemFromForm({
        id: makeGearId(canonical.name, idx),
        name: canonical.name,
        weight: canonical.weight,
        gearBonus: canonical.gearBonus,
        quantity,
      })
    );
  });

  return parsed;
}

export function normalizeMonsterTraitsCsv(csv: string): string[] {
  return csv
    .split(",")
    .map(normalizeTrait)
    .filter(Boolean);
}

export function parseMonsterTalentsCsv(
  csv: string
): { talent_levels: Record<string, number>; talents: MonsterTalentProgress[] } {
  const merged = new Map<string, number>();
  const parts = csv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(.*?)(?:\s+(\d+))?$/);
    const rawName = match?.[1]?.trim().toLowerCase() || "";
    if (!rawName) continue;
    const talent = talentByName.get(rawName) || talentsCatalog.find((entry) => entry.id === rawName) || null;
    if (!talent) continue;
    const level = clampMonsterTalentLevel(match?.[2] ?? 1);
    merged.set(talent.id, Math.max(level, merged.get(talent.id) ?? 0));
  }

  const ordered = Array.from(merged.entries()).sort((a, b) => {
    const aName = talentNameById.get(a[0]) || a[0];
    const bName = talentNameById.get(b[0]) || b[0];
    return aName.localeCompare(bName);
  });

  return {
    talent_levels: Object.fromEntries(ordered),
    talents: ordered.map(([id, level]) => ({ id, level })),
  };
}

export function parseMonsterArtsCsv(csv: string): Art[] {
  const names = csv
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const arts: Art[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const art = artByName.get(name);
    if (!art || seen.has(art.id)) continue;
    seen.add(art.id);
    arts.push(art);
  }
  return arts;
}

export function monsterToGearCsv(monster: MonsterTemplate): string {
  return (monster.gear || [])
    .map((item) => {
      const qty = Math.max(1, item.quantity || 1);
      return qty > 1 ? `${item.name} x${qty}` : item.name;
    })
    .join(", ");
}

export function monsterToTraitsCsv(monster: MonsterTemplate): string {
  const legacyTags = (monster as unknown as { tags?: string[] }).tags;
  return (monster.traits || legacyTags || []).join(", ");
}

export function monsterToArtsCsv(monster: MonsterTemplate): string {
  return (monster.arts || []).map((art) => art.name).join(", ");
}

export function monsterToTalentsCsv(monster: {
  talent_levels?: Record<string, unknown> | null;
  talents?: Array<{ id?: string | null; level?: unknown } | null | undefined> | null;
}): string {
  const normalized = normalizeMonsterTalentData(
    (monster.talent_levels || {}) as Record<string, unknown>,
    (monster.talents || []) as Array<{ id?: string | null; level?: unknown } | null | undefined>
  );
  return normalized.talents
    .map((talent) => `${talentNameById.get(talent.id) || talent.id} ${talent.level}`)
    .join(", ");
}

export function normalizeMonsterTemplate(monster: Partial<MonsterTemplate> & Record<string, unknown>): MonsterTemplate {
  const physical = normalizeMonsterInt(monster.physical, 1, { min: 1 });
  const mental = normalizeMonsterInt(monster.mental, 1, { min: 1 });
  const skill = normalizeMonsterInt(monster.skill ?? monster.special, 0, { min: 0 });
  const str = normalizeMonsterInt(monster.str, physical * 2, { min: 1 });
  const agl = normalizeMonsterInt(monster.agl, physical * 2, { min: 1 });
  const wit = normalizeMonsterInt(monster.wit, mental * 2, { min: 1 });
  const emp = normalizeMonsterInt(monster.emp, mental * 2, { min: 1 });
  const startingSpirits = normalizeMonsterInt(
    monster.starting_spirits,
    normalizeMonsterInt(monster.special, 0, { min: 0 }) * 2,
    { min: 0 }
  );
  const naturalArmor = normalizeMonsterInt(
    monster.natural_armor,
    normalizeMonsterInt(monster.special, 0, { min: 0 }),
    { min: 0 }
  );
  const size = normalizeMonsterInt(monster.size, 1);
  const talentData = normalizeMonsterTalentData(
    (monster.talent_levels || {}) as Record<string, unknown>,
    (monster.talents || []) as Array<{ id?: string | null; level?: unknown } | null | undefined>
  );
  return {
    id: String(monster.id || ""),
    name: String(monster.name || "").trim(),
    str,
    agl,
    wit,
    emp,
    skill,
    starting_spirits: startingSpirits,
    natural_armor: naturalArmor,
    size,
    gear: Array.isArray(monster.gear) ? (monster.gear as InventoryItem[]) : [],
    arts: Array.isArray(monster.arts) ? (monster.arts as Art[]) : [],
    range_band:
      monster.range_band === "Engaged" ||
      monster.range_band === "Near" ||
      monster.range_band === "Close" ||
      monster.range_band === "Long"
        ? monster.range_band
        : "Engaged",
    traits: Array.isArray(monster.traits)
      ? (monster.traits as string[]).map(normalizeTrait).filter(Boolean)
      : normalizeMonsterTraitsCsv(""),
    talent_levels: talentData.talent_levels,
    talents: talentData.talents,
    icon_url: typeof monster.icon_url === "string" ? monster.icon_url : null,
    physical: legacyPhysicalForTemplate(str, agl),
    mental: legacyMentalForTemplate(wit, emp),
    special: skill,
    created_at: typeof monster.created_at === "string" ? monster.created_at : undefined,
    updated_at: typeof monster.updated_at === "string" ? monster.updated_at : undefined,
  };
}

export function buildMonsterSnapshot(monster: MonsterTemplate): MonsterSnapshot {
  const normalized = normalizeMonsterTemplate(monster as Partial<MonsterTemplate> & Record<string, unknown>);
  const gear = normalized.gear || [];
  const legacyTags = (monster as unknown as { tags?: string[] }).tags;
  const traits = normalized.traits || legacyTags || [];
  const size = Number.isFinite(normalized.size) ? Math.trunc(normalized.size) : 1;
  return {
    template_id: normalized.id,
    name: normalized.name,
    size,
    skill: normalized.skill,
    natural_armor: normalized.natural_armor,
    str: normalized.str,
    agl: normalized.agl,
    wit: normalized.wit,
    emp: normalized.emp,
    max_str: normalized.str,
    max_agl: normalized.agl,
    max_wit: normalized.wit,
    max_emp: normalized.emp,
    starting_spirits: normalized.starting_spirits,
    spirits_current: normalized.starting_spirits,
    dead: false,
    gear,
    arts: normalized.arts || [],
    equipment_slots: buildMonsterAutoEquipmentSlots(gear),
    range_band: normalized.range_band,
    traits,
    talent_levels: normalized.talent_levels || {},
    talents: normalized.talents || [],
    physical: normalized.physical,
    mental: normalized.mental,
    special: normalized.special,
  };
}

export function formatMonsterTooltip(snapshot: MonsterSnapshot): string {
  const gearList = snapshot.gear || [];
  const artsList = snapshot.arts || [];
  const slots = snapshot.equipment_slots || {
    armor: null,
    helmet: null,
    left: null,
    right: null,
  };
  const gear = summarizeGearForDisplay(gearList);
  const arts = artsList.length > 0 ? artsList.map((art) => art.name).join(", ") : "None";
  const normalizedTalents = normalizeMonsterTalentData(
    (snapshot.talent_levels || {}) as Record<string, unknown>,
    (snapshot.talents || []) as Array<{ id?: string | null; level?: unknown } | null | undefined>
  );
  const equipped = [
    slots.helmet ? `Helmet: ${slots.helmet}` : null,
    slots.armor ? `Armor: ${slots.armor}` : null,
    slots.left ? `Left: ${slots.left}` : null,
    slots.right ? `Right: ${slots.right}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const traits = snapshot.traits && snapshot.traits.length > 0 ? snapshot.traits.join(", ") : "None";
  const talents =
    normalizedTalents.talents.length > 0
      ? normalizedTalents.talents
          .map((talent) => `${talentNameById.get(talent.id) || talent.id} ${talent.level}`)
          .join(", ")
      : "None";
  const currentSpirit = snapshot.spirits_current ?? snapshot.starting_spirits;
  return [
    snapshot.name,
    `Size: ${snapshot.size}`,
    `STR ${snapshot.str}/${snapshot.max_str ?? snapshot.str} | AGL ${snapshot.agl}/${snapshot.max_agl ?? snapshot.agl}`,
    `WIT ${snapshot.wit}/${snapshot.max_wit ?? snapshot.wit} | EMP ${snapshot.emp}/${snapshot.max_emp ?? snapshot.emp}`,
    `Skill: +${snapshot.skill ?? snapshot.special ?? 0}`,
    `Spirit: ${currentSpirit}/${snapshot.starting_spirits}`,
    `Natural Armor: ${snapshot.natural_armor}`,
    `Range: ${snapshot.range_band}`,
    `Gear: ${gear}`,
    `Arts: ${arts}`,
    `Talents: ${talents}`,
    `Equipped: ${equipped || "None"}`,
    `Traits: ${traits}`,
  ].join("\n");
}

export function buildMonsterAutoEquipmentSlots(gear: InventoryItem[]): MonsterEquipmentSlots {
  const slots: MonsterEquipmentSlots = {
    armor: null,
    helmet: null,
    left: null,
    right: null,
  };

  for (const item of gear) {
    if (!slots.helmet && item.item_type === "Helmet") {
      slots.helmet = item.name;
      continue;
    }
    if (!slots.armor && item.item_type === "Armor") {
      slots.armor = item.name;
      continue;
    }
    if (item.wield === "2H") {
      if (!slots.left && !slots.right) {
        slots.left = item.name;
        slots.right = item.name;
      }
      continue;
    }
    if (item.wield === "1H") {
      if (!slots.left) {
        slots.left = item.name;
      } else if (!slots.right) {
        slots.right = item.name;
      }
    }
  }

  return slots;
}
