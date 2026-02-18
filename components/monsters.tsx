"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  MonsterRangeBand,
  MonsterTemplate,
  monsterToArtsCsv,
  monsterToGearCsv,
  monsterToTraitsCsv,
  parseMonsterArtsCsv,
  normalizeMonsterTraitsCsv,
  parseMonsterGearCsv,
} from "@/lib/monsters";

type MonstersProps = {
  isDM: boolean;
};

type CombatCleanupRow = {
  initiative_entries: {
    participant_id: string;
    kind: "player" | "monster";
    monster_template_id?: string | null;
  }[] | null;
  initiative_monsters: { id: string; template_id?: string | null }[] | null;
  token_positions: { character_id: string; x: number; y: number }[] | null;
};

const ICON_BUCKET = "combat-assets";
const RANGE_OPTIONS: MonsterRangeBand[] = ["Engaged", "Near", "Close", "Long"];
const CROP_SIZE = 220;
const OUTPUT_SIZE = 256;

const initialForm = {
  name: "",
  physical: "1",
  mental: "1",
  special: "0",
  size: "1",
  gear: "",
  arts: "",
  range_band: "Near" as MonsterRangeBand,
  traits: "",
};

const parseIconPath = (url: string | null): string | null => {
  if (!url) return null;
  const marker = "/combat-assets/";
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return url.slice(idx + marker.length);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const imageUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to load image."));
      el.src = imageUrl;
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function Monsters({ isDM }: MonstersProps) {
  const [monsters, setMonsters] = useState<MonsterTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconSourceUrl, setIconSourceUrl] = useState<string | null>(null);
  const [iconImageNatural, setIconImageNatural] = useState<{ w: number; h: number } | null>(null);
  const [iconZoom, setIconZoom] = useState(1);
  const [iconPan, setIconPan] = useState({ x: 0, y: 0 });
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const cropDragRef = useRef<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = Boolean(editingId);
  const parsedGear = useMemo(() => parseMonsterGearCsv(form.gear), [form.gear]);
  const parsedArts = useMemo(() => parseMonsterArtsCsv(form.arts), [form.arts]);
  const parsedTraits = useMemo(() => normalizeMonsterTraitsCsv(form.traits), [form.traits]);

  const loadMonsters = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("monsters")
      .select("*")
      .order("name", { ascending: true });
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const normalized = ((data || []) as MonsterTemplate[]).map((monster) => ({
      ...monster,
      size: Number.isFinite(monster.size) ? Math.trunc(monster.size) : 1,
    }));
    setMonsters(normalized);
    setLoading(false);
  };

  useEffect(() => {
    loadMonsters();
    const supabase = createClient();
    const channel = supabase
      .channel("monsters")
      .on("postgres_changes", { event: "*", schema: "public", table: "monsters" }, loadMonsters)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (iconPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(iconPreviewUrl);
    };
  }, [iconPreviewUrl]);

  useEffect(() => {
    return () => {
      if (iconSourceUrl?.startsWith("blob:")) URL.revokeObjectURL(iconSourceUrl);
    };
  }, [iconSourceUrl]);

  const getMaxPan = (zoom: number) => {
    if (!iconImageNatural) return { x: 0, y: 0 };
    const baseScale = Math.max(CROP_SIZE / iconImageNatural.w, CROP_SIZE / iconImageNatural.h);
    const drawW = iconImageNatural.w * baseScale * zoom;
    const drawH = iconImageNatural.h * baseScale * zoom;
    return {
      x: Math.max(0, (drawW - CROP_SIZE) / 2),
      y: Math.max(0, (drawH - CROP_SIZE) / 2),
    };
  };

  const clearIconState = () => {
    setIconBlob(null);
    if (iconPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(iconPreviewUrl);
    if (iconSourceUrl?.startsWith("blob:")) URL.revokeObjectURL(iconSourceUrl);
    setIconPreviewUrl(null);
    setIconSourceUrl(null);
    setIconImageNatural(null);
    setIconZoom(1);
    setIconPan({ x: 0, y: 0 });
  };

  const clearForm = () => {
    setEditingId(null);
    setForm(initialForm);
    clearIconState();
    setError("");
  };

  const renderCroppedIcon = useCallback(
    async (
      sourceUrl: string,
      natural: { w: number; h: number },
      zoom: number,
      pan: { x: number; y: number }
    ) => {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not render icon."));
        el.src = sourceUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not process icon.");

      const baseScale = Math.max(OUTPUT_SIZE / natural.w, OUTPUT_SIZE / natural.h);
      const drawScale = baseScale * zoom;
      const drawW = natural.w * drawScale;
      const drawH = natural.h * drawScale;
      const panScale = OUTPUT_SIZE / CROP_SIZE;

      ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.beginPath();
      ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        image,
        (OUTPUT_SIZE - drawW) / 2 + pan.x * panScale,
        (OUTPUT_SIZE - drawH) / 2 + pan.y * panScale,
        drawW,
        drawH
      );

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not export icon.");

      if (iconPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(iconPreviewUrl);
      const preview = URL.createObjectURL(blob);
      setIconBlob(blob);
      setIconPreviewUrl(preview);
    },
    [iconPreviewUrl]
  );

  useEffect(() => {
    if (!iconSourceUrl || !iconImageNatural) return;
    renderCroppedIcon(iconSourceUrl, iconImageNatural, iconZoom, iconPan).catch((cropError) => {
      setError(cropError instanceof Error ? cropError.message : "Could not process icon.");
    });
  }, [iconSourceUrl, iconImageNatural, iconZoom, iconPan, renderCroppedIcon]);

  const onFileSelected = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file for the monster icon.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Icon image must be under 5MB.");
      return;
    }
    try {
      const img = await loadImageFromFile(file);
      if (iconSourceUrl?.startsWith("blob:")) URL.revokeObjectURL(iconSourceUrl);
      const sourceUrl = URL.createObjectURL(file);
      setIconSourceUrl(sourceUrl);
      setIconImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setIconZoom(1);
      setIconPan({ x: 0, y: 0 });
      setError("");
    } catch (iconError) {
      setError(iconError instanceof Error ? iconError.message : "Could not process icon.");
    }
  };

  const uploadIcon = async (monsterId: string): Promise<string | null> => {
    if (!iconBlob) return null;
    const supabase = createClient();
    const iconPath = `monster-icons/${monsterId}-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from(ICON_BUCKET)
      .upload(iconPath, iconBlob, { upsert: true, cacheControl: "3600", contentType: "image/png" });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from(ICON_BUCKET).getPublicUrl(iconPath);
    return data.publicUrl;
  };

  const validateForm = () => {
    const name = form.name.trim();
    const physical = Number.parseInt(form.physical, 10);
    const mental = Number.parseInt(form.mental, 10);
    const special = Number.parseInt(form.special, 10);
    const size = Number.parseInt(form.size, 10);

    if (!name) return "Name is required.";
    if (!Number.isInteger(physical) || physical <= 0) return "Physical must be an integer greater than 0.";
    if (!Number.isInteger(mental) || mental <= 0) return "Mental must be an integer greater than 0.";
    if (!Number.isInteger(special) || special < 0) return "Special must be a non-negative integer.";
    if (!Number.isInteger(size)) return "Size must be an integer.";
    return null;
  };

  const saveMonster = async () => {
    if (!isDM || saving) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");

    const name = form.name.trim();
    const physical = Number.parseInt(form.physical, 10);
    const mental = Number.parseInt(form.mental, 10);
    const special = Number.parseInt(form.special, 10);
    const size = Number.parseInt(form.size, 10);
    const nowId = editingId || crypto.randomUUID();

    const payload: MonsterTemplate = {
      id: nowId,
      name,
      physical,
      mental,
      special,
      size,
      gear: parsedGear,
      arts: parsedArts,
      range_band: form.range_band,
      traits: parsedTraits,
      icon_url: null,
    };

    try {
      const supabase = createClient();
      let iconUrl = monsters.find((monster) => monster.id === nowId)?.icon_url || null;
      if (iconBlob) {
        const oldPath = parseIconPath(iconUrl);
        if (oldPath) {
          await supabase.storage.from(ICON_BUCKET).remove([oldPath]);
        }
        iconUrl = await uploadIcon(nowId);
      } else if (isEditing && iconPreviewUrl === null) {
        iconUrl = null;
      }

      payload.icon_url = iconUrl;

      const { error: saveError } = await supabase.from("monsters").upsert(payload, { onConflict: "id" });
      if (saveError) throw saveError;
      clearForm();
      await loadMonsters();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save monster.");
    } finally {
      setSaving(false);
    }
  };

  const editMonster = (monster: MonsterTemplate) => {
    setEditingId(monster.id);
    setForm({
      name: monster.name,
      physical: `${monster.physical}`,
      mental: `${monster.mental}`,
      special: `${monster.special}`,
      size: `${Number.isFinite(monster.size) ? Math.trunc(monster.size) : 1}`,
      gear: monsterToGearCsv(monster),
      arts: monsterToArtsCsv(monster),
      range_band: monster.range_band,
      traits: monsterToTraitsCsv(monster),
    });
    if (iconPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(iconPreviewUrl);
    if (iconSourceUrl?.startsWith("blob:")) URL.revokeObjectURL(iconSourceUrl);
    setIconBlob(null);
    setIconSourceUrl(null);
    setIconImageNatural(null);
    setIconZoom(1);
    setIconPan({ x: 0, y: 0 });
    setIconPreviewUrl(monster.icon_url || null);
    setError("");
  };

  const deleteMonster = async (monster: MonsterTemplate) => {
    if (!isDM) return;
    const confirmed = window.confirm(`Delete monster template "${monster.name}"?`);
    if (!confirmed) return;

    setSaving(true);
    setError("");
    try {
      const supabase = createClient();

      const { data: combatState, error: combatLoadError } = await supabase
        .from("combat_state")
        .select("initiative_entries, initiative_monsters, token_positions")
        .eq("id", 1)
        .maybeSingle<CombatCleanupRow>();
      if (combatLoadError) throw combatLoadError;

      const entries = Array.isArray(combatState?.initiative_entries) ? combatState!.initiative_entries : [];
      const removedParticipantIds = new Set(
        entries
          .filter((entry) => entry.kind === "monster" && entry.monster_template_id === monster.id)
          .map((entry) => entry.participant_id)
      );
      const nextEntries = entries.filter((entry) => !removedParticipantIds.has(entry.participant_id));
      const nextInitiativeMonsters = (combatState?.initiative_monsters || []).filter(
        (im) => !removedParticipantIds.has(im.id) && im.template_id !== monster.id
      );
      const nextTokenPositions = (combatState?.token_positions || []).filter(
        (pos) => !removedParticipantIds.has(pos.character_id)
      );

      const { error: combatSaveError } = await supabase.from("combat_state").upsert(
        {
          id: 1,
          initiative_entries: nextEntries,
          initiative_monsters: nextInitiativeMonsters,
          token_positions: nextTokenPositions,
        },
        { onConflict: "id" }
      );
      if (combatSaveError) throw combatSaveError;

      const { error: deleteError } = await supabase.from("monsters").delete().eq("id", monster.id);
      if (deleteError) throw deleteError;

      const iconPath = parseIconPath(monster.icon_url);
      if (iconPath) {
        await supabase.storage.from(ICON_BUCKET).remove([iconPath]);
      }

      if (editingId === monster.id) clearForm();
      await loadMonsters();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete monster.");
    } finally {
      setSaving(false);
    }
  };

  if (!isDM) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-gray-900/30 p-4 text-sm text-amber-100/80">
        Monster management is only available to the DM.
      </div>
    );
  }

  const cropBaseScale =
    iconImageNatural ? Math.max(CROP_SIZE / iconImageNatural.w, CROP_SIZE / iconImageNatural.h) : 1;
  const cropWidth = iconImageNatural ? iconImageNatural.w * cropBaseScale * iconZoom : CROP_SIZE;
  const cropHeight = iconImageNatural ? iconImageNatural.h * cropBaseScale * iconZoom : CROP_SIZE;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/40 p-5">
        <h3 className="text-xl font-bold text-amber-300 mb-4">{isEditing ? "Edit Monster" : "Create Monster"}</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="block text-sm text-amber-200">
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="Wolf"
            />
          </label>
          <label className="block text-sm text-amber-200">
            Physical
            <input
              value={form.physical}
              onChange={(event) => setForm((prev) => ({ ...prev, physical: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="1"
            />
          </label>
          <label className="block text-sm text-amber-200">
            Mental
            <input
              value={form.mental}
              onChange={(event) => setForm((prev) => ({ ...prev, mental: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="1"
            />
          </label>
          <label className="block text-sm text-amber-200">
            Special
            <input
              value={form.special}
              onChange={(event) => setForm((prev) => ({ ...prev, special: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="0"
            />
          </label>
          <label className="block text-sm text-amber-200">
            Size
            <input
              value={form.size}
              onChange={(event) => setForm((prev) => ({ ...prev, size: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="1"
            />
          </label>
          <label className="block text-sm text-amber-200">
            Range
            <select
              value={form.range_band}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, range_band: event.target.value as MonsterRangeBand }))
              }
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-amber-200 lg:col-span-2">
            Gear
            <input
              value={form.gear}
              onChange={(event) => setForm((prev) => ({ ...prev, gear: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="Shortsword, Plate Armor"
            />
          </label>
          <label className="block text-sm text-amber-200 lg:col-span-2">
            Arts
            <input
              value={form.arts}
              onChange={(event) => setForm((prev) => ({ ...prev, arts: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="True Sense, Sunder"
            />
          </label>
          <label className="block text-sm text-amber-200 lg:col-span-2">
            Traits
            <input
              value={form.traits}
              onChange={(event) => setForm((prev) => ({ ...prev, traits: event.target.value }))}
              className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              placeholder="beast, fast, cave"
            />
          </label>
        </div>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (!file) return;
            await onFileSelected(file);
          }}
          className="mt-4 rounded-xl border border-dashed border-amber-500/40 bg-gray-900/30 p-4"
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full border border-amber-400/50 bg-gray-800">
              {iconPreviewUrl ? (
                <img src={iconPreviewUrl} alt="Monster icon preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-amber-200/70">No Icon</div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) await onFileSelected(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Browse
            </button>
            {iconPreviewUrl && (
              <button
                onClick={() => {
                  clearIconState();
                }}
                className="rounded bg-red-700 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-600"
              >
                Remove
              </button>
            )}
          </div>

          {iconSourceUrl && iconImageNatural && (
            <div className="mt-4 space-y-3">
              <div
                className="relative overflow-hidden rounded-full border border-amber-500/40 bg-gray-800"
                style={{ width: CROP_SIZE, height: CROP_SIZE }}
                onPointerDown={(event) => {
                  cropDragRef.current = { x: event.clientX, y: event.clientY };
                  setIsDraggingCrop(true);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!isDraggingCrop || !cropDragRef.current) return;
                  const dx = event.clientX - cropDragRef.current.x;
                  const dy = event.clientY - cropDragRef.current.y;
                  cropDragRef.current = { x: event.clientX, y: event.clientY };
                  const maxPan = getMaxPan(iconZoom);
                  setIconPan((prev) => ({
                    x: clamp(prev.x + dx, -maxPan.x, maxPan.x),
                    y: clamp(prev.y + dy, -maxPan.y, maxPan.y),
                  }));
                }}
                onPointerUp={(event) => {
                  setIsDraggingCrop(false);
                  cropDragRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={(event) => {
                  setIsDraggingCrop(false);
                  cropDragRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              >
                <img
                  src={iconSourceUrl}
                  alt="Icon crop source"
                  draggable={false}
                  className="absolute select-none"
                  style={{
                    width: cropWidth,
                    height: cropHeight,
                    left: (CROP_SIZE - cropWidth) / 2 + iconPan.x,
                    top: (CROP_SIZE - cropHeight) / 2 + iconPan.y,
                    maxWidth: "none",
                  }}
                />
              </div>

              <label className="block max-w-sm text-xs text-amber-200">
                Zoom
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={iconZoom}
                  onChange={(event) => {
                    const nextZoom = Number.parseFloat(event.target.value);
                    const maxPan = getMaxPan(nextZoom);
                    setIconZoom(nextZoom);
                    setIconPan((prev) => ({
                      x: clamp(prev.x, -maxPan.x, maxPan.x),
                      y: clamp(prev.y, -maxPan.y, maxPan.y),
                    }));
                  }}
                  className="mt-1 w-full"
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-4 text-xs text-amber-200/80">
          <div>Derived: STR/AGL {(Number.parseInt(form.physical, 10) || 0) * 2}</div>
          <div>Derived: WIT/EMP {(Number.parseInt(form.mental, 10) || 0) * 2}</div>
          <div>Derived: Starting Spirit {(Number.parseInt(form.special, 10) || 0) * 2}</div>
          <div>Derived: Natural Armor {Number.parseInt(form.special, 10) || 0}</div>
          <div>Filtered Gear: {parsedGear.length > 0 ? parsedGear.map((item) => item.name).join(", ") : "None"}</div>
          <div>Filtered Arts: {parsedArts.length > 0 ? parsedArts.map((art) => art.name).join(", ") : "None"}</div>
          <div>Normalized Traits: {parsedTraits.length > 0 ? parsedTraits.join(", ") : "None"}</div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={saveMonster}
            disabled={saving}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400 disabled:opacity-60"
          >
            {saving ? "Saving..." : isEditing ? "Update Monster" : "Create Monster"}
          </button>
          {(isEditing || form.name || iconPreviewUrl) && (
            <button
              onClick={clearForm}
              className="rounded bg-gray-700 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Cancel
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/40 p-5">
        <h3 className="text-xl font-bold text-amber-300 mb-4">Monster Roster</h3>
        {loading ? (
          <p className="text-sm text-amber-100/80">Loading monsters...</p>
        ) : monsters.length === 0 ? (
          <p className="text-sm text-amber-100/70">No monsters yet.</p>
        ) : (
          <div className="space-y-3">
            {monsters.map((monster) => (
              <div
                key={monster.id}
                className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-gray-900/40 p-3 lg:flex-row lg:items-center"
              >
                <div className="flex items-center gap-3">
                  {monster.icon_url ? (
                    <img src={monster.icon_url} alt={monster.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-700 text-xs text-amber-100">
                      M
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-amber-100">{monster.name}</div>
                    <div className="text-xs text-amber-200/80">
                      PHY {monster.physical} | MEN {monster.mental} | SPC {monster.special} | SIZE {monster.size ?? 1}
                    </div>
                    <div className="text-xs text-amber-200/70">
                      Range {monster.range_band} | Traits {(monster.traits || []).join(", ") || "None"}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-amber-200/70 lg:ml-4 lg:flex-1">
                  Gear: {(monster.gear || []).map((item) => item.name).join(", ") || "None"}
                </div>
                <div className="text-xs text-amber-200/70 lg:ml-4 lg:flex-1">
                  Arts: {(monster.arts || []).map((art) => art.name).join(", ") || "None"}
                </div>
                <div className="flex gap-2 lg:ml-auto">
                  <button
                    onClick={() => editMonster(monster)}
                    className="rounded bg-gray-700 px-3 py-1.5 text-sm font-semibold text-amber-100 hover:bg-gray-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMonster(monster)}
                    className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-red-100 hover:bg-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
