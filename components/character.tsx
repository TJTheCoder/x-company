"use client";

import { useState } from "react";
import { CharacterType } from "../app/protected/page";

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

type DicePool = "attribute" | "skill" | "both";

type RollState = {
  attributeDice: number[];
  skillDice: number[];
  poolUsed: DicePool;
  hasBeenPushed: boolean;
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

export default function Character({ character, updateCharacter, saveCharacter }: CharacterProps) {
  const [rollStates, setRollStates] = useState<Record<string, RollState>>({
    STR: { attributeDice: [], skillDice: [], poolUsed: "attribute", hasBeenPushed: false },
    AGL: { attributeDice: [], skillDice: [], poolUsed: "attribute", hasBeenPushed: false },
    WIT: { attributeDice: [], skillDice: [], poolUsed: "attribute", hasBeenPushed: false },
    EMP: { attributeDice: [], skillDice: [], poolUsed: "attribute", hasBeenPushed: false },
  });
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedAttribute, setSelectedAttribute] = useState<keyof Attributes | null>(null);
  const [showPoolSelector, setShowPoolSelector] = useState<keyof Attributes | null>(null);

  const clearRoll = (attr: keyof Attributes) => {
    setRollStates(prev => ({
      ...prev,
      [attr]: { attributeDice: [], skillDice: [], poolUsed: "attribute", hasBeenPushed: false },
    }));
    setShowPoolSelector(null);
  };

  const handleSkillClick = (skillName: string, skillAttr: keyof Attributes) => {
    if (selectedSkill === skillName) {
      setSelectedSkill(null);
      setSelectedAttribute(null);
    } else {
      setSelectedSkill(skillName);
      setSelectedAttribute(skillAttr);
      
      const currentRoll = rollStates[skillAttr];
      const hasRoll = currentRoll.attributeDice.length > 0 || currentRoll.skillDice.length > 0;
      if (!hasRoll) {
        setShowPoolSelector(skillAttr);
      }
    }
  };

  const handleAttributeClick = (attr: keyof Attributes) => {
    const currentRoll = rollStates[attr];
    const hasRoll = currentRoll.attributeDice.length > 0 || currentRoll.skillDice.length > 0;

    if (hasRoll) {
      clearRoll(attr);
    } else {
      if (selectedAttribute === attr) {
        setSelectedAttribute(null);
        setSelectedSkill(null);
        setShowPoolSelector(null);
      } else {
        setSelectedAttribute(attr);
        const skill = allSkills.find(s => s.name === selectedSkill);
        if (skill && skill.attribute !== attr) {
          setSelectedSkill(null);
        }
        setShowPoolSelector(attr);
      }
    }
  };

  const rollDice = (attr: keyof Attributes, pool: DicePool) => {
    if (!character) return;

    const attrCount = character.attributes[attr];
    const skillPoints = selectedSkill ? (character.skills[selectedSkill] ?? 0) : 0;

    let attributeDice: number[] = [];
    let skillDice: number[] = [];

    if (pool === "attribute" || pool === "both") {
      attributeDice = Array.from({ length: attrCount }, () => Math.floor(Math.random() * 6) + 1);
    }

    if (pool === "skill" || pool === "both") {
      skillDice = Array.from({ length: skillPoints }, () => Math.floor(Math.random() * 6) + 1);
    }

    setRollStates(prev => ({
      ...prev,
      [attr]: { attributeDice, skillDice, poolUsed: pool, hasBeenPushed: false },
    }));
    setShowPoolSelector(null);
  };

  const calculateSpiritGain = (attrSixes: number, skillSixes: number): number => {
    const totalSixes = attrSixes + skillSixes;
    if (totalSixes === 0) return 0;
    
    let remainingSkillSixes = skillSixes;
    let remainingAttrSixes = attrSixes;
    
    if (remainingSkillSixes > 0) {
      remainingSkillSixes -= 1;
    } else if (remainingAttrSixes > 0) {
      remainingAttrSixes -= 1;
    }
    
    return remainingAttrSixes;
  };

  const pushDice = async (attr: keyof Attributes, pushPool: "attribute" | "skill" | "both") => {
    if (!character) return;

    const currentRoll = rollStates[attr];
    if (currentRoll.hasBeenPushed) return;

    let newAttributeDice = currentRoll.attributeDice;
    let newSkillDice = currentRoll.skillDice;

    if (pushPool === "attribute" || pushPool === "both") {
      newAttributeDice = currentRoll.attributeDice.map(d =>
        d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1
      );
    }

    if (pushPool === "skill" || pushPool === "both") {
      newSkillDice = currentRoll.skillDice.map(d =>
        d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1
      );
    }

    const attrSixes = newAttributeDice.filter(d => d === 6).length;
    const skillSixes = newSkillDice.filter(d => d === 6).length;
    
    const extraSpirit = calculateSpiritGain(attrSixes, skillSixes);

    const attrOnes = (pushPool === "attribute" || pushPool === "both") 
      ? newAttributeDice.filter(d => d === 1).length 
      : 0;
    const attrDecrease = attrOnes;

    const newSpirits = (character.spirits ?? 0) + extraSpirit;
    const newAttrValue = Math.max(0, (character.attributes[attr] ?? 0) - attrDecrease);

    const updates = {
      spirits: newSpirits,
      attributes: { ...character.attributes, [attr]: newAttrValue },
    };

    updateCharacter(updates);
    saveCharacter(updates);

    setRollStates(prev => ({
      ...prev,
      [attr]: {
        attributeDice: newAttributeDice,
        skillDice: newSkillDice,
        poolUsed: currentRoll.poolUsed,
        hasBeenPushed: true,
      },
    }));
  };

  const attributesOrder: (keyof Attributes)[] = ["STR", "AGL", "WIT", "EMP"];
  const characterSkills = allSkills.map(skill => ({
    ...skill,
    points: character?.skills[skill.name] ?? 0,
  }));

  const renderDie = (num: number, bouncing: boolean, isSkillDie: boolean) => {
    const icon = num === 6 ? "✅" : num === 1 ? "❌" : "⚪";
    const color = num === 6 ? "text-green-400" : num === 1 ? "text-red-500" : "text-gray-400";
    const bgColor = isSkillDie ? "bg-blue-700" : "bg-gray-700";
    
    return (
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${bouncing ? "animate-bounce" : ""} ${bgColor} border-2 ${isSkillDie ? "border-blue-400" : "border-gray-500"}`}
      >
        <span className={`text-xl font-bold ${color}`}>{icon}</span>
      </div>
    );
  };

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h2 className="text-4xl font-extrabold text-amber-400 drop-shadow-lg">
          {character.name}
        </h2>
        <p className="text-amber-200 mt-1">
          Age: {character.age} | Gender: {character.gender} | Spirits: {character.spirits}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-6 mt-6">
        {attributesOrder.map(attr => {
          const attrSkills = characterSkills.filter(skill => skill.attribute === attr);
          const currentRoll = rollStates[attr];
          const hasRoll = currentRoll.attributeDice.length > 0 || currentRoll.skillDice.length > 0;
          const canPush = hasRoll && !currentRoll.hasBeenPushed;
          const isAttrSelected = selectedAttribute === attr;
          
          return (
            <div key={attr}>
              <div
                className={`bg-gray-700 rounded-lg p-4 flex flex-col items-center shadow-md transition-all cursor-pointer relative ${
                  isAttrSelected 
                    ? "ring-2 ring-amber-400 bg-gray-600" 
                    : "hover:shadow-amber-500"
                }`}
                onClick={() => handleAttributeClick(attr)}
              >
                <span className="text-lg font-bold text-amber-200">{attr}</span>
                <div className="w-full bg-gray-600 h-4 rounded-full mt-2">
                  <div
                    className="bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 h-4 rounded-full transition-all"
                    style={{
                      width: `${(character.attributes[attr] / character.max_attributes[attr]) * 100}%`,
                    }}
                  />
                </div>
                <span className="mt-1 text-amber-100 font-semibold">{character.attributes[attr]}</span>
                {hasRoll && (
                  <div className="absolute top-2 right-2 text-xs text-amber-300 bg-gray-800 px-2 py-1 rounded">
                    Click to clear
                  </div>
                )}
              </div>

              {showPoolSelector === attr && !hasRoll && (
                <div className="mt-2 bg-gray-700 rounded-lg p-3 shadow-lg border border-amber-500">
                  <p className="text-sm text-amber-200 mb-2 font-semibold">Select Pool:</p>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => rollDice(attr, "attribute")}
                      className="bg-amber-500 text-gray-900 rounded py-2 font-bold hover:scale-105 transition-all"
                    >
                      Attribute Only
                    </button>
                    {selectedSkill && (
                      <>
                        <button
                          onClick={() => rollDice(attr, "skill")}
                          className="bg-blue-500 text-white rounded py-2 font-bold hover:scale-105 transition-all"
                        >
                          Skill Only ({selectedSkill})
                        </button>
                        <button
                          onClick={() => rollDice(attr, "both")}
                          className="bg-gradient-to-r from-amber-500 to-blue-500 text-white rounded py-2 font-bold hover:scale-105 transition-all"
                        >
                          Both Pools
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {canPush && (
                <div className="mt-2 bg-gray-900 rounded-lg p-2 border border-amber-600/30">
                  <p className="text-xs text-amber-300 mb-2 font-semibold text-center">Push:</p>
                  <div className="flex flex-col gap-2">
                    {currentRoll.attributeDice.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          pushDice(attr, "attribute");
                        }}
                        className="bg-amber-500 text-gray-900 rounded py-1.5 text-sm font-bold hover:scale-105 transition-all"
                      >
                        ⚡ Attribute
                      </button>
                    )}
                    {currentRoll.skillDice.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          pushDice(attr, "skill");
                        }}
                        className="bg-blue-500 text-white rounded py-1.5 text-sm font-bold hover:scale-105 transition-all"
                      >
                        ⚡ Skill
                      </button>
                    )}
                    {currentRoll.attributeDice.length > 0 && currentRoll.skillDice.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          pushDice(attr, "both");
                        }}
                        className="bg-gradient-to-r from-red-500 to-orange-500 text-white rounded py-1.5 text-sm font-bold hover:scale-105 transition-all"
                      >
                        ⚡ Both
                      </button>
                    )}
                  </div>
                </div>
              )}

              {hasRoll && (
                <div className="mt-4 bg-gray-900 rounded-lg p-3 border border-amber-600/30">
                  {currentRoll.attributeDice.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-amber-300 mb-2 font-semibold">Attribute Dice:</p>
                      <div className="flex gap-2 flex-wrap justify-center">
                        {currentRoll.attributeDice.map((die, i) => (
                          <div key={`attr-${i}`}>
                            {renderDie(die, false, false)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {currentRoll.skillDice.length > 0 && (
                    <div>
                      <p className="text-xs text-blue-300 mb-2 font-semibold">Skill Dice:</p>
                      <div className="flex gap-2 flex-wrap justify-center">
                        {currentRoll.skillDice.map((die, i) => (
                          <div key={`skill-${i}`}>
                            {renderDie(die, false, true)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 grid grid-rows-4 gap-4">
                {attrSkills.map(skill => (
                  <div
                    key={skill.name}
                    onClick={() => handleSkillClick(skill.name, attr)}
                    className={`bg-gray-700 rounded-lg p-4 flex flex-col justify-between shadow-md transition-all hover:scale-105 h-40 cursor-pointer ${
                      selectedSkill === skill.name
                        ? "ring-2 ring-blue-400 bg-gray-600"
                        : "hover:shadow-amber-400"
                    }`}
                  >
                    <div>
                      <span className="font-bold text-amber-200">{skill.name}</span>
                      <p className="text-amber-300 text-sm mt-1">{skill.description}</p>
                    </div>
                    <div className="mt-2 text-amber-100 font-semibold text-right">
                      Points: {skill.points}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}