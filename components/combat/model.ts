import type {
  CharacterType,
  InventoryItem,
  PendingArtRoll,
  PendingArtPrompt,
  PendingArmorPrompt,
  PendingMeleeAction,
  PendingReactionRoll,
  ResolvedArtRoll,
  ResolvedMeleeAttack,
} from "@/app/protected/page";
import type { MonsterSnapshot, MonsterTemplate } from "@/lib/monsters";

export type CombatProps = {
  isDM: boolean;
  userEmail: string | null;
  onRequestDrawGear?: () => void;
  character: CharacterType | null;
  onQueueMeleeAction?: (action: PendingMeleeAction) => void;
  onQueueReactionRoll?: (roll: PendingReactionRoll) => void;
  onResolveMeleeAttack?: (attack: ResolvedMeleeAttack) => void | Promise<void>;
  onApplyStartOfTurnEffects?: (tokenId: string) => void | Promise<void>;
  pendingArmorPrompt?: PendingArmorPrompt | null;
  onConsumeArmorPrompt?: (promptId: string) => void;
  onArmorPromptPass?: (attack: ResolvedMeleeAttack) => void | Promise<void>;
  pendingArtPrompt?: PendingArtPrompt | null;
  onConsumeArtPrompt?: (promptId: string) => void;
  onArtPromptPass?: (promptId: string) => void | Promise<void>;
  onArtPromptRoll?: (promptId: string, optionId: string) => void | Promise<void>;
  pendingArtRoll?: PendingArtRoll | null;
  onConsumePendingArtRoll?: (rollId: string) => void;
  onResolveArtRoll?: (roll: ResolvedArtRoll) => void | Promise<void>;
  onArtRollCleared?: () => void;
};

export type ZonePoint = {
  x: number;
  y: number;
};

export type ZoneStroke = {
  points: ZonePoint[];
};

export type LegacyZoneLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type InitiativeMonster = {
  id: string;
  name: string;
  template_id: string | null;
  icon_url: string | null;
  monster_snapshot: MonsterSnapshot | null;
};

export type InitiativeEntry = {
  participant_id: string;
  kind: "player" | "monster";
  name: string;
  user_email: string | null;
  icon_url: string | null;
  monster_template_id?: string | null;
  monster_snapshot?: MonsterSnapshot | null;
  roll: number | null;
  slow_available: boolean;
  fast_available: boolean;
  fast_footwork_dodge_used?: boolean;
  prone?: boolean;
  covered?: boolean;
  swing_weapon_item_id?: string | null;
  swing_weapon_name?: string | null;
  readied_weapon_item_id?: string | null;
  readied_weapon_name?: string | null;
  readied_weapon_hand?: "left" | "right" | "both" | null;
  readied_ammo_item?: InventoryItem | null;
  aim_target_id?: string | null;
  aim_target_name?: string | null;
  aim_weapon_item_id?: string | null;
  aim_weapon_name?: string | null;
  grappling_target_id?: string | null;
  grappling_target_name?: string | null;
  grappled_by_id?: string | null;
  grappled_by_name?: string | null;
  clinging_target_id?: string | null;
  clinging_target_name?: string | null;
  clung_onto_by_id?: string | null;
  clung_onto_by_name?: string | null;
  clung_onto_by_ids?: string[] | null;
  clung_onto_by_names?: string[] | null;
  taunted_anger_by_id?: string | null;
  taunted_anger_by_name?: string | null;
  taunted_distract_value?: number | null;
  used_item_flags?: string[] | null;
  flame_intensity?: number | null;
  falling_zones?: number | null;
  blitzed?: boolean;
  feint_pending_roll?: number | null;
  feint_pending_name?: string | null;
  dead?: boolean;
};

export type CharacterLite = {
  id: string;
  name: string;
  email: string;
  icon_url: string | null;
  attributes: {
    STR: number;
    AGL: number;
    WIT: number;
    EMP: number;
  } | null;
  spirits: number | null;
  dead?: boolean;
  inventory?: CharacterType["inventory"];
  equipment_slots?: CharacterType["equipment_slots"];
  max_attributes?: CharacterType["max_attributes"];
  skills?: CharacterType["skills"];
  talent_levels?: CharacterType["talent_levels"];
  talents?: CharacterType["talents"];
};

export type ZoneLootDrop = {
  zone_id: number;
  item: InventoryItem;
};

export type CombatStateRow = {
  id: number;
  map_url: string | null;
  zone_lines: (ZoneStroke | LegacyZoneLine)[] | null;
  zone_cover: number[] | null;
  token_positions: TokenPosition[] | null;
  token_elevations: TokenElevation[] | null;
  engagements: EngagementEdge[] | null;
  combat_mode: boolean | null;
  initiative_monsters: InitiativeMonster[] | null;
  initiative_entries: InitiativeEntry[] | null;
  initiative_current_index: number | null;
  zone_loot: ZoneLootDrop[] | null;
  pending_reactions?: PendingReaction[] | null;
  updated_by_email: string | null;
  updated_at: string;
};

