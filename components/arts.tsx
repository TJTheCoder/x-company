"use client";

import { useMemo, useState } from "react";
import { Art, CharacterType } from "../app/protected/page";
import artsCatalogData from "../data/arts.json";

type ArtsProps = {
  character: CharacterType | null;
  updateCharacter: (updates: Partial<CharacterType>) => void;
  saveCharacter: (updates: Partial<CharacterType>) => void;
};

type ParsedCost = {
  minSuccesses: number;
  hasScaling: boolean;
  scaleStep: number;
};

type ArtRollResult = {
  artName: string;
  dice: number[];
  successes: number;
  ones: number;
  activated: boolean;
  scaling: number;
  spiritGenerated: number;
  spiritBefore: number;
  spiritAfter: number;
  minRequired: number;
};

const DEFAULT_ART_IDS = ["art-true-sense", "art-sunder"];
const artsCatalog = artsCatalogData as Art[];

const KIND_STYLE: Record<Art["kind"], string> = {
  true: "bg-white/15 border-white/70 text-white",
  demon: "bg-gray-200/10 border-gray-300/40 text-gray-200",
  monster: "bg-rose-100/10 border-rose-200/40 text-rose-100",
  angel: "bg-yellow-100/15 border-yellow-200/50 text-yellow-100",
  mortal: "bg-sky-100/15 border-sky-200/50 text-sky-100",
  nature: "bg-emerald-100/15 border-emerald-200/50 text-emerald-100",
};

const rollD6 = () => Math.floor(Math.random() * 6) + 1;

const parseCost = (cost: string): ParsedCost => {
  const normalized = cost.replace(/\s+/g, "").toUpperCase();

  if (/^\d+$/.test(normalized)) {
    return { minSuccesses: parseInt(normalized, 10), hasScaling: false, scaleStep: 0 };
  }

  const xOnly = normalized.match(/^(\d*)X$/);
  if (xOnly) {
    const coeff = xOnly[1] ? parseInt(xOnly[1], 10) : 1;
    return { minSuccesses: 0, hasScaling: true, scaleStep: Math.max(1, coeff) };
  }

  const withPlus = normalized.match(/^(\d+)\+(\d*)X$/);
  if (withPlus) {
    const min = parseInt(withPlus[1], 10);
    const coeff = withPlus[2] ? parseInt(withPlus[2], 10) : 1;
    return { minSuccesses: min, hasScaling: true, scaleStep: Math.max(1, coeff) };
  }

  return { minSuccesses: 0, hasScaling: false, scaleStep: 0 };
};

