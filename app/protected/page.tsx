"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Character from "../../components/character";
import Inventory from "../../components/inventory";
import Combat from "../../components/combat";

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
  attributes: Attributes;
  max_attributes: Attributes;
  skills: Record<string, number>;
  spirits: number;
  inventory?: InventoryItem[];
};

export type InventoryItem = {
  id: string;
  name: string;
  weight: number;
  gearBonus?: number;
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"character" | "inventory" | "combat">("character");
  const [character, setCharacter] = useState<CharacterType | null>(null);

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
      else {
        // Initialize inventory if it doesn't exist
        if (!data.inventory) {
          data.inventory = [];
        }
        setCharacter(data);
      }
    }
    fetchCharacter();
  }, []);

  const updateCharacter = (updates: Partial<CharacterType>) => {
    if (!character) return;
    const updatedCharacter = { ...character, ...updates };
    setCharacter(updatedCharacter);
  };

  const saveCharacter = async (updates: Partial<CharacterType>) => {
    if (!character) return;
    const supabase = createClient();
    await supabase
      .from("characters")
      .update(updates)
      .eq("id", character.id);
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

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-950 text-amber-50 font-serif p-8">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4 border-b border-amber-500">
            <button
              onClick={() => setActiveTab("character")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "character"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Character
            </button>
            <button
              onClick={() => setActiveTab("inventory")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "inventory"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Inventory
            </button>
            <button
              onClick={() => setActiveTab("combat")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
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
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
          >
            Rest
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-800 p-8 rounded-3xl shadow-2xl min-h-[400px] border border-amber-600/40">
          {activeTab === "character" && (
            <Character
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
            />
          )}
          {activeTab === "inventory" && (
            <Inventory
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
            />
          )}
          {activeTab === "combat" && <Combat />}
        </div>
      </div>
    </main>
  );
}