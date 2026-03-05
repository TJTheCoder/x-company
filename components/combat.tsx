"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InventoryItem, ResolvedMeleeAttack } from "@/app/protected/page";
import { addItemToInventory, isImplementedItem, normalizeInventoryItems } from "@/lib/item-catalog";
import { buildMonsterSnapshot, formatMonsterTooltip } from "@/lib/monsters";
import type { MonsterSnapshot, MonsterTemplate } from "@/lib/monsters";
import {
  ARTS_CHOSEN_FLAG,
  DODGED_FLAG,
  PARRIED_FLAG,
  findIncomingDamageFlag,
  findIncomingDamageMetaFlag,
  isIncomingDamageMetaFlag,
} from "@/lib/combat-flags";
import artsCatalogData from "../data/arts.json";
import * as combatModel from "./combat/model";
import * as combatActions from "./combat/actions";

type CombatProps = combatModel.CombatProps;
type ZonePoint = combatModel.ZonePoint;
type ZoneStroke = combatModel.ZoneStroke;
type InitiativeMonster = combatModel.InitiativeMonster;
type InitiativeEntry = combatModel.InitiativeEntry;
type CharacterLite = combatModel.CharacterLite;
type ZoneLootDrop = combatModel.ZoneLootDrop;
type CombatStateRow = combatModel.CombatStateRow;
type CombatStateMutationRow = combatModel.CombatStateMutationRow;
type PendingReaction = combatModel.PendingReaction;
type TokenPosition = combatModel.TokenPosition;
type TokenElevation = combatModel.TokenElevation;
type RenderedToken = combatModel.RenderedToken;
type EngagementEdge = combatModel.EngagementEdge;
type ImageRect = combatModel.ImageRect;
type MonsterRollResult = combatModel.MonsterRollResult;
type AttributeKey = combatModel.AttributeKey;
type CombatRange = combatModel.CombatRange;

const {
  MAP_BUCKET,
  DM_EMAIL,
  REACTION_MANEUVER_SET,
  skillAttributeFor,
  normalizeEmail,
  normalizeZoneLines,
  rollUnique,
  rollUniqueFromBase,
  rollHighestOfD10Unique,
  formatRoll,
  rollSortValue,
  buildZoneTintDataUrl,
  normalizeInitiativeEntries,
  normalizeTokenPositions,
  normalizeTokenElevations,
  normalizeEngagements,
  normalizeZoneLoot,
  normalizeZoneCover,
  normalizePendingReactions,
  buildZoneRegionMap,
  zoneIdAtPoint,
  buildZoneAdjacency,
  shortestZoneDistance,
  rangeFromLateralAndVerticalDistance,
  areTokensEngaged,
  weaponSupportsRange,
  tokenSideOf,
  getPhysicalBrokenAttributes,
  getMentalBrokenAttributes,
  rollD6Pool,
  formatCharacterTooltip,
  formatMonsterPublicTooltip,
  slotMatchesItem,
  monsterEquippedMeleeWeapons,
  monsterEquippedShields,
  playerHeldItems,
  playerEquippedMeleeWeapons,
  isParryingWeapon,
  playerEquippedRangedWeapons,
  monsterEquippedRangedWeapons,
  isAmmunition,
  readiedHandForWeapon,
  consumeFirstAmmo,
  cycleMonsterDrawGear,
} = combatModel;

const FLAMING_LONGSWORD_PROPERTY = "flaming longsword";
const FLAMING_LONGSWORD_USED_FLAG = "Used (Flaming Longsword)";
const LAMP_OIL_KEY = "lamp oil";
const FAST_FOOTWORK_TALENT_ID = "talent-fast-footwork";
const LIGHTNING_FAST_TALENT_ID = "talent-lightning-fast";
const FIRST_MONSTER_TRAIT = "first";
const BLITZ_MONSTER_TRAIT = "blitz";
const artsCatalog = artsCatalogData as Array<{
  id: string;
  name: string;
  cost: string;
}>;

type ParsedArtCost = {
  minSuccesses: number;
  hasScaling: boolean;
  scaleStep: number;
};

const parseArtCost = (cost: string): ParsedArtCost => {
  const normalized = cost.replace(/\s+/g, "").toUpperCase();

  if (/^\d+$/.test(normalized)) {
    return { minSuccesses: parseInt(normalized, 10), hasScaling: false, scaleStep: 0 };
  }

  const xOnly = normalized.match(/^(\d*)X$/);
  if (xOnly) {
    const coeff = xOnly[1] ? parseInt(xOnly[1], 10) : 1;
    return { minSuccesses: 0, hasScaling: true, scaleStep: Math.max(1, coeff) };
  }

  const withPlus = normalized.match(/^(\d+)\+(\d*)X$/);
  if (withPlus) {
    const min = parseInt(withPlus[1], 10);
    const coeff = withPlus[2] ? parseInt(withPlus[2], 10) : 1;
    return { minSuccesses: min, hasScaling: true, scaleStep: Math.max(1, coeff) };
  }

  return { minSuccesses: 0, hasScaling: false, scaleStep: 0 };
};

const tokenIdFromParticipantId = (participantId: string | null | undefined): string | null => {
  const raw = String(participantId || "").trim();
  if (!raw) return null;
  return raw.startsWith("player:") ? raw.slice("player:".length) : raw;
};

type GroupedItemDisplay = {
  key: string;
  label: string;
  count: number;
  representative: InventoryItem;
  candidateIds: string[];
};

const itemGroupingKey = (item: InventoryItem): string => {
  const name = String(item.name || "").trim().toLowerCase();
  const gear = typeof item.gearBonus === "number" && !Number.isNaN(item.gearBonus) ? Math.trunc(item.gearBonus) : null;
  return `${name}::${gear ?? "none"}`;
};

const itemGroupingLabel = (item: InventoryItem): string => {
  const gear = typeof item.gearBonus === "number" && !Number.isNaN(item.gearBonus) ? Math.trunc(item.gearBonus) : null;
  if (gear !== null) return `${item.name} (+${gear})`;
  return item.name;
};

