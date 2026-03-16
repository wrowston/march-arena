import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const pickValidator = v.object({
  day: v.number(),
  teamName: v.string(),
  teamId: v.number(),
  teamSeed: v.number(),
  opponentName: v.string(),
  winProb: v.number(),
});

export const recordSurvivorRun = mutation({
  args: {
    picks: v.array(pickValidator),
    overallSurvivalProb: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("survivorRuns", {
      picks: args.picks,
      overallSurvivalProb: args.overallSurvivalProb,
      createdAt: Date.now(),
    });

    for (const pick of args.picks) {
      const existing = await ctx.db
        .query("survivorPickStats")
        .withIndex("by_day_team", (q) =>
          q.eq("day", pick.day).eq("teamName", pick.teamName)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          pickCount: existing.pickCount + 1,
        });
      } else {
        await ctx.db.insert("survivorPickStats", {
          day: pick.day,
          teamName: pick.teamName,
          teamId: pick.teamId,
          teamSeed: pick.teamSeed,
          pickCount: 1,
        });
      }
    }
  },
});

export const getSurvivorStats = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("survivorRuns").collect();
    const pickStats = await ctx.db.query("survivorPickStats").collect();

    const totalRuns = runs.length;

    const statsByDay = new Map<
      number,
      Array<{
        teamName: string;
        teamId: number;
        teamSeed: number;
        pickCount: number;
      }>
    >();

    for (const stat of pickStats) {
      const dayStats = statsByDay.get(stat.day) ?? [];
      dayStats.push({
        teamName: stat.teamName,
        teamId: stat.teamId,
        teamSeed: stat.teamSeed,
        pickCount: stat.pickCount,
      });
      statsByDay.set(stat.day, dayStats);
    }

    const days: Array<{
      day: number;
      teams: Array<{
        teamName: string;
        teamId: number;
        teamSeed: number;
        pickCount: number;
        pickRate: number;
      }>;
    }> = [];

    for (const [day, teams] of statsByDay) {
      teams.sort((a, b) => b.pickCount - a.pickCount);
      days.push({
        day,
        teams: teams.map((t) => ({
          ...t,
          pickRate: totalRuns > 0 ? t.pickCount / totalRuns : 0,
        })),
      });
    }

    days.sort((a, b) => a.day - b.day);

    return { totalRuns, days };
  },
});

export const getSurvivorLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("survivorRuns").collect();
    const pickStats = await ctx.db.query("survivorPickStats").collect();

    const totalRuns = runs.length;

    const recentRuns = runs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((run, idx) => ({
        id: run._id,
        rank: idx + 1,
        overallSurvivalProb: run.overallSurvivalProb,
        createdAt: run.createdAt,
        picks: run.picks,
      }));

    const rankedRuns = runs
      .sort((a, b) => b.overallSurvivalProb - a.overallSurvivalProb)
      .map((run, idx) => ({
        id: run._id,
        rank: idx + 1,
        overallSurvivalProb: run.overallSurvivalProb,
        createdAt: run.createdAt,
        picks: run.picks,
      }));

    const teamTotalPicks = new Map<string, { teamName: string; teamId: number; teamSeed: number; totalPicks: number }>();
    for (const stat of pickStats) {
      const existing = teamTotalPicks.get(stat.teamName);
      if (existing) {
        existing.totalPicks += stat.pickCount;
      } else {
        teamTotalPicks.set(stat.teamName, {
          teamName: stat.teamName,
          teamId: stat.teamId,
          teamSeed: stat.teamSeed,
          totalPicks: stat.pickCount,
        });
      }
    }

    const teamPopularity = [...teamTotalPicks.values()]
      .sort((a, b) => b.totalPicks - a.totalPicks)
      .map((t) => ({
        ...t,
        pickRate: totalRuns > 0 ? t.totalPicks / (totalRuns * 10) : 0,
      }));

    const dayStats: Array<{
      day: number;
      teams: Array<{
        teamName: string;
        teamId: number;
        teamSeed: number;
        pickCount: number;
        pickRate: number;
      }>;
    }> = [];

    const statsByDay = new Map<number, typeof pickStats>();
    for (const stat of pickStats) {
      const arr = statsByDay.get(stat.day) ?? [];
      arr.push(stat);
      statsByDay.set(stat.day, arr);
    }

    for (const [day, teams] of statsByDay) {
      teams.sort((a, b) => b.pickCount - a.pickCount);
      dayStats.push({
        day,
        teams: teams.map((t) => ({
          teamName: t.teamName,
          teamId: t.teamId,
          teamSeed: t.teamSeed,
          pickCount: t.pickCount,
          pickRate: totalRuns > 0 ? t.pickCount / totalRuns : 0,
        })),
      });
    }
    dayStats.sort((a, b) => a.day - b.day);

    const avgSurvivalProb =
      totalRuns > 0
        ? runs.reduce((sum, r) => sum + r.overallSurvivalProb, 0) / totalRuns
        : 0;

    const bestRun = rankedRuns[0] ?? null;
    const worstRun = rankedRuns.length > 0 ? rankedRuns[rankedRuns.length - 1]! : null;

    return {
      totalRuns,
      avgSurvivalProb,
      bestRun,
      worstRun,
      recentRuns: recentRuns.slice(0, 20),
      rankedRuns: rankedRuns.slice(0, 20),
      teamPopularity: teamPopularity.slice(0, 30),
      dayStats,
    };
  },
});
