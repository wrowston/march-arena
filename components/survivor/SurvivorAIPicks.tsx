"use client";

import { useState, useCallback } from "react";
import { useModel } from "@/components/ModelContext";
import { getTeamLogoUrl } from "@/lib/bracket-data";

interface AIDayPick {
  day: number;
  date: string;
  roundName: string;
  team: { id: number; name: string; seed: number; conference?: string };
  opponent: { id: number; name: string; seed: number };
  winProb: number;
  reasoning: string;
}

interface SimResult {
  winner: { id: number; name: string; seed: number };
  upsets: number;
}

interface EliminationInfo {
  day: number;
  roundName: string;
  reason: string;
}

interface StreamEvent {
  type:
    | "simulating"
    | "round_complete"
    | "simulation_complete"
    | "thinking"
    | "pick"
    | "skip"
    | "eliminated"
    | "error"
    | "done"
    | "fatal";
  day?: number;
  date?: string;
  round?: string;
  roundName?: string;
  team?: AIDayPick["team"];
  opponent?: AIDayPick["opponent"];
  winProb?: number;
  reasoning?: string;
  reason?: string;
  error?: string;
  totalPicks?: number;
  picks?: Array<{
    day: number;
    team: string;
    seed: number;
    winProb: number;
  }>;
  winner?: SimResult["winner"];
  upsets?: number;
}