export type CombatStateMutationRow = {
  initiative_entries: InitiativeEntry[] | null;
  initiative_monsters: InitiativeMonster[] | null;
  initiative_current_index: number | null;
  engagements: EngagementEdge[] | null;
  zone_loot: ZoneLootDrop[] | null;
  zone_cover?: number[] | null;
  token_elevations?: TokenElevation[] | null;
};

export type PendingReaction = {
  id: string;
  attackId: string;
  attackerCharacterId: string;
  targetCharacterId: string;
  weaponName: string;
  weaponBaseDamage: number;
  maneuver: ResolvedMeleeAttack["maneuver"];
  totalSuccesses: number;
  requiredSuccesses?: number;
  swingBonusDamage?: number;
  disarmTargetItemId?: string | null;
  disarmZoneId?: number | null;
  destinationX?: number | null;
  destinationY?: number | null;
  shootTargetZoneId?: number | null;
  shootAmmoItem?: InventoryItem | null;
  rangeAtAttack?: "Engaged" | "Near" | "Close" | "Long" | "Distant" | null;
  createdAt?: string | null;
};

export type TokenPosition = {
  character_id: string;
  x: number;
  y: number;
};

export type TokenElevation = {
  character_id: string;
  elevation: number;
};

export type RenderedToken = TokenPosition & {
  type: "player" | "monster";
  name: string;
  email: string | null;
  icon_url: string | null;
  tooltip: string;
  elevation: number;
  dead?: boolean;
  physicallyBroken?: boolean;
  mentallyBroken?: boolean;
};

export type EngagementEdge = {
  a: string;
  b: string;
};

export type ImageRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};
export type MonsterRollResult = {
  actionLabel: string;
  attributeDice: number[];
  attributeLabel?: string;
  skillDice: number[];
  skillLabel?: string;
  skillIsNegative?: boolean;
  gearDice: number[];
  gearLabel?: string;
  successes: number;
};

export const MAP_BUCKET = "combat-assets";
export const DM_EMAIL = "drocasma9@gmail.com";
export type TokenSide = "player" | "monster";
export const REACTION_MANEUVER_SET = new Set<ResolvedMeleeAttack["maneuver"]>([
  "Shove",
  "Disarm",
  "Feint",
  "Slash",
  "Stab",
  "Strike",
  "Grapple",
  "Cling",
  "Shoot",
]);
export type AttributeKey = "STR" | "AGL" | "WIT" | "EMP";
export const SKILL_ATTRIBUTE_MAP: Record<string, AttributeKey> = {
  MIGHT: "STR",
  ENDURANCE: "STR",
  MELEE: "STR",
  CRAFTING: "STR",
  STEALTH: "AGL",
  MOVE: "AGL",
  "SLEIGHT OF HAND": "AGL",
  MARKSMANSHIP: "AGL",
  SCOUTING: "WIT",
  LORE: "WIT",
  SURVIVAL: "WIT",
  INSIGHT: "WIT",
  MANIPULATE: "EMP",
  HEALING: "EMP",
  PERFORMANCE: "EMP",
  "ANIMAL HANDLING": "EMP",
};
export const skillAttributeFor = (skill?: string | null): AttributeKey | null => {
  if (!skill) return null;
  return SKILL_ATTRIBUTE_MAP[skill] ?? null;
};

export const normalizeEmail = (value: string | null | undefined): string =>
  (value || "").trim().toLowerCase();

export function isLegacyLine(value: unknown): value is LegacyZoneLine {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x1 === "number" &&
    typeof v.y1 === "number" &&
    typeof v.x2 === "number" &&
    typeof v.y2 === "number"
  );
}

export function isStroke(value: unknown): value is ZoneStroke {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.points)) return false;

  return v.points.every(
    (point) =>
      !!point &&
      typeof point === "object" &&
      typeof (point as Record<string, unknown>).x === "number" &&
      typeof (point as Record<string, unknown>).y === "number"
  );
}

export function normalizeZoneLines(raw: (ZoneStroke | LegacyZoneLine)[] | null | undefined): ZoneStroke[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (isStroke(entry)) return entry;
      if (isLegacyLine(entry)) {
        return {
          points: [
            { x: entry.x1, y: entry.y1 },
            { x: entry.x2, y: entry.y2 },
          ],
        };
      }
      return null;
    })
    .filter((entry): entry is ZoneStroke => !!entry);
}

