"use client";

import { useState } from "react";
import { CharacterType, InventoryItem } from "../app/protected/page";

type InventoryProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
};

export default function Inventory({ character, updateCharacter, saveCharacter }: InventoryProps) {
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    weight: "",
    gearBonus: "",
  });
  const [error, setError] = useState("");

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const inventory = character.inventory || [];
  const currentWeight = inventory.reduce((sum, item) => sum + item.weight, 0);
  const maxWeight = character.max_attributes.STR * 2;

  const resetForm = () => {
    setFormData({ name: "", weight: "", gearBonus: "" });
    setError("");
    setShowAddItem(false);
    setEditingItem(null);
  };

  const handleAddItem = () => {
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

    if (formData.gearBonus.trim() && (isNaN(gearBonus!) || gearBonus === 0)) {
      setError("Gear bonus must be a non-zero integer");
      return;
    }

    if (currentWeight + weight > maxWeight) {
      setError(`Cannot add item: Would exceed weight capacity (${currentWeight + weight}/${maxWeight})`);
      return;
    }

    const newItem: InventoryItem = {
      id: Date.now().toString(),
      name,
      weight,
      gearBonus,
    };

    const updatedInventory = [...inventory, newItem];
    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
    resetForm();
  };

  const handleEditItem = (itemId: string) => {
    const item = inventory.find(i => i.id === itemId);
    if (item) {
      setFormData({
        name: item.name,
        weight: item.weight.toString(),
        gearBonus: item.gearBonus?.toString() || "",
      });
      setEditingItem(itemId);
      setShowAddItem(true);
    }
  };

  const handleUpdateItem = () => {
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

    if (formData.gearBonus.trim() && (isNaN(gearBonus!) || gearBonus === 0)) {
      setError("Gear bonus must be a non-zero integer");
      return;
    }

    const oldItem = inventory.find(i => i.id === editingItem);
    const otherItemsWeight = inventory.reduce((sum, item) => 
      item.id === editingItem ? sum : sum + item.weight, 0
    );

    if (otherItemsWeight + weight > maxWeight) {
      setError(`Cannot update item: Would exceed weight capacity (${otherItemsWeight + weight}/${maxWeight})`);
      return;
    }

    const updatedInventory = inventory.map(item =>
      item.id === editingItem
        ? { ...item, name, weight, gearBonus }
        : item
    );

    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
    resetForm();
  };

  const handleDeleteItem = (itemId: string) => {
    const updatedInventory = inventory.filter(item => item.id !== itemId);
    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const weightPercentage = (currentWeight / maxWeight) * 100;
  const isOverweight = currentWeight > maxWeight;

  return (
    <div className="flex flex-col gap-6">
      {/* Header with weight capacity */}
      <div className="text-center">
        <h2 className="text-4xl font-extrabold text-amber-400 drop-shadow-lg mb-4">
          Inventory
        </h2>
        <div className="max-w-md mx-auto">
          <div className="flex justify-between items-center mb-2">
            <span className="text-amber-200 font-semibold">Weight Capacity</span>
            <span className={`font-bold ${isOverweight ? "text-red-400" : "text-amber-100"}`}>
              {currentWeight.toFixed(1)} / {maxWeight}
            </span>
          </div>
          <div className="w-full bg-gray-700 h-6 rounded-full overflow-hidden border-2 border-amber-600/40">
            <div
              className={`h-6 rounded-full transition-all ${
                isOverweight 
                  ? "bg-gradient-to-r from-red-500 to-red-700" 
                  : "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600"
              }`}
              style={{ width: `${Math.min(weightPercentage, 100)}%` }}
            />
          </div>
          {isOverweight && (
            <p className="text-red-400 text-sm mt-2 font-semibold">⚠️ Overencumbered!</p>
          )}
        </div>
      </div>

      {/* Add Item Button */}
      {!showAddItem && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowAddItem(true)}
            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-gray-900 rounded-lg font-bold shadow-lg transition-all hover:scale-105"
          >
            + Add New Item
          </button>
        </div>
      )}

      {/* Add/Edit Item Form */}
      {showAddItem && (
        <div className="bg-gray-900 rounded-xl p-6 border-2 border-amber-500 shadow-2xl max-w-md mx-auto w-full">
          <h3 className="text-2xl font-bold text-amber-400 mb-4">
            {editingItem ? "Edit Item" : "Add New Item"}
          </h3>
          
          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-4">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-amber-200 text-sm font-semibold mb-2">
                Item Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-4 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="Shortsword"
              />
            </div>

            <div>
              <label className="block text-amber-200 text-sm font-semibold mb-2">
                Weight *
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.weight}
                onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-4 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="1"
              />
            </div>

            <div>
              <label className="block text-amber-200 text-sm font-semibold mb-2">
                Gear Bonus (optional)
              </label>
              <input
                type="number"
                value={formData.gearBonus}
                onChange={(e) => setFormData({ ...formData, gearBonus: e.target.value })}
                className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-4 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="1"
              />
              <p className="text-amber-300/60 text-xs mt-1">Must be a non-zero integer</p>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                onClick={editingItem ? handleUpdateItem : handleAddItem}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white rounded-lg py-2 font-bold shadow-lg transition-all hover:scale-105"
              >
                {editingItem ? "Update" : "Add Item"}
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

      {/* Inventory List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {inventory.length === 0 && !showAddItem && (
          <div className="col-span-full text-center py-12">
            <p className="text-amber-300/60 text-lg">Your inventory is empty</p>
            <p className="text-amber-300/40 text-sm mt-2">Add items to get started</p>
          </div>
        )}

        {inventory.map((item) => (
          <div
            key={item.id}
            className="bg-gray-700 rounded-xl p-5 shadow-lg border border-amber-600/30 hover:border-amber-500/60 transition-all hover:shadow-amber-500/20"
          >
            <div className="flex justify-between items-start mb-3">
              <h4 className="text-lg font-bold text-amber-300">{item.name}</h4>
              {item.gearBonus && (
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                  item.gearBonus > 0 
                    ? "bg-green-500/20 text-green-300 border border-green-500/40" 
                    : "bg-red-500/20 text-red-300 border border-red-500/40"
                }`}>
                  {item.gearBonus > 0 ? "+" : ""}{item.gearBonus}
                </span>
              )}
            </div>

            <div className="mb-4">
              <div className="flex items-center gap-2 text-amber-200">
                <span className="text-2xl">⚖️</span>
                <span className="font-semibold">{item.weight} weight</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleEditItem(item.id)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-bold transition-all hover:scale-105"
              >
                Edit
              </button>
              <button
                onClick={() => handleDeleteItem(item.id)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-sm font-bold transition-all hover:scale-105"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}