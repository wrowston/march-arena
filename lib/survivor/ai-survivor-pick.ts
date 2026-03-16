import { generateText } from "ai";
import { MODEL } from "../ai-pick";
import type { Team } from "../bracket-data";
import { ensembleWinProbability } from "../win-probability";
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
  const parts: string[] = [
    `${team.name} (#${team.seed} seed)`,
  ];
  if (team.conference) parts.push(team.conference);
  if (team.stats) {
    parts.push(
      `KenPom #${team.stats.kenpomRank} (AdjEM ${team.stats.adjEM > 0 ? "+" : ""}${team.stats.adjEM.toFixed(1)}, AdjO ${team.stats.adjO.toFixed(1)} #${team.stats.adjORank}, AdjD ${team.stats.adjD.toFixed(1)} #${team.stats.adjDRank})`
    );
    parts.push(`${team.stats.record.wins}-${team.stats.record.losses}`);
  }
  return parts.join(" | ");
}

export function buildSurvivorPickPrompt(
  day: TournamentDay,
  ranking: DayRanking,
  usedTeams: string[],
  previousPicks: AISurvivorPick[],
  remainingDays: number,
  rejectedPicks?: string[]
): string {
  const availableNames = [
    ...new Set(
      ranking.teams
        .filter((t) => !usedTeams.includes(t.team.name))
        .map((t) => t.team.name)
    ),
  ];

  let prompt = `You are an elite March Madness survivor pool strategist. `;
  prompt += `In a survivor pool, you pick ONE team each day of the tournament. `;
  prompt += `If your team wins, you advance. If they lose, you're eliminated. `;
  prompt += `Each team can only be used ONCE across all 10 days.\n\n`;

  prompt += `=== DAY ${day.day} — ${ranking.roundName} (${day.date}) ===\n\n`;

  // Put the constraint front and center so the AI sees it before any matchup data
  prompt += `*** YOUR PICK MUST BE ONE OF THESE EXACT NAMES: ${availableNames.join(", ")} ***\n`;
  prompt += `Any other team name will be rejected.\n\n`;

  if (rejectedPicks && rejectedPicks.length > 0) {
    prompt += `!!! PREVIOUS INVALID PICKS (you already tried these and they were REJECTED): ${rejectedPicks.join(", ")}\n`;
    prompt += `Those teams are NOT available. Pick from the list above.\n\n`;
  }

  if (ranking.isCombinedPool) {
    prompt += `NOTE: Days 7 & 8 (Elite 8) share a combined team pool. You can pick from games on either day.\n\n`;
  }

  prompt += `REMAINING DAYS AFTER THIS PICK: ${remainingDays - 1}\n\n`;

  if (previousPicks.length > 0) {
    prompt += `YOUR PREVIOUS PICKS (already used — CANNOT pick again):\n`;
    for (const pick of previousPicks) {
      const result = pick.winProb >= 0.5 ? "likely win" : "risky";
      prompt += `- Day ${pick.day}: ${pick.team.name} (#${pick.team.seed}) vs ${pick.opponent.name} — ${Math.round(pick.winProb * 100)}% win prob (${result})\n`;
    }
    prompt += `\n`;
  }

  if (usedTeams.length > 0) {
    prompt += `TEAMS ALREADY USED (unavailable): ${usedTeams.join(", ")}\n\n`;
  }

  prompt += `AVAILABLE MATCHUPS TODAY:\n`;
  prompt += `${"─".repeat(70)}\n`;

  const seen = new Set<string>();
  const matchups: Array<{ t1: TeamDayRanking; t2: TeamDayRanking }> = [];

  for (const entry of ranking.teams) {
    const key = [entry.team.name, entry.opponent.name].sort().join(" vs ");
    if (seen.has(key)) continue;
    seen.add(key);
    if (usedTeams.includes(entry.team.name) && usedTeams.includes(entry.opponent.name)) continue;
    const opponent = ranking.teams.find(
      (t) => t.team.name === entry.opponent.name && t.gameId === entry.gameId
    );
    if (opponent) matchups.push({ t1: entry, t2: opponent });
  }

  for (const { t1, t2 } of matchups) {
    const t1Available = !usedTeams.includes(t1.team.name);
    const t2Available = !usedTeams.includes(t2.team.name);

    prompt += `\nGame: ${t1.team.name} vs ${t2.team.name}\n`;
    prompt += `  ${describeTeamCompact(t1.team)}${t1Available ? "" : " [UNAVAILABLE - already used]"}\n`;
    prompt += `  ${describeTeamCompact(t2.team)}${t2Available ? "" : " [UNAVAILABLE - already used]"}\n`;
    prompt += `  Win Prob: ${t1.team.name} ${Math.round(t1.winProb * 100)}% — ${t2.team.name} ${Math.round(t2.winProb * 100)}%\n`;
    prompt += `  Future Value: ${t1.team.name} ${(t1.futureValue * 100).toFixed(0)}/100 — ${t2.team.name} ${(t2.futureValue * 100).toFixed(0)}/100\n`;
    prompt += `  Pick Score: ${t1.team.name} ${(t1.pickScore * 100).toFixed(1)} — ${t2.team.name} ${(t2.pickScore * 100).toFixed(1)}\n`;

    const analysis = generateMatchupAnalysis(t1.team, t2.team);
    if (analysis) {
      const shortAnalysis = analysis.split("\n").slice(0, 5).join("\n  ");
      prompt += `  ${shortAnalysis}\n`;
    }
  }

  prompt += `\n${"─".repeat(70)}\n\n`;

  prompt += `STRATEGY CONSIDERATIONS:\n`;
  prompt += `- PRIORITY #1: Pick a team with the highest probability of winning TODAY. Survival is everything.\n`;
  prompt += `- PRIORITY #2: Save strong, versatile teams for later rounds when options shrink dramatically.\n`;
  prompt += `  - Days 7-8 (Elite 8): Only 4 games combined. Teams that can reach E8 are premium assets.\n`;
  prompt += `  - Day 9 (Final Four): Only 2 games. You MUST have a viable pick.\n`;
  prompt += `  - Day 10 (Championship): Only 1 game with 2 teams. The most constrained.\n`;
  prompt += `- Don't "waste" a 1-seed on a day when a solid 3-seed has an equally high win probability.\n`;
  prompt += `- In early rounds (Days 1-2), there are many safe picks — use mid-tier favorites (3-6 seeds vs 11-14 seeds) to conserve top seeds.\n`;

  if (remainingDays <= 3) {
    prompt += `\nLATE TOURNAMENT WARNING: Only ${remainingDays} days remain. Options are very limited. Prioritize win probability above all else.\n`;
  }

  prompt += `\nYour pick MUST be one of these exact team names: ${availableNames.join(", ")}\n`;
  prompt += `Respond with ONLY a JSON object — no extra text, no markdown fences:\n`;
  prompt += `{"team": "<exact team name from the list above>", "reasoning": "2-3 sentences explaining your pick like a survivor pool expert on a podcast"}\n`;

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

  // Exact match
  const exact = ranking.teams.find(
    (t) =>
      normalizeTeamName(t.team.name) === normalized &&
      !usedTeams.includes(t.team.name)
  );
  if (exact) return exact;

  // Fuzzy: one name contains the other
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
): Promise<AISurvivorPick> {
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
  console.log(`Available teams: ${availableNames.join(", ")}`);

  const MAX_RETRIES = 3;
  let lastError: unknown;
  const rejectedPicks: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const prompt = buildSurvivorPickPrompt(
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
          `AI picked "${pick.team}" which is not an available team for Day ${day.day}. Available: ${availableNames.join(", ")}`
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

  // Fallback: pick the highest-pickScore available team
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
    reasoning: `[Fallback] Picking ${fallback.team.name} as the highest-ranked available option with ${Math.round(fallback.winProb * 100)}% win probability.`,
  };
}