export function rollUniqueFromBase(set: Set<string>, baseRoll: number): number {
  const base = Math.max(0, Math.min(9, Math.trunc(baseRoll)));
  let frac = "";
  let key = `${base}`;

  while (set.has(key)) {
    frac += `${Math.floor(Math.random() * 10)}`;
    key = `${base}.${frac}`;
  }

  set.add(key);
  return Number(key);
}

export function rollUnique(set: Set<string>): number {
  return rollUniqueFromBase(set, Math.floor(Math.random() * 10));
}

export function rollHighestOfD10Unique(set: Set<string>, diceCount: number): number {
  const count = Math.max(1, Math.trunc(diceCount));
  let best = 0;
  for (let i = 0; i < count; i++) {
    const roll = Math.floor(Math.random() * 10);
    if (i === 0 || roll > best) best = roll;
  }
  return rollUniqueFromBase(set, best);
}

export function formatRoll(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text;
}

export function rollSortValue(value: number | null): number {
  return value ?? -1;
}

export function buildZoneTintDataUrl(strokes: ZoneStroke[], gridW = 320, gridH = 320): string | null {
  if (typeof document === "undefined") return null;

  const lineCanvas = document.createElement("canvas");
  lineCanvas.width = gridW;
  lineCanvas.height = gridH;
  const lctx = lineCanvas.getContext("2d");
  if (!lctx) return null;

  lctx.clearRect(0, 0, gridW, gridH);
  lctx.strokeStyle = "black";
  lctx.lineWidth = 3;
  lctx.lineCap = "round";
  lctx.lineJoin = "round";

  // Implicit border of the map
  lctx.strokeRect(0, 0, gridW, gridH);

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;
    lctx.beginPath();
    lctx.moveTo(stroke.points[0].x * gridW, stroke.points[0].y * gridH);
    for (let i = 1; i < stroke.points.length; i++) {
      lctx.lineTo(stroke.points[i].x * gridW, stroke.points[i].y * gridH);
    }
    lctx.stroke();
  }

  const lineImage = lctx.getImageData(0, 0, gridW, gridH);
  const lineData = lineImage.data;
  const output = document.createElement("canvas");
  output.width = gridW;
  output.height = gridH;
  const octx = output.getContext("2d");
  if (!octx) return null;
  const outImage = octx.createImageData(gridW, gridH);
  const outData = outImage.data;

  const isBoundary = (idx: number) => lineData[idx + 3] > 100;
  const visited = new Uint8Array(gridW * gridH);
  const qx = new Int32Array(gridW * gridH);
  const qy = new Int32Array(gridW * gridH);
  let regionIndex = 0;

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const cell = y * gridW + x;
      if (visited[cell]) continue;
      visited[cell] = 1;

      const pxIdx = cell * 4;
      if (isBoundary(pxIdx)) continue;

      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;

      const regionCells: number[] = [];

      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        const cCell = cy * gridW + cx;
        regionCells.push(cCell);

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nCell = ny * gridW + nx;
          if (visited[nCell]) continue;
          visited[nCell] = 1;

          const nIdx = nCell * 4;
          if (isBoundary(nIdx)) continue;

          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      // Ignore tiny artifacts/slivers from anti-aliasing
      if (regionCells.length < 25) continue;

      const hue = (regionIndex * 67) % 360;
      const sat = 75;
      const light = 50;
      const alpha = 70; // 0-255

      // Convert HSL to RGB quickly
      const c = (1 - Math.abs((2 * light) / 100 - 1)) * (sat / 100);
      const hPrime = hue / 60;
      const xcol = c * (1 - Math.abs((hPrime % 2) - 1));
      let r1 = 0;
      let g1 = 0;
      let b1 = 0;
      if (hPrime >= 0 && hPrime < 1) [r1, g1, b1] = [c, xcol, 0];
      else if (hPrime < 2) [r1, g1, b1] = [xcol, c, 0];
      else if (hPrime < 3) [r1, g1, b1] = [0, c, xcol];
      else if (hPrime < 4) [r1, g1, b1] = [0, xcol, c];
      else if (hPrime < 5) [r1, g1, b1] = [xcol, 0, c];
      else [r1, g1, b1] = [c, 0, xcol];
      const m = light / 100 - c / 2;
      const rr = Math.round((r1 + m) * 255);
      const gg = Math.round((g1 + m) * 255);
      const bb = Math.round((b1 + m) * 255);

      for (const regionCell of regionCells) {
        const outIdx = regionCell * 4;
        outData[outIdx] = rr;
        outData[outIdx + 1] = gg;
        outData[outIdx + 2] = bb;
        outData[outIdx + 3] = alpha;
      }

      regionIndex++;
    }
  }

  octx.putImageData(outImage, 0, 0);
  return output.toDataURL("image/png");
}

