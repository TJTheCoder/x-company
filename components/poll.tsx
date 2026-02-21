"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CharacterType } from "../app/protected/page";

type PollVote = "aye" | "nay" | null;

type JsonObject = Record<string, unknown>;

type PollData = {
  id: number;
  question: string;
  votes: JsonObject;
  created_at?: string;
  updated_at?: string;
};

type PollProps = {
  character: CharacterType | null;
  allCharacters: CharacterType[];
  isDM: boolean;
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const XP_MODE = "xp";
const XP_MODE_KEY = "__mode";
const XP_RANKINGS_KEY = "__xp_rankings";
const toTenth = (value: number): number => Math.round(value * 10) / 10;

const extractNormalVotes = (votes: JsonObject | null | undefined): Record<string, PollVote> => {
  if (!votes || votes[XP_MODE_KEY] === XP_MODE) return {};
  const out: Record<string, PollVote> = {};
  for (const [key, value] of Object.entries(votes)) {
    if (value === "aye" || value === "nay" || value === null) {
      out[key] = value;
    }
  }
  return out;
};

const extractXpRankings = (votes: JsonObject | null | undefined): Record<string, Record<string, number>> => {
  if (!votes || votes[XP_MODE_KEY] !== XP_MODE) return {};
  const raw = votes[XP_RANKINGS_KEY];
  if (!isObject(raw)) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [voterId, ranking] of Object.entries(raw)) {
    if (!isObject(ranking)) continue;
    const voterRanking: Record<string, number> = {};
    for (const [targetId, rankValue] of Object.entries(ranking)) {
      const rank = Number(rankValue);
      if (!Number.isFinite(rank)) continue;
      voterRanking[targetId] = toTenth(rank);
    }
    out[voterId] = voterRanking;
  }
  return out;
};

const buildXpVotesPayload = (rankings: Record<string, Record<string, number>>): JsonObject => ({
  [XP_MODE_KEY]: XP_MODE,
  [XP_RANKINGS_KEY]: rankings,
});

