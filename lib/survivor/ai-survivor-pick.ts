import { generateText } from "ai";
import { MODEL } from "../ai-pick";
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

  prompt += `SIMULATION WINNERS TODAY (only winners are available):\n`;
  prompt += `${"─".repeat(70)}\n`;

  const seen = new Set<string>();

  for (const entry of ranking.teams) {
    if (seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);

    const isAvailable = !usedTeams.includes(entry.team.name);

    prompt += `\nGame: ${entry.team.name} defeated ${entry.opponent.name}\n`;
    prompt += `  Winner: ${describeTeamCompact(entry.team)}${isAvailable ? "" : " [UNAVAILABLE - already used]"}\n`;
    prompt += `  Defeated: ${describeTeamCompact(entry.opponent)}\n`;
    prompt += `  Win Prob: ${Math.round(entry.winProb * 100)}%\n`;
    prompt += `  Future Value: ${(entry.futureValue * 100).toFixed(0)}/100 (higher = team advances further in simulation, more valuable to save)\n`;
    prompt += `  Pick Score: ${(entry.pickScore * 100).toFixed(1)} (win prob minus future value penalty)\n`;

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

  prompt += `STRATEGY CONSIDERATIONS:\n`;
  prompt += `- PRIORITY #1: Pick a team with the highest probability of winning TODAY. Survival is everything.\n`;
  prompt += `- PRIORITY #2: Save teams that advance deep in the simulation for later, more constrained days.\n`;
  prompt += `  - Days 7-8 (Elite 8): Only 4 winners combined. Teams that reached E8 are premium assets.\n`;
  prompt += `  - Day 9 (Final Four): Only 2 winners. You MUST have a viable pick.\n`;
  prompt += `  - Day 10 (Championship): Only 1 winner. The most constrained day.\n`;
  prompt += `- Don't "waste" a dominant 1-seed on a day when a solid 3-seed has an equally high win probability.\n`;
  prompt += `- In early rounds (Days 1-2), there are many safe winners — use mid-tier favorites to conserve top seeds.\n`;
  prompt += `- HIGH FUTURE VALUE teams are projected to win deep into the tournament — burning them early limits your options later.\n`;

  if (remainingDays <= 3) {
    prompt += `\nLATE TOURNAMENT WARNING: Only ${remainingDays} days remain. Options are very limited. Prioritize win probability above all else.\n`;
  }

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
  remainingDays: number
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
        model: MODEL,
        prompt,
        temperature: attempt === 1 ? 0.5 : 0.3,
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