export function normalizeInitiativeEntries(raw: InitiativeEntry[] | null | undefined): InitiativeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<InitiativeEntry>;
      if (typeof e.participant_id !== "string") return null;
      if (e.kind !== "player" && e.kind !== "monster") return null;
      if (typeof e.name !== "string") return null;
      if (e.roll !== null && typeof e.roll !== "number") return null;

      return {
        participant_id: e.participant_id,
        kind: e.kind,
        name: e.name,
        user_email: typeof e.user_email === "string" ? e.user_email : null,
        icon_url: typeof e.icon_url === "string" ? e.icon_url : null,
        monster_template_id:
          typeof e.monster_template_id === "string" ? e.monster_template_id : null,
        monster_snapshot:
          e.monster_snapshot && typeof e.monster_snapshot === "object"
            ? (e.monster_snapshot as MonsterSnapshot)
            : null,
        roll: typeof e.roll === "number" ? e.roll : null,
        slow_available: e.slow_available ?? true,
        fast_available: e.fast_available ?? true,
        fast_footwork_dodge_used: Boolean(e.fast_footwork_dodge_used),
        prone: e.prone ?? false,
        covered: e.covered ?? false,
        swing_weapon_item_id:
          typeof e.swing_weapon_item_id === "string" ? e.swing_weapon_item_id : null,
        swing_weapon_name: typeof e.swing_weapon_name === "string" ? e.swing_weapon_name : null,
        readied_weapon_item_id:
          typeof e.readied_weapon_item_id === "string" ? e.readied_weapon_item_id : null,
        readied_weapon_name:
          typeof e.readied_weapon_name === "string" ? e.readied_weapon_name : null,
        readied_weapon_hand:
          e.readied_weapon_hand === "left" || e.readied_weapon_hand === "right" || e.readied_weapon_hand === "both"
            ? e.readied_weapon_hand
            : null,
        readied_ammo_item:
          e.readied_ammo_item && typeof e.readied_ammo_item === "object"
            ? (e.readied_ammo_item as InventoryItem)
            : null,
        aim_target_id: typeof e.aim_target_id === "string" ? e.aim_target_id : null,
        aim_target_name: typeof e.aim_target_name === "string" ? e.aim_target_name : null,
        aim_weapon_item_id:
          typeof e.aim_weapon_item_id === "string" ? e.aim_weapon_item_id : null,
        aim_weapon_name:
          typeof e.aim_weapon_name === "string" ? e.aim_weapon_name : null,
        grappling_target_id:
          typeof e.grappling_target_id === "string" ? e.grappling_target_id : null,
        grappling_target_name:
          typeof e.grappling_target_name === "string" ? e.grappling_target_name : null,
        grappled_by_id: typeof e.grappled_by_id === "string" ? e.grappled_by_id : null,
        grappled_by_name: typeof e.grappled_by_name === "string" ? e.grappled_by_name : null,
        clinging_target_id:
          typeof e.clinging_target_id === "string" ? e.clinging_target_id : null,
        clinging_target_name:
          typeof e.clinging_target_name === "string" ? e.clinging_target_name : null,
        clung_onto_by_id: typeof e.clung_onto_by_id === "string" ? e.clung_onto_by_id : null,
        clung_onto_by_name:
          typeof e.clung_onto_by_name === "string" ? e.clung_onto_by_name : null,
        clung_onto_by_ids: Array.isArray(e.clung_onto_by_ids)
          ? e.clung_onto_by_ids.filter((v): v is string => typeof v === "string")
          : null,
        clung_onto_by_names: Array.isArray(e.clung_onto_by_names)
          ? e.clung_onto_by_names.filter((v): v is string => typeof v === "string")
          : null,
        taunted_anger_by_id:
          typeof e.taunted_anger_by_id === "string" ? e.taunted_anger_by_id : null,
        taunted_anger_by_name:
          typeof e.taunted_anger_by_name === "string" ? e.taunted_anger_by_name : null,
        taunted_distract_value:
          typeof e.taunted_distract_value === "number" ? e.taunted_distract_value : null,
        used_item_flags: Array.isArray(e.used_item_flags)
          ? e.used_item_flags.filter((v): v is string => typeof v === "string")
          : null,
        flame_intensity: typeof e.flame_intensity === "number" ? Math.max(0, Math.trunc(e.flame_intensity)) : null,
        falling_zones:
          typeof e.falling_zones === "number" ? Math.max(0, Math.trunc(e.falling_zones)) : null,
        blitzed: Boolean(e.blitzed),
        feint_pending_roll: typeof e.feint_pending_roll === "number" ? e.feint_pending_roll : null,
        feint_pending_name: typeof e.feint_pending_name === "string" ? e.feint_pending_name : null,
        dead: Boolean(e.dead),
      };
    })
    .filter(Boolean) as InitiativeEntry[];
}

