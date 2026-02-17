import { Art, InventoryItem } from "@/app/protected/page";
import { buildItemFromForm, getImplementedItemAutofill } from "@/lib/item-catalog";
import artsCatalogData from "@/data/arts.json";

export type MonsterRangeBand = "Engaged" | "Near" | "Close" | "Long";

export type MonsterTemplate = {
  id: string;
  name: string;
  physical: number;
  mental: number;
  special: number;
  gear: InventoryItem[];
  arts: Art[];
  range_band: MonsterRangeBand;
  tags: string[];
  icon_url: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MonsterSnapshot = {
  template_id: string;
  name: string;
  physical: number;
  mental: number;
  special: number;
  natural_armor: number;
  str: number;
  agl: number;
  wit: number;
  emp: number;
  starting_spirits: number;
  gear: InventoryItem[];
  arts: Art[];
  equipment_slots: MonsterEquipmentSlots;
  range_band: MonsterRangeBand;
  tags: string[];
};

export type MonsterEquipmentSlots = {
  armor: string | null;
  helmet: string | null;
  left: string | null;
  right: string | null;
};

const normalizeTag = (tag: string): string => {
  const t = tag.trim();
  if (!t) return "";
  return `${t.slice(0, 1).toUpperCase()}${t.slice(1).toLowerCase()}`;
};

const makeGearId = (name: string, idx: number): string =>
  `monster-gear:${name.toLowerCase().replace(/\s+/g, "-")}:${Date.now()}:${idx}`;
const artsCatalog = artsCatalogData as Art[];
const artByName = new Map(artsCatalog.map((art) => [art.name.trim().toLowerCase(), art]));

export function parseMonsterGearCsv(csv: string): InventoryItem[] {
  const names = csv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const parsed: InventoryItem[] = [];

  names.forEach((name, idx) => {
    const canonical = getImplementedItemAutofill(name);
    if (!canonical) return;
    parsed.push(
      buildItemFromForm({
        id: makeGearId(canonical.name, idx),
        name: canonical.name,
        weight: canonical.weight,
        gearBonus: canonical.gearBonus,
      })
    );
  });

  return parsed;
}

export function normalizeMonsterTagsCsv(csv: string): string[] {
  return csv
    .split(",")
    .map(normalizeTag)
    .filter(Boolean);
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
  return (monster.gear || []).map((item) => item.name).join(", ");
}

export function monsterToTagsCsv(monster: MonsterTemplate): string {
  return (monster.tags || []).join(", ");
}

export function monsterToArtsCsv(monster: MonsterTemplate): string {
  return (monster.arts || []).map((art) => art.name).join(", ");
}

export function buildMonsterSnapshot(monster: MonsterTemplate): MonsterSnapshot {
  const gear = monster.gear || [];
  return {
    template_id: monster.id,
    name: monster.name,
    physical: monster.physical,
    mental: monster.mental,
    special: monster.special,
    natural_armor: monster.special,
    str: monster.physical * 2,
    agl: monster.physical * 2,
    wit: monster.mental * 2,
    emp: monster.mental * 2,
    starting_spirits: monster.special * 2,
    gear,
    arts: monster.arts || [],
    equipment_slots: buildMonsterAutoEquipmentSlots(gear),
    range_band: monster.range_band,
    tags: monster.tags || [],
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
  const gear = gearList.length > 0 ? gearList.map((item) => item.name).join(", ") : "None";
  const arts = artsList.length > 0 ? artsList.map((art) => art.name).join(", ") : "None";
  const equipped = [
    slots.helmet ? `Helmet: ${slots.helmet}` : null,
    slots.armor ? `Armor: ${slots.armor}` : null,
    slots.left ? `Left: ${slots.left}` : null,
    slots.right ? `Right: ${slots.right}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const tags = snapshot.tags && snapshot.tags.length > 0 ? snapshot.tags.join(", ") : "None";
  return [
    snapshot.name,
    `Physical ${snapshot.physical} (STR ${snapshot.str}, AGL ${snapshot.agl})`,
    `Mental ${snapshot.mental} (WIT ${snapshot.wit}, EMP ${snapshot.emp})`,
    `Special ${snapshot.special} (+${snapshot.special} all skills, Spirit ${snapshot.starting_spirits})`,
    `Natural Armor ${snapshot.natural_armor}`,
    `Range ${snapshot.range_band}`,
    `Gear ${gear}`,
    `Arts ${arts}`,
    `Equipped ${equipped || "None"}`,
    `Tags ${tags}`,
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
