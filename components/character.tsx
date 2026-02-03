"use client";

import { useState } from "react";
import { CharacterType, InventoryItem } from "../app/protected/page";

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
  gearDice: number[];
  poolUsed: DicePool;
  hasBeenPushed: boolean;
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
};

const emptyRoll = (): RollState => ({
  attributeDice: [],
  skillDice: [],
  gearDice: [],
  poolUsed: "attribute",
  hasBeenPushed: false,
});

export default function Character({ character, updateCharacter, saveCharacter }: CharacterProps) {
  const [rollStates, setRollStates] = useState<Record<string, RollState>>({
    STR: emptyRoll(),
    AGL: emptyRoll(),
    WIT: emptyRoll(),
    EMP: emptyRoll(),
  });
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<keyof Attributes | null>(null);
  const [selectedGear, setSelectedGear] = useState<InventoryItem | null>(null);

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

  // Silently clear the roll on a DIFFERENT attribute without touching selections
  // (selections will be overwritten by the caller immediately after).
  const clearPreviousRoll = (incomingAttr: keyof Attributes) => {
    if (!selectedAttribute || selectedAttribute === incomingAttr) return;
    if (hasRollFor(selectedAttribute)) {
      setRollStates(prev => ({ ...prev, [selectedAttribute]: emptyRoll() }));
    }
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
      clearEverything(attr);
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

  const rollDice = (attr: keyof Attributes, pool: DicePool) => {
    if (!character) return;

    const attrCount = character.attributes[attr];
    const skillPoints = selectedSkill ? (character.skills[selectedSkill] ?? 0) : 0;
    const gearBonus = selectedGear?.gearBonus ?? 0;

    let attributeDice: number[] = [];
    let skillDice: number[] = [];
    let gearDice: number[] = [];

    if (pool === "attribute" || pool === "attribute+skill" || pool === "attribute+gear" || pool === "all") {
      attributeDice = Array.from({ length: attrCount }, () => Math.floor(Math.random() * 6) + 1);
    }
    if (pool === "skill" || pool === "attribute+skill" || pool === "skill+gear" || pool === "all") {
      skillDice = Array.from({ length: skillPoints }, () => Math.floor(Math.random() * 6) + 1);
    }
    if (pool === "gear" || pool === "attribute+gear" || pool === "skill+gear" || pool === "all") {
      gearDice = Array.from({ length: gearBonus }, () => Math.floor(Math.random() * 6) + 1);
    }

    setRollStates(prev => ({
      ...prev,
      [attr]: {
        attributeDice,
        skillDice,
        gearDice,
        poolUsed: pool,
        hasBeenPushed: false,
        gearItemId: selectedGear?.id,
      },
    }));
  };

  const calculateSpiritGain = (attrSixes: number, skillSixes: number, gearSixes: number): number => {
    const totalSixes = attrSixes + skillSixes + gearSixes;
    if (totalSixes === 0) return 0;

    let remainingSixes = totalSixes;

    // First six doesn't count
    remainingSixes -= 1;

    // Only attribute and gear sixes can contribute to spirit gain
    const contributingSixes = attrSixes + gearSixes;

    return Math.min(remainingSixes, contributingSixes);
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

    // --- Consequence phase: ALL pools count, regardless of what was pushed ---
    const attrSixes = newAttributeDice.filter(d => d === 6).length;
    const skillSixes = newSkillDice.filter(d => d === 6).length;
    const gearSixes = newGearDice.filter(d => d === 6).length;

    const extraSpirit = calculateSpiritGain(attrSixes, skillSixes, gearSixes);

    // All attribute ones deal attribute damage; all gear ones deal gear damage.
    const attrOnes = newAttributeDice.filter(d => d === 1).length;
    const gearOnes = newGearDice.filter(d => d === 1).length;

    const attrDecrease = attrOnes;

    const newSpirits = (character.spirits ?? 0) + extraSpirit;
    const newAttrValue = Math.max(0, (character.attributes[attr] ?? 0) - attrDecrease);

    // Handle gear damage from ALL gear ones
    let updatedInventory = character.inventory || [];
    if (gearOnes > 0 && currentRoll.gearItemId) {
      updatedInventory = updatedInventory.map(item => {
        if (item.id === currentRoll.gearItemId && item.gearBonus) {
          const newGearBonus = Math.max(0, item.gearBonus - gearOnes);
          return { ...item, gearBonus: newGearBonus > 0 ? newGearBonus : undefined };
        }
        return item;
      }).filter(item => {
        if (item.id === currentRoll.gearItemId && item.gearBonus === undefined) {
          return false;
        }
        return true;
      });

      const gearStillExists = updatedInventory.find(item => item.id === currentRoll.gearItemId);
      if (!gearStillExists) {
        setSelectedGear(null);
      }
    }

    const updates = {
      spirits: newSpirits,
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
        gearDice: newGearDice,
        poolUsed: currentRoll.poolUsed,
        hasBeenPushed: true,
        gearItemId: currentRoll.gearItemId,
      },
    }));
  };

  const attributesOrder: (keyof Attributes)[] = ["STR", "AGL", "WIT", "EMP"];
  const characterSkills = allSkills.map(skill => ({
    ...skill,
    points: character?.skills[skill.name] ?? 0,
  }));

  const renderDie = (num: number, bouncing: boolean, dieType: "attribute" | "skill" | "gear") => {
    const icon = num === 6 ? "✅" : num === 1 ? "❌" : "⚪";
    const color = num === 6 ? "text-green-400" : num === 1 ? "text-red-500" : "text-gray-400";
    const bgColor = dieType === "skill" ? "bg-blue-700" : dieType === "gear" ? "bg-purple-700" : "bg-gray-700";
    const borderColor = dieType === "skill" ? "border-blue-400" : dieType === "gear" ? "border-purple-400" : "border-gray-500";

    return (
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${bouncing ? "animate-bounce" : ""} ${bgColor} border-2 ${borderColor}`}
      >
        <span className={`text-xl font-bold ${color}`}>{icon}</span>
      </div>
    );
  };

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const gearWithBonus = (character.inventory || []).filter(item => item.gearBonus && item.gearBonus > 0);
  const currentRoll = selectedAttribute ? rollStates[selectedAttribute] : null;
  const hasRoll = selectedAttribute ? hasRollFor(selectedAttribute) : false;
  const canPush = hasRoll && currentRoll && !currentRoll.hasBeenPushed;

  return (
    <>
      <div className="flex flex-col gap-4 pb-4">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-amber-400 drop-shadow-lg">
            {character.name}
          </h2>
          <p className="text-amber-200 mt-1">
            Age: {character.age} | Gender: {character.gender} | Spirits: {character.spirits}
          </p>
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
                  {item.name} (+{item.gearBonus})
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          {attributesOrder.map(attr => {
            const attrSkills = characterSkills.filter(skill => skill.attribute === attr);
            const hasRoll = hasRollFor(attr);
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
                  {hasRoll && (
                    <div className="absolute top-1 right-1 text-xs text-amber-300 bg-gray-800 px-1.5 py-0.5 rounded">
                      Clear
                    </div>
                  )}
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
                  <h3 className="text-amber-300 font-bold mb-2 text-sm">
                    Rolling: {selectedAttribute}
                    {selectedSkill && ` + ${selectedSkill}`}
                    {selectedGear && ` + ${selectedGear.name}`}
                  </h3>
                  
                  {!hasRoll && (
                    <div className="flex flex-wrap gap-2 max-w-md">
                      {/* All */}
                      {selectedSkill && selectedGear && (
                        <button
                          onClick={() => rollDice(selectedAttribute, "all")}
                          className="bg-gradient-to-r from-amber-500 via-blue-500 to-purple-500 text-white rounded px-3 py-1.5 text-sm font-bold hover:scale-105 transition-all"
                        >
                          All Pools
                        </button>
                      )}

                      {/* 2-pool combos */}
                      {selectedSkill && selectedGear && (
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
                      {selectedSkill && (
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
                      {selectedSkill && (
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
                        <p className="text-xs text-blue-300 mb-2 font-semibold">Skill:</p>
                        <div className="flex gap-2 flex-wrap">
                          {currentRoll.skillDice.map((die, i) => (
                            <div key={`skill-${i}`}>
                              {renderDie(die, false, "skill")}
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