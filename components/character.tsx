"use client";

import { useEffect, useRef, useState } from "react";
import {
  CharacterType,
  InventoryItem,
  PendingMeleeAction,
  PendingReactionRoll,
  ResolvedMeleeAttack,
  ResolvedReactionRoll,
} from "../app/protected/page";
import { applyGearDamageToItem } from "@/lib/item-catalog";

type Attributes = {
  STR: number;
  AGL: number;
  WIT: number;
  EMP: number;
};

type Skill = {
  name: string;
  description: string;
  points: number;
  attribute: keyof Attributes;
};

type DicePool = "attribute" | "skill" | "gear" | "attribute+skill" | "attribute+gear" | "skill+gear" | "all";

type RollState = {
  attributeDice: number[];
  skillDice: number[];
  skillIsNegative: boolean;
  gearDice: number[];
  poolUsed: DicePool;
  hasBeenPushed: boolean;
  requiredSuccesses: number;
  gearItemId?: string;
};

const allSkills: Skill[] = [
  { name: "MIGHT", description: "Push, pull, or lift.", points: 0, attribute: "STR" },
  { name: "ENDURANCE", description: "Push through extended travel or extreme weather.", points: 0, attribute: "STR" },
  { name: "MELEE", description: "Attack or parry.", points: 0, attribute: "STR" },
  { name: "CRAFTING", description: "Repairing or crafting.", points: 0, attribute: "STR" },
  { name: "STEALTH", description: "Sneak through area or sneak attacks.", points: 0, attribute: "AGL" },
  { name: "MOVE", description: "Move through tricky situations or evade.", points: 0, attribute: "AGL" },
  { name: "SLEIGHT OF HAND", description: "Pick locks or steal items.", points: 0, attribute: "AGL" },
  { name: "MARKSMANSHIP", description: "Ranged attacks.", points: 0, attribute: "AGL" },
  { name: "SCOUTING", description: "Detect objects or perceive sneakers.", points: 0, attribute: "WIT" },
  { name: "LORE", description: "Recall legends or information.", points: 0, attribute: "WIT" },
  { name: "SURVIVAL", description: "Survive in the wilderness.", points: 0, attribute: "WIT" },
  { name: "INSIGHT", description: "Resist manipulation or determine state of mind.", points: 0, attribute: "WIT" },
  { name: "MANIPULATE", description: "Manipulate creatures into doing something.", points: 0, attribute: "EMP" },
  { name: "HEALING", description: "Heal physically broken creatures.", points: 0, attribute: "EMP" },
  { name: "PERFORMANCE", description: "Heal mentally broken creatures or taunt enemies.", points: 0, attribute: "EMP" },
  { name: "ANIMAL HANDLING", description: "Ride animals, tame wild ones, or command tamed ones.", points: 0, attribute: "EMP" },
];

type CharacterProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
  pendingMeleeAction: PendingMeleeAction | null;
  onConsumePendingMeleeAction: (actionId: string) => void;
  onResolveMeleeAttack: (attack: ResolvedMeleeAttack) => void | Promise<void>;
  onMeleeRollCleared: () => void;
  pendingReactionRoll: PendingReactionRoll | null;
  onConsumePendingReactionRoll: (rollId: string) => void;
  onResolveReactionRoll: (roll: ResolvedReactionRoll) => void | Promise<void>;
  onReactionRollCleared: () => void;
};

const emptyRoll = (): RollState => ({
  attributeDice: [],
  skillDice: [],
  skillIsNegative: false,
  gearDice: [],
  poolUsed: "attribute",
  hasBeenPushed: false,
  requiredSuccesses: 1,
});

const ATTRIBUTE_KEYS: (keyof Attributes)[] = ["STR", "AGL", "WIT", "EMP"];
const PENDING_SPIRIT_STORAGE_KEY = "x-company.pending-spirit-on-clear";
const PENDING_MELEE_RESOLUTION_STORAGE_KEY = "x-company.pending-melee-resolution-on-clear";

type ActiveMeleeAttack = PendingMeleeAction & {
  attr: keyof Attributes;
};

type ActiveReactionRoll = PendingReactionRoll & {
  attr: keyof Attributes;
};

const skillAttributeFor = (skillName: string | null | undefined): keyof Attributes | null => {
  if (!skillName) return null;
  const skill = allSkills.find((entry) => entry.name === skillName);
  return skill ? skill.attribute : null;
};

const rollableGearBonus = (item: InventoryItem | null | undefined): number => {
  if (!item) return 0;
  if (item.item_type === "Armor" || item.item_type === "Helmet") {
    if (typeof item.effective_gear_bonus === "number" && !Number.isNaN(item.effective_gear_bonus)) {
      return Math.max(0, Math.trunc(item.effective_gear_bonus));
    }
  }
  return Math.max(0, Math.trunc(item.gearBonus ?? 0));
};

const formatGearBonusLabel = (item: InventoryItem): string => {
  const trueBonus = Math.max(0, Math.trunc(item.gearBonus ?? 0));
  if (item.item_type !== "Armor" && item.item_type !== "Helmet") {
    return `(+${trueBonus})`;
  }
  const effectiveBonus =
    typeof item.effective_gear_bonus === "number" && !Number.isNaN(item.effective_gear_bonus)
      ? Math.max(0, Math.trunc(item.effective_gear_bonus))
      : trueBonus;
  if (effectiveBonus === trueBonus) return `(+${trueBonus})`;
  return `(+${trueBonus}/+${effectiveBonus})`;
};

