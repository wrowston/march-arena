import { BRACKET_2026 } from "@/lib/bracket-data";
import { simulateBracketLocally } from "@/lib/ai-pick";
import { computeSurvivorRankingsFromSim } from "@/lib/survivor/survivor-strategy";
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

  const runPicks = async () => {
    // Phase 1: Run full bracket simulation
    await writer.write(
      JSON.stringify({ type: "simulating" }) + "\n"
    );

    const simBracket = await simulateBracketLocally(BRACKET_2026);

    const upsetCount = simBracket.regions.reduce((acc, region) => {
      return (
        acc +
        region.rounds.flat().filter((g) => {
          if (!g.winner) return false;
          const winner = g.winner === 1 ? g.team1 : g.team2;
          const loser = g.winner === 1 ? g.team2 : g.team1;
          return winner.seed > loser.seed;
        }).length
      );
    }, 0);

    await writer.write(
      JSON.stringify({
        type: "simulation_complete",
        winner: {
          id: simBracket.winner.id,
          name: simBracket.winner.name,
          seed: simBracket.winner.seed,
        },
        upsets: upsetCount,
      }) + "\n"
    );

    // Phase 2: Derive survivor picks from simulation results
    const rankings = computeSurvivorRankingsFromSim(simBracket);
    const rankingMap = new Map(rankings.map((r) => [r.day, r]));
    const usedTeams: string[] = [];
    const picks: AISurvivorPick[] = [];

    let eliminated = false;

    for (const day of TOURNAMENT_DAYS) {
      if (eliminated) break;

      const ranking = rankingMap.get(day.day);
      if (!ranking || ranking.teams.length === 0) {
        await writer.write(
          JSON.stringify({
            type: "skip",
            day: day.day,
            reason: "No simulation results for this day",
          }) + "\n"
        );
        continue;
      }

      const hasAvailable = ranking.teams.some(
        (t) => !usedTeams.includes(t.team.name)
      );
      if (!hasAvailable) {
        await writer.write(
          JSON.stringify({
            type: "eliminated",
            day: day.day,
            roundName: ranking.roundName,
            reason:
              "All winning teams for this day were already used. Survivor pool is over.",
          }) + "\n"
        );
        eliminated = true;
        break;
      }

      await writer.write(
        JSON.stringify({
          type: "thinking",
          day: day.day,
          date: day.date,
          roundName: ranking.roundName,
        }) + "\n"
      );

      try {
        const remainingDays = 10 - picks.length;
        const pick = await makeAISurvivorPick(
          day,
          ranking,
          usedTeams,
          picks,
          remainingDays
        );

        if (!pick) {
          await writer.write(
            JSON.stringify({
              type: "eliminated",
              day: day.day,
              roundName: ranking.roundName,
              reason:
                "No available winners remaining. Survivor pool is over.",
            }) + "\n"
          );
          eliminated = true;
          break;
        }

        usedTeams.push(pick.team.name);
        picks.push(pick);

        await writer.write(
          JSON.stringify({
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
          }) + "\n"
        );
      } catch (e) {
        await writer.write(
          JSON.stringify({
            type: "error",
            day: day.day,
            error: e instanceof Error ? e.message : "Unknown error",
          }) + "\n"
        );
      }
    }

    // Phase 3: Persist to Convex
    if (picks.length > 0) {
      try {
        const convex = getConvexClient();
        const overallSurvivalProb = picks.reduce(
          (acc, p) => acc * p.winProb,
          1
        );
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

    await writer.write(
      JSON.stringify({
        type: "done",
        totalPicks: picks.length,
        picks: picks.map((p) => ({
          day: p.day,
          team: p.team.name,
          seed: p.team.seed,
          winProb: p.winProb,
        })),
      }) + "\n"
    );
    await writer.close();
  };

  runPicks().catch(async (e) => {
    try {
      await writer.write(
        JSON.stringify({
          type: "fatal",
          error: e instanceof Error ? e.message : "Fatal error",
        }) + "\n"
      );
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
