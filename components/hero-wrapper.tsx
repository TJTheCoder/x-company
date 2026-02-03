import { createClient } from "@/lib/supabase/server";
import { Hero } from "@/components/hero";

export async function HeroWrapper() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  return <Hero isLoggedIn={!!session} />;
}