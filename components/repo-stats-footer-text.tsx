import { getRepoStatsCaption } from "@/lib/repo-stats";

export async function RepoStatsFooterText() {
  const caption = await getRepoStatsCaption();
  return <>{caption}</>;
}
