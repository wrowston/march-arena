/**
 * Seed the leaderboard with thousands of realistic probability-based simulations.
 *
 * Usage:
 *   pnpm tsx scripts/seed-leaderboard.ts [count]
 *
 * Requires CONVEX_URL in .env.local (loaded via dotenv inline).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// ── Load .env.local manually (no Next.js runtime) ─────────────────

const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local may not exist
}

// ── Inline types (avoid @/ import issues outside Next.js) ──────────

interface Team {
  id: number;
  name: string;
  abbreviation: string;
  seed: number;
  conference?: string;
  teamTier?: "blueblood" | "power" | "mid-major" | "low-major";
}

interface Game {
  id: string;
  status: "scheduled" | "in_progress" | "final";
  team1: Team;
  team2: Team;
  winner?: 1 | 2;
}

interface Region {
  name: string;
  rounds: Game[][];
}

interface Bracket {
  year: number;
  regions: Region[];
  finalFour: Game[];
  championship: Game | null;
  firstFour: Game[];
}

// ── Seed matchup probabilities (higher seed win rate) ──────────────

const SEED_WIN_RATES: Record<string, number> = {
  "1v16": 0.988,
  "2v15": 0.931,
  "3v14": 0.856,
  "4v13": 0.794,
  "5v12": 0.64,
  "6v11": 0.638,
  "7v10": 0.625,
  "8v9": 0.48,
};

const TIER_BONUS: Record<string, number> = {
  blueblood: 0.06,
  power: 0.02,
  "mid-major": -0.03,
  "low-major": -0.06,
};

function getMatchupKey(seed1: number, seed2: number): string {
  const higher = Math.min(seed1, seed2);
  const lower = Math.max(seed1, seed2);
  return `${higher}v${lower}`;
}

function winProbability(team1: Team, team2: Team, roundIdx: number): number {
  const key = getMatchupKey(team1.seed, team2.seed);
  const baseRate = SEED_WIN_RATES[key];

  if (baseRate !== undefined) {
    const team1IsHigherSeed = team1.seed <= team2.seed;
    let prob = team1IsHigherSeed ? baseRate : 1 - baseRate;

    const t1Bonus = TIER_BONUS[team1.teamTier ?? ""] ?? 0;
    const t2Bonus = TIER_BONUS[team2.teamTier ?? ""] ?? 0;
    prob += t1Bonus - t2Bonus;

    if (roundIdx >= 2) {
      prob += (t1Bonus - t2Bonus) * 0.5;
    }

    return Math.max(0.05, Math.min(0.95, prob));
  }

  const seedDiff = team2.seed - team1.seed;
  let prob = 0.5 + seedDiff * 0.02;

  const t1Bonus = TIER_BONUS[team1.teamTier ?? ""] ?? 0;
  const t2Bonus = TIER_BONUS[team2.teamTier ?? ""] ?? 0;
  prob += (t1Bonus - t2Bonus) * (1 + roundIdx * 0.3);

  return Math.max(0.15, Math.min(0.85, prob));
}

// ── Simulate one full tournament ───────────────────────────────────

interface TeamResultData {
  wins: number;
  games: number;
  upsetWins: number;
  upsetLosses: number;
  furthestRound: number;
}

interface SimResult {
  teamResults: Map<number, TeamResultData>;
  champion: Team | null;
}

function simulateOnce(bracket: Bracket): SimResult {
  const teamResults = new Map<number, TeamResultData>();

  function ensureTeam(team: Team) {
    if (!teamResults.has(team.id)) {
      teamResults.set(team.id, {
        wins: 0,
        games: 0,
        upsetWins: 0,
        upsetLosses: 0,
        furthestRound: 0,
      });
    }
    return teamResults.get(team.id)!;
  }

  function playGame(
    team1: Team,
    team2: Team,
    roundLevel: number
  ): { winner: Team; loser: Team } {
    const prob = winProbability(team1, team2, roundLevel);
    const team1Wins = Math.random() < prob;
    const winner = team1Wins ? team1 : team2;
    const loser = team1Wins ? team2 : team1;

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

    return { winner, loser };
  }

  // First Four
  const firstFourSlots: Array<{
    region: number;
    gameIndex: number;
    slot: 1 | 2;
  }> = [
    { region: 0, gameIndex: 0, slot: 2 },
    { region: 3, gameIndex: 4, slot: 2 },
    { region: 3, gameIndex: 0, slot: 2 },
    { region: 2, gameIndex: 4, slot: 2 },
  ];

  const firstFourWinners: Team[] = [];
  for (const game of bracket.firstFour) {
    if (game.team1.id > 0 && game.team2.id > 0) {
      const { winner } = playGame(game.team1, game.team2, 0);
      firstFourWinners.push(winner);
    }
  }

  const regionTeams: Team[][][] = bracket.regions.map((region, regionIdx) => {
    const games: [Team, Team][] = region.rounds[0].map((g) => [
      { ...g.team1 },
      { ...g.team2 },
    ]);

    firstFourSlots.forEach((slot, ffIdx) => {
      if (slot.region === regionIdx && firstFourWinners[ffIdx]) {
        if (slot.slot === 1) {
          games[slot.gameIndex][0] = firstFourWinners[ffIdx];
        } else {
          games[slot.gameIndex][1] = firstFourWinners[ffIdx];
        }
      }
    });

    return games;
  });

  const regionWinners: Team[] = [];
  for (let regionIdx = 0; regionIdx < 4; regionIdx++) {
    let currentMatchups = regionTeams[regionIdx];

    for (let roundIdx = 0; roundIdx < 4; roundIdx++) {
      const roundLevel = roundIdx + 1;
      const nextMatchups: [Team, Team][] = [];
      const winners: Team[] = [];

      for (const [t1, t2] of currentMatchups) {
        if (t1.id > 0 && t2.id > 0) {
          const { winner } = playGame(t1, t2, roundLevel);
          winners.push(winner);
        }
      }

      for (let i = 0; i < winners.length; i += 2) {
        if (i + 1 < winners.length) {
          nextMatchups.push([winners[i], winners[i + 1]]);
        }
      }
      currentMatchups = nextMatchups;

      if (roundIdx === 3 && winners.length > 0) {
        regionWinners.push(winners[0]);
      }
    }
  }

  // Final Four (2026 NCAA): East(1) vs South(0), West(2) vs Midwest(3)
  let champion: Team | null = null;
  if (regionWinners.length === 4) {
    const { winner: ff1Winner } = playGame(
      regionWinners[1],
      regionWinners[0],
      5
    );
    const { winner: ff2Winner } = playGame(
      regionWinners[2],
      regionWinners[3],
      5
    );

    const { winner: champ } = playGame(ff1Winner, ff2Winner, 6);
    champion = champ;
  }

  return { teamResults, champion };
}

// ── Accumulate results across multiple simulations ─────────────────

interface AccumulatedTeamStats {
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
}

function accumulateResults(
  accumulated: Map<number, AccumulatedTeamStats>,
  simResult: SimResult
) {
  for (const [teamId, result] of simResult.teamResults) {
    const existing = accumulated.get(teamId);
    if (existing) {
      existing.wins += result.wins;
      existing.games += result.games;
      existing.upsetWins += result.upsetWins;
      existing.upsetLosses += result.upsetLosses;
      if (result.furthestRound >= 1) existing.round32++;
      if (result.furthestRound >= 2) existing.sweet16++;
      if (result.furthestRound >= 3) existing.elite8++;
      if (result.furthestRound >= 4) existing.finalFour++;
      if (result.furthestRound >= 5) existing.championship++;
      if (result.furthestRound >= 6) existing.champion++;
    } else {
      accumulated.set(teamId, {
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
      });
    }
  }
}

// ── Main: run simulations and write to Convex ──────────────────────

async function main() {
  const count = parseInt(process.argv[2] ?? "5000", 10);
  const convexUrl = process.env.CONVEX_URL;

  if (!convexUrl) {
    console.error("CONVEX_URL not found in .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  console.log(`Connected to Convex. Running ${count} simulations...`);

  // Reset existing leaderboard data
  await client.mutation(api.leaderboard.resetLeaderboard);

  const bracketModule = await import("../lib/bracket-data");
  const bracket = bracketModule.BRACKET_2026 as unknown as Bracket;

  const BATCH_SIZE = 500;
  let completed = 0;

  for (let batch = 0; batch < count; batch += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, count - batch);
    const accumulated = new Map<number, AccumulatedTeamStats>();

    for (let i = 0; i < batchCount; i++) {
      const simResult = simulateOnce(bracket);
      accumulateResults(accumulated, simResult);
    }

    const teamIncrements = Array.from(accumulated.entries()).map(
      ([teamId, stats]) => ({ teamId, ...stats })
    );

    await client.mutation(api.leaderboard.recordResults, {
      simulationCount: batchCount,
      teamIncrements,
    });

    completed += batchCount;
    const pct = Math.round((completed / count) * 100);
    process.stdout.write(`\r  Progress: ${completed}/${count} (${pct}%)`);
  }

  console.log("\n  Done! Verifying...");

  const data = await client.query(api.leaderboard.getLeaderboard);
  console.log(`  Total simulations in Convex: ${data.totalSimulations}`);

  // Build team name lookup from bracket
  const teamNames = new Map<number, { name: string; seed: number }>();
  for (const region of bracket.regions) {
    for (const round of region.rounds) {
      for (const game of round) {
        for (const team of [game.team1, game.team2]) {
          if (team.id > 0) teamNames.set(team.id, { name: team.name, seed: team.seed });
        }
      }
    }
  }
  for (const game of bracket.firstFour) {
    for (const team of [game.team1, game.team2]) {
      if (team.id > 0) teamNames.set(team.id, { name: team.name, seed: team.seed });
    }
  }

  const rankings: Array<{ name: string; seed: number; champ: number }> = [];
  for (const t of data.teams) {
    const meta = teamNames.get(t.teamId);
    if (!meta) continue;
    rankings.push({
      name: meta.name,
      seed: meta.seed,
      champ: t.champion,
    });
  }
  rankings.sort((a, b) => b.champ - a.champ);

  console.log("\n  Top 10 Championship Winners:");
  console.log("  ─────────────────────────────────");
  for (let i = 0; i < Math.min(10, rankings.length); i++) {
    const r = rankings[i];
    const pct = ((r.champ / data.totalSimulations) * 100).toFixed(1);
    console.log(
      `  ${String(i + 1).padStart(2)}. (${r.seed}) ${r.name.padEnd(20)} ${pct}% (${r.champ})`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
