"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CharacterType } from "../app/protected/page";

type PollVote = "aye" | "nay" | null;

type PollData = {
  id: number;
  question: string;
  votes: Record<string, PollVote>;
  created_at?: string;
  updated_at?: string;
};

type PollProps = {
  character: CharacterType | null;
  allCharacters: CharacterType[];
};

export default function Poll({ character, allCharacters }: PollProps) {
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);

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

    const newVotes = { ...pollData.votes };
    
    // Toggle vote if clicking the same option
    if (newVotes[characterId] === vote) {
      newVotes[characterId] = null;
    } else {
      newVotes[characterId] = vote;
    }

    await updatePoll({ votes: newVotes });
  };

  const handleClear = async () => {
    await updatePoll({ question: "", votes: {} });
    setQuestion("");
  };

  const handlePing = async () => {
    if (!pollData || !question.trim()) return;

    const votes = pollData.votes || {};

    // Send notifications to users who haven't voted
    const supabase = createClient();
    
    for (const char of allCharacters) {
      if (!votes[char.id]) {
        await supabase
          .from("notifications")
          .insert({
            message: question,
            recipient_email: char.email,
          });
      }
    }
  };

  const calculateVotePercentages = () => {
    if (!pollData) return { aye: 0, nay: 0 };

    const votes = pollData.votes || {};
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

    const votes = pollData.votes || {};
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
            onBlur={() => updatePoll({ question })}
            placeholder="Enter poll question..."
            className="flex-1 px-4 py-3 bg-gray-700 text-amber-100 rounded-lg border border-amber-600/30 focus:border-amber-500 focus:outline-none font-semibold"
          />
          <button
            onClick={handlePing}
            disabled={!question.trim() || majorityStatus !== null}
            className="px-6 py-3 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
          >
            Ping
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-3 bg-red-700 hover:bg-red-600 text-amber-200 rounded-lg shadow-md font-semibold transition-all hover:scale-105"
          >
            Clear
          </button>
        </div>

        {/* Vote Percentage Bar */}
        {Object.values(pollData?.votes || {}).some(v => v !== null) && (
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

      {/* Character Votes */}
      <div className="space-y-3">
        {allCharacters.map((char) => {
          const vote = pollData?.votes?.[char.id] || null;
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
                {/* Character Info */}
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

                {/* Vote Buttons */}
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

      {/* Majority Status */}
      {majorityStatus && (
        <div className="mt-6 p-4 bg-amber-900/30 rounded-lg border border-amber-500">
          <p className="text-center text-amber-100 font-bold text-lg">
            🎉 Majority Reached: {majorityStatus === "aye" ? "AYE" : "NAY"} 🎉
          </p>
        </div>
      )}
    </div>
  );
}