import { getRepoStatsCaption } from "@/lib/repo-stats";

export function RepoStatsFooterText() {
  return <>{getRepoStatsCaption()}</>;
}
