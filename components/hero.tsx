import { FloatingParticles } from "./floating-particles";

export function Hero({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <div className="relative flex flex-col items-center gap-12 text-center max-w-4xl mx-auto">

      {/* Cinematic Emblem */}
      <div className="relative w-52 h-52 rounded-full bg-gradient-to-br from-amber-700 to-yellow-400 shadow-2xl flex items-center justify-center ring-8 ring-amber-500/40 animate-pulse-slow">
        <span className="text-7xl lg:text-8xl font-black text-gray-900 drop-shadow-xl animate-bounce-slow">
          🜚
        </span>
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-yellow-400/30 via-amber-300/20 to-yellow-400/30 blur-3xl animate-ping-slow"></div>
      </div>

      {/* Title */}
      <h1 className="text-7xl lg:text-8xl font-extrabold tracking-tight text-amber-400 drop-shadow-2xl animate-fade-in">
        X <span className="text-amber-200">Company</span>
      </h1>

      {/* Subtitle */}
      <p className="text-lg lg:text-2xl text-amber-200/90 leading-relaxed max-w-3xl animate-fade-in delay-200">
        Ravaged by a vicious naaka, the entire world was at the brink of destruction. Just when all hope seemed lost, a great dragon emerged from the heavens and slew the terrible fiend. The savior became known as the Dragon Lord, and its story became legend.
      </p>

      {/* Action Buttons */}
      <div className="flex gap-6 mt-8 animate-fade-in delay-400">
        {isLoggedIn ? (
          <a
            href="/protected"
            className="px-12 py-3 bg-gradient-to-r from-amber-500 to-yellow-400 text-gray-900 font-semibold rounded-3xl shadow-2xl hover:scale-105 transform transition-all duration-300 hover:shadow-3xl"
          >
            Continue Your Legend
          </a>
        ) : (
          <>
            <a
              href="/auth/login"
              className="px-12 py-3 bg-gradient-to-r from-amber-500 to-yellow-400 text-gray-900 font-semibold rounded-3xl shadow-2xl hover:scale-105 transform transition-all duration-300 hover:shadow-3xl"
            >
              Continue Your Legend
            </a>
            <a
              href="/auth/sign-up"
              className="px-12 py-3 border-2 border-amber-400 text-amber-200 font-semibold rounded-3xl hover:bg-amber-600/20 transform transition-all duration-300 hover:scale-105"
            >
              Begin Your Chronicle
            </a>
          </>
        )}
      </div>

      {/* Stars + magical particles */}
      <div className="absolute inset-0 pointer-events-none">
        <FloatingParticles count={35} />
      </div>

      {/* Decorative Rune Divider */}
      <div className="flex gap-4 mt-12">
        <div className="w-20 h-1 bg-gradient-to-r from-amber-300/50 via-amber-500/80 to-amber-300/50 rounded-full"></div>
        <div className="w-20 h-1 bg-gradient-to-r from-amber-300/50 via-amber-500/80 to-amber-300/50 rounded-full"></div>
        <div className="w-20 h-1 bg-gradient-to-r from-amber-300/50 via-amber-500/80 to-amber-300/50 rounded-full"></div>
      </div>
    </div>
  );
}