"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import Character from "../../components/character";
import Inventory from "../../components/inventory";
import Wagon from "../../components/wagon";
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

type WagonData = {
  wagon1: InventoryItem[];
  wagon2: InventoryItem[];
};

const ADMIN_EMAIL = "drocasma9@gmail.com";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"character" | "inventory" | "wagon" | "combat">("character");
  const [character, setCharacter] = useState<CharacterType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allCharacters, setAllCharacters] = useState<CharacterType[]>([]);
  const [showCharacterSelect, setShowCharacterSelect] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [wagonData, setWagonData] = useState<WagonData>({ wagon1: [], wagon2: [] });

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

      if (adminUser) {
        // Fetch all characters for admin
        const { data: chars, error } = await supabase
          .from("characters")
          .select("*")
          .order("name");

        if (error) {
          console.error(error);
        } else {
          setAllCharacters(chars || []);
          setShowCharacterSelect(true);
        }
      } else {
        // Fetch user's character
        await fetchCharacter(email);
      }
    }
    initializeCharacter();
  }, []);

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
      setWagonData({
        wagon1: data.wagon1 || [],
        wagon2: data.wagon2 || [],
      });
    }
  };

  const fetchCharacter = async (email: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .eq("email", email)
      .single();

    if (error) {
      console.error(error);
    } else {
      // Initialize inventory if it doesn't exist
      if (!data.inventory) {
        data.inventory = [];
      }
      setCharacter(data);
      setShowCharacterSelect(false);
    }
  };

  const selectCharacter = async (characterId: string) => {
    const selectedChar = allCharacters.find(c => c.id === characterId);
    if (selectedChar) {
      // Initialize inventory if it doesn't exist
      if (!selectedChar.inventory) {
        selectedChar.inventory = [];
      }
      setCharacter(selectedChar);
      setShowCharacterSelect(false);
    }
  };

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

  const switchCharacter = () => {
    setShowCharacterSelect(true);
    setCharacter(null);
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
              onClick={() => setActiveTab("wagon")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "wagon"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Wagon
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
          <div className="flex gap-3">
            {isAdmin && character && (
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
            />
          )}
          {activeTab === "inventory" && (
            <Inventory
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
              wagonData={wagonData}
              setWagonData={setWagonData}
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
          {activeTab === "combat" && <Combat />}
        </div>
      </div>
    </main>
  );
}