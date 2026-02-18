"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CharacterType, InventoryItem, PendingMeleeAction, ResolvedMeleeAttack } from "@/app/protected/page";
import { isImplementedItem, normalizeInventoryItems } from "@/lib/item-catalog";
import {
  buildMonsterSnapshot,
  formatMonsterTooltip,
  MonsterSnapshot,
  MonsterTemplate,
} from "@/lib/monsters";

type CombatProps = {
  isDM: boolean;
  userEmail: string | null;
  onRequestDrawGear?: () => void;
  character: CharacterType | null;
  onQueueMeleeAction?: (action: PendingMeleeAction) => void;
  onResolveMeleeAttack?: (attack: ResolvedMeleeAttack) => void | Promise<void>;
};

type ZonePoint = {
  x: number;
  y: number;
};

type ZoneStroke = {
  points: ZonePoint[];
};

type LegacyZoneLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type InitiativeMonster = {
  id: string;
  name: string;
  template_id: string | null;
  icon_url: string | null;
  monster_snapshot: MonsterSnapshot | null;
};

type InitiativeEntry = {
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
  prone?: boolean;
  swing_weapon_item_id?: string | null;
  swing_weapon_name?: string | null;
  grappling_target_id?: string | null;
  grappling_target_name?: string | null;
  grappled_by_id?: string | null;
  grappled_by_name?: string | null;
  clinging_target_id?: string | null;
  clinging_target_name?: string | null;
  clung_onto_by_id?: string | null;
  clung_onto_by_name?: string | null;
};

type CharacterLite = {
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
  inventory?: CharacterType["inventory"];
  equipment_slots?: CharacterType["equipment_slots"];
  max_attributes?: CharacterType["max_attributes"];
  skills?: CharacterType["skills"];
};

type ZoneLootDrop = {
  zone_id: number;
  item: InventoryItem;
};

type CombatStateRow = {
  id: number;
  map_url: string | null;
  zone_lines: (ZoneStroke | LegacyZoneLine)[] | null;
  token_positions: TokenPosition[] | null;
  engagements: EngagementEdge[] | null;
  combat_mode: boolean | null;
  initiative_monsters: InitiativeMonster[] | null;
  initiative_entries: InitiativeEntry[] | null;
  initiative_current_index: number | null;
  zone_loot: ZoneLootDrop[] | null;
  updated_by_email: string | null;
  updated_at: string;
};

type TokenPosition = {
  character_id: string;
  x: number;
  y: number;
};

type RenderedToken = TokenPosition & {
  type: "player" | "monster";
  name: string;
  email: string | null;
  icon_url: string | null;
  tooltip: string;
};

type EngagementEdge = {
  a: string;
  b: string;
};

type ImageRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};
type MonsterRollResult = {
  actionLabel: string;
  attributeDice: number[];
  skillDice: number[];
  skillIsNegative?: boolean;
  gearDice: number[];
  successes: number;
};

const MAP_BUCKET = "combat-assets";
const DM_EMAIL = "drocasma9@gmail.com";
type TokenSide = "player" | "monster";

const normalizeEmail = (value: string | null | undefined): string =>
  (value || "").trim().toLowerCase();

function isLegacyLine(value: unknown): value is LegacyZoneLine {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x1 === "number" &&
    typeof v.y1 === "number" &&
    typeof v.x2 === "number" &&
    typeof v.y2 === "number"
  );
}

function isStroke(value: unknown): value is ZoneStroke {
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

function normalizeZoneLines(raw: (ZoneStroke | LegacyZoneLine)[] | null | undefined): ZoneStroke[] {
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

function rollUnique(set: Set<string>): number {
  const base = Math.floor(Math.random() * 10);
  let frac = "";
  let key = `${base}`;

  while (set.has(key)) {
    frac += `${Math.floor(Math.random() * 10)}`;
    key = `${base}.${frac}`;
  }

  set.add(key);
  return Number(key);
}

function formatRoll(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text;
}

function rollSortValue(value: number | null): number {
  return value ?? -1;
}

function buildZoneTintDataUrl(strokes: ZoneStroke[], gridW = 320, gridH = 320): string | null {
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

function normalizeInitiativeEntries(raw: InitiativeEntry[] | null | undefined): InitiativeEntry[] {
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
        prone: e.prone ?? false,
        swing_weapon_item_id:
          typeof e.swing_weapon_item_id === "string" ? e.swing_weapon_item_id : null,
        swing_weapon_name: typeof e.swing_weapon_name === "string" ? e.swing_weapon_name : null,
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
      };
    })
    .filter(Boolean) as InitiativeEntry[];
}

