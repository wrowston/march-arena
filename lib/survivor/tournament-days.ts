import type { Bracket, Game, SimulatedBracket, SimulatedGame, Team } from "../bracket-data";
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
 * Day 1-2: R64 split by pod site (Thu: Greenville/OKC/Portland/Buffalo,
 *          Fri: Tampa/Philadelphia/San Diego/St. Louis). Games from all 4
 *          regions appear on BOTH days because each region plays at 2 pods.
 * Day 3-4: R32 at the same pod sites (Sat for Thu pods, Sun for Fri pods)
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
      // Greenville: East top + South mid
      "e1", "e2", "s5", "s6",
      // OKC: South top-mid + South bottom
      "s3", "s4", "s7", "s8",
      // Portland: West mid
      "w3", "w4", "w5", "w6",
      // Buffalo: East mid + Midwest top
      "e5", "e6", "m1", "m2",
    ],
  },
  {
    day: 2,
    date: "March 20",
    roundName: "Round of 64 — Day 2",
    gameIds: [
      // Tampa: South top + Midwest mid-top
      "s1", "s2", "m3", "m4",
      // Philadelphia: East bottom + Midwest mid
      "e7", "e8", "m5", "m6",
      // San Diego: West top + East mid
      "w1", "w2", "e3", "e4",
      // St. Louis: Midwest bottom + West bottom
      "m7", "m8", "w7", "w8",
    ],
  },
  {
    day: 3,
    date: "March 21",
    roundName: "Round of 32 — Day 1",
    gameIds: [
      // Greenville: e9 (e1/e2 winners), s11 (s5/s6 winners)
      "e9", "s11",
      // OKC: s10 (s3/s4 winners), s12 (s7/s8 winners)
      "s10", "s12",
      // Portland: w10 (w3/w4 winners), w11 (w5/w6 winners)
      "w10", "w11",
      // Buffalo: e11 (e5/e6 winners), m9 (m1/m2 winners)
      "e11", "m9",
    ],
  },
  {
    day: 4,
    date: "March 22",
    roundName: "Round of 32 — Day 2",
    gameIds: [
      // Tampa: s9 (s1/s2 winners), m10 (m3/m4 winners)
      "s9", "m10",
      // Philadelphia: e12 (e7/e8 winners), m11 (m5/m6 winners)
      "e12", "m11",
      // San Diego: w9 (w1/w2 winners), e10 (e3/e4 winners)
      "w9", "e10",
      // St. Louis: m12 (m7/m8 winners), w12 (w7/w8 winners)
      "m12", "w12",
    ],
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

// ── Simulated bracket helpers ───────────────────────────────────────

export interface SimDayGameResult {
  gameId: string;
  winner: Team;
  loser: Team;
  reasoning: string;
}

/**
 * Resolve a game ID to a SimulatedGame from a SimulatedBracket.
 * Returns null if the game ID is not found.
 */
export function resolveSimulatedGame(
  simBracket: SimulatedBracket,
  gameId: string
): SimulatedGame | null {
  if (gameId === "champ") return simBracket.championship;

  if (gameId.startsWith("ff-")) {
    return simBracket.finalFour.find((g) => g.id === gameId) ?? null;
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

  const region = simBracket.regions.find((r) => r.name === regionName);
  if (!region) return null;

  for (const round of region.rounds) {
    const game = round.find((g) => g.id === gameId) as SimulatedGame | undefined;
    if (game) return game;
  }
  return null;
}

/**
 * Extract winners, losers, and reasoning for all games on a given day
 * from a completed SimulatedBracket.
 */
export function getDaySimResults(
  simBracket: SimulatedBracket,
  day: TournamentDay
): SimDayGameResult[] {
  const ids = day.combinedPoolGameIds ?? day.gameIds;
  const results: SimDayGameResult[] = [];

  for (const gameId of ids) {
    const game = resolveSimulatedGame(simBracket, gameId);
    if (!game || !game.winner) continue;

    const winner = game.winner === 1 ? game.team1 : game.team2;
    const loser = game.winner === 1 ? game.team2 : game.team1;

    results.push({
      gameId: game.id,
      winner,
      loser,
      reasoning: (game as SimulatedGame).reasoning ?? "",
    });
  }

  return results;
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