export default function Arts({ character, updateCharacter, saveCharacter }: ArtsProps) {
  const [result, setResult] = useState<ArtRollResult | null>(null);

  const catalogById = useMemo(() => {
    const map = new Map<string, Art>();
    for (const art of artsCatalog) {
      map.set(art.id, art);
    }
    return map;
  }, []);

  const equippedArts = useMemo(() => {
    const legacyIds = (character?.equipped_arts ?? []).map((art) => art.id);
    const storedKnownIds = character?.known_art_ids ?? [];
    const storedEquippedIds = character?.equipped_art_ids ?? [];
    const orderedIds = [
      ...DEFAULT_ART_IDS,
      ...storedKnownIds,
      ...storedEquippedIds,
      ...legacyIds,
    ];
    const uniqueIds = Array.from(new Set(orderedIds));
    const resolved = uniqueIds
      .map((id) => catalogById.get(id))
      .filter((art): art is Art => Boolean(art));
    const base = resolved.slice(0, 10);
    return [...base, ...Array(Math.max(0, 10 - base.length)).fill(null)] as Array<Art | null>;
  }, [catalogById, character?.equipped_arts, character?.equipped_art_ids, character?.known_art_ids]);

  const renderDie = (num: number) => {
    const icon = num === 6 ? "✅" : num === 1 ? "❌" : "⚪";
    const color = num === 6 ? "text-green-400" : num === 1 ? "text-red-500" : "text-gray-400";
    return (
      <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg bg-gray-700 border-2 border-gray-500">
        <span className={`text-xl font-bold ${color}`}>{icon}</span>
      </div>
    );
  };

  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const incrementSpirit = () => {
    const updates = {
      spirits: (character.spirits ?? 0) + 1,
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const decrementSpirit = () => {
    const currentValue = character.spirits ?? 0;
    if (currentValue <= 0) return;
    const updates = {
      spirits: currentValue - 1,
    };
    updateCharacter(updates);
    saveCharacter(updates);
  };

  const handleArtClick = (art: Art) => {
    const spiritBefore = Math.max(0, character.spirits ?? 0);
    if (spiritBefore <= 0) {
      setResult({
        artName: art.name,
        dice: [],
        successes: 0,
        ones: 0,
        activated: false,
        scaling: 0,
        spiritGenerated: 0,
        spiritBefore,
        spiritAfter: 0,
        minRequired: parseCost(art.cost).minSuccesses,
      });
      return;
    }

    const firstRoll = Array.from({ length: spiritBefore }, rollD6);
    const pushedRoll = firstRoll.map((die) => (die === 1 || die === 6 ? die : rollD6()));

    const successes = pushedRoll.filter((d) => d === 6).length;
    const ones = pushedRoll.filter((d) => d === 1).length;
    const parsedCost = parseCost(art.cost);

    const activated = successes >= parsedCost.minSuccesses;
    const postDamageSpirit = Math.max(0, spiritBefore - ones);

    const remainingAfterMin = activated ? Math.max(0, successes - parsedCost.minSuccesses) : 0;
    const scaling = parsedCost.hasScaling
      ? Math.floor(remainingAfterMin / parsedCost.scaleStep)
      : 0;
    const spiritFromLeftover = parsedCost.hasScaling
      ? remainingAfterMin % parsedCost.scaleStep
      : remainingAfterMin;
    const spiritAfter = postDamageSpirit + spiritFromLeftover;

    const updates = { spirits: spiritAfter };
    updateCharacter(updates);
    saveCharacter(updates);

    setResult({
      artName: art.name,
      dice: pushedRoll,
      successes,
      ones,
      activated,
      scaling,
      spiritGenerated: spiritFromLeftover,
      spiritBefore,
      spiritAfter,
      minRequired: parsedCost.minSuccesses,
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold text-amber-400 drop-shadow-lg">Arts</h2>
        <div className="flex items-center justify-center gap-2 mt-1">
          <p className="text-amber-200">Equipped: {equippedArts.filter(Boolean).length}/10 | Spirit: {character.spirits}</p>
          <button
            onClick={decrementSpirit}
            disabled={(character.spirits ?? 0) <= 0}
            className="bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold w-6 h-6 rounded-full transition-all text-sm"
          >
            -
          </button>
          <button
            onClick={incrementSpirit}
            className="bg-green-600 hover:bg-green-500 text-white font-bold w-6 h-6 rounded-full transition-all text-sm"
          >
            +
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {equippedArts.map((art, idx) => {
          if (!art) {
            return (
              <div
                key={`blank-${idx}`}
                className="rounded-xl border border-dashed border-amber-600/30 bg-gray-900/40 min-h-24 p-3"
              />
            );
          }

          return (
            <button
              key={art.id}
              onClick={() => handleArtClick(art)}
              className={`rounded-xl border p-3 min-h-24 text-left transition-all hover:scale-[1.01] ${KIND_STYLE[art.kind]}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-bold">{art.name}</p>
                <span className="text-xs uppercase opacity-90">{art.kind}</span>
              </div>
              <p className="text-sm opacity-90 mt-2">
                {art.speed}, {art.range}, {art.cost}
              </p>
              {art.description && <p className="text-xs opacity-80 mt-1">{art.description}</p>}
            </button>
          );
        })}
      </div>

      {result && (
        <div className="rounded-xl border border-amber-600/40 bg-gray-900/70 p-4 text-amber-100">
          <div className="flex items-center justify-between">
            <p className="font-bold text-amber-300">Rolling: Spirit ({result.artName})</p>
            <p className={`font-semibold ${result.activated ? "text-green-300" : "text-red-300"}`}>
              {result.activated ? "Success" : "Failure"}
            </p>
          </div>
          <p className="text-sm mt-1">Successes: {result.successes} | Needed: {result.minRequired}</p>
          <p className="text-sm">Scaling: {result.scaling} | Excess: {result.spiritGenerated}</p>
          <p className="text-sm">Spirit: {result.spiritBefore} - {result.ones} + {result.spiritGenerated} = {result.spiritAfter}</p>
          <div className="mt-3">
            <p className="text-xs text-amber-300 mb-2 font-semibold">Spirit Dice:</p>
            <div className="flex gap-2 flex-wrap">
            {result.dice.map((die, i) => (
                <div key={`art-die-${i}`}>{renderDie(die)}</div>
            ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