function normalizeTokenPositions(raw: TokenPosition[] | null | undefined): TokenPosition[] {
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

function normalizeEngagements(raw: EngagementEdge[] | null | undefined): EngagementEdge[] {
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

function normalizeZoneLoot(raw: ZoneLootDrop[] | null | undefined): ZoneLootDrop[] {
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

type ZoneRegionMap = {
  width: number;
  height: number;
  regions: Int32Array;
};

type CombatRange = "Engaged" | "Near" | "Close" | "Long" | "Distant";

function buildZoneRegionMap(strokes: ZoneStroke[], width = 320, height = 320): ZoneRegionMap | null {
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

function zoneIdAtPoint(map: ZoneRegionMap | null, point: ZonePoint): number | null {
  if (!map) return null;
  const x = Math.max(0, Math.min(map.width - 1, Math.floor(point.x * map.width)));
  const y = Math.max(0, Math.min(map.height - 1, Math.floor(point.y * map.height)));
  const id = map.regions[y * map.width + x];
  return id > 0 ? id : null;
}

function buildZoneAdjacency(map: ZoneRegionMap | null): Map<number, Set<number>> {
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

function shortestZoneDistance(
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

function areTokensEngaged(actorTokenId: string, targetTokenId: string, edges: EngagementEdge[]): boolean {
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

function weaponSupportsRange(rangeBand: string | undefined, range: CombatRange): boolean {
  const normalized = (rangeBand || "").trim().toLowerCase();
  if (normalized === "engaged") return range === "Engaged";
  if (normalized === "near") return range === "Engaged" || range === "Near";
  if (normalized === "close" || normalized === "short") {
    return range === "Engaged" || range === "Near" || range === "Close";
  }
  if (normalized === "long") {
    return range === "Engaged" || range === "Near" || range === "Close" || range === "Long";
  }
  return false;
}

function tokenSideOf(tokenId: string): TokenSide {
  return tokenId.startsWith("monster:") ? "monster" : "player";
}

function rollD6Pool(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => Math.floor(Math.random() * 6) + 1);
}

function formatCharacterTooltip(character: CharacterLite, flags: string[] = []): string {
  const attrs = character.attributes || { STR: 0, AGL: 0, WIT: 0, EMP: 0 };
  const flagsLine = flags.length > 0 ? `Flags: ${flags.join(", ")}` : "Flags: None";
  return [
    character.name,
    `STR ${attrs.STR} | AGL ${attrs.AGL} | WIT ${attrs.WIT} | EMP ${attrs.EMP}`,
    `Spirit: ${character.spirits ?? 0}`,
    flagsLine,
  ].join("\n");
}

function formatMonsterPublicTooltip(
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

function slotMatchesItem(slotValue: string | null | undefined, item: { id?: string; name?: string }): boolean {
  if (!slotValue) return false;
  return slotValue === item.id || slotValue === item.name;
}

function monsterEquippedMeleeWeapons(snapshot: MonsterSnapshot): Array<{
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

function monsterEquippedShields(snapshot: MonsterSnapshot): Array<{
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

function playerHeldItems(character: CharacterLite | CharacterType | null | undefined): InventoryItem[] {
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

function playerEquippedMeleeWeapons(character: CharacterLite | CharacterType | null | undefined): Array<{
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

function cycleMonsterDrawGear(snapshot: MonsterSnapshot): MonsterSnapshot {
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

export default function Combat({
  isDM,
  userEmail,
  onRequestDrawGear,
  character,
  onQueueMeleeAction,
  onResolveMeleeAttack,
}: CombatProps) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [zoneLines, setZoneLines] = useState<ZoneStroke[]>([]);
  const [tokenPositions, setTokenPositions] = useState<TokenPosition[]>([]);
  const [engagements, setEngagements] = useState<EngagementEdge[]>([]);
  const [combatMode, setCombatMode] = useState(false);
  const [initiativeMonsters, setInitiativeMonsters] = useState<InitiativeMonster[]>([]);
  const [monsterTemplates, setMonsterTemplates] = useState<MonsterTemplate[]>([]);
  const [deployMonsterQuery, setDeployMonsterQuery] = useState("");
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeCurrentIndex, setInitiativeCurrentIndex] = useState<number | null>(null);
  const [zoneLoot, setZoneLoot] = useState<ZoneLootDrop[]>([]);
  const [zoneHoverInfo, setZoneHoverInfo] = useState<{ x: number; y: number; zoneId: number; items: InventoryItem[] } | null>(null);
  const [characters, setCharacters] = useState<CharacterLite[]>([]);
  const [monsterNameDrafts, setMonsterNameDrafts] = useState<Record<string, string>>({});
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedZoneTarget, setSelectedZoneTarget] = useState<{ zoneId: number; point: ZonePoint } | null>(null);
  const [monsterRollResult, setMonsterRollResult] = useState<MonsterRollResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftLine, setDraftLine] = useState<ZoneStroke | null>(null);
  const [showZoneTint, setShowZoneTint] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageNatural, setImageNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const isSyncingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const draggedTokenRef = useRef<string | null>(null);

  const isDmUser = isDM && userEmail === DM_EMAIL;
  const canDraw = isDmUser && !!mapUrl && !!imageRect;
  const playerEntries = useMemo<InitiativeEntry[]>(
    () =>
      characters.map((player) => ({
        participant_id: `player:${player.id}`,
        kind: "player",
        name: player.name,
        user_email: player.email,
        icon_url: player.icon_url,
        roll: null,
        slow_available: true,
        fast_available: true,
      })),
    [characters]
  );
  const preRollMonsterEntries = useMemo<InitiativeEntry[]>(
    () =>
      initiativeMonsters.map((monster) => ({
        participant_id: monster.id,
        kind: "monster",
        name: monster.name,
        user_email: null,
        icon_url: monster.icon_url,
        monster_template_id: monster.template_id,
        monster_snapshot: monster.monster_snapshot,
        roll: null,
        slow_available: true,
        fast_available: true,
      })),
    [initiativeMonsters]
  );
  const displayedInitiativeEntries = useMemo(
    () => (initiativeEntries.length > 0 ? initiativeEntries : [...playerEntries, ...preRollMonsterEntries]),
    [initiativeEntries, playerEntries, preRollMonsterEntries]
  );
  const currentEntry =
    initiativeCurrentIndex !== null &&
    initiativeCurrentIndex >= 0 &&
    initiativeCurrentIndex < displayedInitiativeEntries.length
      ? displayedInitiativeEntries[initiativeCurrentIndex]
      : null;
  const actorCharacter =
    currentEntry?.kind === "player" && currentEntry.user_email
      ? characters.find((char) => normalizeEmail(char.email) === normalizeEmail(currentEntry.user_email)) || null
      : null;
  const monsterByParticipantId = useMemo(() => {
    const map = new Map<string, InitiativeMonster>();
    for (const monster of initiativeMonsters) {
      map.set(monster.id, monster);
    }
    return map;
  }, [initiativeMonsters]);
  const selectedTokenCharacter =
    selectedTokenId ? characters.find((char) => char.id === selectedTokenId) || null : null;
  const selectedTokenMonster = selectedTokenId ? monsterByParticipantId.get(selectedTokenId) || null : null;
  const selectedZoneLootItems = useMemo(
    () =>
      selectedZoneTarget
        ? zoneLoot
            .filter((drop) => drop.zone_id === selectedZoneTarget.zoneId)
            .map((drop) => drop.item)
        : [],
    [selectedZoneTarget, zoneLoot]
  );
  const zoneRegionMap = useMemo(() => buildZoneRegionMap(zoneLines), [zoneLines]);
  const zoneAdjacency = useMemo(() => buildZoneAdjacency(zoneRegionMap), [zoneRegionMap]);
  const tokenByCharacterId = useMemo(() => {
    const map = new Map<string, TokenPosition>();
    for (const token of tokenPositions) {
      map.set(token.character_id, token);
    }
    return map;
  }, [tokenPositions]);
  const actorTokenId = useMemo(() => {
    if (!currentEntry) return null;
    if (currentEntry.kind === "monster") return currentEntry.participant_id;
    return actorCharacter?.id ?? null;
  }, [currentEntry, actorCharacter]);
  const actorTokenCharacter = actorTokenId ? characters.find((char) => char.id === actorTokenId) || null : null;
  const isActorEngaged = useMemo(() => {
    if (!actorTokenId) return false;
    return engagements.some((edge) => edge.a === actorTokenId || edge.b === actorTokenId);
  }, [engagements, actorTokenId]);
  const isActorEnemyEngaged = useMemo(() => {
    if (!actorTokenId) return false;
    const actorSide = tokenSideOf(actorTokenId);
    return engagements.some((edge) => {
      const otherTokenId = edge.a === actorTokenId ? edge.b : edge.b === actorTokenId ? edge.a : null;
      if (!otherTokenId) return false;
      return tokenSideOf(otherTokenId) !== actorSide;
    });
  }, [engagements, actorTokenId]);
  const isActorProne = Boolean(currentEntry?.prone);
  const actorGrapplingTargetId = currentEntry?.grappling_target_id ?? null;
  const actorGrappledById = currentEntry?.grappled_by_id ?? null;
  const actorClingingTargetId = currentEntry?.clinging_target_id ?? null;
  const actorClungOntoById = currentEntry?.clung_onto_by_id ?? null;
  const isActorGrappling = Boolean(actorGrapplingTargetId);
  const isActorGrappled = Boolean(actorGrappledById);
  const isActorClinging = Boolean(actorClingingTargetId);
  const isActorClungOnto = Boolean(actorClungOntoById);
  const actorHardLockedByHold = isActorGrappling || isActorGrappled || isActorClinging;
  const actorHoldCounterpartId =
    actorGrapplingTargetId || actorGrappledById || actorClingingTargetId || actorClungOntoById || null;
  const selectedIsActorOrHoldCounterpart = useMemo(() => {
    if (!selectedTokenId || !actorTokenId) return false;
    if (selectedTokenId === actorTokenId) return true;
    if (!actorHoldCounterpartId) return false;
    return selectedTokenId === actorHoldCounterpartId;
  }, [selectedTokenId, actorTokenId, actorHoldCounterpartId]);
  const actorSize = useMemo(() => {
    if (!currentEntry) return 1;
    if (currentEntry.kind === "monster") {
      return Math.trunc(currentEntry.monster_snapshot?.size ?? 1);
    }
    return 1;
  }, [currentEntry]);
  const selectedTargetSize = useMemo(() => {
    if (!selectedTokenId) return null;
    if (selectedTokenId.startsWith("monster:")) {
      return Math.trunc(monsterByParticipantId.get(selectedTokenId)?.monster_snapshot?.size ?? 1);
    }
    return 1;
  }, [selectedTokenId, monsterByParticipantId]);

  const zoneTintUrl = useMemo(() => {
    if (!isDmUser || !showZoneTint) return null;
    const strokes = draftLine ? [...zoneLines, draftLine] : zoneLines;
    if (strokes.length === 0) return null;
    return buildZoneTintDataUrl(strokes);
  }, [draftLine, isDmUser, showZoneTint, zoneLines]);

  const canPlaceTokenFor = useCallback(
    (characterEmail: string | null) => {
      if (!userEmail) return false;
      if (isDmUser) return true;
      return !!characterEmail && characterEmail === userEmail;
    },
    [isDmUser, userEmail]
  );

  const renderedTokens = useMemo<RenderedToken[]>(
    () =>
      tokenPositions
        .map((pos): RenderedToken | null => {
          const entry = initiativeEntries.find(
            (e) => e.participant_id === pos.character_id || e.participant_id === `player:${pos.character_id}`
          );
          const flags: string[] = [];
          if (entry?.prone) {
            flags.push("Prone");
          }
          if (entry?.swing_weapon_name) {
            flags.push(`Swinging (${entry.swing_weapon_name})`);
          }
          if (entry?.grappling_target_name) {
            flags.push(`Grappling (${entry.grappling_target_name})`);
          }
          if (entry?.grappled_by_name) {
            flags.push(`Grappled (${entry.grappled_by_name})`);
          }
          if (entry?.clinging_target_name) {
            flags.push(`Clinging (${entry.clinging_target_name})`);
          }
          if (entry?.clung_onto_by_name) {
            flags.push(`Clung Onto (${entry.clung_onto_by_name})`);
          }

          const character = characters.find((char) => char.id === pos.character_id);
          if (character) {
            return {
              ...pos,
              type: "player" as const,
              name: character.name,
              email: character.email,
              icon_url: character.icon_url,
              tooltip: formatCharacterTooltip(character, flags),
            };
          }

          const monster = monsterByParticipantId.get(pos.character_id);
          if (monster) {
            const tooltip =
              isDmUser && monster.monster_snapshot
                ? formatMonsterTooltip(monster.monster_snapshot) + `\n${flags.length > 0 ? `Flags: ${flags.join(", ")}` : "Flags: None"}`
                : formatMonsterPublicTooltip(monster.name, monster.monster_snapshot, flags);
            return {
              ...pos,
              type: "monster" as const,
              name: monster.name,
              email: null,
              icon_url: monster.icon_url,
              tooltip,
            };
          }
          return null;
        })
        .filter((value): value is RenderedToken => value !== null),
    [tokenPositions, characters, isDmUser, monsterByParticipantId, initiativeEntries]
  );
  const draggableTokenCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const token of renderedTokens) {
      const entry = initiativeEntries.find(
        (e) => e.participant_id === token.character_id || e.participant_id === `player:${token.character_id}`
      );
      if (entry?.clinging_target_id) {
        continue;
      }
      if (token.type === "monster" && isDmUser) {
        ids.add(token.character_id);
      } else if (token.type === "player" && canPlaceTokenFor(token.email)) {
        ids.add(token.character_id);
      }
    }
    return ids;
  }, [renderedTokens, canPlaceTokenFor, isDmUser, initiativeEntries]);

  const canPass = useMemo(() => {
    if (!currentEntry || !userEmail) return false;
    if (isDmUser) return true;
    return normalizeEmail(currentEntry.user_email) === normalizeEmail(userEmail);
  }, [currentEntry, userEmail, isDmUser]);
  const isMyTurn = useMemo(() => {
    if (!currentEntry || !userEmail) return false;
    if (isDmUser) return true;
    return normalizeEmail(currentEntry.user_email) === normalizeEmail(userEmail);
  }, [currentEntry, isDmUser, userEmail]);
  const canUseDrawGearFromToken = useMemo(() => {
    if (!combatMode || !selectedTokenId || !currentEntry) return false;
    if (!actorTokenId || selectedTokenId !== actorTokenId) return false;
    if (!isMyTurn) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (currentEntry.kind === "monster" && !isDmUser) return false;
    if (
      currentEntry.kind === "player" &&
      !isDmUser &&
      (!selectedTokenCharacter || !userEmail || normalizeEmail(selectedTokenCharacter.email) !== normalizeEmail(userEmail))
    ) {
      return false;
    }
    return !!(currentEntry?.fast_available || currentEntry?.slow_available);
  }, [combatMode, selectedTokenId, actorTokenId, currentEntry, isMyTurn, isDmUser, selectedTokenCharacter, userEmail, isActorProne, actorHardLockedByHold]);
  const isSelectedSelf = useMemo(() => {
    if (!selectedTokenId || !actorTokenId) return false;
    return selectedTokenId === actorTokenId;
  }, [selectedTokenId, actorTokenId]);
  const currentSwing = useMemo(
    () =>
      currentEntry?.swing_weapon_item_id
        ? {
            weaponItemId: currentEntry.swing_weapon_item_id,
            weaponName: currentEntry.swing_weapon_name ?? "Weapon",
          }
        : null,
    [currentEntry]
  );
  const canUseEngageFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId) return false;
    if (selectedTokenId === actorTokenId) return false;
    if (!isMyTurn) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (isActorEngaged) return false;

    const actorToken = tokenByCharacterId.get(actorTokenId);
    const targetToken = tokenByCharacterId.get(selectedTokenId);
    if (!actorToken || !targetToken) return false;

    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
    return actorZone !== null && targetZone !== null && actorZone === targetZone;
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, isActorEngaged, tokenByCharacterId, zoneRegionMap, isActorProne, actorHardLockedByHold]);
  const canUseRunFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedZoneTarget || !isMyTurn) return false;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (isActorEnemyEngaged) return false;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return false;
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (actorZone === null) return false;
    if (actorZone === selectedZoneTarget.zoneId) return false;
    const distance = shortestZoneDistance(actorZone, selectedZoneTarget.zoneId, zoneAdjacency);
    return distance === 1;
  }, [combatMode, actorTokenId, selectedZoneTarget, currentEntry, isMyTurn, isActorEnemyEngaged, tokenByCharacterId, zoneRegionMap, zoneAdjacency, isActorProne, actorHardLockedByHold]);
  const canUseRetreatFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId || !isMyTurn) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (!isActorEnemyEngaged) return false;
    if (selectedTokenId === actorTokenId) return true;
    return areTokensEngaged(actorTokenId, selectedTokenId, engagements);
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, currentEntry, isActorEnemyEngaged, engagements, isActorProne, actorHardLockedByHold]);
  const canUseGetUpFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId || !isMyTurn) return false;
    if (!isActorProne) return false;
    if (isActorGrappling || isActorClinging || isActorGrappled) return false;
    if (selectedTokenId !== actorTokenId) return false;
    return !!(currentEntry?.fast_available || currentEntry?.slow_available);
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, isActorProne, currentEntry, isActorGrappling, isActorClinging, isActorGrappled]);

  const swingWeaponOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf) return [] as Array<{ id: string; name: string }>;
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
    if (isActorProne || actorHardLockedByHold) return [];

    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character || actorCharacter.id !== character.id) return [];
      const slots = character.equipment_slots || { left: null, right: null };
      const slotIds = new Set<string>();
      if (slots.left) slotIds.add(slots.left);
      if (slots.right) slotIds.add(slots.right);
      return (character.inventory || [])
        .filter((item) => slotIds.has(item.id))
        .filter((item) => item.item_type === "Melee Weapon" && item.wield === "2H")
        .map((item) => ({ id: item.id, name: item.name }));
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    if (!actorMonster?.monster_snapshot) return [];
    return monsterEquippedMeleeWeapons(actorMonster.monster_snapshot)
      .filter((weapon) => weapon.wield === "2H")
      .map((weapon) => ({ id: weapon.id, name: weapon.name }));
  }, [combatMode, currentEntry, isMyTurn, isSelectedSelf, actorCharacter, character, actorTokenId, monsterByParticipantId, isActorProne, actorHardLockedByHold]);

  useEffect(() => {
    setMonsterRollResult(null);
  }, [selectedTokenId, selectedZoneTarget?.zoneId, currentEntry?.participant_id]);

  const selectedRange = useMemo<CombatRange | null>(() => {
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return null;
    if (areTokensEngaged(actorTokenId, selectedTokenId, engagements)) return "Engaged";

    const actorToken = tokenByCharacterId.get(actorTokenId);
    const targetToken = tokenByCharacterId.get(selectedTokenId);
    if (!actorToken || !targetToken) return null;

    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
    if (actorZone === null || targetZone === null) return null;

    const distance = shortestZoneDistance(actorZone, targetZone, zoneAdjacency);
    if (distance === null) return null;
    if (distance === 0) return "Near";
    if (distance === 1) return "Close";
    if (distance <= 3) return "Long";
    return "Distant";
  }, [actorTokenId, selectedTokenId, engagements, tokenByCharacterId, zoneRegionMap, zoneAdjacency]);

  const actorHasOccupiedHands = useMemo(() => {
    if (!currentEntry) return false;
    if (currentEntry.kind === "player") {
      const actor = actorTokenCharacter;
      if (!actor) return false;
      const slots = actor.equipment_slots || { left: null, right: null };
      return Boolean(slots.left || slots.right);
    }
    const slots = currentEntry.monster_snapshot?.equipment_slots || {
      left: null,
      right: null,
      armor: null,
      helmet: null,
    };
    return Boolean(slots.left || slots.right);
  }, [currentEntry, actorTokenCharacter]);

  const canUseGrappleFromSelection = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !currentEntry.slow_available) return false;
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return false;
    if (actorHardLockedByHold || isActorProne) return false;
    if (actorHasOccupiedHands) return false;
    if (selectedRange !== "Engaged") return false;
    const targetSize = selectedTargetSize;
    if (targetSize === null) return false;
    return actorSize >= targetSize;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    actorTokenId,
    selectedTokenId,
    actorHardLockedByHold,
    isActorProne,
    actorHasOccupiedHands,
    selectedRange,
    selectedTargetSize,
    actorSize,
  ]);

  const canUseClingFromSelection = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !currentEntry.slow_available) return false;
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return false;
    if (actorHardLockedByHold || isActorProne) return false;
    if (actorHasOccupiedHands) return false;
    if (selectedRange !== "Engaged") return false;
    const targetSize = selectedTargetSize;
    if (targetSize === null) return false;
    return targetSize > actorSize;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    actorTokenId,
    selectedTokenId,
    actorHardLockedByHold,
    isActorProne,
    actorHasOccupiedHands,
    selectedRange,
    selectedTargetSize,
    actorSize,
  ]);

  const canUseRelease = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId) return false;
    if (!(isActorGrappling || isActorClinging)) return false;
    return selectedIsActorOrHoldCounterpart;
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, isActorGrappling, isActorClinging, selectedIsActorOrHoldCounterpart]);

  const canUseBreakFree = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId) return false;
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return false;
    if (!(isActorGrappled || isActorClungOnto)) return false;
    return selectedIsActorOrHoldCounterpart;
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, isActorGrappled, isActorClungOnto, selectedIsActorOrHoldCounterpart]);

  const meleeActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || (isActorProne && !actorHardLockedByHold)) {
      return [] as Array<{
        maneuver: "Slash" | "Stab" | "Strike" | "Grapple Attack";
        weaponItemId?: string | null;
        weaponName: string;
        weaponBaseDamage: number;
        gearDice: number;
      }>;
    }
    if (!selectedTokenId || !selectedRange) return [];
    if (selectedTokenId === actorTokenId) return [];

    if (actorHardLockedByHold) {
      if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
      if (!(isActorGrappling || isActorClinging)) return [];
      if (!actorHoldCounterpartId || selectedTokenId !== actorHoldCounterpartId) return [];
      return [
        {
          maneuver: "Grapple Attack" as const,
          weaponItemId: null,
          weaponName: "Grapple Attack",
          weaponBaseDamage: 1,
          gearDice: 0,
        },
      ];
    }

    const options: Array<{
      maneuver: "Slash" | "Stab" | "Strike" | "Grapple Attack";
      weaponItemId?: string | null;
      weaponName: string;
      weaponBaseDamage: number;
      gearDice: number;
    }> = [];
    if (!currentEntry.slow_available) return options;

    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character || actorCharacter.id !== character.id) return [];
      const slotIds = new Set<string>();
      const slots = character.equipment_slots;
      if (slots?.left) slotIds.add(slots.left);
      if (slots?.right) slotIds.add(slots.right);
      const inventory = character.inventory || [];

      if (selectedRange === "Engaged") {
        options.push({
          maneuver: "Strike",
          weaponItemId: null,
          weaponName: "Strike",
          weaponBaseDamage: 1,
          gearDice: 0,
        });
      }

      for (const item of inventory) {
        if (!slotIds.has(item.id)) continue;
        if (!isImplementedItem(item)) continue;
        if (item.item_type !== "Melee Weapon") continue;
        if (!weaponSupportsRange(item.range_band, selectedRange)) continue;
        if ((item.gearBonus ?? 0) <= 0) continue;

        const properties = (item.properties || []).map((value) => value.toLowerCase());
        const isSlashWeapon = properties.includes("edged") || properties.includes("blunt");
        const isStabWeapon = properties.includes("pointed");
        const baseDamage = Math.max(0, item.damage ?? 0);
        const gearDice = Math.max(0, item.gearBonus ?? 0);

        if (isSlashWeapon) {
          options.push({
            maneuver: "Slash",
            weaponItemId: item.id,
            weaponName: item.name,
            weaponBaseDamage: baseDamage,
            gearDice,
          });
        }
        if (isStabWeapon) {
          options.push({
            maneuver: "Stab",
            weaponItemId: item.id,
            weaponName: item.name,
            weaponBaseDamage: baseDamage,
            gearDice,
          });
        }
      }
    } else {
      const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
      const snapshot = actorMonster?.monster_snapshot;
      if (!snapshot) return [];

      if (weaponSupportsRange(snapshot.range_band, selectedRange)) {
        options.push({
          maneuver: "Strike",
          weaponItemId: null,
          weaponName: "Strike",
          weaponBaseDamage: 1,
          gearDice: 0,
        });
      }

      const meleeWeapons = monsterEquippedMeleeWeapons(snapshot);
      for (const weapon of meleeWeapons) {
        if (!weaponSupportsRange(weapon.rangeBand, selectedRange)) continue;
        if (weapon.gearBonus <= 0) continue;
        const isSlashWeapon = weapon.properties.includes("edged") || weapon.properties.includes("blunt");
        const isStabWeapon = weapon.properties.includes("pointed");
        if (isSlashWeapon) {
          options.push({
            maneuver: "Slash",
            weaponItemId: weapon.id,
            weaponName: weapon.name,
            weaponBaseDamage: weapon.damage,
            gearDice: weapon.gearBonus,
          });
        }
        if (isStabWeapon) {
          options.push({
            maneuver: "Stab",
            weaponItemId: weapon.id,
            weaponName: weapon.name,
            weaponBaseDamage: weapon.damage,
            gearDice: weapon.gearBonus,
          });
        }
      }
    }

    return options;
  }, [combatMode, currentEntry, isMyTurn, actorCharacter, character, selectedTokenId, selectedRange, actorTokenId, monsterByParticipantId, isActorProne, actorHardLockedByHold, isActorGrappling, isActorClinging, actorHoldCounterpartId]);

  const shoveActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || isActorProne || actorHardLockedByHold) {
      return [] as Array<{ weaponItemId?: string | null; weaponName: string; gearDice: number; bonusDice: number }>;
    }
    if (!selectedTokenId || !selectedRange || selectedRange !== "Engaged") return [];
    if (selectedTokenId === actorTokenId) return [];
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
    const targetSize = selectedTargetSize;
    if (targetSize === null) return [];
    const sizeDiff = actorSize - targetSize;
    if (sizeDiff < 0) return [];

    const options: Array<{ weaponItemId?: string | null; weaponName: string; gearDice: number; bonusDice: number }> = [];
    options.push({ weaponItemId: null, weaponName: "Shove", gearDice: 0, bonusDice: sizeDiff });

    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character || actorCharacter.id !== character.id) return options;
      const slotIds = new Set<string>();
      const slots = character.equipment_slots;
      if (slots?.left) slotIds.add(slots.left);
      if (slots?.right) slotIds.add(slots.right);
      const inventory = character.inventory || [];

      for (const item of inventory) {
        if (!slotIds.has(item.id)) continue;
        if (item.item_type === "Shield" && (item.gearBonus ?? 0) > 0) {
          options.push({
            weaponItemId: item.id,
            weaponName: item.name,
            gearDice: Math.max(0, item.gearBonus ?? 0),
            bonusDice: sizeDiff,
          });
          continue;
        }
        if (item.item_type === "Melee Weapon" && (item.gearBonus ?? 0) > 0) {
          const properties = (item.properties || []).map((p) => p.toLowerCase());
          if (properties.includes("hook")) {
            options.push({
              weaponItemId: item.id,
              weaponName: item.name,
              gearDice: Math.max(0, item.gearBonus ?? 0),
              bonusDice: sizeDiff,
            });
          }
        }
      }
    } else {
      const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
      const snapshot = actorMonster?.monster_snapshot;
      if (!snapshot) return options;
      for (const shield of monsterEquippedShields(snapshot)) {
        options.push({
          weaponItemId: shield.id,
          weaponName: shield.name,
          gearDice: shield.gearBonus,
          bonusDice: sizeDiff,
        });
      }
      for (const weapon of monsterEquippedMeleeWeapons(snapshot)) {
        if (weapon.gearBonus <= 0) continue;
        if (!weapon.properties.includes("hook")) continue;
        options.push({
          weaponItemId: weapon.id,
          weaponName: weapon.name,
          gearDice: weapon.gearBonus,
          bonusDice: sizeDiff,
        });
      }
    }

    return options;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isActorProne,
    actorHardLockedByHold,
    selectedTokenId,
    selectedRange,
    actorTokenId,
    selectedTargetSize,
    actorSize,
    actorCharacter,
    character,
    monsterByParticipantId,
  ]);

  const disarmActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || isActorProne || actorHardLockedByHold) {
      return [] as Array<{
        actorWeaponItemId: string;
        actorWeaponName: string;
        targetItemId: string;
        targetItemName: string;
        requiredSuccesses: number;
        bonusDice: number;
        gearDice: number;
      }>;
    }
    if (!selectedTokenId || !selectedRange || selectedTokenId === actorTokenId) return [];
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];

    const bonusDice = actorSize - (selectedTargetSize ?? 1);
    const actorWeapons =
      currentEntry.kind === "player"
        ? playerEquippedMeleeWeapons(actorTokenCharacter)
        : currentEntry.monster_snapshot
          ? monsterEquippedMeleeWeapons(currentEntry.monster_snapshot)
          : [];
    const validWeapons = actorWeapons.filter((weapon) => weaponSupportsRange(weapon.rangeBand, selectedRange));
    if (validWeapons.length === 0) return [];

    const targetHeldItems: InventoryItem[] = selectedTokenId.startsWith("monster:")
      ? (() => {
          const monster = monsterByParticipantId.get(selectedTokenId);
          const snapshot = monster?.monster_snapshot;
          if (!snapshot) return [];
          const slots = snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null };
          const held = (snapshot.gear || []).filter(
            (item) => slotMatchesItem(slots.left, item) || slotMatchesItem(slots.right, item)
          );
          const seen = new Set<string>();
          return held.filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
        })()
      : playerHeldItems(selectedTokenCharacter);
    const disarmableTargetItems = targetHeldItems.filter(
      (item) => (item.item_type || "").toLowerCase() !== "shield"
    );
    if (disarmableTargetItems.length === 0) return [];

    const options: Array<{
      actorWeaponItemId: string;
      actorWeaponName: string;
      targetItemId: string;
      targetItemName: string;
      requiredSuccesses: number;
      bonusDice: number;
      gearDice: number;
    }> = [];
    for (const weapon of validWeapons) {
      for (const targetItem of disarmableTargetItems) {
        options.push({
          actorWeaponItemId: weapon.id,
          actorWeaponName: weapon.name,
          targetItemId: targetItem.id,
          targetItemName: targetItem.name,
          requiredSuccesses: targetItem.wield === "2H" ? 2 : 1,
          bonusDice,
          gearDice: Math.max(0, weapon.gearBonus ?? 0),
        });
      }
    }

    return options;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isActorProne,
    actorHardLockedByHold,
    selectedTokenId,
    selectedRange,
    actorTokenId,
    actorSize,
    selectedTargetSize,
    actorTokenCharacter,
    selectedTokenCharacter,
    monsterByParticipantId,
  ]);

  const pickUpActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || isActorProne || actorHardLockedByHold) return [] as InventoryItem[];
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
    if (!selectedZoneTarget || !actorTokenId) return [];
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return [];
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (actorZone === null || actorZone !== selectedZoneTarget.zoneId) return [];

    const itemsInZone = zoneLoot.filter((drop) => drop.zone_id === actorZone).map((drop) => drop.item);
    if (itemsInZone.length === 0) return [];

    if (currentEntry.kind === "player") {
      const actor = actorTokenCharacter;
      if (!actor) return [];
      const currentWeight = (actor.inventory || []).reduce((sum, item) => sum + (item.quantity || 1) * item.weight, 0);
      const maxWeight = (actor.max_attributes?.STR ?? actor.attributes?.STR ?? 0) * 2;
      return itemsInZone.filter((item) => currentWeight + (item.quantity || 1) * item.weight <= maxWeight);
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot) return [];
    const currentWeight = (snapshot.gear || []).reduce((sum, item) => sum + (item.quantity || 1) * item.weight, 0);
    const maxWeight = Math.max(0, snapshot.str ?? 0) * 2;
    return itemsInZone.filter((item) => currentWeight + (item.quantity || 1) * item.weight <= maxWeight);
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isActorProne,
    actorHardLockedByHold,
    selectedZoneTarget,
    actorTokenId,
    tokenByCharacterId,
    zoneRegionMap,
    zoneLoot,
    actorTokenCharacter,
  ]);

  const loadCombatState = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const supabase = createClient();
    let data: CombatStateRow | null = null;
    let loadError: { message: string; code?: string } | null = null;

    const fullSelect = await supabase
      .from("combat_state")
      .select(
        "id, map_url, zone_lines, token_positions, engagements, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, zone_loot, updated_by_email, updated_at"
      )
      .eq("id", 1)
      .maybeSingle<CombatStateRow>();
    data = fullSelect.data;
    loadError = fullSelect.error as { message: string; code?: string } | null;

    // Backward-compatible fallback while migrations are rolling out.
    if (loadError && loadError.code === "42703") {
      const fallbackSelect = await supabase
        .from("combat_state")
        .select(
          "id, map_url, zone_lines, token_positions, engagements, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email, updated_at"
        )
        .eq("id", 1)
        .maybeSingle<Omit<CombatStateRow, "zone_loot">>();
      if (fallbackSelect.error) {
        setError(fallbackSelect.error.message);
        isSyncingRef.current = false;
        return;
      }
      data = fallbackSelect.data
        ? ({ ...fallbackSelect.data, zone_loot: [] } as CombatStateRow)
        : null;
      loadError = null;
    }

    if (loadError) {
      setError(loadError.message);
      isSyncingRef.current = false;
      return;
    }

    setMapUrl(data?.map_url ?? null);
    setZoneLines(normalizeZoneLines(data?.zone_lines));
    setTokenPositions(normalizeTokenPositions(data?.token_positions));
    setEngagements(normalizeEngagements(data?.engagements));
    setCombatMode(Boolean(data?.combat_mode));
    setInitiativeMonsters(
      Array.isArray(data?.initiative_monsters)
        ? data!.initiative_monsters
            .map((monster) => {
              if (!monster || typeof monster !== "object") return null;
              const m = monster as Partial<InitiativeMonster>;
              if (typeof m.id !== "string" || typeof m.name !== "string") return null;
              return {
                id: m.id,
                name: m.name,
                template_id: typeof m.template_id === "string" ? m.template_id : null,
                icon_url: typeof m.icon_url === "string" ? m.icon_url : null,
                monster_snapshot:
                  m.monster_snapshot && typeof m.monster_snapshot === "object"
                    ? (m.monster_snapshot as MonsterSnapshot)
                    : null,
              };
            })
            .filter((monster): monster is InitiativeMonster => !!monster)
        : []
    );
    setInitiativeEntries(normalizeInitiativeEntries(data?.initiative_entries));
    setInitiativeCurrentIndex(data?.initiative_current_index ?? null);
    setZoneLoot(normalizeZoneLoot(data?.zone_loot));
    setError(null);
    isSyncingRef.current = false;
  }, []);

  const loadCharacters = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("characters")
      .select("id, name, email, icon_url, attributes, max_attributes, skills, inventory, equipment_slots, spirits")
      .order("name", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      return;
    }

    const normalized = ((data ?? []) as CharacterLite[]).map((char) => ({
      ...char,
      inventory: normalizeInventoryItems(char.inventory || []),
    }));
    setCharacters(normalized);
  }, []);

  const loadMonsterTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase.from("monsters").select("*").order("name");
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setMonsterTemplates((data || []) as MonsterTemplate[]);
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !imageNatural) {
      setImageRect(null);
      return;
    }

    const recompute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw <= 0 || ch <= 0 || imageNatural.w <= 0 || imageNatural.h <= 0) {
        setImageRect(null);
        return;
      }

      const s = Math.min(cw / imageNatural.w, ch / imageNatural.h);
      const w = imageNatural.w * s;
      const h = imageNatural.h * s;
      const x = (cw - w) / 2;
      const y = (ch - h) / 2;
      setImageRect({ x, y, w, h });
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [imageNatural]);

  useEffect(() => {
    loadCharacters();
    loadMonsterTemplates();
    loadCombatState();

    const supabase = createClient();
    const channelName = `combat-state:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "combat_state" },
        () => {
          loadCombatState();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "monsters" },
        () => {
          loadMonsterTemplates();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "characters" },
        () => {
          loadCharacters();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          loadCombatState();
          loadCharacters();
          loadMonsterTemplates();
        }
      });

    const intervalId = window.setInterval(() => {
      loadCombatState();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [loadCombatState, loadCharacters, loadMonsterTemplates]);

  const uploadBattlemap = useCallback(
    async (file: File) => {
      if (!isDmUser) {
        setError("Only the DM can upload battlemaps.");
        return;
      }

      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("Image must be smaller than 10MB.");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        const supabase = createClient();
        const extension = file.name.split(".").pop() || "png";
        const path = `battlemaps/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from(MAP_BUCKET)
          .upload(path, file, { upsert: false, cacheControl: "3600" });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from(MAP_BUCKET).getPublicUrl(path);

        const { error: upsertError } = await supabase
          .from("combat_state")
          .upsert(
            {
              id: 1,
              map_url: publicData.publicUrl,
              zone_lines: [],
              updated_by_email: userEmail,
            },
            { onConflict: "id" }
          );
        if (upsertError) throw upsertError;

        setMapUrl(publicData.publicUrl);
        setZoneLines([]);
        setDraftLine(null);
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : "Upload failed.";
        setError(message);
      } finally {
        setIsUploading(false);
      }
    },
    [isDmUser, userEmail]
  );

  const saveZoneLines = useCallback(
    async (lines: ZoneStroke[]) => {
      if (!isDmUser) return;
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("combat_state")
        .upsert(
          {
            id: 1,
            zone_lines: lines,
            updated_by_email: userEmail,
          },
          { onConflict: "id" }
        );
      if (saveError) {
        setError(saveError.message);
      }
    },
    [isDmUser, userEmail]
  );

  const saveInitiativeState = useCallback(
    async (
      entries: InitiativeEntry[],
      currentIndex: number | null,
      combatModeValue: boolean,
      monsters: InitiativeMonster[] = initiativeMonsters,
      engagementEdges: EngagementEdge[] = engagements,
      tokens: TokenPosition[] | null = null,
      loot: ZoneLootDrop[] = zoneLoot
    ) => {
      if (!isDmUser) return;
      const payload: {
        id: number;
        combat_mode: boolean;
        initiative_entries: InitiativeEntry[];
        initiative_current_index: number | null;
        initiative_monsters: InitiativeMonster[];
        engagements: EngagementEdge[];
        zone_loot: ZoneLootDrop[];
        token_positions?: TokenPosition[];
        updated_by_email: string | null;
      } = {
        id: 1,
        combat_mode: combatModeValue,
        initiative_entries: entries,
        initiative_current_index: currentIndex,
        initiative_monsters: monsters,
        engagements: engagementEdges,
        zone_loot: loot,
        updated_by_email: userEmail,
      };
      if (tokens) payload.token_positions = tokens;
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("combat_state")
        .upsert(payload, { onConflict: "id" });
      if (saveError) {
        setError(saveError.message);
      }
    },
    [initiativeMonsters, engagements, zoneLoot, isDmUser, userEmail]
  );

  const rollInitiative = async () => {
    if (!isDmUser) return;
    const used = new Set<string>();

    const entries: InitiativeEntry[] = [
      ...characters.map((player) => ({
        participant_id: `player:${player.id}`,
        kind: "player" as const,
        name: player.name,
        user_email: player.email,
        icon_url: player.icon_url,
        roll: rollUnique(used),
        slow_available: true,
        fast_available: true,
        prone: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
      })),
      ...initiativeMonsters.map((monster) => ({
        participant_id: monster.id,
        kind: "monster" as const,
        name: monster.name,
        user_email: null,
        icon_url: monster.icon_url,
        monster_template_id: monster.template_id,
        monster_snapshot: monster.monster_snapshot,
        roll: rollUnique(used),
        slow_available: true,
        fast_available: true,
        prone: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
      })),
    ].sort((a, b) => rollSortValue(b.roll) - rollSortValue(a.roll));

    const currentIndex = entries.length > 0 ? 0 : null;
    setCombatMode(true);
    setInitiativeEntries(entries);
    setInitiativeCurrentIndex(currentIndex);
    await saveInitiativeState(entries, currentIndex, true);
  };

  const resetInitiative = async () => {
    if (!isDmUser) return;
    const supabase = createClient();
    const { data: latest } = await supabase
      .from("combat_state")
      .select("initiative_monsters, zone_loot")
      .eq("id", 1)
      .maybeSingle<{ initiative_monsters: InitiativeMonster[] | null; zone_loot: ZoneLootDrop[] | null }>();
    const preservedMonsters = Array.isArray(latest?.initiative_monsters) ? latest.initiative_monsters : initiativeMonsters;
    const drops = normalizeZoneLoot(latest?.zone_loot);
    let nextZoneLootAfterReset: ZoneLootDrop[] = [];

    if (drops.length > 0) {
      const { data: wagonsRow } = await supabase
        .from("wagons")
        .select("id, wagon1, wagon2")
        .eq("id", 1)
        .maybeSingle<{ id: number; wagon1: InventoryItem[] | null; wagon2: InventoryItem[] | null }>();

      const maxWagonWeight = 200;
      const wagon1 = normalizeInventoryItems(wagonsRow?.wagon1 || []);
      const wagon2 = normalizeInventoryItems(wagonsRow?.wagon2 || []);
      const itemWeight = (item: InventoryItem) => (item.quantity || 1) * item.weight;
      let wagon1Weight = wagon1.reduce((sum, item) => sum + itemWeight(item), 0);
      let wagon2Weight = wagon2.reduce((sum, item) => sum + itemWeight(item), 0);
      const remaining: ZoneLootDrop[] = [];

      for (const drop of drops) {
        const w = itemWeight(drop.item);
        if (wagon1Weight + w <= maxWagonWeight) {
          wagon1.push(drop.item);
          wagon1Weight += w;
          continue;
        }
        if (wagon2Weight + w <= maxWagonWeight) {
          wagon2.push(drop.item);
          wagon2Weight += w;
          continue;
        }
        remaining.push(drop);
      }

      await supabase
        .from("wagons")
        .upsert({ id: 1, wagon1, wagon2 }, { onConflict: "id" });
      nextZoneLootAfterReset = remaining;
      setZoneLoot(remaining);
    } else {
      nextZoneLootAfterReset = [];
      setZoneLoot([]);
    }

    setInitiativeEntries([]);
    setInitiativeCurrentIndex(null);
    setEngagements([]);
    setCombatMode(false);
    setSelectedTokenId(null);
    setSelectedZoneTarget(null);
    setMonsterNameDrafts({});
    setInitiativeMonsters(preservedMonsters);
    await saveInitiativeState([], null, false, preservedMonsters, [], null, nextZoneLootAfterReset);
  };

  const deployMonsterTemplate = async (monster: MonsterTemplate, quantity = 1) => {
    if (!isDmUser) return;

    const qty = Math.max(1, quantity);
    const suffix = (idx: number) => String.fromCharCode("A".charCodeAt(0) + idx);
    const deployed: InitiativeMonster[] = Array.from({ length: qty }, (_, idx) => ({
      id: `monster:${crypto.randomUUID()}`,
      name: qty > 1 ? `${monster.name} ${suffix(idx)}` : monster.name,
      template_id: monster.id,
      icon_url: monster.icon_url,
      monster_snapshot: buildMonsterSnapshot(monster),
    }));

    const nextMonsters = [...initiativeMonsters, ...deployed];
    setInitiativeMonsters(nextMonsters);

    let nextEntries = initiativeEntries;
    let nextCurrent = initiativeCurrentIndex;

    if (initiativeEntries.length > 0) {
      const used = new Set(
        initiativeEntries.flatMap((entry) =>
          entry.roll === null ? [] : [formatRoll(entry.roll)]
        )
      );
      const currentParticipant = currentEntry?.participant_id ?? null;

      const newEntries = deployed.map((deployedMonster) => ({
        participant_id: deployedMonster.id,
        kind: "monster" as const,
        name: deployedMonster.name,
        user_email: null,
        icon_url: deployedMonster.icon_url,
        monster_template_id: deployedMonster.template_id,
        monster_snapshot: deployedMonster.monster_snapshot,
        roll: rollUnique(used),
        slow_available: true,
        fast_available: true,
        prone: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
      }));

      nextEntries = [
        ...initiativeEntries,
        ...newEntries,
      ].sort((a, b) => rollSortValue(b.roll) - rollSortValue(a.roll));

      if (currentParticipant) {
        const idx = nextEntries.findIndex((entry) => entry.participant_id === currentParticipant);
        nextCurrent = idx >= 0 ? idx : 0;
      } else {
        nextCurrent = 0;
      }

      setInitiativeEntries(nextEntries);
      setInitiativeCurrentIndex(nextCurrent);
    }

    await saveInitiativeState(nextEntries, nextCurrent, combatMode, nextMonsters);
  };

  const deployMonsterFromQuery = async () => {
    const raw = deployMonsterQuery.trim();
    if (!raw) return;
    const qtyMatch = raw.match(/^(.*?)(?:\s*x\s*(\d+))$/i);
    const baseName = (qtyMatch?.[1] ?? raw).trim().toLowerCase();
    const quantity = qtyMatch ? Math.max(1, Number.parseInt(qtyMatch[2], 10) || 1) : 1;
    const monster = monsterTemplates.find((template) => template.name.trim().toLowerCase() === baseName);
    if (!monster) {
      return;
    }
    await deployMonsterTemplate(monster, quantity);
    setDeployMonsterQuery("");
    setError(null);
  };

  const renameMonster = async (monsterId: string, nameRaw: string) => {
    if (!isDmUser) return;
    const name = nameRaw.trim();
    if (!name) return;

    const nextMonsters = initiativeMonsters.map((monster) =>
      monster.id === monsterId
        ? {
            ...monster,
            name,
            monster_snapshot: monster.monster_snapshot
              ? { ...monster.monster_snapshot, name }
              : monster.monster_snapshot,
          }
        : monster
    );
    setInitiativeMonsters(nextMonsters);

    const nextEntries = initiativeEntries.map((entry) =>
      entry.participant_id === monsterId
        ? {
            ...entry,
            name,
            monster_snapshot: entry.monster_snapshot
              ? { ...entry.monster_snapshot, name }
              : entry.monster_snapshot,
          }
        : entry
    );
    setInitiativeEntries(nextEntries);

    await saveInitiativeState(nextEntries, initiativeCurrentIndex, combatMode, nextMonsters);
  };

  const deleteMonster = async (monsterId: string) => {
    if (!isDmUser) return;

    const nextMonsters = initiativeMonsters.filter((monster) => monster.id !== monsterId);
    const removedEntryIndex = initiativeEntries.findIndex((entry) => entry.participant_id === monsterId);
    const nextEntries = initiativeEntries.filter((entry) => entry.participant_id !== monsterId);

    let nextCurrent = initiativeCurrentIndex;
    if (nextEntries.length === 0) {
      nextCurrent = null;
    } else if (nextCurrent !== null) {
      if (removedEntryIndex === nextCurrent) {
        nextCurrent = nextCurrent >= nextEntries.length ? 0 : nextCurrent;
      } else if (removedEntryIndex >= 0 && removedEntryIndex < nextCurrent) {
        nextCurrent = nextCurrent - 1;
      }
    }

    setInitiativeMonsters(nextMonsters);
    setInitiativeEntries(nextEntries);
    setInitiativeCurrentIndex(nextCurrent);
    const nextTokens = tokenPositions.filter((token) => token.character_id !== monsterId);
    setTokenPositions(nextTokens);
    setMonsterNameDrafts((prev) => {
      const next = { ...prev };
      delete next[monsterId];
      return next;
    });
    await saveInitiativeState(nextEntries, nextCurrent, combatMode, nextMonsters, engagements, nextTokens);
  };

  const passTurn = async () => {
    if (!canPass) return;
    const actingParticipantId = currentEntry?.participant_id ?? null;
    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_pass_turn");
    if (rpcError) {
      setError(rpcError.message);
    }
  };

  const engageByTokenIds = async (actorTokenIdValue: string, targetTokenIdValue: string): Promise<boolean> => {
    if (!isDmUser) return false;
    if (actorTokenIdValue === targetTokenIdValue) return false;

    if (engagements.some((edge) => edge.a === actorTokenIdValue || edge.b === actorTokenIdValue)) {
      return false;
    }

    const component = new Set<string>([targetTokenIdValue]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of engagements) {
        if (component.has(edge.a) && !component.has(edge.b)) {
          component.add(edge.b);
          changed = true;
        } else if (component.has(edge.b) && !component.has(edge.a)) {
          component.add(edge.a);
          changed = true;
        }
      }
    }

    const nextEdges = [...engagements];
    for (const member of component) {
      if (member === actorTokenIdValue) continue;
      const a = actorTokenIdValue < member ? actorTokenIdValue : member;
      const b = actorTokenIdValue < member ? member : actorTokenIdValue;
      if (!nextEdges.some((edge) => edge.a === a && edge.b === b)) {
        nextEdges.push({ a, b });
      }
    }

    setEngagements(nextEdges);
    setSelectedTokenId(null);
    await saveInitiativeState(initiativeEntries, initiativeCurrentIndex, combatMode, initiativeMonsters, nextEdges);
    return true;
  };

  const requestDrawGear = async () => {
    if (!canUseDrawGearFromToken || !currentEntry) return;
    const actingParticipantId = currentEntry.participant_id;
    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return;
    if (currentEntry.kind === "player") {
      onRequestDrawGear?.();
      return;
    }

    if (!isDmUser) return;
    const monsterId = currentEntry.participant_id;
    const currentMonster = initiativeMonsters.find((monster) => monster.id === monsterId);
    if (!currentMonster?.monster_snapshot) return;

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_use_fast_or_slow");
    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const { data: latest, error: latestError } = await supabase
      .from("combat_state")
      .select("initiative_entries, initiative_monsters, initiative_current_index")
      .eq("id", 1)
      .maybeSingle<{
        initiative_entries: InitiativeEntry[] | null;
        initiative_monsters: InitiativeMonster[] | null;
        initiative_current_index: number | null;
      }>();
    if (latestError) {
      setError(latestError.message);
      return;
    }

    const freshEntries = normalizeInitiativeEntries(latest?.initiative_entries);
    const freshMonsters = Array.isArray(latest?.initiative_monsters) ? latest!.initiative_monsters : [];

    const normalizedFreshMonsters = freshMonsters
      .map((monster) => {
        if (!monster || typeof monster !== "object") return null;
        const m = monster as Partial<InitiativeMonster>;
        if (typeof m.id !== "string" || typeof m.name !== "string") return null;
        return {
          id: m.id,
          name: m.name,
          template_id: typeof m.template_id === "string" ? m.template_id : null,
          icon_url: typeof m.icon_url === "string" ? m.icon_url : null,
          monster_snapshot:
            m.monster_snapshot && typeof m.monster_snapshot === "object"
              ? (m.monster_snapshot as MonsterSnapshot)
              : null,
        } as InitiativeMonster;
      })
      .filter((monster): monster is InitiativeMonster => !!monster);

    const nextMonsters = normalizedFreshMonsters.map((monster) => {
      if (monster.id !== monsterId || !monster.monster_snapshot) return monster;
      return {
        ...monster,
        monster_snapshot: cycleMonsterDrawGear(monster.monster_snapshot),
      };
    });

    const refreshedMonster = nextMonsters.find((monster) => monster.id === monsterId);
    const nextEntries = freshEntries.map((entry) =>
      entry.participant_id === monsterId
        ? { ...entry, monster_snapshot: refreshedMonster?.monster_snapshot ?? entry.monster_snapshot }
        : entry
    );

    setInitiativeMonsters(nextMonsters);
    setInitiativeEntries(nextEntries);
    setInitiativeCurrentIndex(latest?.initiative_current_index ?? initiativeCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest?.initiative_current_index ?? initiativeCurrentIndex,
      combatMode,
      nextMonsters,
      engagements
    );
  };

  const engageTargetToken = async (actorTokenIdValue: string, targetTokenIdValue: string): Promise<boolean> => {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_engage_token", {
      p_actor_token_id: actorTokenIdValue,
      p_target_token_id: targetTokenIdValue,
    });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    setSelectedTokenId(null);
    return true;
  };

  const requestEngage = async () => {
    if (!canUseEngageFromSelection || !actorTokenId || !selectedTokenId) return;
    let succeeded = false;

    if (isDmUser) {
      succeeded = await engageByTokenIds(actorTokenId, selectedTokenId);
    } else {
      succeeded = await engageTargetToken(actorTokenId, selectedTokenId);
    }

    if (!succeeded) return;
    const actingParticipantId = currentEntry?.participant_id ?? null;
    await clearSwingForParticipant(actingParticipantId);
  };

  const consumeAction = async (actionType: "fast" | "slow"): Promise<boolean> => {
    if (!canPass) return false;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_use_action", { p_action: actionType });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    return true;
  };

  const consumeFastOrSlow = async (): Promise<boolean> => {
    if (!canPass) return false;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_use_fast_or_slow");
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    return true;
  };

  const clearSwingForParticipant = async (participantId: string | null): Promise<boolean> => {
    if (!participantId) return true;
    const participantEntry = initiativeEntries.find((entry) => entry.participant_id === participantId) || null;
    if (!participantEntry?.swing_weapon_item_id) return true;
    const supabase = createClient();

    if (!isDmUser) {
      const actorTokenIdForRpc =
        participantEntry.kind === "player"
          ? participantEntry.participant_id.replace(/^player:/, "")
          : participantEntry.participant_id;
      const { error: rpcError } = await supabase.rpc("combat_clear_swing_weapon_for_token", {
        p_actor_token_id: actorTokenIdForRpc,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const nextEntries = initiativeEntries.map((entry) =>
      entry.participant_id === participantId
        ? { ...entry, swing_weapon_item_id: null, swing_weapon_name: null }
        : entry
    );
    setInitiativeEntries(nextEntries);
    await saveInitiativeState(nextEntries, initiativeCurrentIndex, combatMode, initiativeMonsters, engagements);
    return true;
  };

  const setSwingForCurrentActor = async (weaponItemId: string, weaponName: string): Promise<boolean> => {
    if (!currentEntry) return false;
    const supabase = createClient();

    if (!isDmUser) {
      const { error: rpcError } = await supabase.rpc("combat_set_swing_weapon", {
        p_weapon_item_id: weaponItemId,
        p_weapon_name: weaponName,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const nextEntries = initiativeEntries.map((entry) =>
      entry.participant_id === currentEntry.participant_id
        ? { ...entry, swing_weapon_item_id: weaponItemId, swing_weapon_name: weaponName }
        : entry
    );
    setInitiativeEntries(nextEntries);
    await saveInitiativeState(nextEntries, initiativeCurrentIndex, combatMode, initiativeMonsters, engagements);
    return true;
  };

  const clearProneForToken = async (actorTokenIdValue: string): Promise<boolean> => {
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_get_up_token", {
      p_actor_token_id: actorTokenIdValue,
    });
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    return true;
  };

  const requestMeleeAction = async (option: {
    maneuver: "Slash" | "Stab" | "Strike" | "Grapple Attack";
    weaponItemId?: string | null;
    weaponName: string;
    weaponBaseDamage: number;
    gearDice: number;
  }) => {
    if (!selectedTokenId || !currentEntry || !isMyTurn) return;
    if (selectedTokenId === actorTokenId) return;
    const actingParticipantId = currentEntry.participant_id;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const didConsume =
      option.maneuver === "Grapple Attack"
        ? await consumeFastOrSlow()
        : await consumeAction("slow");
    if (!didConsume) return;
    const swingMatch =
      !!currentSwing &&
      (option.maneuver === "Slash" || option.maneuver === "Stab") &&
      !!option.weaponItemId &&
      option.weaponItemId === currentSwing.weaponItemId;
    const swingBonusDamage = swingMatch ? 1 : 0;
    const swingCleared = await clearSwingForParticipant(actingParticipantId);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `melee:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: option.weaponItemId ?? null,
        weaponName: option.weaponName,
        weaponBaseDamage: option.weaponBaseDamage,
        maneuver: option.maneuver,
        rollAttribute: "STR",
        rollSkill: "MELEE",
        requiredSuccesses: 1,
        swingBonusDamage,
      });
      setSelectedTokenId(null);
    } else {
      const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
      const snapshot = actorMonster?.monster_snapshot;
      if (!snapshot || !onResolveMeleeAttack) return;
      const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
      const skillDice = rollD6Pool(Math.max(0, snapshot.special ?? 0));
      const gearDice = rollD6Pool(Math.max(0, option.gearDice ?? 0));
      const successes =
        attributeDice.filter((d) => d === 6).length +
        skillDice.filter((d) => d === 6).length +
        gearDice.filter((d) => d === 6).length;

      setMonsterRollResult({
        actionLabel: option.maneuver === "Strike" ? "Strike" : `${option.maneuver} (${option.weaponName})`,
        attributeDice,
        skillDice,
        gearDice,
        successes,
      });

      await onResolveMeleeAttack({
        id: `monster-melee:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorTokenId || "monster",
        targetCharacterId: selectedTokenId,
        weaponName: option.weaponName,
        weaponBaseDamage: option.weaponBaseDamage,
        maneuver: option.maneuver,
        totalSuccesses: successes,
        requiredSuccesses: 1,
        swingBonusDamage,
      });
    }
  };

  const requestShoveAction = async (option: {
    weaponItemId?: string | null;
    weaponName: string;
    gearDice: number;
    bonusDice: number;
  }) => {
    if (!selectedTokenId || !currentEntry || !isMyTurn || isActorProne) return;
    if (selectedTokenId === actorTokenId) return;
    const actingParticipantId = currentEntry.participant_id;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(actingParticipantId);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `shove:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: option.weaponItemId ?? null,
        weaponName: option.weaponName,
        weaponBaseDamage: 0,
        maneuver: "Shove",
        rollAttribute: "STR",
        rollSkill: "MELEE",
        requiredSuccesses: 1,
        bonusDice: Math.max(0, option.bonusDice ?? 0),
      });
      setSelectedTokenId(null);
      return;
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    const snapshot = actorMonster?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack || !actorTokenId) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
    const skillDice = rollD6Pool(Math.max(0, (snapshot.special ?? 0) + Math.max(0, option.bonusDice ?? 0)));
    const gearDice = rollD6Pool(Math.max(0, option.gearDice ?? 0));
    const successes =
      attributeDice.filter((d) => d === 6).length +
      skillDice.filter((d) => d === 6).length +
      gearDice.filter((d) => d === 6).length;

    setMonsterRollResult({
      actionLabel: option.weaponItemId ? `Shove (${option.weaponName})` : "Shove",
      attributeDice,
      skillDice,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-shove:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: selectedTokenId,
      weaponName: option.weaponName,
      weaponBaseDamage: 0,
      maneuver: "Shove",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
  };

  const requestDisarmAction = async (option: {
    actorWeaponItemId: string;
    actorWeaponName: string;
    targetItemId: string;
    targetItemName: string;
    requiredSuccesses: number;
    bonusDice: number;
    gearDice: number;
  }) => {
    if (!selectedTokenId || !currentEntry || !isMyTurn || isActorProne || !actorTokenId) return;
    if (selectedTokenId === actorTokenId) return;
    const actingParticipantId = currentEntry.participant_id;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return;
    const zoneId = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (zoneId === null) return;

    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(actingParticipantId);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `disarm:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName: selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target",
        weaponItemId: option.actorWeaponItemId,
        weaponName: option.actorWeaponName,
        weaponBaseDamage: 0,
        maneuver: "Disarm",
        rollAttribute: "STR",
        rollSkill: "MELEE",
        requiredSuccesses: option.requiredSuccesses,
        bonusDice: option.bonusDice,
        disarmTargetItemId: option.targetItemId,
        disarmTargetItemName: option.targetItemName,
        disarmZoneId: zoneId,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
    const signedSkillPool = Math.max(0, snapshot.special ?? 0) + option.bonusDice;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice = rollD6Pool(Math.max(0, option.gearDice ?? 0));
    const rawSuccesses =
      attributeDice.filter((d) => d === 6).length +
      skillDice.filter((d) => d === 6).length +
      gearDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: `Disarm (${option.targetItemName} w/ ${option.actorWeaponName})`,
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-disarm:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: selectedTokenId,
      weaponName: option.actorWeaponName,
      weaponBaseDamage: 0,
      maneuver: "Disarm",
      totalSuccesses: successes,
      requiredSuccesses: option.requiredSuccesses,
      disarmTargetItemId: option.targetItemId,
      disarmZoneId: zoneId,
    });
  };

  const requestPickUpAction = async (item: InventoryItem) => {
    if (!currentEntry || !actorTokenId || !selectedZoneTarget) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_pick_up_zone_item", {
      p_actor_token_id: actorTokenId,
      p_zone_id: selectedZoneTarget.zoneId,
      p_item_id: item.id,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await loadCharacters();
  };

  const requestRetreat = async () => {
    if (!canUseRetreatFromSelection || !actorTokenId || !currentEntry) return;
    const actingParticipantId = currentEntry.participant_id;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Engagement";
      onQueueMeleeAction?.({
        id: `retreat:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId || actorCharacter.id,
        targetName,
        weaponItemId: null,
        weaponName: "Retreat",
        weaponBaseDamage: 0,
        maneuver: "Retreat",
        rollAttribute: "AGL",
        rollSkill: "MOVE",
        requiredSuccesses: 1,
      });
      setSelectedTokenId(null);
      return;
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    const snapshot = actorMonster?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const skillDice = rollD6Pool(Math.max(0, snapshot.special ?? 0));
    const gearDice: number[] = [];
    const successes = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;

    setMonsterRollResult({
      actionLabel: "Retreat",
      attributeDice,
      skillDice,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-retreat:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: actorTokenId,
      weaponName: "Retreat",
      weaponBaseDamage: 0,
      maneuver: "Retreat",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
  };

  const requestSwingWeapon = async (weapon: { id: string; name: string }) => {
    if (!isSelectedSelf || !isMyTurn || !currentEntry || isActorProne) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    await setSwingForCurrentActor(weapon.id, weapon.name);
  };

  const requestGetUp = async () => {
    if (!canUseGetUpFromSelection || !actorTokenId || !currentEntry) return;
    const actingParticipantId = currentEntry.participant_id;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(actingParticipantId);
    if (!swingCleared) return;
    await clearProneForToken(actorTokenId);
  };

  const requestGrappleLike = async (mode: "Grapple" | "Cling") => {
    if (!currentEntry || !actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return;
    if (mode === "Grapple" && !canUseGrappleFromSelection) return;
    if (mode === "Cling" && !canUseClingFromSelection) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    const actorToken = tokenByCharacterId.get(actorTokenId);
    const zoneId = actorToken ? zoneIdAtPoint(zoneRegionMap, actorToken) : null;
    const sizeDiff = actorSize - (selectedTargetSize ?? 1);
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `${mode.toLowerCase().replace(/\s+/g, "-")}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: null,
        weaponName: mode,
        weaponBaseDamage: 0,
        maneuver: mode,
        rollAttribute: "STR",
        rollSkill: "MELEE",
        requiredSuccesses: 1,
        bonusDice: sizeDiff,
        disarmZoneId: zoneId ?? undefined,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
    const signedSkillPool = Math.max(0, snapshot.special ?? 0) + sizeDiff;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const successesRaw = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, successesRaw - skillDice.filter((d) => d === 6).length * 2)
      : successesRaw;

    setMonsterRollResult({
      actionLabel: mode,
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice: [],
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-${mode.toLowerCase()}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: selectedTokenId,
      weaponName: mode,
      weaponBaseDamage: 0,
      maneuver: mode,
      totalSuccesses: successes,
      requiredSuccesses: 1,
      disarmZoneId: zoneId ?? undefined,
    });
  };

  const requestRelease = async () => {
    if (!currentEntry || !actorTokenId || !canUseRelease) return;
    const otherTokenId = actorGrapplingTargetId || actorClingingTargetId;
    if (!otherTokenId) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_release_grapple_or_cling", {
      p_actor_token_id: actorTokenId,
      p_target_token_id: otherTokenId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSelectedTokenId(null);
  };

  const requestBreakFree = async () => {
    if (!currentEntry || !actorTokenId || !canUseBreakFree) return;
    const otherTokenId = actorGrappledById || actorClungOntoById;
    if (!otherTokenId) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    const targetSize =
      otherTokenId.startsWith("monster:")
        ? Math.trunc(monsterByParticipantId.get(otherTokenId)?.monster_snapshot?.size ?? 1)
        : 1;
    const sizeDiff = actorSize - targetSize;
    const againstCling = Boolean(actorClungOntoById && actorClungOntoById === otherTokenId);
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `break-free:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: otherTokenId,
        targetName,
        weaponItemId: null,
        weaponName: "Break Free",
        weaponBaseDamage: 0,
        maneuver: "Break Free",
        rollAttribute: againstCling ? "AGL" : "STR",
        rollSkill: againstCling ? "MOVE" : "MELEE",
        requiredSuccesses: 1,
        bonusDice: sizeDiff,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, againstCling ? snapshot.agl ?? 0 : snapshot.str ?? 0));
    const signedSkillPool = Math.max(0, snapshot.special ?? 0) + sizeDiff;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const successesRaw = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, successesRaw - skillDice.filter((d) => d === 6).length * 2)
      : successesRaw;

    setMonsterRollResult({
      actionLabel: "Break Free",
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice: [],
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-break-free:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: otherTokenId,
      weaponName: "Break Free",
      weaponBaseDamage: 0,
      maneuver: "Break Free",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
  };

  const requestRun = async () => {
    if (!selectedZoneTarget) return;
    await requestRunToPoint(selectedZoneTarget.point, false);
  };

  const requestGenericSlow = async () => {
    const actingParticipantId = currentEntry?.participant_id ?? null;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    await clearSwingForParticipant(actingParticipantId);
  };

  const requestGenericFast = async () => {
    const actingParticipantId = currentEntry?.participant_id ?? null;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    await clearSwingForParticipant(actingParticipantId);
  };

  const toNormalizedPointFromClient = (clientX: number, clientY: number): ZonePoint | null => {
    const container = mapContainerRef.current;
    if (!container || !imageRect) return null;
    const rect = container.getBoundingClientRect();
    const xPx = clientX - rect.left;
    const yPx = clientY - rect.top;

    if (
      xPx < imageRect.x ||
      yPx < imageRect.y ||
      xPx > imageRect.x + imageRect.w ||
      yPx > imageRect.y + imageRect.h
    ) {
      return null;
    }

    return {
      x: (xPx - imageRect.x) / imageRect.w,
      y: (yPx - imageRect.y) / imageRect.h,
    };
  };

  const dropEventToNormalizedPoint = (event: React.DragEvent<HTMLDivElement>): ZonePoint | null =>
    toNormalizedPointFromClient(event.clientX, event.clientY);

  const requestRunToPoint = async (point: ZonePoint, silentInvalid = false): Promise<boolean> => {
    if (!actorTokenId || !combatMode || !isMyTurn) return false;
    if (actorHardLockedByHold) return false;
    const actingParticipantId = currentEntry?.participant_id ?? null;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (isActorEnemyEngaged) return false;

    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return false;

    const fromZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const toZone = zoneIdAtPoint(zoneRegionMap, point);
    if (fromZone === null || toZone === null || fromZone === toZone) return false;

    const distance = shortestZoneDistance(fromZone, toZone, zoneAdjacency);
    if (distance !== 1) return false;

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_run_token", {
      p_actor_token_id: actorTokenId,
      p_x: point.x,
      p_y: point.y,
    });
    if (rpcError) {
      if (!silentInvalid) {
        setError(rpcError.message);
      }
      return false;
    }

    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return false;
    setSelectedZoneTarget(null);
    setSelectedTokenId(null);
    return true;
  };

  const placePlayerToken = async (characterId: string, point: ZonePoint) => {
    const actorEntry = initiativeEntries.find(
      (entry) => entry.participant_id === characterId || entry.participant_id === `player:${characterId}`
    );
    if (actorEntry?.clinging_target_id) {
      return;
    }

    const player = characters.find((char) => char.id === characterId);
    if (!player) {
      setError("Could not find player for token placement.");
      return;
    }
    if (!canPlaceTokenFor(player.email)) {
      setError("You can only place your own token.");
      return;
    }
    const currentToken = tokenByCharacterId.get(characterId);
    if (currentToken) {
      const engaged = engagements.some((edge) => edge.a === characterId || edge.b === characterId);
      if (engaged) {
        const fromZone = zoneIdAtPoint(zoneRegionMap, currentToken);
        const toZone = zoneIdAtPoint(zoneRegionMap, point);
        if (fromZone !== null && toZone !== null && fromZone !== toZone) {
          return;
        }
      }
    }

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_upsert_player_token", {
      p_character_id: characterId,
      p_x: point.x,
      p_y: point.y,
    });
    if (rpcError) {
      setError(rpcError.message);
    }
  };

  const placeMonsterToken = async (monsterParticipantId: string, point: ZonePoint) => {
    if (!isDmUser) return;
    const actorEntry = initiativeEntries.find((entry) => entry.participant_id === monsterParticipantId);
    if (actorEntry?.clinging_target_id) {
      return;
    }
    const currentToken = tokenByCharacterId.get(monsterParticipantId);
    if (currentToken) {
      const engaged = engagements.some(
        (edge) => edge.a === monsterParticipantId || edge.b === monsterParticipantId
      );
      if (engaged) {
        const fromZone = zoneIdAtPoint(zoneRegionMap, currentToken);
        const toZone = zoneIdAtPoint(zoneRegionMap, point);
        if (fromZone !== null && toZone !== null && fromZone !== toZone) {
          return;
        }
      }
    }

    let nextTokens = [
      ...tokenPositions.filter((token) => token.character_id !== monsterParticipantId),
      { character_id: monsterParticipantId, x: point.x, y: point.y },
    ];
    const attachedTokenId =
      actorEntry?.grappling_target_id ||
      actorEntry?.grappled_by_id ||
      actorEntry?.clinging_target_id ||
      actorEntry?.clung_onto_by_id ||
      null;
    if (attachedTokenId) {
      nextTokens = [
        ...nextTokens.filter((token) => token.character_id !== attachedTokenId),
        { character_id: attachedTokenId, x: point.x, y: point.y },
      ];
    }
    setTokenPositions(nextTokens);

    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("combat_state")
      .upsert({ id: 1, token_positions: nextTokens, updated_by_email: userEmail }, { onConflict: "id" });
    if (saveError) {
      setError(saveError.message);
    }
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const genericTokenId = event.dataTransfer.getData("application/x-combat-token-id");
    const tokenCharacterId = event.dataTransfer.getData("application/x-combat-player-id");
    const droppedTokenId = genericTokenId || tokenCharacterId;
    if (droppedTokenId && mapUrl && imageRect) {
      const point = dropEventToNormalizedPoint(event);
      if (!point) return;

      // Drag directly onto another token to engage.
      const dropTarget = renderedTokens.find((token) => {
        if (token.character_id === droppedTokenId) return false;
        const dx = (token.x - point.x) * imageRect.w;
        const dy = (token.y - point.y) * imageRect.h;
        return Math.hypot(dx, dy) <= 24;
      });
      if (dropTarget && actorTokenId && droppedTokenId === actorTokenId) {
        const actorToken = tokenByCharacterId.get(actorTokenId);
        const targetToken = tokenByCharacterId.get(dropTarget.character_id);
        const actorZone = actorToken ? zoneIdAtPoint(zoneRegionMap, actorToken) : null;
        const targetZone = targetToken ? zoneIdAtPoint(zoneRegionMap, targetToken) : null;
        if (
          combatMode &&
          isMyTurn &&
          !isActorEngaged &&
          !isActorProne &&
          !actorHardLockedByHold &&
          actorZone !== null &&
          actorZone === targetZone
        ) {
          if (isDmUser) {
            await engageByTokenIds(actorTokenId, dropTarget.character_id);
          } else if (actorTokenId) {
            await engageTargetToken(actorTokenId, dropTarget.character_id);
          }
          return;
        }
      }

      if (combatMode && isMyTurn && actorTokenId && droppedTokenId === actorTokenId) {
        const actorToken = tokenByCharacterId.get(actorTokenId);
        const fromZone = actorToken ? zoneIdAtPoint(zoneRegionMap, actorToken) : null;
        const toZone = zoneIdAtPoint(zoneRegionMap, point);
        if (fromZone !== null && toZone !== null && fromZone !== toZone) {
          const didRun = await requestRunToPoint(point, true);
          if (!didRun) return;
          return;
        }
      }

      if (droppedTokenId.startsWith("monster:")) {
        await placeMonsterToken(droppedTokenId, point);
      } else {
        await placePlayerToken(droppedTokenId, point);
      }
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      await uploadBattlemap(file);
    }
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadBattlemap(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toNormalizedPoint = (event: React.PointerEvent<SVGSVGElement>): ZonePoint | null => {
    const container = mapContainerRef.current;
    if (!container || !imageRect) return null;
    const rect = container.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;

    if (
      xPx < imageRect.x ||
      yPx < imageRect.y ||
      xPx > imageRect.x + imageRect.w ||
      yPx > imageRect.y + imageRect.h
    ) {
      return null;
    }

    return {
      x: (xPx - imageRect.x) / imageRect.w,
      y: (yPx - imageRect.y) / imageRect.h,
    };
  };

  const onDrawStart = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canDraw) return;
    const point = toNormalizedPoint(event);
    if (!point) return;
    setIsDrawing(true);
    setDraftLine({ points: [point] });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrawMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing || !canDraw) return;
    const point = toNormalizedPoint(event);
    if (!point) return;

    setDraftLine((prev) => {
      if (!prev || prev.points.length === 0) return prev;
      const lastPoint = prev.points[prev.points.length - 1];
      const delta = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
      if (delta < 0.002) return prev;
      return { points: [...prev.points, point] };
    });
  };

  const onDrawEnd = async () => {
    if (!isDrawing || !draftLine) return;
    setIsDrawing(false);

    if (draftLine.points.length < 2) {
      setDraftLine(null);
      return;
    }

    const next = [...zoneLines, draftLine];
    setZoneLines(next);
    setDraftLine(null);
    await saveZoneLines(next);
  };

  const clearZones = async () => {
    if (!canDraw) return;
    setZoneLines([]);
    setDraftLine(null);
    await saveZoneLines([]);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 min-h-[560px]">
      <aside className="min-h-[520px] max-h-[520px] rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3">
        <h3 className="text-xl font-bold text-amber-300 mb-3">Combat Actions</h3>
        <div className="rounded border border-amber-500/20 bg-gray-900/30 p-3 text-sm text-amber-100/90 mb-3">
          {`Selected: ${
            selectedTokenCharacter?.name ||
            selectedTokenMonster?.name ||
            (selectedZoneTarget ? `Zone ${selectedZoneTarget.zoneId}` : "None")
          }`}
          {selectedZoneTarget && (
            <div className="mt-1 text-xs text-amber-200/80">
              {selectedZoneLootItems.length > 0
                ? `On Ground: ${selectedZoneLootItems.map((item) => item.name).join(", ")}`
                : "On Ground: None"}
            </div>
          )}
        </div>
        <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
          {canUseEngageFromSelection && (
          <button
            onClick={requestEngage}
            className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Engage
          </button>
          )}
          {canUseGrappleFromSelection && (
            <button
              onClick={() => void requestGrappleLike("Grapple")}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Grapple
            </button>
          )}
          {canUseClingFromSelection && (
            <button
              onClick={() => void requestGrappleLike("Cling")}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Cling
            </button>
          )}
          {canUseRelease && (
            <button
              onClick={() => void requestRelease()}
              className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600"
            >
              Release
            </button>
          )}
          {canUseBreakFree && (
            <button
              onClick={() => void requestBreakFree()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Break Free
            </button>
          )}
          {canUseRetreatFromSelection && (
          <button
            onClick={() => void requestRetreat()}
            className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Retreat
          </button>
          )}
          {canUseDrawGearFromToken && (
          <button
            onClick={requestDrawGear}
            className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
          >
            Draw Gear
          </button>
          )}
          {swingWeaponOptions.map((weapon) => (
            <button
              key={`swing-${weapon.id}`}
              onClick={() => void requestSwingWeapon(weapon)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Swing (${weapon.name})`}
            </button>
          ))}
          {meleeActionOptions.map((option) => (
            <button
              key={`${option.maneuver}-${option.weaponItemId ?? "none"}`}
              onClick={() => void requestMeleeAction(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {option.maneuver === "Strike"
                ? "Strike"
                : option.maneuver === "Grapple Attack"
                  ? "Grapple Attack"
                  : `${option.maneuver} (${option.weaponName})`}
            </button>
          ))}
          {shoveActionOptions.map((option) => (
            <button
              key={`shove-${option.weaponItemId ?? "default"}-${option.weaponName}`}
              onClick={() => void requestShoveAction(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {option.weaponItemId ? `Shove (${option.weaponName})` : "Shove"}
            </button>
          ))}
          {disarmActionOptions.map((option) => (
            <button
              key={`disarm-${option.actorWeaponItemId}-${option.targetItemId}`}
              onClick={() => void requestDisarmAction(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Disarm (${option.targetItemName} w/ ${option.actorWeaponName})`}
            </button>
          ))}
          {pickUpActionOptions.map((item) => (
            <button
              key={`pickup-${selectedZoneTarget?.zoneId ?? "zone"}-${item.id}`}
              onClick={() => void requestPickUpAction(item)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Pick Up (${item.name})`}
            </button>
          ))}
          {canUseGetUpFromSelection && (
            <button
              onClick={() => void requestGetUp()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Get Up
            </button>
          )}
          {canUseRunFromSelection && (
            <button
              onClick={() => void requestRun()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Run
            </button>
          )}
          {canPass && (
            <button
              onClick={passTurn}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Pass
            </button>
          )}
          {canPass && currentEntry?.slow_available && (
            <button
              onClick={() => void requestGenericSlow()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Generic Slow
            </button>
          )}
          {canPass && (currentEntry?.fast_available || currentEntry?.slow_available) && (
            <button
              onClick={() => void requestGenericFast()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Generic Fast
            </button>
          )}
        </div>
        {isDmUser && monsterRollResult && (
          <div className="mt-3 rounded-xl border border-amber-600/40 bg-gray-900/70 p-3 text-amber-100">
            <div className="flex items-center justify-between">
              <p className="font-bold text-amber-300">Rolling: {monsterRollResult.actionLabel}</p>
              <p className="font-semibold text-green-300">Successes: {monsterRollResult.successes}</p>
            </div>
            <div className="mt-2 space-y-2 text-xs">
              <p>Attribute Dice: {monsterRollResult.attributeDice.length > 0 ? monsterRollResult.attributeDice.join(", ") : "None"}</p>
              <p>{monsterRollResult.skillIsNegative ? "Skill Dice (Negative): " : "Skill Dice: "}{monsterRollResult.skillDice.length > 0 ? monsterRollResult.skillDice.join(", ") : "None"}</p>
              <p>Gear Dice: {monsterRollResult.gearDice.length > 0 ? monsterRollResult.gearDice.join(", ") : "None"}</p>
            </div>
          </div>
        )}
      </aside>

      <div className="lg:col-span-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
          disabled={!isDmUser || isUploading}
        />

        <div
          ref={mapContainerRef}
          onDragOver={(event) => {
            const hasToken = event.dataTransfer.types.includes("application/x-combat-player-id");
            const hasGenericToken = event.dataTransfer.types.includes("application/x-combat-token-id");
            const hasFile = event.dataTransfer.files && event.dataTransfer.files.length > 0;
            const canAcceptToken = (hasToken || hasGenericToken) && !!mapUrl && !!imageRect;
            const canAcceptFile = hasFile && isDmUser;
            if (!canAcceptToken && !canAcceptFile) return;
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onMouseMove={(event) => {
            if (!imageRect) {
              setZoneHoverInfo(null);
              return;
            }
            const point = toNormalizedPointFromClient(event.clientX, event.clientY);
            if (!point) {
              setZoneHoverInfo(null);
              return;
            }
            const zoneId = zoneIdAtPoint(zoneRegionMap, point);
            if (zoneId === null) {
              setZoneHoverInfo(null);
              return;
            }
            const items = zoneLoot.filter((drop) => drop.zone_id === zoneId).map((drop) => drop.item);
            if (items.length === 0) {
              setZoneHoverInfo(null);
              return;
            }
            const rect = mapContainerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setZoneHoverInfo({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              zoneId,
              items,
            });
          }}
          onMouseLeave={() => setZoneHoverInfo(null)}
          onDrop={onDrop}
          onClick={(event) => {
            const targetNode = event.target as HTMLElement | null;
            if (targetNode?.closest("[data-combat-token='true']")) return;
            if (!imageRect) return;
            const point = toNormalizedPointFromClient(event.clientX, event.clientY);
            if (!point) return;
            const zoneId = zoneIdAtPoint(zoneRegionMap, point);
            if (zoneId === null) return;
            setSelectedTokenId(null);
            setSelectedZoneTarget({ zoneId, point });
          }}
          className={`relative h-full min-h-[520px] overflow-hidden rounded-2xl border transition-all ${
            isDragging ? "border-amber-300 bg-amber-500/10" : "border-amber-500/40 bg-black/20"
          }`}
        >
          {mapUrl ? (
            <>
              <img
                src={mapUrl}
                alt="Battlemap"
                className="h-full w-full object-contain select-none pointer-events-none"
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onLoad={(event) =>
                  setImageNatural({
                    w: event.currentTarget.naturalWidth,
                    h: event.currentTarget.naturalHeight,
                  })
                }
              />
              {imageRect && (
                <svg
                  className={`absolute inset-0 h-full w-full ${canDraw ? "cursor-crosshair" : "pointer-events-none"}`}
                  onDragStart={(event) => event.preventDefault()}
                  style={{ touchAction: "none" }}
                  onPointerDown={onDrawStart}
                  onPointerMove={onDrawMove}
                  onPointerUp={onDrawEnd}
                  onPointerCancel={onDrawEnd}
                >
                  <g transform={`translate(${imageRect.x}, ${imageRect.y})`}>
                    <rect
                      x={0}
                      y={0}
                      width={imageRect.w}
                      height={imageRect.h}
                      fill="none"
                      stroke="black"
                      strokeWidth={4}
                    />
                    {zoneLines.map((stroke, idx) => (
                      <polyline
                        key={`stroke-${idx}`}
                        points={stroke.points
                          .map((point) => `${point.x * imageRect.w},${point.y * imageRect.h}`)
                          .join(" ")}
                        fill="none"
                        stroke="black"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {draftLine && (
                      <polyline
                        points={draftLine.points
                          .map((point) => `${point.x * imageRect.w},${point.y * imageRect.h}`)
                          .join(" ")}
                        fill="none"
                        stroke="black"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                </svg>
              )}
              {showZoneTint && zoneTintUrl && imageRect && (
                <img
                  src={zoneTintUrl}
                  alt="Zone tint preview"
                  className="absolute pointer-events-none"
                  style={{
                    left: imageRect.x,
                    top: imageRect.y,
                    width: imageRect.w,
                    height: imageRect.h,
                  }}
                />
              )}
              {imageRect && (
                <svg className="absolute inset-0 h-full w-full pointer-events-none">
                  {engagements.map((edge, idx) => {
                    const a = tokenByCharacterId.get(edge.a);
                    const b = tokenByCharacterId.get(edge.b);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={`engagement-${idx}-${edge.a}-${edge.b}`}
                        x1={imageRect.x + a.x * imageRect.w}
                        y1={imageRect.y + a.y * imageRect.h}
                        x2={imageRect.x + b.x * imageRect.w}
                        y2={imageRect.y + b.y * imageRect.h}
                        stroke="#60a5fa"
                        strokeWidth={3}
                        strokeDasharray="8 6"
                        opacity={0.95}
                      />
                    );
                  })}
                </svg>
              )}
              {imageRect &&
                renderedTokens.map((token) => {
                  const baseDiameter = 40;
                  const monsterSize =
                    token.type === "monster"
                      ? Math.trunc(monsterByParticipantId.get(token.character_id)?.monster_snapshot?.size ?? 1)
                      : 1;
                  const scale = token.type === "monster" ? Math.pow(2, monsterSize - 1) : 1;
                  const diameter = Number.isFinite(scale) && scale > 0 ? baseDiameter * scale : baseDiameter;
                  const tokenSizeStyle = { width: `${diameter}px`, height: `${diameter}px` };
                  const tokenEntry = initiativeEntries.find(
                    (entry) =>
                      entry.participant_id === token.character_id ||
                      entry.participant_id === `player:${token.character_id}`
                  );
                  let displayX = token.x;
                  let displayY = token.y;
                  const attachedTargetId = tokenEntry?.grappling_target_id || tokenEntry?.clinging_target_id || null;
                  if (attachedTargetId) {
                    const targetToken = tokenByCharacterId.get(attachedTargetId);
                    if (targetToken) {
                      const targetIsMonster = attachedTargetId.startsWith("monster:");
                      const targetSize = targetIsMonster
                        ? Math.trunc(monsterByParticipantId.get(attachedTargetId)?.monster_snapshot?.size ?? 1)
                        : 1;
                      const targetScale = targetIsMonster ? Math.pow(2, targetSize - 1) : 1;
                      const targetDiameter =
                        Number.isFinite(targetScale) && targetScale > 0 ? baseDiameter * targetScale : baseDiameter;
                      const dx = token.x - targetToken.x;
                      const dy = token.y - targetToken.y;
                      const dist = Math.hypot(dx, dy);
                      const unitX = dist > 0.0001 ? dx / dist : 1;
                      const unitY = dist > 0.0001 ? dy / dist : 0;
                      const desiredPx = diameter / 2 + targetDiameter / 2;
                      displayX = targetToken.x + (unitX * desiredPx) / imageRect.w;
                      displayY = targetToken.y + (unitY * desiredPx) / imageRect.h;
                    }
                  }
                  return (
                  <div
                    key={token.character_id}
                    data-combat-token="true"
                    draggable={draggableTokenCharacterIds.has(token.character_id)}
                    onDragStart={(event) => {
                      if (!draggableTokenCharacterIds.has(token.character_id)) return;
                      draggedTokenRef.current = token.character_id;
                      event.dataTransfer.setData("application/x-combat-token-id", token.character_id);
                      event.dataTransfer.setData("application/x-combat-player-id", token.character_id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      window.setTimeout(() => {
                        draggedTokenRef.current = null;
                      }, 0);
                    }}
                    onClick={() => {
                      if (draggedTokenRef.current === token.character_id) return;
                      setSelectedZoneTarget(null);
                      setSelectedTokenId((prev) => (prev === token.character_id ? null : token.character_id));
                    }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                      draggableTokenCharacterIds.has(token.character_id)
                        ? "cursor-grab active:cursor-grabbing"
                        : "cursor-default"
                    }`}
                    style={{
                      left: imageRect.x + displayX * imageRect.w,
                      top: imageRect.y + displayY * imageRect.h,
                    }}
                    title={token.tooltip}
                  >
                    {token.icon_url ? (
                      <img
                        src={token.icon_url}
                        alt={token.name}
                        draggable={false}
                        className="rounded-full border-2 border-amber-200/90 object-cover shadow-lg"
                        style={tokenSizeStyle}
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-full border-2 border-amber-200/90 bg-gray-800 text-xs font-bold text-amber-100 shadow-lg"
                        style={tokenSizeStyle}
                      >
                        {token.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  );
                })}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <h2 className="text-2xl font-bold text-amber-300">VTT Map</h2>
              <p className="mt-3 text-amber-100/70">
                {isDmUser ? "Drag and drop a battlemap image here." : "No battlemap has been uploaded yet."}
              </p>
            </div>
          )}

          {isDmUser && (
            <div className="absolute bottom-4 left-4 flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-gray-900 shadow hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isUploading ? "Uploading..." : "Upload Battlemap"}
              </button>
              {mapUrl && (
                <button
                  onClick={clearZones}
                  className="rounded-lg bg-gray-700 px-4 py-2 font-semibold text-amber-100 shadow hover:bg-gray-600"
                >
                  Clear Zones
                </button>
              )}
              {mapUrl && (
                <button
                  onClick={() => setShowZoneTint((prev) => !prev)}
                  className={`rounded-lg px-4 py-2 font-semibold shadow ${
                    showZoneTint
                      ? "bg-emerald-600 hover:bg-emerald-500 text-emerald-100"
                      : "bg-gray-700 hover:bg-gray-600 text-amber-100"
                  }`}
                >
                  Zone Tint {showZoneTint ? "On" : "Off"}
                </button>
              )}
            </div>
          )}

          {zoneHoverInfo && (
            <div
              className="pointer-events-none absolute z-20 max-w-[280px] rounded border border-amber-400/80 bg-gray-900/95 px-2 py-1 text-xs text-amber-100 shadow-xl"
              style={{
                left: Math.min(zoneHoverInfo.x + 12, (mapContainerRef.current?.clientWidth ?? 0) - 290),
                top: Math.max(8, zoneHoverInfo.y - 8),
              }}
            >
              <div className="font-semibold text-amber-300">{`Zone ${zoneHoverInfo.zoneId}`}</div>
              <div>{zoneHoverInfo.items.map((item) => item.name).join(", ")}</div>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      <aside className="min-h-[520px] max-h-[520px] rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-amber-300">Initiative</h3>
          <div className="text-xs text-amber-200/80">
            {currentEntry ? `Turn: ${currentEntry.name}` : "No turn"}
          </div>
        </div>

        {isDmUser && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={rollInitiative}
              className="rounded bg-amber-500 px-3 py-1 text-sm font-semibold text-gray-900 hover:bg-amber-400"
            >
              Roll
            </button>
            <button
              onClick={resetInitiative}
              className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Reset
            </button>
          </div>
        )}

        {isDmUser && (
          <div className="mb-3 rounded border border-amber-500/20 bg-gray-900/30 p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300/90">
              Deploy Monsters
            </div>
            <div className="flex gap-2">
              <input
                value={deployMonsterQuery}
                onChange={(event) => setDeployMonsterQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void deployMonsterFromQuery();
                  }
                }}
                className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-amber-100 outline-none ring-1 ring-gray-600 focus:ring-amber-400"
                placeholder="Type monster name (optional xN)"
              />
              <button
                onClick={() => void deployMonsterFromQuery()}
                className="rounded bg-gray-700 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-gray-600"
              >
                Add
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 overflow-y-auto pr-1 flex-1">
          {displayedInitiativeEntries.length === 0 && (
            <div className="rounded border border-dashed border-amber-500/30 bg-gray-900/30 p-3 text-sm text-amber-100/70">
              No initiative rolled.
            </div>
          )}

          {displayedInitiativeEntries.map((entry, index) => {
            const isCurrent = index === initiativeCurrentIndex;
            const nameDraft = monsterNameDrafts[entry.participant_id] ?? entry.name;
            const isPlayer = entry.kind === "player" && entry.participant_id.startsWith("player:");
            const playerCharacterId = isPlayer ? entry.participant_id.slice("player:".length) : null;
            const draggableToken =
              (isPlayer && canPlaceTokenFor(entry.user_email)) || (entry.kind === "monster" && isDmUser);
            const dragTokenId = isPlayer ? playerCharacterId : entry.participant_id;
            const entryTitle =
              isDmUser && entry.kind === "monster" && entry.monster_snapshot
                ? formatMonsterTooltip(entry.monster_snapshot)
                : entry.name;

            return (
              <div
                key={entry.participant_id}
                draggable={draggableToken}
                onDragStart={(event) => {
                  if (!draggableToken || !dragTokenId) return;
                  event.dataTransfer.setData("application/x-combat-token-id", dragTokenId);
                  event.dataTransfer.setData("application/x-combat-player-id", dragTokenId);
                  event.dataTransfer.effectAllowed = "move";
                }}
                title={entryTitle}
                className={`flex items-center gap-2 rounded p-2 ${
                  isCurrent ? "bg-amber-500/20 border border-amber-400/70" : "bg-gray-900/40 border border-transparent"
                } ${draggableToken ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {entry.icon_url ? (
                  <img src={entry.icon_url} alt={entry.name} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs text-amber-100">
                    {entry.kind === "monster" ? "M" : "P"}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  {isDmUser && entry.kind === "monster" ? (
                    <input
                      value={nameDraft}
                      onChange={(event) =>
                        setMonsterNameDrafts((prev) => ({
                          ...prev,
                          [entry.participant_id]: event.target.value,
                        }))
                      }
                      onBlur={() => renameMonster(entry.participant_id, nameDraft)}
                      className="w-full rounded bg-gray-800 px-2 py-1 text-sm text-amber-100 outline-none ring-1 ring-gray-600 focus:ring-amber-400"
                    />
                  ) : (
                    <div className="truncate text-sm text-amber-100">{entry.name}</div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      entry.slow_available ? "bg-green-500" : "bg-green-900/50 ring-1 ring-green-700"
                    }`}
                    title="Slow Action"
                  />
                  <span
                    className={`inline-block h-0 w-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent ${
                      entry.fast_available ? "border-b-orange-500" : "border-b-orange-900/50"
                    }`}
                    title="Fast Action"
                  />
                </div>

                <div className="text-sm font-bold text-amber-300">{entry.roll === null ? "—" : formatRoll(entry.roll)}</div>
                {isDmUser && entry.kind === "monster" && (
                  <button
                    onClick={() => deleteMonster(entry.participant_id)}
                    className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-red-100 hover:bg-red-600"
                    title="Delete monster"
                  >
                    X
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
