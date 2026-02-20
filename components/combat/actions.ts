import { createClient } from "@/lib/supabase/client";
import type {
  EngagementEdge,
  InitiativeEntry,
  InitiativeMonster,
  ZoneLootDrop,
} from "./model";

export type LatestInitiativeState = {
  freshEntries: InitiativeEntry[];
  freshMonsters: InitiativeMonster[];
  freshCurrentIndex: number | null;
  freshEngagements: EngagementEdge[];
  freshLoot: ZoneLootDrop[];
};

type SaveInitiativeState = (
  entries: InitiativeEntry[],
  currentIndex: number | null,
  combatModeValue: boolean,
  monsters?: InitiativeMonster[],
  engagementEdges?: EngagementEdge[],
  tokens?: null,
  loot?: ZoneLootDrop[]
) => Promise<void>;

export async function passTurnAction(params: {
  canPass: boolean;
  currentParticipantId: string | null;
  clearSwingForParticipant: (participantId: string | null) => Promise<boolean>;
  setError: (message: string | null) => void;
}): Promise<void> {
  const { canPass, currentParticipantId, clearSwingForParticipant, setError } = params;
  if (!canPass) return;
  const cleared = await clearSwingForParticipant(currentParticipantId);
  if (!cleared) return;
  const supabase = createClient();
  const { error: rpcError } = await supabase.rpc("combat_pass_turn");
  if (rpcError) {
    setError(rpcError.message);
  }
}

export async function consumeActionRpc(params: {
  canPass: boolean;
  actionType: "fast" | "slow";
  setError: (message: string | null) => void;
}): Promise<boolean> {
  const { canPass, actionType, setError } = params;
  if (!canPass) return false;
  const supabase = createClient();
  const { error: rpcError } = await supabase.rpc("combat_use_action", { p_action: actionType });
  if (rpcError) {
    setError(rpcError.message);
    return false;
  }
  return true;
}

export async function consumeFastOrSlowRpc(params: {
  canPass: boolean;
  setError: (message: string | null) => void;
}): Promise<boolean> {
  const { canPass, setError } = params;
  if (!canPass) return false;
  const supabase = createClient();
  const { error: rpcError } = await supabase.rpc("combat_use_fast_or_slow");
  if (rpcError) {
    setError(rpcError.message);
    return false;
  }
  return true;
}

export async function clearTauntAngerForTokenAction(params: {
  actorTokenId: string;
  isDmUser: boolean;
  fetchLatestInitiativeState: () => Promise<LatestInitiativeState | null>;
  saveInitiativeState: SaveInitiativeState;
  setInitiativeEntries: (entries: InitiativeEntry[]) => void;
  setInitiativeMonsters: (monsters: InitiativeMonster[]) => void;
  setInitiativeCurrentIndex: (index: number | null) => void;
  combatMode: boolean;
  setError: (message: string | null) => void;
}): Promise<boolean> {
  const {
    actorTokenId,
    isDmUser,
    fetchLatestInitiativeState,
    saveInitiativeState,
    setInitiativeEntries,
    setInitiativeMonsters,
    setInitiativeCurrentIndex,
    combatMode,
    setError,
  } = params;

  if (!actorTokenId) return false;
  const supabase = createClient();
  const { error: rpcError } = await supabase.rpc("combat_clear_taunt_anger", {
    p_actor_token_id: actorTokenId,
  });
  if (!rpcError) {
    return true;
  }
  if (!isDmUser) {
    setError(rpcError.message);
    return false;
  }
  const latest = await fetchLatestInitiativeState();
  if (!latest) {
    setError(rpcError.message);
    return false;
  }
  const nextEntries = latest.freshEntries.map((entry) => {
    const tokenId =
      entry.kind === "player" ? entry.participant_id.replace(/^player:/, "") : entry.participant_id;
    if (tokenId !== actorTokenId) return entry;
    return {
      ...entry,
      taunted_anger_by_id: null,
      taunted_anger_by_name: null,
    };
  });
  setInitiativeEntries(nextEntries);
  setInitiativeMonsters(latest.freshMonsters);
  setInitiativeCurrentIndex(latest.freshCurrentIndex);
  await saveInitiativeState(
    nextEntries,
    latest.freshCurrentIndex,
    combatMode,
    latest.freshMonsters,
    latest.freshEngagements,
    null,
    latest.freshLoot
  );
  return true;
}

export async function consumeTauntPenaltyForTokenAction(params: {
  actorTokenId: string;
  findEntryForTokenId: (tokenId: string) => InitiativeEntry | null;
  isDmUser: boolean;
  fetchLatestInitiativeState: () => Promise<LatestInitiativeState | null>;
  saveInitiativeState: SaveInitiativeState;
  setInitiativeEntries: (entries: InitiativeEntry[]) => void;
  setInitiativeMonsters: (monsters: InitiativeMonster[]) => void;
  setInitiativeCurrentIndex: (index: number | null) => void;
  combatMode: boolean;
  setError: (message: string | null) => void;
}): Promise<number> {
  const {
    actorTokenId,
    findEntryForTokenId,
    isDmUser,
    fetchLatestInitiativeState,
    saveInitiativeState,
    setInitiativeEntries,
    setInitiativeMonsters,
    setInitiativeCurrentIndex,
    combatMode,
    setError,
  } = params;

  if (!actorTokenId) return 0;
  const entry = findEntryForTokenId(actorTokenId);
  const fallbackPenalty = Math.max(0, entry?.taunted_distract_value ?? 0);
  if (fallbackPenalty <= 0) return 0;

  const supabase = createClient();
  const { data, error: rpcError } = await supabase.rpc("combat_consume_taunt_distract", {
    p_actor_token_id: actorTokenId,
  });
  if (rpcError) {
    if (isDmUser) {
      const latest = await fetchLatestInitiativeState();
      if (latest) {
        const nextEntries = latest.freshEntries.map((item) => {
          const tokenId =
            item.kind === "player" ? item.participant_id.replace(/^player:/, "") : item.participant_id;
          if (tokenId !== actorTokenId) return item;
          return { ...item, taunted_distract_value: null };
        });
        setInitiativeEntries(nextEntries);
        setInitiativeMonsters(latest.freshMonsters);
        setInitiativeCurrentIndex(latest.freshCurrentIndex);
        await saveInitiativeState(
          nextEntries,
          latest.freshCurrentIndex,
          combatMode,
          latest.freshMonsters,
          latest.freshEngagements,
          null,
          latest.freshLoot
        );
      } else {
        setError(rpcError.message);
      }
    } else {
      setError(rpcError.message);
    }
    return -fallbackPenalty;
  }

  const consumedPenalty = Math.max(0, Number(data ?? 0));
  return -consumedPenalty;
}