const groupItemsForDisplay = (items: InventoryItem[]): GroupedItemDisplay[] => {
  const groups = new Map<string, GroupedItemDisplay>();
  for (const item of items) {
    const key = itemGroupingKey(item);
    const countDelta = Math.max(1, Math.trunc(item.quantity ?? 1));
    const existing = groups.get(key);
    if (existing) {
      existing.count += countDelta;
      existing.candidateIds.push(item.id);
      continue;
    }
    groups.set(key, {
      key,
      label: itemGroupingLabel(item),
      count: countDelta,
      representative: item,
      candidateIds: [item.id],
    });
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const hasTalentLevelAtLeast = (
  character: CharacterLite | null | undefined,
  talentId: string,
  minLevel: number
): boolean => {
  if (!character) return false;
  const levels = character.talent_levels || {};
  const mapLevelRaw = levels[talentId];
  const mapLevel = typeof mapLevelRaw === "number" && Number.isFinite(mapLevelRaw) ? Math.trunc(mapLevelRaw) : 0;
  const listLevel = (character.talents || []).reduce((best, talent) => {
    if (!talent || talent.id !== talentId) return best;
    const lvl = typeof talent.level === "number" && Number.isFinite(talent.level) ? Math.trunc(talent.level) : 0;
    return Math.max(best, lvl);
  }, 0);
  return Math.max(mapLevel, listLevel) >= minLevel;
};

const lightningFastInitiativeRollCount = (character: CharacterLite | null | undefined): number => {
  if (hasTalentLevelAtLeast(character, LIGHTNING_FAST_TALENT_ID, 3)) return 4;
  if (hasTalentLevelAtLeast(character, LIGHTNING_FAST_TALENT_ID, 2)) return 3;
  if (hasTalentLevelAtLeast(character, LIGHTNING_FAST_TALENT_ID, 1)) return 2;
  return 1;
};

const monsterHasTrait = (snapshot: MonsterSnapshot | null | undefined, traitName: string): boolean => {
  const normalized = traitName.trim().toLowerCase();
  if (!normalized) return false;
  return (snapshot?.traits || []).some((trait) => trait.trim().toLowerCase() === normalized);
};

export default function Combat({
  isDM,
  userEmail,
  onRequestDrawGear,
  character,
  onQueueMeleeAction,
  onQueueReactionRoll,
  onResolveReactionRoll,
  onResolveMeleeAttack,
  onApplyStartOfTurnEffects,
  pendingArmorPrompt,
  onConsumeArmorPrompt,
  onArmorPromptPass,
  pendingArtPrompt,
  onConsumeArtPrompt,
  onArtPromptPass,
  onArtPromptRoll,
  pendingArtRoll,
  onConsumePendingArtRoll,
  onResolveArtRoll,
  onArtRollCleared,
}: CombatProps) {
  const DEFAULT_COMBAT_PANEL_HEIGHT = 520;
  const MIN_COMBAT_PANEL_HEIGHT = 420;
  const MAX_COMBAT_PANEL_HEIGHT = 920;
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [zoneLines, setZoneLines] = useState<ZoneStroke[]>([]);
  const [tokenPositions, setTokenPositions] = useState<TokenPosition[]>([]);
  const [tokenElevations, setTokenElevations] = useState<TokenElevation[]>([]);
  const [engagements, setEngagements] = useState<EngagementEdge[]>([]);
  const [combatMode, setCombatMode] = useState(false);
  const [initiativeMonsters, setInitiativeMonsters] = useState<InitiativeMonster[]>([]);
  const [monsterTemplates, setMonsterTemplates] = useState<MonsterTemplate[]>([]);
  const [deployMonsterQuery, setDeployMonsterQuery] = useState("");
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeCurrentIndex, setInitiativeCurrentIndex] = useState<number | null>(null);
  const [zoneLoot, setZoneLoot] = useState<ZoneLootDrop[]>([]);
  const [zoneCoverIds, setZoneCoverIds] = useState<number[]>([]);
  const [pendingReactions, setPendingReactions] = useState<PendingReaction[]>([]);
  const [zoneHoverInfo, setZoneHoverInfo] = useState<{
    x: number;
    y: number;
    zoneId: number;
    items: InventoryItem[];
    hasCover: boolean;
  } | null>(null);
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
  const [isResolvingReaction, setIsResolvingReaction] = useState(false);
  const [combatPanelHeight, setCombatPanelHeight] = useState(DEFAULT_COMBAT_PANEL_HEIGHT);
  const [imageNatural, setImageNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const isSyncingRef = useRef(false);
  const handledInvalidReadiedRef = useRef<string | null>(null);
  const handledPendingMonsterArtRollIdRef = useRef<string | null>(null);
  const handledSlashArtsPhaseRef = useRef<Set<string>>(new Set());
  const tauntAngerTurnCheckedParticipantRef = useRef<string | null>(null);
  const startOfTurnEffectsCheckedParticipantRef = useRef<string | null>(null);
  const isResizingPanelRef = useRef(false);
  const resizePanelStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const draggedTokenRef = useRef<string | null>(null);

  const isDmUser = isDM && normalizeEmail(userEmail || "") === normalizeEmail(DM_EMAIL);
  const isDmViewer = isDM;
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
        covered: false,
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
        covered: false,
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
  const currentEntryTokenId = useMemo(
    () => tokenIdFromParticipantId(currentEntry?.participant_id),
    [currentEntry]
  );
  const actorCharacter =
    currentEntry?.kind === "player" && currentEntryTokenId
      ? characters.find((char) => char.id === currentEntryTokenId) || null
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
  const selectedZoneLootSummary = useMemo(
    () => groupItemsForDisplay(selectedZoneLootItems),
    [selectedZoneLootItems]
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
  const initiativeEntryByTokenId = useMemo(() => {
    const map = new Map<string, InitiativeEntry>();
    for (const entry of initiativeEntries) {
      const tokenId = entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (!tokenId) continue;
      map.set(tokenId, entry);
    }
    return map;
  }, [initiativeEntries]);
  const combatSideOfToken = useCallback(
    (tokenId: string): combatModel.TokenSide => {
      if (!tokenId) return "player";
      const normalized = tokenId.replace(/^player:/, "");
      const entry = initiativeEntryByTokenId.get(normalized) || null;
      if (entry?.kind === "monster") {
        return monsterHasTrait(entry.monster_snapshot, "ally") ? "player" : "monster";
      }
      if (normalized.startsWith("monster:")) {
        const snapshot = monsterByParticipantId.get(normalized)?.monster_snapshot || null;
        return monsterHasTrait(snapshot, "ally") ? "player" : "monster";
      }
      return tokenSideOf(normalized);
    },
    [initiativeEntryByTokenId, monsterByParticipantId]
  );
  const tokenElevationByCharacterId = useMemo(() => {
    const map = new Map<string, number>();
    for (const token of tokenElevations) {
      map.set(token.character_id, Math.max(0, Math.trunc(token.elevation)));
    }
    return map;
  }, [tokenElevations]);
  const isTokenCovered = useCallback(
    (tokenId: string | null | undefined): boolean => {
      if (!tokenId) return false;
      const entry =
        initiativeEntries.find(
          (e) => e.participant_id === tokenId || e.participant_id === `player:${tokenId}`
        ) || null;
      return Boolean(entry?.covered);
    },
    [initiativeEntries]
  );
  const characterById = useMemo(() => {
    const map = new Map<string, CharacterLite>();
    for (const c of characters) map.set(c.id, c);
    return map;
  }, [characters]);
  const clingersByTarget = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of initiativeEntries) {
      const clingingTargetId = entry.clinging_target_id;
      if (!clingingTargetId) continue;
      const clingerTokenId = entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (!map.has(clingingTargetId)) map.set(clingingTargetId, []);
      map.get(clingingTargetId)!.push(clingerTokenId);
    }
    for (const [, ids] of map) {
      ids.sort();
    }
    return map;
  }, [initiativeEntries]);
  const actorTokenId = currentEntryTokenId;
  const currentUserTokenId = isDmUser ? null : character?.id ?? null;
  const actorTokenCharacter = actorTokenId ? characters.find((char) => char.id === actorTokenId) || null : null;
  const tokenStateById = useMemo(() => {
    const map = new Map<
      string,
      {
        dead: boolean;
        physicalBroken: boolean;
        mentalBroken: boolean;
        physicalBrokenAttrs: string[];
        mentalBrokenAttrs: string[];
      }
    >();
    // Seed from persisted records so Dead/Broken survives initiative reset.
    for (const character of characters) {
      const p = getPhysicalBrokenAttributes(character.attributes);
      const m = getMentalBrokenAttributes(character.attributes);
      map.set(character.id, {
        dead: Boolean(character.dead),
        physicalBroken: p.length > 0,
        mentalBroken: m.length > 0,
        physicalBrokenAttrs: p,
        mentalBrokenAttrs: m,
      });
    }
    for (const monster of initiativeMonsters) {
      const snap = monster.monster_snapshot || null;
      const p = getPhysicalBrokenAttributes({ STR: snap?.str, AGL: snap?.agl });
      const m = getMentalBrokenAttributes({ WIT: snap?.wit, EMP: snap?.emp });
      map.set(monster.id, {
        dead: Boolean(snap?.dead),
        physicalBroken: p.length > 0,
        mentalBroken: m.length > 0,
        physicalBrokenAttrs: p,
        mentalBrokenAttrs: m,
      });
    }

    for (const entry of initiativeEntries) {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (!tokenId) continue;
      const existing = map.get(tokenId);
      if (entry.kind === "player") {
        const c = characterById.get(tokenId);
        const p = c
          ? getPhysicalBrokenAttributes(c.attributes)
          : existing?.physicalBrokenAttrs || [];
        const m = c
          ? getMentalBrokenAttributes(c.attributes)
          : existing?.mentalBrokenAttrs || [];
        map.set(tokenId, {
          dead: Boolean(existing?.dead || c?.dead || entry.dead),
          physicalBroken: Boolean(existing?.physicalBroken) || p.length > 0,
          mentalBroken: Boolean(existing?.mentalBroken) || m.length > 0,
          physicalBrokenAttrs: p,
          mentalBrokenAttrs: m,
        });
      } else {
        const snap = entry.monster_snapshot || monsterByParticipantId.get(tokenId)?.monster_snapshot || null;
        const p = getPhysicalBrokenAttributes({ STR: snap?.str, AGL: snap?.agl });
        const m = getMentalBrokenAttributes({ WIT: snap?.wit, EMP: snap?.emp });
        map.set(tokenId, {
          dead: Boolean(existing?.dead || entry.dead || snap?.dead),
          physicalBroken: Boolean(existing?.physicalBroken) || p.length > 0,
          mentalBroken: Boolean(existing?.mentalBroken) || m.length > 0,
          physicalBrokenAttrs: p,
          mentalBrokenAttrs: m,
        });
      }
    }
    return map;
  }, [initiativeEntries, characters, initiativeMonsters, characterById, monsterByParticipantId]);
  const currentUserEntry = useMemo(() => {
    if (!currentUserTokenId) return null;
    return (
      initiativeEntries.find(
        (entry) =>
          entry.participant_id === currentUserTokenId || entry.participant_id === `player:${currentUserTokenId}`
      ) || null
    );
  }, [initiativeEntries, currentUserTokenId]);
  const currentUserState = currentUserTokenId ? tokenStateById.get(currentUserTokenId) || null : null;
  const actorState = actorTokenId
    ? tokenStateById.get(actorTokenId) || {
        dead: false,
        physicalBroken: false,
        mentalBroken: false,
        physicalBrokenAttrs: [] as string[],
        mentalBrokenAttrs: [] as string[],
      }
    : {
        dead: false,
        physicalBroken: false,
        mentalBroken: false,
        physicalBrokenAttrs: [] as string[],
        mentalBrokenAttrs: [] as string[],
      };
  const attributeValueForToken = useCallback(
    (tokenId: string | null | undefined, attribute: AttributeKey): number => {
      if (!tokenId) return 0;
      const entry =
        initiativeEntries.find(
          (item) => item.participant_id === tokenId || item.participant_id === `player:${tokenId}`
        ) || null;
      if (entry?.kind === "monster") {
        const snap = entry.monster_snapshot || monsterByParticipantId.get(tokenId)?.monster_snapshot || null;
        if (!snap) return 0;
        if (attribute === "STR") return snap.str ?? 0;
        if (attribute === "AGL") return snap.agl ?? 0;
        if (attribute === "WIT") return snap.wit ?? 0;
        return snap.emp ?? 0;
      }
      const char = characterById.get(tokenId);
      return char?.attributes?.[attribute] ?? 0;
    },
    [initiativeEntries, monsterByParticipantId, characterById]
  );
  const isSkillBlockedForToken = useCallback(
    (tokenId: string | null | undefined, skillName: string): boolean => {
      const attr = skillAttributeFor(skillName);
      if (!attr) return false;
      return attributeValueForToken(tokenId, attr) <= 0;
    },
    [attributeValueForToken]
  );
  const isLampOilItem = useCallback((item: InventoryItem | null | undefined): boolean => {
    if (!item) return false;
    const key = (item.item_key || "").trim().toLowerCase();
    const name = (item.name || "").trim().toLowerCase();
    return key === LAMP_OIL_KEY || name === "lamp oil";
  }, []);
  const isFlamingLongswordItem = useCallback((item: InventoryItem | null | undefined): boolean => {
    if (!item) return false;
    const name = String(item.name || "").trim().toLowerCase();
    const key = String(item.item_key || "").trim().toLowerCase();
    const props = Array.isArray(item.properties) ? item.properties : [];
    const hasFlaggedProperty = props.some((prop) => String(prop).trim().toLowerCase() === FLAMING_LONGSWORD_PROPERTY);
    // Accept legacy rows where item_type/properties may be missing but name/key already identifies it.
    return hasFlaggedProperty || name === "flaming longsword" || key === "flaming longsword";
  }, []);
  const actorDead = actorState.dead;
  const actorPhysicalBroken = actorState.physicalBroken;
  const actorMentalBroken = actorState.mentalBroken;
  const actorElevation = actorTokenId ? tokenElevationByCharacterId.get(actorTokenId) ?? 0 : 0;
  const isActorCovered = Boolean(currentEntry?.covered);
  const actorRestrictedToCrawl = actorPhysicalBroken;
  const actorRestrictedToRun = !actorRestrictedToCrawl && actorMentalBroken;
  const tokenElevationForTokenId = useCallback(
    (tokenId: string | null | undefined): number => {
      if (!tokenId) return 0;
      return tokenElevationByCharacterId.get(tokenId) ?? 0;
    },
    [tokenElevationByCharacterId]
  );
  const areTokensEngagedAtSameElevation = useCallback(
    (sourceTokenId: string | null | undefined, targetTokenId: string | null | undefined): boolean => {
      if (!sourceTokenId || !targetTokenId || sourceTokenId === targetTokenId) return false;
      if (!areTokensEngaged(sourceTokenId, targetTokenId, engagements)) return false;
      return tokenElevationForTokenId(sourceTokenId) === tokenElevationForTokenId(targetTokenId);
    },
    [engagements, tokenElevationForTokenId]
  );
  const isActorEngaged = useMemo(() => {
    if (!actorTokenId) return false;
    for (const token of tokenPositions) {
      if (token.character_id === actorTokenId) continue;
      if (areTokensEngagedAtSameElevation(actorTokenId, token.character_id)) return true;
    }
    return false;
  }, [actorTokenId, tokenPositions, areTokensEngagedAtSameElevation]);
  const actorZoneId = useMemo(() => {
    if (!actorTokenId) return null;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return null;
    return zoneIdAtPoint(zoneRegionMap, actorToken);
  }, [actorTokenId, tokenByCharacterId, zoneRegionMap]);
  const actorZoneHasCover = actorZoneId !== null && zoneCoverIds.includes(actorZoneId);
  const isTokenEnemyEngaged = useCallback(
    (tokenId: string | null | undefined): boolean => {
      if (!tokenId) return false;
      const tokenSide = combatSideOfToken(tokenId);
      for (const token of tokenPositions) {
        if (token.character_id === tokenId) continue;
        if (combatSideOfToken(token.character_id) === tokenSide) continue;
        if (areTokensEngagedAtSameElevation(tokenId, token.character_id)) return true;
      }
      return false;
    },
    [tokenPositions, areTokensEngagedAtSameElevation, combatSideOfToken]
  );
  const actorHasFlightTrait = useMemo(() => {
    if (currentEntry?.kind !== "monster") return false;
    return monsterHasTrait(currentEntry.monster_snapshot, "flight");
  }, [currentEntry]);
  const closestEnemyRange = useMemo<CombatRange | null>(() => {
    if (!actorTokenId) return null;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return null;
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (actorZone === null) return null;
    const actorVertical = tokenElevationForTokenId(actorTokenId);
    let closestEffective: number | null = null;
    for (const token of tokenPositions) {
      if (token.character_id === actorTokenId) continue;
      if (combatSideOfToken(token.character_id) === combatSideOfToken(actorTokenId)) continue;
      const targetZone = zoneIdAtPoint(zoneRegionMap, token);
      if (targetZone === null) continue;
      const lateralDistance = shortestZoneDistance(actorZone, targetZone, zoneAdjacency);
      if (lateralDistance === null) continue;
      const verticalDistance = Math.abs(actorVertical - tokenElevationForTokenId(token.character_id));
      const effectiveDistance = Math.max(lateralDistance, verticalDistance);
      if (closestEffective === null || effectiveDistance < closestEffective) {
        closestEffective = effectiveDistance;
      }
    }
    return rangeFromLateralAndVerticalDistance(closestEffective, 0);
  }, [actorTokenId, tokenByCharacterId, tokenPositions, zoneAdjacency, zoneRegionMap, tokenElevationForTokenId, combatSideOfToken]);
  const fleeRangeBonus = useMemo(() => {
    if (closestEnemyRange === "Near") return -1;
    if (closestEnemyRange === "Long") return 1;
    return 0;
  }, [closestEnemyRange]);
  const isActorSoleUnbrokenInEngagement = useMemo(() => {
    if (!actorTokenId) return false;
    if (!engagements.some((edge) => edge.a === actorTokenId || edge.b === actorTokenId)) return false;

    const component = new Set<string>([actorTokenId]);
    const queue: string[] = [actorTokenId];
    while (queue.length > 0) {
      const tokenId = queue.shift()!;
      for (const edge of engagements) {
        const neighbor = edge.a === tokenId ? edge.b : edge.b === tokenId ? edge.a : null;
        if (!neighbor || component.has(neighbor)) continue;
        component.add(neighbor);
        queue.push(neighbor);
      }
    }

    let actorUnbroken = false;
    let unbrokenCount = 0;
    for (const tokenId of component) {
      const state = tokenStateById.get(tokenId);
      const broken = !state ? false : state.dead || state.physicalBroken || state.mentalBroken;
      if (!broken) {
        unbrokenCount += 1;
        if (tokenId === actorTokenId) actorUnbroken = true;
      }
    }

    return actorUnbroken && unbrokenCount === 1;
  }, [actorTokenId, engagements, tokenStateById]);
  const isActorAlliedOnlyEngagement = useMemo(() => {
    if (!actorTokenId) return false;
    if (!engagements.some((edge) => edge.a === actorTokenId || edge.b === actorTokenId)) return false;
    const actorSide = combatSideOfToken(actorTokenId);

    const component = new Set<string>([actorTokenId]);
    const queue: string[] = [actorTokenId];
    while (queue.length > 0) {
      const tokenId = queue.shift()!;
      for (const edge of engagements) {
        const neighbor = edge.a === tokenId ? edge.b : edge.b === tokenId ? edge.a : null;
        if (!neighbor || component.has(neighbor)) continue;
        component.add(neighbor);
        queue.push(neighbor);
      }
    }

    for (const tokenId of component) {
      if (combatSideOfToken(tokenId) !== actorSide) return false;
    }
    return true;
  }, [actorTokenId, engagements, combatSideOfToken]);
  const isFreeRetreatAvailable = isActorSoleUnbrokenInEngagement || isActorAlliedOnlyEngagement;
  const isActorProne = Boolean(currentEntry?.prone);
  const actorGrapplingTargetId = currentEntry?.grappling_target_id ?? null;
  const actorGrappledById = currentEntry?.grappled_by_id ?? null;
  const actorClingingTargetId = currentEntry?.clinging_target_id ?? null;
  const actorClungOntoByIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of currentEntry?.clung_onto_by_ids || []) {
      if (id) ids.add(id);
    }
    if (currentEntry?.clung_onto_by_id) ids.add(currentEntry.clung_onto_by_id);
    return Array.from(ids);
  }, [currentEntry]);
  const isActorGrappling = Boolean(actorGrapplingTargetId);
  const isActorGrappled = Boolean(actorGrappledById);
  const isActorClinging = Boolean(actorClingingTargetId);
  const isActorClungOnto = actorClungOntoByIds.length > 0;
  const actorHardLockedByHold = isActorGrappling || isActorGrappled || isActorClinging;
  const findEntryForTokenId = useCallback(
    (tokenId: string | null | undefined): InitiativeEntry | null => {
      if (!tokenId) return null;
      return (
        initiativeEntries.find(
          (entry) => entry.participant_id === tokenId || entry.participant_id === `player:${tokenId}`
        ) || null
      );
    },
    [initiativeEntries]
  );
  const actorTauntedAngerById = currentEntry?.taunted_anger_by_id ?? null;
  const actorTauntedAngerByName = currentEntry?.taunted_anger_by_name ?? null;
  const actorTauntedDistractValue = Math.max(0, currentEntry?.taunted_distract_value ?? 0);
  const actorFlameIntensity = Math.max(0, currentEntry?.flame_intensity ?? 0);
  const actorUsedItemFlagList = useMemo(
    () => (currentEntry?.used_item_flags || []).filter((value): value is string => typeof value === "string"),
    [currentEntry]
  );
  const actorUsedItemFlags = useMemo(() => new Set(actorUsedItemFlagList), [actorUsedItemFlagList]);
  const slashIncomingDamage = useMemo(() => {
    const record = findIncomingDamageFlag(actorUsedItemFlagList);
    if (!record) return null;
    if (
      record.value.type !== "Slash" &&
      record.value.type !== "Stab" &&
      record.value.type !== "Strike" &&
      record.value.type !== "Shoot" &&
      record.value.type !== "Flame" &&
      record.value.type !== "Grapple" &&
      record.value.type !== "Cling" &&
      record.value.type !== "Shove" &&
      record.value.type !== "Disarm" &&
      record.value.type !== "Feint"
    ) {
      return null;
    }
    return record.value;
  }, [actorUsedItemFlagList]);
  const slashIncomingMeta = useMemo(() => {
    const record = findIncomingDamageMetaFlag(actorUsedItemFlagList);
    return record?.value ?? null;
  }, [actorUsedItemFlagList]);
  const flowManeuverForIncomingType = useCallback(
    (
      type: string | null | undefined
    ): "Slash" | "Stab" | "Strike" | "Shoot" | "Flame" | "Grapple" | "Cling" | "Shove" | "Disarm" | "Feint" => {
      if (type === "Stab") return "Stab";
      if (type === "Strike") return "Strike";
      if (type === "Shoot") return "Shoot";
      if (type === "Flame") return "Flame";
      if (type === "Grapple") return "Grapple";
      if (type === "Cling") return "Cling";
      if (type === "Shove") return "Shove";
      if (type === "Disarm") return "Disarm";
      if (type === "Feint") return "Feint";
      return "Slash";
    },
    []
  );
  const slashIncomingAttackerEntry = useMemo(
    () => findEntryForTokenId(slashIncomingMeta?.attackerTokenId ?? null),
    [findEntryForTokenId, slashIncomingMeta]
  );
  const slashIncomingAttackerFlags = useMemo(
    () =>
      new Set(
        (slashIncomingAttackerEntry?.used_item_flags || []).filter(
          (value): value is string => typeof value === "string"
        )
      ),
    [slashIncomingAttackerEntry]
  );
  const slashHasDodged = actorUsedItemFlags.has(DODGED_FLAG);
  const slashHasParried = actorUsedItemFlags.has(PARRIED_FLAG);
  const slashAttackerHasArtsChosen = slashIncomingAttackerFlags.has(ARTS_CHOSEN_FLAG);
  const slashIncomingHasDamageTotal = slashIncomingDamage?.totalDamage !== null;
  const slashIncomingActive =
    combatMode &&
    Boolean(actorTokenId) &&
    Boolean(slashIncomingDamage && slashIncomingMeta) &&
    (slashIncomingHasDamageTotal
      ? Math.max(0, slashIncomingDamage?.totalDamage ?? 0) > 0
      : Math.max(0, slashIncomingDamage?.successes ?? 0) > 0);
  const slashReactionPhase = slashIncomingActive && (!slashHasDodged || !slashHasParried);
  const slashArmorPhase =
    slashIncomingActive &&
    slashIncomingHasDamageTotal &&
    slashHasDodged &&
    slashHasParried &&
    slashAttackerHasArtsChosen;
  const slashCanControlPhase =
    slashIncomingActive &&
    Boolean(actorTokenId) &&
    (currentEntry?.kind === "monster"
      ? isDmViewer
      : Boolean(currentUserTokenId && actorTokenId === currentUserTokenId));
  const slashArtsPhaseAttack = useMemo<ResolvedMeleeAttack | null>(() => {
    if (!combatMode || !actorTokenId || !currentEntry) return null;
    const attackerFlags = new Set(
      (currentEntry.used_item_flags || []).filter((value): value is string => typeof value === "string")
    );
    if (attackerFlags.has(ARTS_CHOSEN_FLAG)) return null;

    for (const entry of initiativeEntries) {
      const targetTokenId = tokenIdFromParticipantId(entry.participant_id);
      if (!targetTokenId || targetTokenId === actorTokenId) continue;
      const flags = (entry.used_item_flags || []).filter((value): value is string => typeof value === "string");
      if (!flags.includes(DODGED_FLAG) || !flags.includes(PARRIED_FLAG)) continue;

      const incomingRecord = findIncomingDamageFlag(flags);
      const metaRecord = findIncomingDamageMetaFlag(flags);
      if (!incomingRecord || !metaRecord) continue;
      if (metaRecord.value.attackerTokenId !== actorTokenId) continue;

      const maneuver = flowManeuverForIncomingType(incomingRecord.value.type);
      return {
        id: metaRecord.value.attackId,
        attackerCharacterId: metaRecord.value.attackerTokenId,
        targetCharacterId: targetTokenId,
        weaponName: metaRecord.value.weaponName || maneuver,
        weaponBaseDamage: Math.max(0, incomingRecord.value.totalDamage ?? 0),
        maneuver,
        totalSuccesses: Math.max(0, incomingRecord.value.successes),
        requiredSuccesses: 1,
        swingBonusDamage: 0,
        disarmTargetItemId: metaRecord.value.disarmTargetItemId ?? null,
        disarmZoneId: metaRecord.value.disarmZoneId ?? null,
        rangeAtAttack: metaRecord.value.rangeAtAttack ?? null,
        skipReaction: true,
        slashFlow: true,
      };
    }
    return null;
  }, [combatMode, actorTokenId, currentEntry, initiativeEntries, flowManeuverForIncomingType]);
  const slashArtsCanControlPhase =
    Boolean(slashArtsPhaseAttack) &&
    Boolean(actorTokenId) &&
    (currentEntry?.kind === "monster"
      ? isDmViewer
      : Boolean(currentUserTokenId && actorTokenId === currentUserTokenId));
  useEffect(() => {
    if (!onResolveMeleeAttack || !slashArtsPhaseAttack || !slashArtsCanControlPhase) return;
    const key = `${slashArtsPhaseAttack.id}:${slashArtsPhaseAttack.attackerCharacterId}:${slashArtsPhaseAttack.targetCharacterId}`;
    if (handledSlashArtsPhaseRef.current.has(key)) return;
    handledSlashArtsPhaseRef.current.add(key);
    void Promise.resolve(onResolveMeleeAttack(slashArtsPhaseAttack)).catch((error) => {
      console.error("Failed to auto-enter Incoming arts phase:", error);
      handledSlashArtsPhaseRef.current.delete(key);
    });
  }, [onResolveMeleeAttack, slashArtsPhaseAttack, slashArtsCanControlPhase]);
  const buildSlashFlowAttack = useCallback((): ResolvedMeleeAttack | null => {
    if (!slashIncomingDamage || !slashIncomingMeta || !actorTokenId) return null;
    const maneuver = flowManeuverForIncomingType(slashIncomingDamage.type);
    return {
      id: slashIncomingMeta.attackId,
      attackerCharacterId: slashIncomingMeta.attackerTokenId,
      targetCharacterId: actorTokenId,
      weaponName: slashIncomingMeta.weaponName || maneuver,
      weaponBaseDamage: Math.max(0, slashIncomingDamage.totalDamage ?? 0),
      maneuver,
      totalSuccesses: Math.max(0, slashIncomingDamage.successes),
      requiredSuccesses: 1,
      swingBonusDamage: 0,
      disarmTargetItemId: slashIncomingMeta.disarmTargetItemId ?? null,
      disarmZoneId: slashIncomingMeta.disarmZoneId ?? null,
      rangeAtAttack: slashIncomingMeta.rangeAtAttack ?? null,
      skipReaction: true,
      slashFlow: true,
    };
  }, [slashIncomingDamage, slashIncomingMeta, actorTokenId, flowManeuverForIncomingType]);
  const actorTauntAngerTargetEntry = useMemo(
    () => findEntryForTokenId(actorTauntedAngerById),
    [findEntryForTokenId, actorTauntedAngerById]
  );
  const pendingReaction = useMemo(() => {
    if (pendingReactions.length === 0) return null;
    if (currentUserTokenId) {
      const matches = pendingReactions.filter((reaction) => reaction.targetCharacterId === currentUserTokenId);
      if (matches.length > 0) {
        return matches.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0];
      }
    }
    if (isDmViewer) {
      const matches = pendingReactions.filter((reaction) => reaction.targetCharacterId.startsWith("monster:"));
      if (matches.length > 0) {
        return matches.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0];
      }
    }
    return null;
  }, [pendingReactions, currentUserTokenId, isDmViewer]);
  const reactionTargetId = pendingReaction?.targetCharacterId ?? null;
  const reactionTargetEntry = useMemo(() => {
    if (!reactionTargetId) return null;
    return (
      initiativeEntries.find(
        (entry) => entry.participant_id === reactionTargetId || entry.participant_id === `player:${reactionTargetId}`
      ) || null
    );
  }, [initiativeEntries, reactionTargetId]);
  const reactionTargetState = reactionTargetId ? tokenStateById.get(reactionTargetId) || null : null;
  const reactionTargetActionAvailable = reactionTargetEntry
    ? reactionTargetEntry.fast_available !== false || reactionTargetEntry.slow_available !== false
    : false;
  const reactionTargetIsProne = Boolean(reactionTargetEntry?.prone);
  const reactionTargetIsHeld =
    Boolean(reactionTargetEntry?.grappled_by_id) ||
    Boolean(reactionTargetEntry?.clung_onto_by_id) ||
    Boolean((reactionTargetEntry?.clung_onto_by_ids || []).length > 0);
  const reactionTargetIsCovered = Boolean(reactionTargetEntry?.covered);
  const reactionTargetIsDead = Boolean(reactionTargetState?.dead);
  const reactionTargetIsBroken = Boolean(reactionTargetState?.physicalBroken || reactionTargetState?.mentalBroken);
  const reactionTargetIsMonster =
    Boolean(reactionTargetId?.startsWith("monster:")) || reactionTargetEntry?.kind === "monster";
  const reactionTargetCharacter = reactionTargetId ? characterById.get(reactionTargetId) || null : null;
  const reactionTargetHasFastFootworkLv1 = hasTalentLevelAtLeast(
    reactionTargetCharacter,
    FAST_FOOTWORK_TALENT_ID,
    1
  );
  const freeDodgeAvailable =
    Boolean(pendingReaction) &&
    !reactionTargetIsMonster &&
    reactionTargetHasFastFootworkLv1 &&
    !Boolean(reactionTargetEntry?.fast_footwork_dodge_used);
  const viewerCanControlReaction =
    Boolean(pendingReaction) &&
    (reactionTargetIsMonster
      ? isDmViewer
      : Boolean(reactionTargetId && reactionTargetId === currentUserTokenId));
  const canReact =
    combatMode &&
    Boolean(pendingReaction) &&
    viewerCanControlReaction &&
    reactionTargetActionAvailable &&
    !reactionTargetIsProne &&
    !reactionTargetIsHeld &&
    !reactionTargetIsCovered &&
    !reactionTargetIsDead &&
    !reactionTargetIsBroken;
  const sizeForTokenId = useCallback(
    (tokenId: string | null | undefined): number => {
      if (!tokenId) return 1;
      const entry =
        initiativeEntries.find(
          (item) => item.participant_id === tokenId || item.participant_id === `player:${tokenId}`
        ) || null;
      if (entry?.kind === "monster") {
        return Math.max(1, entry.monster_snapshot?.size ?? monsterByParticipantId.get(tokenId)?.monster_snapshot?.size ?? 1);
      }
      return 1;
    },
    [initiativeEntries, monsterByParticipantId]
  );
  const rollReaction = useCallback(
    (opts: { attribute: "STR" | "AGL"; skill: "MELEE" | "MOVE"; bonusDice: number; gearDice: number }) => {
      if (!character) {
        return { successes: 0, attributeDice: [], skillDice: [], gearDice: [], skillIsNegative: false };
      }
      const attrCount = Math.max(0, character.attributes?.[opts.attribute] ?? 0);
      const signedSkill = (character.skills?.[opts.skill] ?? 0) + opts.bonusDice;
      const skillCount = Math.max(0, Math.abs(signedSkill));
      const skillIsNegative = signedSkill < 0;
      const gearCount = Math.max(0, opts.gearDice);
      const attributeDice = rollD6Pool(attrCount);
      const skillDice = rollD6Pool(skillCount);
      const gearDice = rollD6Pool(gearCount);
      const attrSixes = attributeDice.filter((d) => d === 6).length;
      const skillSixes = skillDice.filter((d) => d === 6).length;
      const gearSixes = gearDice.filter((d) => d === 6).length;
      const successes = Math.max(0, attrSixes + gearSixes + skillSixes - (skillIsNegative ? skillSixes : 0));
      return { successes, attributeDice, skillDice, gearDice, skillIsNegative };
    },
    [character]
  );
  const rollMonsterReaction = useCallback(
    (opts: { attribute: "STR" | "AGL"; bonusDice: number; gearDice: number }) => {
      if (!reactionTargetEntry?.monster_snapshot) {
        return { successes: 0, attributeDice: [], skillDice: [], gearDice: [], skillIsNegative: false };
      }
      const snapshot = reactionTargetEntry.monster_snapshot;
      const attrCount = Math.max(0, opts.attribute === "STR" ? snapshot.str ?? 0 : snapshot.agl ?? 0);
      const signedSkillPool = (snapshot.special ?? 0) + opts.bonusDice;
      const skillCount = Math.abs(signedSkillPool);
      const skillIsNegative = signedSkillPool < 0;
      const gearCount = Math.max(0, opts.gearDice);
      const attributeDice = rollD6Pool(attrCount);
      const skillDice = rollD6Pool(skillCount);
      const gearDice = rollD6Pool(gearCount);
      const rawSuccesses =
        attributeDice.filter((d) => d === 6).length +
        skillDice.filter((d) => d === 6).length +
        gearDice.filter((d) => d === 6).length;
      const successes = skillIsNegative
        ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
        : rawSuccesses;
      return { successes, attributeDice, skillDice, gearDice, skillIsNegative };
    },
    [reactionTargetEntry]
  );
  const reactionManeuver = pendingReaction?.maneuver ?? null;
  const dodgeStandingBonus = reactionManeuver === "Slash" ? 0 : -2;
  const dodgeProneBonus = reactionManeuver === "Slash" ? 2 : 0;
  const sizeDelta = pendingReaction
    ? sizeForTokenId(reactionTargetId) - sizeForTokenId(pendingReaction.attackerCharacterId)
    : 0;
  const canDodgeReaction =
    combatMode &&
    Boolean(pendingReaction) &&
    viewerCanControlReaction &&
    (reactionTargetActionAvailable || freeDodgeAvailable) &&
    !reactionTargetIsProne &&
    !reactionTargetIsHeld &&
    !reactionTargetIsCovered &&
    !reactionTargetIsDead &&
    !reactionTargetIsBroken &&
    !isSkillBlockedForToken(reactionTargetId, "MOVE");
  const canParryReaction = canReact && !isSkillBlockedForToken(reactionTargetId, "MELEE");
  const parryOptions = useMemo(() => {
    if (!pendingReaction || !canParryReaction || !reactionManeuver || !REACTION_MANEUVER_SET.has(reactionManeuver)) {
      return [] as Array<{ id: string; name: string; gearBonus: number; kind: "weapon" | "shield" }>;
    }
    if (reactionManeuver === "Shove") return [];
    if (reactionTargetIsMonster) {
      const snapshot = reactionTargetEntry?.monster_snapshot;
      if (!snapshot) return [];
      const weapons = monsterEquippedMeleeWeapons(snapshot)
        .filter((weapon) => weapon.properties.some((prop) => prop === "parrying"))
        .map((weapon) => ({
          id: weapon.id,
          name: weapon.name,
          gearBonus: Math.max(0, weapon.gearBonus ?? 0),
          kind: "weapon" as const,
        }));
      const shields = monsterEquippedShields(snapshot).map((shield) => ({
        id: shield.id,
        name: shield.name,
        gearBonus: Math.max(0, shield.gearBonus ?? 0),
        kind: "shield" as const,
      }));
      return [...weapons, ...shields];
    }
    if (!character) return [];
    const held = playerHeldItems(character);
    const shields = held.filter((item) => item.item_type === "Shield");
    const parryingWeapons = held.filter((item) => isParryingWeapon(item));
    return [
      ...parryingWeapons.map((item) => ({
        id: item.id,
        name: item.name,
        gearBonus: Math.max(0, item.gearBonus ?? 0),
        kind: "weapon" as const,
      })),
      ...shields.map((item) => ({
        id: item.id,
        name: item.name,
        gearBonus: Math.max(0, item.gearBonus ?? 0),
        kind: "shield" as const,
      })),
    ];
  }, [pendingReaction, canParryReaction, reactionManeuver, character, reactionTargetIsMonster, reactionTargetEntry]);
  const slashReactionTargetIsMonster = currentEntry?.kind === "monster";
  const slashReactionTargetCharacter = actorTokenId ? characterById.get(actorTokenId) || null : null;
  const slashFreeDodgeAvailable =
    slashIncomingActive &&
    !slashReactionTargetIsMonster &&
    hasTalentLevelAtLeast(slashReactionTargetCharacter, FAST_FOOTWORK_TALENT_ID, 1) &&
    !Boolean(currentEntry?.fast_footwork_dodge_used);
  const slashCanDodgeReaction =
    slashReactionPhase &&
    slashCanControlPhase &&
    (Boolean(currentEntry?.fast_available || currentEntry?.slow_available) || slashFreeDodgeAvailable) &&
    !Boolean(currentEntry?.prone) &&
    !Boolean(currentEntry?.grappled_by_id) &&
    !Boolean(currentEntry?.clung_onto_by_id) &&
    !Boolean((currentEntry?.clung_onto_by_ids || []).length > 0) &&
    !Boolean(currentEntry?.covered) &&
    !actorState.dead &&
    !actorState.physicalBroken &&
    !actorState.mentalBroken &&
    !isSkillBlockedForToken(actorTokenId, "MOVE");
  const slashCanParryReaction =
    slashReactionPhase &&
    slashCanControlPhase &&
    Boolean(currentEntry?.fast_available || currentEntry?.slow_available) &&
    !Boolean(currentEntry?.prone) &&
    !Boolean(currentEntry?.grappled_by_id) &&
    !Boolean(currentEntry?.clung_onto_by_id) &&
    !Boolean((currentEntry?.clung_onto_by_ids || []).length > 0) &&
    !Boolean(currentEntry?.covered) &&
    !actorState.dead &&
    !actorState.physicalBroken &&
    !actorState.mentalBroken &&
    !isSkillBlockedForToken(actorTokenId, "MELEE");
  const slashParryOptions = useMemo(() => {
    if (!slashCanParryReaction || !slashIncomingActive) {
      return [] as Array<{ id: string; name: string; gearBonus: number; kind: "weapon" | "shield" }>;
    }
    if (slashReactionTargetIsMonster) {
      const snapshot = currentEntry?.monster_snapshot;
      if (!snapshot) return [];
      const weapons = monsterEquippedMeleeWeapons(snapshot)
        .filter((weapon) => weapon.properties.some((prop) => prop === "parrying"))
        .map((weapon) => ({
          id: weapon.id,
          name: weapon.name,
          gearBonus: Math.max(0, weapon.gearBonus ?? 0),
          kind: "weapon" as const,
        }));
      const shields = monsterEquippedShields(snapshot).map((shield) => ({
        id: shield.id,
        name: shield.name,
        gearBonus: Math.max(0, shield.gearBonus ?? 0),
        kind: "shield" as const,
      }));
      return [...weapons, ...shields];
    }
    if (!slashReactionTargetCharacter) return [];
    const held = playerHeldItems(slashReactionTargetCharacter);
    const shields = held.filter((item) => item.item_type === "Shield");
    const parryingWeapons = held.filter((item) => isParryingWeapon(item));
    return [
      ...parryingWeapons.map((item) => ({
        id: item.id,
        name: item.name,
        gearBonus: Math.max(0, item.gearBonus ?? 0),
        kind: "weapon" as const,
      })),
      ...shields.map((item) => ({
        id: item.id,
        name: item.name,
        gearBonus: Math.max(0, item.gearBonus ?? 0),
        kind: "shield" as const,
      })),
    ];
  }, [slashCanParryReaction, slashIncomingActive, slashReactionTargetIsMonster, currentEntry, slashReactionTargetCharacter]);
  const shouldShowReactionModal =
    ((Boolean(pendingReaction) &&
      REACTION_MANEUVER_SET.has(pendingReaction!.maneuver) &&
      combatMode &&
      viewerCanControlReaction) ||
      (slashReactionPhase && slashCanControlPhase)) &&
    combatMode;
  const effectiveProtectionDice = (item: InventoryItem | null | undefined): number => {
    if (!item) return 0;
    if (
      (item.item_type === "Armor" || item.item_type === "Helmet") &&
      typeof item.effective_gear_bonus === "number" &&
      !Number.isNaN(item.effective_gear_bonus)
    ) {
      return Math.max(0, Math.trunc(item.effective_gear_bonus));
    }
    return Math.max(0, Math.trunc(item.gearBonus ?? 0));
  };
  const isChainmailArmorItem = (item: InventoryItem | null | undefined): boolean => {
    if (!item || item.item_type !== "Armor") return false;
    const props = Array.isArray(item.properties) ? item.properties : [];
    return props.some((value) => String(value).trim().toLowerCase() === "chainmail");
  };
  const slashArmorPrompt = useMemo(() => {
    if (!slashArmorPhase || !slashCanControlPhase || !actorTokenId || !currentEntry) return null;
    const attack = buildSlashFlowAttack();
    if (!attack) return null;
    const slotMatches = (slotValue: string | null | undefined, item: InventoryItem) =>
      Boolean(slotValue && (slotValue === item.id || slotValue === item.name));

    let armorItem: InventoryItem | null = null;
    let helmetItem: InventoryItem | null = null;
    if (currentEntry.kind === "monster") {
      const gear = currentEntry.monster_snapshot?.gear || [];
      const slots = currentEntry.monster_snapshot?.equipment_slots || { armor: null, helmet: null };
      armorItem = gear.find((item) => item.item_type === "Armor" && slotMatches(slots.armor, item)) || null;
      helmetItem = gear.find((item) => item.item_type === "Helmet" && slotMatches(slots.helmet, item)) || null;
    } else {
      const target = slashReactionTargetCharacter;
      const inventory = target?.inventory || [];
      const slots = target?.equipment_slots || { armor: null, helmet: null };
      armorItem = inventory.find((item) => item.item_type === "Armor" && slotMatches(slots.armor, item)) || null;
      helmetItem = inventory.find((item) => item.item_type === "Helmet" && slotMatches(slots.helmet, item)) || null;
    }

    const applyChainmailPenalty = attack.maneuver === "Shoot";
    const armorDiceBase = effectiveProtectionDice(armorItem);
    const armorDice =
      applyChainmailPenalty && isChainmailArmorItem(armorItem)
        ? Math.max(0, armorDiceBase - 3)
        : armorDiceBase;
    const helmetDice = effectiveProtectionDice(helmetItem);
    const armorUsed = armorItem ? actorUsedItemFlags.has(`Used (${armorItem.name})`) : true;
    const helmetUsed = helmetItem ? actorUsedItemFlags.has(`Used (${helmetItem.name})`) : true;

    return {
      id: `slash-armor:${attack.id}`,
      targetCharacterId: actorTokenId,
      attack,
      armorItemId: armorItem?.id ?? null,
      armorName: armorItem?.name ?? null,
      armorDice,
      helmetItemId: helmetItem?.id ?? null,
      helmetName: helmetItem?.name ?? null,
      helmetDice,
      armorUsed: {
        armor: armorUsed,
        helmet: helmetUsed,
      },
      isSlashFlow: true,
    };
  }, [
    slashArmorPhase,
    slashCanControlPhase,
    actorTokenId,
    currentEntry,
    buildSlashFlowAttack,
    slashReactionTargetCharacter,
    actorUsedItemFlags,
  ]);
  const armorPrompt =
    pendingArmorPrompt && pendingArmorPrompt.targetCharacterId === currentUserTokenId ? pendingArmorPrompt : null;
  const activeArmorPrompt = slashArmorPrompt || armorPrompt;
  const armorPromptUsed = activeArmorPrompt?.armorUsed || {};
  const armorPromptHelmetDice = Math.max(0, activeArmorPrompt?.helmetDice ?? 0);
  const armorPromptArmorDice = Math.max(0, activeArmorPrompt?.armorDice ?? 0);
  const armorPromptCanHelmet =
    Boolean(activeArmorPrompt?.helmetItemId) && armorPromptHelmetDice > 0 && !armorPromptUsed.helmet;
  const armorPromptCanArmor =
    Boolean(activeArmorPrompt?.armorItemId) && armorPromptArmorDice > 0 && !armorPromptUsed.armor;
  const shouldShowArmorPrompt =
    combatMode &&
    Boolean(activeArmorPrompt) &&
    (slashArmorPrompt ? slashCanControlPhase : true) &&
    (armorPromptCanHelmet || armorPromptCanArmor);
  const artPrompt = useMemo(() => {
    if (!pendingArtPrompt) return null;
    const attackerId = pendingArtPrompt.attackerCharacterId;
    const attackerIsMonster = attackerId.startsWith("monster:");
    if (attackerIsMonster && isDmViewer) return pendingArtPrompt;
    if (!attackerIsMonster && attackerId === currentUserTokenId) return pendingArtPrompt;
    return null;
  }, [pendingArtPrompt, isDmViewer, currentUserTokenId]);
  const shouldShowArtPrompt =
    combatMode &&
    Boolean(artPrompt) &&
    Array.isArray(artPrompt?.options) &&
    artPrompt!.options.length > 0;
  const handleArmorPromptPass = useCallback(async () => {
    if (slashArmorPrompt && onResolveReactionRoll) {
      await onResolveReactionRoll({
        id: `slash-armor-pass:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        reactionId: `slash-armor:${slashArmorPrompt.attack.id}`,
        targetCharacterId: slashArmorPrompt.targetCharacterId,
        mode: "pass",
        rollType: "armor",
        totalSuccesses: 0,
        attack: slashArmorPrompt.attack,
      });
      return;
    }
    if (!armorPrompt) return;
    onConsumeArmorPrompt?.(armorPrompt.id);
    await onArmorPromptPass?.({
      ...armorPrompt.attack,
      armorSkipped: true,
      armorUsed: armorPrompt.armorUsed,
    });
  }, [slashArmorPrompt, onResolveReactionRoll, armorPrompt, onConsumeArmorPrompt, onArmorPromptPass]);
  const handleArmorPromptRoll = useCallback(
    async (slot: "helmet" | "armor") => {
      if (!activeArmorPrompt) return;
      const isHelmet = slot === "helmet";
      const gearItemId = isHelmet ? activeArmorPrompt.helmetItemId : activeArmorPrompt.armorItemId;
      if (!gearItemId) return;
      if (slashArmorPrompt && onResolveReactionRoll) {
        if (currentEntry?.kind === "monster") {
          const gearDice = rollD6Pool(Math.max(0, isHelmet ? armorPromptHelmetDice : armorPromptArmorDice));
          const successes = gearDice.filter((d) => d === 6).length;
          if (isDmViewer) {
            setMonsterRollResult({
              actionLabel: isHelmet ? `Helmet (${slashArmorPrompt.helmetName || "Helmet"})` : `Armor (${slashArmorPrompt.armorName || "Armor"})`,
              attributeDice: [],
              skillDice: [],
              gearDice,
              successes,
            });
          }
          await onResolveReactionRoll({
            id: `slash-armor-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            reactionId: `slash-armor:${slashArmorPrompt.attack.id}:${slot}`,
            targetCharacterId: slashArmorPrompt.targetCharacterId,
            mode: isHelmet ? "helmet" : "armor",
            rollType: "armor",
            totalSuccesses: successes,
            armorSlot: slot,
            attack: slashArmorPrompt.attack,
          });
          return;
        }
        if (!onQueueReactionRoll) return;
      }
      if (!armorPrompt && !slashArmorPrompt) return;
      if (!onQueueReactionRoll) return;
      onQueueReactionRoll({
        id: `armor-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        reactionId: `${slashArmorPrompt ? "slash-armor" : "armor"}:${activeArmorPrompt.attack.id}:${slot}`,
        targetCharacterId: activeArmorPrompt.targetCharacterId,
        mode: isHelmet ? "helmet" : "armor",
        rollType: "armor",
        rollAttribute: "AGL",
        rollSkill: "MOVE",
        bonusDice: 0,
        fixedAttributeDice: 0,
        fixedSkillDice: 0,
        fixedGearDice: Math.max(0, isHelmet ? armorPromptHelmetDice : armorPromptArmorDice),
        gearItemId,
        armorSlot: slot,
        attack: activeArmorPrompt.attack,
      });
      if (armorPrompt) {
        onConsumeArmorPrompt?.(armorPrompt.id);
      }
    },
    [
      activeArmorPrompt,
      slashArmorPrompt,
      onResolveReactionRoll,
      currentEntry,
      armorPromptHelmetDice,
      armorPromptArmorDice,
      isDmViewer,
      onQueueReactionRoll,
      armorPrompt,
      onConsumeArmorPrompt,
    ]
  );
  const handleArtPromptPass = useCallback(async () => {
    if (!artPrompt) return;
    onConsumeArtPrompt?.(artPrompt.id);
    await onArtPromptPass?.(artPrompt.id);
  }, [artPrompt, onConsumeArtPrompt, onArtPromptPass]);
  const handleArtPromptRoll = useCallback(
    async (optionId: string) => {
      if (!artPrompt) return;
      onConsumeArtPrompt?.(artPrompt.id);
      await onArtPromptRoll?.(artPrompt.id, optionId);
    },
    [artPrompt, onConsumeArtPrompt, onArtPromptRoll]
  );
  const resolvePendingReaction = useCallback(
    async (
      mode: "pass" | "dodge-stand" | "dodge-prone" | "parry",
      parryItem?: { id: string; gearBonus: number; kind: "weapon" | "shield"; name: string }
    ) => {
      if (slashReactionPhase && slashCanControlPhase) {
        const slashAttack = buildSlashFlowAttack();
        if (!slashAttack || !actorTokenId) return;
        if (mode === "dodge-stand" && slashHasDodged) return;
        if (mode === "dodge-prone" && slashHasDodged) return;
        if (mode === "parry" && slashHasParried) return;
        if ((mode === "dodge-stand" || mode === "dodge-prone") && !slashCanDodgeReaction) return;
        if (mode === "parry" && !slashCanParryReaction) return;
        if (!onResolveReactionRoll && !onQueueReactionRoll) return;

        if (mode === "pass") {
          if (!onResolveReactionRoll) return;
          await onResolveReactionRoll({
            id: `slash-reaction-pass:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            reactionId: `slash:${slashAttack.id}`,
            targetCharacterId: slashAttack.targetCharacterId,
            mode: "pass",
            rollType: "reaction",
            totalSuccesses: 0,
            attack: slashAttack,
          });
          return;
        }

        const sizeDelta = sizeForTokenId(actorTokenId) - sizeForTokenId(slashIncomingMeta?.attackerTokenId);
        const incomingManeuver = flowManeuverForIncomingType(slashIncomingDamage?.type);
        const dodgeStandingBonus = incomingManeuver === "Slash" ? 0 : -2;
        const dodgeProneBonus = incomingManeuver === "Slash" ? 2 : 0;
        const maneuverBonus =
          mode === "parry"
            ? parryItem
              ? parryItem.kind === "weapon"
                ? incomingManeuver === "Stab"
                  ? -2
                  : incomingManeuver === "Strike"
                    ? 2
                    : 0
                : incomingManeuver === "Stab" || incomingManeuver === "Strike"
                  ? 2
                  : 0
              : 0
            : 0;
        const bonusDice =
          mode === "dodge-stand"
            ? dodgeStandingBonus
            : mode === "dodge-prone"
              ? dodgeProneBonus
              : maneuverBonus + sizeDelta;
        const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);

        if (!slashReactionTargetIsMonster && onQueueReactionRoll) {
          onQueueReactionRoll({
            id: `slash-reaction-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            reactionId: `slash:${slashAttack.id}`,
            targetCharacterId: slashAttack.targetCharacterId,
            mode: mode === "parry" ? "parry" : mode,
            rollType: "reaction",
            rollAttribute: mode === "parry" ? "STR" : "AGL",
            rollSkill: mode === "parry" ? "MELEE" : "MOVE",
            bonusDice: bonusDice + tauntPenalty,
            gearItemId: mode === "parry" && parryItem ? parryItem.id : null,
            applyProne: mode === "dodge-prone",
            attack: slashAttack,
          });
          return;
        }

        if (!slashReactionTargetIsMonster || !currentEntry?.monster_snapshot || !onResolveReactionRoll) return;
        setIsResolvingReaction(true);
        try {
          const snapshot = currentEntry.monster_snapshot;
          const attrCount = Math.max(0, mode === "parry" ? snapshot.str ?? 0 : snapshot.agl ?? 0);
          const signedSkillPool = (snapshot.special ?? 0) + bonusDice + tauntPenalty;
          const skillCount = Math.abs(signedSkillPool);
          const skillIsNegative = signedSkillPool < 0;
          const gearCount = Math.max(0, mode === "parry" && parryItem ? parryItem.gearBonus : 0);
          const attributeDice = rollD6Pool(attrCount);
          const skillDice = rollD6Pool(skillCount);
          const gearDice = rollD6Pool(gearCount);
          const rawSuccesses =
            attributeDice.filter((d) => d === 6).length +
            skillDice.filter((d) => d === 6).length +
            gearDice.filter((d) => d === 6).length;
          const successes = skillIsNegative
            ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
            : rawSuccesses;
          if (isDmViewer) {
            setMonsterRollResult({
              actionLabel:
                mode === "dodge-stand"
                  ? "Dodge (Standing)"
                  : mode === "dodge-prone"
                    ? "Dodge (Fall Prone)"
                    : `Parry (${parryItem?.name || "Parry"})`,
              attributeDice,
              skillDice,
              skillIsNegative,
              gearDice,
              successes,
            });
          }
          await onResolveReactionRoll({
            id: `slash-reaction-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            reactionId: `slash:${slashAttack.id}`,
            targetCharacterId: slashAttack.targetCharacterId,
            mode: mode === "parry" ? "parry" : mode,
            rollType: "reaction",
            totalSuccesses: successes,
            applyProne: mode === "dodge-prone",
            attack: slashAttack,
          });
        } finally {
          setIsResolvingReaction(false);
        }
        return;
      }

      if (!pendingReaction) return;
      const supabase = createClient();
      const baseAttack: ResolvedMeleeAttack = {
        id: pendingReaction.attackId,
        attackerCharacterId: pendingReaction.attackerCharacterId,
        targetCharacterId: pendingReaction.targetCharacterId,
        weaponName: pendingReaction.weaponName,
        weaponBaseDamage: pendingReaction.weaponBaseDamage,
        maneuver: pendingReaction.maneuver,
        totalSuccesses: pendingReaction.totalSuccesses,
        requiredSuccesses: pendingReaction.requiredSuccesses ?? 1,
        swingBonusDamage: pendingReaction.swingBonusDamage ?? 0,
        disarmTargetItemId: pendingReaction.disarmTargetItemId ?? null,
        disarmZoneId: pendingReaction.disarmZoneId ?? null,
        destinationX: pendingReaction.destinationX ?? undefined,
        destinationY: pendingReaction.destinationY ?? undefined,
        shootTargetZoneId: pendingReaction.shootTargetZoneId ?? null,
        shootAmmoItem: pendingReaction.shootAmmoItem ?? null,
        rangeAtAttack: pendingReaction.rangeAtAttack ?? null,
        skipReaction: true,
      };

      const maneuverBonus =
        mode === "parry" && parryItem
          ? parryItem.kind === "weapon"
            ? reactionManeuver === "Stab"
              ? -2
              : reactionManeuver === "Strike"
                ? 2
                : 0
            : reactionManeuver === "Stab" || reactionManeuver === "Strike"
              ? 2
              : 0
          : 0;

      if (mode === "pass") {
        setIsResolvingReaction(true);
        try {
          const { error: clearError } = await supabase.rpc("combat_clear_reaction", {
            p_reaction_id: pendingReaction.id,
          });
          if (clearError) {
            setError(clearError.message);
          }
          await onResolveMeleeAttack?.(baseAttack);
        } finally {
          setIsResolvingReaction(false);
        }
        return;
      }

      if (!reactionTargetId) return;
      if ((mode === "dodge-stand" || mode === "dodge-prone") && !canDodgeReaction) return;
      if (mode === "parry" && !canParryReaction) return;

      const tauntPenalty = await consumeTauntPenaltyForToken(reactionTargetId);

      if (!reactionTargetIsMonster && onQueueReactionRoll) {
        const rollAttribute = mode === "dodge-stand" || mode === "dodge-prone" ? "AGL" : "STR";
        const rollSkill = mode === "dodge-stand" || mode === "dodge-prone" ? "MOVE" : "MELEE";
        const bonusDice =
          mode === "dodge-stand"
            ? dodgeStandingBonus
            : mode === "dodge-prone"
              ? dodgeProneBonus
              : maneuverBonus + sizeDelta;
        const gearItemId = mode === "parry" && parryItem ? parryItem.id : null;
        onQueueReactionRoll({
          id: `reaction-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          reactionId: pendingReaction.id,
          targetCharacterId: reactionTargetId,
          mode: mode === "parry" ? "parry" : mode,
          rollType: "reaction",
          rollAttribute,
          rollSkill,
          bonusDice: bonusDice + tauntPenalty,
          gearItemId,
          applyProne: mode === "dodge-prone",
          attack: baseAttack,
        });
        return;
      }

      setIsResolvingReaction(true);
      try {
        let reducedSuccesses = baseAttack.totalSuccesses;
        if (reactionTargetIsMonster) {
          if (mode === "dodge-stand") {
            const roll = rollMonsterReaction({
              attribute: "AGL",
              bonusDice: dodgeStandingBonus + tauntPenalty,
              gearDice: 0,
            });
            if (isDmViewer) {
              setMonsterRollResult({
                actionLabel: "Dodge (Standing)",
                attributeDice: roll.attributeDice,
                skillDice: roll.skillDice,
                skillIsNegative: roll.skillIsNegative,
                gearDice: roll.gearDice,
                successes: roll.successes,
              });
            }
            reducedSuccesses = Math.max(0, baseAttack.totalSuccesses - roll.successes);
          } else if (mode === "dodge-prone") {
            const roll = rollMonsterReaction({
              attribute: "AGL",
              bonusDice: dodgeProneBonus + tauntPenalty,
              gearDice: 0,
            });
            if (isDmViewer) {
              setMonsterRollResult({
                actionLabel: "Dodge (Fall Prone)",
                attributeDice: roll.attributeDice,
                skillDice: roll.skillDice,
                skillIsNegative: roll.skillIsNegative,
                gearDice: roll.gearDice,
                successes: roll.successes,
              });
            }
            reducedSuccesses = Math.max(0, baseAttack.totalSuccesses - roll.successes);
          } else if (mode === "parry" && parryItem) {
            const roll = rollMonsterReaction({
              attribute: "STR",
              bonusDice: maneuverBonus + sizeDelta + tauntPenalty,
              gearDice: parryItem.gearBonus,
            });
            if (isDmViewer) {
              setMonsterRollResult({
                actionLabel: `Parry (${parryItem.name})`,
                attributeDice: roll.attributeDice,
                skillDice: roll.skillDice,
                skillIsNegative: roll.skillIsNegative,
                gearDice: roll.gearDice,
                successes: roll.successes,
              });
            }
            reducedSuccesses = Math.max(0, baseAttack.totalSuccesses - roll.successes);
          }
        } else {
          const roll = rollReaction({
            attribute: mode === "parry" ? "STR" : "AGL",
            skill: mode === "parry" ? "MELEE" : "MOVE",
            bonusDice:
              mode === "dodge-stand"
                ? dodgeStandingBonus
                : mode === "dodge-prone"
                  ? dodgeProneBonus
                  : maneuverBonus + sizeDelta,
            gearDice: mode === "parry" && parryItem ? parryItem.gearBonus : 0,
          });
          reducedSuccesses = Math.max(0, baseAttack.totalSuccesses - roll.successes);
        }

        const { error: consumeError } = await supabase.rpc("combat_use_reaction_action", {
          p_actor_token_id: reactionTargetId,
        });
        if (consumeError) {
          setError(consumeError.message);
        }

        if (mode === "dodge-prone") {
          const { error: proneError } = await supabase.rpc("combat_set_prone_for_token", {
            p_actor_token_id: reactionTargetId,
            p_prone: true,
          });
          if (proneError) {
            setError(proneError.message);
          }
        }

        const { error: clearError } = await supabase.rpc("combat_clear_reaction", {
          p_reaction_id: pendingReaction.id,
        });
        if (clearError) {
          setError(clearError.message);
        }

        const finalAttack = { ...baseAttack, totalSuccesses: reducedSuccesses };
        await onResolveMeleeAttack?.(finalAttack);
      } finally {
        setIsResolvingReaction(false);
      }
    },
    [
      slashReactionPhase,
      slashCanControlPhase,
      buildSlashFlowAttack,
      actorTokenId,
      slashHasDodged,
      slashHasParried,
      slashCanDodgeReaction,
      slashCanParryReaction,
      sizeForTokenId,
      slashIncomingDamage,
      slashIncomingMeta,
      flowManeuverForIncomingType,
      slashReactionTargetIsMonster,
      currentEntry,
      onResolveReactionRoll,
      onQueueReactionRoll,
      isDmViewer,
      pendingReaction,
      canDodgeReaction,
      canParryReaction,
      rollReaction,
      rollMonsterReaction,
      dodgeStandingBonus,
      dodgeProneBonus,
      reactionManeuver,
      sizeDelta,
      reactionTargetId,
      reactionTargetIsMonster,
      onResolveMeleeAttack,
    ]
  );
  const actorHoldCounterpartIds = useMemo(() => {
    const ids = new Set<string>();
    if (actorGrapplingTargetId) ids.add(actorGrapplingTargetId);
    if (actorGrappledById) ids.add(actorGrappledById);
    if (actorClingingTargetId) ids.add(actorClingingTargetId);
    for (const id of actorClungOntoByIds) ids.add(id);
    return ids;
  }, [actorGrapplingTargetId, actorGrappledById, actorClingingTargetId, actorClungOntoByIds]);
  const selectedIsActorOrHoldCounterpart = useMemo(() => {
    if (!selectedTokenId || !actorTokenId) return false;
    if (selectedTokenId === actorTokenId) return true;
    return actorHoldCounterpartIds.has(selectedTokenId);
  }, [selectedTokenId, actorTokenId, actorHoldCounterpartIds]);
  const actorSize = useMemo(() => {
    if (!currentEntry) return 1;
    if (currentEntry.kind === "monster") {
      return Math.trunc(currentEntry.monster_snapshot?.size ?? 1);
    }
    return 1;
  }, [currentEntry]);
  const actorCanMoveWhileGrappling = useMemo(() => {
    if (!isActorGrappling || !actorGrapplingTargetId) return false;
    return actorSize > sizeForTokenId(actorGrapplingTargetId);
  }, [isActorGrappling, actorGrapplingTargetId, actorSize, sizeForTokenId]);
  const actorMovementLockedByHold =
    isActorGrappled || isActorClinging || (isActorGrappling && !actorCanMoveWhileGrappling);
  const isActorEnemyEngagedForMovement = useMemo(() => {
    if (!actorTokenId) return false;
    const actorSide = combatSideOfToken(actorTokenId);
    for (const token of tokenPositions) {
      if (token.character_id === actorTokenId) continue;
      if (combatSideOfToken(token.character_id) === actorSide) continue;
      if (actorCanMoveWhileGrappling && token.character_id === actorGrapplingTargetId) continue;
      if (areTokensEngagedAtSameElevation(actorTokenId, token.character_id)) return true;
    }
    return false;
  }, [
    actorTokenId,
    tokenPositions,
    areTokensEngagedAtSameElevation,
    actorCanMoveWhileGrappling,
    actorGrapplingTargetId,
    combatSideOfToken,
  ]);
  const selectedTargetSize = useMemo(() => {
    if (!selectedTokenId) return null;
    if (selectedTokenId.startsWith("monster:")) {
      return Math.trunc(monsterByParticipantId.get(selectedTokenId)?.monster_snapshot?.size ?? 1);
    }
    return 1;
  }, [selectedTokenId, monsterByParticipantId]);
  const selectedTargetEntry = useMemo(() => {
    if (!selectedTokenId) return null;
    return (
      initiativeEntries.find(
        (entry) =>
          entry.participant_id === selectedTokenId || entry.participant_id === `player:${selectedTokenId}`
      ) || null
    );
  }, [selectedTokenId, initiativeEntries]);
  const selectedTargetState = selectedTokenId ? tokenStateById.get(selectedTokenId) || null : null;
  const selectedTargetDead = Boolean(selectedTargetState?.dead);
  const selectedTargetPhysicalBroken = Boolean(selectedTargetState?.physicalBroken);
  const selectedTargetMentalBroken = Boolean(selectedTargetState?.mentalBroken);
  const actorSpirit = useMemo(() => {
    if (!currentEntry) return 0;
    if (currentEntry.kind === "player") {
      return Math.max(0, actorTokenCharacter?.spirits ?? 0);
    }
    return Math.max(
      0,
      currentEntry.monster_snapshot?.spirits_current ??
        currentEntry.monster_snapshot?.starting_spirits ??
        0
    );
  }, [currentEntry, actorTokenCharacter]);

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
          const elevation = tokenElevationByCharacterId.get(pos.character_id) ?? 0;
          flags.push(`Elevation ${elevation}`);
          const tokenState = tokenStateById.get(pos.character_id);
          if (tokenState?.dead) {
            flags.push("Dead");
          }
          if (tokenState?.physicalBroken && tokenState.physicalBrokenAttrs.length > 0) {
            for (const attr of tokenState.physicalBrokenAttrs) {
              flags.push(`Broken (${attr})`);
            }
          }
          if (tokenState?.mentalBroken && tokenState.mentalBrokenAttrs.length > 0) {
            for (const attr of tokenState.mentalBrokenAttrs) {
              flags.push(`Broken (${attr})`);
            }
          }
          if (entry?.prone) {
            flags.push("Prone");
          }
          if (entry?.covered) {
            flags.push("Covered");
          }
          if (
            (entry?.feint_pending_roll !== null && entry?.feint_pending_roll !== undefined) ||
            (entry?.feint_pending_name && entry.feint_pending_name.trim() !== "")
          ) {
            const target = entry.feint_pending_name || "Unknown";
            const initiativeLabel =
              entry.feint_pending_roll !== null && entry.feint_pending_roll !== undefined
                ? `${entry.feint_pending_roll}`
                : "?";
            flags.push(`Feint (${target}: ${initiativeLabel})`);
          }
          if (entry?.swing_weapon_name) {
            flags.push(`Swinging (${entry.swing_weapon_name})`);
          }
          if (entry?.readied_weapon_name && entry?.readied_ammo_item?.name) {
            flags.push(`Readied (${entry.readied_weapon_name} w/ ${entry.readied_ammo_item.name})`);
          }
          if (entry?.aim_target_name && entry?.aim_weapon_name) {
            flags.push(`Aiming (${entry.aim_target_name} w/ ${entry.aim_weapon_name})`);
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
          const clungOntoNames = [
            ...(entry?.clung_onto_by_names || []),
            ...(entry?.clung_onto_by_name ? [entry.clung_onto_by_name] : []),
          ].filter(Boolean);
          if (clungOntoNames.length > 0) {
            flags.push(`Clung Onto (${Array.from(new Set(clungOntoNames)).join(", ")})`);
          }
          if (entry?.taunted_distract_value && entry.taunted_distract_value > 0) {
            flags.push(`Taunted (Distracted ${entry.taunted_distract_value})`);
          }
          if (entry?.taunted_anger_by_name) {
            flags.push(`Taunted (Angered by ${entry.taunted_anger_by_name})`);
          }
          if ((entry?.flame_intensity ?? 0) > 0) {
            flags.push(`Flame ${Math.max(0, Math.trunc(entry?.flame_intensity ?? 0))}`);
          }
          if ((entry?.falling_zones ?? 0) > 0) {
            flags.push(`Falling ${Math.max(0, Math.trunc(entry?.falling_zones ?? 0))}`);
          }
          if (entry?.blitzed) {
            flags.push("Blitzed");
          }
          for (const usedFlag of entry?.used_item_flags || []) {
            if (!usedFlag) continue;
            if (isIncomingDamageMetaFlag(usedFlag)) continue;
            flags.push(usedFlag);
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
              elevation,
              dead: tokenState?.dead,
              physicallyBroken: tokenState?.physicalBroken,
              mentallyBroken: tokenState?.mentalBroken,
            };
          }

          const monster = monsterByParticipantId.get(pos.character_id);
          if (monster) {
            const snapshot = entry?.monster_snapshot || monster.monster_snapshot;
            const tooltip =
              isDmUser && snapshot
                ? formatMonsterTooltip(snapshot) + `\n${flags.length > 0 ? `Flags: ${flags.join(", ")}` : "Flags: None"}`
                : formatMonsterPublicTooltip(monster.name, snapshot, flags);
            return {
              ...pos,
              type: "monster" as const,
              name: monster.name,
              email: null,
              icon_url: monster.icon_url,
              tooltip,
              elevation,
              dead: tokenState?.dead,
              physicallyBroken: tokenState?.physicalBroken,
              mentallyBroken: tokenState?.mentalBroken,
            };
          }
          return null;
        })
        .filter((value): value is RenderedToken => value !== null),
    [tokenPositions, characters, isDmUser, monsterByParticipantId, initiativeEntries, tokenStateById, tokenElevationByCharacterId]
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

  const incomingPipelineActive = useMemo(
    () =>
      combatMode &&
      initiativeEntries.some((entry) => {
        const flags = Array.isArray(entry.used_item_flags)
          ? entry.used_item_flags.filter((value): value is string => typeof value === "string")
          : [];
        return Boolean(findIncomingDamageFlag(flags) && findIncomingDamageMetaFlag(flags));
      }),
    [combatMode, initiativeEntries]
  );
  const isMyTurn = useMemo(() => {
    const attackerTurnLockedByReaction =
      combatMode &&
      Boolean(actorTokenId) &&
      pendingReactions.some((reaction) => reaction.attackerCharacterId === actorTokenId);
    if (!currentEntry) return false;
    if (incomingPipelineActive) return false;
    if (attackerTurnLockedByReaction) return false;
    if (isDmUser) return currentEntry.kind === "monster";
    return Boolean(currentUserTokenId && actorTokenId === currentUserTokenId);
  }, [currentEntry, isDmUser, currentUserTokenId, combatMode, actorTokenId, pendingReactions, incomingPipelineActive]);
  const rangeBetweenTokens = useCallback(
    (sourceTokenId: string | null | undefined, targetTokenId: string | null | undefined): CombatRange | null => {
      if (!sourceTokenId || !targetTokenId || sourceTokenId === targetTokenId) return null;
      if (areTokensEngagedAtSameElevation(sourceTokenId, targetTokenId)) return "Engaged";
      const sourceToken = tokenByCharacterId.get(sourceTokenId);
      const targetToken = tokenByCharacterId.get(targetTokenId);
      if (!sourceToken || !targetToken) return null;
      const sourceZone = zoneIdAtPoint(zoneRegionMap, sourceToken);
      const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
      if (sourceZone === null || targetZone === null) return null;
      const lateralDistance = shortestZoneDistance(sourceZone, targetZone, zoneAdjacency);
      const verticalDistance = Math.abs(tokenElevationForTokenId(sourceTokenId) - tokenElevationForTokenId(targetTokenId));
      return rangeFromLateralAndVerticalDistance(lateralDistance, verticalDistance);
    },
    [areTokensEngagedAtSameElevation, tokenByCharacterId, zoneRegionMap, zoneAdjacency, tokenElevationForTokenId]
  );
  const canUseSlowAction = Boolean(currentEntry?.slow_available || currentEntry?.fast_available);
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
  const currentReadied = useMemo(
    () =>
      currentEntry?.readied_weapon_item_id && currentEntry?.readied_ammo_item
        ? {
            weaponItemId: currentEntry.readied_weapon_item_id,
            weaponName: currentEntry.readied_weapon_name ?? "Weapon",
            weaponHand: currentEntry.readied_weapon_hand ?? null,
            ammoItem: currentEntry.readied_ammo_item,
          }
        : null,
    [currentEntry]
  );
  const canAttackWithMeleeAgainstTarget = useCallback(
    (targetTokenId: string, targetRange: CombatRange | null): boolean => {
      if (!combatMode || !currentEntry || !isMyTurn) return false;
      if (!canUseSlowAction) return false;
      if (!actorTokenId || targetTokenId === actorTokenId) return false;
      if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
      if (isActorProne || actorHardLockedByHold) return false;
      if (!targetRange) return false;
      if (isSkillBlockedForToken(actorTokenId, "MELEE")) return false;

      if (currentEntry.kind === "player") {
        if (!actorCharacter || !character || actorCharacter.id !== character.id) return false;
        if (targetRange === "Engaged") return true;
        const slotIds = new Set<string>();
        const slots = character.equipment_slots;
        if (slots?.left) slotIds.add(slots.left);
        if (slots?.right) slotIds.add(slots.right);
        const inventory = character.inventory || [];
        return inventory.some((item) => {
          if (!slotIds.has(item.id)) return false;
          if (!isImplementedItem(item)) return false;
          if (item.item_type !== "Melee Weapon") return false;
          if (!weaponSupportsRange(item.range_band, targetRange)) return false;
          return (item.gearBonus ?? 0) > 0;
        });
      }

      const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
      const snapshot = actorMonster?.monster_snapshot;
      if (!snapshot) return false;
      if (weaponSupportsRange(snapshot.range_band, targetRange)) return true;
      const meleeWeapons = monsterEquippedMeleeWeapons(snapshot);
      return meleeWeapons.some((weapon) => weaponSupportsRange(weapon.rangeBand, targetRange) && weapon.gearBonus > 0);
    },
    [
      combatMode,
      currentEntry,
      isMyTurn,
      canUseSlowAction,
      actorTokenId,
      actorDead,
      actorRestrictedToCrawl,
      actorRestrictedToRun,
      isActorProne,
      actorHardLockedByHold,
      actorCharacter,
      character,
      monsterByParticipantId,
      isSkillBlockedForToken,
    ]
  );
  const canAttackWithShootAgainstTarget = useCallback(
    (targetTokenId: string, targetRange: CombatRange | null): boolean => {
      if (!combatMode || !currentEntry || !isMyTurn || !currentReadied) return false;
      if (!canUseSlowAction) return false;
      if (!actorTokenId || targetTokenId === actorTokenId) return false;
      if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
      if (isActorCovered || isActorProne || actorHardLockedByHold) return false;
      if (isActorEngaged) return false;
      if (!targetRange) return false;
      const sourceWeapons =
        currentEntry.kind === "player"
          ? actorCharacter && character && actorCharacter.id === character.id
            ? playerEquippedRangedWeapons(character)
            : []
          : currentEntry.monster_snapshot
            ? monsterEquippedRangedWeapons(currentEntry.monster_snapshot)
            : [];
      const weapon = sourceWeapons.find((w) => w.id === currentReadied.weaponItemId);
      if (!weapon) return false;
      return weaponSupportsRange(weapon.range_band, targetRange);
    },
    [
      combatMode,
      currentEntry,
      isMyTurn,
      currentReadied,
      canUseSlowAction,
      actorTokenId,
      actorDead,
      actorRestrictedToCrawl,
      actorRestrictedToRun,
      isActorCovered,
      isActorProne,
      actorHardLockedByHold,
      isActorEngaged,
      actorCharacter,
      character,
    ]
  );
  const tauntAngerRestrictionEligible =
    Boolean(actorTauntedAngerById) &&
    isMyTurn &&
    !actorDead &&
    !actorPhysicalBroken &&
    !actorMentalBroken &&
    !actorHardLockedByHold &&
    !isActorClungOnto &&
    !isActorProne &&
    !isActorCovered;
  const tauntAngerTargetRange = useMemo(
    () => rangeBetweenTokens(actorTokenId, actorTauntedAngerById),
    [rangeBetweenTokens, actorTokenId, actorTauntedAngerById]
  );
  const tauntAngerAttackPossible = useMemo(() => {
    if (!tauntAngerRestrictionEligible || !actorTauntedAngerById) return false;
    if (!actorTauntAngerTargetEntry) return false;
    return (
      canAttackWithMeleeAgainstTarget(actorTauntedAngerById, tauntAngerTargetRange) ||
      canAttackWithShootAgainstTarget(actorTauntedAngerById, tauntAngerTargetRange)
    );
  }, [
    tauntAngerRestrictionEligible,
    actorTauntedAngerById,
    actorTauntAngerTargetEntry,
    canAttackWithMeleeAgainstTarget,
    canAttackWithShootAgainstTarget,
    tauntAngerTargetRange,
  ]);
  const actorTauntAngerRestricted = tauntAngerRestrictionEligible && tauntAngerAttackPossible;
  const isSelectedSelf = useMemo(() => {
    if (!selectedTokenId || !actorTokenId) return false;
    return selectedTokenId === actorTokenId;
  }, [selectedTokenId, actorTokenId]);
  const currentAim = useMemo(
    () =>
      currentEntry?.aim_target_id && currentEntry?.aim_weapon_item_id
        ? {
            targetId: currentEntry.aim_target_id,
            targetName: currentEntry.aim_target_name ?? "Target",
            weaponItemId: currentEntry.aim_weapon_item_id,
            weaponName: currentEntry.aim_weapon_name ?? "Weapon",
          }
        : null,
    [currentEntry]
  );
  const canUseEngageFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId) return false;
    if (selectedTokenId === actorTokenId) return false;
    if (!isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorMovementLockedByHold) return false;
    if (isActorEngaged) return false;

    const actorToken = tokenByCharacterId.get(actorTokenId);
    const targetToken = tokenByCharacterId.get(selectedTokenId);
    if (!actorToken || !targetToken) return false;
    if (tokenElevationForTokenId(actorTokenId) !== tokenElevationForTokenId(selectedTokenId)) return false;

    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
    return actorZone !== null && targetZone !== null && actorZone === targetZone;
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, isActorEngaged, tokenByCharacterId, zoneRegionMap, isActorProne, actorMovementLockedByHold, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted, tokenElevationForTokenId]);
  const canUseRunFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedZoneTarget || !isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl) return false;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (!actorRestrictedToRun && (isActorProne || actorMovementLockedByHold)) return false;
    if (isActorCovered) return false;
    if (isActorEnemyEngagedForMovement) return false;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return false;
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (actorZone === null) return false;
    if (actorZone === selectedZoneTarget.zoneId) return false;
    const distance = shortestZoneDistance(actorZone, selectedZoneTarget.zoneId, zoneAdjacency);
    return distance === 1;
  }, [combatMode, actorTokenId, selectedZoneTarget, currentEntry, isMyTurn, isActorEnemyEngagedForMovement, tokenByCharacterId, zoneRegionMap, zoneAdjacency, isActorProne, actorMovementLockedByHold, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, isActorCovered, actorTauntAngerRestricted]);
  const selectedFlyMode = useMemo<{ point: ZonePoint; movesZone: boolean } | null>(() => {
    if (!actorTokenId) return null;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return null;

    if (isSelectedSelf) {
      return { point: actorToken, movesZone: false };
    }

    if (!selectedZoneTarget) return null;
    if (actorZoneId === null) return null;
    if (selectedZoneTarget.zoneId === actorZoneId) {
      return { point: actorToken, movesZone: false };
    }

    const distance = shortestZoneDistance(actorZoneId, selectedZoneTarget.zoneId, zoneAdjacency);
    if (distance !== 1) return null;
    return { point: selectedZoneTarget.point, movesZone: true };
  }, [actorTokenId, tokenByCharacterId, isSelectedSelf, selectedZoneTarget, actorZoneId, zoneAdjacency]);
  const canUseFlyFromSelection = useMemo(() => {
    if (!actorHasFlightTrait) return false;
    if (!combatMode || !actorTokenId || !isMyTurn) return false;
    if (!selectedFlyMode) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl) return false;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (!actorRestrictedToRun && (isActorProne || actorMovementLockedByHold)) return false;
    if (isActorCovered) return false;
    if (isActorEnemyEngagedForMovement) return false;
    return true;
  }, [actorHasFlightTrait, combatMode, actorTokenId, isMyTurn, selectedFlyMode, actorTauntAngerRestricted, actorDead, actorRestrictedToCrawl, currentEntry, actorRestrictedToRun, isActorProne, actorMovementLockedByHold, isActorCovered, isActorEnemyEngagedForMovement]);
  const canUseFlyDownFromSelection = canUseFlyFromSelection && actorElevation > 0;
  const canUseFleeFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !currentEntry || !isMyTurn) return false;
    if (!currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl) return false;
    if (!actorRestrictedToRun && (isActorProne || actorMovementLockedByHold)) return false;
    if (isActorCovered) return false;
    if (isActorEnemyEngagedForMovement) return false;
    if (!isSelectedSelf && !selectedZoneTarget) return false;
    return true;
  }, [combatMode, actorTokenId, currentEntry, isMyTurn, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, isActorProne, actorMovementLockedByHold, isActorEnemyEngagedForMovement, isSelectedSelf, selectedZoneTarget, isActorCovered, actorTauntAngerRestricted]);
  const canUseCrawlFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedZoneTarget || !isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || !actorRestrictedToCrawl) return false;
    if (isSkillBlockedForToken(actorTokenId, "MOVE")) return false;
    if (!currentEntry?.slow_available) return false;
    if (!isActorProne) return false;
    if (isActorCovered) return false;
    if (isActorEnemyEngagedForMovement) return false;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return false;
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (actorZone === null) return false;
    if (actorZone === selectedZoneTarget.zoneId) return false;
    const distance = shortestZoneDistance(actorZone, selectedZoneTarget.zoneId, zoneAdjacency);
    return distance === 1;
  }, [combatMode, actorTokenId, selectedZoneTarget, isMyTurn, actorDead, actorRestrictedToCrawl, currentEntry, isActorProne, isActorEnemyEngagedForMovement, tokenByCharacterId, zoneRegionMap, zoneAdjacency, isActorCovered, actorTauntAngerRestricted, isSkillBlockedForToken]);
  const canEnterCoverFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !currentEntry || !isMyTurn) return false;
    if (!currentEntry.fast_available && !currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorMovementLockedByHold) return false;
    if (isActorEnemyEngagedForMovement) return false;
    if (!actorZoneHasCover) return false;
    if (isActorCovered) return false;
    if (!isSelectedSelf && selectedZoneTarget?.zoneId !== actorZoneId) return false;
    return true;
  }, [
    combatMode,
    actorTokenId,
    currentEntry,
    isMyTurn,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorMovementLockedByHold,
    isActorEnemyEngagedForMovement,
    actorZoneHasCover,
    isActorCovered,
    isSelectedSelf,
    selectedZoneTarget,
    actorZoneId,
    actorTauntAngerRestricted,
  ]);
  const canExitCoverFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !currentEntry || !isMyTurn) return false;
    if (!currentEntry.fast_available && !currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorMovementLockedByHold) return false;
    if (!isActorCovered) return false;
    if (!isSelectedSelf && selectedZoneTarget?.zoneId !== actorZoneId) return false;
    return true;
  }, [
    combatMode,
    actorTokenId,
    currentEntry,
    isMyTurn,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorMovementLockedByHold,
    isActorCovered,
    isSelectedSelf,
    selectedZoneTarget,
    actorZoneId,
    actorTauntAngerRestricted,
  ]);
  const canUseRetreatFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId || !isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorMovementLockedByHold) return false;
    if (!isFreeRetreatAvailable && !(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (!isActorEngaged) return false;
    if (selectedTokenId === actorTokenId) return true;
    return areTokensEngagedAtSameElevation(actorTokenId, selectedTokenId);
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, currentEntry, isActorEngaged, isFreeRetreatAvailable, isActorProne, actorMovementLockedByHold, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted, areTokensEngagedAtSameElevation]);
  const canUseGetUpFromSelection = useMemo(() => {
    if (!combatMode || !actorTokenId || !selectedTokenId || !isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (!isActorProne) return false;
    if (isActorClinging || isActorGrappled) return false;
    if (isActorGrappling && !actorCanMoveWhileGrappling) return false;
    if (selectedTokenId !== actorTokenId) return false;
    return !!(currentEntry?.fast_available || currentEntry?.slow_available);
  }, [combatMode, actorTokenId, selectedTokenId, isMyTurn, isActorProne, currentEntry, isActorGrappling, isActorClinging, isActorGrappled, actorCanMoveWhileGrappling, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted]);
  const canUseFeintFromSelection = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId || !selectedTokenId) return false;
    if (selectedTokenId === actorTokenId) return false;
    if (!currentEntry.fast_available && !currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (selectedTargetDead) return false;
    return areTokensEngagedAtSameElevation(actorTokenId, selectedTokenId);
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, selectedTokenId, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, isActorProne, actorHardLockedByHold, selectedTargetDead, actorTauntAngerRestricted, areTokensEngagedAtSameElevation]);
  const canUseCoupFromSelection = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId || !selectedTokenId) return false;
    if (selectedTokenId === actorTokenId) return false;
    if (!currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (actorSpirit < 1) return false;
    if (selectedTargetDead) return false;
    if (!selectedTargetPhysicalBroken) return false;
    return areTokensEngagedAtSameElevation(actorTokenId, selectedTokenId);
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, selectedTokenId, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, isActorProne, actorHardLockedByHold, actorSpirit, selectedTargetDead, selectedTargetPhysicalBroken, actorTauntAngerRestricted, areTokensEngagedAtSameElevation]);

  const swingWeaponOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf) return [] as Array<{ id: string; name: string }>;
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
    if (actorTauntAngerRestricted) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
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
  }, [combatMode, currentEntry, isMyTurn, isSelectedSelf, actorCharacter, character, actorTokenId, monsterByParticipantId, isActorProne, actorHardLockedByHold, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted]);

  useEffect(() => {
    setMonsterRollResult(null);
  }, [selectedTokenId, selectedZoneTarget?.zoneId, currentEntry?.participant_id]);

  useEffect(() => {
    if (!isDmUser) return;
    if (!pendingArtRoll) return;
    if (!pendingArtRoll.actorCharacterId.startsWith("monster:")) return;
    if (!onResolveArtRoll) return;
    if (handledPendingMonsterArtRollIdRef.current === pendingArtRoll.id) return;

    const processMonsterArtRoll = async () => {
      const actorTokenId = pendingArtRoll.actorCharacterId;
      const art = artsCatalog.find((entry) => entry.id === pendingArtRoll.artId) || null;
      const parsedCost = parseArtCost(art?.cost || "0");
      const actorEntry =
        initiativeEntries.find((entry) => entry.participant_id === actorTokenId) || null;
      const actorMonster = initiativeMonsters.find((monster) => monster.id === actorTokenId) || null;
      const snapshot = actorEntry?.monster_snapshot || actorMonster?.monster_snapshot || null;
      const spiritBefore = Math.max(
        0,
        Number(snapshot?.spirits_current ?? snapshot?.starting_spirits ?? 0)
      );

      const firstRoll = Array.from(
        { length: spiritBefore },
        () => Math.floor(Math.random() * 6) + 1
      );
      const pushedRoll = firstRoll.map((die) =>
        die === 1 || die === 6 ? die : Math.floor(Math.random() * 6) + 1
      );
      const successes = pushedRoll.filter((die) => die === 6).length;
      const ones = pushedRoll.filter((die) => die === 1).length;
      const activated = successes >= parsedCost.minSuccesses;
      const postDamageSpirit = Math.max(0, spiritBefore - ones);
      const remainingAfterMin = activated ? Math.max(0, successes - parsedCost.minSuccesses) : 0;
      const scaling = parsedCost.hasScaling
        ? Math.floor(remainingAfterMin / parsedCost.scaleStep)
        : 0;
      const spiritFromLeftover = Math.max(
        0,
        successes - parsedCost.minSuccesses - (parsedCost.hasScaling ? parsedCost.scaleStep : 0)
      );
      const spiritAfter = postDamageSpirit + spiritFromLeftover;

      let nextEntries = initiativeEntries;
      let nextMonsters = initiativeMonsters;
      if (snapshot) {
        nextEntries = initiativeEntries.map((entry) => {
          if (entry.participant_id !== actorTokenId || !entry.monster_snapshot) return entry;
          return {
            ...entry,
            monster_snapshot: {
              ...entry.monster_snapshot,
              spirits_current: spiritAfter,
            },
          };
        });
        nextMonsters = initiativeMonsters.map((monster) => {
          if (monster.id !== actorTokenId || !monster.monster_snapshot) return monster;
          return {
            ...monster,
            monster_snapshot: {
              ...monster.monster_snapshot,
              spirits_current: spiritAfter,
            },
          };
        });

        setInitiativeEntries(nextEntries);
        setInitiativeMonsters(nextMonsters);

        const supabase = createClient();
        const { error: saveError } = await supabase
          .from("combat_state")
          .upsert(
            {
              id: 1,
              combat_mode: combatMode,
              initiative_entries: nextEntries,
              initiative_current_index: initiativeCurrentIndex,
              initiative_monsters: nextMonsters,
              engagements,
              zone_loot: zoneLoot,
              zone_cover: zoneCoverIds,
              updated_by_email: userEmail,
            },
            { onConflict: "id" }
          );
        if (saveError) {
          setError(saveError.message);
        }
      }

      setMonsterRollResult({
        actionLabel: pendingArtRoll.displayName || art?.name || "Art",
        attributeDice: pushedRoll,
        attributeLabel: "Spirit Dice (Pushed)",
        skillDice: firstRoll,
        skillLabel: "Spirit Dice (Initial)",
        skillIsNegative: false,
        gearDice: [],
        gearLabel: "Extra Dice",
        successes,
      });

      onConsumePendingArtRoll?.(pendingArtRoll.id);
      handledPendingMonsterArtRollIdRef.current = pendingArtRoll.id;
      await onResolveArtRoll({
        pendingRollId: pendingArtRoll.id,
        artId: pendingArtRoll.artId,
        artName: pendingArtRoll.displayName || art?.name || "Art",
        successes,
        scaling,
        spiritGenerated: spiritFromLeftover,
        activated,
        context: pendingArtRoll,
      });
      onArtRollCleared?.();
    };

    void processMonsterArtRoll();
  }, [
    isDmUser,
    pendingArtRoll,
    onResolveArtRoll,
    initiativeEntries,
    initiativeMonsters,
    initiativeCurrentIndex,
    combatMode,
    engagements,
    zoneLoot,
    zoneCoverIds,
    userEmail,
    onConsumePendingArtRoll,
    onArtRollCleared,
  ]);

  const selectedRange = useMemo<CombatRange | null>(() => {
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return null;
    if (areTokensEngagedAtSameElevation(actorTokenId, selectedTokenId)) return "Engaged";

    const actorToken = tokenByCharacterId.get(actorTokenId);
    const targetToken = tokenByCharacterId.get(selectedTokenId);
    if (!actorToken || !targetToken) return null;

    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
    if (actorZone === null || targetZone === null) return null;

    const lateralDistance = shortestZoneDistance(actorZone, targetZone, zoneAdjacency);
    const verticalDistance = Math.abs(tokenElevationForTokenId(actorTokenId) - tokenElevationForTokenId(selectedTokenId));
    return rangeFromLateralAndVerticalDistance(lateralDistance, verticalDistance);
  }, [actorTokenId, selectedTokenId, tokenByCharacterId, zoneRegionMap, zoneAdjacency, tokenElevationForTokenId, areTokensEngagedAtSameElevation]);

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
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return false;
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return false;
    if (actorHardLockedByHold || isActorProne || isActorClungOnto) return false;
    if (actorHasOccupiedHands) return false;
    if (selectedRange !== "Engaged") return false;
    if (!selectedTargetEntry) return false;
    const targetHasClungIds =
      (selectedTargetEntry.clung_onto_by_ids?.length ?? 0) > 0 || !!selectedTargetEntry.clung_onto_by_id;
    if (
      selectedTargetEntry.grappling_target_id ||
      selectedTargetEntry.grappled_by_id ||
      selectedTargetEntry.clinging_target_id ||
      targetHasClungIds
    ) {
      return false;
    }
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
    isActorClungOnto,
    actorHasOccupiedHands,
    selectedRange,
    selectedTargetEntry,
    selectedTargetSize,
    actorSize,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    actorTauntAngerRestricted,
    isSkillBlockedForToken,
  ]);

  const canUseClingFromSelection = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !currentEntry.slow_available) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return false;
    if (!actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return false;
    if (actorHardLockedByHold || isActorProne || isActorClungOnto) return false;
    if (actorHasOccupiedHands) return false;
    if (selectedRange !== "Engaged") return false;
    if (!selectedTargetEntry) return false;
    if (selectedTargetEntry.clinging_target_id) return false;
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
    isActorClungOnto,
    actorHasOccupiedHands,
    selectedRange,
    selectedTargetEntry,
    selectedTargetSize,
    actorSize,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    actorTauntAngerRestricted,
    isSkillBlockedForToken,
  ]);

  const canUseRelease = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToRun) return false;
    if (actorRestrictedToCrawl) return false;
    if (!(isActorGrappling || isActorClinging)) return false;
    return selectedIsActorOrHoldCounterpart;
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, isActorGrappling, isActorClinging, selectedIsActorOrHoldCounterpart, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted]);

  const canUseBreakFree = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !actorTokenId) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return false;
    if (!(isActorGrappled || isActorClungOnto)) return false;
    return selectedIsActorOrHoldCounterpart;
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, isActorGrappled, isActorClungOnto, selectedIsActorOrHoldCounterpart, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted]);

  const canPass = useMemo(() => {
    if (!currentEntry) return false;
    if (incomingPipelineActive) return false;
    if (
      combatMode &&
      actorTokenId &&
      pendingReactions.some((reaction) => reaction.attackerCharacterId === actorTokenId)
    ) {
      return false;
    }
    if (isDmUser) return currentEntry.kind === "monster";
    return Boolean(currentUserTokenId && actorTokenId === currentUserTokenId);
  }, [currentEntry, currentUserTokenId, isDmUser, combatMode, actorTokenId, pendingReactions, incomingPipelineActive]);
  const actorEquippedFlamingLongsword = useMemo<InventoryItem | null>(() => {
    if (!currentEntry) return null;
    if (currentEntry.kind === "player") {
      const held = playerHeldItems(actorTokenCharacter);
      return held.find((item) => isFlamingLongswordItem(item)) || null;
    }
    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot) return null;
    const weapon = monsterEquippedMeleeWeapons(snapshot).find((item) =>
      item.properties.some((prop) => prop === FLAMING_LONGSWORD_PROPERTY)
    );
    if (!weapon) return null;
    return {
      id: weapon.id,
      name: weapon.name,
      weight: 0,
      item_type: "Melee Weapon",
      properties: weapon.properties,
    };
  }, [currentEntry, actorTokenCharacter, isFlamingLongswordItem]);
  const actorLampOilCount = useMemo(() => {
    if (!currentEntry) return 0;
    const sourceItems =
      currentEntry.kind === "player"
        ? actorTokenCharacter?.inventory || []
        : currentEntry.monster_snapshot?.gear || [];
    return sourceItems.reduce((count, item) => {
      if (!isLampOilItem(item)) return count;
      return count + Math.max(1, Math.trunc(item.quantity ?? 1));
    }, 0);
  }, [currentEntry, actorTokenCharacter, isLampOilItem]);
  const canUseFlamingLongswordItem = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf || !actorTokenId) return false;
    if (!(currentEntry.fast_available || currentEntry.slow_available)) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (isActorCovered) return false;
    if (!actorEquippedFlamingLongsword) return false;
    if (actorLampOilCount < 1) return false;
    return !actorUsedItemFlags.has(FLAMING_LONGSWORD_USED_FLAG);
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isSelectedSelf,
    actorTokenId,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorHardLockedByHold,
    isActorCovered,
    actorEquippedFlamingLongsword,
    actorLampOilCount,
    actorUsedItemFlags,
  ]);
  const canUseSnuff = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf || !actorTokenId) return false;
    if (!currentEntry.slow_available) return false;
    if (actorFlameIntensity <= 0) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (isActorCovered) return false;
    if (isSkillBlockedForToken(actorTokenId, "MOVE")) return false;
    return true;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isSelectedSelf,
    actorTokenId,
    actorFlameIntensity,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorHardLockedByHold,
    isActorCovered,
    isSkillBlockedForToken,
  ]);
  const setUsedItemFlag = useCallback(
    async (tokenId: string, flag: string, enabled: boolean): Promise<boolean> => {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("combat_set_used_item_flag", {
        p_actor_token_id: tokenId,
        p_flag: flag,
        p_enabled: enabled,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    },
    []
  );

  const canUseDrawGearFromToken = useMemo(() => {
    if (!combatMode || !selectedTokenId || !currentEntry) return false;
    if (!actorTokenId || selectedTokenId !== actorTokenId) return false;
    if (!isMyTurn) return false;
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return false;
    if (isActorProne || actorHardLockedByHold) return false;
    if (currentEntry.kind === "monster" && !isDmUser) return false;
    if (
      currentEntry.kind === "player" &&
      !isDmUser &&
      (!currentUserTokenId || selectedTokenId !== currentUserTokenId)
    ) {
      return false;
    }
    return !!(currentEntry?.fast_available || currentEntry?.slow_available);
  }, [combatMode, selectedTokenId, actorTokenId, currentEntry, isMyTurn, isDmUser, currentUserTokenId, isActorProne, actorHardLockedByHold, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted]);

  const meleeActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || actorDead || actorRestrictedToCrawl || actorRestrictedToRun || (isActorProne && !actorHardLockedByHold)) {
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
    if (actorTauntAngerRestricted && selectedTokenId !== actorTauntedAngerById) return [];
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return [];

    if (actorHardLockedByHold) {
      if (!(currentEntry.fast_available || currentEntry.slow_available)) return [];
      if (!(isActorGrappling || isActorClinging)) return [];
      const onlyCounterpart = actorGrapplingTargetId || actorClingingTargetId;
      if (!onlyCounterpart || selectedTokenId !== onlyCounterpart) return [];
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
  }, [combatMode, currentEntry, isMyTurn, actorCharacter, character, selectedTokenId, selectedRange, actorTokenId, monsterByParticipantId, isActorProne, actorHardLockedByHold, isActorGrappling, isActorClinging, actorGrapplingTargetId, actorClingingTargetId, actorDead, actorRestrictedToCrawl, actorRestrictedToRun, actorTauntAngerRestricted, actorTauntedAngerById, isSkillBlockedForToken]);

  const shoveActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || actorDead || actorRestrictedToCrawl || actorRestrictedToRun || isActorProne || actorHardLockedByHold) {
      return [] as Array<{ weaponItemId?: string | null; weaponName: string; gearDice: number; bonusDice: number }>;
    }
    if (!selectedTokenId || !selectedRange || selectedRange !== "Engaged") return [];
    if (selectedTokenId === actorTokenId) return [];
    if (actorTauntAngerRestricted) return [];
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return [];
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
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    actorTauntAngerRestricted,
    isSkillBlockedForToken,
  ]);

  const disarmActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || actorDead || actorRestrictedToCrawl || actorRestrictedToRun || isActorProne || actorHardLockedByHold) {
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
    if (actorTauntAngerRestricted) return [];
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return [];
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
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    actorTauntAngerRestricted,
    isSkillBlockedForToken,
  ]);

  const healActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn) return [] as Array<{
      attribute: AttributeKey;
      skill: "HEALING" | "PERFORMANCE";
      label: string;
    }>;
    if (!selectedTokenId) return [];
    if (actorTauntAngerRestricted) return [];
    if (!currentEntry.slow_available) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
    if (isActorProne || actorHardLockedByHold) return [];
    if (selectedTargetDead) return [];
    if (!selectedTargetState) return [];
    if (isTokenEnemyEngaged(selectedTokenId)) return [];

    const options: Array<{ attribute: AttributeKey; skill: "HEALING" | "PERFORMANCE"; label: string }> = [];
    const physicalAttrs = selectedTargetState.physicalBrokenAttrs || [];
    const mentalAttrs = selectedTargetState.mentalBrokenAttrs || [];
    const canUseHealing = !isSkillBlockedForToken(actorTokenId, "HEALING");
    const canUsePerformance = !isSkillBlockedForToken(actorTokenId, "PERFORMANCE");

    for (const attr of physicalAttrs) {
      if (!canUseHealing) break;
      if (attr === "STR" || attr === "AGL") {
        options.push({ attribute: attr, skill: "HEALING", label: `Healing (${attr})` });
      }
    }
    for (const attr of mentalAttrs) {
      if (!canUsePerformance) break;
      if (attr === "WIT" || attr === "EMP") {
        options.push({ attribute: attr, skill: "PERFORMANCE", label: `Healing (${attr})` });
      }
    }
    return options;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    selectedTokenId,
    actorTauntAngerRestricted,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorHardLockedByHold,
    selectedTargetDead,
    selectedTargetState,
    isTokenEnemyEngaged,
    isSkillBlockedForToken,
    actorTokenId,
  ]);

  const tauntActionOptions = useMemo<Array<{ mode: "anger" | "distract"; label: string }>>(() => {
    if (!combatMode || !currentEntry || !isMyTurn) return [] as Array<{ mode: "anger" | "distract"; label: string }>;
    if (!selectedTokenId || selectedTokenId === actorTokenId) return [];
    if (actorTauntAngerRestricted) return [];
    if (!currentEntry.slow_available) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
    if (isActorCovered) return [];
    if (isActorProne || actorHardLockedByHold) return [];
    if (selectedTargetDead) return [];
    if (!selectedRange) return [];
    if (!(selectedRange === "Engaged" || selectedRange === "Near" || selectedRange === "Close")) return [];
    if (isSkillBlockedForToken(actorTokenId, "PERFORMANCE")) return [];

    return [
      { mode: "anger", label: "Taunt (Anger)" },
      { mode: "distract", label: "Taunt (Distract)" },
    ];
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    selectedTokenId,
    actorTokenId,
    actorTauntAngerRestricted,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorCovered,
    isActorProne,
    actorHardLockedByHold,
    selectedTargetDead,
    selectedRange,
    isSkillBlockedForToken,
  ]);

  const readyOrLoadOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf) return [] as Array<{
      weaponItemId: string;
      weaponName: string;
      isLoading: boolean;
      hand: "left" | "right" | "both";
    }>;
    if (currentReadied) return [];
    if (actorTauntAngerRestricted) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
    if (isActorProne || actorHardLockedByHold) return [];

    const options: Array<{ weaponItemId: string; weaponName: string; isLoading: boolean; hand: "left" | "right" | "both" }> = [];
    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character || actorCharacter.id !== character.id) return [];
      const ammoExists = (character.inventory || []).some(isAmmunition);
      if (!ammoExists) return [];
      for (const weapon of playerEquippedRangedWeapons(character)) {
        const hand = readiedHandForWeapon(character.equipment_slots, weapon);
        if (!hand) continue;
        const props = (weapon.properties || []).map((p) => p.toLowerCase());
        const isLoading = props.includes("loading");
        if (isLoading ? !currentEntry.slow_available : !(currentEntry.fast_available || currentEntry.slow_available)) continue;
        options.push({
          weaponItemId: weapon.id,
          weaponName: weapon.name,
          isLoading,
          hand,
        });
      }
    } else {
      const snapshot = currentEntry.monster_snapshot;
      if (!snapshot) return [];
      const ammoExists = (snapshot.gear || []).some(isAmmunition);
      if (!ammoExists) return [];
      for (const weapon of monsterEquippedRangedWeapons(snapshot)) {
        const hand = readiedHandForWeapon(snapshot.equipment_slots, weapon);
        if (!hand) continue;
        const props = (weapon.properties || []).map((p) => p.toLowerCase());
        const isLoading = props.includes("loading");
        if (isLoading ? !currentEntry.slow_available : !(currentEntry.fast_available || currentEntry.slow_available)) continue;
        options.push({
          weaponItemId: weapon.id,
          weaponName: weapon.name,
          isLoading,
          hand,
        });
      }
    }
    return options;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    isSelectedSelf,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorHardLockedByHold,
    actorCharacter,
    character,
    currentReadied,
    actorTauntAngerRestricted,
  ]);

  const canUseUnready = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !isSelectedSelf) return false;
    if (actorTauntAngerRestricted) return false;
    if (!currentReadied) return false;
    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character || actorCharacter.id !== character.id) return false;
      const heldHand = readiedHandForWeapon(character.equipment_slots, {
        id: currentReadied.weaponItemId,
        name: currentReadied.weaponName,
      });
      return heldHand !== null;
    }
    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot) return false;
    const heldHand = readiedHandForWeapon(snapshot.equipment_slots, {
      id: currentReadied.weaponItemId,
      name: currentReadied.weaponName,
    });
    return heldHand !== null;
  }, [combatMode, currentEntry, isMyTurn, isSelectedSelf, currentReadied, actorCharacter, character, actorTauntAngerRestricted]);

  const aimActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !selectedTokenId || !selectedRange) return [] as Array<{
      weaponItemId: string;
      weaponName: string;
    }>;
    if (!actorTokenId || selectedTokenId === actorTokenId) return [];
    if (!currentEntry.fast_available && !currentEntry.slow_available) return [];
    if (actorTauntAngerRestricted) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
    if (isActorProne || actorHardLockedByHold) return [];
    if (selectedRange === "Engaged" || selectedRange === "Near") return [];
    const options: Array<{ weaponItemId: string; weaponName: string }> = [];
    const sourceWeapons =
      currentEntry.kind === "player"
        ? actorCharacter && character && actorCharacter.id === character.id
          ? playerEquippedRangedWeapons(character)
          : []
        : currentEntry.monster_snapshot
          ? monsterEquippedRangedWeapons(currentEntry.monster_snapshot)
          : [];
    for (const weapon of sourceWeapons) {
      if (!weaponSupportsRange(weapon.range_band, selectedRange)) continue;
      options.push({ weaponItemId: weapon.id, weaponName: weapon.name });
    }
    return options;
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    selectedTokenId,
    selectedRange,
    actorTokenId,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorProne,
    actorHardLockedByHold,
    actorCharacter,
    character,
    actorTauntAngerRestricted,
  ]);

  const shootActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || !selectedTokenId || !selectedRange || !currentReadied) return [] as Array<{
      weaponItemId: string;
      weaponName: string;
      rangePenalty: number;
      aimBonusDice: number;
      targetZoneId: number | null;
    }>;
    if (!currentEntry.slow_available) return [];
    if (!actorTokenId || selectedTokenId === actorTokenId) return [];
    if (actorTauntAngerRestricted && selectedTokenId !== actorTauntedAngerById) return [];
    if (isSkillBlockedForToken(actorTokenId, "MARKSMANSHIP")) return [];
    if (actorDead || actorRestrictedToCrawl || actorRestrictedToRun) return [];
    if (isActorCovered) return [];
    if (isActorProne || actorHardLockedByHold) return [];
    if (isActorEngaged) return [];
    const actorToken = tokenByCharacterId.get(actorTokenId);
    const targetToken = tokenByCharacterId.get(selectedTokenId);
    const targetZoneId = targetToken ? zoneIdAtPoint(zoneRegionMap, targetToken) : null;
    const sourceWeapons =
      currentEntry.kind === "player"
        ? actorCharacter && character && actorCharacter.id === character.id
          ? playerEquippedRangedWeapons(character)
          : []
        : currentEntry.monster_snapshot
          ? monsterEquippedRangedWeapons(currentEntry.monster_snapshot)
          : [];
    const weapon = sourceWeapons.find((w) => w.id === currentReadied.weaponItemId);
    if (!weapon) return [];
    if (!weaponSupportsRange(weapon.range_band, selectedRange)) return [];
    const rangePenalty =
      selectedRange === "Close" ? -1 : selectedRange === "Long" ? -2 : selectedRange === "Distant" ? -3 : 0;
    const aimBonusDice =
      currentAim &&
      currentAim.targetId === selectedTokenId &&
      currentAim.weaponItemId === currentReadied.weaponItemId
        ? 1
        : 0;
    if (!actorToken) return [];
    return [
      {
        weaponItemId: weapon.id,
        weaponName: weapon.name,
        rangePenalty,
        aimBonusDice,
        targetZoneId,
      },
    ];
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    selectedTokenId,
    selectedRange,
    currentReadied,
    actorTokenId,
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
    isActorCovered,
    isActorProne,
    actorHardLockedByHold,
    isActorEngaged,
    tokenByCharacterId,
    zoneRegionMap,
    actorCharacter,
    character,
    currentAim,
    actorTauntAngerRestricted,
    actorTauntedAngerById,
    isSkillBlockedForToken,
  ]);

  const pickUpActionOptions = useMemo(() => {
    if (!combatMode || !currentEntry || !isMyTurn || actorDead || actorRestrictedToCrawl || actorRestrictedToRun || isActorProne || actorHardLockedByHold) return [] as InventoryItem[];
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
    actorDead,
    actorRestrictedToCrawl,
    actorRestrictedToRun,
  ]);
  const pickUpActionOptionGroups = useMemo(
    () => groupItemsForDisplay(pickUpActionOptions),
    [pickUpActionOptions]
  );

  const loadCombatState = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const supabase = createClient();
    let data: CombatStateRow | null = null;
    let loadError: { message: string; code?: string } | null = null;

    const fullSelect = await supabase
      .from("combat_state")
      .select(
        "id, map_url, zone_lines, zone_cover, token_positions, token_elevations, engagements, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, zone_loot, pending_reactions, updated_by_email, updated_at"
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
        .maybeSingle<Omit<CombatStateRow, "zone_loot" | "pending_reactions">>();
      if (fallbackSelect.error) {
        setError(fallbackSelect.error.message);
        isSyncingRef.current = false;
        return;
      }
      data = fallbackSelect.data
        ? ({ ...fallbackSelect.data, zone_loot: [], pending_reactions: [], token_elevations: [] } as CombatStateRow)
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
    setZoneCoverIds(normalizeZoneCover(data?.zone_cover));
    setTokenPositions(normalizeTokenPositions(data?.token_positions));
    setTokenElevations(normalizeTokenElevations(data?.token_elevations));
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
    setPendingReactions(normalizePendingReactions(data?.pending_reactions));
    setError(null);
    isSyncingRef.current = false;
  }, []);

  const handleCombatPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      isResizingPanelRef.current = true;
      resizePanelStartRef.current = {
        startY: event.clientY,
        startHeight: combatPanelHeight,
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [combatPanelHeight]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingPanelRef.current) return;
      const start = resizePanelStartRef.current;
      if (!start) return;
      const nextHeight = Math.max(
        MIN_COMBAT_PANEL_HEIGHT,
        Math.min(MAX_COMBAT_PANEL_HEIGHT, Math.trunc(start.startHeight + (event.clientY - start.startY)))
      );
      setCombatPanelHeight(nextHeight);
    };

    const stopResizing = () => {
      if (!isResizingPanelRef.current && !resizePanelStartRef.current) return;
      isResizingPanelRef.current = false;
      resizePanelStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      stopResizing();
    };
  }, [MAX_COMBAT_PANEL_HEIGHT, MIN_COMBAT_PANEL_HEIGHT]);

  const loadCharacters = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("characters")
      .select("id, name, email, icon_url, attributes, max_attributes, skills, inventory, equipment_slots, spirits, dead, talent_levels, talents")
      .order("name", { ascending: true });

    let rows = data as CharacterLite[] | null;
    if (loadError && loadError.code === "42703") {
      const fallback = await supabase
        .from("characters")
        .select("id, name, email, icon_url, attributes, max_attributes, skills, inventory, equipment_slots, spirits, dead, talent_levels")
        .order("name", { ascending: true });
      if (fallback.error) {
        setError(fallback.error.message);
        return;
      }
      rows = (fallback.data || []) as CharacterLite[];
    } else if (loadError) {
      setError(loadError.message);
      return;
    }

    const normalized = ((rows ?? []) as CharacterLite[]).map((char) => ({
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
          loadCharacters();
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
      loadCharacters();
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
      elevations: TokenElevation[] | null = null,
      loot: ZoneLootDrop[] = zoneLoot,
      cover: number[] = zoneCoverIds
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
        zone_cover: number[];
        token_positions?: TokenPosition[];
        token_elevations?: TokenElevation[];
        updated_by_email: string | null;
      } = {
        id: 1,
        combat_mode: combatModeValue,
        initiative_entries: entries,
        initiative_current_index: currentIndex,
        initiative_monsters: monsters,
        engagements: engagementEdges,
        zone_loot: loot,
        zone_cover: cover,
        updated_by_email: userEmail,
      };
      if (tokens) payload.token_positions = tokens;
      if (elevations) payload.token_elevations = elevations;
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("combat_state")
        .upsert(payload, { onConflict: "id" });
      if (saveError) {
        setError(saveError.message);
      }
    },
    [initiativeMonsters, engagements, zoneLoot, zoneCoverIds, isDmUser, userEmail]
  );

  const fetchLatestInitiativeState = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("combat_state")
      .select("initiative_entries, initiative_monsters, initiative_current_index, engagements, zone_loot, zone_cover")
      .eq("id", 1)
      .maybeSingle<CombatStateMutationRow>();
    if (loadError) {
      setError(loadError.message);
      return null;
    }
    const freshEntries = normalizeInitiativeEntries(data?.initiative_entries);
    const freshMonsters = Array.isArray(data?.initiative_monsters)
      ? (data!.initiative_monsters
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
          .filter((monster): monster is InitiativeMonster => !!monster))
      : [];
    const freshCurrentIndex = data?.initiative_current_index ?? null;
    const freshEngagements = normalizeEngagements(data?.engagements);
    const freshLoot = normalizeZoneLoot(data?.zone_loot);
    const freshCover = normalizeZoneCover(data?.zone_cover);
    return { freshEntries, freshMonsters, freshCurrentIndex, freshEngagements, freshLoot, freshCover };
  }, []);

  const rollInitiative = async () => {
    if (!isDmUser) return;
    const used = new Set<string>();
    const supabase = createClient();
    const updatedPlayers: Array<{ id: string; inventory: InventoryItem[] }> = [];
    const playerEntries = characters.map((player) => {
      const heldRanged = playerEquippedRangedWeapons(player);
      let readiedWeapon: InventoryItem | null = null;
      let readiedHand: "left" | "right" | "both" | null = null;
      for (const weapon of heldRanged) {
        const hand = readiedHandForWeapon(player.equipment_slots, weapon);
        if (!hand) continue;
        readiedWeapon = weapon;
        readiedHand = hand;
        break;
      }
      let readiedAmmo: InventoryItem | null = null;
      if (readiedWeapon) {
        const consumed = consumeFirstAmmo(player.inventory || []);
        if (consumed.ammo) {
          readiedAmmo = consumed.ammo;
          updatedPlayers.push({ id: player.id, inventory: consumed.nextItems });
        }
      }
      return {
        participant_id: `player:${player.id}`,
        kind: "player" as const,
        name: player.name,
        user_email: player.email,
        icon_url: player.icon_url,
        roll: rollHighestOfD10Unique(used, lightningFastInitiativeRollCount(player)),
        slow_available: true,
        fast_available: true,
        prone: false,
        covered: false,
        blitzed: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
        taunted_anger_by_id: null,
        taunted_anger_by_name: null,
        taunted_distract_value: null,
        readied_weapon_item_id: readiedWeapon && readiedAmmo ? readiedWeapon.id : null,
        readied_weapon_name: readiedWeapon && readiedAmmo ? readiedWeapon.name : null,
        readied_weapon_hand: readiedWeapon && readiedAmmo ? readiedHand : null,
        readied_ammo_item: readiedAmmo,
      };
    });

    const monsterReadiedById = new Map<
      string,
      { weapon: InventoryItem; hand: "left" | "right" | "both"; ammo: InventoryItem }
    >();
    const nextMonsters = initiativeMonsters.map((monster) => {
      const snapshot = monster.monster_snapshot;
      if (!snapshot) return monster;
      const ranged = monsterEquippedRangedWeapons(snapshot);
      let readiedWeapon: InventoryItem | null = null;
      let readiedHand: "left" | "right" | "both" | null = null;
      for (const weapon of ranged) {
        const hand = readiedHandForWeapon(snapshot.equipment_slots, weapon);
        if (!hand) continue;
        readiedWeapon = weapon;
        readiedHand = hand;
        break;
      }
      if (!readiedWeapon) return monster;
      const consumed = consumeFirstAmmo(snapshot.gear || []);
      if (!consumed.ammo) return monster;
      monsterReadiedById.set(monster.id, {
        weapon: readiedWeapon,
        hand: readiedHand!,
        ammo: consumed.ammo,
      });
      return {
        ...monster,
        monster_snapshot: {
          ...snapshot,
          gear: consumed.nextItems,
        },
      };
    });
    const initiativeHasBlitz = nextMonsters.some((monster) =>
      monsterHasTrait(monster.monster_snapshot, BLITZ_MONSTER_TRAIT)
    );

    const monsterEntries = nextMonsters.map((monster) => {
      const snapshot = monster.monster_snapshot;
      const readied = monsterReadiedById.get(monster.id) || null;
      const normalizedSnapshot = snapshot
        ? {
            ...snapshot,
            gear: snapshot.gear || [],
          }
        : snapshot;
      const isFirst = monsterHasTrait(normalizedSnapshot, FIRST_MONSTER_TRAIT);
      return {
        participant_id: monster.id,
        kind: "monster" as const,
        name: monster.name,
        user_email: null,
        icon_url: monster.icon_url,
        monster_template_id: monster.template_id,
        monster_snapshot: normalizedSnapshot,
        roll: isFirst ? rollUniqueFromBase(used, 9) : rollUnique(used),
        slow_available: true,
        fast_available: true,
        prone: false,
        covered: false,
        blitzed: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
        taunted_anger_by_id: null,
        taunted_anger_by_name: null,
        taunted_distract_value: null,
        readied_weapon_item_id: readied?.weapon.id ?? null,
        readied_weapon_name: readied?.weapon.name ?? null,
        readied_weapon_hand: readied?.hand ?? null,
        readied_ammo_item: readied?.ammo ?? null,
      };
    });

    const entries: InitiativeEntry[] = [...playerEntries, ...monsterEntries]
      .map((entry) => {
        if (!initiativeHasBlitz) return entry;
        if (entry.kind !== "monster") return { ...entry, blitzed: true };
        return {
          ...entry,
          blitzed: !monsterHasTrait(entry.monster_snapshot, BLITZ_MONSTER_TRAIT),
        };
      })
      .sort(
      (a, b) => rollSortValue(b.roll) - rollSortValue(a.roll)
      );

    const currentIndex = entries.length > 0 ? 0 : null;
    for (const p of updatedPlayers) {
      await supabase.from("characters").update({ inventory: p.inventory }).eq("id", p.id);
    }
    setInitiativeMonsters(nextMonsters);
    setCombatMode(true);
    setInitiativeEntries(entries);
    setInitiativeCurrentIndex(currentIndex);
    await saveInitiativeState(entries, currentIndex, true, nextMonsters);
    await loadCharacters();
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
          const merged = addItemToInventory(wagon1, drop.item);
          wagon1.length = 0;
          wagon1.push(...merged);
          wagon1Weight += w;
          continue;
        }
        if (wagon2Weight + w <= maxWagonWeight) {
          const merged = addItemToInventory(wagon2, drop.item);
          wagon2.length = 0;
          wagon2.push(...merged);
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

    const detachedTokenPositions = (() => {
      if (!imageRect || tokenPositions.length === 0 || initiativeEntries.length === 0) return tokenPositions;

      const byId = new Map<string, TokenPosition>();
      for (const token of tokenPositions) byId.set(token.character_id, token);

      const clingersByTargetMap = new Map<string, string[]>();
      for (const entry of initiativeEntries) {
        if (!entry.clinging_target_id) continue;
        const clingerId =
          entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
        if (!clingersByTargetMap.has(entry.clinging_target_id)) clingersByTargetMap.set(entry.clinging_target_id, []);
        clingersByTargetMap.get(entry.clinging_target_id)!.push(clingerId);
      }
      for (const [, ids] of clingersByTargetMap) ids.sort();

      const baseDiameter = 40;
      const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
      const findEntry = (tokenId: string) =>
        initiativeEntries.find(
          (entry) => entry.participant_id === tokenId || entry.participant_id === `player:${tokenId}`
        );
      const tokenSize = (tokenId: string) => {
        if (!tokenId.startsWith("monster:")) return baseDiameter;
        const size = Math.trunc(monsterByParticipantId.get(tokenId)?.monster_snapshot?.size ?? 1);
        const scale = Math.pow(2, Math.max(1, size) - 1);
        return Number.isFinite(scale) && scale > 0 ? baseDiameter * scale : baseDiameter;
      };

      return tokenPositions.map((token) => {
        const entry = findEntry(token.character_id);
        const attachedTargetId = entry?.grappling_target_id || entry?.clinging_target_id || null;
        if (!attachedTargetId) return token;

        const target = byId.get(attachedTargetId);
        if (!target) return token;

        let unitX = 1;
        let unitY = 0;
        if (entry?.clinging_target_id) {
          const peers = clingersByTargetMap.get(attachedTargetId) || [];
          const idx = Math.max(0, peers.indexOf(token.character_id));
          const angle = (idx / Math.max(1, peers.length)) * Math.PI * 2;
          unitX = Math.cos(angle);
          unitY = Math.sin(angle);
        } else {
          const dx = token.x - target.x;
          const dy = token.y - target.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.0001) {
            unitX = dx / dist;
            unitY = dy / dist;
          } else {
            unitX = token.character_id < attachedTargetId ? 1 : -1;
            unitY = 0;
          }
        }

        const desiredPx = tokenSize(token.character_id) / 2 + tokenSize(attachedTargetId) / 2;
        return {
          character_id: token.character_id,
          x: clamp01(target.x + (unitX * desiredPx) / imageRect.w),
          y: clamp01(target.y + (unitY * desiredPx) / imageRect.h),
        };
      });
    })();
    const resetElevations: TokenElevation[] = detachedTokenPositions.map((token) => ({
      character_id: token.character_id,
      elevation: 0,
    }));

    setInitiativeEntries([]);
    setInitiativeCurrentIndex(null);
    setEngagements([]);
    setCombatMode(false);
    setTokenPositions(detachedTokenPositions);
    setTokenElevations(resetElevations);
    setSelectedTokenId(null);
    setSelectedZoneTarget(null);
    setMonsterNameDrafts({});
    setInitiativeMonsters(preservedMonsters);
    await saveInitiativeState(
      [],
      null,
      false,
      preservedMonsters,
      [],
      detachedTokenPositions,
      resetElevations,
      nextZoneLootAfterReset,
      zoneCoverIds
    );
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
        roll: monsterHasTrait(deployedMonster.monster_snapshot, FIRST_MONSTER_TRAIT)
          ? rollUniqueFromBase(used, 9)
          : rollUnique(used),
        slow_available: true,
        fast_available: true,
        prone: false,
        covered: false,
        blitzed: false,
        swing_weapon_item_id: null,
        swing_weapon_name: null,
        taunted_anger_by_id: null,
        taunted_anger_by_name: null,
        taunted_distract_value: null,
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
    if (monster) {
      await deployMonsterTemplate(monster, quantity);
      setDeployMonsterQuery("");
      setError(null);
      return;
    }

    const player = characters.find((char) => char.name.trim().toLowerCase() === baseName);
    if (!player) {
      return;
    }
    await addPlayerToInitiative(player);
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

  const removeParticipantFromInitiative = async (participantId: string) => {
    if (!isDmUser) return;
    const removedEntryIndex = initiativeEntries.findIndex((entry) => entry.participant_id === participantId);
    const tokenId = participantId.startsWith("player:") ? participantId.slice(7) : participantId;
    const nextEntries = initiativeEntries.filter((entry) => entry.participant_id !== participantId);
    const nextMonsters = initiativeMonsters.filter((monster) => monster.id !== participantId);
    const nextTokens = tokenPositions.filter((token) => token.character_id !== tokenId);
    const nextEdges = engagements.filter((edge) => edge.a !== tokenId && edge.b !== tokenId);

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
    setTokenPositions(nextTokens);
    setEngagements(nextEdges);
    setSelectedTokenId((prev) => (prev === tokenId ? null : prev));
    setMonsterNameDrafts((prev) => {
      const next = { ...prev };
      delete next[participantId];
      return next;
    });
    await saveInitiativeState(nextEntries, nextCurrent, combatMode, nextMonsters, nextEdges, nextTokens);
  };

  const deleteMonster = async (monsterId: string) => {
    if (!isDmUser) return;
    await removeParticipantFromInitiative(monsterId);
  };

  const addPlayerToInitiative = async (player: CharacterLite) => {
    if (!isDmUser) return;
    const participantId = `player:${player.id}`;
    if (initiativeEntries.some((entry) => entry.participant_id === participantId)) return;

    let nextEntries = initiativeEntries;
    let nextCurrent = initiativeCurrentIndex;
    const newEntry: InitiativeEntry = {
      participant_id: participantId,
      kind: "player",
      name: player.name,
      user_email: player.email,
      icon_url: player.icon_url,
      roll: null,
      slow_available: true,
      fast_available: true,
      prone: false,
      covered: false,
      blitzed: false,
      swing_weapon_item_id: null,
      swing_weapon_name: null,
      readied_weapon_item_id: null,
      readied_weapon_name: null,
      readied_weapon_hand: null,
      readied_ammo_item: null,
      aim_target_id: null,
      aim_target_name: null,
      aim_weapon_item_id: null,
      aim_weapon_name: null,
      grappling_target_id: null,
      grappling_target_name: null,
      grappled_by_id: null,
      grappled_by_name: null,
      clinging_target_id: null,
      clinging_target_name: null,
      clung_onto_by_id: null,
      clung_onto_by_name: null,
      clung_onto_by_ids: [],
      clung_onto_by_names: [],
      taunted_anger_by_id: null,
      taunted_anger_by_name: null,
      taunted_distract_value: null,
      dead: Boolean(player.dead),
    };

    if (initiativeEntries.length > 0) {
      const used = new Set(
        initiativeEntries.flatMap((entry) => (entry.roll === null ? [] : [formatRoll(entry.roll)]))
      );
      newEntry.roll = rollHighestOfD10Unique(used, lightningFastInitiativeRollCount(player));
      nextEntries = [...initiativeEntries, newEntry].sort((a, b) => rollSortValue(b.roll) - rollSortValue(a.roll));
      const currentParticipant = currentEntry?.participant_id ?? null;
      if (currentParticipant) {
        const idx = nextEntries.findIndex((entry) => entry.participant_id === currentParticipant);
        nextCurrent = idx >= 0 ? idx : 0;
      } else {
        nextCurrent = 0;
      }
      setInitiativeEntries(nextEntries);
      setInitiativeCurrentIndex(nextCurrent);
    } else {
      nextEntries = [...initiativeEntries, newEntry];
      setInitiativeEntries(nextEntries);
    }

    await saveInitiativeState(nextEntries, nextCurrent, combatMode, initiativeMonsters, engagements, tokenPositions);
  };

  const passTurn = async () => {
    await combatActions.passTurnAction({
      canPass,
      currentParticipantId: currentEntry?.participant_id ?? null,
      clearSwingForParticipant,
      setError,
    });
  };

  const engageByTokenIds = async (actorTokenIdValue: string, targetTokenIdValue: string): Promise<boolean> => {
    if (!isDmUser) return false;
    if (actorTokenIdValue === targetTokenIdValue) return false;
    const actorToken = tokenByCharacterId.get(actorTokenIdValue);
    const targetToken = tokenByCharacterId.get(targetTokenIdValue);
    if (!actorToken || !targetToken) return false;
    const actorZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const targetZone = zoneIdAtPoint(zoneRegionMap, targetToken);
    if (actorZone === null || targetZone === null || actorZone !== targetZone) return false;
    if (tokenElevationForTokenId(actorTokenIdValue) !== tokenElevationForTokenId(targetTokenIdValue)) return false;

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
      for (const entry of initiativeEntries) {
        const entryTokenId =
          entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
        if (!entryTokenId) continue;
        const linkedIds = new Set<string>();
        if (entry.grappling_target_id) linkedIds.add(entry.grappling_target_id);
        if (entry.grappled_by_id) linkedIds.add(entry.grappled_by_id);
        if (entry.clinging_target_id) linkedIds.add(entry.clinging_target_id);
        if (entry.clung_onto_by_id) linkedIds.add(entry.clung_onto_by_id);
        for (const id of entry.clung_onto_by_ids || []) {
          if (id) linkedIds.add(id);
        }
        for (const linkedId of linkedIds) {
          if (component.has(entryTokenId) && !component.has(linkedId)) {
            component.add(linkedId);
            changed = true;
          } else if (component.has(linkedId) && !component.has(entryTokenId)) {
            component.add(entryTokenId);
            changed = true;
          }
        }
      }
    }

    const nextEdges = [...engagements];
    for (const member of component) {
      if (member === actorTokenIdValue) continue;
      if (tokenElevationForTokenId(member) !== tokenElevationForTokenId(actorTokenIdValue)) continue;
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
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
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
    return combatActions.consumeActionRpc({ canPass, actionType, setError });
  };

  const consumeFastOrSlow = async (): Promise<boolean> => {
    return combatActions.consumeFastOrSlowRpc({ canPass, setError });
  };

  const clearAimForToken = async (actorTokenIdForRpc: string): Promise<boolean> => {
    const supabase = createClient();
    if (!isDmUser) {
      const { error: rpcError } = await supabase.rpc("combat_clear_aim_for_token", {
        p_actor_token_id: actorTokenIdForRpc,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) => {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (tokenId !== actorTokenIdForRpc) return entry;
      return {
        ...entry,
        aim_target_id: null,
        aim_target_name: null,
        aim_weapon_item_id: null,
        aim_weapon_name: null,
      };
    });
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
    return true;
  };

  const clearReadiedForToken = async (actorTokenIdForRpc: string): Promise<boolean> => {
    const supabase = createClient();
    if (!isDmUser) {
      const { error: rpcError } = await supabase.rpc("combat_clear_readied_for_token", {
        p_actor_token_id: actorTokenIdForRpc,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) => {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (tokenId !== actorTokenIdForRpc) return entry;
      return {
        ...entry,
        readied_weapon_item_id: null,
        readied_weapon_name: null,
        readied_weapon_hand: null,
        readied_ammo_item: null,
      };
    });
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
    return true;
  };

  const clearSwingForParticipant = async (
    participantId: string | null,
    options?: { preserveAim?: boolean }
  ): Promise<boolean> => {
    if (!participantId) return true;
    const participantEntry = initiativeEntries.find((entry) => entry.participant_id === participantId) || null;
    const actorTokenIdForRpc =
      participantEntry?.kind === "player"
        ? participantEntry.participant_id.replace(/^player:/, "")
        : participantEntry?.participant_id || null;
    const shouldClearSwing = Boolean(participantEntry?.swing_weapon_item_id);
    const shouldClearAim = !options?.preserveAim && Boolean(participantEntry?.aim_target_id);
    if (!shouldClearSwing && !shouldClearAim) return true;
    const supabase = createClient();

    if (!isDmUser) {
      if (!actorTokenIdForRpc) return false;
      if (shouldClearSwing) {
        const { error: rpcError } = await supabase.rpc("combat_clear_swing_weapon_for_token", {
          p_actor_token_id: actorTokenIdForRpc,
        });
        if (rpcError) {
          setError(rpcError.message);
          return false;
        }
      }
      if (shouldClearAim) {
        const { error: rpcError } = await supabase.rpc("combat_clear_aim_for_token", {
          p_actor_token_id: actorTokenIdForRpc,
        });
        if (rpcError) {
          setError(rpcError.message);
          return false;
        }
      }
      return true;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) =>
      entry.participant_id === participantId
        ? {
            ...entry,
            swing_weapon_item_id: null,
            swing_weapon_name: null,
            ...(options?.preserveAim
              ? {}
              : {
                  aim_target_id: null,
                  aim_target_name: null,
                  aim_weapon_item_id: null,
                  aim_weapon_name: null,
                }),
          }
        : entry
    );
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
    return true;
  };

  const clearTauntAngerForToken = async (actorTokenIdValue: string): Promise<boolean> => {
    return combatActions.clearTauntAngerForTokenAction({
      actorTokenId: actorTokenIdValue,
      isDmUser,
      fetchLatestInitiativeState,
      saveInitiativeState,
      setInitiativeEntries,
      setInitiativeMonsters,
      setInitiativeCurrentIndex,
      combatMode,
      setError,
    });
  };

  const consumeTauntPenaltyForToken = async (actorTokenIdValue: string): Promise<number> => {
    return combatActions.consumeTauntPenaltyForTokenAction({
      actorTokenId: actorTokenIdValue,
      findEntryForTokenId: (tokenId) => findEntryForTokenId(tokenId),
      isDmUser,
      fetchLatestInitiativeState,
      saveInitiativeState,
      setInitiativeEntries,
      setInitiativeMonsters,
      setInitiativeCurrentIndex,
      combatMode,
      setError,
    });
  };

  useEffect(() => {
    const participantId = currentEntry?.participant_id ?? null;
    if (!participantId) {
      tauntAngerTurnCheckedParticipantRef.current = null;
      return;
    }
    if (tauntAngerTurnCheckedParticipantRef.current === participantId) return;
    tauntAngerTurnCheckedParticipantRef.current = participantId;
    if (!combatMode || !isMyTurn || !actorTokenId || !actorTauntedAngerById) return;
    if (tauntAngerAttackPossible) return;
    void clearTauntAngerForToken(actorTokenId);
  }, [
    combatMode,
    currentEntry,
    isMyTurn,
    actorTokenId,
    actorTauntedAngerById,
    tauntAngerAttackPossible,
    clearTauntAngerForToken,
  ]);

  useEffect(() => {
    const participantId = currentEntry?.participant_id ?? null;
    if (!participantId) {
      startOfTurnEffectsCheckedParticipantRef.current = null;
      return;
    }
    if (startOfTurnEffectsCheckedParticipantRef.current === participantId) return;
    startOfTurnEffectsCheckedParticipantRef.current = participantId;
    if (!combatMode || !isMyTurn || !actorTokenId) return;
    if (!onApplyStartOfTurnEffects) return;
    void onApplyStartOfTurnEffects(actorTokenId);
  }, [combatMode, currentEntry, isMyTurn, actorTokenId, onApplyStartOfTurnEffects]);

  useEffect(() => {
    if (!combatMode || !actorTokenId || !currentEntry) return;
    if (!actorUsedItemFlags.has(FLAMING_LONGSWORD_USED_FLAG)) return;
    const hasFlamingLongswordInInventory =
      currentEntry.kind === "player"
        ? (actorTokenCharacter?.inventory || []).some((item) => isFlamingLongswordItem(item))
        : (currentEntry.monster_snapshot?.gear || []).some((item) => isFlamingLongswordItem(item));
    if (hasFlamingLongswordInInventory) return;
    void setUsedItemFlag(actorTokenId, FLAMING_LONGSWORD_USED_FLAG, false);
  }, [
    combatMode,
    actorTokenId,
    currentEntry,
    actorUsedItemFlags,
    actorTokenCharacter,
    isFlamingLongswordItem,
  ]);

  useEffect(() => {
    if (!combatMode || initiativeEntries.length === 0) return;
    for (const entry of initiativeEntries) {
      const flags = Array.isArray(entry.used_item_flags)
        ? entry.used_item_flags.filter((value): value is string => typeof value === "string")
        : [];
      if (!flags.includes(FLAMING_LONGSWORD_USED_FLAG)) continue;
      const tokenId = entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      const canMutate = isDmUser || (entry.kind === "player" && tokenId === currentUserTokenId);
      if (!canMutate) continue;
      const hasFlamingLongswordInInventory =
        entry.kind === "player"
          ? (characterById.get(tokenId)?.inventory || []).some((item) => isFlamingLongswordItem(item))
          : (entry.monster_snapshot?.gear || []).some((item) => isFlamingLongswordItem(item));
      if (hasFlamingLongswordInInventory) continue;
      void setUsedItemFlag(tokenId, FLAMING_LONGSWORD_USED_FLAG, false);
    }
  }, [
    combatMode,
    initiativeEntries,
    isDmUser,
    currentUserTokenId,
    characterById,
    isFlamingLongswordItem,
    setUsedItemFlag,
  ]);

  useEffect(() => {
    const run = async () => {
      if (!combatMode || !currentReadied || !currentEntry || !actorTokenId) return;
      const heldHand =
        currentEntry.kind === "player"
          ? readiedHandForWeapon(character?.equipment_slots, {
              id: currentReadied.weaponItemId,
              name: currentReadied.weaponName,
            })
          : readiedHandForWeapon(currentEntry.monster_snapshot?.equipment_slots, {
              id: currentReadied.weaponItemId,
              name: currentReadied.weaponName,
            });
      if (heldHand && heldHand === currentReadied.weaponHand) return;
      const sig = `${actorTokenId}:${currentReadied.weaponItemId}:${currentReadied.ammoItem.id}`;
      if (handledInvalidReadiedRef.current === sig) return;
      handledInvalidReadiedRef.current = sig;
      const supabase = createClient();
      const actorToken = tokenByCharacterId.get(actorTokenId);
      const actorZone = actorToken ? zoneIdAtPoint(zoneRegionMap, actorToken) : null;

      if (currentEntry.kind === "player") {
        const actor = characters.find((c) => c.id === actorTokenId);
        if (actor) {
          const inventory = actor.inventory || [];
          const currentWeight = inventory.reduce((sum, item) => sum + (item.quantity || 1) * item.weight, 0);
          const maxWeight = (actor.max_attributes?.STR ?? actor.attributes?.STR ?? 0) * 2;
          const ammoWeight = (currentReadied.ammoItem.quantity || 1) * currentReadied.ammoItem.weight;
          if (currentWeight + ammoWeight <= maxWeight) {
            await supabase
              .from("characters")
              .update({ inventory: addItemToInventory(inventory, currentReadied.ammoItem) })
              .eq("id", actor.id);
          } else if (actorZone !== null) {
            const { data: state } = await supabase
              .from("combat_state")
              .select("zone_loot")
              .eq("id", 1)
              .maybeSingle<{ zone_loot: ZoneLootDrop[] | null }>();
            const nextLoot = [
              ...normalizeZoneLoot(state?.zone_loot),
              { zone_id: actorZone, item: currentReadied.ammoItem },
            ];
            await supabase.from("combat_state").update({ zone_loot: nextLoot }).eq("id", 1);
          }
        }
      } else if (isDmUser && currentEntry.monster_snapshot) {
        const nextSnapshot = {
          ...currentEntry.monster_snapshot,
          gear: addItemToInventory(currentEntry.monster_snapshot.gear || [], currentReadied.ammoItem),
        };
        const nextEntries = initiativeEntries.map((entry) =>
          entry.participant_id === currentEntry.participant_id
            ? { ...entry, monster_snapshot: nextSnapshot }
            : entry
        );
        const nextMonsters = initiativeMonsters.map((monster) =>
          monster.id === currentEntry.participant_id
            ? { ...monster, monster_snapshot: nextSnapshot }
            : monster
        );
        setInitiativeEntries(nextEntries);
        setInitiativeMonsters(nextMonsters);
        await saveInitiativeState(nextEntries, initiativeCurrentIndex, combatMode, nextMonsters, engagements);
      }

      await clearReadiedForToken(actorTokenId);
      await loadCharacters();
    };
    void run();
  }, [
    combatMode,
    currentReadied,
    currentEntry,
    actorTokenId,
    character?.equipment_slots,
    tokenByCharacterId,
    zoneRegionMap,
    characters,
    initiativeEntries,
    initiativeMonsters,
    initiativeCurrentIndex,
    engagements,
    isDmUser,
    saveInitiativeState,
    clearReadiedForToken,
    loadCharacters,
  ]);

  const setAimForCurrentActor = async (
    actorTokenIdForRpc: string,
    targetTokenId: string,
    targetName: string,
    weaponItemId: string,
    weaponName: string
  ): Promise<boolean> => {
    const supabase = createClient();
    if (!isDmUser) {
      const { error: rpcError } = await supabase.rpc("combat_set_aim_for_token", {
        p_actor_token_id: actorTokenIdForRpc,
        p_target_token_id: targetTokenId,
        p_target_name: targetName,
        p_weapon_item_id: weaponItemId,
        p_weapon_name: weaponName,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) => {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (tokenId !== actorTokenIdForRpc) return entry;
      return {
        ...entry,
        aim_target_id: targetTokenId,
        aim_target_name: targetName,
        aim_weapon_item_id: weaponItemId,
        aim_weapon_name: weaponName,
      };
    });
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
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

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) =>
      entry.participant_id === currentEntry.participant_id
        ? { ...entry, swing_weapon_item_id: weaponItemId, swing_weapon_name: weaponName }
        : entry
    );
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
    return true;
  };

  const setReadiedForToken = async (
    actorTokenIdForRpc: string,
    weaponItemId: string,
    weaponName: string,
    weaponHand: "left" | "right" | "both",
    ammoItem: InventoryItem
  ): Promise<boolean> => {
    const supabase = createClient();
    if (!isDmUser) {
      const { error: rpcError } = await supabase.rpc("combat_set_readied_for_token", {
        p_actor_token_id: actorTokenIdForRpc,
        p_weapon_item_id: weaponItemId,
        p_weapon_name: weaponName,
        p_weapon_hand: weaponHand,
        p_ammo_item: ammoItem,
      });
      if (rpcError) {
        setError(rpcError.message);
        return false;
      }
      return true;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) => {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (tokenId !== actorTokenIdForRpc) return entry;
      return {
        ...entry,
        readied_weapon_item_id: weaponItemId,
        readied_weapon_name: weaponName,
        readied_weapon_hand: weaponHand,
        readied_ammo_item: ammoItem,
      };
    });
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
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

  const setCoveredForToken = async (actorTokenIdValue: string, covered: boolean): Promise<boolean> => {
    const latest = await fetchLatestInitiativeState();
    if (!latest) return false;
    const nextEntries = latest.freshEntries.map((entry) => {
      const tokenId =
        entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
      if (tokenId !== actorTokenIdValue) return entry;
      return { ...entry, covered };
    });
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(latest.freshMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    if (latest.freshCover) setZoneCoverIds(latest.freshCover);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      latest.freshMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot,
      latest.freshCover || zoneCoverIds
    );
    return true;
  };

  const updateZoneCover = async (zoneId: number, enabled: boolean): Promise<void> => {
    if (!isDmUser) return;
    const nextCover = enabled
      ? Array.from(new Set([...zoneCoverIds, zoneId]))
      : zoneCoverIds.filter((id) => id !== zoneId);

    let nextEntries = initiativeEntries;
    if (!enabled) {
      const tokensInZone = tokenPositions
        .filter((token) => zoneIdAtPoint(zoneRegionMap, token) === zoneId)
        .map((token) => token.character_id);
      if (tokensInZone.length > 0) {
        nextEntries = initiativeEntries.map((entry) => {
          const tokenId =
            entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
          if (!tokensInZone.includes(tokenId)) return entry;
          return { ...entry, covered: false };
        });
        setInitiativeEntries(nextEntries);
      }
    }

    setZoneCoverIds(nextCover);
    await saveInitiativeState(
      nextEntries,
      initiativeCurrentIndex,
      combatMode,
      initiativeMonsters,
      engagements,
      tokenPositions,
      null,
      zoneLoot,
      nextCover
    );
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
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return;
    const actingParticipantId = currentEntry.participant_id;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const didConsume =
      option.maneuver === "Grapple Attack"
        ? await consumeFastOrSlow()
        : await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = actorTokenId ? await consumeTauntPenaltyForToken(actorTokenId) : 0;
    const swingMatch =
      !!currentSwing &&
      (option.maneuver === "Slash" || option.maneuver === "Stab") &&
      !!option.weaponItemId &&
      option.weaponItemId === currentSwing.weaponItemId;
    const swingBonusDamage = swingMatch ? 1 : 0;
    const proneBonusDice = selectedTargetEntry?.prone ? 2 : 0;
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
        bonusDice: proneBonusDice + tauntPenalty,
        rangeAtAttack: selectedRange,
      });
      setSelectedTokenId(null);
    } else {
      const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
      const snapshot = actorMonster?.monster_snapshot;
      if (!snapshot || !onResolveMeleeAttack) return;
      const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
      const signedSkillPool = (snapshot.special ?? 0) + proneBonusDice + tauntPenalty;
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
        actionLabel: option.maneuver === "Strike" ? "Strike" : `${option.maneuver} (${option.weaponName})`,
        attributeDice,
        skillDice,
        skillIsNegative,
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
        rangeAtAttack: selectedRange,
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
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return;
    const actingParticipantId = currentEntry.participant_id;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const tauntPenalty = actorTokenId ? await consumeTauntPenaltyForToken(actorTokenId) : 0;
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
        bonusDice: Math.max(0, option.bonusDice ?? 0) + tauntPenalty,
      });
      setSelectedTokenId(null);
      return;
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    const snapshot = actorMonster?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack || !actorTokenId) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + Math.max(0, option.bonusDice ?? 0) + tauntPenalty;
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
      actionLabel: option.weaponItemId ? `Shove (${option.weaponName})` : "Shove",
      attributeDice,
      skillDice,
      skillIsNegative,
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
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return;
    const actingParticipantId = currentEntry.participant_id;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return;
    const zoneId = zoneIdAtPoint(zoneRegionMap, actorToken);
    if (zoneId === null) return;

    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
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
        bonusDice: option.bonusDice + tauntPenalty,
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
    const signedSkillPool = (snapshot.special ?? 0) + option.bonusDice + tauntPenalty;
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

  const requestHeal = async (option: { attribute: AttributeKey; skill: "HEALING" | "PERFORMANCE"; label: string }) => {
    if (!currentEntry || !actorTokenId || !selectedTokenId) return;
    if (!currentEntry.slow_available) return;
    if (isSkillBlockedForToken(actorTokenId, option.skill)) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `heal:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        attackerName: actorCharacter.name,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: null,
        weaponName: option.label,
        weaponBaseDamage: 0,
        maneuver: "Heal",
        rollAttribute: "EMP",
        rollSkill: option.skill,
        requiredSuccesses: 1,
        bonusDice: tauntPenalty,
        healAttribute: option.attribute,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.emp ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: option.label,
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-heal:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      attackerName: currentEntry.name,
      targetCharacterId: selectedTokenId,
      weaponName: option.label,
      weaponBaseDamage: 0,
      maneuver: "Heal",
      totalSuccesses: successes,
      requiredSuccesses: 1,
      healAttribute: option.attribute,
    });
    setSelectedTokenId(null);
  };

  const requestTaunt = async (mode: "anger" | "distract") => {
    if (!currentEntry || !actorTokenId || !selectedTokenId) return;
    if (!currentEntry.slow_available) return;
    if (isSkillBlockedForToken(actorTokenId, "PERFORMANCE")) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const label = mode === "anger" ? "Taunt (Anger)" : "Taunt (Distract)";

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `taunt:${mode}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        attackerName: actorCharacter.name,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: null,
        weaponName: label,
        weaponBaseDamage: 0,
        maneuver: label,
        rollAttribute: "EMP",
        rollSkill: "PERFORMANCE",
        requiredSuccesses: 1,
        bonusDice: tauntPenalty,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.emp ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: label,
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-taunt:${mode}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      attackerName: currentEntry.name,
      targetCharacterId: selectedTokenId,
      weaponName: label,
      weaponBaseDamage: 0,
      maneuver: label as "Taunt (Anger)" | "Taunt (Distract)",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
    setSelectedTokenId(null);
  };

  const requestPickUpAction = async (option: GroupedItemDisplay) => {
    if (!currentEntry || !actorTokenId || !selectedZoneTarget) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    const candidateIds = option.candidateIds.filter((id) => Boolean(id));
    if (candidateIds.length === 0) return;
    const selectedItemId = candidateIds[Math.floor(Math.random() * candidateIds.length)];

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_pick_up_zone_item", {
      p_actor_token_id: actorTokenId,
      p_zone_id: selectedZoneTarget.zoneId,
      p_item_id: selectedItemId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await loadCharacters();
  };

  const requestRetreat = async () => {
    if (!canUseRetreatFromSelection || !actorTokenId || !currentEntry) return;
    if (isSkillBlockedForToken(actorTokenId, "MOVE")) return;
    const actingParticipantId = currentEntry.participant_id;
    const isFreeRetreat = isFreeRetreatAvailable;
    if (!isFreeRetreat) {
      const didConsume = await consumeFastOrSlow();
      if (!didConsume) return;
    }
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return;

    if (isFreeRetreat) {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("combat_break_engagement_token", {
        p_actor_token_id: actorTokenId,
      });
      if (rpcError) {
        if (/not engaged with an enemy/i.test(rpcError.message || "")) {
          if (isDmUser) {
            const nextEdges = engagements.filter(
              (edge) => edge.a !== actorTokenId && edge.b !== actorTokenId
            );
            setEngagements(nextEdges);
            setSelectedTokenId(null);
            await saveInitiativeState(
              initiativeEntries,
              initiativeCurrentIndex,
              combatMode,
              initiativeMonsters,
              nextEdges
            );
            return;
          }
          setError("Combat RPC is outdated for allied free retreat. Please run latest supabase/combat.sql.");
          return;
        }
        setError(rpcError.message);
        return;
      }
      setSelectedTokenId(null);
      return;
    }

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
        bonusDice: tauntPenalty,
      });
      setSelectedTokenId(null);
      return;
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    const snapshot = actorMonster?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: "Retreat",
      attributeDice,
      skillDice,
      skillIsNegative,
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

  const requestFlee = async () => {
    if (!canUseFleeFromSelection || !actorTokenId || !currentEntry) return;
    const autoSuccess = closestEnemyRange === null || closestEnemyRange === "Distant";
    if (!autoSuccess && isSkillBlockedForToken(actorTokenId, "MOVE")) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const cleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!cleared) return;
    setSelectedTokenId(null);
    setSelectedZoneTarget(null);
    if (autoSuccess) {
      await onResolveMeleeAttack?.({
        id: `flee-auto:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorTokenId,
        targetCharacterId: actorTokenId,
        weaponName: "Flee",
        weaponBaseDamage: 0,
        maneuver: "Flee",
        totalSuccesses: 1,
        requiredSuccesses: 1,
      });
      return;
    }

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
      onQueueMeleeAction?.({
        id: `flee:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: actorCharacter.id,
        targetName: actorCharacter.name,
        weaponItemId: null,
        weaponName: "Flee",
        weaponBaseDamage: 0,
        maneuver: "Flee",
        rollAttribute: "AGL",
        rollSkill: "MOVE",
        requiredSuccesses: 1,
        bonusDice: fleeRangeBonus + tauntPenalty,
      });
      return;
    }

    const actorMonster = actorTokenId ? monsterByParticipantId.get(actorTokenId) : null;
    const snapshot = actorMonster?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + fleeRangeBonus + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: "Flee",
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-flee:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: actorTokenId,
      weaponName: "Flee",
      weaponBaseDamage: 0,
      maneuver: "Flee",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
  };
  const consumeOneLampOil = (items: InventoryItem[]): InventoryItem[] => {
    let consumed = false;
    const next: InventoryItem[] = [];
    for (const item of items) {
      if (!consumed && isLampOilItem(item)) {
        const qty = Math.max(1, Math.trunc(item.quantity ?? 1));
        consumed = true;
        if (qty > 1) {
          next.push({ ...item, quantity: qty - 1 });
        }
        continue;
      }
      next.push(item);
    }
    return consumed ? next : items;
  };
  const requestUseFlamingLongswordItem = async () => {
    if (!currentEntry || !actorTokenId || !canUseFlamingLongswordItem) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorTokenCharacter) return;
      const source = actorTokenCharacter.inventory || [];
      const nextInventory = consumeOneLampOil(source);
      if (nextInventory === source) return;
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("characters")
        .update({ inventory: nextInventory })
        .eq("id", actorTokenCharacter.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await loadCharacters();
    } else {
      const latest = await fetchLatestInitiativeState();
      if (!latest) return;
      const actorEntry = latest.freshEntries.find((entry) => entry.participant_id === currentEntry.participant_id) || null;
      const snapshot = actorEntry?.monster_snapshot || null;
      if (!snapshot) return;
      const nextGear = consumeOneLampOil(snapshot.gear || []);
      if (nextGear === (snapshot.gear || [])) return;
      const nextSnapshot = { ...snapshot, gear: nextGear };
      const nextEntries = latest.freshEntries.map((entry) =>
        entry.participant_id === currentEntry.participant_id ? { ...entry, monster_snapshot: nextSnapshot } : entry
      );
      const nextMonsters = latest.freshMonsters.map((monster) =>
        monster.id === currentEntry.participant_id ? { ...monster, monster_snapshot: nextSnapshot } : monster
      );
      setInitiativeEntries(nextEntries);
      setInitiativeMonsters(nextMonsters);
      setInitiativeCurrentIndex(latest.freshCurrentIndex);
      await saveInitiativeState(
        nextEntries,
        latest.freshCurrentIndex,
        combatMode,
        nextMonsters,
        latest.freshEngagements,
        null,
        null,
        latest.freshLoot
      );
    }

    await setUsedItemFlag(actorTokenId, FLAMING_LONGSWORD_USED_FLAG, true);
    setSelectedTokenId(null);
  };
  const requestSnuff = async () => {
    if (!currentEntry || !actorTokenId || !canUseSnuff) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `snuff:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: actorCharacter.id,
        targetName: actorCharacter.name,
        weaponItemId: null,
        weaponName: "Snuff",
        weaponBaseDamage: 0,
        maneuver: "Snuff",
        rollAttribute: "AGL",
        rollSkill: "MOVE",
        requiredSuccesses: 1,
        bonusDice: tauntPenalty,
      });
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;
    setMonsterRollResult({
      actionLabel: "Snuff",
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice: [],
      successes,
    });
    await onResolveMeleeAttack({
      id: `monster-snuff:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: actorTokenId,
      weaponName: "Snuff",
      weaponBaseDamage: 0,
      maneuver: "Snuff",
      totalSuccesses: successes,
      requiredSuccesses: 1,
    });
  };
  const requestFeint = async () => {
    if (!canUseFeintFromSelection || !currentEntry || !selectedTokenId || !actorTokenId) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_apply_feint", {
      p_actor_token_id: actorTokenId,
      p_target_token_id: selectedTokenId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSelectedTokenId(null);
  };
  const requestCoupDeGrace = async () => {
    if (!canUseCoupFromSelection || !currentEntry || !selectedTokenId || !actorTokenId) return;
    if (isSkillBlockedForToken(actorTokenId, "PERFORMANCE")) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
      onQueueMeleeAction?.({
        id: `coup-de-grace:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: null,
        weaponName: "Coup de Grace",
        weaponBaseDamage: 0,
        maneuver: "Coup de Grace",
        rollAttribute: "EMP",
        rollSkill: "PERFORMANCE",
        requiredSuccesses: 1,
        bonusDice: tauntPenalty,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.emp ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;
    setMonsterRollResult({
      actionLabel: "Coup de Grace",
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });
    await onResolveMeleeAttack({
      id: `monster-coup-de-grace:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: selectedTokenId,
      weaponName: "Coup de Grace",
      weaponBaseDamage: 0,
      maneuver: "Coup de Grace",
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

  const requestReadyOrLoadWeapon = async (option: {
    weaponItemId: string;
    weaponName: string;
    isLoading: boolean;
    hand: "left" | "right" | "both";
  }) => {
    if (!currentEntry || !actorTokenId) return;
    const didConsume = option.isLoading ? await consumeAction("slow") : await consumeFastOrSlow();
    if (!didConsume) return;
    const preserveAim =
      !!currentAim && currentAim.weaponItemId === option.weaponItemId;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id, { preserveAim });
    if (!swingCleared) return;

    if (currentEntry.kind === "player") {
      if (!character || !actorCharacter || character.id !== actorCharacter.id) return;
      const consumed = consumeFirstAmmo(character.inventory || []);
      if (!consumed.ammo) return;
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("characters")
        .update({ inventory: consumed.nextItems })
        .eq("id", actorCharacter.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      await setReadiedForToken(
        actorTokenId,
        option.weaponItemId,
        option.weaponName,
        option.hand,
        consumed.ammo
      );
      await loadCharacters();
      return;
    }

    const latest = await fetchLatestInitiativeState();
    if (!latest) return;
    const actorEntry = latest.freshEntries.find((entry) => entry.participant_id === currentEntry.participant_id) || null;
    if (!actorEntry?.monster_snapshot) return;
    const latestConsumed = consumeFirstAmmo(actorEntry.monster_snapshot.gear || []);
    if (!latestConsumed.ammo) return;
    const nextSnapshot = { ...actorEntry.monster_snapshot, gear: latestConsumed.nextItems };
    const nextEntries = latest.freshEntries.map((entry) =>
      entry.participant_id === currentEntry.participant_id
        ? {
            ...entry,
            monster_snapshot: nextSnapshot,
            readied_weapon_item_id: option.weaponItemId,
            readied_weapon_name: option.weaponName,
            readied_weapon_hand: option.hand,
            readied_ammo_item: latestConsumed.ammo,
          }
        : entry
    );
    const nextMonsters = latest.freshMonsters.map((monster) =>
      monster.id === currentEntry.participant_id
        ? { ...monster, monster_snapshot: nextSnapshot }
        : monster
    );
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(nextMonsters);
    setInitiativeCurrentIndex(latest.freshCurrentIndex);
    await saveInitiativeState(
      nextEntries,
      latest.freshCurrentIndex,
      combatMode,
      nextMonsters,
      latest.freshEngagements,
      null,
      null,
      latest.freshLoot
    );
  };

  const requestAim = async (option: { weaponItemId: string; weaponName: string }) => {
    if (!currentEntry || !actorTokenId || !selectedTokenId) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id, { preserveAim: false });
    if (!swingCleared) return;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    await setAimForCurrentActor(actorTokenId, selectedTokenId, targetName, option.weaponItemId, option.weaponName);
  };

  const requestShoot = async (option: {
    weaponItemId: string;
    weaponName: string;
    rangePenalty: number;
    aimBonusDice: number;
    targetZoneId: number | null;
  }) => {
    if (!currentEntry || !actorTokenId || !selectedTokenId || !currentReadied) return;
    if (isSkillBlockedForToken(actorTokenId, "MARKSMANSHIP")) return;
    if (isActorCovered) return;
    if (isActorEngaged) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id, { preserveAim: true });
    if (!swingCleared) return;
    const aimCleared = await clearAimForToken(actorTokenId);
    if (!aimCleared) return;
    const readiedCleared = await clearReadiedForToken(actorTokenId);
    if (!readiedCleared) return;
    const targetName = selectedTokenCharacter?.name || selectedTokenMonster?.name || "Target";
    const coverPenalty = isTokenCovered(selectedTokenId) ? -3 : 0;
    const totalBonusDice = option.rangePenalty + option.aimBonusDice + coverPenalty + tauntPenalty;

    if (currentEntry.kind === "player") {
      if (!actorCharacter) return;
      onQueueMeleeAction?.({
        id: `shoot:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: selectedTokenId,
        targetName,
        weaponItemId: option.weaponItemId,
        weaponName: option.weaponName,
        weaponBaseDamage: Math.max(0, (playerEquippedRangedWeapons(character).find((w) => w.id === option.weaponItemId)?.damage ?? 0)),
        maneuver: "Shoot",
        rollAttribute: "AGL",
        rollSkill: "MARKSMANSHIP",
        requiredSuccesses: 1,
        bonusDice: totalBonusDice,
        shootTargetZoneId: option.targetZoneId,
        shootAmmoItem: currentReadied.ammoItem,
        rangeAtAttack: selectedRange,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const weapon = monsterEquippedRangedWeapons(snapshot).find((w) => w.id === option.weaponItemId);
    if (!weapon) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + totalBonusDice;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice = rollD6Pool(Math.max(0, weapon.gearBonus ?? 0));
    const rawSuccesses =
      attributeDice.filter((d) => d === 6).length +
      skillDice.filter((d) => d === 6).length +
      gearDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;

    setMonsterRollResult({
      actionLabel: `Shoot (${option.weaponName})`,
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });

    await onResolveMeleeAttack({
      id: `monster-shoot:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: selectedTokenId,
      weaponName: option.weaponName,
      weaponBaseDamage: Math.max(0, weapon.damage ?? 0),
      maneuver: "Shoot",
      totalSuccesses: successes,
      requiredSuccesses: 1,
      shootTargetZoneId: option.targetZoneId,
      shootAmmoItem: currentReadied.ammoItem,
      rangeAtAttack: selectedRange,
    });
  };

  const requestUnready = async () => {
    if (!currentEntry || !actorTokenId || !currentReadied) return;
    const actorToken = tokenByCharacterId.get(actorTokenId);
    const actorZone = actorToken ? zoneIdAtPoint(zoneRegionMap, actorToken) : null;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id, { preserveAim: false });
    if (!swingCleared) return;
    const supabase = createClient();

    if (currentEntry.kind === "player") {
      if (!actorCharacter || !character) return;
      const inventory = character.inventory || [];
      const currentWeight = inventory.reduce((sum, item) => sum + (item.quantity || 1) * item.weight, 0);
      const maxWeight = (character.max_attributes?.STR ?? character.attributes?.STR ?? 0) * 2;
      const ammoWeight = (currentReadied.ammoItem.quantity || 1) * currentReadied.ammoItem.weight;
      if (currentWeight + ammoWeight <= maxWeight) {
        const { error: updateError } = await supabase
          .from("characters")
          .update({ inventory: addItemToInventory(inventory, currentReadied.ammoItem) })
          .eq("id", actorCharacter.id);
        if (updateError) {
          setError(updateError.message);
          return;
        }
      } else if (actorZone !== null) {
        const { data: state } = await supabase
          .from("combat_state")
          .select("zone_loot")
          .eq("id", 1)
          .maybeSingle<{ zone_loot: ZoneLootDrop[] | null }>();
        const nextLoot = [...normalizeZoneLoot(state?.zone_loot), { zone_id: actorZone, item: currentReadied.ammoItem }];
        await supabase.from("combat_state").update({ zone_loot: nextLoot }).eq("id", 1);
      }
      const cleared = await clearReadiedForToken(actorTokenId);
      if (!cleared) return;
      await loadCharacters();
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot) return;
    const nextGear = addItemToInventory(snapshot.gear || [], currentReadied.ammoItem);
    const nextSnapshot = { ...snapshot, gear: nextGear };
    const nextEntries = initiativeEntries.map((entry) =>
      entry.participant_id === currentEntry.participant_id
        ? {
            ...entry,
            monster_snapshot: nextSnapshot,
            readied_weapon_item_id: null,
            readied_weapon_name: null,
            readied_weapon_hand: null,
            readied_ammo_item: null,
          }
        : entry
    );
    const nextMonsters = initiativeMonsters.map((monster) =>
      monster.id === currentEntry.participant_id
        ? { ...monster, monster_snapshot: nextSnapshot }
        : monster
    );
    setInitiativeEntries(nextEntries);
    setInitiativeMonsters(nextMonsters);
    await saveInitiativeState(nextEntries, initiativeCurrentIndex, combatMode, nextMonsters, engagements);
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

  const requestEnterCover = async () => {
    if (!canEnterCoverFromSelection || !actorTokenId || !currentEntry) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    await setCoveredForToken(actorTokenId, true);
  };

  const requestExitCover = async () => {
    if (!canExitCoverFromSelection || !actorTokenId || !currentEntry) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
    await setCoveredForToken(actorTokenId, false);
  };

  const requestGrappleLike = async (mode: "Grapple" | "Cling") => {
    if (!currentEntry || !actorTokenId || !selectedTokenId || selectedTokenId === actorTokenId) return;
    if (mode === "Grapple" && !canUseGrappleFromSelection) return;
    if (mode === "Cling" && !canUseClingFromSelection) return;
    if (isSkillBlockedForToken(actorTokenId, "MELEE")) return;
    const didConsume = await consumeAction("slow");
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
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
        bonusDice: sizeDiff + tauntPenalty,
        disarmZoneId: zoneId ?? undefined,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.str ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + sizeDiff + tauntPenalty;
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
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;
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
    const selectedClinger =
      selectedTokenId && actorClungOntoByIds.includes(selectedTokenId) ? selectedTokenId : null;
    const otherTokenId = actorGrappledById || selectedClinger || actorClungOntoByIds[0] || null;
    if (!otherTokenId) return;
    const againstCling = actorClungOntoByIds.includes(otherTokenId);
    const rollSkill = againstCling ? "MOVE" : "MELEE";
    if (isSkillBlockedForToken(actorTokenId, rollSkill)) return;
    const didConsume = await consumeFastOrSlow();
    if (!didConsume) return;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const swingCleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!swingCleared) return;

    const targetSize =
      otherTokenId.startsWith("monster:")
        ? Math.trunc(monsterByParticipantId.get(otherTokenId)?.monster_snapshot?.size ?? 1)
        : 1;
    const sizeDiff = actorSize - targetSize;
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
        rollSkill,
        requiredSuccesses: 1,
        bonusDice: sizeDiff + tauntPenalty,
      });
      setSelectedTokenId(null);
      return;
    }

    const snapshot = currentEntry.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return;
    const attributeDice = rollD6Pool(Math.max(0, againstCling ? snapshot.agl ?? 0 : snapshot.str ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + sizeDiff + tauntPenalty;
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
    if (actorRestrictedToCrawl) {
      await requestCrawlToPoint(selectedZoneTarget.point);
      return;
    }
    await requestRunToPoint(selectedZoneTarget.point, false);
  };
  const requestFly = async (mode: "up" | "down") => {
    if (!actorTokenId || !selectedFlyMode || !currentEntry) return;
    if (!canUseFlyFromSelection) return;
    if (mode === "down" && !canUseFlyDownFromSelection) return;

    const elevationDelta = mode === "up" ? 1 : -1;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_fly_token", {
      p_actor_token_id: actorTokenId,
      p_x: selectedFlyMode.point.x,
      p_y: selectedFlyMode.point.y,
      p_elevation_delta: elevationDelta,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const nextActorElevation = Math.max(0, actorElevation + elevationDelta);
    setTokenElevations((prev) => {
      const other = prev.filter((entry) => entry.character_id !== actorTokenId);
      return [...other, { character_id: actorTokenId, elevation: nextActorElevation }];
    });

    const cleared = await clearSwingForParticipant(currentEntry.participant_id);
    if (!cleared) return;
    setSelectedZoneTarget(null);
    setSelectedTokenId(null);
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
  const canDmSetCoverZone = isDmUser && !!selectedZoneTarget && !zoneCoverIds.includes(selectedZoneTarget.zoneId);
  const canDmUnsetCoverZone = isDmUser && !!selectedZoneTarget && zoneCoverIds.includes(selectedZoneTarget.zoneId);
  const requestDmSetCover = async () => {
    if (!selectedZoneTarget || !canDmSetCoverZone) return;
    await updateZoneCover(selectedZoneTarget.zoneId, true);
  };
  const requestDmUnsetCover = async () => {
    if (!selectedZoneTarget || !canDmUnsetCoverZone) return;
    await updateZoneCover(selectedZoneTarget.zoneId, false);
  };
  const canDmResurrectSelected = isDmUser && !!selectedTokenId && selectedTargetDead;
  const canDmRestorePhysicalSelected = isDmUser && !!selectedTokenId && selectedTargetPhysicalBroken;
  const canDmRestoreMentalSelected = isDmUser && !!selectedTokenId && Boolean(selectedTargetState?.mentalBroken);
  const requestDmResurrect = async () => {
    if (!selectedTokenId || !canDmResurrectSelected) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_resurrect_token", {
      p_target_token_id: selectedTokenId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await loadCharacters();
  };
  const requestDmRestorePhysical = async () => {
    if (!selectedTokenId || !canDmRestorePhysicalSelected) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_restore_physical_token", {
      p_target_token_id: selectedTokenId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await loadCharacters();
  };
  const requestDmRestoreMental = async () => {
    if (!selectedTokenId || !canDmRestoreMentalSelected) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_restore_mental_token", {
      p_target_token_id: selectedTokenId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await loadCharacters();
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
    if (actorTauntAngerRestricted) return false;
    if (actorDead || actorRestrictedToCrawl) return false;
    if (!actorRestrictedToRun && actorMovementLockedByHold) return false;
    const actingParticipantId = currentEntry?.participant_id ?? null;
    if (!(currentEntry?.fast_available || currentEntry?.slow_available)) return false;
    if (isActorEnemyEngagedForMovement) return false;

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
  const requestCrawlToPoint = async (point: ZonePoint): Promise<boolean> => {
    if (!actorTokenId || !combatMode || !isMyTurn) return false;
    if (!actorRestrictedToCrawl || actorDead) return false;
    if (isSkillBlockedForToken(actorTokenId, "MOVE")) return false;
    if (!currentEntry?.slow_available) return false;
    if (!isActorProne) return false;
    if (isActorEnemyEngagedForMovement) return false;

    const actorToken = tokenByCharacterId.get(actorTokenId);
    if (!actorToken) return false;
    const fromZone = zoneIdAtPoint(zoneRegionMap, actorToken);
    const toZone = zoneIdAtPoint(zoneRegionMap, point);
    if (fromZone === null || toZone === null || fromZone === toZone) return false;
    const distance = shortestZoneDistance(fromZone, toZone, zoneAdjacency);
    if (distance !== 1) return false;

    const didConsume = await consumeAction("slow");
    if (!didConsume) return false;
    const tauntPenalty = await consumeTauntPenaltyForToken(actorTokenId);
    const actingParticipantId = currentEntry?.participant_id ?? null;
    const cleared = await clearSwingForParticipant(actingParticipantId);
    if (!cleared) return false;

    if (currentEntry?.kind === "player") {
      if (!actorCharacter) return false;
      onQueueMeleeAction?.({
        id: `crawl:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        attackerCharacterId: actorCharacter.id,
        targetCharacterId: actorCharacter.id,
        targetName: actorCharacter.name,
        weaponItemId: null,
        weaponName: "Crawl",
        weaponBaseDamage: 0,
        maneuver: "Crawl",
        rollAttribute: "AGL",
        rollSkill: "MOVE",
        requiredSuccesses: 1,
        bonusDice: tauntPenalty,
        destinationX: point.x,
        destinationY: point.y,
      });
      setSelectedZoneTarget(null);
      setSelectedTokenId(null);
      return true;
    }

    const snapshot = currentEntry?.monster_snapshot;
    if (!snapshot || !onResolveMeleeAttack) return false;
    const attributeDice = rollD6Pool(Math.max(0, snapshot.agl ?? 0));
    const signedSkillPool = (snapshot.special ?? 0) + tauntPenalty;
    const skillIsNegative = signedSkillPool < 0;
    const skillDice = rollD6Pool(Math.abs(signedSkillPool));
    const gearDice: number[] = [];
    const rawSuccesses = attributeDice.filter((d) => d === 6).length + skillDice.filter((d) => d === 6).length;
    const successes = skillIsNegative
      ? Math.max(0, rawSuccesses - skillDice.filter((d) => d === 6).length * 2)
      : rawSuccesses;
    setMonsterRollResult({
      actionLabel: "Crawl",
      attributeDice,
      skillDice,
      skillIsNegative,
      gearDice,
      successes,
    });
    await onResolveMeleeAttack({
      id: `monster-crawl:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      attackerCharacterId: actorTokenId,
      targetCharacterId: actorTokenId,
      weaponName: "Crawl",
      weaponBaseDamage: 0,
      maneuver: "Crawl",
      totalSuccesses: successes,
      requiredSuccesses: 1,
      destinationX: point.x,
      destinationY: point.y,
    });
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
      return;
    }
    setTokenElevations((prev) => {
      const next = prev.filter((entry) => entry.character_id !== characterId);
      next.push({ character_id: characterId, elevation: 0 });
      return next;
    });
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
    const attachedTokenIds = new Set<string>();
    if (actorEntry?.grappling_target_id) attachedTokenIds.add(actorEntry.grappling_target_id);
    if (actorEntry?.grappled_by_id) attachedTokenIds.add(actorEntry.grappled_by_id);
    if (actorEntry?.clinging_target_id) attachedTokenIds.add(actorEntry.clinging_target_id);
    if (actorEntry?.clung_onto_by_id) attachedTokenIds.add(actorEntry.clung_onto_by_id);
    for (const id of actorEntry?.clung_onto_by_ids || []) {
      if (id) attachedTokenIds.add(id);
    }
    for (const attachedTokenId of attachedTokenIds) {
      nextTokens = [
        ...nextTokens.filter((token) => token.character_id !== attachedTokenId),
        { character_id: attachedTokenId, x: point.x, y: point.y },
      ];
    }
    let nextElevations = [
      ...tokenElevations.filter((entry) => entry.character_id !== monsterParticipantId),
      { character_id: monsterParticipantId, elevation: 0 },
    ];
    for (const attachedTokenId of attachedTokenIds) {
      nextElevations = [
        ...nextElevations.filter((entry) => entry.character_id !== attachedTokenId),
        { character_id: attachedTokenId, elevation: 0 },
      ];
    }
    setTokenPositions(nextTokens);
    setTokenElevations(nextElevations);

    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("combat_state")
      .upsert(
        { id: 1, token_positions: nextTokens, token_elevations: nextElevations, updated_by_email: userEmail },
        { onConflict: "id" }
      );
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
        const sameElevation =
          tokenElevationForTokenId(actorTokenId) === tokenElevationForTokenId(dropTarget.character_id);
        if (
          combatMode &&
          isMyTurn &&
          !isActorEngaged &&
          !isActorProne &&
          !actorMovementLockedByHold &&
          actorZone !== null &&
          actorZone === targetZone &&
          sameElevation
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
          const didMove = actorRestrictedToCrawl
            ? await requestCrawlToPoint(point)
            : await requestRunToPoint(point, true);
          if (!didMove) return;
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
    <>
      {shouldShowArtPrompt && artPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-gray-950/95 p-5 text-amber-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-amber-300">Art Reaction Available</h3>
                <p className="text-sm text-amber-200/80">
                  Incoming: {artPrompt.attack.maneuver} ({artPrompt.attack.weaponName})
                </p>
                <p className="text-xs text-amber-200/70">Successes: {artPrompt.attack.totalSuccesses}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              {artPrompt.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => void handleArtPromptRoll(option.id)}
                  className={`w-full rounded px-3 py-2 text-sm font-semibold transition-colors ${
                    option.kind === "sunder" || option.kind === "lagging-blade"
                      ? "bg-gradient-to-r from-orange-700 to-gray-100 text-gray-900 hover:from-orange-600 hover:to-white"
                      : "bg-amber-600 text-gray-950 hover:bg-amber-500"
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <button
                onClick={() => void handleArtPromptPass()}
                className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
              >
                Pass
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Never render armor selection while an art selection prompt is active. */}
      {!shouldShowArtPrompt && shouldShowArmorPrompt && activeArmorPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-gray-950/95 p-5 text-amber-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-amber-300">Reaction Available</h3>
                <p className="text-sm text-amber-200/80">
                  Incoming: {activeArmorPrompt.attack.maneuver} ({activeArmorPrompt.attack.weaponName})
                </p>
                <p className="text-xs text-amber-200/70">Successes: {activeArmorPrompt.attack.totalSuccesses}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              {armorPromptCanHelmet && (
                <button
                  onClick={() => handleArmorPromptRoll("helmet")}
                  className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600"
                >
                  Helmet ({activeArmorPrompt.helmetName ?? "Helmet"} +{armorPromptHelmetDice})
                </button>
              )}
              {armorPromptCanArmor && (
                <button
                  onClick={() => handleArmorPromptRoll("armor")}
                  className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600"
                >
                  Armor ({activeArmorPrompt.armorName ?? "Armor"} +{armorPromptArmorDice})
                </button>
              )}
              <button
                onClick={handleArmorPromptPass}
                className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
              >
                Pass
              </button>
            </div>
          </div>
        </div>
      )}
      {shouldShowReactionModal && (pendingReaction || slashReactionPhase) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-gray-950/95 p-5 text-amber-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                {/** Single label source keeps incoming maneuver names consistent across all flow types. */}
                {(() => {
                  const incomingManeuverLabel = flowManeuverForIncomingType(slashIncomingDamage?.type);
                  return (
                    <>
                <h3 className="text-lg font-bold text-amber-300">Reaction Available</h3>
                <p className="text-sm text-amber-200/80">
                  Incoming:{" "}
                  {slashReactionPhase
                    ? `${incomingManeuverLabel} (${slashIncomingMeta?.weaponName || incomingManeuverLabel})`
                    : `${pendingReaction?.maneuver || "Attack"} (${pendingReaction?.weaponName || "Weapon"})`}
                </p>
                <p className="text-xs text-amber-200/70">
                  Successes: {slashReactionPhase ? slashIncomingDamage?.successes ?? 0 : pendingReaction?.totalSuccesses ?? 0}
                </p>
                    </>
                  );
                })()}
              </div>
            </div>

            {slashReactionPhase && !slashCanDodgeReaction && !slashCanParryReaction && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-200/80">
                Reaction unavailable (no fast action or restricted).
              </div>
            )}
            {!slashReactionPhase && !canDodgeReaction && !canParryReaction && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-200/80">
                Reaction unavailable (no fast action or restricted).
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2">
              {slashReactionPhase ? (
                <>
                  {!slashHasDodged && (
                    <>
                      <button
                        onClick={() => void resolvePendingReaction("dodge-stand")}
                        disabled={isResolvingReaction || !slashCanDodgeReaction}
                        className={`w-full rounded px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                          slashFreeDodgeAvailable
                            ? "bg-sky-700 text-sky-100 hover:bg-sky-600"
                            : "bg-orange-700 text-orange-100 hover:bg-orange-600"
                        }`}
                      >
                        Dodge (Standing)
                      </button>
                      <button
                        onClick={() => void resolvePendingReaction("dodge-prone")}
                        disabled={isResolvingReaction || !slashCanDodgeReaction}
                        className={`w-full rounded px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                          slashFreeDodgeAvailable
                            ? "bg-sky-700 text-sky-100 hover:bg-sky-600"
                            : "bg-orange-700 text-orange-100 hover:bg-orange-600"
                        }`}
                      >
                        Dodge (Fall Prone)
                      </button>
                    </>
                  )}
                  {!slashHasParried &&
                    slashParryOptions.map((option) => (
                      <button
                        key={`slash-parry-${option.id}`}
                        onClick={() => void resolvePendingReaction("parry", option)}
                        disabled={isResolvingReaction || !slashCanParryReaction}
                        className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600 disabled:opacity-60"
                      >
                        {`Parry (${option.name})`}
                      </button>
                    ))}
                </>
              ) : (
                canReact && (
                  <>
                    <button
                      onClick={() => void resolvePendingReaction("dodge-stand")}
                      disabled={isResolvingReaction || !canDodgeReaction}
                      className={`w-full rounded px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                        freeDodgeAvailable
                          ? "bg-sky-700 text-sky-100 hover:bg-sky-600"
                          : "bg-orange-700 text-orange-100 hover:bg-orange-600"
                      }`}
                    >
                      Dodge (Standing)
                    </button>
                    <button
                      onClick={() => void resolvePendingReaction("dodge-prone")}
                      disabled={isResolvingReaction || !canDodgeReaction}
                      className={`w-full rounded px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                        freeDodgeAvailable
                          ? "bg-sky-700 text-sky-100 hover:bg-sky-600"
                          : "bg-orange-700 text-orange-100 hover:bg-orange-600"
                      }`}
                    >
                      Dodge (Fall Prone)
                    </button>
                    {parryOptions.map((option) => (
                      <button
                        key={`parry-${option.id}`}
                        onClick={() => void resolvePendingReaction("parry", option)}
                        disabled={isResolvingReaction || !canParryReaction}
                        className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600 disabled:opacity-60"
                      >
                        {`Parry (${option.name})`}
                      </button>
                    ))}
                  </>
                )
              )}
              <button
                onClick={() => void resolvePendingReaction("pass")}
                disabled={isResolvingReaction}
                className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600 disabled:opacity-60"
              >
                Pass
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <aside
        className="rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3"
        style={{ height: `${combatPanelHeight}px` }}
      >
        <h3 className="text-xl font-bold text-amber-300 mb-3">Combat Actions</h3>
        <div className="rounded border border-amber-500/20 bg-gray-900/30 p-3 text-sm text-amber-100/90 mb-3">
          {`Selected: ${
            selectedTokenCharacter?.name ||
            selectedTokenMonster?.name ||
            (selectedZoneTarget ? `Zone ${selectedZoneTarget.zoneId}` : "None")
          }`}
          {selectedZoneTarget && (
            <div className="mt-1 text-xs text-amber-200/80">
              {`On Ground: ${
                selectedZoneLootSummary.length > 0
                  ? selectedZoneLootSummary
                      .map((group) => (group.count > 1 ? `${group.label} x${group.count}` : group.label))
                      .join(", ")
                  : "None"
              }, Cover: ${zoneCoverIds.includes(selectedZoneTarget.zoneId) ? "Yes" : "No"}`}
            </div>
          )}
        </div>
        {incomingPipelineActive && !shouldShowReactionModal && !shouldShowArmorPrompt && !shouldShowArtPrompt && (
          <div className="mb-3 rounded border border-orange-500/40 bg-orange-900/20 px-3 py-2 text-xs text-orange-200/90">
            Reactions in stack. Please wait for resolution.
          </div>
        )}
        <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
          {canUseGrappleFromSelection && (
            <button
              onClick={() => void requestGrappleLike("Grapple")}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Grapple
            </button>
          )}
          {canUseClingFromSelection && (
            <button
              onClick={() => void requestGrappleLike("Cling")}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Cling
            </button>
          )}
          {readyOrLoadOptions
            .filter((option) => option.isLoading)
            .map((option) => (
              <button
                key={`ready-load-${option.weaponItemId}`}
                onClick={() => void requestReadyOrLoadWeapon(option)}
                className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
              >
                {`Load (${option.weaponName})`}
              </button>
            ))}
          {shootActionOptions.map((option) => (
            <button
              key={`shoot-${option.weaponItemId}-${selectedTokenId ?? "target"}`}
              onClick={() => void requestShoot(option)}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              {`Shoot (${option.weaponName})`}
            </button>
          ))}
          {meleeActionOptions
            .filter((option) => option.maneuver !== "Grapple Attack")
            .map((option) => (
              <button
                key={`${option.maneuver}-${option.weaponItemId ?? "none"}`}
                onClick={() => void requestMeleeAction(option)}
                className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
              >
                {option.maneuver === "Strike"
                  ? "Strike"
                  : `${option.maneuver} (${option.weaponName})`}
              </button>
            ))}
          {canUseCoupFromSelection && (
            <button
              onClick={() => void requestCoupDeGrace()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Coup de Grace
            </button>
          )}
          {canUseCrawlFromSelection && (
            <button
              onClick={() => void requestRun()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Crawl
            </button>
          )}
          {canUseRetreatFromSelection && !isFreeRetreatAvailable && (
            <button
              onClick={() => void requestRetreat()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Retreat
            </button>
          )}
          {canUseFleeFromSelection && (
            <button
              onClick={() => void requestFlee()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Flee
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
          {canUseFeintFromSelection && (
            <button
              onClick={() => void requestFeint()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Feint
            </button>
          )}
          {canUseSnuff && (
            <button
              onClick={() => void requestSnuff()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Snuff
            </button>
          )}
          {canUseFlamingLongswordItem && (
            <button
              onClick={() => void requestUseFlamingLongswordItem()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Use Item (Flaming Longsword)
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
          {canEnterCoverFromSelection && (
            <button
              onClick={() => void requestEnterCover()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Enter Cover
            </button>
          )}
          {canExitCoverFromSelection && (
            <button
              onClick={() => void requestExitCover()}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Exit Cover
            </button>
          )}
          {readyOrLoadOptions
            .filter((option) => !option.isLoading)
            .map((option) => (
              <button
                key={`ready-load-${option.weaponItemId}`}
                onClick={() => void requestReadyOrLoadWeapon(option)}
                className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
              >
                {`Ready (${option.weaponName})`}
              </button>
            ))}
          {aimActionOptions.map((option) => (
            <button
              key={`aim-${option.weaponItemId}-${selectedTokenId ?? "target"}`}
              onClick={() => void requestAim(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Aim (${option.weaponName})`}
            </button>
          ))}
          {swingWeaponOptions.map((weapon) => (
            <button
              key={`swing-${weapon.id}`}
              onClick={() => void requestSwingWeapon(weapon)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Swing (${weapon.name})`}
            </button>
          ))}
          {meleeActionOptions
            .filter((option) => option.maneuver === "Grapple Attack")
            .map((option) => (
              <button
                key={`${option.maneuver}-${option.weaponItemId ?? "none"}`}
                onClick={() => void requestMeleeAction(option)}
                className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
              >
                Grapple Attack
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
          {healActionOptions.map((option) => (
            <button
              key={`heal-${option.attribute}`}
              onClick={() => void requestHeal(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {option.label}
            </button>
          ))}
          {tauntActionOptions.map((option) => (
            <button
              key={`taunt-${option.mode}`}
              onClick={() => void requestTaunt(option.mode)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {option.label}
            </button>
          ))}
          {pickUpActionOptionGroups.map((option) => (
            <button
              key={`pickup-${selectedZoneTarget?.zoneId ?? "zone"}-${option.key}`}
              onClick={() => void requestPickUpAction(option)}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              {`Pick Up (${option.count > 1 ? `${option.label} x${option.count}` : option.label})`}
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
          {canUseFlyFromSelection && (
            <button
              onClick={() => void requestFly("up")}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Fly (Up)
            </button>
          )}
          {canUseFlyDownFromSelection && (
            <button
              onClick={() => void requestFly("down")}
              className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600"
            >
              Fly (Down)
            </button>
          )}
          {canUseEngageFromSelection && (
            <button
              onClick={requestEngage}
              className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Engage
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
          {canUseUnready && currentReadied && (
            <button
              onClick={() => void requestUnready()}
              className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600"
            >
              {`Unready (${currentReadied.weaponName})`}
            </button>
          )}
          {canUseRetreatFromSelection && isFreeRetreatAvailable && (
            <button
              onClick={() => void requestRetreat()}
              className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-600"
            >
              Retreat
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
          {canDmSetCoverZone && (
            <button
              onClick={() => void requestDmSetCover()}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Set Cover
            </button>
          )}
          {canDmUnsetCoverZone && (
            <button
              onClick={() => void requestDmUnsetCover()}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Unset Cover
            </button>
          )}
          {canDmResurrectSelected && (
            <button
              onClick={() => void requestDmResurrect()}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Resurrect
            </button>
          )}
          {canDmRestorePhysicalSelected && (
            <button
              onClick={() => void requestDmRestorePhysical()}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Restore (Physical)
            </button>
          )}
          {canDmRestoreMentalSelected && (
            <button
              onClick={() => void requestDmRestoreMental()}
              className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Restore (Mental)
            </button>
          )}
          {canPass && (
            <button
              onClick={() => void requestGenericSlow()}
              className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600"
            >
              Generic Slow
            </button>
          )}
          {canPass && (
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
              <p>{monsterRollResult.attributeLabel || "Attribute Dice"}: {monsterRollResult.attributeDice.length > 0 ? monsterRollResult.attributeDice.join(", ") : "None"}</p>
              <p>{monsterRollResult.skillLabel || (monsterRollResult.skillIsNegative ? "Skill Dice (Negative)" : "Skill Dice")}: {monsterRollResult.skillDice.length > 0 ? monsterRollResult.skillDice.join(", ") : "None"}</p>
              <p>{monsterRollResult.gearLabel || "Gear Dice"}: {monsterRollResult.gearDice.length > 0 ? monsterRollResult.gearDice.join(", ") : "None"}</p>
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
            const hasCover = zoneCoverIds.includes(zoneId);
            if (items.length === 0 && !hasCover) {
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
              hasCover,
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
          className={`relative overflow-hidden rounded-2xl border transition-all ${
            isDragging ? "border-amber-300 bg-amber-500/10" : "border-amber-500/40 bg-black/20"
          }`}
          style={{ height: `${combatPanelHeight}px` }}
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
                    if (tokenElevationForTokenId(edge.a) !== tokenElevationForTokenId(edge.b)) return null;
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
                      let unitX = 1;
                      let unitY = 0;
                      if (tokenEntry?.clinging_target_id) {
                        const peers = clingersByTarget.get(attachedTargetId) || [];
                        const idx = Math.max(0, peers.indexOf(token.character_id));
                        const angle = (idx / Math.max(1, peers.length)) * Math.PI * 2;
                        unitX = Math.cos(angle);
                        unitY = Math.sin(angle);
                      } else {
                        const dx = token.x - targetToken.x;
                        const dy = token.y - targetToken.y;
                        const dist = Math.hypot(dx, dy);
                        unitX = dist > 0.0001 ? dx / dist : 1;
                        unitY = dist > 0.0001 ? dy / dist : 0;
                      }
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
                    {(token.dead || token.physicallyBroken || token.mentallyBroken) && (
                      <svg
                        viewBox="0 0 100 100"
                        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={tokenSizeStyle}
                      >
                        <line
                          x1="18"
                          y1="18"
                          x2="82"
                          y2="82"
                          stroke={token.dead ? "#111111" : token.physicallyBroken ? "#dc2626" : "#2563eb"}
                          strokeWidth="10"
                          strokeLinecap="round"
                        />
                        <line
                          x1="82"
                          y1="18"
                          x2="18"
                          y2="82"
                          stroke={token.dead ? "#111111" : token.physicallyBroken ? "#dc2626" : "#2563eb"}
                          strokeWidth="10"
                          strokeLinecap="round"
                        />
                      </svg>
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
              {zoneHoverInfo.items.length > 0 && (
                <div>
                  {groupItemsForDisplay(zoneHoverInfo.items)
                    .map((group) => (group.count > 1 ? `${group.label} x${group.count}` : group.label))
                    .join(", ")}
                </div>
              )}
              {zoneHoverInfo.hasCover && <div>Cover</div>}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      <aside
        className="rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3"
        style={{ height: `${combatPanelHeight}px` }}
      >
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
              Deploy
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
                placeholder="Type name (xN)"
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
                {isDmUser && entry.kind === "player" && (
                  <button
                    onClick={() => removeParticipantFromInitiative(entry.participant_id)}
                    className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-red-100 hover:bg-red-600"
                    title="Remove from initiative"
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
    <div
      onPointerDown={handleCombatPanelResizeStart}
      className="my-2 flex h-4 cursor-row-resize items-center justify-center select-none rounded text-amber-200/70 hover:text-amber-100"
      title="Drag to resize combat panels"
    >
      <div className="h-1 w-20 rounded-full bg-amber-500/50" />
    </div>
    </>
  );
}
