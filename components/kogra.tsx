"use client";

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CharacterType } from "../app/protected/page";

type Suit = "C" | "D" | "H" | "S";
type DeclarationType =
  | "high_card"
  | "pair"
  | "two_pair"
  | "three_kind"
  | "straight"
  | "flush"
  | "full_house"
  | "four_kind"
  | "straight_flush"
  | "royal_flush";

type KograCard = {
  rank: number;
  suit: Suit;
};

type DeclaredMeta = {
  low_rank?: number;
  pair_rank?: number;
  kickers?: number[];
};

type KograGame = {
  id: string;
  name: string;
  status: "waiting" | "in_round" | "round_over" | "finished";
  round_no: number;
  current_turn_player_id: string | null;
  starter_player_id: string | null;
  previous_player_id: string | null;
  state: {
    declared_type?: DeclarationType;
    declared_rank?: number;
    declared_suit?: Suit | null;
    declared_meta?: DeclaredMeta;
    declared_by_player_id?: string;
    challenger_player_id?: string;
    challenged_player_id?: string;
    winner_player_id?: string;
    loser_player_id?: string;
    bluff_was_true?: boolean;
    last_call_result?: {
      winner_player_id: string;
      loser_player_id: string;
      bluff_was_true: boolean;
      loser_hand_size_before?: number;
    };
    revealed_transit_cards?: KograCard[];
    revealed_claim_cards?: KograCard[];
  } | null;
};

type KograPlayer = {
  id: string;
  game_id: string;
  user_email: string;
  display_name: string;
  is_dm: boolean;
  dm_slot_name?: string;
  is_active: boolean;
  eliminated: boolean;
  starting_hand_size: number;
  seat_index: number | null;
};

type KograPrivateState = {
  id: string;
  game_id: string;
  player_id: string;
  user_email: string;
  personal_cards: KograCard[];
  transit_cards: KograCard[];
};

type KograProps = {
  character: CharacterType | null;
  userEmail: string | null;
};

type Decl = {
  type: DeclarationType;
  rank: number;
  suit: Suit | null;
  meta: DeclaredMeta;
};

const ADMIN_EMAIL = "drocasma9@gmail.com";
const HAND_TYPES: DeclarationType[] = [
  "high_card",
  "pair",
  "two_pair",
  "three_kind",
  "straight",
  "flush",
  "full_house",
  "four_kind",
  "straight_flush",
  "royal_flush",
];
const SUITS: Suit[] = ["C", "D", "H", "S"];
const RANK_OPTIONS: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const handTypeLabel = (t: DeclarationType): string =>
  t
    .split("_")
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join(" ");

const gameStatusLabel = (status: KograGame["status"]): string => {
  if (status === "waiting") return "Waiting";
  if (status === "in_round") return "In Round";
  if (status === "round_over") return "Round Over";
  return "Finished";
};

const rankLabel = (rank: number): string => {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
};

const formatDeclaration = (
  declaredType?: DeclarationType,
  declaredRank?: number,
  declaredSuit?: Suit | null,
  declaredMeta?: DeclaredMeta
): string => {
  if (!declaredType) return "No declaration";

  const rank = declaredRank ?? 14;
  const meta = declaredMeta || {};

  if (declaredType === "high_card") {
    return `High Card ${rankLabel(rank)}`;
  }
  if (declaredType === "pair") {
    return `Pair ${rankLabel(rank)}`;
  }
  if (declaredType === "two_pair") {
    const low = meta.low_rank;
    return low ? `Two Pair ${rankLabel(rank)} + ${rankLabel(low)}` : `Two Pair ${rankLabel(rank)}`;
  }
  if (declaredType === "three_kind") {
    return `Three of a Kind ${rankLabel(rank)}`;
  }
  if (declaredType === "straight") {
    return `Straight to ${rankLabel(rank)}`;
  }
  if (declaredType === "flush") {
    const kickers = (meta.kickers || []).map((k) => rankLabel(k));
    const ranks = [rankLabel(rank), ...kickers].join(" ");
    const suitPart = declaredSuit ? ` ${suitLabel(declaredSuit)}` : "";
    return `Flush${suitPart} (${ranks})`;
  }
  if (declaredType === "full_house") {
    const pair = meta.pair_rank;
    return pair
      ? `Full House ${rankLabel(rank)} over ${rankLabel(pair)}`
      : `Full House ${rankLabel(rank)}`;
  }
  if (declaredType === "four_kind") {
    return `Four of a Kind ${rankLabel(rank)}`;
  }
  if (declaredType === "straight_flush") {
    const suitPart = declaredSuit ? ` ${suitLabel(declaredSuit)}` : "";
    return `Straight Flush${suitPart} to ${rankLabel(rank)}`;
  }
  const suitPart = declaredSuit ? ` ${suitLabel(declaredSuit)}` : "";
  return `Royal Flush${suitPart}`;
};

