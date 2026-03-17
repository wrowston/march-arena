import { BRACKET_2026 } from "@/lib/bracket-data";
import type { SimulatedGame } from "@/lib/bracket-data";
import { simulateBracketLocally } from "@/lib/ai-pick";
import { computeDayRankingFromResults } from "@/lib/survivor/survivor-strategy";
import {
  TOURNAMENT_DAYS,
  type SimDayGameResult,
  type TournamentDay,
} from "@/lib/survivor/tournament-days";
import {
  makeAISurvivorPick,
  type AISurvivorPick,
} from "@/lib/survivor/ai-survivor-pick";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export const maxDuration = 300;

const ROUND_SURVIVOR_DAYS: Record<string, number[]> = {
  "Round of 64": [1, 2],
  "Round of 32": [3, 4],
  "Sweet 16": [5, 6],
  "Elite 8": [7, 8],
  "Final Four": [9],
  "National Championship": [10],
};

const TOURNAMENT_DAYS_MAP = new Map(
  TOURNAMENT_DAYS.map((d) => [d.day, d])
);

function extractDayResults(
  day: TournamentDay,
  allResults: Map<string, SimulatedGame>
): SimDayGameResult[] {
  const ids = day.combinedPoolGameIds ?? day.gameIds;
  const results: SimDayGameResult[] = [];

  for (const gameId of ids) {
    const game = allResults.get(gameId);
    if (!game || !game.winner) continue;

    const winner = game.winner === 1 ? game.team1 : game.team2;
    const loser = game.winner === 1 ? game.team2 : game.team1;

    results.push({
      gameId: game.id,
      winner,
      loser,
      reasoning: game.reasoning ?? "",
    });
  }

  return results;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { modelId?: string } = {};
  try {
    body = await request.json();
  } catch {}

  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();

  // Serialized write queue — both the simulation callbacks and survivor pick
  // tasks write to the same stream, so all writes must go through this.
  let pendingWrite = Promise.resolve();
  function emit(payload: object) {
    const json = JSON.stringify(payload) + "\n";
    pendingWrite = pendingWrite.then(() => writer.write(json));
    return pendingWrite;
  }

  const runPicks = async () => {
    await emit({ type: "simulating" });

    const usedTeams: string[] = [];
    const picks: AISurvivorPick[] = [];
    let eliminated = false;
    // Chain of survivor batches — each batch waits for the previous one so
    // that usedTeams / picks state is consistent across batches.
    let survivorChain = Promise.resolve();

    async function processSurvivorDays(
      dayNumbers: number[],
      allResults: Map<string, SimulatedGame>
    ) {
      for (const dayNum of dayNumbers) {
        if (eliminated) break;

        const day = TOURNAMENT_DAYS_MAP.get(dayNum);
        if (!day) continue;

        const gameResults = extractDayResults(day, allResults);
        if (gameResults.length === 0) {
          await emit({
            type: "skip",
            day: dayNum,
            reason: "No simulation results for this day",
          });
          continue;
        }

        const ranking = computeDayRankingFromResults(gameResults, day);

        const hasAvailable = ranking.teams.some(
          (t) => !usedTeams.includes(t.team.name)
        );
        if (!hasAvailable) {
          await emit({
            type: "eliminated",
            day: dayNum,
            roundName: ranking.roundName,
            reason:
              "All winning teams for this day were already used. Survivor pool is over.",
          });
          eliminated = true;
          break;
        }

        await emit({
          type: "thinking",
          day: dayNum,
          date: day.date,
          roundName: ranking.roundName,
        });

        try {
          const remainingDays = 10 - picks.length;
          const pick = await makeAISurvivorPick(
            day,
            ranking,
            usedTeams,
            picks,
            remainingDays,
            body.modelId
          );

          if (!pick) {
            await emit({
              type: "eliminated",
              day: dayNum,
              roundName: ranking.roundName,
              reason:
                "No available winners remaining. Survivor pool is over.",
            });
            eliminated = true;
            break;
          }

          usedTeams.push(pick.team.name);
          picks.push(pick);

          await emit({
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
        } catch (e) {
          await emit({
            type: "error",
            day: dayNum,
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      }
    }

    // Run the bracket simulation with round-complete callbacks that fire
    // survivor picks in parallel with the next round's simulation.
    const simBracket = await simulateBracketLocally(BRACKET_2026, {
      onRoundComplete: (roundLabel, allResults) => {
        const dayNumbers = ROUND_SURVIVOR_DAYS[roundLabel];
        if (!dayNumbers || eliminated) return;

        // Each batch chains onto the previous one so usedTeams/picks
        // state is consistent. The simulation continues in parallel.
        survivorChain = survivorChain
          .then(() => emit({ type: "round_complete", round: roundLabel }))
          .then(() => processSurvivorDays(dayNumbers, allResults));
      },
    }, body.modelId);

    // Wait for any survivor picks still in flight from the last callback
    await survivorChain;

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

    await emit({
      type: "simulation_complete",
      winner: {
        id: simBracket.winner.id,
        name: simBracket.winner.name,
        seed: simBracket.winner.seed,
      },
      upsets: upsetCount,
    });

    // Persist to Convex
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

    await emit({
      type: "done",
      totalPicks: picks.length,
      picks: picks.map((p) => ({
        day: p.day,
        team: p.team.name,
        seed: p.team.seed,
        winProb: p.winProb,
      })),
    });
    await writer.close();
  };

  runPicks().catch(async (e) => {
    try {
      await emit({
        type: "fatal",
        error: e instanceof Error ? e.message : "Fatal error",
      });
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
