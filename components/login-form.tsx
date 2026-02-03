"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.push("/protected");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-6", className)} {...props}>
      {/* Emblem */}
      <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-amber-700 to-yellow-400 shadow-xl flex items-center justify-center ring-4 ring-amber-500/30">
        <span className="text-4xl font-black text-gray-900 drop-shadow-lg">🜚</span>
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-yellow-400/20 via-amber-300/10 to-yellow-400/20 blur-2xl animate-pulse"></div>
      </div>

      {/* Card */}
      <div className="w-full bg-gray-800/90 backdrop-blur-sm border border-amber-600/30 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top glow strip */}
        <div className="h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />

        <div className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold text-amber-400 drop-shadow-lg tracking-wide">
              Return, Traveller
            </h2>
            <p className="text-amber-300/70 mt-2 text-sm">
              Prove your identity to continue your legend
            </p>
          </div>

          {/* Rune divider */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-600/40" />
            <span className="text-amber-600/60 text-xs tracking-widest">✦</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-600/40" />
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-amber-300 text-sm font-semibold tracking-wide uppercase">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="kaelini@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-900/80 border border-amber-700/40 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-800/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-amber-300 text-sm font-semibold tracking-wide uppercase">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-amber-600 hover:text-amber-400 text-xs transition-colors underline underline-offset-4"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-900/80 border border-amber-700/40 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-800/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 rounded-lg bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400 text-gray-900 font-bold text-base tracking-wide shadow-lg hover:shadow-amber-500/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isLoading ? "Entering..." : "Continue Your Legend"}
            </button>
          </form>

          {/* Rune divider */}
          <div className="flex items-center justify-center gap-3 mt-7">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-600/40" />
            <span className="text-amber-600/60 text-xs tracking-widest">✦</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-600/40" />
          </div>

          {/* Sign up link */}
          <p className="text-center text-amber-400/60 text-sm mt-5">
            No chronicle yet?{" "}
            <Link
              href="/auth/sign-up"
              className="text-amber-400 hover:text-amber-300 underline underline-offset-4 transition-colors font-semibold"
            >
              Begin Your Chronicle
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}