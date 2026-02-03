import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { LoginRedirect } from "@/components/login-redirect";
import { FloatingParticles } from "@/components/floating-particles";

export default function Page() {
  return (
    <main className="relative min-h-svh w-full flex items-center justify-center bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      {/* Ambient glow orbs — mirrors the main page */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-[700px] h-[700px] bg-amber-700/15 rounded-full top-[-10%] left-[30%] blur-3xl" />
        <div className="absolute w-[500px] h-[500px] bg-amber-600/10 rounded-full bottom-[-10%] right-[20%] blur-2xl" />
      </div>

      {/* Floating particles layer */}
      <div className="absolute inset-0 pointer-events-none">
        <FloatingParticles count={25} />
      </div>

      {/* Nav bar — thin, matches main page nav style */}
      <nav className="absolute top-0 left-0 w-full z-10 flex justify-center px-8 py-6 border-b border-amber-600/20 backdrop-blur-sm">
        <h1 className="text-2xl font-black tracking-wider text-amber-400 drop-shadow-lg">
          The Dragon Lord
        </h1>
      </nav>

      {/* Form, centred */}
      <div className="relative z-10 w-full max-w-sm px-6 pt-12">
        <Suspense fallback={<LoginForm />}>
          <LoginRedirect />
        </Suspense>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-0 left-0 w-full flex items-center justify-center py-6 border-t border-amber-600/20 backdrop-blur-sm">
        <p className="text-amber-300/50 text-sm">A mysterious figure is watching...</p>
      </footer>
    </main>
  );
}