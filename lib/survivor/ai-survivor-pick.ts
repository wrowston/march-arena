import { generateText } from "ai";
import { resolveModel } from "../ai-pick";
import type { Team } from "../bracket-data";
import { generateMatchupAnalysis } from "../win-probability";
import type { TournamentDay } from "./tournament-days";
import type { DayRanking, TeamDayRanking } from "./survivor-strategy";

export interface AISurvivorPick {
  day: number;
  date: string;
  roundName: string;
  team: Team;
  opponent: Team;
  winProb: number;
  reasoning: string;
}

interface SurvivorPickResponse {
  team: string;
  reasoning: string;
}

function parseSurvivorPick(text: string): SurvivorPickResponse {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) {
    throw new Error(`No JSON object found in response: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(match[0]);
  if (typeof parsed.team !== "string" || typeof parsed.reasoning !== "string") {
    throw new Error(
      `Invalid SurvivorPick shape: ${JSON.stringify(parsed).slice(0, 300)}`
    );
  }
  return { team: parsed.team, reasoning: parsed.reasoning };
}

function describeTeamCompact(team: Team): string {
  const parts: string[] = [`${team.name} (#${team.seed} seed)`];
  if (team.conference) parts.push(team.conference);
  if (team.stats) {
    parts.push(
      `KenPom #${team.stats.kenpomRank} (AdjEM ${team.stats.adjEM > 0 ? "+" : ""}${team.stats.adjEM.toFixed(1)}, AdjO ${team.stats.adjO.toFixed(1)} #${team.stats.adjORank}, AdjD ${team.stats.adjD.toFixed(1)} #${team.stats.adjDRank})`
    );
    parts.push(`${team.stats.record.wins}-${team.stats.record.losses}`);
  }
  return parts.join(" | ");
}

/**
 * Build a prompt grounded in bracket simulation results.
 * The AI's job is no longer to predict who wins — the simulation already did that
 * using the full analysis pipeline (KenPom, historical seed data, geographic advantage,
 * upset calibration, tournament context). The AI now decides which simulation winner
 * to allocate as the survivor pick for this day.
 */
export function buildSimDrivenSurvivorPrompt(
  day: TournamentDay,
  ranking: DayRanking,
  usedTeams: string[],
  previousPicks: AISurvivorPick[],
  remainingDays: number,
  rejectedPicks?: string[]
): string {
  const availableEntries = ranking.teams.filter(
    (t) => !usedTeams.includes(t.team.name)
  );
  const availableNames = [
    ...new Set(availableEntries.map((t) => t.team.name)),
  ];

  let prompt = `You are an elite March Madness survivor pool strategist. `;
  prompt += `In a survivor pool, you pick ONE team each day of the tournament. `;
  prompt += `If your team wins, you advance. If they lose, you're eliminated. `;
  prompt += `Each team can only be used ONCE across all 10 days.\n\n`;

  prompt += `A full bracket simulation has already been completed using deep analysis `;
  prompt += `(KenPom efficiency metrics, historical seed matchup data, geographic/venue advantage, `;
  prompt += `tournament context, upset calibration, and matchup-specific factors). `;
  prompt += `The winners shown below are the simulation's predictions. `;
  prompt += `Your job is to decide which winning team to ALLOCATE as your survivor pick for today.\n\n`;

  prompt += `=== DAY ${day.day} — ${ranking.roundName} (${day.date}) ===\n\n`;

  prompt += `*** YOUR PICK MUST BE ONE OF THESE EXACT NAMES: ${availableNames.join(", ")} ***\n`;
  prompt += `Any other team name will be rejected.\n\n`;

  if (rejectedPicks && rejectedPicks.length > 0) {
    prompt += `!!! PREVIOUS INVALID PICKS (you already tried these and they were REJECTED): ${rejectedPicks.join(", ")}\n`;
    prompt += `Those teams are NOT available. Pick from the list above.\n\n`;
  }

  if (ranking.isCombinedPool) {
    prompt += `NOTE: Days 7 & 8 (Elite 8) share a combined team pool. You can pick from winners on either day.\n\n`;
  }

  prompt += `REMAINING DAYS AFTER THIS PICK: ${remainingDays - 1}\n\n`;

  if (previousPicks.length > 0) {
    prompt += `YOUR PREVIOUS PICKS (already used — CANNOT pick again):\n`;
    for (const pick of previousPicks) {
      prompt += `- Day ${pick.day}: ${pick.team.name} (#${pick.team.seed}) vs ${pick.opponent.name} — ${Math.round(pick.winProb * 100)}% win prob\n`;
    }
    prompt += `\n`;
  }

  if (usedTeams.length > 0) {
    prompt += `TEAMS ALREADY USED (unavailable): ${usedTeams.join(", ")}\n\n`;
  }

  const usedSeedCounts = previousPicks.reduce(
    (acc, p) => {
      if (p.team.seed === 1) acc.s1++;
      else if (p.team.seed === 2) acc.s2++;
      return acc;
    },
    { s1: 0, s2: 0 }
  );
  const constrainedDaysRemaining = Math.max(
    0,
    [7, 8, 9, 10].filter((d) => d >= day.day).length
  );

  prompt += `SEED BUDGET:\n`;
  prompt += `- 1-seeds used: ${usedSeedCounts.s1}/4 | 2-seeds used: ${usedSeedCounts.s2}/4\n`;
  prompt += `- 1-seeds remaining: ${4 - usedSeedCounts.s1} | 2-seeds remaining: ${4 - usedSeedCounts.s2}\n`;
  prompt += `- Days remaining: ${remainingDays} | Constrained days ahead (≤4 options): ${constrainedDaysRemaining}\n`;
  if (constrainedDaysRemaining > 0 && (4 - usedSeedCounts.s1) + (4 - usedSeedCounts.s2) <= constrainedDaysRemaining) {
    prompt += `- WARNING: You need every remaining top seed for late rounds. Do NOT burn them now.\n`;
  }
  prompt += `\n`;

  prompt += `SIMULATION WINNERS TODAY (only winners are available):\n`;
  prompt += `${"─".repeat(70)}\n`;

  const seen = new Set<string>();

  for (const entry of ranking.teams) {
    if (seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);

    const isAvailable = !usedTeams.includes(entry.team.name);

    const optimalTag = entry.isOptimalPick && isAvailable ? " ★ RECOMMENDED ★" : "";
    prompt += `\nGame: ${entry.team.name} defeated ${entry.opponent.name}${optimalTag}\n`;
    prompt += `  Winner: ${describeTeamCompact(entry.team)}${isAvailable ? "" : " [UNAVAILABLE - already used]"}\n`;
    prompt += `  Defeated: ${describeTeamCompact(entry.opponent)}\n`;
    prompt += `  Win Prob: ${Math.round(entry.winProb * 100)}%\n`;
    prompt += `  Future Value: ${(entry.futureValue * 100).toFixed(0)}/100 (higher = team advances further in simulation, more valuable to save)\n`;
    prompt += `  Pick Score: ${(entry.pickScore * 100).toFixed(1)} (accounts for win prob, future value, and seed conservation)\n`;

    if (entry.simReasoning) {
      prompt += `  Simulation Reasoning: "${entry.simReasoning}"\n`;
    }

    const analysis = generateMatchupAnalysis(entry.team, entry.opponent);
    if (analysis) {
      const shortAnalysis = analysis.split("\n").slice(0, 4).join("\n  ");
      prompt += `  ${shortAnalysis}\n`;
    }
  }

  prompt += `\n${"─".repeat(70)}\n\n`;

  prompt += `STRATEGY RULES:\n`;
  prompt += `The survivor pool has 10 days but only 4 one-seeds and 4 two-seeds exist in the entire tournament.\n`;
  prompt += `Days 7-10 (Elite 8 / Final Four / Championship) have only 1-4 winners to pick from.\n`;
  prompt += `If you burn top seeds early, you will RUN OUT of teams and LOSE the pool.\n\n`;

  if (day.day <= 2) {
    prompt += `TODAY IS DAY ${day.day} (Round of 64) — ~16 winners available.\n`;
    prompt += `- DO NOT pick a 1-seed or 2-seed. There are plenty of 3-7 seed alternatives.\n`;
    prompt += `- Pick the highest win-probability team among seeds 3-7. Even 65-75% is fine.\n`;
    prompt += `- Only use a 1/2-seed if literally no other team has ≥60% win probability.\n`;
    prompt += `- Prefer teams with LOWER future value (they won't advance far — use them now).\n`;
  } else if (day.day <= 4) {
    prompt += `TODAY IS DAY ${day.day} (Round of 32) — ~8 winners available.\n`;
    prompt += `- Strongly prefer 3-5 seeds. Avoid 1-seeds; 2-seeds only if 15%+ better than alternatives.\n`;
    prompt += `- You still have enough options to save your top seeds for Days 7-10.\n`;
  } else if (day.day <= 6) {
    prompt += `TODAY IS DAY ${day.day} (Sweet 16) — 4 winners available.\n`;
    prompt += `- 2-3 seeds are appropriate picks now. Save 1-seeds for Days 7-10 if a 2/3-seed has ≥60% win prob.\n`;
  } else {
    prompt += `TODAY IS DAY ${day.day} — OPTIONS ARE LIMITED.\n`;
    prompt += `- Pick the team with the HIGHEST win probability. Survival trumps all other considerations.\n`;
    prompt += `- These are the constrained rounds you saved your top seeds for.\n`;
  }

  prompt += `\nAMONG ELIGIBLE TEAMS: prefer higher "Pick Score" (already penalizes using top seeds early).\n`;
  prompt += `HIGH FUTURE VALUE = team advances deep in the simulation. Burning them early limits options later.\n`;

  prompt += `\nYour pick MUST be one of these exact team names: ${availableNames.join(", ")}\n`;
  prompt += `Respond with ONLY a JSON object — no extra text, no markdown fences:\n`;
  prompt += `{"team": "<exact team name from the list above>", "reasoning": "2-3 sentences explaining your allocation strategy like a survivor pool expert on a podcast"}\n`;

  return prompt;
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[.\-']/g, "").replace(/\s+/g, " ").trim();
}

function findMatchingEntry(
  pick: string,
  ranking: DayRanking,
  usedTeams: string[]
): TeamDayRanking | null {
  const normalized = normalizeTeamName(pick);

  const exact = ranking.teams.find(
    (t) =>
      normalizeTeamName(t.team.name) === normalized &&
      !usedTeams.includes(t.team.name)
  );
  if (exact) return exact;

  const fuzzy = ranking.teams.find(
    (t) =>
      !usedTeams.includes(t.team.name) &&
      (normalizeTeamName(t.team.name).includes(normalized) ||
        normalized.includes(normalizeTeamName(t.team.name)))
  );
  if (fuzzy) return fuzzy;

  return null;
}

export async function makeAISurvivorPick(
  day: TournamentDay,
  ranking: DayRanking,
  usedTeams: string[],
  previousPicks: AISurvivorPick[],
  remainingDays: number,
  modelId?: string
): Promise<AISurvivorPick | null> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`SURVIVOR DAY ${day.day}: ${ranking.roundName} (${day.date})`);
  console.log(`${"=".repeat(60)}`);

  const availableNames = [
    ...new Set(
      ranking.teams
        .filter((t) => !usedTeams.includes(t.team.name))
        .map((t) => t.team.name)
    ),
  ];

  if (availableNames.length === 0) {
    console.log("No available winners — survivor pool is over.");
    return null;
  }

  console.log(`Available winners: ${availableNames.join(", ")}`);

  const MAX_RETRIES = 3;
  let lastError: unknown;
  const rejectedPicks: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const prompt = buildSimDrivenSurvivorPrompt(
      day,
      ranking,
      usedTeams,
      previousPicks,
      remainingDays,
      rejectedPicks.length > 0 ? rejectedPicks : undefined
    );

    try {
      const result = await generateText({
        model: resolveModel(modelId),
        prompt,
        temperature: 0.7,
      });

      const pick = parseSurvivorPick(result.text);
      const matchedEntry = findMatchingEntry(pick.team, ranking, usedTeams);

      if (!matchedEntry) {
        rejectedPicks.push(pick.team);
        throw new Error(
          `AI picked "${pick.team}" which is not an available winner for Day ${day.day}. Available: ${availableNames.join(", ")}`
        );
      }

      if (matchedEntry.team.name.toLowerCase() !== pick.team.toLowerCase()) {
        console.log(
          `Fuzzy-matched AI pick "${pick.team}" to "${matchedEntry.team.name}"`
        );
      }

      console.log(`PICK: ${matchedEntry.team.name} (#${matchedEntry.team.seed})`);
      console.log(`REASONING: ${pick.reasoning}`);

      return {
        day: day.day,
        date: day.date,
        roundName: ranking.roundName,
        team: matchedEntry.team,
        opponent: matchedEntry.opponent,
        winProb: matchedEntry.winProb,
        reasoning: pick.reasoning,
      };
    } catch (e) {
      lastError = e;
      console.warn(
        `Attempt ${attempt}/${MAX_RETRIES} failed for Day ${day.day}: ${e}`
      );
    }
  }

  console.warn(`All AI attempts failed for Day ${day.day}, using fallback`);
  const fallback = ranking.teams.find(
    (t) => !usedTeams.includes(t.team.name)
  );

  if (!fallback) {
    throw lastError ?? new Error(`No available teams for Day ${day.day}`);
  }

  return {
    day: day.day,
    date: day.date,
    roundName: ranking.roundName,
    team: fallback.team,
    opponent: fallback.opponent,
    winProb: fallback.winProb,
    reasoning: `[Fallback] Picking ${fallback.team.name} as the highest-ranked available winner with ${Math.round(fallback.winProb * 100)}% win probability.`,
  };
}
