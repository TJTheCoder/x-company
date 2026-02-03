import { ReactNode, Suspense } from "react";
import { AuthGuard } from "@/components/auth-guard";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-900 text-amber-50 font-serif flex flex-col">
      <header className="w-full p-6 border-b border-amber-600/20 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-amber-400">X Company</h1>
      </header>

      <div className="flex-1">
        <Suspense fallback={null}>
          <AuthGuard>{children}</AuthGuard>
        </Suspense>
      </div>

      <footer className="w-full py-6 border-t border-amber-600/20 text-center text-amber-300">
        A mysterious figure is watching...
      </footer>
    </div>
  );
}