const suitSymbol = (suit: Suit): string => {
  if (suit === "C") return "♣";
  if (suit === "D") return "♦";
  if (suit === "H") return "♥";
  return "♠";
};

const suitLabel = (suit: Suit): string => {
  if (suit === "C") return "Clubs";
  if (suit === "D") return "Diamonds";
  if (suit === "H") return "Hearts";
  return "Spades";
};

const cardKey = (card: KograCard): string => `${card.rank}-${card.suit}`;

const requiresSuit = (type: DeclarationType): boolean =>
  type === "flush" || type === "straight_flush" || type === "royal_flush";

const typeStrength = (type: DeclarationType): number => HAND_TYPES.indexOf(type) + 1;

const suitStrength = (suit: Suit | null | undefined): number => {
  if (suit === "C") return 1;
  if (suit === "D") return 2;
  if (suit === "H") return 3;
  if (suit === "S") return 4;
  return 0;
};

const buildDeclVector = (d: Decl): number[] => {
  if (d.type === "royal_flush") return [];
  if (d.type === "two_pair") return [d.rank, d.meta.low_rank ?? 0];
  if (d.type === "full_house") return [d.rank, d.meta.pair_rank ?? 0];
  if (d.type === "flush") return [d.rank, ...(d.meta.kickers || [])];
  return [d.rank];
};

const compareVectors = (a: number[], b: number[]): number => {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
};

const compareDecl = (a: Decl, b: Decl): number => {
  const tsA = typeStrength(a.type);
  const tsB = typeStrength(b.type);
  if (tsA > tsB) return 1;
  if (tsA < tsB) return -1;

  if (a.type === "royal_flush") {
    return Math.sign(suitStrength(a.suit) - suitStrength(b.suit));
  }

  const vc = compareVectors(buildDeclVector(a), buildDeclVector(b));
  if (vc !== 0) return vc;

  if (requiresSuit(a.type)) {
    return Math.sign(suitStrength(a.suit) - suitStrength(b.suit));
  }

  return 0;
};

const hasAnyStraight = (inputRanks: number[]): boolean => {
  const ranks = Array.from(new Set(inputRanks));
  if (ranks.length < 5) return false;
  for (let h = 5; h <= 14; h += 1) {
    if (h === 5) {
      if (ranks.includes(14) && ranks.includes(2) && ranks.includes(3) && ranks.includes(4) && ranks.includes(5)) {
        return true;
      }
    } else if (
      ranks.includes(h) &&
      ranks.includes(h - 1) &&
      ranks.includes(h - 2) &&
      ranks.includes(h - 3) &&
      ranks.includes(h - 4)
    ) {
      return true;
    }
  }
  return false;
};

const maxDeclForType = (type: DeclarationType): Decl => {
  if (type === "royal_flush") return { type, rank: 14, suit: "S", meta: {} };
  if (type === "two_pair") return { type, rank: 14, suit: null, meta: { low_rank: 13 } };
  if (type === "full_house") return { type, rank: 14, suit: null, meta: { pair_rank: 13 } };
  if (type === "flush") return { type, rank: 14, suit: "S", meta: { kickers: [13, 12, 11, 10] } };
  if (type === "straight_flush") return { type, rank: 14, suit: "S", meta: {} };
  return { type, rank: 14, suit: null, meta: {} };
};

function TableCard({
  card,
  selectable,
  selected,
  onToggle,
}: {
  card: KograCard;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (card: KograCard) => void;
}) {
  const isRed = card.suit === "D" || card.suit === "H";
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={() => onToggle?.(card)}
      className={`w-16 h-24 rounded-lg border-2 bg-gradient-to-b from-white to-slate-100 shadow-md relative p-1 text-left ${
        selected ? "border-blue-600 -translate-y-1" : "border-slate-300"
      } ${selectable ? "hover:-translate-y-1 transition-all" : "cursor-default"}`}
    >
      <span className={`text-xs font-bold ${isRed ? "text-red-600" : "text-slate-900"}`}>
        {rankLabel(card.rank)}
      </span>
      <span className={`absolute top-1 right-1 text-sm ${isRed ? "text-red-600" : "text-slate-900"}`}>
        {suitSymbol(card.suit)}
      </span>
      <span className={`absolute inset-0 flex items-center justify-center text-2xl ${isRed ? "text-red-600" : "text-slate-900"}`}>
        {suitSymbol(card.suit)}
      </span>
      <span className={`absolute bottom-1 right-1 text-xs font-bold ${isRed ? "text-red-600" : "text-slate-900"}`}>
        {rankLabel(card.rank)}
      </span>
    </button>
  );
}