export function normalizeTokenPositions(raw: TokenPosition[] | null | undefined): TokenPosition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as Partial<TokenPosition>;
      if (typeof v.character_id !== "string") return null;
      if (typeof v.x !== "number" || typeof v.y !== "number") return null;
      if (v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1) return null;
      return { character_id: v.character_id, x: v.x, y: v.y };
    })
    .filter((value): value is TokenPosition => !!value);
}

export function normalizeTokenElevations(raw: TokenElevation[] | null | undefined): TokenElevation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as Partial<TokenElevation>;
      if (typeof v.character_id !== "string" || !v.character_id.trim()) return null;
      if (typeof v.elevation !== "number" || !Number.isFinite(v.elevation)) return null;
      const elevation = Math.max(0, Math.trunc(v.elevation));
      return { character_id: v.character_id, elevation };
    })
    .filter((value): value is TokenElevation => !!value);
}

export function normalizeEngagements(raw: EngagementEdge[] | null | undefined): EngagementEdge[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as Partial<EngagementEdge>;
      if (typeof v.a !== "string" || typeof v.b !== "string") return null;
      if (!v.a || !v.b || v.a === v.b) return null;
      return v.a < v.b ? { a: v.a, b: v.b } : { a: v.b, b: v.a };
    })
    .filter((value): value is EngagementEdge => !!value);
}

export function normalizeZoneLoot(raw: ZoneLootDrop[] | null | undefined): ZoneLootDrop[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as Partial<ZoneLootDrop> & { item?: unknown };
      if (!Number.isFinite(v.zone_id)) return null;
      if (!v.item || typeof v.item !== "object") return null;
      const item = v.item as InventoryItem;
      if (typeof item.id !== "string" || !item.id.trim()) return null;
      if (typeof item.name !== "string" || !item.name.trim()) return null;
      if (typeof item.weight !== "number" || !Number.isFinite(item.weight)) return null;
      return { zone_id: Math.trunc(v.zone_id as number), item };
    })
    .filter((value): value is ZoneLootDrop => !!value);
}

export function normalizeZoneCover(raw: number[] | null | undefined): number[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.trunc(value));
  return Array.from(new Set(values));
}

export function normalizePendingReactions(raw: PendingReaction[] | null | undefined): PendingReaction[] {
  if (!Array.isArray(raw)) return [];
  const normalized: PendingReaction[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const v = value as Partial<PendingReaction>;
    if (typeof v.id !== "string" || !v.id.trim()) continue;
    if (typeof v.attackId !== "string" || !v.attackId.trim()) continue;
    if (typeof v.attackerCharacterId !== "string" || !v.attackerCharacterId.trim()) continue;
    if (typeof v.targetCharacterId !== "string" || !v.targetCharacterId.trim()) continue;
    if (typeof v.weaponName !== "string") continue;
    if (typeof v.weaponBaseDamage !== "number") continue;
    if (typeof v.totalSuccesses !== "number") continue;
    if (
      v.maneuver !== "Slash" &&
      v.maneuver !== "Stab" &&
      v.maneuver !== "Strike" &&
      v.maneuver !== "Shoot" &&
      v.maneuver !== "Grapple Attack" &&
      v.maneuver !== "Retreat" &&
      v.maneuver !== "Shove" &&
      v.maneuver !== "Disarm" &&
      v.maneuver !== "Grapple" &&
      v.maneuver !== "Cling" &&
      v.maneuver !== "Break Free" &&
      v.maneuver !== "Feint" &&
      v.maneuver !== "Coup de Grace" &&
      v.maneuver !== "Crawl"
    ) {
      continue;
    }
    normalized.push({
      id: v.id,
      attackId: v.attackId,
      attackerCharacterId: v.attackerCharacterId,
      targetCharacterId: v.targetCharacterId,
      weaponName: v.weaponName,
      weaponBaseDamage: v.weaponBaseDamage,
      maneuver: v.maneuver,
      totalSuccesses: v.totalSuccesses,
      requiredSuccesses: typeof v.requiredSuccesses === "number" ? v.requiredSuccesses : undefined,
      swingBonusDamage: typeof v.swingBonusDamage === "number" ? v.swingBonusDamage : undefined,
      disarmTargetItemId: typeof v.disarmTargetItemId === "string" ? v.disarmTargetItemId : null,
      disarmZoneId: typeof v.disarmZoneId === "number" ? v.disarmZoneId : null,
      destinationX: typeof v.destinationX === "number" ? v.destinationX : null,
      destinationY: typeof v.destinationY === "number" ? v.destinationY : null,
      shootTargetZoneId: typeof v.shootTargetZoneId === "number" ? v.shootTargetZoneId : null,
      shootAmmoItem:
        v.shootAmmoItem && typeof v.shootAmmoItem === "object" ? (v.shootAmmoItem as InventoryItem) : null,
      rangeAtAttack:
        v.rangeAtAttack === "Engaged" ||
        v.rangeAtAttack === "Near" ||
        v.rangeAtAttack === "Close" ||
        v.rangeAtAttack === "Long" ||
        v.rangeAtAttack === "Distant"
          ? v.rangeAtAttack
          : null,
      createdAt: typeof v.createdAt === "string" ? v.createdAt : null,
    });
  }
  return normalized;
}

