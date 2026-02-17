"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CombatProps = {
  isDM: boolean;
  userEmail: string | null;
};

type ZonePoint = {
  x: number;
  y: number;
};

type ZoneStroke = {
  points: ZonePoint[];
};

type LegacyZoneLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type InitiativeMonster = {
  id: string;
  name: string;
};

type InitiativeEntry = {
  participant_id: string;
  kind: "player" | "monster";
  name: string;
  user_email: string | null;
  icon_url: string | null;
  roll: number | null;
  slow_available: boolean;
  fast_available: boolean;
};

type CharacterLite = {
  id: string;
  name: string;
  email: string;
  icon_url: string | null;
};

type CombatStateRow = {
  id: number;
  map_url: string | null;
  zone_lines: (ZoneStroke | LegacyZoneLine)[] | null;
  token_positions: TokenPosition[] | null;
  initiative_monsters: InitiativeMonster[] | null;
  initiative_entries: InitiativeEntry[] | null;
  initiative_current_index: number | null;
  updated_by_email: string | null;
  updated_at: string;
};

type TokenPosition = {
  character_id: string;
  x: number;
  y: number;
};

type ImageRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const MAP_BUCKET = "combat-assets";
const DM_EMAIL = "drocasma9@gmail.com";

function isLegacyLine(value: unknown): value is LegacyZoneLine {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x1 === "number" &&
    typeof v.y1 === "number" &&
    typeof v.x2 === "number" &&
    typeof v.y2 === "number"
  );
}

function isStroke(value: unknown): value is ZoneStroke {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.points)) return false;

  return v.points.every(
    (point) =>
      !!point &&
      typeof point === "object" &&
      typeof (point as Record<string, unknown>).x === "number" &&
      typeof (point as Record<string, unknown>).y === "number"
  );
}

function normalizeZoneLines(raw: (ZoneStroke | LegacyZoneLine)[] | null | undefined): ZoneStroke[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => {
      if (isStroke(entry)) return entry;
      if (isLegacyLine(entry)) {
        return {
          points: [
            { x: entry.x1, y: entry.y1 },
            { x: entry.x2, y: entry.y2 },
          ],
        };
      }
      return null;
    })
    .filter((entry): entry is ZoneStroke => !!entry);
}

function rollUnique(set: Set<string>): number {
  const base = Math.floor(Math.random() * 10);
  let frac = "";
  let key = `${base}`;

  while (set.has(key)) {
    frac += `${Math.floor(Math.random() * 10)}`;
    key = `${base}.${frac}`;
  }

  set.add(key);
  return Number(key);
}

function formatRoll(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text;
}

function rollSortValue(value: number | null): number {
  return value ?? -1;
}

