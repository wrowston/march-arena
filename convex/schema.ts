import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  leaderboardMeta: defineTable({
    totalSimulations: v.number(),
  }),

  leaderboardTeamStats: defineTable({
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
  }).index("by_teamId", ["teamId"]),
});
