import type { Bracket, Game, Team } from "../bracket-data";
import { BRACKET_2026 } from "../bracket-data";

export interface TournamentDay {
  day: number;
  date: string;
  roundName: string;
  /** Game IDs that fall on this day */
  gameIds: string[];
  /** For days 7-8, the combined pool includes both days' game IDs */
  combinedPoolGameIds?: string[];
}

export interface DayGame {
  gameId: string;
  team1: Team;
  team2: Team;
  /** Pre-computed from bracket if game is final */
  winner?: Team;
  status: "scheduled" | "in_progress" | "final";
}

export interface DayResults {
  day: number;
  games: DayGame[];
}

/**
 * 10 tournament days for survivor pool.
 *
 * Day 1-2: R64 split by region pairs (South/East on Thu, West/Midwest on Fri)
 * Day 3-4: R32 split by region pairs
 * Day 5-6: Sweet 16 split (South/West on Thu, East/Midwest on Fri)
 * Day 7-8: Elite 8 (combined pool — can pick from either day)
 * Day 9: Final Four
 * Day 10: Championship
 */
export const TOURNAMENT_DAYS: TournamentDay[] = [
  {
    day: 1,
    date: "March 19",
    roundName: "Round of 64 — Day 1",
    gameIds: [
      "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8",
      "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8",
    ],
  },
  {
    day: 2,
    date: "March 20",
    roundName: "Round of 64 — Day 2",
    gameIds: [
      "w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8",
      "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8",
    ],
  },
  {
    day: 3,
    date: "March 21",
    roundName: "Round of 32 — Day 1",
    gameIds: ["s9", "s10", "s11", "s12", "e9", "e10", "e11", "e12"],
  },
  {
    day: 4,
    date: "March 22",
    roundName: "Round of 32 — Day 2",
    gameIds: ["w9", "w10", "w11", "w12", "m9", "m10", "m11", "m12"],
  },
  {
    day: 5,
    date: "March 26",
    roundName: "Sweet 16 — Day 1",
    gameIds: ["s13", "s14", "w13", "w14"],
  },
  {
    day: 6,
    date: "March 27",
    roundName: "Sweet 16 — Day 2",
    gameIds: ["e13", "e14", "m13", "m14"],
  },
  {
    day: 7,
    date: "March 28",
    roundName: "Elite 8 — Day 1",
    gameIds: ["s15", "w15"],
    combinedPoolGameIds: ["s15", "w15", "e15", "m15"],
  },
  {
    day: 8,
    date: "March 29",
    roundName: "Elite 8 — Day 2",
    gameIds: ["e15", "m15"],
    combinedPoolGameIds: ["s15", "w15", "e15", "m15"],
  },
  {
    day: 9,
    date: "April 4",
    roundName: "Final Four",
    gameIds: ["ff-east-south", "ff-west-midwest"],
  },
  {
    day: 10,
    date: "April 6",
    roundName: "Championship",
    gameIds: ["champ"],
  },
];

/** Resolve a game ID to the actual Game object from the bracket. */
export function resolveGame(bracket: Bracket, gameId: string): Game | null {
  if (gameId.startsWith("ff-") || gameId === "champ") {
    if (gameId === "champ") return bracket.championship;
    const ffIdx = bracket.finalFour.findIndex((g) => g.id === gameId);
    if (ffIdx >= 0) return bracket.finalFour[ffIdx]!;
    return null;
  }

  const regionPrefix = gameId[0]!;
  const regionMap: Record<string, string> = {
    s: "SOUTH",
    e: "EAST",
    w: "WEST",
    m: "MIDWEST",
  };
  const regionName = regionMap[regionPrefix];
  if (!regionName) return null;

  const region = bracket.regions.find((r) => r.name === regionName);
  if (!region) return null;

  for (const round of region.rounds) {
    const game = round.find((g) => g.id === gameId);
    if (game) return game;
  }
  return null;
}

/** Get all games for a specific tournament day, including the combined pool for days 7-8. */
export function getDayGames(
  bracket: Bracket,
  day: TournamentDay
): DayGame[] {
  const ids = day.combinedPoolGameIds ?? day.gameIds;
  const results: DayGame[] = [];

  for (const gameId of ids) {
    const game = resolveGame(bracket, gameId);
    if (!game) continue;

    const isTBD = game.team1.name === "TBD" || game.team2.name === "TBD";
    if (isTBD) continue;

    const winner =
      game.winner === 1
        ? game.team1
        : game.winner === 2
          ? game.team2
          : undefined;

    results.push({
      gameId: game.id,
      team1: game.team1,
      team2: game.team2,
      winner,
      status: game.status,
    });
  }

  return results;
}

/** Get a flat list of all pickable teams for a day (both sides of every game). */
export function getPickableTeams(dayGames: DayGame[]): Team[] {
  const teams: Team[] = [];
  for (const g of dayGames) {
    teams.push(g.team1, g.team2);
  }
  return teams;
}

/**
 * Map ESPN team IDs to bracket team names for result matching.
 * Uses the ESPN IDs already embedded in BRACKET_2026 teams.
 */
export function buildEspnIdMap(): Map<number, Team> {
  const map = new Map<number, Team>();
  const bracket = BRACKET_2026;

  for (const ff of bracket.firstFour) {
    if (ff.team1.id) map.set(ff.team1.id, ff.team1);
    if (ff.team2.id) map.set(ff.team2.id, ff.team2);
  }
  for (const region of bracket.regions) {
    for (const round of region.rounds) {
      for (const game of round) {
        if (game.team1.id) map.set(game.team1.id, game.team1);
        if (game.team2.id) map.set(game.team2.id, game.team2);
      }
    }
  }
  return map;
}
