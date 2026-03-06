"use client";

import { useState } from "react";
import { CharacterType, EquipmentSlots, InventoryItem } from "../app/protected/page";
import { createClient } from "@/lib/supabase/client";
import {
  addItemToInventory,
  applyGearDamageToItem,
  buildItemFromForm,
  getImplementedItemAutofill,
  isImplementedItem,
  normalizeInventoryItems,
  splitOneFromStack,
} from "@/lib/item-catalog";

type WagonData = {
  wagon1: InventoryItem[];
  wagon2: InventoryItem[];
};

type CharacterRecipient = {
  id: string;
  name: string;
  email: string;
  inventory?: InventoryItem[];
  max_attributes?: {
    STR?: number;
  };
};

type InventoryProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
  wagonData: WagonData;
  setWagonData: (data: WagonData) => void;
  userEmail: string | null;
  drawGearReturnToCombat: boolean;
  onDrawGearFinished: () => void;
};

type EquippableSlotKey = "armor" | "helmet" | "left" | "right";

export default function Inventory({
  character,
  updateCharacter,
  saveCharacter,
  wagonData,
  setWagonData,
  userEmail,
  drawGearReturnToCombat,
  onDrawGearFinished,
}: InventoryProps) {
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    weight: "",
    gearBonus: "",
    quantity: "",
  });
  const [error, setError] = useState("");
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendingItem, setSendingItem] = useState<InventoryItem | null>(null);
  const [recipientOptions, setRecipientOptions] = useState<CharacterRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [isSending, setIsSending] = useState(false);
  void userEmail;
  const inventory = character?.inventory || [];
  const defaultSlots: EquipmentSlots = {
    armor: null,
    helmet: null,
    left: null,
    right: null,
    armor_ask: true,
  };
  const equipmentSlots: EquipmentSlots = {
    ...defaultSlots,
    ...(character?.equipment_slots || {}),
  };
  const armorAsk = equipmentSlots.armor_ask !== false;
  const equippedItemIds = new Set(
    [equipmentSlots.armor, equipmentSlots.helmet, equipmentSlots.left, equipmentSlots.right].filter(
      (value): value is string => !!value
    )
  );
  const visibleInventory = inventory.filter((item) => !equippedItemIds.has(item.id));

  const sanitizeEquipmentSlots = (slots: EquipmentSlots, items: InventoryItem[]): EquipmentSlots => {
    const ids = new Set(items.map((item) => item.id));
    const next: EquipmentSlots = { ...slots };
    if (next.armor && !ids.has(next.armor)) next.armor = null;
    if (next.helmet && !ids.has(next.helmet)) next.helmet = null;
    if (next.left && !ids.has(next.left)) next.left = null;
    if (next.right && !ids.has(next.right)) next.right = null;
    return next;
  };

  const toggleArmorAsk = async () => {
    const nextSlots = { ...equipmentSlots, armor_ask: !armorAsk };
    const updates = { equipment_slots: nextSlots };
    updateCharacter(updates);
    await saveCharacter(updates);
  };

  const getSlotItem = (slot: keyof EquipmentSlots): InventoryItem | null => {
    const itemId = equipmentSlots[slot];
    if (!itemId) return null;
    return inventory.find((item) => item.id === itemId) || null;
  };

  const slotAcceptsItem = (slot: keyof EquipmentSlots, item: InventoryItem): boolean => {
    if (slot === "armor") return item.item_type === "Armor";
    if (slot === "helmet") return item.item_type === "Helmet";
    if (slot === "left" || slot === "right") return item.wield === "1H" || item.wield === "2H";
    return false;
  };

  const consumeEquipActionIfInCombat = async (): Promise<boolean> => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("combat_state")
      .select("combat_mode")
      .eq("id", 1)
      .maybeSingle<{ combat_mode: boolean | null }>();

    if (loadError) {
      setError(loadError.message);
      setTimeout(() => setError(""), 3000);
      return false;
    }

    if (!data?.combat_mode) return true;

    const { error: rpcError } = await supabase.rpc("combat_use_fast_or_slow");
    if (rpcError) {
      setError(rpcError.message);
      setTimeout(() => setError(""), 3000);
      return false;
    }
    const { error: clearSwingError } = await supabase.rpc("combat_clear_swing_weapon");
    if (clearSwingError) {
      console.error("Failed to clear swing weapon after equipping:", clearSwingError);
    }

    return true;
  };

  const equipItemToSlot = async (slot: keyof EquipmentSlots, itemId: string) => {
    const item = inventory.find((invItem) => invItem.id === itemId);
    if (!item) return;

    if (!slotAcceptsItem(slot, item)) {
      setError(`"${item.name}" cannot be equipped in ${slot}.`);
      setTimeout(() => setError(""), 3000);
      return;
    }

    const canEquip = await consumeEquipActionIfInCombat();
    if (!canEquip) return;

    let nextInventory = inventory;
    let equipItem = item;
    if ((item.quantity || 1) > 1) {
      const split = splitOneFromStack(nextInventory, item.id);
      if (!split.splitItem) return;
      nextInventory = split.nextItems;
      equipItem = split.splitItem;
    }

    const nextSlots: EquipmentSlots = { ...equipmentSlots };

    if (slot === "armor") {
      nextSlots.armor = equipItem.id;
    } else if (slot === "helmet") {
      nextSlots.helmet = equipItem.id;
    } else if (slot === "left" || slot === "right") {
      if (equipItem.wield === "2H") {
        nextSlots.left = equipItem.id;
        nextSlots.right = equipItem.id;
      } else {
        if (nextSlots.left && nextSlots.right && nextSlots.left === nextSlots.right) {
          // Replacing a 2H item with a 1H item in one hand.
          nextSlots.left = null;
          nextSlots.right = null;
        }
        nextSlots[slot] = equipItem.id;
        const otherSlot: "left" | "right" = slot === "left" ? "right" : "left";
        if (nextSlots[otherSlot] === equipItem.id) {
          nextSlots[otherSlot] = null;
        }
      }
    }

    const updates = {
      inventory: nextInventory,
      equipment_slots: sanitizeEquipmentSlots(nextSlots, nextInventory),
    };
    updateCharacter(updates);
    await saveCharacter(updates);
    setError("");
    if (drawGearReturnToCombat) {
      onDrawGearFinished();
    }
  };

  const clearSlot = (slot: EquippableSlotKey) => {
    const nextSlots: EquipmentSlots = { ...equipmentSlots };
    if (slot === "left" || slot === "right") {
      const value = nextSlots[slot];
      if (value && nextSlots.left === value && nextSlots.right === value) {
        nextSlots.left = null;
        nextSlots.right = null;
      } else {
        nextSlots[slot] = null;
      }
    } else {
      nextSlots[slot] = null;
    }
    const updates = { equipment_slots: nextSlots };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const setEquippedEffectiveBonus = async (itemId: string, rawValue: string) => {
    const item = inventory.find((invItem) => invItem.id === itemId);
    if (!item) return;
    if (item.item_type !== "Armor" && item.item_type !== "Helmet") return;
    const trueBonus = Math.max(0, Math.trunc(item.gearBonus ?? 0));
    const parsed = rawValue.trim() === "" ? trueBonus : Math.max(0, Math.trunc(Number(rawValue)));
    if (Number.isNaN(parsed)) return;
    const updatedInventory = inventory.map((invItem) =>
      invItem.id === itemId ? { ...invItem, effective_gear_bonus: parsed } : invItem
    );
    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
    updateCharacter(updates);
    await saveCharacter(updates);
  };

  const onSlotDrop = (slot: EquippableSlotKey, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("application/x-inventory-item-id");
    if (!itemId) return;
    void equipItemToSlot(slot, itemId);
  };

  const calculateInventoryWeight = (items: InventoryItem[]) => {
    return items.reduce((sum, item) => {
      const quantity = item.quantity || 1;
      return sum + (item.weight * quantity);
    }, 0);
  };
  
  // Calculate total weight considering quantity
  const currentWeight = calculateInventoryWeight(inventory);
  
  const maxWeight = (character?.max_attributes?.STR ?? 0) * 2;

  const resetForm = () => {
    setFormData({ name: "", weight: "", gearBonus: "", quantity: "" });
    setError("");
    setShowAddItem(false);
    setEditingItem(null);
  };

  const handleNameInputChange = (rawName: string) => {
    const canonical = getImplementedItemAutofill(rawName);
    setFormData((prev) => ({
      ...prev,
      name: canonical ? canonical.name : rawName,
      weight: canonical ? canonical.weight.toString() : prev.weight,
      gearBonus: canonical
        ? canonical.gearBonus !== undefined
          ? canonical.gearBonus.toString()
          : ""
        : prev.gearBonus,
    }));
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
      ...buildItemFromForm({
        id: Date.now().toString(),
        name,
        weight,
        gearBonus,
        quantity: quantity > 1 ? quantity : undefined,
      }),
    };

    const updatedInventory = addItemToInventory(inventory, newItem);
    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
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

    const editedBase = inventory.find((item) => item.id === editingItem);
    if (!editedBase) return;
    const withoutEdited = inventory.filter((item) => item.id !== editingItem);
    const editedItem = buildItemFromForm({
      id: editedBase.id,
      name,
      weight,
      gearBonus,
      quantity: quantity > 1 ? quantity : undefined,
    });
    const updatedInventory = addItemToInventory(withoutEdited, editedItem);

    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
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

    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
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

    const updatedInventory = applyGearDamageToItem(inventory, itemId, 1);

    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const handleDeleteItem = (itemId: string) => {
    const updatedInventory = inventory.filter(item => item.id !== itemId);
    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
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
      [wagon]: addItemToInventory(wagonData[wagon], item),
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
    const updates = {
      inventory: updatedInventory,
      equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const openSendModal = async (item: InventoryItem) => {
    if (!character) return;
    setShowSendModal(true);
    setSendingItem(item);
    setLoadingRecipients(true);
    setError("");

    try {
      const supabase = createClient();
      const { data, error: recipientsError } = await supabase
        .from("characters")
        .select("id, name, email, inventory, max_attributes")
        .neq("id", character.id)
        .order("name", { ascending: true });

      if (recipientsError) {
        throw recipientsError;
      }
      setRecipientOptions((data || []) as CharacterRecipient[]);
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Failed to load recipients";
      setError(message);
      setShowSendModal(false);
      setSendingItem(null);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const closeSendModal = () => {
    setShowSendModal(false);
    setSendingItem(null);
    setRecipientOptions([]);
    setLoadingRecipients(false);
    setIsSending(false);
  };

  const notifySendFailure = async (recipientName: string, itemName: string) => {
    if (!character) return;
    const supabase = createClient();
    await supabase
      .from("notifications")
      .insert({
        message: `Could not send ${itemName} to ${recipientName}: they cannot carry that weight.`,
        recipient_email: character.email,
      });
  };

  const sendItemToRecipient = async (recipient: CharacterRecipient) => {
    if (!sendingItem || isSending || !character) return;
    setIsSending(true);
    setError("");

    try {
      const recipientInventory = recipient.inventory || [];
      const recipientCurrentWeight = calculateInventoryWeight(recipientInventory);
      const recipientMaxWeight = ((recipient.max_attributes?.STR ?? 0) * 2);
      const itemQuantity = sendingItem.quantity || 1;
      const itemTotalWeight = sendingItem.weight * itemQuantity;

      if (recipientCurrentWeight + itemTotalWeight > recipientMaxWeight) {
        await notifySendFailure(recipient.name, sendingItem.name);
        closeSendModal();
        return;
      }

      const updatedRecipientInventory = addItemToInventory(recipientInventory, sendingItem);
      const updatedSenderInventory = normalizeInventoryItems(inventory.filter((item) => item.id !== sendingItem.id));

      const supabase = createClient();
      const { error: recipientUpdateError } = await supabase
        .from("characters")
        .update({ inventory: updatedRecipientInventory })
        .eq("id", recipient.id);

      if (recipientUpdateError) {
        throw recipientUpdateError;
      }

      const updates = { inventory: updatedSenderInventory };
      const senderUpdates = {
        ...updates,
        equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedSenderInventory),
      };
      updateCharacter(senderUpdates);
      await saveCharacter(senderUpdates);
      closeSendModal();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Failed to send item";
      setError(message);
    } finally {
      setIsSending(false);
    }
  };

  const weightPercentage = (currentWeight / maxWeight) * 100;
  const isOverweight = currentWeight > maxWeight;

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["armor", "helmet", "left", "right"] as const).map((slot) => {
          const equipped = getSlotItem(slot);
          const label = slot === "left" ? "Left" : slot === "right" ? "Right" : slot === "armor" ? "Armor" : "Helmet";
          return (
            <div
              key={slot}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onSlotDrop(slot, event)}
              className="rounded-xl border border-amber-600/40 bg-gray-900/40 p-3 min-h-[92px]"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wide text-amber-300/80 font-semibold">{label}</span>
                {equipped && (
                  <button
                    onClick={() => clearSlot(slot)}
                    className="rounded bg-gray-700 px-2 py-0.5 text-xs font-semibold text-amber-100 hover:bg-gray-600"
                    title={`Stow ${label}`}
                  >
                    Stow
                  </button>
                )}
              </div>
              {equipped ? (
                <div className="text-sm font-bold text-amber-200 truncate">
                  {equipped.name}
                  {equipped.wield === "2H" && slot !== "armor" && slot !== "helmet" ? " (2H)" : ""}
                </div>
              ) : (
                <div className="text-sm text-amber-200/50">Empty</div>
              )}
              {(slot === "armor" || slot === "helmet") && (
                <div className="mt-2 flex items-center gap-3">
                  {equipped && (
                    <label className="flex items-center gap-2 text-xs text-amber-200/80 flex-1 min-w-0">
                      <span className="min-w-[46px]">Effective</span>
                      <input
                        type="number"
                        className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-amber-100 ring-1 ring-amber-600/40 focus:outline-none focus:ring-amber-500"
                        value={
                          typeof equipped.effective_gear_bonus === "number"
                            ? equipped.effective_gear_bonus
                            : Math.max(0, Math.trunc(equipped.gearBonus ?? 0))
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          const parsed = value.trim() === "" ? 0 : Math.max(0, Math.trunc(Number(value)));
                          if (!Number.isNaN(parsed)) {
                            const updatedInventory = inventory.map((invItem) =>
                              invItem.id === equipped.id ? { ...invItem, effective_gear_bonus: parsed } : invItem
                            );
                            updateCharacter({
                              inventory: updatedInventory,
                              equipment_slots: sanitizeEquipmentSlots(equipmentSlots, updatedInventory),
                            });
                          }
                        }}
                        onBlur={(event) => {
                          void setEquippedEffectiveBonus(equipped.id, event.target.value);
                        }}
                        title="Effective gear bonus used for this armor/helmet when rolled"
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-xs text-amber-200/80 shrink-0">
                    <input
                      type="checkbox"
                      checked={armorAsk}
                      onChange={toggleArmorAsk}
                      className="h-3.5 w-3.5 rounded border-amber-400/60 bg-gray-900 text-amber-400 focus:ring-amber-500"
                    />
                    Ask
                  </label>
                </div>
              )}
            </div>
          );
        })}
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
                onChange={(e) => handleNameInputChange(e.target.value)}
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
        {visibleInventory.length === 0 && !showAddItem && (
          <div className="text-center py-12 col-span-full">
            <p className="text-amber-300/60 text-lg">Your inventory is empty</p>
            <p className="text-amber-300/40 text-sm mt-2">Add items to get started</p>
          </div>
        )}

        {visibleInventory.map((item) => {
          const quantity = item.quantity || 1;
          const totalWeight = item.weight * quantity;
          
          return (
            <div
              key={item.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-inventory-item-id", item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              className="bg-gray-700 rounded-lg p-3 shadow-lg border border-amber-600/30 hover:border-amber-500/60 transition-all flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold text-amber-300">
                    {item.name}{isImplementedItem(item) ? " ★" : ""}
                  </h4>
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
                  onClick={() => openSendModal(item)}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-bold transition-all"
                >
                  Send
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

      {showSendModal && sendingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-2xl shadow-2xl border border-amber-600/40 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-2xl font-bold text-amber-400">Send Item</h3>
              <button
                onClick={closeSendModal}
                className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 text-amber-100"
              >
                ✕
              </button>
            </div>

            <p className="text-amber-100 mb-4">
              Send <span className="font-bold text-amber-300">{sendingItem.name}</span> to:
            </p>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {loadingRecipients && (
                <p className="text-amber-200/80 text-sm">Loading characters...</p>
              )}
              {!loadingRecipients && recipientOptions.length === 0 && (
                <p className="text-amber-200/80 text-sm">No valid recipients found.</p>
              )}
              {!loadingRecipients &&
                recipientOptions.map((recipient) => (
                  <button
                    key={recipient.id}
                    onClick={() => sendItemToRecipient(recipient)}
                    disabled={isSending}
                    className="w-full text-left bg-gray-700 hover:bg-gray-600 rounded-lg p-3 border border-amber-600/30 hover:border-amber-500/60 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <p className="font-bold text-amber-300">{recipient.name}</p>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
