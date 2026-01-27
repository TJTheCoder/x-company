"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

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

type Character = {
  id: string;
  name: string;
  email: string;
  age: number;
  gender: string;
  attributes: Attributes;
  max_attributes: Attributes;
  skills: Record<string, number>;
  spirits: number;
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

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"character" | "combat">("character");
  const [character, setCharacter] = useState<Character | null>(null);
  const [diceResults, setDiceResults] = useState<Record<string, number[]>>({
    STR: [],
    AGL: [],
    WIT: [],
    EMP: [],
  });
  const [pushActive, setPushActive] = useState<keyof Attributes | null>(null);

  useEffect(() => {
    async function fetchCharacter() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) return;

      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("email", email)
        .single();

      if (error) console.error(error);
      else setCharacter(data);
    }
    fetchCharacter();
  }, []);

  const rollDice = (attr: keyof Attributes) => {
    if (!character) return;
    const count = character.attributes[attr];

    const results = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);

    // Reset all dice except current attribute
    const newDiceState: Record<string, number[]> = {
      STR: [],
      AGL: [],
      WIT: [],
      EMP: [],
      [attr]: results,
    };

    setDiceResults(newDiceState);
    setPushActive(attr);
  };

  const pushDice = async (attr: keyof Attributes) => {
    if (!character) return;

    const oldDice = diceResults[attr];
    const newDice = oldDice.map(d => (d === 1 || d === 6 ? d : Math.floor(Math.random() * 6) + 1));

    const totalSixes = newDice.filter(d => d === 6).length;
    const totalOnes = newDice.filter(d => d === 1).length;

    const extraSpirit = totalSixes > 1 ? totalSixes - 1 : 0;
    const attrDecrease = totalOnes;

    const newSpirits = (character.spirits ?? 0) + extraSpirit;
    const newAttrValue = Math.max(0, (character.attributes[attr] ?? 0) - attrDecrease);

    const updatedCharacter = {
      ...character,
      spirits: newSpirits,
      attributes: { ...character.attributes, [attr]: newAttrValue },
    };
    setCharacter(updatedCharacter);

    // Freeze dice
    setDiceResults(prev => ({ ...prev, [attr]: newDice }));
    setPushActive(null);

    const supabase = createClient();
    await supabase
      .from("characters")
      .update({
        attributes: updatedCharacter.attributes,
        spirits: updatedCharacter.spirits,
      })
      .eq("id", character.id);
  };

  const restCharacter = async () => {
    if (!character) return;
    const maxAttrs = (character as any).max_attributes || character.attributes;
    const resetCharacter = { ...character, spirits: 0, attributes: maxAttrs };
    setCharacter(resetCharacter);
    setDiceResults({ STR: [], AGL: [], WIT: [], EMP: [] });
    setPushActive(null);

    const supabase = createClient();
    await supabase
      .from("characters")
      .update({ spirits: 0, attributes: maxAttrs })
      .eq("id", character.id);
  };

  const attributesOrder: (keyof Attributes)[] = ["STR", "AGL", "WIT", "EMP"];
  const characterSkills = allSkills.map(skill => ({
    ...skill,
    points: character?.skills[skill.name] ?? 0,
  }));

  const renderDie = (num: number, bouncing: boolean) => {
    const icon = num === 6 ? "✅" : num === 1 ? "❌" : "⚪";
    const color = num === 6 ? "text-green-400" : num === 1 ? "text-red-500" : "text-gray-400";
    return (
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${bouncing ? "animate-bounce" : ""} bg-gray-700`}
      >
        <span className={`text-xl font-bold ${color}`}>{icon}</span>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950 text-amber-50 font-serif p-8">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4 border-b border-amber-500">
            <button
              onClick={() => setActiveTab("character")}
              className={`px-6 py-3 font-semibold rounded-t-lg ${
                activeTab === "character"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Character
            </button>
            <button
              onClick={() => setActiveTab("combat")}
              className={`px-6 py-3 font-semibold rounded-t-lg ${
                activeTab === "combat"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Combat
            </button>
          </div>
          <button
            onClick={restCharacter}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg shadow-md font-semibold"
          >
            Rest
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-800 p-8 rounded-3xl shadow-2xl min-h-[400px] border border-amber-600/40">
          {activeTab === "character" && (
            <>
              {character ? (
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
                      const isBouncing = pushActive === attr;
                      return (
                        <div key={attr}>
                          <div
                            className="bg-gray-700 rounded-lg p-4 flex flex-col items-center shadow-md hover:shadow-amber-500 transition cursor-pointer"
                            onClick={() => rollDice(attr)}
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
                          </div>

                          {pushActive === attr && (
                            <button
                              onClick={() => pushDice(attr)}
                              className="mt-2 w-full bg-amber-500 text-gray-900 rounded-lg py-2 font-bold hover:scale-105 transition"
                            >
                              Push
                            </button>
                          )}

                          {diceResults[attr].length > 0 && (
                            <div className="flex gap-2 mt-4 flex-wrap justify-center">
                              {diceResults[attr].map((die, i) => renderDie(die, isBouncing))}
                            </div>
                          )}

                          <div className="mt-4 grid grid-rows-4 gap-4">
                            {attrSkills.map(skill => (
                              <div
                                key={skill.name}
                                className="bg-gray-700 rounded-lg p-4 flex flex-col justify-between shadow-md hover:shadow-amber-400 transition-all hover:scale-105 h-40"
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
              ) : (
                <p className="text-amber-300 text-center">No character found for your account.</p>
              )}
            </>
          )}
          {activeTab === "combat" && (
            <p className="text-amber-300 text-center">Under Construction!</p>
          )}
        </div>
      </div>
    </main>
  );
}
