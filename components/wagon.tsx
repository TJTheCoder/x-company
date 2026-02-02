"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CharacterType, InventoryItem } from "../app/protected/page";

type WagonData = {
  wagon1: InventoryItem[];
  wagon2: InventoryItem[];
};

type WagonProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
  wagonData: WagonData;
  setWagonData: (data: WagonData) => void;
  refreshWagons: () => Promise<void>;
};

export default function Wagon({ character, updateCharacter, saveCharacter, wagonData, setWagonData, refreshWagons }: WagonProps) {
  const [showAddItem, setShowAddItem] = useState<"wagon1" | "wagon2" | null>(null);
  const [editingItem, setEditingItem] = useState<{ wagon: "wagon1" | "wagon2"; itemId: string } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    weight: "",
    gearBonus: "",
  });
  const [error, setError] = useState("");

  const maxWagonWeight = 200;

  const saveWagons = async (updatedWagonData: WagonData) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("wagons")
      .upsert({ id: 1, wagon1: updatedWagonData.wagon1, wagon2: updatedWagonData.wagon2 });

    if (error) {
      console.error("Error saving wagons:", error);
      return false;
    }
    return true;
  };

  const resetForm = () => {
    setFormData({ name: "", weight: "", gearBonus: "" });
    setError("");
    setShowAddItem(null);
    setEditingItem(null);
  };

  const getCurrentWeight = (wagon: "wagon1" | "wagon2") => {
    return wagonData[wagon].reduce((sum, item) => sum + item.weight, 0);
  };

  const handleAddItem = async (wagon: "wagon1" | "wagon2") => {
    const name = formData.name.trim();
    const weight = parseFloat(formData.weight);
    const gearBonus = formData.gearBonus.trim() ? parseInt(formData.gearBonus) : undefined;

    if (!name) {
      setError("Item name is required");
      return;
    }

    if (isNaN(weight) || weight <= 0) {
      setError("Weight must be a positive number");
      return;
    }

    if (formData.gearBonus.trim() && (isNaN(gearBonus!) || gearBonus! <= 0)) {
      setError("Gear bonus must be a positive integer");
      return;
    }

    const currentWeight = getCurrentWeight(wagon);
    if (currentWeight + weight > maxWagonWeight) {
      setError(`Cannot add item: Would exceed wagon capacity (${(currentWeight + weight).toFixed(1)}/${maxWagonWeight})`);
      return;
    }

    const newItem: InventoryItem = {
      id: Date.now().toString() + Math.random(),
      name,
      weight,
      gearBonus,
    };

    const updatedWagonData = {
      ...wagonData,
      [wagon]: [...wagonData[wagon], newItem],
    };

    const saved = await saveWagons(updatedWagonData);
    if (saved) {
      setWagonData(updatedWagonData);
      resetForm();
    } else {
      setError("Failed to save. Please try again.");
    }
  };

  const handleEditItem = (wagon: "wagon1" | "wagon2", itemId: string) => {
    const item = wagonData[wagon].find(i => i.id === itemId);
    if (item) {
      setFormData({
        name: item.name,
        weight: item.weight.toString(),
        gearBonus: item.gearBonus?.toString() || "",
      });
      setEditingItem({ wagon, itemId });
      setShowAddItem(wagon);
    }
  };

  const handleUpdateItem = async () => {
    if (!editingItem) return;

    const name = formData.name.trim();
    const weight = parseFloat(formData.weight);
    const gearBonus = formData.gearBonus.trim() ? parseInt(formData.gearBonus) : undefined;

    if (!name) {
      setError("Item name is required");
      return;
    }

    if (isNaN(weight) || weight <= 0) {
      setError("Weight must be a positive number");
      return;
    }

    if (formData.gearBonus.trim() && (isNaN(gearBonus!) || gearBonus! <= 0)) {
      setError("Gear bonus must be a positive integer");
      return;
    }

    const otherItemsWeight = wagonData[editingItem.wagon].reduce((sum, item) => 
      item.id === editingItem.itemId ? sum : sum + item.weight, 0
    );

    if (otherItemsWeight + weight > maxWagonWeight) {
      setError(`Cannot update item: Would exceed wagon capacity (${(otherItemsWeight + weight).toFixed(1)}/${maxWagonWeight})`);
      return;
    }

    const updatedWagonData = {
      ...wagonData,
      [editingItem.wagon]: wagonData[editingItem.wagon].map(item =>
        item.id === editingItem.itemId
          ? { ...item, name, weight, gearBonus }
          : item
      ),
    };

    const saved = await saveWagons(updatedWagonData);
    if (saved) {
      setWagonData(updatedWagonData);
      resetForm();
    } else {
      setError("Failed to save. Please try again.");
    }
  };

  const handleDeleteItem = async (wagon: "wagon1" | "wagon2", itemId: string) => {
    const updatedWagonData = {
      ...wagonData,
      [wagon]: wagonData[wagon].filter(item => item.id !== itemId),
    };

    const saved = await saveWagons(updatedWagonData);
    if (saved) {
      setWagonData(updatedWagonData);
    }
  };

  const handleTransferToInventory = async (wagon: "wagon1" | "wagon2", item: InventoryItem) => {
    if (!character) return;

    const characterInventory = character.inventory || [];
    const currentCharacterWeight = characterInventory.reduce((sum, i) => sum + i.weight, 0);
    const maxCharacterWeight = character.max_attributes.STR * 2;

    if (currentCharacterWeight + item.weight > maxCharacterWeight) {
      setError(`Cannot transfer: Would exceed inventory capacity (${(currentCharacterWeight + item.weight).toFixed(1)}/${maxCharacterWeight})`);
      setTimeout(() => setError(""), 3000);
      return;
    }

    const updatedWagonData = {
      ...wagonData,
      [wagon]: wagonData[wagon].filter(i => i.id !== item.id),
    };

    const updatedCharacterInventory = [...characterInventory, item];

    const saved = await saveWagons(updatedWagonData);
    if (saved) {
      setWagonData(updatedWagonData);
      const updates = { inventory: updatedCharacterInventory };
      updateCharacter(updates);
      saveCharacter(updates);
    }
  };

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const renderWagon = (wagon: "wagon1" | "wagon2", wagonNumber: number) => {
    const items = wagonData[wagon];
    const currentWeight = getCurrentWeight(wagon);
    const weightPercentage = (currentWeight / maxWagonWeight) * 100;
    const isOverweight = currentWeight > maxWagonWeight;

    return (
      <div className="bg-gray-800 rounded-2xl p-6 border border-amber-600/40">
        <div className="mb-4">
          <h3 className="text-2xl font-bold text-amber-400 mb-3">Wagon {wagonNumber}</h3>
          <div className="flex justify-between items-center mb-2">
            <span className="text-amber-200 font-semibold">Capacity</span>
            <span className={`font-bold ${isOverweight ? "text-red-400" : "text-amber-100"}`}>
              {currentWeight.toFixed(1)} / {maxWagonWeight}
            </span>
          </div>
          <div className="w-full bg-gray-700 h-4 rounded-full overflow-hidden border-2 border-amber-600/40">
            <div
              className={`h-4 rounded-full transition-all ${
                isOverweight 
                  ? "bg-gradient-to-r from-red-500 to-red-700" 
                  : "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600"
              }`}
              style={{ width: `${Math.min(weightPercentage, 100)}%` }}
            />
          </div>
          {isOverweight && (
            <p className="text-red-400 text-sm mt-2 font-semibold">⚠️ Overloaded!</p>
          )}
        </div>

        {showAddItem !== wagon && (
          <button
            onClick={() => setShowAddItem(wagon)}
            className="w-full mb-4 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-gray-900 rounded-lg font-bold shadow-lg transition-all hover:scale-105"
          >
            + Add Item
          </button>
        )}

        {showAddItem === wagon && (
          <div className="bg-gray-900 rounded-xl p-4 border-2 border-amber-500 shadow-2xl mb-4">
            <h4 className="text-lg font-bold text-amber-400 mb-3">
              {editingItem ? "Edit Item" : "Add New Item"}
            </h4>
            
            {error && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-3">
                <p className="text-red-200 text-sm">{error}</p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-amber-200 text-sm font-semibold mb-1">
                  Item Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-3 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Item name"
                />
              </div>

              <div>
                <label className="block text-amber-200 text-sm font-semibold mb-1">
                  Weight *
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.weight}
                  onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                  className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-3 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="1"
                />
              </div>

              <div>
                <label className="block text-amber-200 text-sm font-semibold mb-1">
                  Gear Bonus (optional)
                </label>
                <input
                  type="number"
                  value={formData.gearBonus}
                  onChange={(e) => setFormData({ ...formData, gearBonus: e.target.value })}
                  className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-3 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="1"
                />
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={editingItem ? handleUpdateItem : () => handleAddItem(wagon)}
                  className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg py-2 font-bold shadow-lg transition-all hover:scale-105"
                >
                  {editingItem ? "Update" : "Add"}
                </button>
                <button
                  onClick={resetForm}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-amber-200 rounded-lg py-2 font-bold transition-all hover:scale-105"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {items.length === 0 && showAddItem !== wagon && (
            <div className="text-center py-8">
              <p className="text-amber-300/60">Wagon is empty</p>
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className="bg-gray-700 rounded-lg p-3 shadow-lg border border-amber-600/30 hover:border-amber-500/60 transition-all flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold text-amber-300">{item.name}</h4>
                  {item.gearBonus && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/40">
                      +{item.gearBonus}
                    </span>
                  )}
                  <span className="text-amber-200 text-sm">⚖️ {item.weight}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleTransferToInventory(wagon, item)}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-bold transition-all"
                  title="Transfer to inventory"
                >
                  ← Inv
                </button>
                <button
                  onClick={() => handleEditItem(wagon, item.id)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold transition-all"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteItem(wagon, item.id)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-bold transition-all"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-4xl font-extrabold text-amber-400 drop-shadow-lg">
          Wagon Storage
        </h2>
      </div>

      {error && !showAddItem && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 max-w-md mx-auto">
          <p className="text-red-200 text-sm text-center">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderWagon("wagon1", 1)}
        {renderWagon("wagon2", 2)}
      </div>
    </div>
  );
}