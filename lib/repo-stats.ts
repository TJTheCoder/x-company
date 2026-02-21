import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

type RepoStats = {
  lines: number;
  hours: number;
};

const SESSION_GAP_SECONDS = 8 * 60 * 60;
const SESSION_STARTER_HOURS = 1;

const ZERO_CAPTION = "0 lines across 0 hours!";
const STATS_SOURCE = process.env.VERCEL ? "vercel" : "localhost";

let cachedCaption: string | null = null;
let pendingCaptionPromise: Promise<string> | null = null;
let lastSupabaseWrittenCaption: string | null = null;
let supabaseWriteInFlight = false;

function formatHours(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}`;
  return `${hours.toFixed(1)}`;
}

function parseTotalChangedLines(numstatOutput: string): number {
  let total = 0;
  for (const line of numstatOutput.split("\n")) {
    if (!line.trim()) continue;
    const [added, deleted] = line.split("\t");
    const a = Number(added);
    const d = Number(deleted);
    if (!Number.isFinite(a) || !Number.isFinite(d)) continue;
    total += Math.max(0, a) + Math.max(0, d);
  }
  return total;
}

function estimateHoursFromCommitSessions(commitsOutput: string): number {
  const commitsByAuthor = new Map<string, number[]>();

  for (const rawLine of commitsOutput.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [author, timestampRaw] = line.split("\t");
    const timestamp = Number(timestampRaw);
    if (!author || !Number.isFinite(timestamp)) continue;
    const existing = commitsByAuthor.get(author) || [];
    existing.push(timestamp);
    commitsByAuthor.set(author, existing);
  }

  let totalHours = 0;

  for (const [, timestamps] of commitsByAuthor) {
    if (timestamps.length === 0) continue;
    timestamps.sort((a, b) => a - b);

    let sessionStart = timestamps[0];
    let previous = timestamps[0];

    for (let i = 1; i < timestamps.length; i += 1) {
      const current = timestamps[i];
      const gap = current - previous;
      if (gap <= SESSION_GAP_SECONDS) {
        previous = current;
        continue;
      }

      totalHours += (previous - sessionStart) / 3600 + SESSION_STARTER_HOURS;
      sessionStart = current;
      previous = current;
    }

    totalHours += (previous - sessionStart) / 3600 + SESSION_STARTER_HOURS;
  }

  return Math.max(0, Math.round(totalHours * 10) / 10);
}

function computeRepoStats(): RepoStats {
  const numstatOutput = execSync("git log --numstat --pretty=tformat:", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = parseTotalChangedLines(numstatOutput);

  const commitsOutput = execSync("git log --format=%ae%x09%ct", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const hours = estimateHoursFromCommitSessions(commitsOutput);
  return { lines, hours };
}

function getRepoCommitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function compareRepoStats(a: RepoStats | null, b: RepoStats | null): number {
  if (!a && !b) return 0;
  if (a && !b) return 1;
  if (!a && b) return -1;
  if (a!.lines !== b!.lines) return a!.lines > b!.lines ? 1 : -1;
  if (a!.hours !== b!.hours) return a!.hours > b!.hours ? 1 : -1;
  return 0;
}

async function getSupabaseBestStats(): Promise<RepoStats | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.rpc("repo_stats_best");
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { lines?: number; hours?: number };
    const lines = Number(row?.lines ?? 0);
    const hours = Number(row?.hours ?? 0);
    if (!Number.isFinite(lines) || !Number.isFinite(hours)) return null;
    if (lines < 0 || hours < 0) return null;
    return { lines: Math.trunc(lines), hours: Math.round(hours * 10) / 10 };
  } catch {
    return null;
  }
}

async function upsertSupabaseStats(stats: RepoStats): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const caption = `${stats.lines.toLocaleString()} lines across ${formatHours(stats.hours)} hours!`;
    if (supabaseWriteInFlight || lastSupabaseWrittenCaption === caption) return;
    supabaseWriteInFlight = true;
    await supabase.rpc("repo_stats_upsert_if_higher", {
      p_lines: stats.lines,
      p_hours: stats.hours,
      p_caption: caption,
      p_source: STATS_SOURCE,
      p_commit_sha: getRepoCommitSha(),
    });
    lastSupabaseWrittenCaption = caption;
  } catch {
    // Ignore Supabase write failures and keep local rendering stable.
  } finally {
    supabaseWriteInFlight = false;
  }
}

async function computeCaption(): Promise<string> {
  let localStats: RepoStats | null = null;
  try {
    localStats = computeRepoStats();
  } catch {
    localStats = null;
  }

  const remoteStats = await getSupabaseBestStats();
  const winner = compareRepoStats(localStats, remoteStats) >= 0 ? localStats : remoteStats;

  if (localStats && compareRepoStats(localStats, remoteStats) >= 0) {
    void upsertSupabaseStats(localStats);
  }

  if (!winner) return ZERO_CAPTION;
  return `${winner.lines.toLocaleString()} lines across ${formatHours(winner.hours)} hours!`;
}

export async function getRepoStatsCaption(): Promise<string> {
  if (cachedCaption) return cachedCaption;
  if (!pendingCaptionPromise) {
    pendingCaptionPromise = computeCaption()
      .then((caption) => {
        cachedCaption = caption;
        return caption;
      })
      .catch(() => {
        cachedCaption = ZERO_CAPTION;
        return ZERO_CAPTION;
      })
      .finally(() => {
        pendingCaptionPromise = null;
      });
  }
  return pendingCaptionPromise;
}
