import type { SimulatedBracket, Team } from "@/lib/bracket-data";
import { BRACKET_2026 } from "@/lib/bracket-data";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

// ── Types ──────────────────────────────────────────────────────────

export interface TeamLeaderboardStats {
  teamId: number;
  teamName: string;
  seed: number;
  region: string;
  conference: string;
  champion: number;
  championship: number; // appeared in championship game
  finalFour: number;
  elite8: number;
  sweet16: number;
  round32: number;
  totalWins: number;
  totalGames: number;
  upsetWins: number;
  upsetLosses: number;
}

export interface LeaderboardData {
  totalSimulations: number;
  teams: TeamLeaderboardStats[];
}

// ── Extract results from a completed bracket ───────────────────────

interface TeamResult {
  wins: number;
  games: number;
  upsetWins: number;
  upsetLosses: number;
  furthestRound: number; // 0=lost R64, 1=R32, 2=S16, 3=E8, 4=FF, 5=championship game, 6=champion
}

export function extractTeamResults(
  bracket: SimulatedBracket
): Map<number, TeamResult> {
  const results = new Map<number, TeamResult>();

  function ensureTeam(team: Team): TeamResult {
    if (!results.has(team.id)) {
      results.set(team.id, {
        wins: 0,
        games: 0,
        upsetWins: 0,
        upsetLosses: 0,
        furthestRound: 0,
      });
    }
    return results.get(team.id)!;
  }

  function recordGame(
    winner: Team,
    loser: Team,
    roundLevel: number
  ) {
    const w = ensureTeam(winner);
    const l = ensureTeam(loser);

    w.wins++;
    w.games++;
    l.games++;

    w.furthestRound = Math.max(w.furthestRound, roundLevel);

    if (winner.seed > loser.seed) {
      w.upsetWins++;
      l.upsetLosses++;
    }
  }

  // First Four (roundLevel 0 - just counts as a game, winner enters R64)
  for (const game of bracket.firstFour) {
    if (game.winner && game.team1.seed > 0 && game.team2.seed > 0) {
      const winner = game.winner === 1 ? game.team1 : game.team2;
      const loser = game.winner === 1 ? game.team2 : game.team1;
      recordGame(winner, loser, 0);
    }
  }

  // Regional rounds
  // Round index 0 = R64, 1 = R32, 2 = S16, 3 = E8
  // roundLevel: winning R64 = 1 (made R32), winning R32 = 2 (made S16), etc.
  for (const region of bracket.regions) {
    for (let roundIdx = 0; roundIdx < region.rounds.length; roundIdx++) {
      const round = region.rounds[roundIdx];
      for (const game of round) {
        if (game.winner && game.team1.seed > 0 && game.team2.seed > 0) {
          const winner = game.winner === 1 ? game.team1 : game.team2;
          const loser = game.winner === 1 ? game.team2 : game.team1;
          recordGame(winner, loser, roundIdx + 1); // R64 win = 1, R32 win = 2, S16 win = 3, E8 win = 4
        }
      }
    }
  }

  // Final Four (roundLevel 5 = made championship game)
  for (const game of bracket.finalFour) {
    if (game.winner && game.team1.seed > 0 && game.team2.seed > 0) {
      const winner = game.winner === 1 ? game.team1 : game.team2;
      const loser = game.winner === 1 ? game.team2 : game.team1;
      recordGame(winner, loser, 5);
    }
  }

  // Championship (roundLevel 6 = champion)
  if (
    bracket.championship &&
    bracket.championship.winner &&
    bracket.championship.team1.seed > 0 &&
    bracket.championship.team2.seed > 0
  ) {
    const winner =
      bracket.championship.winner === 1
        ? bracket.championship.team1
        : bracket.championship.team2;
    const loser =
      bracket.championship.winner === 1
        ? bracket.championship.team2
        : bracket.championship.team1;
    recordGame(winner, loser, 6);
  }

  return results;
}

// ── Convert TeamResult map to Convex-compatible increments ─────────

export function teamResultsToIncrements(
  teamResults: Map<number, TeamResult>
): Array<{
  teamId: number;
  wins: number;
  games: number;
  upsetWins: number;
  upsetLosses: number;
  round32: number;
  sweet16: number;
  elite8: number;
  finalFour: number;
  championship: number;
  champion: number;
}> {
  return Array.from(teamResults.entries()).map(([teamId, result]) => ({
    teamId,
    wins: result.wins,
    games: result.games,
    upsetWins: result.upsetWins,
    upsetLosses: result.upsetLosses,
    round32: result.furthestRound >= 1 ? 1 : 0,
    sweet16: result.furthestRound >= 2 ? 1 : 0,
    elite8: result.furthestRound >= 3 ? 1 : 0,
    finalFour: result.furthestRound >= 4 ? 1 : 0,
    championship: result.furthestRound >= 5 ? 1 : 0,
    champion: result.furthestRound >= 6 ? 1 : 0,
  }));
}

// ── Save simulation results to Convex ─────────────────────────────

export async function saveSimulationResults(
  bracket: SimulatedBracket
): Promise<void> {
  const client = getConvexClient();
  const teamResults = extractTeamResults(bracket);
  const teamIncrements = teamResultsToIncrements(teamResults);

  await client.mutation(api.leaderboard.recordResults, {
    simulationCount: 1,
    teamIncrements,
  });
}

// ── Read leaderboard stats from Convex ────────────────────────────

export async function getLeaderboardStats(): Promise<LeaderboardData> {
  const client = getConvexClient();
  const raw = await client.query(api.leaderboard.getLeaderboard);

  if (raw.totalSimulations === 0 || raw.teams.length === 0) {
    return { totalSimulations: 0, teams: [] };
  }

  const teamMeta = new Map<
    number,
    { name: string; seed: number; region: string; conference: string }
  >();

  for (const region of BRACKET_2026.regions) {
    for (const round of region.rounds) {
      for (const game of round) {
        for (const team of [game.team1, game.team2]) {
          if (team.id > 0 && !teamMeta.has(team.id)) {
            teamMeta.set(team.id, {
              name: team.name,
              seed: team.seed,
              region: region.name,
              conference: team.conference ?? "Other",
            });
          }
        }
      }
    }
  }
  // Also include First Four teams
  for (const game of BRACKET_2026.firstFour) {
    for (const team of [game.team1, game.team2]) {
      if (team.id > 0 && !teamMeta.has(team.id)) {
        teamMeta.set(team.id, {
          name: team.name,
          seed: team.seed,
          region: "FIRST FOUR",
          conference: team.conference ?? "Other",
        });
      }
    }
  }

  const teams: TeamLeaderboardStats[] = raw.teams
    .map((t) => {
      const meta = teamMeta.get(t.teamId);
      if (!meta) return null;

      return {
        teamId: t.teamId,
        teamName: meta.name,
        seed: meta.seed,
        region: meta.region,
        conference: meta.conference,
        champion: t.champion,
        championship: t.championship,
        finalFour: t.finalFour,
        elite8: t.elite8,
        sweet16: t.sweet16,
        round32: t.round32,
        totalWins: t.wins,
        totalGames: t.games,
        upsetWins: t.upsetWins,
        upsetLosses: t.upsetLosses,
      };
    })
    .filter((t): t is TeamLeaderboardStats => t !== null);

  teams.sort(
    (a, b) =>
      b.totalWins - a.totalWins ||
      b.champion - a.champion ||
      a.teamId - b.teamId
  );

  return { totalSimulations: raw.totalSimulations, teams };
}