export default function Character({
  character,
  updateCharacter,
  saveCharacter,
  pendingMeleeAction,
  onConsumePendingMeleeAction,
  onResolveMeleeAttack,
  onMeleeRollCleared,
  pendingReactionRoll,
  onConsumePendingReactionRoll,
  onResolveReactionRoll,
  onReactionRollCleared,
}: CharacterProps) {
  const [rollStates, setRollStates] = useState<Record<string, RollState>>({
    STR: emptyRoll(),
    AGL: emptyRoll(),
    WIT: emptyRoll(),
    EMP: emptyRoll(),
  });
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<keyof Attributes | null>(null);
  const [selectedGear, setSelectedGear] = useState<InventoryItem | null>(null);
  const [bonusDice, setBonusDice] = useState<string>("0");
  const [activeMeleeAttack, setActiveMeleeAttack] = useState<ActiveMeleeAttack | null>(null);
  const [activeReactionRoll, setActiveReactionRoll] = useState<ActiveReactionRoll | null>(null);
  const characterRef = useRef<CharacterType | null>(character);
  const rollStatesRef = useRef<Record<string, RollState>>(rollStates);
  const isPageUnloadingRef = useRef(false);
  const activeMeleeAttackRef = useRef<ActiveMeleeAttack | null>(null);
  const activeReactionRollRef = useRef<ActiveReactionRoll | null>(null);
  const handledPendingMeleeActionIdRef = useRef<string | null>(null);
  const handledPendingReactionRollIdRef = useRef<string | null>(null);

  useEffect(() => {
    characterRef.current = character;
  }, [character]);

  useEffect(() => {
    rollStatesRef.current = rollStates;
  }, [rollStates]);

  useEffect(() => {
    activeMeleeAttackRef.current = activeMeleeAttack;
  }, [activeMeleeAttack]);

  useEffect(() => {
    activeReactionRollRef.current = activeReactionRoll;
  }, [activeReactionRoll]);

  // Returns true if the given attribute's roll slot has any dice in it.
  const hasRollFor = (attr: keyof Attributes) => {
    const r = rollStates[attr];
    return r.attributeDice.length > 0 || r.skillDice.length > 0 || r.gearDice.length > 0;
  };

  // Full reset: clears a roll slot AND drops all UI selections.
  const clearEverything = (attr: keyof Attributes) => {
    setRollStates(prev => ({ ...prev, [attr]: emptyRoll() }));
    setSelectedSkill(null);
    setSelectedAttribute(null);
    setSelectedGear(null);
  };

  const calculateSpiritGain = (
    attrSixes: number,
    skillSixes: number,
    gearSixes: number,
    negativeSkillSixes: number,
    requiredSuccesses: number,
  ): number => {
    const totalSixes = Math.max(0, attrSixes + skillSixes + gearSixes - negativeSkillSixes);
    const remainingSixes = Math.max(0, totalSixes - requiredSuccesses);
    const contributingSixes = attrSixes + gearSixes;
    return Math.min(remainingSixes, contributingSixes);
  };

  const spiritFromRoll = (roll: RollState): number => {
    const hasAnyDice = roll.attributeDice.length > 0 || roll.skillDice.length > 0 || roll.gearDice.length > 0;
    if (!hasAnyDice) return 0;

    const attrSixes = roll.attributeDice.filter(d => d === 6).length;
    const skillSixes = roll.skillDice.filter(d => d === 6).length;
    const gearSixes = roll.gearDice.filter(d => d === 6).length;
    const negativeSkillSixes = roll.skillIsNegative ? skillSixes : 0;

    return calculateSpiritGain(
      attrSixes,
      skillSixes,
      gearSixes,
      negativeSkillSixes,
      Math.max(0, roll.requiredSuccesses),
    );
  };

  const totalSuccessesFromRoll = (roll: RollState): number => {
    const attrSixes = roll.attributeDice.filter(d => d === 6).length;
    const skillSixes = roll.skillDice.filter(d => d === 6).length;
    const gearSixes = roll.gearDice.filter(d => d === 6).length;
    const negativeSkillSixes = roll.skillIsNegative ? skillSixes : 0;
    return Math.max(0, attrSixes + skillSixes + gearSixes - negativeSkillSixes);
  };

  const resolveMeleeAttackForRoll = (attr: keyof Attributes, roll: RollState) => {
    const pending = activeMeleeAttackRef.current;
    if (!pending || pending.attr !== attr) return;
    activeMeleeAttackRef.current = null;
    setActiveMeleeAttack(null);

    const resolvedAttack: ResolvedMeleeAttack = {
      id: pending.id,
      attackerCharacterId: pending.attackerCharacterId,
      attackerName: pending.attackerName,
      targetCharacterId: pending.targetCharacterId,
      weaponName: pending.weaponName,
      weaponBaseDamage: pending.weaponBaseDamage,
      maneuver: pending.maneuver,
      totalSuccesses: totalSuccessesFromRoll(roll),
      requiredSuccesses: pending.requiredSuccesses,
      swingBonusDamage: pending.swingBonusDamage,
      healAttribute: pending.healAttribute,
      disarmTargetItemId: pending.disarmTargetItemId,
      disarmZoneId: pending.disarmZoneId,
      destinationX: pending.destinationX,
      destinationY: pending.destinationY,
      shootTargetZoneId: pending.shootTargetZoneId,
      shootAmmoItem: pending.shootAmmoItem,
      rangeAtAttack: pending.rangeAtAttack,
    };

    void Promise.resolve(onResolveMeleeAttack(resolvedAttack))
      .catch((error) => {
        console.error("Failed to resolve melee attack roll:", error);
      })
      .finally(() => {
        onMeleeRollCleared();
      });
  };

  const resolveReactionRollForRoll = (attr: keyof Attributes, roll: RollState) => {
    const pending = activeReactionRollRef.current;
    if (!pending || pending.attr !== attr) return;
    activeReactionRollRef.current = null;
    setActiveReactionRoll(null);

    const resolvedRoll: ResolvedReactionRoll = {
      id: pending.id,
      reactionId: pending.reactionId,
      targetCharacterId: pending.targetCharacterId,
      mode: pending.mode,
      rollType: pending.rollType,
      totalSuccesses: totalSuccessesFromRoll(roll),
      armorSlot: pending.armorSlot,
      applyProne: pending.applyProne,
      attack: pending.attack,
      taunt: pending.taunt,
    };

    void Promise.resolve(onResolveReactionRoll(resolvedRoll))
      .catch((error) => {
        console.error("Failed to resolve reaction roll:", error);
      })
      .finally(() => {
        onReactionRollCleared();
      });
  };

  const applySpiritDelta = (delta: number) => {
    const currentCharacter = characterRef.current;
    if (!currentCharacter || delta <= 0) return;
    const updates = {
      spirits: (currentCharacter.spirits ?? 0) + delta,
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const applySpiritOnClear = (attr: keyof Attributes, rollOverride?: RollState) => {
    const extraSpirit = spiritFromRoll(rollOverride ?? rollStates[attr]);
    applySpiritDelta(extraSpirit);
  };

  const resolveRollClear = (attr: keyof Attributes, roll: RollState) => {
    applySpiritOnClear(attr, roll);
    resolveMeleeAttackForRoll(attr, roll);
    resolveReactionRollForRoll(attr, roll);
  };

  const clearRollAndResolveSpirit = (attr: keyof Attributes) => {
    resolveRollClear(attr, rollStates[attr]);
    clearEverything(attr);
  };

  // Silently clear rolls on DIFFERENT attributes without touching selections.
  // (selections will be overwritten by the caller immediately after).
  const clearPreviousRoll = (incomingAttr: keyof Attributes) => {
    const next = { ...rollStates };
    for (const attr of ATTRIBUTE_KEYS) {
      if (attr === incomingAttr) continue;
      if (rollStates[attr].attributeDice.length === 0 && rollStates[attr].skillDice.length === 0 && rollStates[attr].gearDice.length === 0) {
        continue;
      }
      resolveRollClear(attr, rollStates[attr]);
      next[attr] = emptyRoll();
    }
    setRollStates(next);
  };

  const handleSkillClick = (skillName: string, skillAttr: keyof Attributes) => {
    // Clicking the already-selected skill deselects it.
    if (selectedSkill === skillName) {
      setSelectedSkill(null);
      setSelectedAttribute(null);
      return;
    }

    // If this skill belongs to a DIFFERENT attribute than what's currently active,
    // clear that previous attribute's roll first.
    clearPreviousRoll(skillAttr);

    setSelectedSkill(skillName);
    setSelectedAttribute(skillAttr);
  };

  const handleAttributeClick = (attr: keyof Attributes) => {
    // If this attribute already has a roll, clicking it clears everything.
    if (hasRollFor(attr)) {
      clearRollAndResolveSpirit(attr);
      return;
    }

    // Toggling the same attribute off.
    if (selectedAttribute === attr) {
      setSelectedAttribute(null);
      setSelectedSkill(null);
      return;
    }

    // Switching to a new attribute — clear the old roll if one exists.
    clearPreviousRoll(attr);

    setSelectedAttribute(attr);
    // If the currently selected skill doesn't belong to this attribute, drop it.
    const skill = allSkills.find(s => s.name === selectedSkill);
    if (skill && skill.attribute !== attr) {
      setSelectedSkill(null);
    }
  };

  const handleGearClick = (item: InventoryItem) => {
    if (selectedGear?.id === item.id) {
      setSelectedGear(null);
    } else {
      setSelectedGear(item);
    }
  };

  const incrementAttribute = (attr: keyof Attributes) => {
    if (!character) return;
    const currentValue = character.attributes[attr];
    const maxValue = character.max_attributes[attr];
    if (currentValue < maxValue) {
      const updates = {
        attributes: { ...character.attributes, [attr]: currentValue + 1 },
      };
      updateCharacter(updates);
      saveCharacter(updates);
    }
  };

  const decrementAttribute = (attr: keyof Attributes) => {
    if (!character) return;
    const currentValue = character.attributes[attr];
    if (currentValue > 0) {
      const updates = {
        attributes: { ...character.attributes, [attr]: currentValue - 1 },
      };
      updateCharacter(updates);
      saveCharacter(updates);
    }
  };

  const incrementSpirit = () => {
    if (!character) return;
    const updates = {
      spirits: (character.spirits ?? 0) + 1,
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const decrementSpirit = () => {
    if (!character) return;
    const currentValue = character.spirits ?? 0;
    if (currentValue > 0) {
      const updates = {
        spirits: currentValue - 1,
      };
      updateCharacter(updates);
      saveCharacter(updates);
    }
  };

  const resetEffectiveAfterGearUse = (gearItem: InventoryItem | null | undefined) => {
    if (!character || !gearItem) return;
    if (gearItem.item_type !== "Armor" && gearItem.item_type !== "Helmet") return;
    const trueBonus = Math.max(0, Math.trunc(gearItem.gearBonus ?? 0));
    const effectiveBonus =
      typeof gearItem.effective_gear_bonus === "number" && !Number.isNaN(gearItem.effective_gear_bonus)
        ? Math.max(0, Math.trunc(gearItem.effective_gear_bonus))
        : trueBonus;
    if (effectiveBonus === trueBonus) return;
    const updatedInventory = (character.inventory || []).map((item) =>
      item.id === gearItem.id ? { ...item, effective_gear_bonus: trueBonus } : item
    );
    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
    setSelectedGear((prev) => (prev && prev.id === gearItem.id ? { ...prev, effective_gear_bonus: trueBonus } : prev));
  };

  const rollDice = (attr: keyof Attributes, pool: DicePool) => {
    if (!character) return;

    const attrCount = character.attributes[attr];
    const skillPoints = selectedSkill ? (character.skills[selectedSkill] ?? 0) : 0;
    const bonus = parseInt(bonusDice, 10);
    const normalizedBonus = Number.isNaN(bonus) ? 0 : bonus;
    const modifiedSkillCount = skillPoints + normalizedBonus;
    const skillIsNegative = modifiedSkillCount < 0;
    const gearBonus = rollableGearBonus(selectedGear);

    let attributeDice: number[] = [];
    let skillDice: number[] = [];
    let gearDice: number[] = [];

    if (pool === "attribute" || pool === "attribute+skill" || pool === "attribute+gear" || pool === "all") {
      attributeDice = Array.from({ length: attrCount }, () => Math.floor(Math.random() * 6) + 1);
    }
    if (pool === "skill" || pool === "attribute+skill" || pool === "skill+gear" || pool === "all") {
      skillDice = Array.from({ length: Math.abs(modifiedSkillCount) }, () => Math.floor(Math.random() * 6) + 1);
    }
    if (pool === "gear" || pool === "attribute+gear" || pool === "skill+gear" || pool === "all") {
      gearDice = Array.from({ length: gearBonus }, () => Math.floor(Math.random() * 6) + 1);
    }

    setRollStates(prev => ({
      ...prev,
      [attr]: {
        attributeDice,
        skillDice,
        skillIsNegative,
        gearDice,
        poolUsed: pool,
        hasBeenPushed: false,
        requiredSuccesses: prev[attr]?.requiredSuccesses ?? 1,
        gearItemId: selectedGear?.id,
      },
    }));
    if (pool === "gear" || pool === "attribute+gear" || pool === "skill+gear" || pool === "all") {
      resetEffectiveAfterGearUse(selectedGear);
    }
  };

  const pushDice = async (attr: keyof Attributes, pushPools: string[]) => {
    if (!character) return;

    const currentRoll = rollStates[attr];
    if (currentRoll.hasBeenPushed) return;

    // --- Reroll phase: only the selected pools get rerolled (1s and 6s kept) ---
    const newAttributeDice = pushPools.includes("attribute")
      ? currentRoll.attributeDice.map(d => (d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1))
      : currentRoll.attributeDice;

    const newSkillDice = pushPools.includes("skill")
      ? currentRoll.skillDice.map(d => (d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1))
      : currentRoll.skillDice;

    const newGearDice = pushPools.includes("gear")
      ? currentRoll.gearDice.map(d => (d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1))
      : currentRoll.gearDice;

    // All attribute ones deal attribute damage; all gear ones deal gear damage.
    const attrOnes = newAttributeDice.filter(d => d === 1).length;
    const gearOnes = newGearDice.filter(d => d === 1).length;

    const attrDecrease = attrOnes;

    const newAttrValue = Math.max(0, (character.attributes[attr] ?? 0) - attrDecrease);

    // Handle gear damage from ALL gear ones
    let updatedInventory = character.inventory || [];
    if (gearOnes > 0 && currentRoll.gearItemId) {
      updatedInventory = applyGearDamageToItem(updatedInventory, currentRoll.gearItemId, gearOnes);

      const gearStillExists = updatedInventory.find(item => item.id === currentRoll.gearItemId);
      if (!gearStillExists) {
        setSelectedGear(null);
      }
    }

    const updates = {
      attributes: { ...character.attributes, [attr]: newAttrValue },
      inventory: updatedInventory,
    };

    updateCharacter(updates);
    saveCharacter(updates);

    // Mark the entire roll as pushed — no further pushes allowed.
    setRollStates(prev => ({
      ...prev,
      [attr]: {
        attributeDice: newAttributeDice,
        skillDice: newSkillDice,
        skillIsNegative: currentRoll.skillIsNegative,
        gearDice: newGearDice,
        poolUsed: currentRoll.poolUsed,
        hasBeenPushed: true,
        requiredSuccesses: currentRoll.requiredSuccesses,
        gearItemId: currentRoll.gearItemId,
      },
    }));
  };

  const handleRequiredSuccessesChange = (attr: keyof Attributes, value: string) => {
    const parsed = parseInt(value, 10);
    const normalized = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
    setRollStates(prev => ({
      ...prev,
      [attr]: {
        ...prev[attr],
        requiredSuccesses: normalized,
      },
    }));
  };

  const attributesOrder: (keyof Attributes)[] = ["STR", "AGL", "WIT", "EMP"];
  const characterSkills = allSkills.map(skill => ({
    ...skill,
    points: character?.skills[skill.name] ?? 0,
  }));

  const renderDie = (num: number, bouncing: boolean, dieType: "attribute" | "skill" | "negativeSkill" | "gear") => {
    const icon = num === 6 ? "✅" : num === 1 ? "❌" : "⚪";
    const color = num === 6 ? "text-green-400" : num === 1 ? "text-red-500" : "text-gray-400";
    const bgColor = dieType === "skill"
      ? "bg-blue-700"
      : dieType === "negativeSkill"
        ? "bg-red-700"
        : dieType === "gear"
          ? "bg-purple-700"
          : "bg-gray-700";
    const borderColor = dieType === "skill"
      ? "border-blue-400"
      : dieType === "negativeSkill"
        ? "border-red-400"
        : dieType === "gear"
          ? "border-purple-400"
          : "border-gray-500";

    return (
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${bouncing ? "animate-bounce" : ""} ${bgColor} border-2 ${borderColor}`}
      >
        <span className={`text-xl font-bold ${color}`}>{icon}</span>
      </div>
    );
  };

  useEffect(() => {
    if (!character?.id) return;

    try {
      const raw = window.localStorage.getItem(PENDING_SPIRIT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { characterId?: string; spirit?: number };
        if (parsed.characterId === character.id) {
          const pendingSpirit = Math.max(0, parsed.spirit ?? 0);
          if (pendingSpirit > 0) {
            applySpiritDelta(pendingSpirit);
          }
          window.localStorage.removeItem(PENDING_SPIRIT_STORAGE_KEY);
        }
      }
    } catch {
      window.localStorage.removeItem(PENDING_SPIRIT_STORAGE_KEY);
    }

    try {
      const rawMelee = window.localStorage.getItem(PENDING_MELEE_RESOLUTION_STORAGE_KEY);
      if (rawMelee) {
        const parsed = JSON.parse(rawMelee) as ResolvedMeleeAttack | null;
        if (parsed && parsed.attackerCharacterId === character.id) {
          void onResolveMeleeAttack(parsed);
          window.localStorage.removeItem(PENDING_MELEE_RESOLUTION_STORAGE_KEY);
        }
      }
    } catch {
      window.localStorage.removeItem(PENDING_MELEE_RESOLUTION_STORAGE_KEY);
    }
  }, [character?.id]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isPageUnloadingRef.current = true;
      const currentCharacter = characterRef.current;
      if (!currentCharacter?.id) return;

      const pendingSpirit = ATTRIBUTE_KEYS.reduce((sum, attr) => {
        const roll = rollStatesRef.current[attr];
        return sum + spiritFromRoll(roll);
      }, 0);

      if (pendingSpirit > 0) {
        try {
          window.localStorage.setItem(
            PENDING_SPIRIT_STORAGE_KEY,
            JSON.stringify({ characterId: currentCharacter.id, spirit: pendingSpirit, savedAt: Date.now() }),
          );
        } catch {
          // Ignore storage errors on unload.
        }
      }

      const pendingAttack = activeMeleeAttackRef.current;
      if (pendingAttack) {
        const pendingRoll = rollStatesRef.current[pendingAttack.attr];
        try {
          window.localStorage.setItem(
            PENDING_MELEE_RESOLUTION_STORAGE_KEY,
            JSON.stringify({
              id: pendingAttack.id,
              attackerCharacterId: pendingAttack.attackerCharacterId,
              targetCharacterId: pendingAttack.targetCharacterId,
              weaponName: pendingAttack.weaponName,
              weaponBaseDamage: pendingAttack.weaponBaseDamage,
              maneuver: pendingAttack.maneuver,
              totalSuccesses: totalSuccessesFromRoll(pendingRoll),
              requiredSuccesses: pendingAttack.requiredSuccesses,
              swingBonusDamage: pendingAttack.swingBonusDamage,
              disarmTargetItemId: pendingAttack.disarmTargetItemId,
              disarmZoneId: pendingAttack.disarmZoneId,
              rangeAtAttack: pendingAttack.rangeAtAttack,
            } satisfies ResolvedMeleeAttack),
          );
        } catch {
          // Ignore storage errors on unload.
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (isPageUnloadingRef.current) return;
      for (const attr of ATTRIBUTE_KEYS) {
        const roll = rollStatesRef.current[attr];
        const hasAnyDice = roll.attributeDice.length > 0 || roll.skillDice.length > 0 || roll.gearDice.length > 0;
        if (!hasAnyDice) continue;
        resolveRollClear(attr, roll);
      }
    };
  }, []);

  useEffect(() => {
    if (!character || !pendingMeleeAction) return;
    if (pendingMeleeAction.attackerCharacterId !== character.id) return;
    if (handledPendingMeleeActionIdRef.current === pendingMeleeAction.id) return;
    const isRetreat = pendingMeleeAction.maneuver === "Retreat";
    const actionBonusDice = pendingMeleeAction.bonusDice ?? 0;
    const rollAttribute = pendingMeleeAction.rollAttribute ?? (isRetreat ? "AGL" : "STR");
    const rollSkill = pendingMeleeAction.rollSkill ?? (isRetreat ? "MOVE" : "MELEE");
    const usesWeaponGear = Boolean(pendingMeleeAction.weaponItemId);
    const weapon = pendingMeleeAction.weaponItemId
      ? (character.inventory || []).find((item) => item.id === pendingMeleeAction.weaponItemId) || null
      : null;
    if (usesWeaponGear && !weapon) {
      onConsumePendingMeleeAction(pendingMeleeAction.id);
      handledPendingMeleeActionIdRef.current = pendingMeleeAction.id;
      return;
    }

    const skillAttribute = skillAttributeFor(rollSkill);
    if (skillAttribute && (character.attributes?.[skillAttribute] ?? 0) <= 0) {
      onConsumePendingMeleeAction(pendingMeleeAction.id);
      handledPendingMeleeActionIdRef.current = pendingMeleeAction.id;
      onMeleeRollCleared();
      return;
    }

    clearPreviousRoll(rollAttribute);
    if (hasRollFor(rollAttribute)) {
      clearRollAndResolveSpirit(rollAttribute);
    }

    setSelectedAttribute(rollAttribute);
    setSelectedSkill(rollSkill);
    setSelectedGear(usesWeaponGear ? weapon : null);
    setBonusDice(`${actionBonusDice}`);
    setActiveMeleeAttack({ ...pendingMeleeAction, attr: rollAttribute });

    const attrCount = character.attributes[rollAttribute] ?? 0;
    const signedSkillCount = (character.skills[rollSkill] ?? 0) + actionBonusDice;
    const skillCount = Math.abs(signedSkillCount);
    const skillIsNegative = signedSkillCount < 0;
    const gearCount = usesWeaponGear ? rollableGearBonus(weapon) : 0;

    setRollStates((prev) => ({
      ...prev,
      [rollAttribute]: {
        attributeDice: Array.from({ length: attrCount }, () => Math.floor(Math.random() * 6) + 1),
        skillDice: Array.from({ length: skillCount }, () => Math.floor(Math.random() * 6) + 1),
        skillIsNegative,
        gearDice: Array.from({ length: gearCount }, () => Math.floor(Math.random() * 6) + 1),
        poolUsed: gearCount > 0 ? "all" : "attribute+skill",
        hasBeenPushed: false,
        requiredSuccesses: Math.max(1, pendingMeleeAction.requiredSuccesses ?? 1),
        gearItemId: weapon?.id,
      },
    }));
    if (usesWeaponGear) {
      resetEffectiveAfterGearUse(weapon);
    }

    onConsumePendingMeleeAction(pendingMeleeAction.id);
    handledPendingMeleeActionIdRef.current = pendingMeleeAction.id;
  }, [character, pendingMeleeAction]);

  useEffect(() => {
    if (!character || !pendingReactionRoll) return;
    if (pendingReactionRoll.targetCharacterId !== character.id) return;
    if (handledPendingReactionRollIdRef.current === pendingReactionRoll.id) return;

    const rollAttribute = pendingReactionRoll.rollAttribute;
    const rollSkill = pendingReactionRoll.rollSkill;
    const usesGear = Boolean(pendingReactionRoll.gearItemId);
    const gearItem = usesGear
      ? (character.inventory || []).find((item) => item.id === pendingReactionRoll.gearItemId) || null
      : null;
    if (usesGear && !gearItem) {
      onConsumePendingReactionRoll(pendingReactionRoll.id);
      handledPendingReactionRollIdRef.current = pendingReactionRoll.id;
      return;
    }

    const skillAttribute = skillAttributeFor(rollSkill);
    if (pendingReactionRoll.rollType !== "armor" && skillAttribute && (character.attributes?.[skillAttribute] ?? 0) <= 0) {
      onConsumePendingReactionRoll(pendingReactionRoll.id);
      handledPendingReactionRollIdRef.current = pendingReactionRoll.id;
      void onResolveReactionRoll({
        id: pendingReactionRoll.id,
        reactionId: pendingReactionRoll.reactionId,
        targetCharacterId: pendingReactionRoll.targetCharacterId,
        mode: pendingReactionRoll.mode,
        rollType: pendingReactionRoll.rollType,
        totalSuccesses: 0,
        armorSlot: pendingReactionRoll.armorSlot,
        applyProne: pendingReactionRoll.applyProne,
        attack: pendingReactionRoll.attack,
        taunt: pendingReactionRoll.taunt,
      });
      onReactionRollCleared();
      return;
    }

    clearPreviousRoll(rollAttribute);
    if (hasRollFor(rollAttribute)) {
      clearRollAndResolveSpirit(rollAttribute);
    }

    setSelectedAttribute(rollAttribute);
    setSelectedSkill(rollSkill);
    setSelectedGear(usesGear ? gearItem : null);
    setBonusDice(`${pendingReactionRoll.bonusDice ?? 0}`);
    setActiveReactionRoll({ ...pendingReactionRoll, attr: rollAttribute });

    const attrCount =
      pendingReactionRoll.fixedAttributeDice !== undefined
        ? Math.max(0, pendingReactionRoll.fixedAttributeDice)
        : character.attributes[rollAttribute] ?? 0;
    const hasFixedSkill = pendingReactionRoll.fixedSkillDice !== undefined;
    const signedSkillCount = hasFixedSkill
      ? Math.max(0, pendingReactionRoll.fixedSkillDice as number)
      : (character.skills[rollSkill] ?? 0) + (pendingReactionRoll.bonusDice ?? 0);
    const skillCount = Math.abs(signedSkillCount);
    const skillIsNegative = hasFixedSkill ? false : signedSkillCount < 0;
    const gearCount = usesGear
      ? pendingReactionRoll.fixedGearDice !== undefined
        ? Math.max(0, pendingReactionRoll.fixedGearDice)
        : rollableGearBonus(gearItem)
      : 0;

    setRollStates((prev) => ({
      ...prev,
      [rollAttribute]: {
        attributeDice: Array.from({ length: attrCount }, () => Math.floor(Math.random() * 6) + 1),
        skillDice: Array.from({ length: skillCount }, () => Math.floor(Math.random() * 6) + 1),
        skillIsNegative,
        gearDice: Array.from({ length: gearCount }, () => Math.floor(Math.random() * 6) + 1),
        poolUsed: gearCount > 0 ? "all" : "attribute+skill",
        hasBeenPushed: false,
        requiredSuccesses: 1,
        gearItemId: gearItem?.id,
      },
    }));
    if (usesGear) {
      resetEffectiveAfterGearUse(gearItem);
    }

    onConsumePendingReactionRoll(pendingReactionRoll.id);
    handledPendingReactionRollIdRef.current = pendingReactionRoll.id;
  }, [character, pendingReactionRoll]);

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const gearWithBonus = (character.inventory || []).filter(item => item.gearBonus && item.gearBonus > 0);
  const currentRoll = selectedAttribute ? rollStates[selectedAttribute] : null;
  const hasRoll = selectedAttribute ? hasRollFor(selectedAttribute) : false;
  const canPush = hasRoll && currentRoll && !currentRoll.hasBeenPushed;
  const parsedBonusDice = parseInt(bonusDice, 10);
  const normalizedBonusDice = Number.isNaN(parsedBonusDice) ? 0 : parsedBonusDice;
  const hasSkillPool = selectedSkill !== null || normalizedBonusDice !== 0;

  return (
    <>
      <div className="flex flex-col gap-4 pb-4">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-amber-400 drop-shadow-lg">
            {character.name}
          </h2>
          <div className="flex items-center justify-center gap-2 mt-1">
            <p className="text-amber-200">
              Age: {character.age} | Gender: {character.gender} | XP: {character.xp ?? 6} | Spirits: {character.spirits}
            </p>
            <button
              onClick={decrementSpirit}
              disabled={(character.spirits ?? 0) <= 0}
              className="bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold w-6 h-6 rounded-full transition-all text-sm"
            >
              -
            </button>
            <button
              onClick={incrementSpirit}
              className="bg-green-600 hover:bg-green-500 text-white font-bold w-6 h-6 rounded-full transition-all text-sm"
            >
              +
            </button>
          </div>
        </div>

        {/* Gear Selection */}
        {gearWithBonus.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-3 border border-purple-500/40">
            <h3 className="text-sm font-bold text-purple-300 mb-2">Select Gear</h3>
            <div className="flex flex-wrap gap-2">
              {gearWithBonus.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleGearClick(item)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    selectedGear?.id === item.id
                      ? "bg-purple-600 text-white ring-2 ring-purple-400"
                      : "bg-gray-700 text-purple-200 hover:bg-gray-600"
                  }`}
                >
                  {item.name} {formatGearBonusLabel(item)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          {attributesOrder.map(attr => {
            const attrSkills = characterSkills.filter(skill => skill.attribute === attr);
            const isAttrSelected = selectedAttribute === attr;

            return (
              <div key={attr}>
                <div
                  className={`bg-gray-700 rounded-lg p-3 flex flex-col items-center shadow-md transition-all cursor-pointer relative ${
                    isAttrSelected
                      ? "ring-2 ring-amber-400 bg-gray-600"
                      : "hover:shadow-amber-500"
                  }`}
                  onClick={() => handleAttributeClick(attr)}
                >
                  <span className="text-lg font-bold text-amber-200">{attr}</span>
                  <div className="w-full bg-gray-600 h-3 rounded-full mt-1.5">
                    <div
                      className="bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 h-3 rounded-full transition-all"
                      style={{
                        width: `${(character.attributes[attr] / character.max_attributes[attr]) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="mt-1 text-amber-100 font-semibold text-sm">{character.attributes[attr]}</span>
                  <div className="flex gap-2 mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => decrementAttribute(attr)}
                      disabled={character.attributes[attr] <= 0}
                      className="bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold w-7 h-7 rounded-full transition-all text-sm"
                    >
                      -
                    </button>
                    <button
                      onClick={() => incrementAttribute(attr)}
                      disabled={character.attributes[attr] >= character.max_attributes[attr]}
                      className="bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold w-7 h-7 rounded-full transition-all text-sm"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Skill cards - compact version */}
                <div className="mt-2 grid grid-rows-4 gap-2">
                  {attrSkills.map(skill => (
                    <div
                      key={skill.name}
                      onClick={() => handleSkillClick(skill.name, attr)}
                      className={`bg-gray-700 rounded-lg p-2 flex items-center justify-between shadow-md transition-all hover:scale-105 cursor-pointer ${
                        selectedSkill === skill.name
                          ? "ring-2 ring-blue-400 bg-gray-600"
                          : "hover:shadow-amber-400"
                      }`}
                    >
                      <span className="font-bold text-amber-200 text-sm">{skill.name}</span>
                      <span className="text-amber-100 font-semibold text-sm">{skill.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed Roll Menu at Bottom */}
      {selectedAttribute && (
        <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900 via-gray-800 to-transparent border-t-2 border-amber-500/50 shadow-2xl z-50">
          <div className="max-w-7xl mx-auto p-4">
            <div className="bg-gray-800 rounded-xl p-4 border border-amber-600/40">
              <div className="flex items-start gap-6">
                {/* Left: Roll Options */}
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-amber-300 font-bold text-sm">
                      Rolling: {selectedAttribute}
                      {selectedSkill && ` + ${selectedSkill}`}
                      {normalizedBonusDice !== 0 && ` ${normalizedBonusDice > 0 ? "+" : "-"} Bonus ${Math.abs(normalizedBonusDice)}`}
                      {selectedGear && ` + ${selectedGear.name}`}
                    </h3>
                    {hasRoll && !currentRoll?.hasBeenPushed && (
                      <button
                        onClick={() => clearRollAndResolveSpirit(selectedAttribute)}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg text-sm font-semibold transition-all"
                      >
                        Clear Roll
                      </button>
                    )}
                  </div>
                  <div className="mb-3">
                    <label className="text-xs text-amber-300 font-semibold mr-2">Bonus Dice:</label>
                    <input
                      type="number"
                      value={bonusDice}
                      onChange={(e) => setBonusDice(e.target.value)}
                      disabled={hasRoll}
                      className="w-24 px-2 py-1 rounded bg-gray-700 border border-gray-600 text-amber-100 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                    />
                    <label className="text-xs text-amber-300 font-semibold ml-4 mr-2">Required 6s:</label>
                    <input
                      type="number"
                      min={0}
                      value={rollStates[selectedAttribute].requiredSuccesses}
                      onChange={(e) => handleRequiredSuccessesChange(selectedAttribute, e.target.value)}
                      className="w-20 px-2 py-1 rounded bg-gray-700 border border-gray-600 text-amber-100 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  
                  {!hasRoll && (
                    <div className="flex flex-wrap gap-2 max-w-md">
                      {/* All */}
                      {hasSkillPool && selectedGear && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "all")}
                          className="bg-gradient-to-r from-amber-500 via-blue-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          All Pools
                        </button>
                      )}

                      {/* 2-pool combos */}
                      {hasSkillPool && selectedGear && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "skill+gear")}
                          className="bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          Skill + Gear
                        </button>
                      )}
                      {selectedGear && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "attribute+gear")}
                          className="bg-gradient-to-r from-amber-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          Attr + Gear
                        </button>
                      )}
                      {hasSkillPool && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "attribute+skill")}
                          className="bg-gradient-to-r from-amber-500 to-blue-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          Attr + Skill
                        </button>
                      )}

                      {/* Singles */}
                      {selectedGear && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "gear")}
                          className="bg-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          Gear Only
                        </button>
                      )}
                      {hasSkillPool && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "skill")}
                          className="bg-blue-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          Skill Only
                        </button>
                      )}
                      <button
                        onClick={() => rollDice(selectedAttribute, "attribute")}
                        className="bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                      >
                        Attribute Only
                      </button>
                    </div>
                  )}

                  {/* Push options */}
                  {canPush && currentRoll && (
                    <div className="flex flex-wrap gap-2 max-w-md">
                      <p className="text-xs text-amber-300 font-semibold w-full mb-1">Push:</p>
                      {/* All */}
                      {currentRoll.attributeDice.length > 0 && currentRoll.skillDice.length > 0 && currentRoll.gearDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["attribute", "skill", "gear"])}
                          className="bg-gradient-to-r from-red-500 to-orange-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ All Pools
                        </button>
                      )}

                      {/* 2-pool combos */}
                      {currentRoll.skillDice.length > 0 && currentRoll.gearDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["skill", "gear"])}
                          className="bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Skill + Gear
                        </button>
                      )}
                      {currentRoll.attributeDice.length > 0 && currentRoll.gearDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["attribute", "gear"])}
                          className="bg-gradient-to-r from-amber-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Attr + Gear
                        </button>
                      )}
                      {currentRoll.attributeDice.length > 0 && currentRoll.skillDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["attribute", "skill"])}
                          className="bg-gradient-to-r from-amber-500 to-blue-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Attr + Skill
                        </button>
                      )}

                      {/* Singles */}
                      {currentRoll.gearDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["gear"])}
                          className="bg-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Gear
                        </button>
                      )}
                      {currentRoll.skillDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["skill"])}
                          className="bg-blue-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Skill
                        </button>
                      )}
                      {currentRoll.attributeDice.length > 0 && (
                        <button
                          onClick={() => pushDice(selectedAttribute, ["attribute"])}
                          className="bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          ⚡ Attribute
                        </button>
                      )}
                    </div>
                  )}

                  {/* Clear button after push */}
                  {hasRoll && currentRoll?.hasBeenPushed && (
                    <button
                      onClick={() => clearRollAndResolveSpirit(selectedAttribute)}
                      className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg text-sm font-semibold transition-all"
                    >
                      Clear Roll
                    </button>
                  )}
                </div>

                {/* Right: Dice Results */}
                {hasRoll && currentRoll && (
                  <div className="flex-1 flex gap-4">
                    {currentRoll.attributeDice.length > 0 && (
                      <div className="flex-1">
                        <p className="text-xs text-amber-300 mb-2 font-semibold">Attribute:</p>
                        <div className="flex gap-2 flex-wrap">
                          {currentRoll.attributeDice.map((die, i) => (
                            <div key={`attr-${i}`}>
                              {renderDie(die, false, "attribute")}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {currentRoll.skillDice.length > 0 && (
                      <div className="flex-1">
                        <p className={`text-xs mb-2 font-semibold ${currentRoll.skillIsNegative ? "text-red-300" : "text-blue-300"}`}>
                          {currentRoll.skillIsNegative ? "Negative Skill:" : "Skill:"}
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {currentRoll.skillDice.map((die, i) => (
                            <div key={`skill-${i}`}>
                              {renderDie(die, false, currentRoll.skillIsNegative ? "negativeSkill" : "skill")}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {currentRoll.gearDice.length > 0 && (
                      <div className="flex-1">
                        <p className="text-xs text-purple-300 mb-2 font-semibold">Gear:</p>
                        <div className="flex gap-2 flex-wrap">
                          {currentRoll.gearDice.map((die, i) => (
                            <div key={`gear-${i}`}>
                              {renderDie(die, false, "gear")}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
