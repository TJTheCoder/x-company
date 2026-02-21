"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type MapBoardProps = {
  isDM: boolean;
  onPollCreated?: () => void;
};

type MapPoint = {
  x: number;
  y: number;
};

type MapStroke = {
  id: string;
  tool: "draw" | "erase";
  size: number;
  points: MapPoint[];
};

type MapLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
};

type MapStateRow = {
  id: number;
  strokes: MapStroke[] | null;
  labels: MapLabel[] | null;
  updated_at?: string;
};

const CANVAS_WIDTH = 5200;
const CANVAS_HEIGHT = 3400;
const DRAW_SIZE = 4;
const ERASE_SIZE = 26;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.2;
const DEFAULT_LABEL_SIZE = 22;
const MIN_LABEL_SIZE = 10;
const MAX_LABEL_SIZE = 72;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeStrokes = (input: unknown): MapStroke[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<MapStroke>;
      const points = Array.isArray(row.points)
        ? row.points
            .map((pt) => {
              if (!pt || typeof pt !== "object") return null;
              const p = pt as Partial<MapPoint>;
              const x = Number(p.x);
              const y = Number(p.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              return {
                x: clamp(x, 0, CANVAS_WIDTH),
                y: clamp(y, 0, CANVAS_HEIGHT),
              };
            })
            .filter((pt): pt is MapPoint => Boolean(pt))
        : [];
      if (points.length < 2) return null;
      return {
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        tool: row.tool === "erase" ? "erase" : "draw",
        size:
          Number.isFinite(Number(row.size)) && Number(row.size) > 0
            ? Math.min(128, Number(row.size))
            : row.tool === "erase"
              ? ERASE_SIZE
              : DRAW_SIZE,
        points,
      } satisfies MapStroke;
    })
    .filter((row): row is MapStroke => Boolean(row));
};

const normalizeLabels = (input: unknown): MapLabel[] => {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<MapLabel>;
      const text = typeof row.text === "string" ? row.text.trim() : "";
      const x = Number(row.x);
      const y = Number(row.y);
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const sizeRaw = Number((row as { size?: number }).size);
      return {
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        text,
        x: clamp(x, 0, CANVAS_WIDTH),
        y: clamp(y, 0, CANVAS_HEIGHT),
        size:
          Number.isFinite(sizeRaw) && sizeRaw > 0
            ? clamp(Math.round(sizeRaw), MIN_LABEL_SIZE, MAX_LABEL_SIZE)
            : DEFAULT_LABEL_SIZE,
      };
    })
    .filter((row): row is MapLabel => Boolean(row));
};

const pointFromEvent = (event: React.PointerEvent<HTMLElement>): MapPoint => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH, 0, CANVAS_WIDTH),
    y: clamp(((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT, 0, CANVAS_HEIGHT),
  };
};

