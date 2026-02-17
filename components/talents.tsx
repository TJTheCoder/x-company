"use client";

import { CharacterType } from "../app/protected/page";
import talentsCatalogData from "../data/talents.json";

type TalentLevel = 1 | 2 | 3;

type TalentDefinition = {
  id: string;
  name: string;
  effectsByLevel: Record<"1" | "2" | "3", string>;
};

type TalentsProps = {
  character: CharacterType | null;
};

const DEFAULT_TALENT_LEVELS: Record<string, TalentLevel> = {
  "talent-fast-footwork": 1,
};

const talentsCatalog = talentsCatalogData as TalentDefinition[];

function clampLevel(level: number): TalentLevel {
  if (level >= 3) return 3;
  if (level <= 1) return 1;
  return 2;
}

export default function Talents({ character }: TalentsProps) {
  if (!character) {
    return <p className="text-amber-300 text-center">No character found for your account.</p>;
  }

  const levelsFromMap = character.talent_levels ?? {};
  const levelsFromArray =
    character.talents?.reduce<Record<string, TalentLevel>>((acc, talent) => {
      acc[talent.id] = clampLevel(talent.level);
      return acc;
    }, {}) ?? {};

  const mergedLevels: Record<string, TalentLevel> = {
    ...DEFAULT_TALENT_LEVELS,
    ...levelsFromArray,
    ...Object.fromEntries(
      Object.entries(levelsFromMap).map(([id, level]) => [id, clampLevel(Number(level))])
    ),
  };

  const ownedTalents = talentsCatalog
    .map((talent) => ({
      ...talent,
      level: mergedLevels[talent.id],
    }))
    .filter((talent) => Boolean(talent.level));

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold text-amber-400 drop-shadow-lg">Talents</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ownedTalents.map((talent) => (
          <div
            key={talent.id}
            className="rounded-xl border border-amber-600/40 bg-gray-900/70 p-4 text-amber-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-amber-300">{talent.name}</h3>
              <span className="text-xs rounded-full px-2 py-0.5 bg-amber-500/20 border border-amber-400/40">
                Lv. {talent.level}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {[1, 2, 3].map((lvl) => {
                const key = String(lvl) as "1" | "2" | "3";
                const unlocked = lvl <= talent.level;
                const text = unlocked ? talent.effectsByLevel[key] : "???";
                return (
                  <div
                    key={`${talent.id}-${lvl}`}
                    className={`rounded-lg border p-2 text-sm ${
                      unlocked
                        ? "border-emerald-500/40 bg-emerald-900/20 text-emerald-100"
                        : "border-gray-600/40 bg-gray-800/30 text-amber-100/55"
                    }`}
                  >
                    <span className="font-semibold">Lv. {lvl}:</span> {text}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
