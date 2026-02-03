import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/sign-up-form";

export async function SignUpRedirect() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    redirect("/protected");
  }

  return <SignUpForm />;
}