function buildZoneTintDataUrl(strokes: ZoneStroke[], gridW = 320, gridH = 320): string | null {
  if (typeof document === "undefined") return null;

  const lineCanvas = document.createElement("canvas");
  lineCanvas.width = gridW;
  lineCanvas.height = gridH;
  const lctx = lineCanvas.getContext("2d");
  if (!lctx) return null;

  lctx.clearRect(0, 0, gridW, gridH);
  lctx.strokeStyle = "black";
  lctx.lineWidth = 3;
  lctx.lineCap = "round";
  lctx.lineJoin = "round";

  // Implicit border of the map
  lctx.strokeRect(0, 0, gridW, gridH);

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 2) continue;
    lctx.beginPath();
    lctx.moveTo(stroke.points[0].x * gridW, stroke.points[0].y * gridH);
    for (let i = 1; i < stroke.points.length; i++) {
      lctx.lineTo(stroke.points[i].x * gridW, stroke.points[i].y * gridH);
    }
    lctx.stroke();
  }

  const lineImage = lctx.getImageData(0, 0, gridW, gridH);
  const lineData = lineImage.data;
  const output = document.createElement("canvas");
  output.width = gridW;
  output.height = gridH;
  const octx = output.getContext("2d");
  if (!octx) return null;
  const outImage = octx.createImageData(gridW, gridH);
  const outData = outImage.data;

  const isBoundary = (idx: number) => lineData[idx + 3] > 100;
  const visited = new Uint8Array(gridW * gridH);
  const qx = new Int32Array(gridW * gridH);
  const qy = new Int32Array(gridW * gridH);
  let regionIndex = 0;

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const cell = y * gridW + x;
      if (visited[cell]) continue;
      visited[cell] = 1;

      const pxIdx = cell * 4;
      if (isBoundary(pxIdx)) continue;

      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;

      const regionCells: number[] = [];

      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        const cCell = cy * gridW + cx;
        regionCells.push(cCell);

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
          const nCell = ny * gridW + nx;
          if (visited[nCell]) continue;
          visited[nCell] = 1;

          const nIdx = nCell * 4;
          if (isBoundary(nIdx)) continue;

          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      // Ignore tiny artifacts/slivers from anti-aliasing
      if (regionCells.length < 25) continue;

      const hue = (regionIndex * 67) % 360;
      const sat = 75;
      const light = 50;
      const alpha = 70; // 0-255

      // Convert HSL to RGB quickly
      const c = (1 - Math.abs((2 * light) / 100 - 1)) * (sat / 100);
      const hPrime = hue / 60;
      const xcol = c * (1 - Math.abs((hPrime % 2) - 1));
      let r1 = 0;
      let g1 = 0;
      let b1 = 0;
      if (hPrime >= 0 && hPrime < 1) [r1, g1, b1] = [c, xcol, 0];
      else if (hPrime < 2) [r1, g1, b1] = [xcol, c, 0];
      else if (hPrime < 3) [r1, g1, b1] = [0, c, xcol];
      else if (hPrime < 4) [r1, g1, b1] = [0, xcol, c];
      else if (hPrime < 5) [r1, g1, b1] = [xcol, 0, c];
      else [r1, g1, b1] = [c, 0, xcol];
      const m = light / 100 - c / 2;
      const rr = Math.round((r1 + m) * 255);
      const gg = Math.round((g1 + m) * 255);
      const bb = Math.round((b1 + m) * 255);

      for (const regionCell of regionCells) {
        const outIdx = regionCell * 4;
        outData[outIdx] = rr;
        outData[outIdx + 1] = gg;
        outData[outIdx + 2] = bb;
        outData[outIdx + 3] = alpha;
      }

      regionIndex++;
    }
  }

  octx.putImageData(outImage, 0, 0);
  return output.toDataURL("image/png");
}

function normalizeInitiativeEntries(raw: InitiativeEntry[] | null | undefined): InitiativeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<InitiativeEntry>;
      if (typeof e.participant_id !== "string") return null;
      if (e.kind !== "player" && e.kind !== "monster") return null;
      if (typeof e.name !== "string") return null;
      if (e.roll !== null && typeof e.roll !== "number") return null;

      return {
        participant_id: e.participant_id,
        kind: e.kind,
        name: e.name,
        user_email: typeof e.user_email === "string" ? e.user_email : null,
        icon_url: typeof e.icon_url === "string" ? e.icon_url : null,
        roll: typeof e.roll === "number" ? e.roll : null,
        slow_available: e.slow_available ?? true,
        fast_available: e.fast_available ?? true,
      };
    })
    .filter((entry): entry is InitiativeEntry => !!entry);
}

function normalizeTokenPositions(raw: TokenPosition[] | null | undefined): TokenPosition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as Partial<TokenPosition>;
      if (typeof v.character_id !== "string") return null;
      if (typeof v.x !== "number" || typeof v.y !== "number") return null;
      if (v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1) return null;
      return { character_id: v.character_id, x: v.x, y: v.y };
    })
    .filter((value): value is TokenPosition => !!value);
}

