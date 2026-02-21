"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyGearDamageToItem, normalizeInventoryItems } from "@/lib/item-catalog";
import artsCatalogData from "../../data/arts.json";
import Character from "../../components/character";
import Inventory from "../../components/inventory";
import Arts from "../../components/arts";
import Talents from "../../components/talents";
import Wagon from "../../components/wagon";
import Combat from "../../components/combat";
import Poll from "../../components/poll";
import Kogra from "../../components/kogra";
import Monsters from "../../components/monsters";
import Glossary from "../../components/glossary";
import MapBoard from "../../components/map-board";

type Attributes = {
  STR: number;
  AGL: number;
  WIT: number;
  EMP: number;
};

export type CharacterType = {
  id: string;
  name: string;
  email: string;
  age: number;
  gender: string;
  xp?: number;
  attributes: Attributes;
  max_attributes: Attributes;
  skills: Record<string, number>;
  spirits: number;
  dead?: boolean;
  inventory?: InventoryItem[];
  equipment_slots?: EquipmentSlots;
  known_art_ids?: string[];
  equipped_art_ids?: string[];
  talent_levels?: Record<string, number>;
  talents?: TalentProgress[];
  // Legacy fields kept for compatibility with older rows.
  arts?: Art[];
  equipped_arts?: Art[];
  icon_url?: string;
};

export type EquipmentSlots = {
  armor: string | null;
  helmet: string | null;
  left: string | null;
  right: string | null;
  armor_ask?: boolean;
};

export type TalentProgress = {
  id: string;
  level: 1 | 2 | 3;
};

export type ArtKind = "true" | "demon" | "monster" | "angel" | "mortal" | "nature";

export type Art = {
  id: string;
  name: string;
  kind: ArtKind;
  speed: "Slow" | "Fast";
  range: "Distant" | "Near" | "Touch" | "Self";
  cost: string;
  description?: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  weight: number;
  gearBonus?: number;
  effective_gear_bonus?: number;
  quantity?: number;
  item_key?: string;
  item_type?: string;
  wield?: "1H" | "2H";
  damage?: number;
  range_band?: string;
  properties?: string[];
};

export type PendingMeleeAction = {
  id: string;
  attackerCharacterId: string;
  attackerName?: string;
  targetCharacterId: string;
  targetName: string;
  weaponItemId?: string | null;
  weaponName: string;
  weaponBaseDamage: number;
  maneuver:
    | "Slash"
    | "Stab"
    | "Strike"
    | "Shoot"
    | "Grapple Attack"
    | "Retreat"
    | "Flee"
    | "Shove"
    | "Disarm"
    | "Grapple"
    | "Cling"
    | "Break Free"
    | "Feint"
    | "Coup de Grace"
    | "Crawl"
    | "Heal"
    | "Taunt (Anger)"
    | "Taunt (Distract)"
    | "Snuff";
  rollAttribute?: keyof Attributes;
  rollSkill?: string;
  requiredSuccesses?: number;
  swingBonusDamage?: number;
  bonusDice?: number;
  healAttribute?: keyof Attributes;
  disarmTargetItemId?: string | null;
  disarmTargetItemName?: string | null;
  disarmZoneId?: number | null;
  destinationX?: number;
  destinationY?: number;
  shootTargetZoneId?: number | null;
  shootAmmoItem?: InventoryItem | null;
  rangeAtAttack?: "Engaged" | "Near" | "Close" | "Long" | "Distant" | null;
};

export type ResolvedMeleeAttack = {
  id: string;
  attackerCharacterId: string;
  attackerName?: string;
  targetCharacterId: string;
  weaponName: string;
  weaponBaseDamage: number;
  maneuver:
    | "Slash"
    | "Stab"
    | "Strike"
    | "Shoot"
    | "Grapple Attack"
    | "Retreat"
    | "Flee"
    | "Shove"
    | "Disarm"
    | "Grapple"
    | "Cling"
    | "Break Free"
    | "Feint"
    | "Coup de Grace"
    | "Crawl"
    | "Heal"
    | "Taunt (Anger)"
    | "Taunt (Distract)"
    | "Snuff";
  totalSuccesses: number;
  requiredSuccesses?: number;
  swingBonusDamage?: number;
  healAttribute?: keyof Attributes;
  disarmTargetItemId?: string | null;
  disarmZoneId?: number | null;
  destinationX?: number;
  destinationY?: number;
  shootTargetZoneId?: number | null;
  shootAmmoItem?: InventoryItem | null;
  rangeAtAttack?: "Engaged" | "Near" | "Close" | "Long" | "Distant" | null;
  skipReaction?: boolean;
  armorUsed?: { helmet?: boolean; armor?: boolean };
  armorSkipped?: boolean;
  sunderResolved?: boolean;
};

export type PendingReactionRoll = {
  id: string;
  reactionId: string;
  targetCharacterId: string;
  mode: "dodge-stand" | "dodge-prone" | "parry" | "armor" | "helmet" | "insight";
  rollType?: "reaction" | "armor" | "insight";
  rollAttribute: keyof Attributes;
  rollSkill: string;
  bonusDice: number;
  fixedAttributeDice?: number;
  fixedSkillDice?: number;
  gearItemId?: string | null;
  armorSlot?: "armor" | "helmet";
  applyProne?: boolean;
  attack?: ResolvedMeleeAttack;
  taunt?: {
    mode: "anger" | "distract";
    attackerCharacterId: string;
    attackerName: string;
    targetCharacterId: string;
    successes: number;
  };
};

export type ResolvedReactionRoll = {
  id: string;
  reactionId: string;
  targetCharacterId: string;
  mode: "dodge-stand" | "dodge-prone" | "parry" | "armor" | "helmet" | "insight";
  rollType?: "reaction" | "armor" | "insight";
  totalSuccesses: number;
  armorSlot?: "armor" | "helmet";
  applyProne?: boolean;
  attack?: ResolvedMeleeAttack;
  taunt?: {
    mode: "anger" | "distract";
    attackerCharacterId: string;
    attackerName: string;
    targetCharacterId: string;
    successes: number;
  };
};

export type PendingArmorPrompt = {
  id: string;
  targetCharacterId: string;
  attack: ResolvedMeleeAttack;
  helmetItemId?: string | null;
  helmetName?: string | null;
  helmetDice?: number;
  armorItemId?: string | null;
  armorName?: string | null;
  armorDice?: number;
  armorUsed?: { helmet?: boolean; armor?: boolean };
};

export type PendingSunderPrompt = {
  id: string;
  attackerCharacterId: string;
  attack: ResolvedMeleeAttack;
  options: Array<{
    itemId: string;
    itemName: string;
    slot: "left" | "right" | "armor" | "helmet";
    targetIsMonster: boolean;
  }>;
};

export type PendingArtRoll = {
  id: string;
  actorCharacterId: string;
  artId: string;
  displayName?: string;
  sunder?: {
    attack: ResolvedMeleeAttack;
    targetItemId: string;
    targetItemName: string;
    targetIsMonster: boolean;
  };
};

export type ResolvedArtRoll = {
  pendingRollId?: string;
  artId: string;
  artName: string;
  successes: number;
  scaling: number;
  spiritGenerated: number;
  activated: boolean;
  context?: PendingArtRoll;
};

type WagonData = {
  wagon1: InventoryItem[];
  wagon2: InventoryItem[];
};

export type NotificationData = {
  id: string;
  message: string;
  created_at: string;
  recipient_email?: string;
};

