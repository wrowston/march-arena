"use client";

import { useState } from "react";
import { SurvivorAIPicks } from "@/components/survivor/SurvivorAIPicks";
import { SurvivorLeaderboard } from "@/components/survivor/SurvivorLeaderboard";

type Tab = "ai-picks" | "leaderboard";

export default function SurvivorPage() {
  const [tab, setTab] = useState<Tab>("ai-picks");

  return (
    <div className="min-h-[calc(100dvh-3rem)] bg-[#ececec]">
      <div className="max-w-[1200px] mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-[#121213] tracking-tight">
            Survivor Pool
          </h1>
          <p className="text-[13px] text-[#6c6e6f] mt-1 max-w-2xl">
            Pick one team each day of the tournament. If they win, you survive.
            Pick wrong and you&apos;re eliminated. Each team can only be used
            once across all 10 days.
          </p>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("ai-picks")}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === "ai-picks"
                ? "bg-[#c8102e] text-white"
                : "bg-white border border-[#dcdddf] text-[#6c6e6f] hover:text-[#121213]"
            }`}
          >
            AI Picks
          </button>
          <button
            type="button"
            onClick={() => setTab("leaderboard")}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              tab === "leaderboard"
                ? "bg-[#121213] text-white"
                : "bg-white border border-[#dcdddf] text-[#6c6e6f] hover:text-[#121213]"
            }`}
          >
            Leaderboard
          </button>
        </div>

        {tab === "ai-picks" && <SurvivorAIPicks />}
        {tab === "leaderboard" && <SurvivorLeaderboard />}
      </div>
    </div>
  );
}
