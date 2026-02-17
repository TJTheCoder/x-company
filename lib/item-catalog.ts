import { InventoryItem } from "@/app/protected/page";

type CanonicalItem = {
  key: string;
  name: string;
  weight: number;
  gearBonus?: number;
  itemType: string;
  wield?: "1H" | "2H";
  damage?: number;
  rangeBand?: string;
  properties?: string[];
};

const SHORTSWORD: CanonicalItem = {
  key: "shortsword",
  name: "Shortsword",
  weight: 1,
  gearBonus: 2,
  itemType: "Melee Weapon",
  wield: "1H",
  damage: 1,
  rangeBand: "Engaged",
  properties: ["Edged", "Pointed", "Parrying"],
};

const GREATSWORD: CanonicalItem = {
  key: "greatsword",
  name: "Greatsword",
  weight: 2,
  gearBonus: 2,
  itemType: "Melee Weapon",
  wield: "2H",
  damage: 3,
  rangeBand: "Engaged",
  properties: ["Heavy", "Edged", "Pointed", "Parrying"],
};

const LEATHER_ARMOR: CanonicalItem = {
  key: "leather armor",
  name: "Leather Armor",
  weight: 0.5,
  gearBonus: 2,
  itemType: "Armor",
};

const LIGHT_CROSSBOW: CanonicalItem = {
  key: "light crossbow",
  name: "Light Crossbow",
  weight: 1,
  gearBonus: 1,
  itemType: "Ranged Weapon",
  wield: "2H",
  damage: 2,
  rangeBand: "Long",
  properties: ["Loading"],
};

const PLATE_ARMOR: CanonicalItem = {
  key: "plate armor",
  name: "Plate Armor",
  weight: 2,
  gearBonus: 8,
  itemType: "Armor",
};

const SHORTBOW: CanonicalItem = {
  key: "shortbow",
  name: "Shortbow",
  weight: 0.5,
  gearBonus: 2,
  itemType: "Ranged Weapon",
  wield: "2H",
  damage: 1,
  rangeBand: "Short",
};

const STAFF: CanonicalItem = {
  key: "staff",
  name: "Staff",
  weight: 1,
  gearBonus: 1,
  itemType: "Melee Weapon",
  wield: "2H",
  damage: 1,
  rangeBand: "Near",
  properties: ["Blunt", "Hook", "Parrying"],
};

const STUDDED_LEATHER_CAP: CanonicalItem = {
  key: "studded leather cap",
  name: "Studded Leather Cap",
  weight: 0.5,
  gearBonus: 1,
  itemType: "Helmet",
};

const WOODEN_CLUB: CanonicalItem = {
  key: "wooden club",
  name: "Wooden Club",
  weight: 1,
  gearBonus: 1,
  itemType: "Melee Weapon",
  wield: "1H",
  damage: 1,
  rangeBand: "Engaged",
  properties: ["Blunt"],
};

const HEAVY_CROSSBOW: CanonicalItem = {
  key: "heavy crossbow",
  name: "Heavy Crossbow",
  weight: 2,
  gearBonus: 1,
  itemType: "Ranged Weapon",
  wield: "2H",
  damage: 3,
  rangeBand: "Long",
  properties: ["Loading"],
};

const LARGE_SHIELD: CanonicalItem = {
  key: "large shield",
  name: "Large Shield",
  weight: 1,
  gearBonus: 2,
  itemType: "Shield",
  wield: "1H",
};

const SMALL_SHIELD: CanonicalItem = {
  key: "small shield",
  name: "Small Shield",
  weight: 0.5,
  gearBonus: 1,
  itemType: "Shield",
  wield: "1H",
};

const ARROW_IRON_HEAD: CanonicalItem = {
  key: "arrow (iron head)",
  name: "Arrow (Iron Head)",
  weight: 0.2,
  itemType: "Generic",
};

const ARROW_WOODEN_HEAD: CanonicalItem = {
  key: "arrow (wooden head)",
  name: "Arrow (Wooden Head)",
  weight: 0.2,
  itemType: "Generic",
};

const TORCH: CanonicalItem = {
  key: "torch",
  name: "Torch",
  weight: 0.2,
  itemType: "Generic",
};

const CATALOG: CanonicalItem[] = [
  GREATSWORD,
  LEATHER_ARMOR,
  LIGHT_CROSSBOW,
  PLATE_ARMOR,
  SHORTBOW,
  SHORTSWORD,
  STAFF,
  STUDDED_LEATHER_CAP,
  WOODEN_CLUB,
  HEAVY_CROSSBOW,
  LARGE_SHIELD,
  SMALL_SHIELD,
  ARROW_IRON_HEAD,
  ARROW_WOODEN_HEAD,
  TORCH,
];

const byKey = new Map(CATALOG.map((item) => [item.key, item]));

const keyFromName = (name: string) => name.trim().toLowerCase();

export function getImplementedItemAutofill(name: string): {
  name: string;
  weight: number;
  gearBonus?: number;
} | null {
  const match = byKey.get(keyFromName(name));
  if (!match) return null;
  return {
    name: match.name,
    weight: match.weight,
    gearBonus: match.gearBonus,
  };
}

function resolveCanonical(item: Partial<InventoryItem>): CanonicalItem | null {
  if (item.item_key && byKey.has(item.item_key)) {
    return byKey.get(item.item_key) || null;
  }
  if (item.name) {
    const match = byKey.get(keyFromName(item.name));
    if (match) return match;
  }
  return null;
}

export function normalizeInventoryItem(item: InventoryItem): InventoryItem {
  const canonical = resolveCanonical(item);
  if (!canonical) return item;

  return {
    ...item,
    name: canonical.name,
    weight: canonical.weight,
    // Keep current durability state; only default when missing.
    gearBonus: item.gearBonus ?? canonical.gearBonus,
    item_key: canonical.key,
    item_type: canonical.itemType,
    wield: canonical.wield ?? item.wield,
    damage: canonical.damage ?? item.damage,
    range_band: canonical.rangeBand ?? item.range_band,
    properties: canonical.properties ?? item.properties,
  };
}

export function normalizeInventoryItems(items: InventoryItem[]): InventoryItem[] {
  return items.map(normalizeInventoryItem);
}

export function buildItemFromForm(params: {
  id: string;
  name: string;
  weight: number;
  gearBonus?: number;
  quantity?: number;
}): InventoryItem {
  const base: InventoryItem = {
    id: params.id,
    name: params.name,
    weight: params.weight,
    gearBonus: params.gearBonus,
    quantity: params.quantity,
  };

  return normalizeInventoryItem(base);
}

export function isImplementedItem(item: InventoryItem): boolean {
  return Boolean(item.item_key && byKey.has(item.item_key));
}
