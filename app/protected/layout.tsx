// app/protected/layout.tsx
import { ReactNode } from "react";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-900 text-amber-50 font-serif flex flex-col">
      {/* Optional: Header / Navbar */}
      <header className="w-full p-6 border-b border-amber-600/20 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-amber-400">X Company</h1>
        {/* You can add logout or theme switcher here */}
      </header>

      {/* Main content */}
      <div className="flex-1">{children}</div>

      {/* Optional footer */}
      <footer className="w-full py-6 border-t border-amber-600/20 text-center text-amber-300">
        Powered by mystical forces
      </footer>
    </div>
  );
}