function TeamLogo({ teamId, name, size = 8 }: { teamId: number; name: string; size?: number }) {
  const [error, setError] = useState(false);
  if (error || teamId <= 0) {
    return (
      <div
        className="rounded bg-[#e0e0e0] flex items-center justify-center text-[9px] font-bold text-[#6c6e6f]"
        style={{ width: `${size * 4}px`, height: `${size * 4}px` }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={getTeamLogoUrl(teamId, 64)}
      alt={name}
      width={64}
      height={64}
      className="h-full w-full object-contain"
      onError={() => setError(true)}
    />
  );
}

function PickCard({ pick }: { pick: AIDayPick }) {
  const pct = Math.round(pick.winProb * 100);
  const hue = pct >= 80 ? 142 : pct >= 60 ? 48 : pct >= 40 ? 30 : 0;

  return (
    <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#f0f0f0] bg-[#fafafa]">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#121213] text-white text-[12px] font-bold shrink-0">
          {pick.day}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#121213]">
            Day {pick.day} &mdash; {pick.roundName}
          </div>
          <div className="text-[10px] text-[#9a9c9e]">{pick.date}</div>
        </div>
        <div
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
          style={{ backgroundColor: `hsl(${hue}, 50%, 45%)` }}
        >
          {pct}%
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 shrink-0">
            <TeamLogo teamId={pick.team.id} name={pick.team.name} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-[#121213]">
              {pick.team.name}
            </div>
            <div className="text-[11px] text-[#6c6e6f]">
              #{pick.team.seed} seed
              {pick.team.conference ? ` \u00B7 ${pick.team.conference}` : ""}
              {" \u00B7 "}vs {pick.opponent.name} (#{pick.opponent.seed})
            </div>
          </div>
        </div>
        <div className="mt-3 text-[13px] leading-relaxed text-[#4a4b4d] italic">
          &ldquo;{pick.reasoning}&rdquo;
        </div>
      </div>
    </div>
  );
}

function ThinkingCard({ day, roundName }: { day: number; roundName: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden animate-pulse">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#e8e8e8] text-[#6c6e6f] text-[12px] font-bold shrink-0">
          {day}
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-medium text-[#6c6e6f]">
            Analyzing Day {day} &mdash; {roundName}...
          </div>
        </div>
        <div className="h-4 w-4 rounded-full border-2 border-[#6c6e6f] border-t-transparent animate-spin shrink-0" />
      </div>
    </div>
  );
}

export function SurvivorAIPicks() {
  const { modelId } = useModel();
  const [picks, setPicks] = useState<AIDayPick[]>([]);
  const [thinkingDay, setThinkingDay] = useState<{
    day: number;
    roundName: string;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simRound, setSimRound] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [elimination, setElimination] = useState<EliminationInfo | null>(null);

  const runAIPicks = useCallback(async () => {
    setPicks([]);
    setThinkingDay(null);
    setRunning(true);
    setDone(false);
    setError(null);
    setSimulating(false);
    setSimRound(null);
    setSimResult(null);
    setElimination(null);

    try {
      const res = await fetch("/api/survivor/ai-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: StreamEvent = JSON.parse(line);
            switch (event.type) {
              case "simulating":
                setSimulating(true);
                break;
              case "round_complete":
                setSimRound(event.round ?? null);
                break;
              case "simulation_complete":
                setSimulating(false);
                setSimRound(null);
                if (event.winner) {
                  setSimResult({
                    winner: event.winner,
                    upsets: event.upsets ?? 0,
                  });
                }
                break;
              case "thinking":
                setThinkingDay({
                  day: event.day!,
                  roundName: event.roundName ?? "",
                });
                break;
              case "pick":
                setThinkingDay(null);
                setPicks((prev) => [
                  ...prev,
                  {
                    day: event.day!,
                    date: event.date!,
                    roundName: event.roundName!,
                    team: event.team!,
                    opponent: event.opponent!,
                    winProb: event.winProb!,
                    reasoning: event.reasoning!,
                  },
                ]);
                break;
              case "eliminated":
                setThinkingDay(null);
                setElimination({
                  day: event.day!,
                  roundName: event.roundName ?? "",
                  reason: event.reason ?? "No available teams remaining.",
                });
                break;
              case "done":
                setDone(true);
                setRunning(false);
                break;
              case "error":
                console.warn(`Day ${event.day} error:`, event.error);
                break;
              case "fatal":
                setError(event.error ?? "Fatal error");
                setRunning(false);
                break;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run AI picks");
    } finally {
      setRunning(false);
    }
  }, [modelId]);

  const overallProb =
    picks.length > 0
      ? picks.reduce((acc, p) => acc * p.winProb, 1)
      : 0;

  return (
    <div className="space-y-4">
      {/* Header with run button */}
      <div className="bg-white rounded-lg border border-[#dcdddf] p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#121213]">
              AI Survivor Analyst
            </h2>
            <p className="text-[12px] text-[#6c6e6f] mt-0.5">
              Watch an AI analyst make survivor picks day-by-day with full
              reasoning, balancing win probability against future-value strategy.
            </p>
          </div>
          <button
            type="button"
            onClick={runAIPicks}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-[#c8102e] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#a50d25] transition-colors disabled:opacity-60"
          >
            {running && (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            )}
            {running
              ? simulating && picks.length === 0
                ? "Simulating bracket..."
                : "Running..."
              : done
                ? "Run again"
                : "Run AI Survivor Picks"}
          </button>
        </div>

        {picks.length > 0 && (
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {picks.map((p) => (
              <div
                key={p.day}
                className="shrink-0 rounded border border-[#e8e8e8] bg-[#fafafa] px-2.5 py-1.5 text-left"
              >
                <div className="text-[9px] uppercase tracking-wider text-[#9a9c9e] font-medium">
                  Day {p.day}
                </div>
                <div className="text-[12px] font-medium text-[#121213] mt-0.5 whitespace-nowrap">
                  {p.team.name}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-[#6c6e6f]">
                  {Math.round(p.winProb * 100)}%
                </div>
              </div>
            ))}
          </div>
        )}

        {done && picks.length > 0 && (
          <div className="mt-3 rounded-lg bg-[#f0fdf4] border border-green-200 px-3 py-2">
            <span className="text-[12px] font-medium text-green-800">
              Overall survival probability:{" "}
              <span className="font-bold font-mono">
                {(overallProb * 100).toFixed(2)}%
              </span>
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          {error}
        </div>
      )}

      {/* Simulation status */}
      {simulating && (
        <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="h-5 w-5 rounded-full border-2 border-[#c8102e] border-t-transparent animate-spin shrink-0" />
            <div>
              <div className="text-[14px] font-semibold text-[#121213]">
                {simRound
                  ? `Simulating bracket \u2014 ${simRound} complete`
                  : "Simulating full bracket\u2026"}
              </div>
              <div className="text-[12px] text-[#6c6e6f] mt-0.5">
                {picks.length > 0
                  ? "Survivor picks run in parallel as each round completes."
                  : "KenPom, historical matchups, geographic advantage, upset calibration. Picks start as rounds complete."}
              </div>
            </div>
          </div>
        </div>
      )}

      {simResult && !simulating && (
        <div className="bg-white rounded-lg border border-[#dcdddf] px-4 py-3">
          <div className="text-[12px] font-medium text-[#6c6e6f]">
            Bracket simulation complete &mdash; predicted champion:{" "}
            <span className="font-bold text-[#121213]">
              {simResult.winner.name}
            </span>{" "}
            (#{simResult.winner.seed} seed) with{" "}
            <span className="font-bold text-[#121213]">
              {simResult.upsets}
            </span>{" "}
            upset{simResult.upsets !== 1 ? "s" : ""}.
          </div>
        </div>
      )}

      {/* Pick cards */}
      <div className="space-y-3">
        {picks.map((pick) => (
          <PickCard key={pick.day} pick={pick} />
        ))}
        {thinkingDay && (
          <ThinkingCard
            day={thinkingDay.day}
            roundName={thinkingDay.roundName}
          />
        )}
        {elimination && (
          <div className="bg-white rounded-lg border border-amber-300 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-amber-200 bg-amber-50">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-white text-[12px] font-bold shrink-0">
                {elimination.day}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-amber-900">
                  Survivor Pool Over &mdash; Day {elimination.day}
                </div>
                <div className="text-[10px] text-amber-700">
                  {elimination.roundName}
                </div>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-[13px] text-amber-800">
                {elimination.reason}
              </p>
              <p className="text-[12px] text-amber-600 mt-1.5">
                Survived through {picks.length} of 10 days ({picks.length}{" "}
                pick{picks.length !== 1 ? "s" : ""} made).
              </p>
            </div>
          </div>
        )}
      </div>

      {!running && !done && picks.length === 0 && (
        <div className="bg-white rounded-lg border border-[#dcdddf] p-8 text-center">
          <div className="text-[40px] mb-3">🏀</div>
          <p className="text-[14px] text-[#6c6e6f]">
            Click &ldquo;Run AI Survivor Picks&rdquo; to watch an AI analyst
            reason through each day of the tournament and make survivor pool
            selections.
          </p>
        </div>
      )}
    </div>
  );
}