export type ZoneRegionMap = {
  width: number;
  height: number;
  regions: Int32Array;
};

export type CombatRange = "Engaged" | "Near" | "Close" | "Long" | "Distant";

export function rangeFromZoneDistance(distance: number | null): CombatRange | null {
  if (distance === null || distance < 0 || !Number.isFinite(distance)) return null;
  if (distance === 0) return "Near";
  if (distance === 1) return "Close";
  if (distance <= 4) return "Long";
  return "Distant";
}

export function rangeFromLateralAndVerticalDistance(
  lateralDistance: number | null,
  verticalDistance: number | null
): CombatRange | null {
  if (lateralDistance === null || verticalDistance === null) return null;
  const lateral = Math.max(0, lateralDistance);
  const vertical = Math.max(0, verticalDistance);
  const effective = Math.max(lateral, vertical);
  return rangeFromZoneDistance(effective);
}

export function buildZoneRegionMap(strokes: ZoneStroke[], width = 320, height = 320): ZoneRegionMap | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeRect(0, 0, width, height);

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
    }
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const regions = new Int32Array(width * height);
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);
  const isBoundary = (cell: number) => data[cell * 4 + 3] > 100;
  let regionId = 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (regions[start] !== 0 || isBoundary(start)) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      regions[start] = regionId;

      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const cell = ny * width + nx;
          if (regions[cell] !== 0 || isBoundary(cell)) continue;
          regions[cell] = regionId;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      regionId++;
    }
  }

  return { width, height, regions };
}

export function zoneIdAtPoint(map: ZoneRegionMap | null, point: ZonePoint): number | null {
  if (!map) return null;
  const x = Math.max(0, Math.min(map.width - 1, Math.floor(point.x * map.width)));
  const y = Math.max(0, Math.min(map.height - 1, Math.floor(point.y * map.height)));
  const id = map.regions[y * map.width + x];
  return id > 0 ? id : null;
}

export function buildZoneAdjacency(map: ZoneRegionMap | null): Map<number, Set<number>> {
  const adjacency = new Map<number, Set<number>>();
  if (!map) return adjacency;

  const ensure = (id: number) => {
    if (!adjacency.has(id)) adjacency.set(id, new Set<number>());
    return adjacency.get(id)!;
  };

  // Zones are separated by drawn boundary strokes (several pixels wide), so
  // adjacency must look across a small pixel gap rather than only direct neighbors.
  const maxGap = 4;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const current = map.regions[y * map.width + x];
      if (current <= 0) continue;
      ensure(current);

      for (let d = 1; d <= maxGap; d++) {
        if (x + d < map.width) {
          const right = map.regions[y * map.width + (x + d)];
          if (right > 0 && right !== current) {
            ensure(current).add(right);
            ensure(right).add(current);
            break;
          }
        }
      }

      for (let d = 1; d <= maxGap; d++) {
        if (y + d < map.height) {
          const down = map.regions[(y + d) * map.width + x];
          if (down > 0 && down !== current) {
            ensure(current).add(down);
            ensure(down).add(current);
            break;
          }
        }
      }
    }
  }

  return adjacency;
}

export function shortestZoneDistance(
  fromZone: number,
  toZone: number,
  adjacency: Map<number, Set<number>>
): number | null {
  if (fromZone === toZone) return 0;
  const visited = new Set<number>([fromZone]);
  const queue: Array<{ zone: number; dist: number }> = [{ zone: fromZone, dist: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current.zone);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      const nextDist = current.dist + 1;
      if (neighbor === toZone) return nextDist;
      visited.add(neighbor);
      queue.push({ zone: neighbor, dist: nextDist });
    }
  }

  return null;
}