export default function Poll({ character, allCharacters, isDM }: PollProps) {
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [xpDraft, setXpDraft] = useState<Record<string, number>>({});
  const [xpError, setXpError] = useState<string>("");

  useEffect(() => {
    fetchPoll();
    
    // Subscribe to poll changes
    const supabase = createClient();
    const channel = supabase
      .channel("poll_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "poll",
        },
        () => {
          fetchPoll();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchPoll = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("poll")
      .select("*")
      .single();

    if (error) {
      console.error("Error fetching poll:", error);
      setPollData({
        id: 0,
        question: "",
        votes: {},
      });
    } else {
      setPollData(data);
      setQuestion(data.question || "");
    }
    setLoading(false);
  };

  const updatePoll = async (updates: Partial<PollData>) => {
    const supabase = createClient();
    await supabase
      .from("poll")
      .update(updates)
      .eq("id", pollData?.id || 1);
    
    await fetchPoll();
  };

  const handleVote = async (characterId: string, vote: PollVote) => {
    if (!pollData) return;
    if (pollData.votes[XP_MODE_KEY] === XP_MODE) return;

    const normalVotes = extractNormalVotes(pollData.votes || {});
    const newVotes: JsonObject = { ...normalVotes };
    
    // Toggle vote if clicking the same option
    if (newVotes[characterId] === vote) {
      newVotes[characterId] = null;
    } else {
      newVotes[characterId] = vote;
    }

    await updatePoll({ votes: newVotes });
  };

  const handleClear = async () => {
    if (isXpMode && !isDM) return;
    await updatePoll({ question: "", votes: {} });
    setQuestion("");
    setXpDraft({});
    setXpError("");
  };

  const handlePing = async () => {
    if (!pollData || !question.trim()) return;
    if (isXpMode) return;

    const votes = extractNormalVotes(pollData.votes || {});

    // Send notifications to users who haven't voted
    const supabase = createClient();
    
    for (const char of allCharacters) {
      if (!votes[char.id]) {
        await supabase
          .from("notifications")
          .insert({
            message: "(Poll) " + question,
            recipient_email: char.email,
          });
      }
    }
  };

  const calculateVotePercentages = () => {
    if (!pollData) return { aye: 0, nay: 0 };

    const votes = extractNormalVotes(pollData.votes || {});
    const voteArray = Object.values(votes).filter(v => v !== null);
    const totalVotes = voteArray.length;

    if (totalVotes === 0) return { aye: 0, nay: 0 };

    const ayeVotes = voteArray.filter(v => v === "aye").length;
    const nayVotes = voteArray.filter(v => v === "nay").length;

    return {
      aye: (ayeVotes / totalVotes) * 100,
      nay: (nayVotes / totalVotes) * 100,
    };
  };

  const getMajorityStatus = () => {
    if (!pollData) return null;

    const votes = extractNormalVotes(pollData.votes || {});
    const totalCharacters = allCharacters.length;
    const majorityThreshold = Math.ceil(totalCharacters / 2);

    const ayeVotes = Object.values(votes).filter(v => v === "aye").length;
    const nayVotes = Object.values(votes).filter(v => v === "nay").length;

    if (ayeVotes >= majorityThreshold) return "aye";
    if (nayVotes >= majorityThreshold) return "nay";
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const percentages = calculateVotePercentages();
  const majorityStatus = getMajorityStatus();
  const isXpMode = pollData?.votes?.[XP_MODE_KEY] === XP_MODE;
  const currentCharacterId = character?.id || null;
  const xpRankings = extractXpRankings(pollData?.votes || {});
  const xpTargets = currentCharacterId
    ? allCharacters.filter((char) => char.id !== currentCharacterId)
    : [];
  const maxRank = xpTargets.length;
  const myStoredRanking = currentCharacterId ? xpRankings[currentCharacterId] || {} : {};
  const hasSubmittedXpRanking = Object.keys(myStoredRanking).length > 0;
  const effectiveXpDraft =
    Object.keys(xpDraft).length > 0 ? xpDraft : myStoredRanking;
  const dmScoreboard = allCharacters
    .map((char) => ({
      character: char,
      points: Object.values(xpRankings).reduce((sum, ranking) => sum + Number(ranking[char.id] || 0), 0),
    }))
    .sort((a, b) => b.points - a.points || a.character.name.localeCompare(b.character.name));
  const votersList = Object.keys(xpRankings)
    .map((voterId) => allCharacters.find((char) => char.id === voterId)?.name || voterId)
    .join(", ");

  const startXpPoll = async () => {
    if (!isDM) return;
    setXpError("");
    await updatePoll({
      question: "XP Poll",
      votes: buildXpVotesPayload({}),
    });
  };

  const submitXpRanking = async () => {
    if (!pollData || !currentCharacterId || isDM) return;
    setXpError("");
    if (maxRank <= 0) {
      setXpError("No other players to rank.");
      return;
    }
    const allowedRanks = Array.from({ length: maxRank }, (_, idx) => toTenth((idx + 1) / 10));
    const ranks = xpTargets.map((target) => toTenth(Number(effectiveXpDraft[target.id] ?? 0)));
    if (ranks.some((value) => !allowedRanks.includes(value))) {
      setXpError("");
      return;
    }
    const unique = new Set(ranks);
    if (unique.size !== maxRank) {
      setXpError("");
      return;
    }
    const nextRankings = {
      ...xpRankings,
      [currentCharacterId]: xpTargets.reduce<Record<string, number>>((acc, target) => {
        acc[target.id] = toTenth(Number(effectiveXpDraft[target.id]));
        return acc;
      }, {}),
    };
    await updatePoll({ votes: buildXpVotesPayload(nextRankings) });
    setXpDraft({});
  };

  // Determine background color based on majority
  let backgroundClass = "bg-gray-900/30";
  if (majorityStatus === "aye") {
    backgroundClass = "bg-green-900/30";
  } else if (majorityStatus === "nay") {
    backgroundClass = "bg-red-900/30";
  }

  return (
    <div className={`${backgroundClass} p-6 rounded-2xl transition-colors duration-500`}>
      <h2 className="text-3xl font-bold text-amber-400 mb-6">Poll</h2>

      {/* Question Input and Controls */}
      <div className="mb-8 space-y-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onBlur={() => {
              if (!isXpMode) void updatePoll({ question });
            }}
            placeholder="Enter poll question..."
            disabled={isXpMode}
            className="flex-1 px-4 py-3 bg-gray-700 text-amber-100 rounded-lg border border-amber-600/30 focus:border-amber-500 focus:outline-none font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {isDM && (
            <button
              onClick={startXpPoll}
              disabled={isXpMode}
              className="px-6 py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
            >
              XP
            </button>
          )}
          <button
            onClick={handlePing}
            disabled={!question.trim() || majorityStatus !== null || isXpMode}
            className="px-6 py-3 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
          >
            Ping
          </button>
          <button
            onClick={handleClear}
            disabled={isXpMode && !isDM}
            className="px-6 py-3 bg-red-700 hover:bg-red-600 text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
          >
            Clear
          </button>
        </div>

        {/* Vote Percentage Bar */}
        {!isXpMode && Object.values(extractNormalVotes(pollData?.votes || {})).some(v => v !== null) && (
          <div className="w-full h-8 bg-gray-700 rounded-lg overflow-hidden flex">
            <div
              className="bg-green-600 transition-all duration-500 flex items-center justify-center text-white font-bold text-sm"
              style={{ width: `${percentages.aye}%` }}
            >
              {percentages.aye > 10 && `${Math.round(percentages.aye)}%`}
            </div>
            <div
              className="bg-red-600 transition-all duration-500 flex items-center justify-center text-white font-bold text-sm"
              style={{ width: `${percentages.nay}%` }}
            >
              {percentages.nay > 10 && `${Math.round(percentages.nay)}%`}
            </div>
          </div>
        )}
      </div>

      {!isXpMode && (
        <div className="space-y-3">
          {allCharacters.map((char) => {
            const normalVotes = extractNormalVotes(pollData?.votes || {});
            const vote = normalVotes[char.id] || null;
            let rowBgClass = "bg-gray-700";

            if (vote === "aye") {
              rowBgClass = "bg-green-700/50";
            } else if (vote === "nay") {
              rowBgClass = "bg-red-700/50";
            }

            const isCurrentUser = character?.id === char.id;

            return (
              <div
                key={char.id}
                className={`${rowBgClass} p-4 rounded-lg transition-colors duration-300 border border-amber-600/20`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center overflow-hidden border-2 border-amber-400">
                      {char.icon_url ? (
                        <img
                          src={char.icon_url}
                          alt={char.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-2xl">👤</span>
                      )}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-amber-100">
                        {char.name}
                        {isCurrentUser && (
                          <span className="ml-2 text-sm text-amber-400">(You)</span>
                        )}
                      </h3>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVote(char.id, "aye")}
                      disabled={!isCurrentUser}
                      className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                        vote === "aye"
                          ? "bg-green-600 text-white shadow-lg scale-105"
                          : "bg-gray-600 text-amber-200 hover:bg-green-700"
                      } ${
                        !isCurrentUser ? "opacity-50 cursor-not-allowed" : "hover:scale-105"
                      }`}
                    >
                      Aye
                    </button>
                    <button
                      onClick={() => handleVote(char.id, "nay")}
                      disabled={!isCurrentUser}
                      className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                        vote === "nay"
                          ? "bg-red-600 text-white shadow-lg scale-105"
                          : "bg-gray-600 text-amber-200 hover:bg-red-700"
                      } ${
                        !isCurrentUser ? "opacity-50 cursor-not-allowed" : "hover:scale-105"
                      }`}
                    >
                      Nay
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isXpMode && (
        <div className="space-y-4">
          {isDM ? (
            <div className="rounded-xl border border-amber-500/30 bg-gray-900/30 p-4">
              <p className="text-sm text-amber-200 mb-3">Votes: {votersList || "None"}</p>
              <div className="space-y-2">
                {dmScoreboard.map(({ character: char, points }) => (
                  <div
                    key={char.id}
                    className="flex items-center justify-between rounded-lg border border-amber-600/20 bg-gray-800/70 px-4 py-3"
                  >
                    <span className="font-semibold text-amber-100">{char.name}</span>
                    <span className="font-bold text-amber-300">{points}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-gray-900/30 p-4">
              <div className="space-y-3">
                {xpTargets.map((target) => (
                  <div
                    key={target.id}
                    className="flex items-center justify-between rounded-lg border border-amber-600/20 bg-gray-800/70 px-4 py-3"
                  >
                    <span className="font-semibold text-amber-100">{target.name}</span>
                    <select
                      value={effectiveXpDraft[target.id] ? toTenth(Number(effectiveXpDraft[target.id])).toFixed(1) : ""}
                      onChange={(event) => {
                        const value = Number.parseFloat(event.target.value);
                        setXpDraft((prev) => ({
                          ...prev,
                          [target.id]: Number.isFinite(value) ? toTenth(value) : 0,
                        }));
                      }}
                      className="rounded bg-gray-700 px-3 py-1.5 text-amber-100 ring-1 ring-gray-600 outline-none focus:ring-amber-400"
                    >
                      <option value="">Rank</option>
                      {Array.from({ length: maxRank }, (_, idx) => toTenth((idx + 1) / 10))
                        .filter((rankValue) => {
                          const selectedByOthers = xpTargets.some((otherTarget) => {
                            if (otherTarget.id === target.id) return false;
                            return toTenth(Number(effectiveXpDraft[otherTarget.id] ?? 0)) === rankValue;
                          });
                          const selectedHere = toTenth(Number(effectiveXpDraft[target.id] ?? 0)) === rankValue;
                          return !selectedByOthers || selectedHere;
                        })
                        .map((rankValue) => (
                          <option key={`${target.id}-rank-${rankValue}`} value={rankValue.toFixed(1)}>
                            {rankValue.toFixed(1)}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={submitXpRanking}
                className="mt-3 rounded bg-blue-700 px-5 py-2 font-semibold text-amber-100 hover:bg-blue-600"
              >
                {hasSubmittedXpRanking ? "Resubmit" : "Submit"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Majority Status */}
      {!isXpMode && majorityStatus && (
        <div className="mt-6 p-4 bg-amber-900/30 rounded-lg border border-amber-500">
          <p className="text-center text-amber-100 font-bold text-lg">
            Majority Reached: {majorityStatus === "aye" ? "AYE" : "NAY"}
          </p>
        </div>
      )}
    </div>
  );
}
