import { BRACKET_2026 } from "@/lib/bracket-data";
import { computeSurvivorRankings } from "@/lib/survivor/survivor-strategy";
import { TOURNAMENT_DAYS } from "@/lib/survivor/tournament-days";
import {
  makeAISurvivorPick,
  type AISurvivorPick,
} from "@/lib/survivor/ai-survivor-pick";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const runPicks = async () => {
    const rankings = computeSurvivorRankings(BRACKET_2026);
    const rankingMap = new Map(rankings.map((r) => [r.day, r]));
    const usedTeams: string[] = [];
    const picks: AISurvivorPick[] = [];

    for (const day of TOURNAMENT_DAYS) {
      const ranking = rankingMap.get(day.day);
      if (!ranking || ranking.teams.length === 0) {
        const skipPayload = JSON.stringify({
          type: "skip",
          day: day.day,
          reason: "Matchups not yet determined",
        });
        await writer.write(skipPayload + "\n");
        continue;
      }

      const startPayload = JSON.stringify({
        type: "thinking",
        day: day.day,
        date: day.date,
        roundName: ranking.roundName,
      });
      await writer.write(startPayload + "\n");

      try {
        const remainingDays = 10 - picks.length;
        const pick = await makeAISurvivorPick(
          day,
          ranking,
          usedTeams,
          picks,
          remainingDays
        );

        usedTeams.push(pick.team.name);
        picks.push(pick);

        const pickPayload = JSON.stringify({
          type: "pick",
          day: pick.day,
          date: pick.date,
          roundName: pick.roundName,
          team: {
            id: pick.team.id,
            name: pick.team.name,
            seed: pick.team.seed,
            conference: pick.team.conference,
          },
          opponent: {
            id: pick.opponent.id,
            name: pick.opponent.name,
            seed: pick.opponent.seed,
          },
          winProb: pick.winProb,
          reasoning: pick.reasoning,
        });
        await writer.write(pickPayload + "\n");
      } catch (e) {
        const errorPayload = JSON.stringify({
          type: "error",
          day: day.day,
          error: e instanceof Error ? e.message : "Unknown error",
        });
        await writer.write(errorPayload + "\n");
      }
    }

    if (picks.length > 0) {
      try {
        const convex = getConvexClient();
        const overallSurvivalProb = picks.reduce((acc, p) => acc * p.winProb, 1);
        await convex.mutation(api.survivor.recordSurvivorRun, {
          picks: picks.map((p) => ({
            day: p.day,
            teamName: p.team.name,
            teamId: p.team.id,
            teamSeed: p.team.seed,
            opponentName: p.opponent.name,
            winProb: p.winProb,
          })),
          overallSurvivalProb,
        });
      } catch (e) {
        console.error("Failed to persist survivor run to Convex:", e);
      }
    }

    const donePayload = JSON.stringify({
      type: "done",
      totalPicks: picks.length,
      picks: picks.map((p) => ({
        day: p.day,
        team: p.team.name,
        seed: p.team.seed,
        winProb: p.winProb,
      })),
    });
    await writer.write(donePayload + "\n");
    await writer.close();
  };

  runPicks().catch(async (e) => {
    try {
      const errPayload = JSON.stringify({
        type: "fatal",
        error: e instanceof Error ? e.message : "Fatal error",
      });
      await writer.write(errPayload + "\n");
      await writer.close();
    } catch {
      // writer already closed
    }
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