export function areTokensEngaged(actorTokenId: string, targetTokenId: string, edges: EngagementEdge[]): boolean {
  if (actorTokenId === targetTokenId) return false;
  const visited = new Set<string>([actorTokenId]);
  const queue: string[] = [actorTokenId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const neighbor =
        edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (!neighbor || visited.has(neighbor)) continue;
      if (neighbor === targetTokenId) return true;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return false;
}

export function weaponSupportsRange(rangeBand: string | undefined, range: CombatRange): boolean {
  const normalized = (rangeBand || "").trim().toLowerCase();
  if (normalized === "engaged") return range === "Engaged";
  if (normalized === "near") return range === "Engaged" || range === "Near";
  if (normalized === "close" || normalized === "short") {
    return range === "Engaged" || range === "Near" || range === "Close";
  }
  if (normalized === "long") {
    return range === "Engaged" || range === "Near" || range === "Close" || range === "Long";
  }
  if (normalized === "distant") {
    return (
      range === "Engaged" ||
      range === "Near" ||
      range === "Close" ||
      range === "Long" ||
      range === "Distant"
    );
  }
  return false;
}

export function tokenSideOf(tokenId: string): TokenSide {
  return tokenId.startsWith("monster:") ? "monster" : "player";
}

export function getPhysicalBrokenAttributes(attributes: {
  STR?: number | null;
  AGL?: number | null;
} | null | undefined): string[] {
  if (!attributes) return [];
  const broken: string[] = [];
  if ((attributes.STR ?? 0) <= 0) broken.push("STR");
  if ((attributes.AGL ?? 0) <= 0) broken.push("AGL");
  return broken;
}

export function getMentalBrokenAttributes(attributes: {
  WIT?: number | null;
  EMP?: number | null;
} | null | undefined): string[] {
  if (!attributes) return [];
  const broken: string[] = [];
  if ((attributes.WIT ?? 0) <= 0) broken.push("WIT");
  if ((attributes.EMP ?? 0) <= 0) broken.push("EMP");
  return broken;
}

export function rollD6Pool(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => Math.floor(Math.random() * 6) + 1);
}

export function formatCharacterTooltip(character: CharacterLite, flags: string[] = []): string {
  const attrs = character.attributes || { STR: 0, AGL: 0, WIT: 0, EMP: 0 };
  const flagsLine = flags.length > 0 ? `Flags: ${flags.join(", ")}` : "Flags: None";
  return [
    character.name,
    `STR ${attrs.STR} | AGL ${attrs.AGL} | WIT ${attrs.WIT} | EMP ${attrs.EMP}`,
    `Spirit: ${character.spirits ?? 0}`,
    flagsLine,
  ].join("\n");
}

