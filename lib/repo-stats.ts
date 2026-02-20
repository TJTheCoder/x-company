import { execSync } from "node:child_process";

type RepoStats = {
  lines: number;
  hours: number;
};

const SESSION_GAP_SECONDS = 8 * 60 * 60;
const SESSION_STARTER_HOURS = 1;

let cachedCaption: string | null = null;

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

export function getRepoStatsCaption(): string {
  if (cachedCaption) return cachedCaption;
  try {
    const { lines, hours } = computeRepoStats();
    cachedCaption = `${lines.toLocaleString()} lines across ${formatHours(hours)} hours!`;
    return cachedCaption;
  } catch {
    cachedCaption = "0 lines across 0 hours!";
    return cachedCaption;
  }
}
