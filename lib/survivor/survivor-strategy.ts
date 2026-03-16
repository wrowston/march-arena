import type { Bracket, Game, Team } from "../bracket-data";
import { ensembleWinProbability } from "../win-probability";
import {
  TOURNAMENT_DAYS,
  resolveGame,
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

interface ProjectedGame {
  gameId: string;
  team1: Team;
  team2: Team;
  team1WinProb: number;
}

/**
 * Project bracket forward by simulating unplayed games using win probabilities.
 * Returns the bracket with projected winners filled in for unplayed games.
 */
function projectBracketForward(bracket: Bracket): Map<string, ProjectedGame> {
  const projected = new Map<string, ProjectedGame>();

  function getWinner(game: Game): Team | null {
    if (game.winner === 1) return game.team1;
    if (game.winner === 2) return game.team2;
    return null;
  }

  function projectGame(game: Game): ProjectedGame {
    if (game.team1.name === "TBD" || game.team2.name === "TBD") {
      return {
        gameId: game.id,
        team1: game.team1,
        team2: game.team2,
        team1WinProb: 0.5,
      };
    }
    const p = ensembleWinProbability(game.team1, game.team2);
    return {
      gameId: game.id,
      team1: game.team1,
      team2: game.team2,
      team1WinProb: p,
    };
  }

  function getProjectedWinner(pg: ProjectedGame): Team {
    return pg.team1WinProb >= 0.5 ? pg.team1 : pg.team2;
  }

  for (const region of bracket.regions) {
    const r64 = region.rounds[0]!;
    for (const game of r64) {
      projected.set(game.id, projectGame(game));
    }

    const r32 = region.rounds[1]!;
    for (let i = 0; i < r32.length; i++) {
      const game = r32[i]!;
      const actual = getWinner(game);
      if (actual && game.team1.name !== "TBD") {
        projected.set(game.id, projectGame(game));
        continue;
      }
      const feederA = r64[i * 2]!;
      const feederB = r64[i * 2 + 1]!;
      const projA = projected.get(feederA.id)!;
      const projB = projected.get(feederB.id)!;
      const team1 = getWinner(feederA) ?? getProjectedWinner(projA);
      const team2 = getWinner(feederB) ?? getProjectedWinner(projB);
      const p = ensembleWinProbability(team1, team2);
      projected.set(game.id, { gameId: game.id, team1, team2, team1WinProb: p });
    }

    const s16 = region.rounds[2]!;
    for (let i = 0; i < s16.length; i++) {
      const game = s16[i]!;
      const actual = getWinner(game);
      if (actual && game.team1.name !== "TBD") {
        projected.set(game.id, projectGame(game));
        continue;
      }
      const feederA = r32[i * 2]!;
      const feederB = r32[i * 2 + 1]!;
      const projA = projected.get(feederA.id)!;
      const projB = projected.get(feederB.id)!;
      const team1 =
        getWinner(feederA) ?? getProjectedWinner(projA);
      const team2 =
        getWinner(feederB) ?? getProjectedWinner(projB);
      const p = ensembleWinProbability(team1, team2);
      projected.set(game.id, { gameId: game.id, team1, team2, team1WinProb: p });
    }

    const e8 = region.rounds[3]!;
    for (let i = 0; i < e8.length; i++) {
      const game = e8[i]!;
      const actual = getWinner(game);
      if (actual && game.team1.name !== "TBD") {
        projected.set(game.id, projectGame(game));
        continue;
      }
      const feederA = s16[i * 2]!;
      const feederB = s16[i * 2 + 1]!;
      const projA = projected.get(feederA.id)!;
      const projB = projected.get(feederB.id)!;
      const team1 =
        getWinner(feederA) ?? getProjectedWinner(projA);
      const team2 =
        getWinner(feederB) ?? getProjectedWinner(projB);
      const p = ensembleWinProbability(team1, team2);
      projected.set(game.id, { gameId: game.id, team1, team2, team1WinProb: p });
    }
  }

  // Final Four
  const southE8 = projected.get("s15");
  const eastE8 = projected.get("e15");
  const westE8 = projected.get("w15");
  const midwestE8 = projected.get("m15");

  if (southE8 && eastE8) {
    const ff1Team1 =
      resolveGame(bracket, "s15")?.winner === 1
        ? resolveGame(bracket, "s15")!.team1
        : resolveGame(bracket, "s15")?.winner === 2
          ? resolveGame(bracket, "s15")!.team2
          : getProjectedWinner(southE8);
    const ff1Team2 =
      resolveGame(bracket, "e15")?.winner === 1
        ? resolveGame(bracket, "e15")!.team1
        : resolveGame(bracket, "e15")?.winner === 2
          ? resolveGame(bracket, "e15")!.team2
          : getProjectedWinner(eastE8);
    const p = ensembleWinProbability(ff1Team1, ff1Team2);
    projected.set("ff-east-south", {
      gameId: "ff-east-south",
      team1: ff1Team1,
      team2: ff1Team2,
      team1WinProb: p,
    });
  }

  if (westE8 && midwestE8) {
    const ff2Team1 =
      resolveGame(bracket, "w15")?.winner === 1
        ? resolveGame(bracket, "w15")!.team1
        : resolveGame(bracket, "w15")?.winner === 2
          ? resolveGame(bracket, "w15")!.team2
          : getProjectedWinner(westE8);
    const ff2Team2 =
      resolveGame(bracket, "m15")?.winner === 1
        ? resolveGame(bracket, "m15")!.team1
        : resolveGame(bracket, "m15")?.winner === 2
          ? resolveGame(bracket, "m15")!.team2
          : getProjectedWinner(midwestE8);
    const p = ensembleWinProbability(ff2Team1, ff2Team2);
    projected.set("ff-west-midwest", {
      gameId: "ff-west-midwest",
      team1: ff2Team1,
      team2: ff2Team2,
      team1WinProb: p,
    });
  }

  // Championship
  const ff1 = projected.get("ff-east-south");
  const ff2 = projected.get("ff-west-midwest");
  if (ff1 && ff2) {
    const champTeam1 = getProjectedWinner(ff1);
    const champTeam2 = getProjectedWinner(ff2);
    const p = ensembleWinProbability(champTeam1, champTeam2);
    projected.set("champ", {
      gameId: "champ",
      team1: champTeam1,
      team2: champTeam2,
      team1WinProb: p,
    });
  }

  return projected;
}

/**
 * For each team, compute the latest day they're projected to play.
 * Teams with later projected appearances have higher future value.
 */
function computeFutureValue(
  projected: Map<string, ProjectedGame>,
  days: TournamentDay[]
): Map<string, number> {
  // teamName -> latest day they appear in a projected game
  const latestDay = new Map<string, number>();

  for (const day of days) {
    const ids = day.combinedPoolGameIds ?? day.gameIds;
    for (const gid of ids) {
      const pg = projected.get(gid);
      if (!pg || pg.team1.name === "TBD") continue;
      const current1 = latestDay.get(pg.team1.name) ?? 0;
      if (day.day > current1) latestDay.set(pg.team1.name, day.day);
      const current2 = latestDay.get(pg.team2.name) ?? 0;
      if (day.day > current2) latestDay.set(pg.team2.name, day.day);
    }
  }

  // Normalize to 0-1 range (day 10 = 1.0, day 1 = 0.0)
  const fv = new Map<string, number>();
  for (const [name, ld] of latestDay) {
    fv.set(name, (ld - 1) / 9);
  }
  return fv;
}

/**
 * Compute the optimal assignment of teams to days using backward-constrained greedy.
 * Works from the most constrained day (fewest options) backward.
 */
function computeOptimalAssignment(
  projected: Map<string, ProjectedGame>,
  days: TournamentDay[]
): OptimalAssignment[] {
  // Build candidate list per day: { dayNum, team, opponent, winProb }
  interface Candidate {
    day: number;
    team: Team;
    opponent: Team;
    gameId: string;
    winProb: number;
  }

  const candidatesByDay = new Map<number, Candidate[]>();

  for (const day of days) {
    const ids = day.combinedPoolGameIds ?? day.gameIds;
    const candidates: Candidate[] = [];
    for (const gid of ids) {
      const pg = projected.get(gid);
      if (!pg || pg.team1.name === "TBD") continue;
      candidates.push({
        day: day.day,
        team: pg.team1,
        opponent: pg.team2,
        gameId: gid,
        winProb: pg.team1WinProb,
      });
      candidates.push({
        day: day.day,
        team: pg.team2,
        opponent: pg.team1,
        gameId: gid,
        winProb: 1 - pg.team1WinProb,
      });
    }
    candidatesByDay.set(day.day, candidates);
  }

  // Sort days by number of candidates (ascending) to start with most constrained
  const dayOrder = [...candidatesByDay.entries()]
    .sort((a, b) => a[1].length - b[1].length)
    .map(([dayNum]) => dayNum);

  const usedTeams = new Set<string>();
  const assignments: OptimalAssignment[] = [];

  for (const dayNum of dayOrder) {
    const candidates = candidatesByDay.get(dayNum)!;
    const available = candidates.filter((c) => !usedTeams.has(c.team.name));

    if (available.length === 0) continue;

    // Pick the candidate with highest win probability
    available.sort((a, b) => b.winProb - a.winProb);
    const best = available[0]!;
    usedTeams.add(best.team.name);
    assignments.push({ day: dayNum, team: best.team, winProb: best.winProb });
  }

  assignments.sort((a, b) => a.day - b.day);
  return assignments;
}

/**
 * Main entry point: compute rankings for all 10 days.
 */
export function computeSurvivorRankings(bracket: Bracket): DayRanking[] {
  const projected = projectBracketForward(bracket);
  const futureValues = computeFutureValue(projected, TOURNAMENT_DAYS);
  const optimal = computeOptimalAssignment(projected, TOURNAMENT_DAYS);
  const optimalMap = new Map(optimal.map((a) => [a.day, a.team.name]));

  const rankings: DayRanking[] = [];

  for (const day of TOURNAMENT_DAYS) {
    const ids = day.combinedPoolGameIds ?? day.gameIds;
    const teams: TeamDayRanking[] = [];
    let gamesResolved = true;

    for (const gid of ids) {
      const pg = projected.get(gid);
      if (!pg || pg.team1.name === "TBD") {
        gamesResolved = false;
        continue;
      }

      const actualGame = resolveGame(bracket, gid);
      if (actualGame && actualGame.status !== "final") gamesResolved = false;

      const fv1 = futureValues.get(pg.team1.name) ?? 0;
      const fv2 = futureValues.get(pg.team2.name) ?? 0;

      // Future value penalty: reduce pick score for teams needed later.
      // Weight it so a team projected to Day 10 gets ~0.3 penalty on Day 1.
      const fvWeight = 0.3;

      const score1 = pg.team1WinProb - fv1 * fvWeight;
      const score2 = (1 - pg.team1WinProb) - fv2 * fvWeight;

      teams.push({
        team: pg.team1,
        opponent: pg.team2,
        gameId: gid,
        winProb: pg.team1WinProb,
        futureValue: fv1,
        pickScore: score1,
        isOptimalPick: optimalMap.get(day.day) === pg.team1.name,
      });
      teams.push({
        team: pg.team2,
        opponent: pg.team1,
        gameId: gid,
        winProb: 1 - pg.team1WinProb,
        futureValue: fv2,
        pickScore: score2,
        isOptimalPick: optimalMap.get(day.day) === pg.team2.name,
      });
    }

    teams.sort((a, b) => b.pickScore - a.pickScore);

    rankings.push({
      day: day.day,
      date: day.date,
      roundName: day.roundName,
      isCombinedPool: !!day.combinedPoolGameIds,
      teams,
      gamesResolved,
    });
  }

  return rankings;
}

export function computeOverallSurvivalProbability(
  assignments: OptimalAssignment[]
): number {
  return assignments.reduce((acc, a) => acc * a.winProb, 1);
}