export function formatMonsterPublicTooltip(
  name: string,
  snapshot: MonsterSnapshot | null | undefined,
  flags: string[] = []
): string {
  if (!snapshot) return name;
  const slots = snapshot.equipment_slots || {
    armor: null,
    helmet: null,
    left: null,
    right: null,
  };
  const equipped = [
    slots.helmet ? `Helmet: ${slots.helmet}` : null,
    slots.armor ? `Armor: ${slots.armor}` : null,
    slots.left ? `Left: ${slots.left}` : null,
    slots.right ? `Right: ${slots.right}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const flagsLine = flags.length > 0 ? `Flags: ${flags.join(", ")}` : "Flags: None";
  return [name, `Equipped: ${equipped || "None"}`, flagsLine].join("\n");
}

export function slotMatchesItem(slotValue: string | null | undefined, item: { id?: string; name?: string }): boolean {
  if (!slotValue) return false;
  return slotValue === item.id || slotValue === item.name;
}

export function monsterEquippedMeleeWeapons(snapshot: MonsterSnapshot): Array<{
  id: string;
  name: string;
  damage: number;
  gearBonus: number;
  wield?: "1H" | "2H";
  rangeBand?: string;
  properties: string[];
}> {
  const slots = snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null };
  const gear = snapshot.gear || [];
  return gear
    .filter((item) => item.item_type === "Melee Weapon")
    .filter((item) => slotMatchesItem(slots.left, item) || slotMatchesItem(slots.right, item))
    .map((item) => ({
      id: item.id,
      name: item.name,
      damage: Math.max(0, item.damage ?? 0),
      gearBonus: Math.max(0, item.gearBonus ?? 0),
      wield: item.wield,
      rangeBand: item.range_band,
      properties: (item.properties || []).map((p) => p.toLowerCase()),
    }));
}

export function monsterEquippedShields(snapshot: MonsterSnapshot): Array<{
  id: string;
  name: string;
  gearBonus: number;
}> {
  const slots = snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null };
  const gear = snapshot.gear || [];
  return gear
    .filter((item) => item.item_type === "Shield")
    .filter((item) => slotMatchesItem(slots.left, item) || slotMatchesItem(slots.right, item))
    .map((item) => ({
      id: item.id,
      name: item.name,
      gearBonus: Math.max(0, item.gearBonus ?? 0),
    }));
}

export function playerHeldItems(character: CharacterLite | CharacterType | null | undefined): InventoryItem[] {
  if (!character) return [];
  const slots = character.equipment_slots || { left: null, right: null, armor: null, helmet: null };
  const inventory = character.inventory || [];
  const held = inventory.filter(
    (item) => slotMatchesItem(slots.left, item) || slotMatchesItem(slots.right, item)
  );
  const seen = new Set<string>();
  return held.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function playerEquippedMeleeWeapons(character: CharacterLite | CharacterType | null | undefined): Array<{
  id: string;
  name: string;
  rangeBand?: string;
  wield?: "1H" | "2H";
  gearBonus: number;
}> {
  return playerHeldItems(character)
    .filter((item) => item.item_type === "Melee Weapon")
    .map((item) => ({
      id: item.id,
      name: item.name,
      rangeBand: item.range_band,
      wield: item.wield,
      gearBonus: Math.max(0, item.gearBonus ?? 0),
    }));
}

export function isParryingWeapon(item: InventoryItem): boolean {
  if (item.item_type !== "Melee Weapon") return false;
  const props = Array.isArray(item.properties) ? item.properties : [];
  return props.some((prop) => String(prop).trim().toLowerCase() === "parrying");
}

export function playerEquippedRangedWeapons(character: CharacterLite | CharacterType | null | undefined): InventoryItem[] {
  return playerHeldItems(character).filter((item) => item.item_type === "Ranged Weapon");
}

export function monsterEquippedRangedWeapons(snapshot: MonsterSnapshot): InventoryItem[] {
  const slots = snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null };
  const gear = snapshot.gear || [];
  return gear.filter(
    (item) =>
      item.item_type === "Ranged Weapon" &&
      (slotMatchesItem(slots.left, item) || slotMatchesItem(slots.right, item))
  );
}

export function isAmmunition(item: InventoryItem): boolean {
  return (item.item_type || "").toLowerCase() === "ammunition";
}

export function readiedHandForWeapon(
  slots: { left?: string | null; right?: string | null } | null | undefined,
  weapon: { id: string; name: string }
): "left" | "right" | "both" | null {
  const left = slots?.left || null;
  const right = slots?.right || null;
  const inLeft = left === weapon.id || left === weapon.name;
  const inRight = right === weapon.id || right === weapon.name;
  if (inLeft && inRight) return "both";
  if (inLeft) return "left";
  if (inRight) return "right";
  return null;
}

export function cloneAmmoUnit(item: InventoryItem): InventoryItem {
  return {
    ...item,
    id: `ammo:${crypto.randomUUID()}`,
    quantity: 1,
  };
}

export function consumeFirstAmmo(items: InventoryItem[]): { nextItems: InventoryItem[]; ammo: InventoryItem | null } {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isAmmunition(item)) continue;
    const qty = Math.max(1, item.quantity || 1);
    const ammo = cloneAmmoUnit(item);
    if (qty <= 1) {
      return {
        nextItems: [...items.slice(0, i), ...items.slice(i + 1)],
        ammo,
      };
    }
    const nextItems = [...items];
    nextItems[i] = { ...item, quantity: qty - 1 };
    return { nextItems, ammo };
  }
  return { nextItems: items, ammo: null };
}

export function cycleMonsterDrawGear(snapshot: MonsterSnapshot): MonsterSnapshot {
  const slots = snapshot.equipment_slots || { armor: null, helmet: null, left: null, right: null };
  const equipable = (snapshot.gear || []).filter((item) =>
    item.item_type === "Armor" || item.item_type === "Helmet" || item.wield === "1H" || item.wield === "2H"
  );
  const equippedIds = new Set<string>(
    equipable
      .filter((item) =>
        slotMatchesItem(slots.armor, item) ||
        slotMatchesItem(slots.helmet, item) ||
        slotMatchesItem(slots.left, item) ||
        slotMatchesItem(slots.right, item)
      )
      .map((item) => item.id)
  );
  const stowed = equipable.filter((item) => !equippedIds.has(item.id));
  if (stowed.length === 0) return snapshot;

  const item = stowed[0];
  const nextSlots = { ...slots };

  if (item.item_type === "Armor") {
    nextSlots.armor = item.name;
  } else if (item.item_type === "Helmet") {
    nextSlots.helmet = item.name;
  } else if (item.wield === "2H") {
    nextSlots.left = item.name;
    nextSlots.right = item.name;
  } else if (item.wield === "1H") {
    const twoHandedOccupied = Boolean(nextSlots.left && nextSlots.right && nextSlots.left === nextSlots.right);
    if (twoHandedOccupied) {
      nextSlots.left = null;
      nextSlots.right = null;
    }
    if (!nextSlots.left) nextSlots.left = item.name;
    else if (!nextSlots.right) nextSlots.right = item.name;
    else nextSlots.left = item.name;
  }

  return {
    ...snapshot,
    equipment_slots: nextSlots,
  };
}