const ADMIN_EMAIL = "drocasma9@gmail.com";
const FLAME_MAX_INTENSITY = 9;
const FLAMING_LONGSWORD_USED_FLAG = "Used (Flaming Longsword)";
const artsCatalog = artsCatalogData as Art[];

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

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<
    | "character"
    | "inventory"
    | "arts"
    | "talents"
    | "wagon"
    | "combat"
    | "monsters"
    | "poll"
    | "kogra"
    | "glossary"
    | "map"
  >("character");
  const [character, setCharacter] = useState<CharacterType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [simulatePlayerMode, setSimulatePlayerMode] = useState(false);
  const [allCharacters, setAllCharacters] = useState<CharacterType[]>([]);
  const [showCharacterSelect, setShowCharacterSelect] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [wagonData, setWagonData] = useState<WagonData>({ wagon1: [], wagon2: [] });
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [notification, setNotification] = useState<NotificationData | null>(null);
  const [drawGearReturnToCombat, setDrawGearReturnToCombat] = useState(false);
  const [pendingMeleeAction, setPendingMeleeAction] = useState<PendingMeleeAction | null>(null);
  const [meleeRollReturnToCombat, setMeleeRollReturnToCombat] = useState(false);
  const [pendingReactionRoll, setPendingReactionRoll] = useState<PendingReactionRoll | null>(null);
  const [reactionRollReturnToCombat, setReactionRollReturnToCombat] = useState(false);
  const [pendingArmorPrompt, setPendingArmorPrompt] = useState<PendingArmorPrompt | null>(null);
  const [pendingSunderPrompt, setPendingSunderPrompt] = useState<PendingSunderPrompt | null>(null);
  const [pendingArtRoll, setPendingArtRoll] = useState<PendingArtRoll | null>(null);
  const [artRollReturnToCombat, setArtRollReturnToCombat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function initializeCharacter() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) return;

      setUserEmail(email);
      const adminUser = email === ADMIN_EMAIL;
      setIsAdmin(adminUser);

      // Fetch wagon data
      await fetchWagons();

      // Fetch all characters for everyone (needed for Poll tab)
      const { data: chars, error } = await supabase
        .from("characters")
        .select("*")
        .order("name");

      if (error) {
        console.error(error);
      } else {
        const normalizedChars = (chars || []).map((char) => ({
          ...char,
          inventory: normalizeInventoryItems(char.inventory || []),
        }));

        if (adminUser) {
          await Promise.all(
            normalizedChars.map(async (char, idx) => {
              const rawInv = (chars || [])[idx]?.inventory || [];
              if (JSON.stringify(rawInv) !== JSON.stringify(char.inventory || [])) {
                await supabase
                  .from("characters")
                  .update({ inventory: char.inventory || [] })
                  .eq("id", char.id);
              }
            })
          );
        }

        setAllCharacters(normalizedChars);
      }

      if (adminUser) {
        // Show character select for admin
        setShowCharacterSelect(true);
      } else {
        // Fetch user's character
        await fetchCharacter(email);
      }
    }
    initializeCharacter();
  }, []);

  // Listen for notifications
  useEffect(() => {
    if (!userEmail) return;

    const supabase = createClient();

    // Check for existing notifications on mount
    const checkNotifications = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .or(`recipient_email.eq.${userEmail},recipient_email.is.null`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        setNotification(data[0]);
      }
    };

    checkNotifications();

    // Subscribe to new notifications
    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
        },
        (payload) => {
          const newNotification = payload.new as NotificationData;
          // Show notification if it's for this user or for all users
          if (!newNotification.recipient_email || newNotification.recipient_email === userEmail) {
            setNotification(newNotification);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  const fetchWagons = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("wagons")
      .select("*")
      .single();

    if (error) {
      console.error("Error fetching wagons:", error);
      setWagonData({ wagon1: [], wagon2: [] });
    } else {
      const rawW1 = data.wagon1 || [];
      const rawW2 = data.wagon2 || [];
      const normW1 = normalizeInventoryItems(rawW1);
      const normW2 = normalizeInventoryItems(rawW2);
      const changed =
        JSON.stringify(rawW1) !== JSON.stringify(normW1) ||
        JSON.stringify(rawW2) !== JSON.stringify(normW2);

      if (changed) {
        await supabase
          .from("wagons")
          .upsert({ id: 1, wagon1: normW1, wagon2: normW2 });
      }

      setWagonData({
        wagon1: normW1,
        wagon2: normW2,
      });
    }
  };

  const fetchCharacter = async (email: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("Error fetching character:", error);
      return;
    }

    if (!data) {
      setCharacter(null);
      setShowCharacterSelect(false);
      return;
    }

    // Initialize inventory if it doesn't exist
    if (!data.inventory) {
      data.inventory = [];
    }
    const normalizedInventory = normalizeInventoryItems(data.inventory || []);
    if (JSON.stringify(data.inventory || []) !== JSON.stringify(normalizedInventory)) {
      await supabase
        .from("characters")
        .update({ inventory: normalizedInventory })
        .eq("id", data.id);
    }
    data.inventory = normalizedInventory;
    setCharacter(data);
    setShowCharacterSelect(false);
  };

  const selectCharacter = async (characterId: string) => {
    const selectedChar = allCharacters.find(c => c.id === characterId);
    if (selectedChar) {
      // Initialize inventory if it doesn't exist
      if (!selectedChar.inventory) {
        selectedChar.inventory = [];
      }
      selectedChar.inventory = normalizeInventoryItems(selectedChar.inventory || []);
      setCharacter(selectedChar);
      setShowCharacterSelect(false);
    }
  };

  const updateCharacter = (updates: Partial<CharacterType>) => {
    if (!character) return;
    const updatedCharacter = { ...character, ...updates };
    if (
      updatedCharacter.attributes &&
      Object.values(updatedCharacter.attributes).some((value) => value <= 0)
    ) {
      updatedCharacter.spirits = 0;
    }
    setCharacter(updatedCharacter);
  };

  const saveCharacter = async (updates: Partial<CharacterType>) => {
    if (!character) return;
    const updatesToSave: Partial<CharacterType> = { ...updates };
    const nextAttributes = updatesToSave.attributes ?? character.attributes;
    if (nextAttributes && Object.values(nextAttributes).some((value) => value <= 0)) {
      updatesToSave.spirits = 0;
    }
    const supabase = createClient();
    await supabase
      .from("characters")
      .update(updatesToSave)
      .eq("id", character.id);
  };

  const handleIconClick = () => {
    fileInputRef.current?.click();
  };

  const handleIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!character || !event.target.files || event.target.files.length === 0) {
      return;
    }

    const file = event.target.files[0];
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image size must be less than 2MB');
      return;
    }

    setUploadingIcon(true);

    try {
      const supabase = createClient();
      
      // Create a unique file name
      const fileExt = file.name.split('.').pop();
      const fileName = `${character.id}-${Date.now()}.${fileExt}`;
      const filePath = `character-icons/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('character-assets')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('character-assets')
        .getPublicUrl(filePath);

      // Update character with new icon URL
      const updates = { icon_url: publicUrl };
      updateCharacter(updates);
      await saveCharacter(updates);

    } catch (error) {
      console.error('Error uploading icon:', error);
      alert('Failed to upload icon. Please try again.');
    } finally {
      setUploadingIcon(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const restCharacter = async () => {
    if (!character) return;
    const maxAttrs = character.max_attributes || character.attributes;
    const resetCharacter = { ...character, spirits: 0, attributes: maxAttrs };
    setCharacter(resetCharacter);

    const supabase = createClient();
    await supabase
      .from("characters")
      .update({ spirits: 0, attributes: maxAttrs })
      .eq("id", character.id);
  };

  const switchCharacter = () => {
    setShowCharacterSelect(true);
    setCharacter(null);
  };

  const toggleSimulatePlayerMode = async () => {
    const next = !simulatePlayerMode;
    setSimulatePlayerMode(next);
  };

  const dismissNotification = async () => {
    if (!notification) return;
    
    const supabase = createClient();
    await supabase
      .from("notifications")
      .delete()
      .eq("id", notification.id);
    
    setNotification(null);
  };

  const startDrawGearFromCombat = () => {
    setDrawGearReturnToCombat(true);
    setActiveTab("inventory");
  };

  const onDrawGearFinished = () => {
    if (drawGearReturnToCombat) {
      setActiveTab("combat");
      setDrawGearReturnToCombat(false);
    }
  };

  const queueMeleeAction = (action: PendingMeleeAction) => {
    setPendingMeleeAction(action);
    setMeleeRollReturnToCombat(true);
    setActiveTab("character");
  };

  const queueReactionRoll = (roll: PendingReactionRoll) => {
    setPendingReactionRoll(roll);
    setReactionRollReturnToCombat(true);
    setActiveTab("character");
  };

  const queueArtRoll = (roll: PendingArtRoll) => {
    setPendingArtRoll(roll);
    setArtRollReturnToCombat(true);
    setActiveTab("arts");
  };

  const clearPendingMeleeAction = (actionId: string) => {
    setPendingMeleeAction((prev) => (prev?.id === actionId ? null : prev));
  };

  const clearPendingReactionRoll = (rollId: string) => {
    setPendingReactionRoll((prev) => (prev?.id === rollId ? null : prev));
  };

  const clearPendingArmorPrompt = (promptId: string) => {
    setPendingArmorPrompt((prev) => (prev?.id === promptId ? null : prev));
  };

  const clearPendingSunderPrompt = (promptId: string) => {
    setPendingSunderPrompt((prev) => (prev?.id === promptId ? null : prev));
  };

  const clearPendingArtRoll = (rollId: string) => {
    setPendingArtRoll((prev) => (prev?.id === rollId ? null : prev));
  };

  const handleArmorPromptPass = async (attack: ResolvedMeleeAttack) => {
    await resolveMeleeAttack({
      ...attack,
      armorSkipped: true,
    });
  };

  const onMeleeRollCleared = () => {
    if (!meleeRollReturnToCombat) return;
    setActiveTab("combat");
    setMeleeRollReturnToCombat(false);
  };

  const onReactionRollCleared = () => {
    if (!reactionRollReturnToCombat) return;
    setActiveTab("combat");
    setReactionRollReturnToCombat(false);
  };

  const onArtRollCleared = () => {
    if (!artRollReturnToCombat) return;
    setActiveTab("combat");
    setArtRollReturnToCombat(false);
  };

  const rollD6Pool = (count: number): number[] =>
    Array.from({ length: Math.max(0, count) }, () => Math.floor(Math.random() * 6) + 1);

  const applyTauntToCombatState = async (opts: {
    targetCharacterId: string;
    mode: "anger" | "distract";
    remainingSuccesses: number;
    attackerCharacterId: string;
    attackerName: string;
  }) => {
    if (opts.remainingSuccesses <= 0) return;
    const supabase = createClient();
    const { data: combatState, error: combatError } = await supabase
      .from("combat_state")
      .select("initiative_entries")
      .eq("id", 1)
      .maybeSingle<{
        initiative_entries: Array<Record<string, unknown>> | null;
      }>();
    if (combatError) {
      console.error("Failed to load combat state for taunt:", combatError);
      return;
    }
    const entries = Array.isArray(combatState?.initiative_entries) ? combatState!.initiative_entries : [];
    if (entries.length === 0) return;

    const nextEntries = entries.map((entry) => {
      const participantId = String(entry.participant_id ?? "");
      if (
        participantId !== opts.targetCharacterId &&
        participantId !== `player:${opts.targetCharacterId}`
      ) {
        return entry;
      }
      if (opts.mode === "distract") {
        const existing = Math.max(0, Number(entry.taunted_distract_value ?? 0));
        const nextValue = Math.max(existing, opts.remainingSuccesses);
        return {
          ...entry,
          taunted_distract_value: nextValue,
        };
      }
      return {
        ...entry,
        taunted_anger_by_id: opts.attackerCharacterId,
        taunted_anger_by_name: opts.attackerName,
      };
    });

    const { error: updateError } = await supabase
      .from("combat_state")
      .update({ initiative_entries: nextEntries })
      .eq("id", 1);
    if (updateError) {
      console.error("Failed to apply taunt:", updateError);
    }
  };

  const setFlameIntensityForToken = async (tokenId: string, intensity: number | null) => {
    const supabase = createClient();
    const nextValue = intensity && intensity > 0 ? Math.min(FLAME_MAX_INTENSITY, Math.trunc(intensity)) : null;
    const { data: combatState, error: combatError } = await supabase
      .from("combat_state")
      .select("initiative_entries")
      .eq("id", 1)
      .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
    if (combatError) {
      console.error("Failed to load combat state for flame update:", combatError);
      return;
    }
    const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
    if (entries.length === 0) return;
    const nextEntries = entries.map((entry) => {
      const participantId = String(entry.participant_id ?? "");
      if (participantId !== tokenId && participantId !== `player:${tokenId}`) return entry;
      return { ...entry, flame_intensity: nextValue };
    });
    const { error: updateError } = await supabase
      .from("combat_state")
      .update({ initiative_entries: nextEntries })
      .eq("id", 1);
    if (updateError) {
      console.error("Failed to set flame intensity:", updateError);
    }
  };

  const resetEffectiveBonusesForArmorItems = (
    items: InventoryItem[]
  ): { items: InventoryItem[]; changed: boolean } => {
    let changed = false;
    const nextItems = items.map((item) => {
      if (item.item_type !== "Armor" && item.item_type !== "Helmet") return item;
      const trueBonus = Math.max(0, Math.trunc(item.gearBonus ?? 0));
      const currentEffective =
        typeof item.effective_gear_bonus === "number" && !Number.isNaN(item.effective_gear_bonus)
          ? Math.max(0, Math.trunc(item.effective_gear_bonus))
          : trueBonus;
      if (currentEffective === trueBonus) return item;
      changed = true;
      return { ...item, effective_gear_bonus: trueBonus };
    });
    return { items: nextItems, changed };
  };

  const effectiveArmorDiceForItem = (item: InventoryItem | null | undefined): number => {
    if (!item) return 0;
    if (item.item_type === "Armor" || item.item_type === "Helmet") {
      if (typeof item.effective_gear_bonus === "number" && !Number.isNaN(item.effective_gear_bonus)) {
        return Math.max(0, Math.trunc(item.effective_gear_bonus));
      }
    }
    return Math.max(0, Math.trunc(item.gearBonus ?? 0));
  };

  const isChainmailArmorItem = (item: InventoryItem): boolean => {
    if (item.item_type !== "Armor") return false;
    const props = Array.isArray(item.properties) ? item.properties : [];
    return props.some((value) => String(value).trim().toLowerCase() === "chainmail");
  };

  const applyTemporaryArmorRollEffectiveBonuses = (
    items: InventoryItem[],
    options: { applyChainmailPenalty: boolean; applyWoodenHeadBonus: boolean }
  ): { items: InventoryItem[]; changed: boolean } => {
    let changed = false;
    const nextItems = items.map((item) => {
      if (item.item_type !== "Armor" && item.item_type !== "Helmet") return item;
      const trueBonus = Math.max(0, Math.trunc(item.gearBonus ?? 0));
      let targetEffective = trueBonus;
      if (options.applyChainmailPenalty && isChainmailArmorItem(item)) {
        targetEffective = Math.max(0, targetEffective - 3);
      }
      if (options.applyWoodenHeadBonus) {
        targetEffective = Math.max(0, targetEffective * 2);
      }
      const currentEffective =
        typeof item.effective_gear_bonus === "number" && !Number.isNaN(item.effective_gear_bonus)
          ? Math.max(0, Math.trunc(item.effective_gear_bonus))
          : trueBonus;
      if (currentEffective === targetEffective) return item;
      changed = true;
      return { ...item, effective_gear_bonus: targetEffective };
    });
    return { items: nextItems, changed };
  };

  const getFlameIntensityForToken = async (tokenId: string): Promise<number> => {
    const supabase = createClient();
    const { data: combatState, error: combatError } = await supabase
      .from("combat_state")
      .select("initiative_entries")
      .eq("id", 1)
      .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
    if (combatError) {
      console.error("Failed to load combat state for flame read:", combatError);
      return 0;
    }
    const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
    const entry = entries.find((item) => {
      const participantId = String(item.participant_id ?? "");
      return participantId === tokenId || participantId === `player:${tokenId}`;
    });
    return Math.max(0, Math.trunc(Number(entry?.flame_intensity ?? 0)));
  };

  const rollFlameArmorReduction = async (tokenId: string, preArmorDamage: number): Promise<number> => {
    if (preArmorDamage <= 0) return 0;
    const supabase = createClient();
    const rollArmorDice = (count: number): number =>
      rollD6Pool(Math.max(0, count)).filter((value) => value === 6).length;
    const findEquipped = (
      items: InventoryItem[],
      slots?: { armor?: string | null; helmet?: string | null } | null
    ) => {
      const slotData = slots || { armor: null, helmet: null };
      const matches = (slotValue: string | null | undefined, item: InventoryItem) =>
        Boolean(slotValue && (slotValue === item.id || slotValue === item.name));
      const armor = items.find((item) => item.item_type === "Armor" && matches(slotData.armor, item)) || null;
      const helmet = items.find((item) => item.item_type === "Helmet" && matches(slotData.helmet, item)) || null;
      return {
        armorDice: Math.max(0, armor?.gearBonus ?? 0),
        helmetDice: Math.max(0, helmet?.gearBonus ?? 0),
      };
    };

    if (tokenId.startsWith("monster:")) {
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_monsters, initiative_entries")
        .eq("id", 1)
        .maybeSingle<{
          initiative_monsters: Array<{ id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
          initiative_entries: Array<{ participant_id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
        }>();
      if (combatError || !combatState) {
        if (combatError) console.error("Failed to load monster armor for flame:", combatError);
        return 0;
      }
      const entry = (combatState.initiative_entries || []).find((item) => item.participant_id === tokenId);
      const monster = (combatState.initiative_monsters || []).find((item) => item.id === tokenId);
      const snapshot = (entry?.monster_snapshot || monster?.monster_snapshot || {}) as {
        natural_armor?: number;
        gear?: InventoryItem[];
        equipment_slots?: { armor?: string | null; helmet?: string | null };
      };
      const normalizedGear = resetEffectiveBonusesForArmorItems(snapshot.gear || []);
      const gearForRoll = normalizedGear.items;
      if (normalizedGear.changed) {
        const nextMonsters = (combatState.initiative_monsters || []).map((item) =>
          item.id === tokenId
            ? { ...item, monster_snapshot: { ...(item.monster_snapshot || {}), gear: gearForRoll } }
            : item
        );
        const nextEntries = (combatState.initiative_entries || []).map((item) =>
          item.participant_id === tokenId
            ? { ...item, monster_snapshot: { ...(item.monster_snapshot || {}), gear: gearForRoll } }
            : item
        );
        const { error: updateError } = await supabase
          .from("combat_state")
          .update({ initiative_monsters: nextMonsters, initiative_entries: nextEntries })
          .eq("id", 1);
        if (updateError) {
          console.error("Failed to reset monster armor effective bonus:", updateError);
        }
      }
      const equipped = findEquipped(gearForRoll, snapshot.equipment_slots);
      const naturalArmorDice = Math.max(0, Number(snapshot.natural_armor ?? 0));
      let reduction = 0;
      reduction += rollArmorDice(equipped.helmetDice);
      if (reduction < preArmorDamage) reduction += rollArmorDice(equipped.armorDice);
      if (reduction < preArmorDamage) reduction += rollArmorDice(naturalArmorDice);
      return Math.max(0, Math.min(preArmorDamage, reduction));
    }

    const { data: target, error: targetError } = await supabase
      .from("characters")
      .select("id, inventory, equipment_slots")
      .eq("id", tokenId)
      .maybeSingle<{
        id: string;
        inventory?: InventoryItem[] | null;
        equipment_slots?: { armor?: string | null; helmet?: string | null } | null;
      }>();
    if (targetError || !target) {
      if (targetError) console.error("Failed to load player armor for flame:", targetError);
      return 0;
    }
    const normalizedInventory = resetEffectiveBonusesForArmorItems(target.inventory || []);
    const inventoryForRoll = normalizedInventory.items;
    if (normalizedInventory.changed) {
      const { error: updateError } = await supabase
        .from("characters")
        .update({ inventory: inventoryForRoll })
        .eq("id", tokenId);
      if (updateError) {
        console.error("Failed to reset player armor effective bonus:", updateError);
      }
      if (character?.id === tokenId) {
        updateCharacter({ inventory: inventoryForRoll });
      }
    }
    const equipped = findEquipped(inventoryForRoll, target.equipment_slots || null);
    let reduction = 0;
    reduction += rollArmorDice(equipped.helmetDice);
    if (reduction < preArmorDamage) reduction += rollArmorDice(equipped.armorDice);
    return Math.max(0, Math.min(preArmorDamage, reduction));
  };

  const applyFlameDamageToToken = async (
    tokenId: string,
    intensity: number
  ): Promise<{ damage: number; strAfter: number; aglAfter: number }> => {
    const supabase = createClient();
    const rolledDamage = rollD6Pool(Math.max(0, Math.trunc(intensity))).filter((value) => value === 6).length;
    if (rolledDamage <= 0) {
      return { damage: 0, strAfter: 0, aglAfter: 0 };
    }
    const armorReduction = await rollFlameArmorReduction(tokenId, rolledDamage);
    const damage = Math.max(0, rolledDamage - armorReduction);
    if (damage <= 0) {
      return { damage: 0, strAfter: 0, aglAfter: 0 };
    }

    if (tokenId.startsWith("monster:")) {
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_monsters, initiative_entries")
        .eq("id", 1)
        .maybeSingle<{
          initiative_monsters: Array<{ id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
          initiative_entries: Array<{
            participant_id: string;
            prone?: boolean | null;
            monster_snapshot?: Record<string, unknown> | null;
          }> | null;
        }>();
      if (combatError || !combatState) {
        if (combatError) console.error("Failed to load monster for flame damage:", combatError);
        return { damage: 0, strAfter: 0, aglAfter: 0 };
      }
      const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
      const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
      const entry = entries.find((item) => item.participant_id === tokenId);
      const snap = (entry?.monster_snapshot ||
        monsters.find((item) => item.id === tokenId)?.monster_snapshot ||
        {}) as { str?: number; agl?: number };
      const nextStr = Math.max(0, Number(snap.str ?? 0) - damage);
      const nextAgl = Math.max(0, Number(snap.agl ?? 0));

      const nextMonsters = monsters.map((monster) =>
        monster.id === tokenId
          ? {
              ...monster,
              monster_snapshot: {
                ...(monster.monster_snapshot || {}),
                str: nextStr,
              },
            }
          : monster
      );
      const nextEntries = entries.map((item) =>
        item.participant_id === tokenId
          ? {
              ...item,
              prone: nextStr <= 0 || nextAgl <= 0 ? true : item.prone,
              monster_snapshot: {
                ...(item.monster_snapshot || {}),
                str: nextStr,
              },
            }
          : item
      );
      const { error: updateError } = await supabase
        .from("combat_state")
        .update({ initiative_monsters: nextMonsters, initiative_entries: nextEntries })
        .eq("id", 1);
      if (updateError) {
        console.error("Failed to apply monster flame damage:", updateError);
        return { damage: 0, strAfter: 0, aglAfter: 0 };
      }
      return { damage, strAfter: nextStr, aglAfter: nextAgl };
    }

    const { data: target, error: targetError } = await supabase
      .from("characters")
      .select("id, attributes, spirits")
      .eq("id", tokenId)
      .maybeSingle<{ id: string; attributes: Attributes; spirits: number }>();
    if (targetError || !target) {
      if (targetError) console.error("Failed to load player for flame damage:", targetError);
      return { damage: 0, strAfter: 0, aglAfter: 0 };
    }
    const nextAttributes: Attributes = {
      ...target.attributes,
      STR: Math.max(0, (target.attributes.STR ?? 0) - damage),
    };
    const shouldZeroSpirits = Object.values(nextAttributes).some((value) => value <= 0);
    const updates: Partial<CharacterType> = shouldZeroSpirits
      ? { attributes: nextAttributes, spirits: 0 }
      : { attributes: nextAttributes };
    const { error: updateError } = await supabase
      .from("characters")
      .update(updates)
      .eq("id", tokenId);
    if (updateError) {
      console.error("Failed to apply player flame damage:", updateError);
      return { damage: 0, strAfter: 0, aglAfter: 0 };
    }
    if (character?.id === tokenId) {
      updateCharacter(updates);
    }
    if ((nextAttributes.STR ?? 0) <= 0 || (nextAttributes.AGL ?? 0) <= 0) {
      const { data: combatState } = await supabase
        .from("combat_state")
        .select("initiative_entries")
        .eq("id", 1)
        .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
      const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
      if (entries.length > 0) {
        const nextEntries = entries.map((entry) => {
          const participantId = String(entry.participant_id ?? "");
          if (participantId !== tokenId && participantId !== `player:${tokenId}`) return entry;
          return { ...entry, prone: true };
        });
        await supabase.from("combat_state").update({ initiative_entries: nextEntries }).eq("id", 1);
      }
    }
    return {
      damage,
      strAfter: Math.max(0, nextAttributes.STR ?? 0),
      aglAfter: Math.max(0, nextAttributes.AGL ?? 0),
    };
  };

  const applyFlameTag = async (tokenId: string, intensity: number) => {
    const existingIntensity = await getFlameIntensityForToken(tokenId);
    const applied = await applyFlameDamageToToken(tokenId, intensity);
    if (applied.damage <= 0 || applied.strAfter <= 0) {
      if (existingIntensity <= 0) {
        await setFlameIntensityForToken(tokenId, null);
      }
      return;
    }
    const nextFromNewHit = Math.min(FLAME_MAX_INTENSITY, applied.damage + 1);
    const nextIntensity = existingIntensity > 0 ? Math.max(existingIntensity, nextFromNewHit) : nextFromNewHit;
    await setFlameIntensityForToken(tokenId, nextIntensity);
  };

  const applyFlameTickForToken = async (tokenId: string) => {
    const currentIntensity = await getFlameIntensityForToken(tokenId);
    if (currentIntensity <= 0) return;
    const applied = await applyFlameDamageToToken(tokenId, currentIntensity);
    if (applied.damage <= 0 || applied.strAfter <= 0) {
      await setFlameIntensityForToken(tokenId, null);
      return;
    }
    await setFlameIntensityForToken(tokenId, Math.min(FLAME_MAX_INTENSITY, applied.damage + 1));
  };

  const applyFlameContactFromTo = async (fromTokenId: string, toTokenId: string) => {
    const intensity = await getFlameIntensityForToken(fromTokenId);
    if (intensity <= 0) return;
    await applyFlameTag(toTokenId, intensity);
  };

  const onApplyStartOfTurnEffects = async (tokenId: string) => {
    await applyFlameTickForToken(tokenId);
  };

  const resolveMeleeAttack = async (attack: ResolvedMeleeAttack) => {
    const successes = Math.max(0, attack.totalSuccesses);
    const requiredSuccesses = Math.max(1, attack.requiredSuccesses ?? 1);
    const supabase = createClient();
    const didSucceed = successes >= requiredSuccesses;
    const reactionEligibleManeuvers = new Set<ResolvedMeleeAttack["maneuver"]>([
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
    const isBroken = (attributes: Attributes | null | undefined): boolean => {
      if (!attributes) return false;
      return (
        (attributes.STR ?? 0) <= 0 ||
        (attributes.AGL ?? 0) <= 0 ||
        (attributes.WIT ?? 0) <= 0 ||
        (attributes.EMP ?? 0) <= 0
      );
    };
    const hasArtId = (artId: string, source: {
      known_art_ids?: string[] | null;
      equipped_art_ids?: string[] | null;
      arts?: Art[] | null;
      equipped_arts?: Art[] | null;
    } | null | undefined): boolean => {
      if (!source) return false;
      if ((source.known_art_ids || []).includes(artId)) return true;
      if ((source.equipped_art_ids || []).includes(artId)) return true;
      if ((source.arts || []).some((art) => art?.id === artId)) return true;
      if ((source.equipped_arts || []).some((art) => art?.id === artId)) return true;
      return false;
    };
    const equippedSunderTargets = (
      items: InventoryItem[],
      slots?: EquipmentSlots | null
    ): Array<{ itemId: string; itemName: string; slot: "left" | "right" | "armor" | "helmet" }> => {
      const slotValues = slots || { left: null, right: null, armor: null, helmet: null };
      const out: Array<{ itemId: string; itemName: string; slot: "left" | "right" | "armor" | "helmet" }> = [];
      const seen = new Set<string>();
      const addSlotItem = (slot: "left" | "right" | "armor" | "helmet") => {
        const value = slotValues[slot];
        if (!value) return;
        const item = items.find((entry) => entry.id === value || entry.name === value);
        if (!item || !item.id || seen.has(item.id)) return;
        if (Math.max(0, Math.trunc(item.gearBonus ?? 0)) <= 0) return;
        seen.add(item.id);
        out.push({ itemId: item.id, itemName: item.name, slot });
      };
      addSlotItem("left");
      addSlotItem("right");
      addSlotItem("armor");
      addSlotItem("helmet");
      return out;
    };
    const rollArmorDice = (count: number): { dice: number[]; successes: number } => {
      const dice = Array.from({ length: Math.max(0, count) }, () => Math.floor(Math.random() * 6) + 1);
      const successes = dice.filter((d) => d === 6).length;
      return { dice, successes };
    };
    const findEquippedArmor = (
      inventory: InventoryItem[],
      slots?: { armor?: string | null; helmet?: string | null }
    ) => {
      const resolvedSlots = slots || { armor: null, helmet: null };
      const matchesSlot = (slotValue: string | null | undefined, item: InventoryItem) =>
        slotValue && (slotValue === item.id || slotValue === item.name);
      const armor = inventory.find((item) => item.item_type === "Armor" && matchesSlot(resolvedSlots.armor, item)) || null;
      const helmet =
        inventory.find((item) => item.item_type === "Helmet" && matchesSlot(resolvedSlots.helmet, item)) || null;
      return { armor, helmet };
    };
    const armorPartsForCharacter = (target: {
      inventory?: InventoryItem[] | null;
      equipment_slots?: { armor?: string | null; helmet?: string | null; armor_ask?: boolean } | null;
    }) => {
      const inventory = target.inventory || [];
      const slots = target.equipment_slots || { armor: null, helmet: null, armor_ask: true };
      const { armor, helmet } = findEquippedArmor(inventory, slots);
      return {
        armor,
        helmet,
        armorDice: effectiveArmorDiceForItem(armor),
        helmetDice: effectiveArmorDiceForItem(helmet),
        ask: slots.armor_ask !== false,
      };
    };
    const armorPartsForMonster = (
      snapshot: {
      natural_armor?: number;
      gear?: InventoryItem[];
      equipment_slots?: any;
      },
      naturalArmorMultiplier: number = 1
    ) => {
      const gear = snapshot.gear || [];
      const slots = snapshot.equipment_slots || { armor: null, helmet: null };
      const { armor, helmet } = findEquippedArmor(gear, slots);
      return {
        armor,
        helmet,
        armorDice: effectiveArmorDiceForItem(armor),
        helmetDice: effectiveArmorDiceForItem(helmet),
        naturalArmorDice: Math.max(0, Math.trunc((snapshot.natural_armor ?? 0) * Math.max(0, naturalArmorMultiplier))),
      };
    };
    const shouldOfferReaction =
      !attack.skipReaction &&
      successes > 0 &&
      reactionEligibleManeuvers.has(attack.maneuver);
    const attackerHasLitFlamingLongsword = async (): Promise<boolean> => {
      if (!(attack.maneuver === "Slash" || attack.maneuver === "Stab" || attack.maneuver === "Strike")) {
        return false;
      }
      if ((attack.weaponName || "").trim().toLowerCase() !== "flaming longsword") {
        return false;
      }
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_entries")
        .eq("id", 1)
        .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
      if (combatError) {
        console.error("Failed to load attacker flags for flame:", combatError);
        return false;
      }
      const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
      const attackerEntry = entries.find((entry) => {
        const participantId = String(entry.participant_id ?? "");
        return participantId === attack.attackerCharacterId || participantId === `player:${attack.attackerCharacterId}`;
      });
      const flags = Array.isArray(attackerEntry?.used_item_flags)
        ? attackerEntry!.used_item_flags.filter((value): value is string => typeof value === "string")
        : [];
      return flags.includes(FLAMING_LONGSWORD_USED_FLAG);
    };
    const isEngagedStrikeContact = async (): Promise<boolean> => {
      if (attack.maneuver !== "Strike" || attack.weaponName !== "Strike") return false;
      if (!attack.attackerCharacterId.startsWith("monster:")) return true;
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_entries")
        .eq("id", 1)
        .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
      if (combatError) {
        console.error("Failed to load strike range for flame contact:", combatError);
        return false;
      }
      const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
      const attackerEntry = entries.find((entry) => String(entry.participant_id ?? "") === attack.attackerCharacterId);
      const rangeBand = String((attackerEntry?.monster_snapshot as Record<string, unknown> | undefined)?.range_band ?? "")
        .trim()
        .toLowerCase();
      return rangeBand === "engaged";
    };
    const isWoodenHeadArrow = (ammo: InventoryItem | null | undefined): boolean => {
      if (!ammo) return false;
      const normalizedName = String(ammo.name || "").trim().toLowerCase();
      const normalizedKey = String(ammo.item_key || "").trim().toLowerCase();
      return normalizedName === "arrow (wooden head)" || normalizedKey === "arrow (wooden head)";
    };
    const isShortOrGreaterRangeBand = (rangeBand: string | null | undefined): boolean => {
      const normalized = String(rangeBand || "").trim().toLowerCase();
      return normalized === "short" || normalized === "close" || normalized === "long" || normalized === "distant";
    };
    const isStrikeWithShortOrGreaterDefaultRange = async (): Promise<boolean> => {
      if (attack.maneuver !== "Strike") return false;
      const weaponName = String(attack.weaponName || "").trim().toLowerCase();
      if (attack.attackerCharacterId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{ id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
            initiative_entries: Array<{ participant_id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) {
            console.error("Failed to load attacker monster range for strike:", combatError);
          }
          return false;
        }
        const entry = (combatState.initiative_entries || []).find((item) => item.participant_id === attack.attackerCharacterId);
        const monster = (combatState.initiative_monsters || []).find((item) => item.id === attack.attackerCharacterId);
        const snapshot = (entry?.monster_snapshot || monster?.monster_snapshot || {}) as {
          range_band?: string;
          gear?: InventoryItem[];
        };
        let defaultRangeBand: string | null = null;
        if (weaponName === "strike") {
          defaultRangeBand = String(snapshot.range_band || "").trim() || null;
        } else {
          const match = (snapshot.gear || []).find(
            (item) => String(item.name || "").trim().toLowerCase() === weaponName
          );
          defaultRangeBand = match?.range_band ?? null;
        }
        return isShortOrGreaterRangeBand(defaultRangeBand);
      }
      if (weaponName === "strike") {
        return false;
      }
      const { data: attacker, error: attackerError } = await supabase
        .from("characters")
        .select("id, inventory")
        .eq("id", attack.attackerCharacterId)
        .maybeSingle<{ id: string; inventory?: InventoryItem[] | null }>();
      if (attackerError || !attacker) {
        if (attackerError) {
          console.error("Failed to load attacker range for strike:", attackerError);
        }
        return false;
      }
      const match = (attacker.inventory || []).find(
        (item) => String(item.name || "").trim().toLowerCase() === weaponName
      );
      return isShortOrGreaterRangeBand(match?.range_band ?? null);
    };

    if (attack.maneuver === "Heal") {
      const healAttribute = attack.healAttribute;
      if (!healAttribute) return;
      const healAmount = Math.max(0, successes);
      if (healAmount <= 0) return;

      if (attack.targetCharacterId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{
              id: string;
              monster_snapshot?: Record<string, unknown> | null;
            }> | null;
            initiative_entries: Array<{
              participant_id: string;
              monster_snapshot?: Record<string, unknown> | null;
            }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) console.error("Failed to load combat state for heal:", combatError);
          return;
        }

        const entry = (combatState.initiative_entries || []).find(
          (item) => item.participant_id === attack.targetCharacterId
        );
        const snapshot =
          (entry?.monster_snapshot as Record<string, number> | null | undefined) ||
          (combatState.initiative_monsters || []).find((m) => m.id === attack.targetCharacterId)
            ?.monster_snapshot;
        if (!snapshot) return;

        const attrKey = healAttribute.toLowerCase();
        const currentValue = Math.max(0, Number(snapshot[attrKey] ?? 0));
        const baseMax =
          healAttribute === "STR" || healAttribute === "AGL"
            ? Math.max(0, Number(snapshot.physical ?? 0) * 2)
            : Math.max(0, Number(snapshot.mental ?? 0) * 2);
        const maxValue = Math.max(baseMax, currentValue);
        const nextValue = Math.min(maxValue, currentValue + healAmount);

        const nextMonsters = (combatState.initiative_monsters || []).map((monster) => {
          if (monster.id !== attack.targetCharacterId || !monster.monster_snapshot) return monster;
          return {
            ...monster,
            monster_snapshot: {
              ...monster.monster_snapshot,
              [attrKey]: nextValue,
            },
          };
        });

        const nextEntries = (combatState.initiative_entries || []).map((item) => {
          if (item.participant_id !== attack.targetCharacterId || !item.monster_snapshot) return item;
          return {
            ...item,
            monster_snapshot: {
              ...(item.monster_snapshot as Record<string, number>),
              [attrKey]: nextValue,
            },
          };
        });

        const { error: updateError } = await supabase
          .from("combat_state")
          .update({
            initiative_monsters: nextMonsters,
            initiative_entries: nextEntries,
          })
          .eq("id", 1);
        if (updateError) {
          console.error("Failed to apply monster heal:", updateError);
        }
        return;
      }

      const { data: target, error: targetError } = await supabase
        .from("characters")
        .select("id, attributes, max_attributes")
        .eq("id", attack.targetCharacterId)
        .maybeSingle<{ id: string; attributes: Attributes; max_attributes?: Attributes }>();
      if (targetError || !target) {
        if (targetError) console.error("Failed to load heal target:", targetError);
        return;
      }

      const maxAttributes = target.max_attributes || target.attributes;
      const currentValue = Math.max(0, target.attributes[healAttribute] ?? 0);
      const maxValue = Math.max(0, maxAttributes[healAttribute] ?? 0);
      const nextValue = Math.min(maxValue, currentValue + healAmount);
      const nextAttributes: Attributes = {
        ...target.attributes,
        [healAttribute]: nextValue,
      };

      const { error: updateError } = await supabase
        .from("characters")
        .update({ attributes: nextAttributes })
        .eq("id", attack.targetCharacterId);
      if (updateError) {
        console.error("Failed to apply heal:", updateError);
        return;
      }
      if (character?.id === attack.targetCharacterId) {
        updateCharacter({ attributes: nextAttributes });
      }
      return;
    }

    if (attack.maneuver === "Taunt (Anger)" || attack.maneuver === "Taunt (Distract)") {
      const tauntMode: "anger" | "distract" =
        attack.maneuver === "Taunt (Anger)" ? "anger" : "distract";
      const tauntSuccesses = Math.max(1, successes);
      const attackerName = attack.attackerName ?? attack.attackerCharacterId;
      const tauntPayload = {
        mode: tauntMode,
        attackerCharacterId: attack.attackerCharacterId,
        attackerName,
        targetCharacterId: attack.targetCharacterId,
        successes: tauntSuccesses,
      };

      if (attack.targetCharacterId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_entries: Array<{
              participant_id: string;
              monster_snapshot?: { wit?: number | null; special?: number | null } | null;
            }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) console.error("Failed to load taunt target:", combatError);
          return;
        }
        const entry = (combatState.initiative_entries || []).find(
          (item) => item.participant_id === attack.targetCharacterId
        );
        const snapshot = entry?.monster_snapshot;
        const witValue = Math.max(0, Number(snapshot?.wit ?? 0));
        const specialValue = Math.max(0, Number(snapshot?.special ?? 0));
        if (witValue > 0) {
          const insightSuccesses =
            rollD6Pool(witValue).filter((d) => d === 6).length +
            rollD6Pool(specialValue).filter((d) => d === 6).length;
          const remaining = Math.max(0, tauntSuccesses - insightSuccesses);
          await applyTauntToCombatState({
            ...tauntPayload,
            remainingSuccesses: remaining,
          });
        } else {
          await applyTauntToCombatState({
            ...tauntPayload,
            remainingSuccesses: tauntSuccesses,
          });
        }
        return;
      }

      const { data: target, error: targetError } = await supabase
        .from("characters")
        .select("id, attributes")
        .eq("id", attack.targetCharacterId)
        .maybeSingle<{ id: string; attributes: Attributes | null }>();
      if (targetError || !target) {
        if (targetError) console.error("Failed to load taunt target:", targetError);
        return;
      }
      const witValue = Math.max(0, target.attributes?.WIT ?? 0);
      if (witValue > 0) {
        queueReactionRoll({
          id: `insight:${attack.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          reactionId: `insight:${attack.id}`,
          targetCharacterId: attack.targetCharacterId,
          mode: "insight",
          rollType: "insight",
          rollAttribute: "WIT",
          rollSkill: "INSIGHT",
          bonusDice: 0,
          taunt: tauntPayload,
        });
      } else {
        await applyTauntToCombatState({
          ...tauntPayload,
          remainingSuccesses: tauntSuccesses,
        });
      }
      return;
    }

    if (attack.maneuver === "Snuff") {
      if (didSucceed) {
        await setFlameIntensityForToken(attack.targetCharacterId, null);
      }
      return;
    }

    if (shouldOfferReaction) {
      const { data: combatState } = await supabase
        .from("combat_state")
        .select("combat_mode, initiative_entries, pending_reactions")
        .eq("id", 1)
        .maybeSingle<{
          combat_mode?: boolean | null;
          initiative_entries: Array<{
            participant_id: string;
            fast_available?: boolean | null;
            prone?: boolean | null;
            grappled_by_id?: string | null;
            clung_onto_by_id?: string | null;
            clung_onto_by_ids?: string[] | null;
            dead?: boolean | null;
            kind?: "player" | "monster" | null;
            monster_snapshot?: {
              str?: number | null;
              agl?: number | null;
              wit?: number | null;
              emp?: number | null;
              dead?: boolean | null;
            } | null;
          }> | null;
          pending_reactions?: Array<{ id?: string; attackId?: string; targetCharacterId?: string }> | null;
        }>();

      const entries = Array.isArray(combatState?.initiative_entries) ? combatState!.initiative_entries : [];
      const pending = Array.isArray(combatState?.pending_reactions) ? combatState!.pending_reactions : [];
      const existingForAttack = pending.some((reaction) => reaction?.attackId === attack.id);

      if (!existingForAttack && combatState?.combat_mode) {
        const entry = entries.find(
          (e) =>
            e.participant_id === attack.targetCharacterId ||
            e.participant_id === `player:${attack.targetCharacterId}`
        );
        const fastAvailable = entry ? (entry.fast_available ?? true) : false;
        const isProne = Boolean(entry?.prone);
        const isHeld =
          Boolean(entry?.grappled_by_id) ||
          Boolean(entry?.clung_onto_by_id) ||
          Boolean((entry?.clung_onto_by_ids || []).length > 0);
        const isEntryDead = Boolean(entry?.dead || entry?.monster_snapshot?.dead);
        const isMonsterTarget = attack.targetCharacterId.startsWith("monster:");
        let canReact = fastAvailable && !isProne && !isHeld && !isEntryDead;
        if (canReact && isMonsterTarget) {
          const snap = entry?.monster_snapshot;
          if (snap) {
            const broken =
              (snap.str ?? 0) <= 0 || (snap.agl ?? 0) <= 0 || (snap.wit ?? 0) <= 0 || (snap.emp ?? 0) <= 0;
            if (broken) canReact = false;
          }
        }
        if (canReact && !isMonsterTarget) {
          const { data: targetCharacter } = await supabase
            .from("characters")
            .select("id, attributes, dead")
            .eq("id", attack.targetCharacterId)
            .maybeSingle<{ id: string; attributes: Attributes | null; dead?: boolean | null }>();
          const isTargetDead = Boolean(targetCharacter?.dead);
          if (isTargetDead || isBroken(targetCharacter?.attributes)) {
            canReact = false;
          }
        }

        if (canReact) {
          const reactionPayload = {
            id: `reaction:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            attackId: attack.id,
            attackerCharacterId: attack.attackerCharacterId,
            targetCharacterId: attack.targetCharacterId,
            weaponName: attack.weaponName,
            weaponBaseDamage: attack.weaponBaseDamage,
            maneuver: attack.maneuver,
            totalSuccesses: successes,
            requiredSuccesses,
            swingBonusDamage: attack.swingBonusDamage ?? 0,
            disarmTargetItemId: attack.disarmTargetItemId ?? null,
            disarmZoneId: attack.disarmZoneId ?? null,
            destinationX: attack.destinationX ?? null,
            destinationY: attack.destinationY ?? null,
            shootTargetZoneId: attack.shootTargetZoneId ?? null,
            shootAmmoItem: attack.shootAmmoItem ?? null,
            rangeAtAttack: attack.rangeAtAttack ?? null,
            createdAt: new Date().toISOString(),
          };
          const { error: reactionError } = await supabase.rpc("combat_enqueue_reaction", {
            p_reaction: reactionPayload,
          });
          if (!reactionError) {
            return;
          }
          console.error("Failed to enqueue reaction:", reactionError);
        }
      }
    }
    const pruneBrokenOnlyEngagements = async () => {
      const { error: pruneError } = await supabase.rpc("combat_prune_fully_broken_engagements");
      if (pruneError) {
        console.error("Failed to prune broken/dead-only engagements:", pruneError);
      }
    };

    const removeParticipantFromCombat = async (tokenId: string) => {
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_entries, initiative_current_index, initiative_monsters, token_positions, engagements")
        .eq("id", 1)
        .maybeSingle<{
          initiative_entries: Array<{ participant_id: string }> | null;
          initiative_current_index: number | null;
          initiative_monsters: Array<{ id: string }> | null;
          token_positions: Array<{ character_id: string }> | null;
          engagements: Array<{ a: string; b: string }> | null;
        }>();
      if (combatError || !combatState) {
        if (combatError) console.error("Failed to load combat state for flee:", combatError);
        return;
      }

      const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
      const tokens = Array.isArray(combatState.token_positions) ? combatState.token_positions : [];
      const edges = Array.isArray(combatState.engagements) ? combatState.engagements : [];
      const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
      const isMonster = tokenId.startsWith("monster:");
      const participantId = isMonster ? tokenId : `player:${tokenId}`;
      const removedEntryIndex = entries.findIndex((entry) => entry.participant_id === participantId);
      const nextEntries = entries.filter((entry) => entry.participant_id !== participantId);
      const nextTokens = tokens.filter((token) => token.character_id !== tokenId);
      const nextEdges = edges.filter((edge) => edge.a !== tokenId && edge.b !== tokenId);
      const nextMonsters = isMonster ? monsters.filter((monster) => monster.id !== tokenId) : monsters;

      let nextCurrent = combatState.initiative_current_index;
      if (nextEntries.length === 0) {
        nextCurrent = null;
      } else if (nextCurrent !== null) {
        if (removedEntryIndex === nextCurrent) {
          nextCurrent = nextCurrent >= nextEntries.length ? 0 : nextCurrent;
        } else if (removedEntryIndex >= 0 && removedEntryIndex < nextCurrent) {
          nextCurrent = nextCurrent - 1;
        }
      }

      const { error: updateError } = await supabase
        .from("combat_state")
        .update({
          initiative_entries: nextEntries,
          initiative_current_index: nextCurrent,
          initiative_monsters: nextMonsters,
          token_positions: nextTokens,
          engagements: nextEdges,
        })
        .eq("id", 1);
      if (updateError) {
        console.error("Failed to remove participant from combat:", updateError);
      }
    };

    const markTargetDead = async (targetTokenId: string) => {
      if (targetTokenId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{
              id: string;
              monster_snapshot?: Record<string, unknown> | null;
            }> | null;
            initiative_entries: Array<{
              participant_id: string;
              kind?: "player" | "monster";
              monster_snapshot?: Record<string, unknown> | null;
              dead?: boolean | null;
              prone?: boolean | null;
            }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) console.error("Failed to load combat state for death update:", combatError);
          return;
        }

        const nextMonsters = (combatState.initiative_monsters || []).map((monster) => {
          if (monster.id !== targetTokenId || !monster.monster_snapshot) return monster;
          return {
            ...monster,
            monster_snapshot: {
              ...monster.monster_snapshot,
              dead: true,
            },
          };
        });

        const nextEntries = (combatState.initiative_entries || []).map((entry) => {
          if (entry.participant_id !== targetTokenId) return entry;
          return {
            ...entry,
            dead: true,
            prone: true,
            monster_snapshot: entry.monster_snapshot
              ? {
                  ...entry.monster_snapshot,
                  dead: true,
                }
              : entry.monster_snapshot,
          };
        });

        const { error: updateError } = await supabase
          .from("combat_state")
          .update({
            initiative_monsters: nextMonsters,
            initiative_entries: nextEntries,
          })
          .eq("id", 1);
        if (updateError) {
          console.error("Failed to mark monster dead:", updateError);
        }
        return;
      }

      const { error: updateError } = await supabase
        .from("characters")
        .update({ dead: true })
        .eq("id", targetTokenId);
      if (updateError) {
        console.error("Failed to mark character dead:", updateError);
      }
      if (character?.id === targetTokenId) {
        updateCharacter({ dead: true });
      }
      const { data: combatState } = await supabase
        .from("combat_state")
        .select("initiative_entries")
        .eq("id", 1)
        .maybeSingle<{ initiative_entries: Array<Record<string, unknown>> | null }>();
      const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
      if (entries.length > 0) {
        const nextEntries = entries.map((entry) => {
          const participantId = String(entry.participant_id ?? "");
          if (participantId !== targetTokenId && participantId !== `player:${targetTokenId}`) {
            return entry;
          }
          return {
            ...entry,
            dead: true,
            prone: true,
          };
        });
        await supabase
          .from("combat_state")
          .update({ initiative_entries: nextEntries })
          .eq("id", 1);
      }
    };

    const applyCoupActorCost = async (actorTokenId: string) => {
      if (actorTokenId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{
              id: string;
              monster_snapshot?: Record<string, unknown> | null;
            }> | null;
            initiative_entries: Array<{
              participant_id: string;
              monster_snapshot?: Record<string, unknown> | null;
            }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) console.error("Failed to load combat state for coup cost:", combatError);
          return;
        }

        const nextMonsters = (combatState.initiative_monsters || []).map((monster) => {
          if (monster.id !== actorTokenId || !monster.monster_snapshot) return monster;
          const currEmp = Number(monster.monster_snapshot.emp ?? 0);
          const currSpirits = Number(
            monster.monster_snapshot.spirits_current ?? monster.monster_snapshot.starting_spirits ?? 0
          );
          return {
            ...monster,
            monster_snapshot: {
              ...monster.monster_snapshot,
              emp: Math.max(0, currEmp - 1),
              spirits_current: Math.max(0, currSpirits - 1),
            },
          };
        });

        const nextEntries = (combatState.initiative_entries || []).map((entry) => {
          if (entry.participant_id !== actorTokenId || !entry.monster_snapshot) return entry;
          const currEmp = Number(entry.monster_snapshot.emp ?? 0);
          const currSpirits = Number(
            entry.monster_snapshot.spirits_current ?? entry.monster_snapshot.starting_spirits ?? 0
          );
          return {
            ...entry,
            monster_snapshot: {
              ...entry.monster_snapshot,
              emp: Math.max(0, currEmp - 1),
              spirits_current: Math.max(0, currSpirits - 1),
            },
          };
        });

        const { error: updateError } = await supabase
          .from("combat_state")
          .update({
            initiative_monsters: nextMonsters,
            initiative_entries: nextEntries,
          })
          .eq("id", 1);
        if (updateError) {
          console.error("Failed to apply coup cost to monster:", updateError);
        }
        return;
      }

      const { data: actor, error: actorError } = await supabase
        .from("characters")
        .select("id, attributes, spirits")
        .eq("id", actorTokenId)
        .maybeSingle<{ id: string; attributes: Attributes; spirits: number }>();
      if (actorError || !actor) {
        if (actorError) console.error("Failed to load coup actor:", actorError);
        return;
      }
      const nextAttributes: Attributes = {
        ...actor.attributes,
        EMP: Math.max(0, (actor.attributes.EMP ?? 0) - 1),
      };
      const nextSpirits = Math.max(0, (actor.spirits ?? 0) - 1);
      const { error: updateError } = await supabase
        .from("characters")
        .update({ attributes: nextAttributes, spirits: nextSpirits })
        .eq("id", actorTokenId);
      if (updateError) {
        console.error("Failed to apply coup cost to character:", updateError);
        return;
      }
      if (character?.id === actorTokenId) {
        updateCharacter({ attributes: nextAttributes, spirits: nextSpirits });
      }
    };

    if (attack.maneuver === "Retreat") {
      if (!didSucceed) return;
      const { error: retreatError } = await supabase.rpc("combat_break_engagement_token", {
        p_actor_token_id: attack.attackerCharacterId,
      });
      if (retreatError) {
        console.error("Failed to resolve retreat:", retreatError);
      }
      return;
    }

    if (attack.maneuver === "Flee") {
      if (!didSucceed) return;
      await removeParticipantFromCombat(attack.attackerCharacterId);
      return;
    }

    if (attack.maneuver === "Shove") {
      const { error: shoveError } = await supabase.rpc("combat_resolve_shove", {
        p_actor_token_id: attack.attackerCharacterId,
        p_target_token_id: attack.targetCharacterId,
        p_success: didSucceed,
      });
      if (shoveError) {
        console.error("Failed to resolve shove:", shoveError);
      }
      return;
    }

    if (attack.maneuver === "Disarm") {
      if (!attack.disarmTargetItemId || attack.disarmZoneId === null || attack.disarmZoneId === undefined) {
        return;
      }
      const { error: disarmError } = await supabase.rpc("combat_resolve_disarm", {
        p_actor_token_id: attack.attackerCharacterId,
        p_target_token_id: attack.targetCharacterId,
        p_target_item_id: attack.disarmTargetItemId,
        p_zone_id: attack.disarmZoneId,
        p_success: didSucceed,
      });
      if (disarmError) {
        console.error(
          "Failed to resolve disarm:",
          disarmError.message || disarmError.details || JSON.stringify(disarmError)
        );
      }
      return;
    }

    if (attack.maneuver === "Grapple" || attack.maneuver === "Cling") {
      const zoneId = attack.disarmZoneId ?? 1;
      const { error: grappleError } = await supabase.rpc("combat_resolve_grapple_or_cling", {
        p_actor_token_id: attack.attackerCharacterId,
        p_target_token_id: attack.targetCharacterId,
        p_mode: attack.maneuver === "Grapple" ? "grapple" : "cling",
        p_success: didSucceed,
        p_zone_id: zoneId,
      });
      if (grappleError) {
        console.error("Failed to resolve grapple/cling:", grappleError);
      }
      if (didSucceed) {
        await applyFlameContactFromTo(attack.targetCharacterId, attack.attackerCharacterId);
        await applyFlameContactFromTo(attack.attackerCharacterId, attack.targetCharacterId);
      }
      return;
    }

    if (attack.maneuver === "Break Free") {
      const { error: breakFreeError } = await supabase.rpc("combat_break_free", {
        p_actor_token_id: attack.attackerCharacterId,
        p_other_token_id: attack.targetCharacterId,
        p_success: didSucceed,
      });
      if (breakFreeError) {
        console.error("Failed to resolve break free:", breakFreeError);
      }
      return;
    }

    if (attack.maneuver === "Feint") {
      const { error: feintError } = await supabase.rpc("combat_apply_feint", {
        p_actor_token_id: attack.attackerCharacterId,
        p_target_token_id: attack.targetCharacterId,
      });
      if (feintError) {
        console.error("Failed to apply feint:", feintError);
      }
      return;
    }

    if (attack.maneuver === "Crawl") {
      if (!didSucceed) return;
      if (
        typeof attack.destinationX !== "number" ||
        typeof attack.destinationY !== "number" ||
        attack.destinationX < 0 ||
        attack.destinationX > 1 ||
        attack.destinationY < 0 ||
        attack.destinationY > 1
      ) {
        return;
      }
      const { error: crawlError } = await supabase.rpc("combat_crawl_token", {
        p_actor_token_id: attack.attackerCharacterId,
        p_x: attack.destinationX,
        p_y: attack.destinationY,
      });
      if (crawlError) {
        console.error("Failed to resolve crawl:", crawlError);
      }
      return;
    }

    if (attack.maneuver === "Coup de Grace") {
      await applyCoupActorCost(attack.attackerCharacterId);
      if (didSucceed) {
        await markTargetDead(attack.targetCharacterId);
      }
      await pruneBrokenOnlyEngagements();
      return;
    }

    if (attack.maneuver === "Shoot" && !didSucceed) {
      if (
        attack.shootAmmoItem &&
        attack.shootTargetZoneId !== null &&
        attack.shootTargetZoneId !== undefined &&
        attack.shootTargetZoneId > 0
      ) {
        const { data: combatState } = await supabase
          .from("combat_state")
          .select("zone_loot")
          .eq("id", 1)
          .maybeSingle<{ zone_loot: Array<{ zone_id: number; item: InventoryItem }> | null }>();
        const nextZoneLoot = [
          ...(((combatState?.zone_loot || []) as Array<{ zone_id: number; item: InventoryItem }>)),
          { zone_id: attack.shootTargetZoneId, item: attack.shootAmmoItem },
        ];
        await supabase
          .from("combat_state")
          .update({ zone_loot: nextZoneLoot })
          .eq("id", 1);
      }
      return;
    }

    if (successes <= 0) return;
    if (
      !attack.sunderResolved &&
      (attack.maneuver === "Slash" ||
        attack.maneuver === "Stab" ||
        attack.maneuver === "Strike" ||
        attack.maneuver === "Shoot") &&
      (attack.rangeAtAttack === "Near" || attack.rangeAtAttack === "Engaged")
    ) {
      const sunderArt = artsCatalog.find((art) => art.id === "art-sunder") || null;
      const sunderCost = parseArtCost(sunderArt?.cost || "X");
      const minSpirit = Math.max(0, sunderCost.minSuccesses);
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_entries, initiative_monsters")
        .eq("id", 1)
        .maybeSingle<{
          initiative_entries: Array<{
            participant_id: string;
            kind?: "player" | "monster";
            fast_available?: boolean | null;
            prone?: boolean | null;
            covered?: boolean | null;
            dead?: boolean | null;
            grappled_by_id?: string | null;
            clung_onto_by_id?: string | null;
            clung_onto_by_ids?: string[] | null;
            monster_snapshot?: {
              str?: number | null;
              agl?: number | null;
              wit?: number | null;
              emp?: number | null;
              dead?: boolean | null;
              spirits_current?: number | null;
              starting_spirits?: number | null;
              arts?: Art[] | null;
              gear?: InventoryItem[] | null;
              equipment_slots?: EquipmentSlots | null;
            } | null;
          }> | null;
          initiative_monsters: Array<{
            id: string;
            monster_snapshot?: {
              gear?: InventoryItem[] | null;
              equipment_slots?: EquipmentSlots | null;
            } | null;
          }> | null;
        }>();
      if (!combatError && combatState) {
        const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
        const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
        const attackerEntry =
          entries.find(
            (entry) =>
              entry.participant_id === attack.attackerCharacterId ||
              entry.participant_id === `player:${attack.attackerCharacterId}`
          ) || null;
        const targetEntry =
          entries.find(
            (entry) =>
              entry.participant_id === attack.targetCharacterId ||
              entry.participant_id === `player:${attack.targetCharacterId}`
          ) || null;

        if (attackerEntry && targetEntry) {
          const attackerIsMonster =
            attack.attackerCharacterId.startsWith("monster:") || attackerEntry.kind === "monster";
          const attackerHeld =
            Boolean(attackerEntry.grappled_by_id) ||
            Boolean(attackerEntry.clung_onto_by_id) ||
            Boolean((attackerEntry.clung_onto_by_ids || []).length > 0);
          const attackerCanAct =
            attackerEntry.fast_available !== false &&
            !Boolean(attackerEntry.prone) &&
            !Boolean(attackerEntry.covered) &&
            !Boolean(attackerEntry.dead) &&
            !attackerHeld;
          let attackerHasArt = false;
          let attackerSpirits = 0;
          let attackerBroken = false;
          if (attackerIsMonster) {
            const snapshot = attackerEntry.monster_snapshot || null;
            attackerHasArt = hasArtId("art-sunder", { arts: snapshot?.arts || [] });
            attackerSpirits = Math.max(
              0,
              Number(snapshot?.spirits_current ?? snapshot?.starting_spirits ?? 0)
            );
            attackerBroken =
              Boolean(snapshot?.dead) ||
              (snapshot?.str ?? 1) <= 0 ||
              (snapshot?.agl ?? 1) <= 0 ||
              (snapshot?.wit ?? 1) <= 0 ||
              (snapshot?.emp ?? 1) <= 0;
          } else {
            const { data: attackerCharacter } = await supabase
              .from("characters")
              .select("id, spirits, dead, attributes, known_art_ids, equipped_art_ids")
              .eq("id", attack.attackerCharacterId)
              .maybeSingle<{
                id: string;
                spirits: number;
                dead?: boolean | null;
                attributes?: Attributes | null;
                known_art_ids?: string[] | null;
                equipped_art_ids?: string[] | null;
              }>();
            attackerHasArt = hasArtId("art-sunder", attackerCharacter);
            attackerSpirits = Math.max(0, Number(attackerCharacter?.spirits ?? 0));
            attackerBroken = Boolean(attackerCharacter?.dead) || isBroken(attackerCharacter?.attributes);
          }

          if (attackerCanAct && !attackerBroken && attackerHasArt && attackerSpirits >= minSpirit) {
            let options: Array<{
              itemId: string;
              itemName: string;
              slot: "left" | "right" | "armor" | "helmet";
              targetIsMonster: boolean;
            }> = [];
            const targetIsMonster =
              attack.targetCharacterId.startsWith("monster:") || targetEntry.kind === "monster";
            if (targetIsMonster) {
              const targetMonster = monsters.find((m) => m.id === attack.targetCharacterId);
              const snapshot =
                targetEntry.monster_snapshot || targetMonster?.monster_snapshot || null;
              options = equippedSunderTargets(
                (snapshot?.gear || []) as InventoryItem[],
                (snapshot?.equipment_slots || {
                  left: null,
                  right: null,
                  armor: null,
                  helmet: null,
                }) as EquipmentSlots
              ).map((item) => ({ ...item, targetIsMonster: true }));
            } else {
              const { data: targetCharacter } = await supabase
                .from("characters")
                .select("id, inventory, equipment_slots")
                .eq("id", attack.targetCharacterId)
                .maybeSingle<{
                  id: string;
                  inventory?: InventoryItem[] | null;
                  equipment_slots?: EquipmentSlots | null;
                }>();
              options = equippedSunderTargets(
                targetCharacter?.inventory || [],
                targetCharacter?.equipment_slots || { left: null, right: null, armor: null, helmet: null }
              ).map((item) => ({ ...item, targetIsMonster: false }));
            }

            if (options.length > 0) {
              setPendingSunderPrompt({
                id: `sunder-prompt:${Date.now()}:${Math.random().toString(36).slice(2)}`,
                attackerCharacterId: attack.attackerCharacterId,
                attack: {
                  ...attack,
                  skipReaction: true,
                },
                options,
              });
              return;
            }
          }
        }
      } else if (combatError) {
        console.error("Failed to load combat state for sunder prompt:", combatError);
      }
    }

    const armorUsed = {
      ...(attack.armorUsed || {}),
    };
    const armorSkipped = Boolean(attack.armorSkipped);
    let remainingSuccesses = successes;
    const applyWoodenHeadArmorBonus = attack.maneuver === "Shoot" && isWoodenHeadArrow(attack.shootAmmoItem);
    const applyChainmailPenalty =
      (
        attack.maneuver === "Shoot" ||
        attack.maneuver === "Stab" ||
        (attack.maneuver === "Strike" && (await isStrikeWithShortOrGreaterDefaultRange()))
      );
    const naturalArmorMultiplier = applyWoodenHeadArmorBonus ? 2 : 1;

    if (armorSkipped && remainingSuccesses > 0) {
      if (attack.targetCharacterId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{
              id: string;
              monster_snapshot?: {
                gear?: InventoryItem[];
              } | null;
            }> | null;
            initiative_entries: Array<{
              participant_id: string;
              monster_snapshot?: {
                gear?: InventoryItem[];
              } | null;
            }> | null;
          }>();
        if (!combatError && combatState) {
          const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
          const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
          const targetMonster = monsters.find((monster) => monster.id === attack.targetCharacterId);
          const targetEntry = entries.find((entry) => entry.participant_id === attack.targetCharacterId);
          const snapshot = targetEntry?.monster_snapshot || targetMonster?.monster_snapshot || null;
          if (snapshot) {
            const normalizedGear = resetEffectiveBonusesForArmorItems(snapshot.gear || []);
            if (normalizedGear.changed) {
              const nextMonsters = monsters.map((monster) =>
                monster.id === attack.targetCharacterId
                  ? {
                      ...monster,
                      monster_snapshot: {
                        ...(monster.monster_snapshot || {}),
                        gear: normalizedGear.items,
                      },
                    }
                  : monster
              );
              const nextEntries = entries.map((entry) =>
                entry.participant_id === attack.targetCharacterId
                  ? {
                      ...entry,
                      monster_snapshot: {
                        ...(entry.monster_snapshot || {}),
                        gear: normalizedGear.items,
                      },
                    }
                  : entry
              );
              const { error: resetError } = await supabase
                .from("combat_state")
                .update({ initiative_monsters: nextMonsters, initiative_entries: nextEntries })
                .eq("id", 1);
              if (resetError) {
                console.error("Failed to reset monster armor effective bonus after pass:", resetError);
              }
            }
          }
        }
      } else {
        const { data: target } = await supabase
          .from("characters")
          .select("id, inventory")
          .eq("id", attack.targetCharacterId)
          .maybeSingle<{
            id: string;
            inventory?: InventoryItem[] | null;
          }>();
        if (target) {
          const normalizedInventory = resetEffectiveBonusesForArmorItems(target.inventory || []);
          if (normalizedInventory.changed) {
            const { error: resetError } = await supabase
              .from("characters")
              .update({ inventory: normalizedInventory.items })
              .eq("id", attack.targetCharacterId);
            if (resetError) {
              console.error("Failed to reset player armor effective bonus after pass:", resetError);
            } else if (character?.id === attack.targetCharacterId) {
              updateCharacter({ inventory: normalizedInventory.items });
            }
          }
        }
      }
    }

    if (!armorSkipped && remainingSuccesses > 0) {
      if (attack.targetCharacterId.startsWith("monster:")) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{
              id: string;
              monster_snapshot?: {
                natural_armor?: number;
                gear?: InventoryItem[];
                equipment_slots?: { armor?: string | null; helmet?: string | null };
              } | null;
            }> | null;
            initiative_entries: Array<{
              participant_id: string;
              monster_snapshot?: {
                natural_armor?: number;
                gear?: InventoryItem[];
                equipment_slots?: { armor?: string | null; helmet?: string | null };
              } | null;
            }> | null;
          }>();
        if (!combatError && combatState) {
          const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
          const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
          const targetMonster = monsters.find((monster) => monster.id === attack.targetCharacterId);
          const targetEntry = entries.find((entry) => entry.participant_id === attack.targetCharacterId);
          const snapshot = targetEntry?.monster_snapshot || targetMonster?.monster_snapshot || null;
          if (snapshot) {
            const normalizedGear = resetEffectiveBonusesForArmorItems(snapshot.gear || []);
            const adjustedGear = applyTemporaryArmorRollEffectiveBonuses(normalizedGear.items, {
              applyChainmailPenalty,
              applyWoodenHeadBonus: applyWoodenHeadArmorBonus,
            });
            const snapshotForRoll = { ...snapshot, gear: adjustedGear.items };
            if (normalizedGear.changed || adjustedGear.changed) {
              const nextMonsters = monsters.map((monster) =>
                monster.id === attack.targetCharacterId
                  ? {
                      ...monster,
                      monster_snapshot: {
                        ...(monster.monster_snapshot || {}),
                        gear: adjustedGear.items,
                      },
                    }
                  : monster
              );
              const nextEntries = entries.map((entry) =>
                entry.participant_id === attack.targetCharacterId
                  ? {
                      ...entry,
                      monster_snapshot: {
                        ...(entry.monster_snapshot || {}),
                        gear: adjustedGear.items,
                      },
                    }
                  : entry
              );
              const { error: resetError } = await supabase
                .from("combat_state")
                .update({ initiative_monsters: nextMonsters, initiative_entries: nextEntries })
                .eq("id", 1);
              if (resetError) {
                console.error("Failed to reset monster armor effective bonus:", resetError);
              }
            }
            const { armorDice, helmetDice, naturalArmorDice } = armorPartsForMonster(
              snapshotForRoll,
              naturalArmorMultiplier
            );
            if (!armorUsed.helmet && helmetDice > 0) {
              const armorRoll = rollArmorDice(helmetDice);
              remainingSuccesses = Math.max(0, remainingSuccesses - armorRoll.successes);
              armorUsed.helmet = true;
            }
            if (remainingSuccesses > 0 && !armorUsed.armor && armorDice > 0) {
              const armorRoll = rollArmorDice(armorDice);
              remainingSuccesses = Math.max(0, remainingSuccesses - armorRoll.successes);
              armorUsed.armor = true;
            }
            if (remainingSuccesses > 0 && naturalArmorDice > 0) {
              const armorRoll = rollArmorDice(naturalArmorDice);
              remainingSuccesses = Math.max(0, remainingSuccesses - armorRoll.successes);
            }
          }
        }
      } else {
        const { data: target } = await supabase
          .from("characters")
          .select("id, inventory, equipment_slots")
          .eq("id", attack.targetCharacterId)
          .maybeSingle<{
            id: string;
            inventory?: InventoryItem[] | null;
            equipment_slots?: { armor?: string | null; helmet?: string | null; armor_ask?: boolean } | null;
          }>();
        if (target) {
          const normalizedInventory = resetEffectiveBonusesForArmorItems(target.inventory || []);
          const adjustedInventory = applyTemporaryArmorRollEffectiveBonuses(normalizedInventory.items, {
            applyChainmailPenalty,
            applyWoodenHeadBonus: applyWoodenHeadArmorBonus,
          });
          const targetForRoll = { ...target, inventory: adjustedInventory.items };
          if (normalizedInventory.changed || adjustedInventory.changed) {
            const { error: resetError } = await supabase
              .from("characters")
              .update({ inventory: adjustedInventory.items })
              .eq("id", attack.targetCharacterId);
            if (resetError) {
              console.error("Failed to reset player armor effective bonus:", resetError);
            } else if (character?.id === attack.targetCharacterId) {
              updateCharacter({ inventory: adjustedInventory.items });
            }
          }
          const { armor, helmet, armorDice, helmetDice, ask } = armorPartsForCharacter(targetForRoll);
          const canHelmet = helmetDice > 0 && !armorUsed.helmet;
          const canArmor = armorDice > 0 && !armorUsed.armor;
          if (canHelmet || canArmor) {
            const shouldPrompt = ask && character?.id === attack.targetCharacterId;
            if (shouldPrompt) {
              if (!pendingArmorPrompt || pendingArmorPrompt.attack.id !== attack.id) {
                setPendingArmorPrompt({
                  id: `armor-prompt:${Date.now()}:${Math.random().toString(36).slice(2)}`,
                  targetCharacterId: attack.targetCharacterId,
                  attack: {
                    ...attack,
                    totalSuccesses: remainingSuccesses,
                    armorUsed,
                  },
                  helmetItemId: helmet?.id ?? null,
                  helmetName: helmet?.name ?? null,
                  helmetDice,
                  armorItemId: armor?.id ?? null,
                  armorName: armor?.name ?? null,
                  armorDice,
                  armorUsed,
                });
              }
              return;
            }

            if (canHelmet) {
              const armorRoll = rollArmorDice(helmetDice);
              remainingSuccesses = Math.max(0, remainingSuccesses - armorRoll.successes);
              armorUsed.helmet = true;
            }
            if (remainingSuccesses > 0 && canArmor) {
              const armorRoll = rollArmorDice(armorDice);
              remainingSuccesses = Math.max(0, remainingSuccesses - armorRoll.successes);
              armorUsed.armor = true;
            }
          }
        }
      }
    }

    if (remainingSuccesses <= 0) return;

    const damage =
      Math.max(0, attack.weaponBaseDamage) +
      Math.max(0, remainingSuccesses - 1) +
      Math.max(0, attack.swingBonusDamage ?? 0);
    if (damage <= 0) return;

    if (attack.targetCharacterId.startsWith("monster:")) {
      const { data: combatState, error: combatError } = await supabase
        .from("combat_state")
        .select("initiative_monsters, initiative_entries")
        .eq("id", 1)
        .maybeSingle<{
          initiative_monsters: Array<{
            id: string;
            monster_snapshot?: {
              str?: number;
              agl?: number;
              natural_armor?: number;
              gear?: InventoryItem[];
              equipment_slots?: { armor?: string | null; helmet?: string | null };
            } | null;
          }> | null;
          initiative_entries: Array<{
            participant_id: string;
            monster_snapshot?: {
              str?: number;
              agl?: number;
              natural_armor?: number;
              gear?: InventoryItem[];
              equipment_slots?: { armor?: string | null; helmet?: string | null };
            } | null;
            prone?: boolean | null;
          }> | null;
        }>();

      if (combatError || !combatState) {
        if (combatError) console.error("Failed to load combat state for monster damage:", combatError);
        return;
      }

      const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
      const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
      const mitigatedDamage = damage;
      if (mitigatedDamage <= 0) return;

      const nextMonsters = monsters.map((monster) => {
        if (monster.id !== attack.targetCharacterId || !monster.monster_snapshot) return monster;
        return {
          ...monster,
          monster_snapshot: {
            ...monster.monster_snapshot,
            str: Math.max(0, (monster.monster_snapshot.str ?? 0) - mitigatedDamage),
          },
        };
      });

      const nextEntries = entries.map((entry) => {
        if (entry.participant_id !== attack.targetCharacterId || !entry.monster_snapshot) return entry;
        const nextStr = Math.max(0, (entry.monster_snapshot.str ?? 0) - mitigatedDamage);
        const nextAgl = Math.max(0, entry.monster_snapshot.agl ?? 0);
        const isPhysBroken = nextStr <= 0 || nextAgl <= 0;
        return {
          ...entry,
          prone: isPhysBroken ? true : entry.prone,
          monster_snapshot: {
            ...entry.monster_snapshot,
            str: nextStr,
          },
        };
      });

      const { error: updateCombatError } = await supabase
        .from("combat_state")
        .update({
          initiative_monsters: nextMonsters,
          initiative_entries: nextEntries,
        })
        .eq("id", 1);
      if (updateCombatError) {
        console.error("Failed to apply monster melee damage:", updateCombatError);
      }
      if (await isEngagedStrikeContact()) {
        await applyFlameContactFromTo(attack.targetCharacterId, attack.attackerCharacterId);
      }
      if (await attackerHasLitFlamingLongsword()) {
        await applyFlameTag(attack.targetCharacterId, 3);
      }
      await pruneBrokenOnlyEngagements();
      return;
    }

    const { data: target, error: targetError } = await supabase
      .from("characters")
      .select("id, attributes, spirits, inventory, equipment_slots")
      .eq("id", attack.targetCharacterId)
      .maybeSingle<{
        id: string;
        attributes: Attributes;
        spirits: number;
        inventory?: InventoryItem[] | null;
        equipment_slots?: { armor?: string | null; helmet?: string | null } | null;
      }>();

    if (targetError) {
      console.error("Failed to load attack target:", targetError);
      return;
    }

    if (!target) return;

    let mitigatedDamage = damage;
    mitigatedDamage = damage;
    if (mitigatedDamage <= 0) return;

    const nextAttributes: Attributes = {
      ...target.attributes,
      STR: Math.max(0, (target.attributes.STR ?? 0) - mitigatedDamage),
    };
    const shouldZeroSpirit = Object.values(nextAttributes).some((value) => value <= 0);
    const updates: Partial<CharacterType> = shouldZeroSpirit
      ? { attributes: nextAttributes, spirits: 0 }
      : { attributes: nextAttributes };

    const { error: updateError } = await supabase
      .from("characters")
      .update(updates)
      .eq("id", attack.targetCharacterId);
    if (updateError) {
      console.error("Failed to apply melee damage:", updateError);
      return;
    }

    if (character?.id === attack.targetCharacterId) {
      updateCharacter(updates);
    }

    if ((nextAttributes.STR ?? 0) <= 0 || (nextAttributes.AGL ?? 0) <= 0) {
      const { data: combatState } = await supabase
        .from("combat_state")
        .select("initiative_entries")
        .eq("id", 1)
        .maybeSingle<{
          initiative_entries: Array<Record<string, unknown>> | null;
        }>();
      const entries = Array.isArray(combatState?.initiative_entries) ? combatState.initiative_entries : [];
      if (entries.length > 0) {
        const nextEntries = entries.map((entry) => {
          const participantId = String(entry.participant_id ?? "");
          if (
            participantId !== attack.targetCharacterId &&
            participantId !== `player:${attack.targetCharacterId}`
          ) {
            return entry;
          }
          return {
            ...entry,
            prone: true,
          };
        });
        await supabase
          .from("combat_state")
          .update({ initiative_entries: nextEntries })
          .eq("id", 1);
      }
    }
    if (await isEngagedStrikeContact()) {
      await applyFlameContactFromTo(attack.targetCharacterId, attack.attackerCharacterId);
    }
    if (await attackerHasLitFlamingLongsword()) {
      await applyFlameTag(attack.targetCharacterId, 3);
    }
    await pruneBrokenOnlyEngagements();
  };

  const resolveReactionRoll = async (roll: ResolvedReactionRoll) => {
    const supabase = createClient();
    if (roll.rollType === "insight") {
      const taunt = roll.taunt;
      if (!taunt) return;
      const tauntSuccesses = Math.max(1, taunt.successes);
      const remaining = Math.max(0, tauntSuccesses - Math.max(0, roll.totalSuccesses));
      await applyTauntToCombatState({
        targetCharacterId: taunt.targetCharacterId,
        mode: taunt.mode,
        remainingSuccesses: remaining,
        attackerCharacterId: taunt.attackerCharacterId,
        attackerName: taunt.attackerName,
      });
      return;
    }
    if (!roll.attack) return;
    const reducedSuccesses = Math.max(0, roll.attack.totalSuccesses - Math.max(0, roll.totalSuccesses));
    const finalAttack: ResolvedMeleeAttack = {
      ...roll.attack,
      totalSuccesses: reducedSuccesses,
      skipReaction: true,
    };

    if (roll.rollType === "armor") {
      const armorUsed = {
        ...(roll.attack.armorUsed || {}),
        ...(roll.armorSlot ? { [roll.armorSlot]: true } : {}),
      };
      await resolveMeleeAttack({
        ...finalAttack,
        armorUsed,
      });
      return;
    }

    const isDodgeReaction = roll.mode === "dodge-stand" || roll.mode === "dodge-prone";
    let usedFreeDodge = false;
    if (isDodgeReaction) {
      const { data: freeDodgeData, error: freeDodgeError } = await supabase.rpc(
        "combat_consume_fast_footwork_dodge",
        {
          p_actor_token_id: roll.targetCharacterId,
        }
      );
      if (freeDodgeError) {
        console.error("Failed to consume Fast Footwork dodge:", freeDodgeError);
      } else {
        usedFreeDodge = Boolean(freeDodgeData);
      }
    }

    if (!usedFreeDodge) {
      const { error: consumeError } = await supabase.rpc("combat_use_reaction_action", {
        p_actor_token_id: roll.targetCharacterId,
      });
      if (consumeError) {
        console.error("Failed to consume reaction action:", consumeError);
      }
    }

    if (roll.applyProne) {
      const { error: proneError } = await supabase.rpc("combat_set_prone_for_token", {
        p_actor_token_id: roll.targetCharacterId,
        p_prone: true,
      });
      if (proneError) {
        console.error("Failed to apply prone from reaction:", proneError);
      }
    }

    const { error: clearError } = await supabase.rpc("combat_clear_reaction", {
      p_reaction_id: roll.reactionId,
    });
    if (clearError) {
      console.error("Failed to clear reaction:", clearError);
    }

    await resolveMeleeAttack(finalAttack);
  };

  const resolveArtRoll = async (roll: ResolvedArtRoll) => {
    const context = roll.context;
    if (!context?.sunder) return;
    const sunderContext = context.sunder;
    const sunderDamage = Math.max(0, roll.scaling);
    const supabase = createClient();

    const clearDestroyedItemSlots = (
      slots: EquipmentSlots | null | undefined,
      targetItemId: string,
      targetItemName: string
    ): EquipmentSlots => {
      const current = slots || { left: null, right: null, armor: null, helmet: null };
      const matches = (slotValue: string | null | undefined) =>
        Boolean(slotValue && (slotValue === targetItemId || slotValue === targetItemName));
      return {
        ...current,
        left: matches(current.left) ? null : current.left,
        right: matches(current.right) ? null : current.right,
        armor: matches(current.armor) ? null : current.armor,
        helmet: matches(current.helmet) ? null : current.helmet,
      };
    };

    if (sunderDamage > 0) {
      if (sunderContext.targetIsMonster) {
        const { data: combatState, error: combatError } = await supabase
          .from("combat_state")
          .select("initiative_monsters, initiative_entries")
          .eq("id", 1)
          .maybeSingle<{
            initiative_monsters: Array<{ id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
            initiative_entries: Array<{ participant_id: string; monster_snapshot?: Record<string, unknown> | null }> | null;
          }>();
        if (combatError || !combatState) {
          if (combatError) {
            console.error("Failed to load combat state for sunder:", combatError);
          }
        } else {
          const entries = Array.isArray(combatState.initiative_entries) ? combatState.initiative_entries : [];
          const monsters = Array.isArray(combatState.initiative_monsters) ? combatState.initiative_monsters : [];
          const targetEntry = entries.find(
            (entry) => entry.participant_id === sunderContext.attack.targetCharacterId
          );
          const targetMonster = monsters.find(
            (monster) => monster.id === sunderContext.attack.targetCharacterId
          );
          const snapshot = (targetEntry?.monster_snapshot || targetMonster?.monster_snapshot || null) as
            | {
                gear?: InventoryItem[];
                equipment_slots?: EquipmentSlots;
              }
            | null;
          if (snapshot) {
            const sourceGear = snapshot.gear || [];
            const nextGear = applyGearDamageToItem(sourceGear, sunderContext.targetItemId, sunderDamage);
            const destroyed = !nextGear.some((item) => item.id === sunderContext.targetItemId);
            const nextSlots = destroyed
              ? clearDestroyedItemSlots(
                  snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null },
                  sunderContext.targetItemId,
                  sunderContext.targetItemName
                )
              : snapshot.equipment_slots || { left: null, right: null, armor: null, helmet: null };

            const nextMonsters = monsters.map((monster) => {
              if (monster.id !== sunderContext.attack.targetCharacterId) return monster;
              return {
                ...monster,
                monster_snapshot: {
                  ...(monster.monster_snapshot || {}),
                  gear: nextGear,
                  equipment_slots: nextSlots,
                },
              };
            });
            const nextEntries = entries.map((entry) => {
              if (entry.participant_id !== sunderContext.attack.targetCharacterId) return entry;
              return {
                ...entry,
                monster_snapshot: {
                  ...(entry.monster_snapshot || {}),
                  gear: nextGear,
                  equipment_slots: nextSlots,
                },
              };
            });
            const { error: updateError } = await supabase
              .from("combat_state")
              .update({
                initiative_monsters: nextMonsters,
                initiative_entries: nextEntries,
              })
              .eq("id", 1);
            if (updateError) {
              console.error("Failed to apply sunder to monster gear:", updateError);
            }
          }
        }
      } else {
        const { data: target, error: targetError } = await supabase
          .from("characters")
          .select("id, inventory, equipment_slots")
          .eq("id", sunderContext.attack.targetCharacterId)
          .maybeSingle<{
            id: string;
            inventory?: InventoryItem[] | null;
            equipment_slots?: EquipmentSlots | null;
          }>();
        if (targetError || !target) {
          if (targetError) {
            console.error("Failed to load target for sunder:", targetError);
          }
        } else {
          const sourceInventory = target.inventory || [];
          const nextInventory = applyGearDamageToItem(sourceInventory, sunderContext.targetItemId, sunderDamage);
          const destroyed = !nextInventory.some((item) => item.id === sunderContext.targetItemId);
          const nextSlots = destroyed
            ? clearDestroyedItemSlots(
                target.equipment_slots || { left: null, right: null, armor: null, helmet: null },
                sunderContext.targetItemId,
                sunderContext.targetItemName
              )
            : target.equipment_slots || { left: null, right: null, armor: null, helmet: null };
          const { error: updateError } = await supabase
            .from("characters")
            .update({ inventory: nextInventory, equipment_slots: nextSlots })
            .eq("id", sunderContext.attack.targetCharacterId);
          if (updateError) {
            console.error("Failed to apply sunder to character gear:", updateError);
          } else if (character?.id === sunderContext.attack.targetCharacterId) {
            updateCharacter({ inventory: nextInventory, equipment_slots: nextSlots });
          }
        }
      }
    }

    await resolveMeleeAttack({
      ...sunderContext.attack,
      sunderResolved: true,
      skipReaction: true,
    });
  };

  const handleSunderPromptPass = async (promptId: string) => {
    const prompt = pendingSunderPrompt;
    clearPendingSunderPrompt(promptId);
    if (!prompt || prompt.id !== promptId) return;
    await resolveMeleeAttack({
      ...prompt.attack,
      sunderResolved: true,
      skipReaction: true,
    });
  };

  const handleSunderPromptRoll = async (promptId: string, targetItemId: string) => {
    const prompt = pendingSunderPrompt;
    if (!prompt || prompt.id !== promptId) return;
    const selected = prompt.options.find((opt) => opt.itemId === targetItemId);
    if (!selected) return;
    clearPendingSunderPrompt(promptId);
    queueArtRoll({
      id: `art-roll:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      actorCharacterId: prompt.attackerCharacterId,
      artId: "art-sunder",
      displayName: `Sunder (${selected.itemName})`,
      sunder: {
        attack: {
          ...prompt.attack,
          sunderResolved: true,
          skipReaction: true,
        },
        targetItemId: selected.itemId,
        targetItemName: selected.itemName,
        targetIsMonster: selected.targetIsMonster,
      },
    });
  };

  if (showCharacterSelect) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950 text-amber-50 font-serif p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-800 p-8 rounded-3xl shadow-2xl border border-amber-600/40">
            <h2 className="text-4xl font-extrabold text-amber-400 drop-shadow-lg mb-6 text-center">
              Select Character
            </h2>
            <p className="text-amber-200 text-center mb-8">
              Admin Mode: Choose a character to manage
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allCharacters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => selectCharacter(char.id)}
                  className="bg-gray-700 hover:bg-gray-600 rounded-xl p-6 shadow-lg border border-amber-600/30 hover:border-amber-500/60 transition-all hover:scale-105 text-left"
                >
                  <h3 className="text-2xl font-bold text-amber-300 mb-2">{char.name}</h3>
                  <div className="text-amber-200 space-y-1">
                    <p>Age: {char.age} | Gender: {char.gender}</p>
                    <p>Email: {char.email}</p>
                    <p>Spirits: {char.spirits}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <div className="text-xs text-amber-300">STR</div>
                      <div className="text-lg font-bold text-amber-100">{char.attributes.STR}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-amber-300">AGL</div>
                      <div className="text-lg font-bold text-amber-100">{char.attributes.AGL}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-amber-300">WIT</div>
                      <div className="text-lg font-bold text-amber-100">{char.attributes.WIT}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-amber-300">EMP</div>
                      <div className="text-lg font-bold text-amber-100">{char.attributes.EMP}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const effectiveIsAdmin = isAdmin && !simulatePlayerMode;
  const effectiveUserEmail =
    simulatePlayerMode && character?.email ? character.email : userEmail;

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950 text-amber-50 font-serif p-8">
      <div className="max-w-[95vw] mx-auto flex flex-col gap-4 relative">
        {/* Notification Popup */}
        {notification && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 p-8 rounded-3xl shadow-2xl border border-amber-600/40 max-w-md w-full mx-4 relative">
              <button
                onClick={dismissNotification}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-amber-200 transition-all"
              >
                ✕
              </button>
              <h3 className="text-2xl font-bold text-amber-400 mb-4">Pigeon Message!</h3>
              <p className="text-amber-100 text-lg">{notification.message}</p>
            </div>
          </div>
        )}

        {/* Character Icon - Top Right */}
        {character && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleIconUpload}
              className="hidden"
            />
            <button
              onClick={handleIconClick}
              disabled={uploadingIcon}
              className="fixed top-4 right-4 w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 shadow-lg border-3 border-amber-400 hover:border-amber-300 transition-all hover:scale-105 flex items-center justify-center overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed z-40"
              title="Click to change character icon"
            >
              {character.icon_url ? (
                <img 
                  src={character.icon_url} 
                  alt="Character icon" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-4xl">👤</span>
              )}
              {uploadingIcon ? (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-2xl">📷</span>
                </div>
              )}
            </button>
          </>
        )}

        {/* Tabs */}
        <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2 border-b border-amber-500 pb-2">
            <button
              onClick={() => setActiveTab("character")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "character"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Character
            </button>
            <button
              onClick={() => setActiveTab("inventory")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "inventory"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Inventory
            </button>
            <button
              onClick={() => setActiveTab("arts")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "arts"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Arts
            </button>
            <button
              onClick={() => setActiveTab("talents")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "talents"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Talents
            </button>
            <button
              onClick={() => setActiveTab("combat")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "combat"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Combat
            </button>
            {effectiveIsAdmin && (
              <button
                onClick={() => setActiveTab("monsters")}
                className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                  activeTab === "monsters"
                    ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                    : "bg-gray-800 text-amber-200 hover:bg-gray-700"
                }`}
              >
                Monsters
              </button>
            )}
            <button
              onClick={() => setActiveTab("wagon")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "wagon"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Wagon
            </button>
            <button
              onClick={() => setActiveTab("poll")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "poll"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Poll
            </button>
            <button
              onClick={() => setActiveTab("glossary")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "glossary"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Glossary
            </button>
            <button
              onClick={() => setActiveTab("map")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "map"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setActiveTab("kogra")}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all ${
                activeTab === "kogra"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Kogra
            </button>
          </div>
          <div className="flex gap-3">
            {isAdmin && (
              <button
                onClick={toggleSimulatePlayerMode}
                className={`px-4 py-2 rounded-lg shadow-md font-semibold transition-all hover:scale-105 ${
                  simulatePlayerMode
                    ? "bg-emerald-700 hover:bg-emerald-600 text-emerald-100"
                    : "bg-blue-700 hover:bg-blue-600 text-amber-200"
                }`}
              >
                {simulatePlayerMode ? "Simulating Player" : "Simulate Player"}
              </button>
            )}
            {effectiveIsAdmin && character && (
              <button
                onClick={switchCharacter}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
              >
                Switch Character
              </button>
            )}
            <button
              onClick={restCharacter}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
            >
              Rest
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-800 p-8 rounded-3xl shadow-2xl min-h-[400px] border border-amber-600/40">
          {activeTab === "character" && (
            <Character
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
              pendingMeleeAction={pendingMeleeAction}
              onConsumePendingMeleeAction={clearPendingMeleeAction}
              onResolveMeleeAttack={resolveMeleeAttack}
              onMeleeRollCleared={onMeleeRollCleared}
              pendingReactionRoll={pendingReactionRoll}
              onConsumePendingReactionRoll={clearPendingReactionRoll}
              onResolveReactionRoll={resolveReactionRoll}
              onReactionRollCleared={onReactionRollCleared}
            />
          )}
          {activeTab === "inventory" && (
            <Inventory
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
              wagonData={wagonData}
              setWagonData={setWagonData}
              userEmail={effectiveUserEmail}
              drawGearReturnToCombat={drawGearReturnToCombat}
              onDrawGearFinished={onDrawGearFinished}
            />
          )}
          {activeTab === "wagon" && (
            <Wagon
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
              wagonData={wagonData}
              setWagonData={setWagonData}
              refreshWagons={fetchWagons}
            />
          )}
          {activeTab === "arts" && (
            <Arts
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
              pendingArtRoll={pendingArtRoll}
              onConsumePendingArtRoll={clearPendingArtRoll}
              onResolveArtRoll={resolveArtRoll}
              onArtRollCleared={onArtRollCleared}
            />
          )}
          {activeTab === "talents" && (
            <Talents
              character={character}
            />
          )}
          {activeTab === "combat" && (
            <Combat
              isDM={effectiveIsAdmin}
              userEmail={effectiveUserEmail}
              onRequestDrawGear={startDrawGearFromCombat}
              character={character}
              onQueueMeleeAction={queueMeleeAction}
              onQueueReactionRoll={queueReactionRoll}
              onResolveMeleeAttack={resolveMeleeAttack}
              onApplyStartOfTurnEffects={onApplyStartOfTurnEffects}
              pendingArmorPrompt={pendingArmorPrompt}
              onConsumeArmorPrompt={clearPendingArmorPrompt}
              onArmorPromptPass={handleArmorPromptPass}
              pendingSunderPrompt={pendingSunderPrompt}
              onConsumeSunderPrompt={clearPendingSunderPrompt}
              onSunderPromptPass={handleSunderPromptPass}
              onSunderPromptRoll={handleSunderPromptRoll}
            />
          )}
          {activeTab === "monsters" && (
            <Monsters
              isDM={effectiveIsAdmin}
            />
          )}
          {activeTab === "poll" && (
            <Poll
              character={character}
              allCharacters={allCharacters}
              isDM={effectiveIsAdmin}
            />
          )}
          {activeTab === "kogra" && (
            <Kogra
              character={character}
              userEmail={effectiveUserEmail}
            />
          )}
          {activeTab === "glossary" && (
            <Glossary
              isDM={effectiveIsAdmin}
              userEmail={effectiveUserEmail}
            />
          )}
          {activeTab === "map" && (
            <MapBoard
              isDM={effectiveIsAdmin}
              onPollCreated={() => setActiveTab("poll")}
            />
          )}
        </div>
      </div>
    </main>
  );
}
