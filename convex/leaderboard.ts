import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

const teamIncrementValidator = v.object({
  teamId: v.number(),
  wins: v.number(),
  games: v.number(),
  upsetWins: v.number(),
  upsetLosses: v.number(),
  round32: v.number(),
  sweet16: v.number(),
  elite8: v.number(),
  finalFour: v.number(),
  championship: v.number(),
  champion: v.number(),
});

export const recordResults = mutation({
  args: {
    simulationCount: v.number(),
    teamIncrements: v.array(teamIncrementValidator),
  },
  handler: async (ctx, args) => {
    const meta = await ctx.db.query("leaderboardMeta").first();
    if (meta) {
      await ctx.db.patch(meta._id, {
        totalSimulations: meta.totalSimulations + args.simulationCount,
      });
    } else {
      await ctx.db.insert("leaderboardMeta", {
        totalSimulations: args.simulationCount,
      });
    }

    for (const inc of args.teamIncrements) {
      const existing = await ctx.db
        .query("leaderboardTeamStats")
        .withIndex("by_teamId", (q) => q.eq("teamId", inc.teamId))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          wins: existing.wins + inc.wins,
          games: existing.games + inc.games,
          upsetWins: existing.upsetWins + inc.upsetWins,
          upsetLosses: existing.upsetLosses + inc.upsetLosses,
          round32: existing.round32 + inc.round32,
          sweet16: existing.sweet16 + inc.sweet16,
          elite8: existing.elite8 + inc.elite8,
          finalFour: existing.finalFour + inc.finalFour,
          championship: existing.championship + inc.championship,
          champion: existing.champion + inc.champion,
        });
      } else {
        await ctx.db.insert("leaderboardTeamStats", {
          teamId: inc.teamId,
          wins: inc.wins,
          games: inc.games,
          upsetWins: inc.upsetWins,
          upsetLosses: inc.upsetLosses,
          round32: inc.round32,
          sweet16: inc.sweet16,
          elite8: inc.elite8,
          finalFour: inc.finalFour,
          championship: inc.championship,
          champion: inc.champion,
        });
      }
    }
  },
});

export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db.query("leaderboardMeta").first();
    const teams = await ctx.db.query("leaderboardTeamStats").collect();

    return {
      totalSimulations: meta?.totalSimulations ?? 0,
      teams: teams.map((t) => ({
        teamId: t.teamId,
        wins: t.wins,
        games: t.games,
        upsetWins: t.upsetWins,
        upsetLosses: t.upsetLosses,
        round32: t.round32,
        sweet16: t.sweet16,
        elite8: t.elite8,
        finalFour: t.finalFour,
        championship: t.championship,
        champion: t.champion,
      })),
    };
  },
});

export const resetLeaderboard = mutation({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db.query("leaderboardMeta").first();
    if (meta) await ctx.db.delete(meta._id);

    const teams = await ctx.db.query("leaderboardTeamStats").collect();
    for (const team of teams) {
      await ctx.db.delete(team._id);
    }

    return { deletedTeams: teams.length };
  },
});
