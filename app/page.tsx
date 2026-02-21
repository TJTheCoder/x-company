import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { EnvVarWarning } from "@/components/env-var-warning";
import { HeroWrapper } from "@/components/hero-wrapper";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";
import { Hero } from "@/components/hero";
import { RepoStatsFooterText } from "@/components/repo-stats-footer-text";

export default function Home() {
  return (
    <main className="relative min-h-screen flex flex-col items-center font-serif text-amber-50 bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      
      {/* Background Layers */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-[900px] h-[900px] bg-amber-700/20 rounded-full top-10 left-1/3 animate-pulse-slow blur-3xl"></div>
        <div className="absolute w-[650px] h-[650px] bg-amber-600/10 rounded-full bottom-20 right-1/4 animate-pulse-slow blur-2xl"></div>
      </div>

      {/* Navigation */}
      <nav className="w-full z-10 flex justify-between items-center max-w-6xl px-8 py-6 border-b border-amber-600/20 backdrop-blur-sm">
        <h1 className="text-4xl lg:text-5xl font-black tracking-wider text-amber-400 drop-shadow-lg animate-fade-in">
          The Dragon Lord
        </h1>
        <div className="flex items-center gap-4">
          {!hasEnvVars ? (
            <EnvVarWarning />
          ) : (
            <Suspense fallback={null}>
              <AuthButton />
            </Suspense>
          )}
          <ThemeSwitcher />
        </div>
      </nav>

      {/* Hero Section
          HeroWrapper is a server component that checks the session and passes
          isLoggedIn to Hero.  It lives inside Suspense so the cookies() call
          doesn't block the page — the fallback renders the logged-out Hero
          instantly and swaps in the correct state once the check resolves. */}
      <div className="flex-1 flex flex-col items-center justify-center z-10 w-full px-6 mt-16">
        <Suspense fallback={<Hero isLoggedIn={false} />}>
          <HeroWrapper />
        </Suspense>
      </div>

      {/* Footer */}
      <footer className="w-full flex items-center justify-center text-sm text-amber-200 gap-6 py-12 mt-20 border-t border-amber-600/20 backdrop-blur-sm">
        <p>
          <Suspense fallback={"0 lines across 0 hours!"}>
            <RepoStatsFooterText />
          </Suspense>
        </p>
      </footer>
    </main>
  );
}
