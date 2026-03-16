"use client";

import { useState, useEffect, useCallback } from "react";
import { getTeamLogoUrl } from "@/lib/bracket-data";

interface RunPick {
  day: number;
  teamName: string;
  teamId: number;
  teamSeed: number;
  opponentName: string;
  winProb: number;
}

interface LeaderboardRun {
  id: string;
  rank: number;
  overallSurvivalProb: number;
  createdAt: number;
  picks: RunPick[];
}

interface TeamPopularity {
  teamName: string;
  teamId: number;
  teamSeed: number;
  totalPicks: number;
  pickRate: number;
}

interface DayStat {
  day: number;
  teams: Array<{
    teamName: string;
    teamId: number;
    teamSeed: number;
    pickCount: number;
    pickRate: number;
  }>;
}

interface LeaderboardData {
  totalRuns: number;
  avgSurvivalProb: number;
  bestRun: LeaderboardRun | null;
  worstRun: LeaderboardRun | null;
  recentRuns: LeaderboardRun[];
  rankedRuns: LeaderboardRun[];
  teamPopularity: TeamPopularity[];
  dayStats: DayStat[];
}

type RunsView = "ranked" | "recent";

function TeamLogo({ teamId, name, size = 6 }: { teamId: number; name: string; size?: number }) {
  const [error, setError] = useState(false);
  if (error || teamId <= 0) {
    return (
      <div
        className="rounded bg-[#e0e0e0] flex items-center justify-center text-[8px] font-bold text-[#6c6e6f]"
        style={{ width: `${size * 4}px`, height: `${size * 4}px` }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={getTeamLogoUrl(teamId, 48)}
      alt={name}
      width={48}
      height={48}
      className="h-full w-full object-contain"
      onError={() => setError(true)}
    />
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[#dcdddf] bg-white p-4">
      <div className="text-[10px] uppercase tracking-wider text-[#6c6e6f] font-medium">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-bold text-[#121213] tabular-nums font-mono">
        {value}
      </div>
      {sub && <div className="text-[11px] text-[#9a9c9e] mt-0.5">{sub}</div>}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RunRow({
  run,
  rank,
  expanded,
  onToggle,
}: {
  run: LeaderboardRun;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pct = (run.overallSurvivalProb * 100).toFixed(2);
  const topPicks = run.picks.slice(0, 3);

  return (
    <>
      <tr
        className="border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 text-center">
          <span className="text-[12px] font-mono tabular-nums text-[#6c6e6f]">
            {rank}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1 overflow-hidden">
            {topPicks.map((p) => (
              <div key={p.day} className="w-5 h-5 shrink-0">
                <TeamLogo teamId={p.teamId} name={p.teamName} size={5} />
              </div>
            ))}
            {run.picks.length > 3 && (
              <span className="text-[10px] text-[#9a9c9e] ml-0.5">
                +{run.picks.length - 3}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-[13px] font-mono tabular-nums font-semibold text-[#121213]">
            {pct}%
          </span>
        </td>
        <td className="px-3 py-2.5 text-right hidden sm:table-cell">
          <span className="text-[11px] text-[#9a9c9e]">
            {formatTimeAgo(run.createdAt)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-center w-8">
          <span className="text-[11px] text-[#9a9c9e]">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[#f0f0f0]">
          <td colSpan={5} className="px-3 py-3 bg-[#fafafa]">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {run.picks.map((p) => (
                <div
                  key={p.day}
                  className="shrink-0 rounded border border-[#e8e8e8] bg-white px-2.5 py-1.5 text-left"
                >
                  <div className="text-[9px] uppercase tracking-wider text-[#9a9c9e] font-medium">
                    Day {p.day}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-5 h-5 shrink-0">
                      <TeamLogo teamId={p.teamId} name={p.teamName} size={5} />
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-[#121213] whitespace-nowrap">
                        {p.teamName}
                      </div>
                      <div className="text-[9px] text-[#9a9c9e]">
                        vs {p.opponentName} &middot; {Math.round(p.winProb * 100)}%
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DayPicksGrid({ dayStats, totalRuns }: { dayStats: DayStat[]; totalRuns: number }) {
  if (dayStats.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#dcdddf] bg-[#fafafa]">
        <h3 className="text-[13px] font-semibold text-[#121213]">
          Most Popular Pick by Day
        </h3>
        <p className="text-[10px] text-[#9a9c9e] mt-0.5">
          Top AI pick for each tournament day across {totalRuns.toLocaleString()} run{totalRuns === 1 ? "" : "s"}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 divide-x divide-y divide-[#f0f0f0]">
        {dayStats.map((day) => {
          const top = day.teams[0];
          if (!top) return null;
          const pct = Math.round(top.pickRate * 100);
          return (
            <div key={day.day} className="px-3 py-3 text-center">
              <div className="text-[9px] uppercase tracking-wider text-[#9a9c9e] font-medium">
                Day {day.day}
              </div>
              <div className="w-8 h-8 mx-auto mt-1.5">
                <TeamLogo teamId={top.teamId} name={top.teamName} size={8} />
              </div>
              <div className="text-[11px] font-medium text-[#121213] mt-1 truncate">
                {top.teamName}
              </div>
              <div className="text-[10px] font-mono tabular-nums text-[#c8102e] font-semibold">
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamPopularityTable({ teams, totalRuns }: { teams: TeamPopularity[]; totalRuns: number }) {
  if (teams.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#dcdddf] bg-[#fafafa]">
        <h3 className="text-[13px] font-semibold text-[#121213]">
          Most Picked Teams
        </h3>
        <p className="text-[10px] text-[#9a9c9e] mt-0.5">
          Teams the AI selects most frequently across all days
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#dcdddf] text-[10px] uppercase tracking-wider text-[#6c6e6f]">
              <th className="px-4 py-2 font-medium w-10 text-center">#</th>
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-4 py-2 font-medium text-right">Times Picked</th>
              <th className="px-4 py-2 font-medium text-right">Frequency</th>
            </tr>
          </thead>
          <tbody>
            {teams.slice(0, 15).map((team, idx) => {
              const freqPct = Math.round(team.pickRate * 100);
              const maxPicks = teams[0]!.totalPicks;
              const barWidth = maxPicks > 0 ? (team.totalPicks / maxPicks) * 100 : 0;
              return (
                <tr
                  key={team.teamName}
                  className="border-b border-[#f0f0f0] hover:bg-[#fafafa] transition-colors"
                >
                  <td className="px-4 py-2.5 text-center text-[12px] font-mono tabular-nums text-[#6c6e6f]">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 shrink-0">
                        <TeamLogo teamId={team.teamId} name={team.teamName} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-[#121213]">
                          {team.teamName}
                        </div>
                        <div className="text-[10px] text-[#9a9c9e]">
                          #{team.teamSeed} seed
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-[13px] font-mono tabular-nums font-semibold text-[#121213]">
                      {team.totalPicks}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-[5px] rounded-full bg-[#eee] overflow-hidden hidden sm:block">
                        <div
                          className="h-full rounded-full bg-[#c8102e] transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="text-[12px] font-mono tabular-nums text-[#6c6e6f]">
                        {freqPct}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SurvivorLeaderboard() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [runsView, setRunsView] = useState<RunsView>("ranked");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/survivor/stats?view=leaderboard");
      if (res.ok) {
        const d: LeaderboardData = await res.json();
        setData(d);
      }
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-[#dcdddf] p-6">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 rounded-full border-2 border-[#6c6e6f] border-t-transparent animate-spin" />
          <p className="text-[13px] text-[#6c6e6f]">Loading leaderboard...</p>
        </div>
      </div>
    );
  }

  if (!data || data.totalRuns === 0) {
    return null;
  }

  const runs = runsView === "ranked" ? data.rankedRuns : data.recentRuns;

  return (
    <div className="space-y-4">
      {/* Insight cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total AI Runs"
          value={data.totalRuns.toLocaleString()}
          sub="completed simulations"
        />
        <StatCard
          label="Avg Survival Prob"
          value={`${(data.avgSurvivalProb * 100).toFixed(2)}%`}
          sub="across all runs"
        />
        {data.bestRun && (
          <StatCard
            label="Best Run"
            value={`${(data.bestRun.overallSurvivalProb * 100).toFixed(2)}%`}
            sub={data.bestRun.picks[0]
              ? `Led by ${data.bestRun.picks[0].teamName}`
              : undefined}
          />
        )}
        {data.worstRun && (
          <StatCard
            label="Worst Run"
            value={`${(data.worstRun.overallSurvivalProb * 100).toFixed(2)}%`}
            sub={data.worstRun.picks[0]
              ? `Led by ${data.worstRun.picks[0].teamName}`
              : undefined}
          />
        )}
      </div>

      {/* Day picks grid */}
      <DayPicksGrid dayStats={data.dayStats} totalRuns={data.totalRuns} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Runs table */}
        <div className="bg-white rounded-lg border border-[#dcdddf] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#dcdddf] bg-[#fafafa]">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#121213]">
                AI Runs
              </h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setRunsView("ranked")}
                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                    runsView === "ranked"
                      ? "bg-[#121213] text-white"
                      : "bg-[#eee] text-[#6c6e6f] hover:text-[#121213]"
                  }`}
                >
                  Best
                </button>
                <button
                  type="button"
                  onClick={() => setRunsView("recent")}
                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                    runsView === "recent"
                      ? "bg-[#121213] text-white"
                      : "bg-[#eee] text-[#6c6e6f] hover:text-[#121213]"
                  }`}
                >
                  Recent
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#dcdddf] text-[10px] uppercase tracking-wider text-[#6c6e6f]">
                  <th className="px-3 py-2 font-medium w-10 text-center">
                    {runsView === "ranked" ? "#" : "#"}
                  </th>
                  <th className="px-3 py-2 font-medium">Picks</th>
                  <th className="px-3 py-2 font-medium text-right">Survival</th>
                  <th className="px-3 py-2 font-medium text-right hidden sm:table-cell">
                    When
                  </th>
                  <th className="px-3 py-2 font-medium w-8" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run, idx) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    rank={runsView === "ranked" ? run.rank : idx + 1}
                    expanded={expandedRun === run.id}
                    onToggle={() =>
                      setExpandedRun(expandedRun === run.id ? null : run.id)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Team popularity */}
        <TeamPopularityTable
          teams={data.teamPopularity}
          totalRuns={data.totalRuns}
        />
      </div>
    </div>
  );
}
