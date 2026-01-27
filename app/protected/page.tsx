"use client";

import { useState } from "react";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"character" | "combat">("character");

  return (
    <main className="min-h-screen bg-gray-900 text-amber-50 font-serif p-8">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        {/* Tabs */}
        <div className="flex gap-4 border-b border-amber-500 mb-6">
          <button
            onClick={() => setActiveTab("character")}
            className={`px-4 py-2 font-semibold rounded-t-lg ${
              activeTab === "character"
                ? "bg-amber-500 text-gray-900"
                : "bg-gray-800 text-amber-200 hover:bg-gray-700"
            }`}
          >
            Character
          </button>
          <button
            onClick={() => setActiveTab("combat")}
            className={`px-4 py-2 font-semibold rounded-t-lg ${
              activeTab === "combat"
                ? "bg-amber-500 text-gray-900"
                : "bg-gray-800 text-amber-200 hover:bg-gray-700"
            }`}
          >
            Combat
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-gray-800 p-6 rounded-lg min-h-[300px]">
          {activeTab === "character" && (
            <div className="flex flex-col gap-4">
              {/* Character tab content goes here */}
              <p className="text-amber-300">Character tab (empty for now)</p>
            </div>
          )}

          {activeTab === "combat" && (
            <div className="flex flex-col gap-4">
              {/* Combat tab content goes here */}
              <p className="text-amber-300">Combat tab (empty for now)</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
