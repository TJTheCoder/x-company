"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import Character from "../../components/character";
import Inventory from "../../components/inventory";
import Arts from "../../components/arts";
import Wagon from "../../components/wagon";
import Combat from "../../components/combat";
import Poll from "../../components/poll";
import Kogra from "../../components/kogra";

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
  known_art_ids?: string[];
  equipped_art_ids?: string[];
  // Legacy fields kept for compatibility with older rows.
  arts?: Art[];
  equipped_arts?: Art[];
  icon_url?: string;
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
  const [activeTab, setActiveTab] = useState<"character" | "inventory" | "arts" | "wagon" | "combat" | "poll" | "kogra">("character");
  const [character, setCharacter] = useState<CharacterType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allCharacters, setAllCharacters] = useState<CharacterType[]>([]);
  const [showCharacterSelect, setShowCharacterSelect] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [wagonData, setWagonData] = useState<WagonData>({ wagon1: [], wagon2: [] });
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [notification, setNotification] = useState<NotificationData | null>(null);
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
        setAllCharacters(chars || []);
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

  const dismissNotification = async () => {
    if (!notification) return;
    
    const supabase = createClient();
    await supabase
      .from("notifications")
      .delete()
      .eq("id", notification.id);
    
    setNotification(null);
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
      <div className="max-w-7xl mx-auto flex flex-col gap-4 relative">
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
              onClick={() => setActiveTab("arts")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "arts"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Arts
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
{/*             <button
              onClick={() => setActiveTab("combat")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "combat"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Combat
            </button> */}
            <button
              onClick={() => setActiveTab("poll")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "poll"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Poll
            </button>
            <button
              onClick={() => setActiveTab("kogra")}
              className={`px-6 py-3 font-semibold rounded-t-lg transition-all ${
                activeTab === "kogra"
                  ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 text-gray-900 shadow-lg"
                  : "bg-gray-800 text-amber-200 hover:bg-gray-700"
              }`}
            >
              Kogra
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
          {activeTab === "arts" && (
            <Arts
              character={character}
              updateCharacter={updateCharacter}
              saveCharacter={saveCharacter}
            />
          )}
          {activeTab === "combat" && <Combat />}
          {activeTab === "poll" && (
            <Poll
              character={character}
              allCharacters={allCharacters}
            />
          )}
          {activeTab === "kogra" && (
            <Kogra
              character={character}
              userEmail={userEmail}
            />
          )}
        </div>
      </div>
    </main>
  );
}