export default function Kogra({ character, userEmail }: KograProps) {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [game, setGame] = useState<KograGame | null>(null);
  const [players, setPlayers] = useState<KograPlayer[]>([]);
  const [myPrivateByPlayerId, setMyPrivateByPlayerId] = useState<Record<string, KograPrivateState>>({});
  const [slotMode, setSlotMode] = useState<"player" | "dm">("player");
  const [dmSlotInput, setDmSlotInput] = useState("");
  const [selectedDmSlot, setSelectedDmSlot] = useState("");

  const [declaredType, setDeclaredType] = useState<DeclarationType>("high_card");
  const [declaredRank, setDeclaredRank] = useState<number>(14);
  const [declaredSuit, setDeclaredSuit] = useState<Suit>("S");
  const [declaredLowRank, setDeclaredLowRank] = useState<number>(13);
  const [declaredPairRank, setDeclaredPairRank] = useState<number>(13);
  const [flushKickers, setFlushKickers] = useState<Array<number | null>>([null, null, null, null]);

  const [selectedPassKeys, setSelectedPassKeys] = useState<string[]>([]);
  const [showImproveCards, setShowImproveCards] = useState(false);

  const isAdmin = userEmail === ADMIN_EMAIL;

  const loadSnapshot = useCallback(async () => {
    if (!userEmail) return;
    setError(null);

    const { error: upsertError } = await supabase
      .from("kogra_games")
      .upsert({ name: "Kogra" }, { onConflict: "name", ignoreDuplicates: true });

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    const { data: currentGame, error: gameError } = await supabase
      .from("kogra_games")
      .select("*")
      .eq("name", "Kogra")
      .single<KograGame>();

    if (gameError || !currentGame) {
      setError(gameError?.message || "Could not load game.");
      return;
    }

    setGame(currentGame);

    const [playersRes, privateRes] = await Promise.all([
      supabase
        .from("kogra_players")
        .select("*")
        .eq("game_id", currentGame.id)
        .order("seat_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      supabase
        .from("kogra_private_state")
        .select("*")
        .eq("game_id", currentGame.id)
        .eq("user_email", userEmail),
    ]);

    if (playersRes.error) {
      setError(playersRes.error.message);
      return;
    }
    if (privateRes.error) {
      setError(privateRes.error.message);
      return;
    }

    setPlayers((playersRes.data || []) as KograPlayer[]);

    const mapped: Record<string, KograPrivateState> = {};
    ((privateRes.data || []) as KograPrivateState[]).forEach((row) => {
      mapped[row.player_id] = row;
    });
    setMyPrivateByPlayerId(mapped);
  }, [supabase, userEmail]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      await loadSnapshot();
      if (mounted) setLoading(false);
    };
    init();
    return () => {
      mounted = false;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    if (!game?.id) return;

    const channel = supabase
      .channel("kogra-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "kogra_games" }, loadSnapshot)
      .on("postgres_changes", { event: "*", schema: "public", table: "kogra_players" }, loadSnapshot)
      .on("postgres_changes", { event: "*", schema: "public", table: "kogra_private_state" }, loadSnapshot)
      .on("postgres_changes", { event: "*", schema: "public", table: "kogra_events" }, loadSnapshot)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [game?.id, loadSnapshot, supabase]);

  const activePlayers = useMemo(() => players.filter((p) => p.is_active && !p.eliminated), [players]);

  const myDmSlots = useMemo(
    () =>
      players
        .filter((p) => p.user_email === userEmail && p.is_dm && p.is_active && !p.eliminated)
        .map((p) => p.dm_slot_name || p.display_name)
        .filter((v, i, arr) => v && arr.indexOf(v) === i),
    [players, userEmail]
  );

  useEffect(() => {
    if (slotMode !== "dm") return;
    if (selectedDmSlot && myDmSlots.includes(selectedDmSlot)) return;
    setSelectedDmSlot(myDmSlots[0] || "");
  }, [slotMode, selectedDmSlot, myDmSlots]);

  const myPlayer = useMemo(() => {
    if (!userEmail) return null;
    if (slotMode === "player") {
      return players.find((p) => p.user_email === userEmail && !p.is_dm && p.is_active && !p.eliminated) || null;
    }
    const slot = selectedDmSlot || dmSlotInput.trim();
    return (
      players.find(
        (p) =>
          p.user_email === userEmail &&
          p.is_dm &&
          p.is_active &&
          !p.eliminated &&
          (p.dm_slot_name || p.display_name) === slot
      ) || null
    );
  }, [players, slotMode, userEmail, selectedDmSlot, dmSlotInput]);

  const hasActivePlayerSlot = useMemo(() => {
    if (!userEmail) return false;
    return players.some((p) => p.user_email === userEmail && !p.is_dm && p.is_active && !p.eliminated);
  }, [players, userEmail]);

  const myPrivate = useMemo(() => {
    if (!myPlayer) return null;
    return myPrivateByPlayerId[myPlayer.id] || null;
  }, [myPlayer, myPrivateByPlayerId]);

  const orderedActivePlayers = useMemo(
    () => [...activePlayers].sort((a, b) => (a.seat_index ?? 999) - (b.seat_index ?? 999)),
    [activePlayers]
  );

  const currentPlayer = useMemo(
    () => orderedActivePlayers.find((p) => p.id === game?.current_turn_player_id) || null,
    [orderedActivePlayers, game?.current_turn_player_id]
  );

  const previousPlayer = useMemo(
    () => orderedActivePlayers.find((p) => p.id === game?.previous_player_id) || null,
    [orderedActivePlayers, game?.previous_player_id]
  );

  const nextPlayer = useMemo(() => {
    if (!game?.current_turn_player_id || orderedActivePlayers.length === 0) return null;
    const idx = orderedActivePlayers.findIndex((p) => p.id === game.current_turn_player_id);
    if (idx === -1) return null;
    return orderedActivePlayers[(idx + 1) % orderedActivePlayers.length];
  }, [orderedActivePlayers, game?.current_turn_player_id]);

  const topPlayers = useMemo(
    () => orderedActivePlayers.filter((p) => p.id !== currentPlayer?.id && p.id !== previousPlayer?.id && p.id !== nextPlayer?.id),
    [orderedActivePlayers, currentPlayer?.id, previousPlayer?.id, nextPlayer?.id]
  );

  const isMyTurn = !!(game && myPlayer && game.current_turn_player_id === myPlayer.id);
  const isRoundOver = game?.status === "round_over";
  const canCallBluff = isMyTurn && game?.status === "in_round" && !!game?.state?.declared_by_player_id;
  const shouldImprove = isMyTurn && game?.status === "in_round" && !!game?.state?.declared_by_player_id;
  const canContinueAfterChallenge = useMemo(() => {
    if (!game || !isRoundOver || !userEmail) return false;
    const challengedId = game.state?.challenged_player_id;
    const challengerId = game.state?.challenger_player_id;
    if (!challengedId && !challengerId) {
      return game.current_turn_player_id
        ? players.some((p) => p.user_email === userEmail && p.id === game.current_turn_player_id)
        : false;
    }
    return players.some(
      (p) =>
        p.user_email === userEmail &&
        (p.id === challengedId || p.id === challengerId)
    );
  }, [game, isRoundOver, userEmail, players]);

  const previousDecl: Decl | null = useMemo(() => {
    if (!shouldImprove || !game?.state?.declared_type) return null;
    return {
      type: game.state.declared_type,
      rank: game.state.declared_rank ?? 14,
      suit: (game.state.declared_suit as Suit | null) ?? null,
      meta: game.state.declared_meta || {},
    };
  }, [shouldImprove, game?.state]);
  const canEscalate = shouldImprove && previousDecl?.type !== "royal_flush";

  const currentDecl = useMemo<Decl>(
    () => ({
      type: declaredType,
      rank: declaredType === "royal_flush" ? 14 : declaredRank,
      suit: requiresSuit(declaredType) ? declaredSuit : null,
      meta:
        declaredType === "two_pair"
          ? { low_rank: declaredLowRank }
          : declaredType === "full_house"
            ? { pair_rank: declaredPairRank }
            : declaredType === "flush"
              ? { kickers: flushKickers.filter((k): k is number => k !== null) }
              : {},
    }),
    [declaredType, declaredRank, declaredSuit, declaredLowRank, declaredPairRank, flushKickers]
  );

  const isHigherThanPrevious = useMemo(
    () => (previousDecl ? compareDecl(currentDecl, previousDecl) > 0 : true),
    [currentDecl, previousDecl]
  );

  const availableTypes = useMemo(() => {
    if (!shouldImprove || !previousDecl) return HAND_TYPES;
    return HAND_TYPES.filter((t) => compareDecl(maxDeclForType(t), previousDecl) > 0);
  }, [shouldImprove, previousDecl]);

  useEffect(() => {
    if (!availableTypes.includes(declaredType)) {
      setDeclaredType(availableTypes[0] ?? "high_card");
    }
  }, [availableTypes, declaredType]);

  useEffect(() => {
    if (!shouldImprove || !previousDecl) return;
    if (compareDecl(currentDecl, previousDecl) > 0) return;

    // Minimum next default: same type next rank when possible, otherwise next type minimum.
    const sameType = previousDecl.type;
    if (availableTypes.includes(sameType) && sameType !== "royal_flush") {
      setDeclaredType(sameType);
      if (sameType === "two_pair") {
        if (previousDecl.rank < 14) {
          setDeclaredRank(previousDecl.rank + 1);
          setDeclaredLowRank(2);
        } else {
          setDeclaredRank(14);
          setDeclaredLowRank(Math.min(13, (previousDecl.meta.low_rank ?? 1) + 1));
        }
      } else if (sameType === "full_house") {
        if (previousDecl.rank < 14) {
          setDeclaredRank(previousDecl.rank + 1);
          setDeclaredPairRank(2);
        } else {
          setDeclaredRank(14);
          setDeclaredPairRank(Math.min(13, (previousDecl.meta.pair_rank ?? 1) + 1));
        }
      } else if (sameType === "flush") {
        setDeclaredRank(previousDecl.rank);
        const prevK = previousDecl.meta.kickers || [];
        const nextK = [...prevK];
        let bumped = false;
        for (let i = 0; i < 4; i += 1) {
          const base = i === 0 ? previousDecl.rank : (nextK[i - 1] ?? previousDecl.rank);
          const cur = nextK[i] ?? 0;
          const min = 2;
          if (cur < base - 1) {
            nextK[i] = Math.max(min, cur + 1);
            bumped = true;
            break;
          }
        }
        setFlushKickers(bumped ? [nextK[0] ?? null, nextK[1] ?? null, nextK[2] ?? null, nextK[3] ?? null] : [2, null, null, null]);
      } else {
        setDeclaredRank(Math.min(14, previousDecl.rank + 1));
      }
      return;
    }

    const nextType = HAND_TYPES.find((t) => typeStrength(t) > typeStrength(previousDecl.type) && availableTypes.includes(t));
    if (nextType) {
      setDeclaredType(nextType);
      setDeclaredRank(nextType === "royal_flush" ? 14 : 2);
      setDeclaredSuit("C");
      setDeclaredLowRank(2);
      setDeclaredPairRank(2);
      setFlushKickers([null, null, null, null]);
    }
  }, [shouldImprove, previousDecl, currentDecl, availableTypes]);

  const rankOptionsForLow = useMemo(() => RANK_OPTIONS.filter((r) => r < declaredRank), [declaredRank]);
  const rankOptionsForPair = useMemo(() => RANK_OPTIONS.filter((r) => r !== declaredRank), [declaredRank]);

  const flushRankOptionsAt = (idx: number): Array<number | null> => {
    const used = new Set<number>([declaredRank]);
    const selectedBefore: number[] = [declaredRank];
    for (let i = 0; i < idx; i += 1) {
      const v = flushKickers[i];
      if (v !== null) {
        used.add(v);
        selectedBefore.push(v);
      }
    }
    const base = idx === 0 ? declaredRank : flushKickers[idx - 1] ?? declaredRank;
    const cap = base - 1;
    const opts = RANK_OPTIONS
      .filter((r) => r <= cap && !used.has(r))
      .filter((r) => !hasAnyStraight([...selectedBefore, r]))
      .sort((a, b) => b - a);
    return [null, ...opts];
  };

  useEffect(() => {
    if (declaredType !== "two_pair") return;
    if (declaredLowRank >= declaredRank || declaredLowRank < 2) {
      setDeclaredLowRank(Math.max(2, declaredRank - 1));
    }
  }, [declaredType, declaredLowRank, declaredRank]);

  useEffect(() => {
    if (declaredType !== "full_house") return;
    if (declaredPairRank === declaredRank) {
      setDeclaredPairRank(declaredRank === 2 ? 3 : 2);
    }
  }, [declaredType, declaredPairRank, declaredRank]);

  useEffect(() => {
    if (!shouldImprove) {
      setShowImproveCards(false);
      return;
    }
    setShowImproveCards(false);
  }, [game?.current_turn_player_id, shouldImprove]);

  const canSeeTransitCards = !shouldImprove || showImproveCards;

  const availableCards = useMemo<KograCard[]>(() => {
    if (!myPrivate) return [];
    return canSeeTransitCards
      ? [...(myPrivate.personal_cards || []), ...(myPrivate.transit_cards || [])]
      : [...(myPrivate.personal_cards || [])];
  }, [myPrivate, canSeeTransitCards]);

  useEffect(() => {
    setSelectedPassKeys((prev) => prev.filter((k) => availableCards.some((c) => cardKey(c) === k)));
  }, [availableCards]);

  const passCards = useMemo(() => availableCards.filter((c) => selectedPassKeys.includes(cardKey(c))), [availableCards, selectedPassKeys]);

  const runAction = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
      await loadSnapshot();
    } catch (e) {
      const maybeMessage =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message?: unknown }).message || "")
          : "";
      setError(e instanceof Error ? e.message : maybeMessage || "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!userEmail || !game) return;
    const asDm = slotMode === "dm";
    const dmName = dmSlotInput.trim();
    if (asDm && !dmName) {
      setError("Enter a DM character name.");
      return;
    }
    const display = asDm ? dmName : character?.name || userEmail.split("@")[0] || "Player";

    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_join_game", {
        p_game_id: game.id,
        p_display_name: display,
        p_as_dm: asDm,
        p_dm_slot_name: asDm ? dmName : null,
      });
      if (rpcError) throw rpcError;
      if (asDm) {
        setSelectedDmSlot(dmName);
        setDmSlotInput("");
      }
    });
  };

  const forfeit = async () => {
    if (!game) return;
    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_forfeit", {
        p_game_id: game.id,
        p_as_dm: slotMode === "dm",
        p_dm_slot_name: slotMode === "dm" ? selectedDmSlot : null,
      });
      if (rpcError) throw rpcError;
    });
  };

  const restartGame = async () => {
    if (!game) return;
    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_restart_game", {
        p_game_id: game.id,
      });
      if (rpcError) throw rpcError;
      setSelectedPassKeys([]);
      setShowImproveCards(false);
    });
  };

  const startGame = async () => {
    if (!game) return;
    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_start_game", {
        p_game_id: game.id,
      });
      if (rpcError) throw rpcError;
    });
  };

  const submitDeclareOrImprove = async () => {
    if (!game) return;
    if (passCards.length !== 5) {
      setError("Select exactly 5 cards to pass.");
      return;
    }
    if (shouldImprove && !isHigherThanPrevious) {
      setError("Declaration must be strictly higher.");
      return;
    }

    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_declare_and_pass", {
        p_game_id: game.id,
        p_declared_type: currentDecl.type,
        p_declared_rank: currentDecl.type === "royal_flush" ? 14 : currentDecl.rank,
        p_declared_suit: currentDecl.suit,
        p_declared_meta: currentDecl.meta,
        p_pass_cards: passCards,
      });
      if (rpcError) throw rpcError;
      setSelectedPassKeys([]);
      setShowImproveCards(false);
    });
  };

  const callBluff = async () => {
    if (!game) return;
    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_call_bluff", {
        p_game_id: game.id,
      });
      if (rpcError) throw rpcError;
      setSelectedPassKeys([]);
      setShowImproveCards(false);
    });
  };

  const continueAfterChallenge = async () => {
    if (!game) return;
    await runAction(async () => {
      const { error: rpcError } = await supabase.rpc("kogra_continue_after_challenge", {
        p_game_id: game.id,
      });
      if (rpcError) throw rpcError;
      setSelectedPassKeys([]);
      setShowImproveCards(false);
    });
  };

  const togglePassCard = (card: KograCard) => {
    const key = cardKey(card);
    setSelectedPassKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 5) return prev;
      return [...prev, key];
    });
  };

  const declaredSummary = formatDeclaration(
    game?.state?.declared_type,
    game?.state?.declared_rank,
    game?.state?.declared_suit ?? null,
    game?.state?.declared_meta
  );

  const declaredByName = useMemo(() => {
    const id = game?.state?.declared_by_player_id;
    if (!id) return null;
    return players.find((p) => p.id === id)?.display_name || null;
  }, [game?.state?.declared_by_player_id, players]);

  const roundOverSummary = useMemo(() => {
    if (!game?.state?.last_call_result) return null;
    const winnerName = players.find((p) => p.id === game.state?.last_call_result?.winner_player_id)?.display_name || "Unknown";
    const loserName = players.find((p) => p.id === game.state?.last_call_result?.loser_player_id)?.display_name || "Unknown";
    const wasBluff = game.state.last_call_result.bluff_was_true;
    return `${winnerName} > ${loserName} (${wasBluff ? "Deceit" : "Truth"})`;
  }, [game?.state, players]);

  const revealedTransitCards = game?.state?.revealed_transit_cards || [];

  if (!userEmail) {
    return <p className="text-amber-200">Log in to play Kogra.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-950 via-gray-900 to-emerald-900 p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl font-black text-amber-300 tracking-wide">Kogra</h3>
            <p className="text-sm text-emerald-100/90">
              {game ? gameStatusLabel(game.status) : "Loading"} · Round {game?.round_no ?? 0}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={restartGame}
              disabled={busy || loading || !game}
              className="px-3 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
            >
              Restart
            </button>
            <button
              onClick={forfeit}
              disabled={busy || loading || !game || !myPlayer}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 text-amber-100 rounded-lg text-sm font-semibold"
            >
              Forfeit
            </button>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>

      <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-900/70 to-emerald-950/90 p-4 md:p-6">
        <div className="relative mx-auto h-[360px] w-full max-w-4xl overflow-hidden">
          <div className="absolute inset-0 rounded-[999px] border-[10px] border-amber-700/60 bg-[radial-gradient(circle_at_center,#0f5132_0%,#064e3b_45%,#022c22_100%)] shadow-[inset_0_0_80px_rgba(0,0,0,0.45)]" />
          <div className="absolute inset-6 rounded-[999px] border border-amber-300/20" />

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 rounded-xl border border-amber-300/30 bg-black/35 backdrop-blur-sm px-4 py-3 text-center">
            <p className="text-xs uppercase tracking-wide text-amber-200/80">Declared</p>
            <p className="text-sm font-semibold text-amber-100">{declaredSummary}</p>
            {declaredByName && <p className="text-xs text-amber-200/80 mt-1">by {declaredByName}</p>}
            {roundOverSummary && <p className="text-xs text-emerald-200 mt-2">{roundOverSummary}</p>}
            {revealedTransitCards.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-1">
                {revealedTransitCards.map((card) => (
                  <span
                    key={`reveal-${cardKey(card)}`}
                    className="px-1.5 py-0.5 rounded bg-black/40 border border-amber-200/25 text-[10px] text-amber-100"
                  >
                    {rankLabel(card.rank)}
                    {suitSymbol(card.suit)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {currentPlayer && <SeatChip player={currentPlayer} label="Current" pos={{ x: 50, y: 85 }} isMe={currentPlayer.id === myPlayer?.id} />}
          {previousPlayer && <SeatChip player={previousPlayer} label="Previous" pos={{ x: 83, y: 50 }} isMe={previousPlayer.id === myPlayer?.id} />}
          {nextPlayer && <SeatChip player={nextPlayer} label="Next" pos={{ x: 17, y: 50 }} isMe={nextPlayer.id === myPlayer?.id} />}

          {topPlayers.map((p, i) => {
            const span = Math.max(1, topPlayers.length - 1);
            const x = 15 + 70 * (span === 0 ? 0.5 : i / span);
            return <SeatChip key={p.id} player={p} pos={{ x, y: 16 }} isMe={p.id === myPlayer?.id} />;
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-amber-500/30 bg-gray-900/80 p-4 space-y-3">
          <h4 className="text-lg font-bold text-amber-300">Slot</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSlotMode("player")}
              disabled={busy}
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${
                slotMode === "player" ? "bg-amber-500 text-gray-900" : "bg-gray-700 text-amber-100"
              }`}
            >
              Player
            </button>
            {isAdmin && (
              <button
                onClick={() => setSlotMode("dm")}
                disabled={busy}
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${
                  slotMode === "dm" ? "bg-blue-500 text-white" : "bg-gray-700 text-amber-100"
                }`}
              >
                DM
              </button>
            )}
          </div>

          {slotMode === "dm" && (
            <div className="space-y-2">
              {myDmSlots.length > 0 && (
                <select
                  value={selectedDmSlot}
                  onChange={(e) => setSelectedDmSlot(e.target.value)}
                  className="w-full rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                >
                  {myDmSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      Play as: {slot}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={dmSlotInput}
                onChange={(e) => setDmSlotInput(e.target.value)}
                placeholder="New DM character name"
                className="w-full rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
              />
            </div>
          )}

          <div className="flex gap-2">
            {(slotMode === "player" ? !hasActivePlayerSlot : true) && (
              <button
                onClick={join}
                disabled={
                  busy ||
                  loading ||
                  !game ||
                  game.status !== "waiting" ||
                  (slotMode === "dm" && (!isAdmin || !dmSlotInput.trim()))
                }
                className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
              >
                Join
              </button>
            )}
            <button
              onClick={startGame}
              disabled={busy || loading || !game || activePlayers.length < 2 || game?.status === "in_round" || game?.status === "round_over"}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-600 text-gray-900 rounded-lg text-sm font-semibold"
            >
              Start
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-gray-900/80 p-4 space-y-3">
          <h4 className="text-lg font-bold text-amber-300">Turn</h4>
          {!isMyTurn && !canContinueAfterChallenge && <p className="text-sm text-amber-200">Waiting for your turn.</p>}

          {isMyTurn && shouldImprove && !showImproveCards && (
            <div className="flex gap-2">
              {canEscalate && (
                <button
                  onClick={() => setShowImproveCards(true)}
                  disabled={busy}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
                >
                  Escalate
                </button>
              )}
              {canCallBluff && (
                <button
                  onClick={callBluff}
                  disabled={busy}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
                >
                  Challenge
                </button>
              )}
            </div>
          )}

          {canContinueAfterChallenge && (
            <div className="flex gap-2">
              <button
                onClick={continueAfterChallenge}
                disabled={busy}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
              >
                Continue
              </button>
            </div>
          )}

          {isMyTurn && (!shouldImprove || showImproveCards) && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={declaredType}
                  onChange={(e) => setDeclaredType(e.target.value as DeclarationType)}
                  className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                >
                  {(shouldImprove ? availableTypes : HAND_TYPES).map((t) => (
                    <option key={t} value={t}>{handTypeLabel(t)}</option>
                  ))}
                </select>

                {declaredType !== "royal_flush" && (
                  <select
                    value={declaredRank}
                    onChange={(e) => setDeclaredRank(parseInt(e.target.value, 10))}
                    className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                  >
                    {RANK_OPTIONS.map((rank) => (
                      <option key={rank} value={rank}>{rankLabel(rank)}</option>
                    ))}
                  </select>
                )}

                {declaredType === "two_pair" && (
                  <select
                    value={declaredLowRank}
                    onChange={(e) => setDeclaredLowRank(parseInt(e.target.value, 10))}
                    className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                  >
                    {rankOptionsForLow.map((rank) => (
                      <option key={rank} value={rank}>{rankLabel(rank)}</option>
                    ))}
                  </select>
                )}

                {declaredType === "full_house" && (
                  <select
                    value={declaredPairRank}
                    onChange={(e) => setDeclaredPairRank(parseInt(e.target.value, 10))}
                    className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                  >
                    {rankOptionsForPair.map((rank) => (
                      <option key={rank} value={rank}>{rankLabel(rank)}</option>
                    ))}
                  </select>
                )}

                {declaredType === "flush" && (
                  <>
                    {flushKickers
                      .slice(
                        0,
                        (() => {
                          const firstNull = flushKickers.findIndex((k) => k === null);
                          return firstNull === -1 ? flushKickers.length : Math.max(1, firstNull + 1);
                        })()
                      )
                      .map((k, idx) => (
                      <select
                        key={`fk-${idx}`}
                        value={k ?? "na"}
                        onChange={(e) => {
                          const value = e.target.value === "na" ? null : parseInt(e.target.value, 10);
                          setFlushKickers((prev) => {
                            const next = [...prev];
                            next[idx] = value;
                            for (let j = idx + 1; j < next.length; j += 1) next[j] = null;
                            return next;
                          });
                        }}
                        className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                      >
                        {flushRankOptionsAt(idx).map((rank) => (
                          <option key={`${idx}-${rank ?? "na"}`} value={rank ?? "na"}>
                            {rank === null ? "N/A" : rankLabel(rank)}
                          </option>
                        ))}
                      </select>
                    ))}
                  </>
                )}

                {requiresSuit(declaredType) && (
                  <select
                    value={declaredSuit}
                    onChange={(e) => setDeclaredSuit(e.target.value as Suit)}
                    className="rounded-md bg-gray-800 border border-gray-600 text-amber-100 px-2 py-2 text-sm"
                  >
                    {SUITS.map((s) => (
                      <option key={s} value={s}>{suitLabel(s)}</option>
                    ))}
                  </select>
                )}

                <p className="text-sm text-amber-100 flex items-center">{passCards.length}/5 selected</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={submitDeclareOrImprove}
                  disabled={busy || passCards.length !== 5 || (shouldImprove && !isHigherThanPrevious)}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold"
                >
                  Declare
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-gray-900/80 p-4 space-y-3">
        <h4 className="text-lg font-bold text-amber-300">Cards</h4>
        {loading && <p className="text-sm text-amber-200">Loading...</p>}
        {!loading && !myPrivate && <p className="text-sm text-amber-200">Join to view cards.</p>}

        {myPrivate && (
          <>
            <div>
              <p className="text-xs font-semibold text-amber-300 mb-2">Personal</p>
              <div className="flex flex-wrap gap-2">
                {myPrivate.personal_cards.length === 0 && <p className="text-sm text-amber-200">None</p>}
                {myPrivate.personal_cards.map((card) => (
                  <TableCard
                    key={`personal-${cardKey(card)}`}
                    card={card}
                    selectable
                    selected={selectedPassKeys.includes(cardKey(card))}
                    onToggle={togglePassCard}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-amber-300 mb-2">Transit</p>
              {!canSeeTransitCards && <p className="text-sm text-amber-200">Hidden</p>}
              {canSeeTransitCards && (
                <div className="flex flex-wrap gap-2">
                  {myPrivate.transit_cards.length === 0 && <p className="text-sm text-amber-200">None</p>}
                  {myPrivate.transit_cards.map((card) => (
                    <TableCard
                      key={`transit-${cardKey(card)}`}
                      card={card}
                      selectable
                      selected={selectedPassKeys.includes(cardKey(card))}
                      onToggle={togglePassCard}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SeatChip({
  player,
  pos,
  label,
  isMe,
}: {
  player: KograPlayer;
  pos: { x: number; y: number };
  label?: string;
  isMe: boolean;
}) {
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <div className="min-w-[120px] rounded-xl border border-amber-200/25 bg-black/35 backdrop-blur-sm px-3 py-2 text-center shadow-lg">
        {label && <p className="text-[10px] uppercase tracking-wide text-amber-200/70">{label}</p>}
        <p className="text-sm font-semibold text-amber-100 leading-tight">
          {player.display_name}
          {isMe ? " · You" : ""}
        </p>
        <p className="text-[11px] text-amber-200/80">Hand {player.starting_hand_size}</p>
      </div>
    </div>
  );
}
