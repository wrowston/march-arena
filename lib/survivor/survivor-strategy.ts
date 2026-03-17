import type { SimulatedBracket, Team } from "../bracket-data";
import { ensembleWinProbability } from "../win-probability";
import {
  TOURNAMENT_DAYS,
  getDaySimResults,
  type SimDayGameResult,
  type TournamentDay,
} from "./tournament-days";

export interface TeamDayRanking {
  team: Team;
  opponent: Team;
  gameId: string;
  winProb: number;
  /** 0-1 score: how much this team is "needed" on a later, more constrained day */
  futureValue: number;
  /** Composite score: higher = better pick for this day */
  pickScore: number;
  isOptimalPick: boolean;
  /** Reasoning from the bracket simulation for this game */
  simReasoning: string;
}

export interface DayRanking {
  day: number;
  date: string;
  roundName: string;
  isCombinedPool: boolean;
  teams: TeamDayRanking[];
  gamesResolved: boolean;
}

export interface OptimalAssignment {
  day: number;
  team: Team;
  winProb: number;
}

/**
 * Dynamic future value weight: early rounds penalize using top teams heavily,
 * late rounds focus purely on survival.
 */
function getFutureValueWeight(dayNumber: number): number {
  if (dayNumber <= 2) return 0.55;
  if (dayNumber <= 4) return 0.45;
  if (dayNumber <= 6) return 0.25;
  if (dayNumber <= 8) return 0.10;
  return 0;
}

/**
 * Direct penalty for using 1-2 seeds on early days.
 * Top seeds are scarce resources (only 4 of each) needed for late rounds
 * where only 1-4 winners are available per day.
 */
function getTopSeedPenalty(seed: number, dayNumber: number): number {
  if (dayNumber >= 7) return 0;
  const dayFactor = (7 - dayNumber) / 6;
  if (seed === 1) return 0.20 * dayFactor;
  if (seed === 2) return 0.12 * dayFactor;
  if (seed === 3) return 0.05 * dayFactor;
  return 0;
}

/**
 * For each winning team in the simulation, compute the latest day they appear.
 * Teams that win deeper into the tournament are more valuable to save for later.
 */
function computeFutureValueFromSim(
  simBracket: SimulatedBracket,
  days: TournamentDay[]
): Map<string, number> {
  const latestDay = new Map<string, number>();

  for (const day of days) {
    const results = getDaySimResults(simBracket, day);
    for (const r of results) {
      const current = latestDay.get(r.winner.name) ?? 0;
      if (day.day > current) latestDay.set(r.winner.name, day.day);
    }
  }

  const fv = new Map<string, number>();
  for (const [name, ld] of latestDay) {
    fv.set(name, (ld - 1) / 9);
  }
  return fv;
}

/**
 * Backward-constrained greedy assignment using only simulation winners.
 * Starts with the most constrained day (fewest winning options) and works outward.
 */
function computeOptimalAssignmentFromSim(
  simBracket: SimulatedBracket,
  days: TournamentDay[]
): OptimalAssignment[] {
  interface Candidate {
    day: number;
    team: Team;
    opponent: Team;
    gameId: string;
    winProb: number;
  }

  const candidatesByDay = new Map<number, Candidate[]>();

  for (const day of days) {
    const results = getDaySimResults(simBracket, day);
    const candidates: Candidate[] = results.map((r) => ({
      day: day.day,
      team: r.winner,
      opponent: r.loser,
      gameId: r.gameId,
      winProb: ensembleWinProbability(r.winner, r.loser),
    }));
    candidatesByDay.set(day.day, candidates);
  }

  const dayOrder = [...candidatesByDay.entries()]
    .sort((a, b) => a[1].length - b[1].length)
    .map(([dayNum]) => dayNum);

  const usedTeams = new Set<string>();
  const assignments: OptimalAssignment[] = [];

  for (const dayNum of dayOrder) {
    const candidates = candidatesByDay.get(dayNum)!;
    const available = candidates.filter((c) => !usedTeams.has(c.team.name));

    if (available.length === 0) continue;

    available.sort((a, b) => {
      if (available.length <= 3) {
        return b.winProb - a.winProb;
      }
      const scoreA = a.winProb - getTopSeedPenalty(a.team.seed, dayNum);
      const scoreB = b.winProb - getTopSeedPenalty(b.team.seed, dayNum);
      return scoreB - scoreA;
    });
    const best = available[0]!;
    usedTeams.add(best.team.name);
    assignments.push({ day: dayNum, team: best.team, winProb: best.winProb });
  }

  assignments.sort((a, b) => a.day - b.day);
  return assignments;
}

