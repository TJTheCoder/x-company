"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeInventoryItems } from "@/lib/item-catalog";
import Character from "../../components/character";
import Inventory from "../../components/inventory";
import Arts from "../../components/arts";
import Talents from "../../components/talents";
import Wagon from "../../components/wagon";
import Combat from "../../components/combat";
import Poll from "../../components/poll";
import Kogra from "../../components/kogra";
import Monsters from "../../components/monsters";

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
  quantity?: number;
  item_key?: string;
  item_type?: string;
  wield?: "1H" | "2H";
  damage?: number;
  range_band?: string;
  properties?: string[];
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

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<
    "character" | "inventory" | "arts" | "talents" | "wagon" | "combat" | "monsters" | "poll" | "kogra"
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
            />
          )}
          {activeTab === "kogra" && (
            <Kogra
              character={character}
              userEmail={effectiveUserEmail}
            />
          )}
        </div>
      </div>
    </main>
  );
}
