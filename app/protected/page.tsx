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
};

type Character = {
  name: string;
  age: number;
  gender: string;
  attributes: Attributes;
  skills: Record<string, number>;
  spirits: number;
};

// Full skill descriptions
const allSkills: Skill[] = [
  { name: "MIGHT", description: "Push, pull, or lift.", points: 0 },
  { name: "ENDURANCE", description: "Push through extended travel or extreme weather.", points: 0 },
  { name: "MELEE", description: "Attack or parry.", points: 0 },
  { name: "CRAFTING", description: "Repairing or crafting.", points: 0 },

  { name: "STEALTH", description: "Sneak through area or sneak attacks.", points: 0 },
  { name: "MOVE", description: "Move through tricky situations or evade.", points: 0 },
  { name: "SLEIGHT OF HAND", description: "Pick locks or steal items.", points: 0 },
  { name: "MARKSMANSHIP", description: "Ranged attacks.", points: 0 },

  { name: "SCOUTING", description: "Detect objects or perceive sneakers.", points: 0 },
  { name: "LORE", description: "Recall legends or information.", points: 0 },
  { name: "SURVIVAL", description: "Survive in the wilderness.", points: 0 },
  { name: "INSIGHT", description: "Resist manipulation or determine state of mind.", points: 0 },

  { name: "MANIPULATE", description: "Manipulate creatures into doing something.", points: 0 },
  { name: "HEALING", description: "Heal physically broken creatures.", points: 0 },
  { name: "PERFORMANCE", description: "Heal mentally broken creatures or taunt enemies.", points: 0 },
  { name: "ANIMAL HANDLING", description: "Ride animals, tame wild ones, or command tamed ones.", points: 0 },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"character" | "combat">("character");
  const [character, setCharacter] = useState<Character | null>(null);

  useEffect(() => {
    async function fetchCharacter() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const userEmail = session?.user?.email;
      if (!userEmail) return;

      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("email", userEmail)
        .single();

      if (error) {
        console.error("Error fetching character:", error);
      } else {
        setCharacter(data);
      }
    }

    fetchCharacter();
  }, []);

  // Map skills with character points
  const characterSkills = allSkills.map(skill => ({
    ...skill,
    points: character?.skills[skill.name] ?? 0,
  }));

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-amber-50 font-serif p-8">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex gap-4 border-b border-amber-500 mb-6">
          <button
            onClick={() => setActiveTab("character")}
            className={`px-6 py-3 font-semibold rounded-t-lg ${
              activeTab === "character"
                ? "bg-amber-500 text-gray-900 shadow-lg"
                : "bg-gray-800 text-amber-200 hover:bg-gray-700"
            }`}
          >
            Character
          </button>
          <button
            onClick={() => setActiveTab("combat")}
            className={`px-6 py-3 font-semibold rounded-t-lg ${
              activeTab === "combat"
                ? "bg-amber-500 text-gray-900 shadow-lg"
                : "bg-gray-800 text-amber-200 hover:bg-gray-700"
            }`}
          >
            Combat
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl min-h-[400px]">
          {activeTab === "character" && (
            <>
              {character ? (
                <div className="flex flex-col gap-8">
                  {/* Name / Basic Info */}
                  <div>
                    <h2 className="text-4xl font-extrabold text-amber-400 drop-shadow-lg">{character.name}</h2>
                    <p className="text-amber-200 mt-1">
                      Age: {character.age} | Gender: {character.gender} | Spirits: {character.spirits}
                    </p>
                  </div>

                  {/* Attributes */}
                  <div>
                    <h3 className="text-2xl font-semibold mb-4 text-amber-300">Attributes</h3>
                    <div className="grid grid-cols-4 gap-6">
                      {Object.entries(character.attributes).map(([attr, val]) => (
                        <div key={attr} className="bg-gray-700 rounded-lg p-4 flex flex-col items-center shadow-md hover:shadow-amber-500 transition">
                          <span className="text-lg font-bold text-amber-200">{attr}</span>
                          <div className="w-full bg-gray-600 h-4 rounded-full mt-2">
                            <div
                              className="bg-amber-400 h-4 rounded-full transition-all"
                              style={{ width: `${(val / val) * 100}%` }}
                            />
                          </div>
                          <span className="mt-1 text-amber-100 font-semibold">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Skills */}
                  <div>
                    <h3 className="text-2xl font-semibold mb-4 text-amber-300">Skills</h3>
                    <div className="grid grid-cols-4 gap-6">
                      {characterSkills.map(skill => (
                        <div
                          key={skill.name}
                          className="bg-gray-700 rounded-lg p-4 flex flex-col justify-between shadow-md hover:shadow-amber-400 transition-all hover:scale-105"
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
                </div>
              ) : (
                <p className="text-amber-300">No character found for your account.</p>
              )}
            </>
          )}

          {activeTab === "combat" && (
            <p className="text-amber-300">Combat tab (empty for now)</p>
          )}
        </div>
      </div>
    </main>
  );
}
