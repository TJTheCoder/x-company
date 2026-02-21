"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type GlossaryProps = {
  isDM: boolean;
  userEmail: string | null;
};

type GlossaryImage = {
  url: string;
  path?: string | null;
  name?: string | null;
  uploaded_at?: string | null;
};

type GlossaryEntry = {
  id: string;
  title: string;
  description: string;
  images: GlossaryImage[] | null;
  is_locked: boolean;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

const DM_EMAIL = "drocasma9@gmail.com";
const GLOSSARY_BUCKET = "glossary-assets";

const normalizeText = (value: string): string => value.trim().toLowerCase();

const parseBucketPathFromUrl = (url: string, bucket: string): string | null => {
  try {
    const parsed = new URL(url);
    const marker = `/${bucket}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx < 0) return null;
    return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
};

const scoreEntry = (entry: GlossaryEntry, query: string): number => {
  if (!query) return 0;
  const title = normalizeText(entry.title);
  const description = normalizeText(entry.description);

  if (title === query) return 1000;
  if (title.startsWith(query)) return 800 - title.length;

  const titleIdx = title.indexOf(query);
  if (titleIdx >= 0) return 600 - titleIdx;

  const descIdx = description.indexOf(query);
  if (descIdx >= 0) return 300 - descIdx;

  return 0;
};

export default function Glossary({ isDM, userEmail }: GlossaryProps) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyEntryIds, setBusyEntryIds] = useState<Record<string, boolean>>({});
  const [uploadingEntryIds, setUploadingEntryIds] = useState<Record<string, boolean>>({});

  const isDmUser = isDM && normalizeText(userEmail || "") === normalizeText(DM_EMAIL);
  const normalizedQuery = normalizeText(search);

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return entries
      .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .map((item) => item.entry);
  }, [entries, normalizedQuery]);

  const matchedEntries = useMemo(
    () => (normalizedQuery ? searchResults : entries),
    [entries, normalizedQuery, searchResults]
  );

  const loadEntries = async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("glossary_entries")
      .select("*")
      .order("created_at", { ascending: true });
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const normalized = ((data || []) as GlossaryEntry[]).map((entry) => ({
      ...entry,
      title: entry.title || "",
      description: entry.description || "",
      images: Array.isArray(entry.images) ? entry.images : [],
    }));
    setEntries(normalized);
    setLoading(false);
  };

  useEffect(() => {
    loadEntries();
    const supabase = createClient();
    const channel = supabase
      .channel("glossary_entries_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "glossary_entries" }, loadEntries)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const withBusy = async (entryId: string, fn: () => Promise<void>) => {
    setBusyEntryIds((prev) => ({ ...prev, [entryId]: true }));
    try {
      await fn();
    } finally {
      setBusyEntryIds((prev) => ({ ...prev, [entryId]: false }));
    }
  };

  const createEntry = async () => {
    if (savingCreate) return;
    const title = newTitle.trim();
    if (!title) {
      setError("A title is required.");
      return;
    }
    setSavingCreate(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: createError } = await supabase.from("glossary_entries").insert({
        id: crypto.randomUUID(),
        title,
        description: newDescription.trim(),
        images: [],
        is_locked: false,
        created_by_email: userEmail,
      });
      if (createError) throw createError;
      setNewTitle("");
      setNewDescription("");
      setShowCreateForm(false);
      await loadEntries();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create entry.");
    } finally {
      setSavingCreate(false);
    }
  };

  const startEditing = (entry: GlossaryEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditDescription(entry.description);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
  };

  const saveEdit = async (entry: GlossaryEntry) => {
    const canEdit = isDmUser || !entry.is_locked;
    if (!canEdit) return;
    const title = editTitle.trim();
    if (!title) {
      setError("A title is required.");
      return;
    }
    await withBusy(entry.id, async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("glossary_entries")
        .update({
          title,
          description: editDescription.trim(),
        })
        .eq("id", entry.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      cancelEditing();
      await loadEntries();
    });
  };

  const deleteEntry = async (entry: GlossaryEntry) => {
    const canEdit = isDmUser || !entry.is_locked;
    if (!canEdit) return;
    await withBusy(entry.id, async () => {
      const supabase = createClient();
      const { error: deleteError } = await supabase.from("glossary_entries").delete().eq("id", entry.id);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
      const imagePaths = (entry.images || [])
        .map((image) => image.path || parseBucketPathFromUrl(image.url, GLOSSARY_BUCKET))
        .filter((value): value is string => Boolean(value));
      if (imagePaths.length > 0) {
        await supabase.storage.from(GLOSSARY_BUCKET).remove(imagePaths);
      }
      setPendingDeleteId((prev) => (prev === entry.id ? null : prev));
      await loadEntries();
    });
  };

  const toggleLock = async (entry: GlossaryEntry) => {
    if (!isDmUser) return;
    await withBusy(entry.id, async () => {
      const supabase = createClient();
      const { error: toggleError } = await supabase
        .from("glossary_entries")
        .update({ is_locked: !entry.is_locked })
        .eq("id", entry.id);
      if (toggleError) {
        setError(toggleError.message);
        return;
      }
      await loadEntries();
    });
  };

  const uploadImages = async (entry: GlossaryEntry, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const canEdit = isDmUser || !entry.is_locked;
    if (!canEdit) return;

    setUploadingEntryIds((prev) => ({ ...prev, [entry.id]: true }));
    setError(null);
    try {
      const supabase = createClient();
      const existingImages = Array.isArray(entry.images) ? entry.images : [];
      const newlyUploaded: GlossaryImage[] = [];

      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setError(`"${file.name}" is not an image.`);
          continue;
        }
        const ext = file.name.split(".").pop() || "png";
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `entries/${entry.id}/${Date.now()}-${crypto.randomUUID()}-${safeBaseName}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(GLOSSARY_BUCKET)
          .upload(path, file, { upsert: false, cacheControl: "3600" });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from(GLOSSARY_BUCKET).getPublicUrl(path);
        newlyUploaded.push({
          url: data.publicUrl,
          path,
          name: file.name,
          uploaded_at: new Date().toISOString(),
        });
      }

      if (newlyUploaded.length === 0) return;

      const nextImages = [...existingImages, ...newlyUploaded];
      const { error: saveError } = await supabase
        .from("glossary_entries")
        .update({ images: nextImages })
        .eq("id", entry.id);
      if (saveError) throw saveError;
      await loadEntries();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload images.");
    } finally {
      setUploadingEntryIds((prev) => ({ ...prev, [entry.id]: false }));
    }
  };

  const deleteImage = async (entry: GlossaryEntry, index: number) => {
    const canEdit = isDmUser || !entry.is_locked;
    if (!canEdit) return;
    const images = Array.isArray(entry.images) ? entry.images : [];
    const target = images[index];
    if (!target) return;
    await withBusy(entry.id, async () => {
      const supabase = createClient();
      const nextImages = images.filter((_, imageIdx) => imageIdx !== index);
      const { error: updateError } = await supabase
        .from("glossary_entries")
        .update({ images: nextImages })
        .eq("id", entry.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      const path = target.path || parseBucketPathFromUrl(target.url, GLOSSARY_BUCKET);
      if (path) {
        await supabase.storage.from(GLOSSARY_BUCKET).remove([path]);
      }
      await loadEntries();
    });
  };

  const onUploadInputChange =
    (entry: GlossaryEntry) =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      await uploadImages(entry, event.target.files);
      event.target.value = "";
    };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-amber-400">Glossary</h2>
      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/40 p-4">
        <label className="block text-sm font-semibold text-amber-200">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Type to find entries..."
            className="mt-2 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xl font-bold text-amber-300">New Entry</h3>
          {!showCreateForm ? (
            <button
              onClick={() => setShowCreateForm(true)}
              className="rounded bg-amber-600 px-4 py-2 font-semibold text-gray-900 hover:bg-amber-500"
            >
              New Entry
            </button>
          ) : (
            <button
              onClick={() => setShowCreateForm(false)}
              className="rounded bg-gray-700 px-4 py-2 font-semibold text-amber-100 hover:bg-gray-600"
            >
              Cancel
            </button>
          )}
        </div>

        {showCreateForm && (
          <div className="space-y-3">
            <label className="block text-sm text-amber-200">
              Title
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Entry title"
                className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              />
            </label>
            <label className="block text-sm text-amber-200">
              Description
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={4}
                placeholder="Describe this entry..."
                className="mt-1 w-full rounded bg-gray-800 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              />
            </label>
            <button
              onClick={createEntry}
              disabled={savingCreate}
              className="rounded bg-amber-600 px-4 py-2 font-semibold text-gray-900 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {savingCreate ? "Creating..." : "Create Entry"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/40 p-4">
        <h3 className="mb-3 text-xl font-bold text-amber-300">Matches</h3>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {matchedEntries.length === 0 && normalizedQuery && (
            <p className="text-sm text-amber-100/70">No matches found for &quot;{search}&quot;.</p>
          )}
          {matchedEntries.length === 0 && !normalizedQuery && (
            <p className="text-sm text-amber-100/70">No glossary entries yet.</p>
          )}
          {matchedEntries.map((entry) => {
            const busy = Boolean(busyEntryIds[entry.id]);
            const isEditing = editingId === entry.id;
            const canEdit = isDmUser || !entry.is_locked;
            const entryImages = Array.isArray(entry.images) ? entry.images : [];
            const isDeletePromptOpen = pendingDeleteId === entry.id;

            return (
              <article key={entry.id} className="rounded-xl border border-amber-500/20 bg-gray-800/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        entry.is_locked ? "bg-red-900/60 text-red-200" : "bg-emerald-900/60 text-emerald-200"
                      }`}
                    >
                      {entry.is_locked ? "Locked" : "Unlocked"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isDmUser && (
                      <button
                        onClick={() => toggleLock(entry)}
                        disabled={busy}
                        className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600 disabled:opacity-60"
                        title={entry.is_locked ? "Unlock entry" : "Lock entry"}
                      >
                        {entry.is_locked ? "Unlock" : "Lock"}
                      </button>
                    )}
                    {!isEditing && canEdit && (
                      <button
                        onClick={() => startEditing(entry)}
                        disabled={busy}
                        className="rounded bg-blue-700 px-3 py-1 text-sm font-semibold text-blue-100 hover:bg-blue-600 disabled:opacity-60"
                      >
                        Edit
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={() => saveEdit(entry)}
                        disabled={busy || !canEdit}
                        className="rounded bg-emerald-700 px-3 py-1 text-sm font-semibold text-emerald-100 hover:bg-emerald-600 disabled:opacity-60"
                      >
                        Save
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={cancelEditing}
                        disabled={busy}
                        className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    )}
                    {!isDeletePromptOpen && canEdit && (
                      <button
                        onClick={() => setPendingDeleteId(entry.id)}
                        disabled={busy}
                        className="rounded bg-red-700 px-3 py-1 text-sm font-semibold text-red-100 hover:bg-red-600 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {isDeletePromptOpen && (
                  <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3">
                    <p className="text-sm text-red-100">
                      Delete &quot;{entry.title}&quot; permanently?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => deleteEntry(entry)}
                        disabled={busy || !canEdit}
                        className="rounded bg-red-700 px-3 py-1 text-sm font-semibold text-red-100 hover:bg-red-600 disabled:opacity-60"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        disabled={busy}
                        className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      className="w-full rounded bg-gray-900 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
                    />
                    <textarea
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      rows={5}
                      className="w-full rounded bg-gray-900 px-3 py-2 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
                    />
                  </div>
                ) : (
                  <div>
                    <h4 className="text-lg font-bold text-amber-100">{entry.title}</h4>
                    <p className="mt-1 whitespace-pre-wrap text-amber-100/90">{entry.description}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600 cursor-pointer">
                      Upload Images
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={!canEdit || Boolean(uploadingEntryIds[entry.id])}
                        onChange={onUploadInputChange(entry)}
                        className="hidden"
                      />
                    </label>
                    {uploadingEntryIds[entry.id] && (
                      <span className="text-xs text-amber-200/80">Uploading...</span>
                    )}
                  </div>

                  {entryImages.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                      {entryImages.map((image, idx) => (
                        <div key={`${entry.id}-image-${idx}`} className="rounded border border-amber-500/20 bg-gray-900/60 p-2">
                          <img
                            src={image.url}
                            alt={image.name || `Entry image ${idx + 1}`}
                            className="w-full h-auto rounded"
                          />
                          <button
                            onClick={() => deleteImage(entry, idx)}
                            disabled={!canEdit || busy}
                            className="mt-2 w-full rounded bg-red-800 px-2 py-1 text-xs font-semibold text-red-100 hover:bg-red-700 disabled:opacity-60"
                          >
                            Delete Image
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

    </div>
  );
}
