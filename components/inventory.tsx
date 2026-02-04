"use client";

import { useState } from "react";
import { CharacterType, InventoryItem } from "../app/protected/page";
import { createClient } from "@/lib/supabase/client";

type WagonData = {
  wagon1: InventoryItem[];
  wagon2: InventoryItem[];
};

type InventoryProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
  wagonData: WagonData;
  setWagonData: (data: WagonData) => void;
};

export default function Inventory({ character, updateCharacter, saveCharacter, wagonData, setWagonData }: InventoryProps) {
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    weight: "",
    gearBonus: "",
    quantity: "",
  });
  const [error, setError] = useState("");

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const inventory = character.inventory || [];
  
  // Calculate total weight considering quantity
  const currentWeight = inventory.reduce((sum, item) => {
    const quantity = item.quantity || 1;
    return sum + (item.weight * quantity);
  }, 0);
  
  const maxWeight = character.max_attributes.STR * 2;

  const resetForm = () => {
    setFormData({ name: "", weight: "", gearBonus: "", quantity: "" });
    setError("");
    setShowAddItem(false);
    setEditingItem(null);
  };

  const handleAddItem = () => {
    const name = formData.name.trim();
    const weight = parseFloat(formData.weight);
    const gearBonus = formData.gearBonus.trim() ? parseInt(formData.gearBonus) : undefined;
    const quantity = formData.quantity.trim() ? parseInt(formData.quantity) : 1;

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

    if (formData.quantity.trim() && (isNaN(quantity) || quantity <= 0)) {
      setError("Quantity must be a positive integer");
      return;
    }

    const totalWeight = weight * quantity;
    if (currentWeight + totalWeight > maxWeight) {
      setError(`Cannot add item: Would exceed weight capacity (${(currentWeight + totalWeight).toFixed(1)}/${maxWeight})`);
      return;
    }

    const newItem: InventoryItem = {
      id: Date.now().toString(),
      name,
      weight,
      gearBonus,
      quantity: quantity > 1 ? quantity : undefined, // Only store if > 1
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
        quantity: item.quantity?.toString() || "1",
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
    const quantity = formData.quantity.trim() ? parseInt(formData.quantity) : 1;

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

    if (formData.quantity.trim() && (isNaN(quantity) || quantity <= 0)) {
      setError("Quantity must be a positive integer");
      return;
    }

    const otherItemsWeight = inventory.reduce((sum, item) => {
      if (item.id === editingItem) return sum;
      const itemQuantity = item.quantity || 1;
      return sum + (item.weight * itemQuantity);
    }, 0);

    const totalWeight = weight * quantity;
    if (otherItemsWeight + totalWeight > maxWeight) {
      setError(`Cannot update item: Would exceed weight capacity (${(otherItemsWeight + totalWeight).toFixed(1)}/${maxWeight})`);
      return;
    }

    const updatedInventory = inventory.map(item =>
      item.id === editingItem
        ? { ...item, name, weight, gearBonus, quantity: quantity > 1 ? quantity : undefined }
        : item
    );

    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
    resetForm();
  };

  const handleDecrementQuantity = (itemId: string) => {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;

    const currentQuantity = item.quantity || 1;
    if (currentQuantity <= 1) {
      // If quantity is 1, delete the item
      handleDeleteItem(itemId);
      return;
    }

    const updatedInventory = inventory.map(i =>
      i.id === itemId
        ? { ...i, quantity: currentQuantity - 1 > 1 ? currentQuantity - 1 : undefined }
        : i
    );

    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const handleDecrementGearBonus = (itemId: string) => {
    const item = inventory.find(i => i.id === itemId);
    if (!item || !item.gearBonus) return;

    if (item.gearBonus <= 1) {
      // If gear bonus is 1, delete the item
      handleDeleteItem(itemId);
      return;
    }

    const updatedInventory = inventory.map(i =>
      i.id === itemId
        ? { ...i, gearBonus: item.gearBonus! - 1 }
        : i
    );

    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const handleDeleteItem = (itemId: string) => {
    const updatedInventory = inventory.filter(item => item.id !== itemId);
    const updates = { inventory: updatedInventory };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const handleTransferToWagon = async (wagon: "wagon1" | "wagon2", item: InventoryItem) => {
    const maxWagonWeight = 200;
    const currentWagonWeight = wagonData[wagon].reduce((sum, i) => {
      const wagonQuantity = i.quantity || 1;
      return sum + (i.weight * wagonQuantity);
    }, 0);

    const itemQuantity = item.quantity || 1;
    const itemTotalWeight = item.weight * itemQuantity;

    if (currentWagonWeight + itemTotalWeight > maxWagonWeight) {
      setError(`Cannot transfer: Would exceed wagon capacity (${(currentWagonWeight + itemTotalWeight).toFixed(1)}/${maxWagonWeight})`);
      setTimeout(() => setError(""), 3000);
      return;
    }

    const updatedInventory = inventory.filter(i => i.id !== item.id);
    const updatedWagonData = {
      ...wagonData,
      [wagon]: [...wagonData[wagon], item],
    };

    // Save to Supabase
    const supabase = createClient();
    const { error: wagonError } = await supabase
      .from("wagons")
      .upsert({ id: 1, wagon1: updatedWagonData.wagon1, wagon2: updatedWagonData.wagon2 });

    if (wagonError) {
      console.error("Error saving wagons:", wagonError);
      setError("Failed to transfer item");
      setTimeout(() => setError(""), 3000);
      return;
    }

    setWagonData(updatedWagonData);
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
                Weight (per item) *
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
            </div>

            <div>
              <label className="block text-amber-200 text-sm font-semibold mb-2">
                Quantity (optional)
              </label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                className="w-full bg-gray-800 border border-amber-600/40 rounded-lg px-4 py-2 text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="1"
              />
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

      {error && !showAddItem && (
        <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 max-w-md mx-auto">
          <p className="text-red-200 text-sm text-center">{error}</p>
        </div>
      )}

      {/* Inventory List */}
      <div className="space-y-2 max-w-4xl mx-auto w-full">
        {inventory.length === 0 && !showAddItem && (
          <div className="text-center py-12">
            <p className="text-amber-300/60 text-lg">Your inventory is empty</p>
            <p className="text-amber-300/40 text-sm mt-2">Add items to get started</p>
          </div>
        )}

        {inventory.map((item) => {
          const quantity = item.quantity || 1;
          const totalWeight = item.weight * quantity;
          
          return (
            <div
              key={item.id}
              className="bg-gray-700 rounded-lg p-3 shadow-lg border border-amber-600/30 hover:border-amber-500/60 transition-all flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold text-amber-300">{item.name}</h4>
                  {quantity > 1 && (
                    <button
                      onClick={() => handleDecrementQuantity(item.id)}
                      className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30 transition-all cursor-pointer"
                      title="Click to decrease quantity"
                    >
                      ×{quantity}
                    </button>
                  )}
                  {item.gearBonus && (
                    <button
                      onClick={() => handleDecrementGearBonus(item.id)}
                      className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 transition-all cursor-pointer"
                      title="Click to decrease gear bonus"
                    >
                      +{item.gearBonus}
                    </button>
                  )}
                  <span className="text-amber-200 text-sm">⚖️ {totalWeight.toFixed(1)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleTransferToWagon("wagon1", item)}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-bold transition-all"
                  title="Transfer to Wagon 1"
                >
                  W1 →
                </button>
                <button
                  onClick={() => handleTransferToWagon("wagon2", item)}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-bold transition-all"
                  title="Transfer to Wagon 2"
                >
                  W2 →
                </button>
                <button
                  onClick={() => handleEditItem(item.id)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold transition-all"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-bold transition-all"
                >
                  Del
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}