/**
 * Main entry point: compute rankings for all 10 days from a completed simulation.
 * Only simulation winners are candidates — the bracket simulation has already
 * determined who wins each game using the full analysis pipeline.
 */
export function computeSurvivorRankingsFromSim(
  simBracket: SimulatedBracket
): DayRanking[] {
  const futureValues = computeFutureValueFromSim(simBracket, TOURNAMENT_DAYS);
  const optimal = computeOptimalAssignmentFromSim(simBracket, TOURNAMENT_DAYS);
  const optimalMap = new Map(optimal.map((a) => [a.day, a.team.name]));

  const rankings: DayRanking[] = [];

  for (const day of TOURNAMENT_DAYS) {
    const results = getDaySimResults(simBracket, day);
    const teams: TeamDayRanking[] = [];

    for (const r of results) {
      const winProb = ensembleWinProbability(r.winner, r.loser);
      const fv = futureValues.get(r.winner.name) ?? 0;
      const fvWeight = getFutureValueWeight(day.day);
      const seedPenalty = getTopSeedPenalty(r.winner.seed, day.day);
      const pickScore = winProb - fv * fvWeight - seedPenalty;

      teams.push({
        team: r.winner,
        opponent: r.loser,
        gameId: r.gameId,
        winProb,
        futureValue: fv,
        pickScore,
        isOptimalPick: optimalMap.get(day.day) === r.winner.name,
        simReasoning: r.reasoning,
      });
    }

    teams.sort((a, b) => b.pickScore - a.pickScore);

    rankings.push({
      day: day.day,
      date: day.date,
      roundName: day.roundName,
      isCombinedPool: !!day.combinedPoolGameIds,
      teams,
      gamesResolved: results.length > 0,
    });
  }

  return rankings;
}

/**
 * Compute a DayRanking for a single day from known game results.
 * Used in the pipelined flow where the full SimulatedBracket isn't available yet.
 * Future value is approximated by seed: lower seeds (stronger teams) are assumed
 * more likely to advance deep and are thus more valuable to save for later days.
 */
export function computeDayRankingFromResults(
  gameResults: SimDayGameResult[],
  day: TournamentDay,
): DayRanking {
  const fvWeight = getFutureValueWeight(day.day);
  const teams: TeamDayRanking[] = [];

  for (const r of gameResults) {
    const winProb = ensembleWinProbability(r.winner, r.loser);
    const seedProxy = (17 - r.winner.seed) / 16;
    const seedPenalty = getTopSeedPenalty(r.winner.seed, day.day);
    const pickScore = winProb - seedProxy * fvWeight - seedPenalty;

    teams.push({
      team: r.winner,
      opponent: r.loser,
      gameId: r.gameId,
      winProb,
      futureValue: seedProxy,
      pickScore,
      isOptimalPick: false,
      simReasoning: r.reasoning,
    });
  }

  teams.sort((a, b) => b.pickScore - a.pickScore);

  return {
    day: day.day,
    date: day.date,
    roundName: day.roundName,
    isCombinedPool: !!day.combinedPoolGameIds,
    teams,
    gamesResolved: gameResults.length > 0,
  };
}

export function computeOverallSurvivalProbability(
  assignments: OptimalAssignment[]
): number {
  return assignments.reduce((acc, a) => acc * a.winProb, 1);
}