const drawStroke = (ctx: CanvasRenderingContext2D, stroke: MapStroke) => {
  if (stroke.points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = stroke.tool === "erase" ? "#ffffff" : "#000000";
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
};

export default function MapBoard({ isDM, onPollCreated }: MapBoardProps) {
  const [strokes, setStrokes] = useState<MapStroke[]>([]);
  const [labels, setLabels] = useState<MapLabel[]>([]);
  const [activeStroke, setActiveStroke] = useState<MapStroke | null>(null);
  const [tool, setTool] = useState<"pan" | "draw" | "erase" | "text">("draw");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [textSizeInput, setTextSizeInput] = useState(`${DEFAULT_LABEL_SIZE}`);
  const [viewportPan, setViewportPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  const allStrokes = useMemo(
    () => (activeStroke ? [...strokes, activeStroke] : strokes),
    [activeStroke, strokes]
  );

  const loadMapState = async () => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("map_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle<MapStateRow>();
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    if (!data) {
      setStrokes([]);
      setLabels([]);
      setLoading(false);
      return;
    }
    setStrokes(normalizeStrokes(data.strokes));
    setLabels(normalizeLabels(data.labels));
    setLoading(false);
  };

  const saveMapState = async (nextStrokes: MapStroke[], nextLabels: MapLabel[]) => {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: saveError } = await supabase.from("map_state").upsert(
        {
          id: 1,
          strokes: nextStrokes,
          labels: nextLabels,
        },
        { onConflict: "id" }
      );
      if (saveError) throw saveError;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save map.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadMapState();
    const supabase = createClient();
    const channel = supabase
      .channel("map_state_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "map_state" }, loadMapState)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    allStrokes.forEach((stroke) => drawStroke(ctx, stroke));
  }, [allStrokes]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDM) return;
    if (tool !== "draw" && tool !== "erase") return;
    const pt = pointFromEvent(event);
    const draft: MapStroke = {
      id: crypto.randomUUID(),
      tool,
      size: tool === "erase" ? ERASE_SIZE : DRAW_SIZE,
      points: [pt],
    };
    setActiveStroke(draft);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeStroke) return;
    const pt = pointFromEvent(event);
    setActiveStroke((prev) => {
      if (!prev) return prev;
      const last = prev.points[prev.points.length - 1];
      if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < 1.2) return prev;
      return { ...prev, points: [...prev.points, pt] };
    });
  };

  const finalizeStroke = async (pointerId?: number) => {
    if (!activeStroke) return;
    if (activeStroke.points.length < 2) {
      setActiveStroke(null);
      return;
    }
    const nextStrokes = [...strokes, activeStroke];
    setStrokes(nextStrokes);
    setActiveStroke(null);
    await saveMapState(nextStrokes, labels);
    if (pointerId !== undefined && canvasRef.current?.hasPointerCapture(pointerId)) {
      canvasRef.current.releasePointerCapture(pointerId);
    }
  };

  const handleCanvasClick = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDM || tool !== "text") return;
    const pt = pointFromEvent(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    const label = textDraft.trim();
    if (!label) return;
    const parsedSize = Number.parseInt(textSizeInput, 10);
    const nextSize = Number.isFinite(parsedSize)
      ? clamp(parsedSize, MIN_LABEL_SIZE, MAX_LABEL_SIZE)
      : DEFAULT_LABEL_SIZE;
    const nextLabels = [
      ...labels,
      {
        id: crypto.randomUUID(),
        text: label,
        x: pt.x,
        y: pt.y,
        size: nextSize,
      },
    ];
    setLabels(nextLabels);
    await saveMapState(strokes, nextLabels);
  };

  const clearBoard = async () => {
    if (!isDM) return;
    setStrokes([]);
    setLabels([]);
    await saveMapState([], []);
  };

  const removeLabel = async (labelId: string) => {
    if (!isDM) return;
    const nextLabels = labels.filter((label) => label.id !== labelId);
    setLabels(nextLabels);
    setSelectedLabelId((prev) => (prev === labelId ? null : prev));
    await saveMapState(strokes, nextLabels);
  };

  const applyTextSizeToSelectedLabel = async () => {
    if (!isDM || !selectedLabelId) return;
    const parsed = Number.parseInt(textSizeInput, 10);
    const nextSize = Number.isFinite(parsed)
      ? clamp(parsed, MIN_LABEL_SIZE, MAX_LABEL_SIZE)
      : DEFAULT_LABEL_SIZE;
    setTextSizeInput(`${nextSize}`);
    const nextLabels = labels.map((label) =>
      label.id === selectedLabelId ? { ...label, size: nextSize } : label
    );
    setLabels(nextLabels);
    await saveMapState(strokes, nextLabels);
  };

  const triggerPollForLabel = async (label: MapLabel) => {
    const supabase = createClient();
    const question = `Go to ${label.text}?`;
    const { error: pollError } = await supabase.from("poll").upsert(
      {
        id: 1,
        question,
        votes: {},
      },
      { onConflict: "id" }
    );
    if (pollError) {
      setError(pollError.message);
      return;
    }
    onPollCreated?.();
  };

  const applyZoomAtClientPoint = (nextZoomRaw: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const nextZoom = clamp(nextZoomRaw, MIN_ZOOM, MAX_ZOOM);
    setZoom((prevZoom) => {
      const worldX = (clientX - rect.left - viewportPan.x) / prevZoom;
      const worldY = (clientY - rect.top - viewportPan.y) / prevZoom;
      const nextPanX = clientX - rect.left - worldX * nextZoom;
      const nextPanY = clientY - rect.top - worldY * nextZoom;
      setViewportPan({ x: nextPanX, y: nextPanY });
      return nextZoom;
    });
  };

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const targetEl = event.target as HTMLElement | null;
    if (targetEl?.closest("[data-map-label='true']")) return;
    if (isDM && tool !== "pan") return;
    if (event.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: viewportPan.x,
      panY: viewportPan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panStartRef.current) return;
    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    setViewportPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const handleViewportPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomStep = event.deltaY > 0 ? 0.9 : 1.1;
    applyZoomAtClientPoint(zoom * zoomStep, event.clientX, event.clientY);
  };

  const distance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const handleViewportTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      pinchRef.current = {
        startDist: distance(t1, t2),
        startZoom: zoom,
        startPanX: viewportPan.x,
        startPanY: viewportPan.y,
        centerX: (t1.clientX + t2.clientX) / 2,
        centerY: (t1.clientY + t2.clientY) / 2,
      };
      return;
    }
    if (event.touches.length === 1 && (!isDM || (tool !== "draw" && tool !== "erase" && tool !== "text"))) {
      const t = event.touches[0];
      panStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        panX: viewportPan.x,
        panY: viewportPan.y,
      };
      setIsPanning(true);
    }
  };

  const handleViewportTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const nowDist = distance(t1, t2);
      const ratio = nowDist / Math.max(1, pinchRef.current.startDist);
      const nextZoom = clamp(pinchRef.current.startZoom * ratio, MIN_ZOOM, MAX_ZOOM);
      const centerX = (t1.clientX + t2.clientX) / 2;
      const centerY = (t1.clientY + t2.clientY) / 2;
      applyZoomAtClientPoint(nextZoom, centerX, centerY);
      return;
    }

    if (event.touches.length === 1 && isPanning && panStartRef.current) {
      const t = event.touches[0];
      const dx = t.clientX - panStartRef.current.x;
      const dy = t.clientY - panStartRef.current.y;
      setViewportPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    }
  };

  const handleViewportTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchRef.current = null;
    }
    if (event.touches.length === 0) {
      setIsPanning(false);
      panStartRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-bold text-amber-400">Map</h2>
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</div>
      )}
      {isDM && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-gray-900/40 p-3">
          <button
            onClick={() => setTool("pan")}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${
              tool === "pan" ? "bg-amber-500 text-gray-900" : "bg-gray-700 text-amber-100 hover:bg-gray-600"
            }`}
          >
            Pan
          </button>
          <button
            onClick={() => setTool("draw")}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${
              tool === "draw" ? "bg-amber-500 text-gray-900" : "bg-gray-700 text-amber-100 hover:bg-gray-600"
            }`}
          >
            Draw
          </button>
          <button
            onClick={() => setTool("erase")}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${
              tool === "erase" ? "bg-amber-500 text-gray-900" : "bg-gray-700 text-amber-100 hover:bg-gray-600"
            }`}
          >
            Erase
          </button>
          <button
            onClick={() => setTool("text")}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${
              tool === "text" ? "bg-amber-500 text-gray-900" : "bg-gray-700 text-amber-100 hover:bg-gray-600"
            }`}
          >
            Text
          </button>
          <button
            onClick={clearBoard}
            disabled={saving}
            className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-red-100 hover:bg-red-600 disabled:opacity-60"
          >
            Clear
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setViewportPan({ x: 0, y: 0 });
            }}
            className="rounded bg-gray-700 px-3 py-1.5 text-sm font-semibold text-amber-100 hover:bg-gray-600"
          >
            Reset View
          </button>
          {tool === "text" && (
            <>
              <input
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                placeholder="Label text..."
                className="min-w-[220px] rounded bg-gray-800 px-3 py-1.5 text-sm text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              />
              <input
                type="number"
                min={MIN_LABEL_SIZE}
                max={MAX_LABEL_SIZE}
                value={textSizeInput}
                onChange={(event) => setTextSizeInput(event.target.value)}
                onBlur={() => {
                  void applyTextSizeToSelectedLabel();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void applyTextSizeToSelectedLabel();
                  }
                }}
                placeholder="Font size"
                className="w-28 rounded bg-gray-800 px-3 py-1.5 text-sm text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
              />
              <button
                onClick={() => {
                  if (selectedLabelId) void removeLabel(selectedLabelId);
                }}
                disabled={!selectedLabelId}
                className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-red-100 hover:bg-red-600 disabled:opacity-60"
              >
                Delete Text
              </button>
            </>
          )}
        </div>
      )}

      <div
        ref={viewportRef}
        className={`h-[82vh] overflow-hidden rounded-2xl border border-amber-500/30 bg-gray-950 p-4 ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        onWheel={handleViewportWheel}
        onTouchStart={handleViewportTouchStart}
        onTouchMove={handleViewportTouchMove}
        onTouchEnd={handleViewportTouchEnd}
        onTouchCancel={handleViewportTouchEnd}
        style={{ touchAction: "none" }}
      >
        <div
          className="relative bg-white shadow-inner select-none"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transform: `translate(${viewportPan.x}px, ${viewportPan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className={`absolute inset-0 ${
                isDM && (tool === "draw" || tool === "erase" || tool === "text") ? "cursor-crosshair" : "cursor-grab"
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => {
                void finalizeStroke(event.pointerId);
              }}
              onPointerCancel={(event) => {
                void finalizeStroke(event.pointerId);
              }}
              onClick={(event) => {
                void handleCanvasClick(event);
              }}
            />

            {labels.map((label) => (
              <button
                key={label.id}
                data-map-label="true"
                onClick={async () => {
                  if (isDM && tool === "text") {
                    setSelectedLabelId(label.id);
                    setTextSizeInput(`${label.size}`);
                    return;
                  }
                  await triggerPollForLabel(label);
                }}
                onContextMenu={(event) => {
                  if (!isDM) return;
                  event.preventDefault();
                  void removeLabel(label.id);
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded border bg-white px-2 py-1 font-semibold text-black shadow hover:bg-amber-50 ${
                  selectedLabelId === label.id ? "border-blue-600" : "border-black/30"
                }`}
                style={{ left: label.x, top: label.y }}
                title={isDM ? "Click to start poll, right-click to remove label" : "Click to start poll"}
              >
                <span style={{ fontSize: `${label.size}px`, lineHeight: 1.1 }}>{label.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