export default function Combat({ isDM, userEmail }: CombatProps) {
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [zoneLines, setZoneLines] = useState<ZoneStroke[]>([]);
  const [tokenPositions, setTokenPositions] = useState<TokenPosition[]>([]);
  const [initiativeMonsters, setInitiativeMonsters] = useState<InitiativeMonster[]>([]);
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeCurrentIndex, setInitiativeCurrentIndex] = useState<number | null>(null);
  const [characters, setCharacters] = useState<CharacterLite[]>([]);
  const [monsterNameDrafts, setMonsterNameDrafts] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftLine, setDraftLine] = useState<ZoneStroke | null>(null);
  const [showZoneTint, setShowZoneTint] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageNatural, setImageNatural] = useState<{ w: number; h: number } | null>(null);
  const [imageRect, setImageRect] = useState<ImageRect | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const isDmUser = isDM && userEmail === DM_EMAIL;
  const canDraw = isDmUser && !!mapUrl && !!imageRect;
  const playerEntries = useMemo<InitiativeEntry[]>(
    () =>
      characters.map((player) => ({
        participant_id: `player:${player.id}`,
        kind: "player",
        name: player.name,
        user_email: player.email,
        icon_url: player.icon_url,
        roll: null,
        slow_available: true,
        fast_available: true,
      })),
    [characters]
  );
  const displayedInitiativeEntries = useMemo(
    () => (initiativeEntries.length > 0 ? initiativeEntries : playerEntries),
    [initiativeEntries, playerEntries]
  );
  const currentEntry =
    initiativeCurrentIndex !== null &&
    initiativeCurrentIndex >= 0 &&
    initiativeCurrentIndex < displayedInitiativeEntries.length
      ? displayedInitiativeEntries[initiativeCurrentIndex]
      : null;

  const zoneTintUrl = useMemo(() => {
    if (!isDmUser || !showZoneTint) return null;
    const strokes = draftLine ? [...zoneLines, draftLine] : zoneLines;
    if (strokes.length === 0) return null;
    return buildZoneTintDataUrl(strokes);
  }, [draftLine, isDmUser, showZoneTint, zoneLines]);

  const canPlaceTokenFor = useCallback(
    (characterEmail: string | null) => {
      if (!userEmail) return false;
      if (isDmUser) return true;
      return !!characterEmail && characterEmail === userEmail;
    },
    [isDmUser, userEmail]
  );

  const renderedTokens = useMemo(
    () =>
      tokenPositions
        .map((pos) => {
          const character = characters.find((char) => char.id === pos.character_id);
          if (!character) return null;
          return { ...pos, character };
        })
        .filter((value): value is TokenPosition & { character: CharacterLite } => !!value),
    [tokenPositions, characters]
  );
  const draggableTokenCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const token of renderedTokens) {
      if (canPlaceTokenFor(token.character.email)) {
        ids.add(token.character_id);
      }
    }
    return ids;
  }, [renderedTokens, canPlaceTokenFor]);

  const canPass = useMemo(() => {
    if (!currentEntry || !userEmail) return false;
    if (isDmUser) return true;
    return !!currentEntry.user_email && currentEntry.user_email === userEmail;
  }, [currentEntry, userEmail, isDmUser]);

  const loadCombatState = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("combat_state")
      .select(
        "id, map_url, zone_lines, token_positions, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email, updated_at"
      )
      .eq("id", 1)
      .maybeSingle<CombatStateRow>();

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setMapUrl(data?.map_url ?? null);
    setZoneLines(normalizeZoneLines(data?.zone_lines));
    setTokenPositions(normalizeTokenPositions(data?.token_positions));
    setInitiativeMonsters(Array.isArray(data?.initiative_monsters) ? data!.initiative_monsters : []);
    setInitiativeEntries(normalizeInitiativeEntries(data?.initiative_entries));
    setInitiativeCurrentIndex(data?.initiative_current_index ?? null);
    setError(null);
  }, []);

  const loadCharacters = useCallback(async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("characters")
      .select("id, name, email, icon_url")
      .order("name", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setCharacters((data ?? []) as CharacterLite[]);
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !imageNatural) {
      setImageRect(null);
      return;
    }

    const recompute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw <= 0 || ch <= 0 || imageNatural.w <= 0 || imageNatural.h <= 0) {
        setImageRect(null);
        return;
      }

      const s = Math.min(cw / imageNatural.w, ch / imageNatural.h);
      const w = imageNatural.w * s;
      const h = imageNatural.h * s;
      const x = (cw - w) / 2;
      const y = (ch - h) / 2;
      setImageRect({ x, y, w, h });
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [imageNatural]);

  useEffect(() => {
    loadCharacters();
    loadCombatState();

    const supabase = createClient();
    const channel = supabase
      .channel("combat-state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "combat_state" },
        () => {
          loadCombatState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCombatState, loadCharacters]);

  const uploadBattlemap = useCallback(
    async (file: File) => {
      if (!isDmUser) {
        setError("Only the DM can upload battlemaps.");
        return;
      }

      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError("Image must be smaller than 10MB.");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        const supabase = createClient();
        const extension = file.name.split(".").pop() || "png";
        const path = `battlemaps/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from(MAP_BUCKET)
          .upload(path, file, { upsert: false, cacheControl: "3600" });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from(MAP_BUCKET).getPublicUrl(path);

        const { error: upsertError } = await supabase
          .from("combat_state")
          .upsert(
            {
              id: 1,
              map_url: publicData.publicUrl,
              zone_lines: [],
              updated_by_email: userEmail,
            },
            { onConflict: "id" }
          );
        if (upsertError) throw upsertError;

        setMapUrl(publicData.publicUrl);
        setZoneLines([]);
        setDraftLine(null);
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : "Upload failed.";
        setError(message);
      } finally {
        setIsUploading(false);
      }
    },
    [isDmUser, userEmail]
  );

  const saveZoneLines = useCallback(
    async (lines: ZoneStroke[]) => {
      if (!isDmUser) return;
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("combat_state")
        .upsert(
          {
            id: 1,
            zone_lines: lines,
            updated_by_email: userEmail,
          },
          { onConflict: "id" }
        );
      if (saveError) {
        setError(saveError.message);
      }
    },
    [isDmUser, userEmail]
  );

  const saveInitiativeState = useCallback(
    async (
      entries: InitiativeEntry[],
      currentIndex: number | null,
      monsters: InitiativeMonster[] = initiativeMonsters
    ) => {
      if (!isDmUser) return;
      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("combat_state")
        .upsert(
          {
            id: 1,
            initiative_entries: entries,
            initiative_current_index: currentIndex,
            initiative_monsters: monsters,
            updated_by_email: userEmail,
          },
          { onConflict: "id" }
        );
      if (saveError) {
        setError(saveError.message);
      }
    },
    [initiativeMonsters, isDmUser, userEmail]
  );

  const rollInitiative = async () => {
    if (!isDmUser) return;
    const used = new Set<string>();

    const entries: InitiativeEntry[] = [
      ...characters.map((player) => ({
        participant_id: `player:${player.id}`,
        kind: "player" as const,
        name: player.name,
        user_email: player.email,
        icon_url: player.icon_url,
        roll: rollUnique(used),
        slow_available: true,
        fast_available: true,
      })),
      ...initiativeMonsters.map((monster) => ({
        participant_id: monster.id,
        kind: "monster" as const,
        name: monster.name,
        user_email: null,
        icon_url: null,
        roll: rollUnique(used),
        slow_available: true,
        fast_available: true,
      })),
    ].sort((a, b) => rollSortValue(b.roll) - rollSortValue(a.roll));

    const currentIndex = entries.length > 0 ? 0 : null;
    setInitiativeEntries(entries);
    setInitiativeCurrentIndex(currentIndex);
    await saveInitiativeState(entries, currentIndex);
  };

  const resetInitiative = async () => {
    if (!isDmUser) return;
    setInitiativeMonsters([]);
    setInitiativeEntries([]);
    setInitiativeCurrentIndex(null);
    setMonsterNameDrafts({});
    await saveInitiativeState([], null, []);
  };

  const addMonster = async () => {
    if (!isDmUser) return;

    const defaultName = `Monster ${initiativeMonsters.length + 1}`;
    const typed = window.prompt("Monster name", defaultName);
    if (typed === null) return;

    const name = typed.trim() || defaultName;
    const monster: InitiativeMonster = {
      id: `monster:${crypto.randomUUID()}`,
      name,
    };

    const nextMonsters = [...initiativeMonsters, monster];
    setInitiativeMonsters(nextMonsters);

    let nextEntries = initiativeEntries;
    let nextCurrent = initiativeCurrentIndex;

    if (initiativeEntries.length > 0) {
      const used = new Set(
        initiativeEntries.flatMap((entry) =>
          entry.roll === null ? [] : [formatRoll(entry.roll)]
        )
      );
      const currentParticipant = currentEntry?.participant_id ?? null;

      nextEntries = [
        ...initiativeEntries,
        {
          participant_id: monster.id,
          kind: "monster" as const,
          name: monster.name,
          user_email: null,
          icon_url: null,
          roll: rollUnique(used),
          slow_available: true,
          fast_available: true,
        },
      ].sort((a, b) => rollSortValue(b.roll) - rollSortValue(a.roll));

      if (currentParticipant) {
        const idx = nextEntries.findIndex((entry) => entry.participant_id === currentParticipant);
        nextCurrent = idx >= 0 ? idx : 0;
      } else {
        nextCurrent = 0;
      }

      setInitiativeEntries(nextEntries);
      setInitiativeCurrentIndex(nextCurrent);
    }

    await saveInitiativeState(nextEntries, nextCurrent, nextMonsters);
  };

  const renameMonster = async (monsterId: string, nameRaw: string) => {
    if (!isDmUser) return;
    const name = nameRaw.trim();
    if (!name) return;

    const nextMonsters = initiativeMonsters.map((monster) =>
      monster.id === monsterId ? { ...monster, name } : monster
    );
    setInitiativeMonsters(nextMonsters);

    const nextEntries = initiativeEntries.map((entry) =>
      entry.participant_id === monsterId ? { ...entry, name } : entry
    );
    setInitiativeEntries(nextEntries);

    await saveInitiativeState(nextEntries, initiativeCurrentIndex, nextMonsters);
  };

  const deleteMonster = async (monsterId: string) => {
    if (!isDmUser) return;

    const nextMonsters = initiativeMonsters.filter((monster) => monster.id !== monsterId);
    const removedEntryIndex = initiativeEntries.findIndex((entry) => entry.participant_id === monsterId);
    const nextEntries = initiativeEntries.filter((entry) => entry.participant_id !== monsterId);

    let nextCurrent = initiativeCurrentIndex;
    if (nextEntries.length === 0) {
      nextCurrent = null;
    } else if (nextCurrent !== null) {
      if (removedEntryIndex === nextCurrent) {
        nextCurrent = nextCurrent >= nextEntries.length ? 0 : nextCurrent;
      } else if (removedEntryIndex >= 0 && removedEntryIndex < nextCurrent) {
        nextCurrent = nextCurrent - 1;
      }
    }

    setInitiativeMonsters(nextMonsters);
    setInitiativeEntries(nextEntries);
    setInitiativeCurrentIndex(nextCurrent);
    setMonsterNameDrafts((prev) => {
      const next = { ...prev };
      delete next[monsterId];
      return next;
    });
    await saveInitiativeState(nextEntries, nextCurrent, nextMonsters);
  };

  const passTurn = async () => {
    if (!canPass) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_pass_turn");
    if (rpcError) {
      setError(rpcError.message);
    }
  };

  const consumeAction = async (actionType: "fast" | "slow") => {
    if (!canPass) return;
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_use_action", { p_action: actionType });
    if (rpcError) {
      setError(rpcError.message);
    }
  };

  const dropEventToNormalizedPoint = (event: React.DragEvent<HTMLDivElement>): ZonePoint | null => {
    const container = mapContainerRef.current;
    if (!container || !imageRect) return null;
    const rect = container.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;

    if (
      xPx < imageRect.x ||
      yPx < imageRect.y ||
      xPx > imageRect.x + imageRect.w ||
      yPx > imageRect.y + imageRect.h
    ) {
      return null;
    }

    return {
      x: (xPx - imageRect.x) / imageRect.w,
      y: (yPx - imageRect.y) / imageRect.h,
    };
  };

  const placePlayerToken = async (characterId: string, point: ZonePoint) => {
    const player = characters.find((char) => char.id === characterId);
    if (!player) {
      setError("Could not find player for token placement.");
      return;
    }
    if (!canPlaceTokenFor(player.email)) {
      setError("You can only place your own token.");
      return;
    }

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("combat_upsert_player_token", {
      p_character_id: characterId,
      p_x: point.x,
      p_y: point.y,
    });
    if (rpcError) {
      setError(rpcError.message);
    }
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const tokenCharacterId = event.dataTransfer.getData("application/x-combat-player-id");
    if (tokenCharacterId && mapUrl && imageRect) {
      const point = dropEventToNormalizedPoint(event);
      if (!point) return;
      await placePlayerToken(tokenCharacterId, point);
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      await uploadBattlemap(file);
    }
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadBattlemap(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const toNormalizedPoint = (event: React.PointerEvent<SVGSVGElement>): ZonePoint | null => {
    const container = mapContainerRef.current;
    if (!container || !imageRect) return null;
    const rect = container.getBoundingClientRect();
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;

    if (
      xPx < imageRect.x ||
      yPx < imageRect.y ||
      xPx > imageRect.x + imageRect.w ||
      yPx > imageRect.y + imageRect.h
    ) {
      return null;
    }

    return {
      x: (xPx - imageRect.x) / imageRect.w,
      y: (yPx - imageRect.y) / imageRect.h,
    };
  };

  const onDrawStart = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canDraw) return;
    const point = toNormalizedPoint(event);
    if (!point) return;
    setIsDrawing(true);
    setDraftLine({ points: [point] });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrawMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing || !canDraw) return;
    const point = toNormalizedPoint(event);
    if (!point) return;

    setDraftLine((prev) => {
      if (!prev || prev.points.length === 0) return prev;
      const lastPoint = prev.points[prev.points.length - 1];
      const delta = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
      if (delta < 0.002) return prev;
      return { points: [...prev.points, point] };
    });
  };

  const onDrawEnd = async () => {
    if (!isDrawing || !draftLine) return;
    setIsDrawing(false);

    if (draftLine.points.length < 2) {
      setDraftLine(null);
      return;
    }

    const next = [...zoneLines, draftLine];
    setZoneLines(next);
    setDraftLine(null);
    await saveZoneLines(next);
  };

  const clearZones = async () => {
    if (!canDraw) return;
    setZoneLines([]);
    setDraftLine(null);
    await saveZoneLines([]);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 min-h-[560px]">
      <aside className="min-h-[520px] max-h-[520px] rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3">
        <h3 className="text-xl font-bold text-amber-300 mb-3">Combat Actions</h3>
        <div className="rounded border border-amber-500/20 bg-gray-900/30 p-3 text-sm text-amber-100/90 mb-3">
          {currentEntry ? `Current: ${currentEntry.name}` : "No active turn"}
        </div>
        <div className="space-y-2">
          <button
            onClick={() => consumeAction("slow")}
            disabled={!canPass || !currentEntry?.slow_available}
            className="w-full rounded bg-green-700 px-3 py-2 text-sm font-semibold text-green-100 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Dummy Slow
          </button>
          <button
            onClick={() => consumeAction("fast")}
            disabled={!canPass || !currentEntry?.fast_available}
            className="w-full rounded bg-orange-700 px-3 py-2 text-sm font-semibold text-orange-100 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Dummy Fast
          </button>
          <button
            onClick={passTurn}
            disabled={!canPass}
            className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Pass
          </button>
        </div>
      </aside>

      <div className="lg:col-span-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
          disabled={!isDmUser || isUploading}
        />

        <div
          ref={mapContainerRef}
          onDragOver={(event) => {
            const hasToken = event.dataTransfer.types.includes("application/x-combat-player-id");
            const hasFile = event.dataTransfer.files && event.dataTransfer.files.length > 0;
            const canAcceptToken = hasToken && !!mapUrl && !!imageRect;
            const canAcceptFile = hasFile && isDmUser;
            if (!canAcceptToken && !canAcceptFile) return;
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`relative h-full min-h-[520px] overflow-hidden rounded-2xl border transition-all ${
            isDragging ? "border-amber-300 bg-amber-500/10" : "border-amber-500/40 bg-black/20"
          }`}
        >
          {mapUrl ? (
            <>
              <img
                src={mapUrl}
                alt="Battlemap"
                className="h-full w-full object-contain select-none pointer-events-none"
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onLoad={(event) =>
                  setImageNatural({
                    w: event.currentTarget.naturalWidth,
                    h: event.currentTarget.naturalHeight,
                  })
                }
              />
              {imageRect && (
                <svg
                  className={`absolute inset-0 h-full w-full ${canDraw ? "cursor-crosshair" : "pointer-events-none"}`}
                  onDragStart={(event) => event.preventDefault()}
                  style={{ touchAction: "none" }}
                  onPointerDown={onDrawStart}
                  onPointerMove={onDrawMove}
                  onPointerUp={onDrawEnd}
                  onPointerCancel={onDrawEnd}
                >
                  <g transform={`translate(${imageRect.x}, ${imageRect.y})`}>
                    <rect
                      x={0}
                      y={0}
                      width={imageRect.w}
                      height={imageRect.h}
                      fill="none"
                      stroke="black"
                      strokeWidth={4}
                    />
                    {zoneLines.map((stroke, idx) => (
                      <polyline
                        key={`stroke-${idx}`}
                        points={stroke.points
                          .map((point) => `${point.x * imageRect.w},${point.y * imageRect.h}`)
                          .join(" ")}
                        fill="none"
                        stroke="black"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {draftLine && (
                      <polyline
                        points={draftLine.points
                          .map((point) => `${point.x * imageRect.w},${point.y * imageRect.h}`)
                          .join(" ")}
                        fill="none"
                        stroke="black"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </g>
                </svg>
              )}
              {showZoneTint && zoneTintUrl && imageRect && (
                <img
                  src={zoneTintUrl}
                  alt="Zone tint preview"
                  className="absolute pointer-events-none"
                  style={{
                    left: imageRect.x,
                    top: imageRect.y,
                    width: imageRect.w,
                    height: imageRect.h,
                  }}
                />
              )}
              {imageRect &&
                renderedTokens.map((token) => (
                  <div
                    key={token.character_id}
                    draggable={draggableTokenCharacterIds.has(token.character_id)}
                    onDragStart={(event) => {
                      if (!draggableTokenCharacterIds.has(token.character_id)) return;
                      event.dataTransfer.setData("application/x-combat-player-id", token.character_id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                      draggableTokenCharacterIds.has(token.character_id)
                        ? "cursor-grab active:cursor-grabbing"
                        : "cursor-default"
                    }`}
                    style={{
                      left: imageRect.x + token.x * imageRect.w,
                      top: imageRect.y + token.y * imageRect.h,
                    }}
                    title={token.character.name}
                  >
                    {token.character.icon_url ? (
                      <img
                        src={token.character.icon_url}
                        alt={token.character.name}
                        draggable={false}
                        className="h-10 w-10 rounded-full border-2 border-amber-200/90 object-cover shadow-lg"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-amber-200/90 bg-gray-800 text-xs font-bold text-amber-100 shadow-lg">
                        {token.character.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                ))}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <h2 className="text-2xl font-bold text-amber-300">VTT Map</h2>
              <p className="mt-3 text-amber-100/70">
                {isDmUser ? "Drag and drop a battlemap image here." : "No battlemap has been uploaded yet."}
              </p>
            </div>
          )}

          {isDmUser && (
            <div className="absolute bottom-4 left-4 flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-gray-900 shadow hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isUploading ? "Uploading..." : "Upload Battlemap"}
              </button>
              {mapUrl && (
                <button
                  onClick={clearZones}
                  className="rounded-lg bg-gray-700 px-4 py-2 font-semibold text-amber-100 shadow hover:bg-gray-600"
                >
                  Clear Zones
                </button>
              )}
              {mapUrl && (
                <button
                  onClick={() => setShowZoneTint((prev) => !prev)}
                  className={`rounded-lg px-4 py-2 font-semibold shadow ${
                    showZoneTint
                      ? "bg-emerald-600 hover:bg-emerald-500 text-emerald-100"
                      : "bg-gray-700 hover:bg-gray-600 text-amber-100"
                  }`}
                >
                  Zone Tint {showZoneTint ? "On" : "Off"}
                </button>
              )}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      <aside className="min-h-[520px] max-h-[520px] rounded-2xl border border-amber-500/40 bg-black/20 p-4 flex flex-col lg:col-span-3">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-amber-300">Initiative</h3>
          <div className="text-xs text-amber-200/80">
            {currentEntry ? `Turn: ${currentEntry.name}` : "No turn"}
          </div>
        </div>

        {isDmUser && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={rollInitiative}
              className="rounded bg-amber-500 px-3 py-1 text-sm font-semibold text-gray-900 hover:bg-amber-400"
            >
              Roll
            </button>
            <button
              onClick={resetInitiative}
              className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Reset
            </button>
            <button
              onClick={addMonster}
              className="rounded bg-gray-700 px-3 py-1 text-sm font-semibold text-amber-100 hover:bg-gray-600"
            >
              Add Monster
            </button>
          </div>
        )}

        <div className="space-y-2 overflow-y-auto pr-1 flex-1">
          {displayedInitiativeEntries.length === 0 && (
            <div className="rounded border border-dashed border-amber-500/30 bg-gray-900/30 p-3 text-sm text-amber-100/70">
              No initiative rolled.
            </div>
          )}

          {displayedInitiativeEntries.map((entry, index) => {
            const isCurrent = index === initiativeCurrentIndex;
            const nameDraft = monsterNameDrafts[entry.participant_id] ?? entry.name;
            const isPlayer = entry.kind === "player" && entry.participant_id.startsWith("player:");
            const playerCharacterId = isPlayer ? entry.participant_id.slice("player:".length) : null;
            const draggableToken = isPlayer && canPlaceTokenFor(entry.user_email);

            return (
              <div
                key={entry.participant_id}
                draggable={draggableToken}
                onDragStart={(event) => {
                  if (!draggableToken || !playerCharacterId) return;
                  event.dataTransfer.setData("application/x-combat-player-id", playerCharacterId);
                  event.dataTransfer.effectAllowed = "move";
                }}
                className={`flex items-center gap-2 rounded p-2 ${
                  isCurrent ? "bg-amber-500/20 border border-amber-400/70" : "bg-gray-900/40 border border-transparent"
                } ${draggableToken ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {entry.icon_url ? (
                  <img src={entry.icon_url} alt={entry.name} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs text-amber-100">
                    {entry.kind === "monster" ? "M" : "P"}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  {isDmUser && entry.kind === "monster" ? (
                    <input
                      value={nameDraft}
                      onChange={(event) =>
                        setMonsterNameDrafts((prev) => ({
                          ...prev,
                          [entry.participant_id]: event.target.value,
                        }))
                      }
                      onBlur={() => renameMonster(entry.participant_id, nameDraft)}
                      className="w-full rounded bg-gray-800 px-2 py-1 text-sm text-amber-100 outline-none ring-1 ring-gray-600 focus:ring-amber-400"
                    />
                  ) : (
                    <div className="truncate text-sm text-amber-100">{entry.name}</div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      entry.slow_available ? "bg-green-500" : "bg-green-900/50 ring-1 ring-green-700"
                    }`}
                    title="Slow Action"
                  />
                  <span
                    className={`inline-block h-0 w-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent ${
                      entry.fast_available ? "border-b-orange-500" : "border-b-orange-900/50"
                    }`}
                    title="Fast Action"
                  />
                </div>

                <div className="text-sm font-bold text-amber-300">{entry.roll === null ? "—" : formatRoll(entry.roll)}</div>
                {isDmUser && entry.kind === "monster" && (
                  <button
                    onClick={() => deleteMonster(entry.participant_id)}
                    className="rounded bg-red-700 px-2 py-1 text-xs font-semibold text-red-100 hover:bg-red-600"
                    title="Delete monster"
                  >
                    X
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
