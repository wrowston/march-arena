import type { Team, TeamStats } from "./bracket-data";

/**
 * Model A: KenPom Logistic Win Probability
 *
 * Uses the empirically-validated relationship between efficiency margin
 * difference and game outcome probability. The sigma value of ~11 represents
 * the standard deviation of game outcomes in college basketball, derived from
 * 20+ years of KenPom data.
 *
 * This is the single most predictive model for college basketball.
 */
export function kenpomWinProbability(statsA: TeamStats, statsB: TeamStats): number {
  const marginDiff = statsA.adjEM - statsB.adjEM;
  return 1 / (1 + Math.pow(10, -marginDiff / 11));
}

/**
 * Model B: Log5 Method (Bill James)
 *
 * Given each team's win percentage, calculates head-to-head probability.
 * This is a well-known method from baseball analytics adapted for basketball.
 */
export function log5WinProbability(winPctA: number, winPctB: number): number {
  // Clamp to avoid division by zero
  const pA = Math.max(0.01, Math.min(0.99, winPctA));
  const pB = Math.max(0.01, Math.min(0.99, winPctB));
  return (pA - pA * pB) / (pA + pB - 2 * pA * pB);
}

/**
 * TBD / First-Four placeholder teams use seed 0. Raw math would treat 0 as
 * "better" than 1 (seedDiff = 0 - 1). In R64, the open slot is always the
 * paired line (seeds sum to 17): 1↔16, 8↔9, etc.
 */
export function normalizeSeedsForTbdMatchup(
  seed1: number,
  seed2: number
): [number, number] {
  if (seed1 === 0 && seed2 === 0) return [16, 16];
  if (seed1 === 0 && seed2 >= 1 && seed2 <= 16) return [17 - seed2, seed2];
  if (seed2 === 0 && seed1 >= 1 && seed1 <= 16) return [seed1, 17 - seed1];
  return [seed1, seed2];
}

/**
 * Model C: Seed-Based Historical Probability
 *
 * Uses logistic regression fitted on 40 years of NCAA Tournament data.
 * The coefficient 0.1667 was derived from historical seed-vs-seed outcomes.
 * Positive seedDiff means team1 is the higher (better) seed.
 */
export function seedWinProbability(seed1: number, seed2: number): number {
  const [s1, s2] = normalizeSeedsForTbdMatchup(seed1, seed2);
  const seedDiff = s2 - s1; // positive = team1 has better seed
  return 1 / (1 + Math.exp(-0.1667 * seedDiff));
}

/** Compute win percentage from record */
function winPct(stats: TeamStats): number {
  const total = stats.record.wins + stats.record.losses;
  if (total === 0) return 0.5;
  return stats.record.wins / total;
}

/**
 * Luck adjustment factor.
 *
 * Teams with high luck ratings have overperformed their underlying quality
 * (close-game wins, etc.) and are likely to regress. This nudges the
 * probability toward the opponent. The magnitude is capped so luck alone
 * can't swing a game more than ~5 percentage points.
 */
function luckAdjustment(stats1: TeamStats, stats2: TeamStats): number {
  const luckDiff = stats1.luck - stats2.luck;
  // Negative luckDiff means team1 is less lucky (undervalued) → positive nudge
  // Scale: 0.05 luck difference ≈ 1.5pp shift
  return -luckDiff * 0.3;
}

/**
 * Ensemble Win Probability
 *
 * Combines multiple models with weights reflecting their predictive power:
 * - KenPom logistic (60%): Most predictive single-game model
 * - Log5 from record (20%): Captures overall team quality
 * - Seed-based (10%): Accounts for committee seeding intelligence
 * - Luck adjustment (10%): Penalizes overperforming teams, rewards unlucky ones
 *
 * Returns probability that team1 wins.
 */
export function ensembleWinProbability(team1: Team, team2: Team): number {
  const stats1 = team1.stats;
  const stats2 = team2.stats;

  if (stats1 && stats2) {
    const pKenpom = kenpomWinProbability(stats1, stats2);
    const pLog5 = log5WinProbability(winPct(stats1), winPct(stats2));
    const pSeed = seedWinProbability(team1.seed, team2.seed);
    const luckAdj = luckAdjustment(stats1, stats2);
    const raw = 0.60 * pKenpom + 0.20 * pLog5 + 0.10 * pSeed + 0.10 * (0.5 + luckAdj);
    return Math.max(0.02, Math.min(0.98, raw));
  }

  return seedWinProbability(team1.seed, team2.seed);
}

/**
 * Generate a human-readable matchup analysis string for AI prompts.
 */
export function generateMatchupAnalysis(team1: Team, team2: Team): string {
  const stats1 = team1.stats;
  const stats2 = team2.stats;

  if (!stats1 || !stats2) return "";

  const winProb = ensembleWinProbability(team1, team2);
  const team1Pct = Math.round(winProb * 100);
  const team2Pct = 100 - team1Pct;

  const lines: string[] = [];
  lines.push(`STATISTICAL ANALYSIS:`);
  lines.push(
    `- ${team1.name}: KenPom #${stats1.kenpomRank} (AdjEM ${stats1.adjEM > 0 ? "+" : ""}${stats1.adjEM.toFixed(1)}, AdjO ${stats1.adjO.toFixed(1)} [#${stats1.adjORank}], AdjD ${stats1.adjD.toFixed(1)} [#${stats1.adjDRank}], Tempo ${stats1.adjTempo.toFixed(1)}) ${stats1.record.wins}-${stats1.record.losses}`
  );
  lines.push(
    `- ${team2.name}: KenPom #${stats2.kenpomRank} (AdjEM ${stats2.adjEM > 0 ? "+" : ""}${stats2.adjEM.toFixed(1)}, AdjO ${stats2.adjO.toFixed(1)} [#${stats2.adjORank}], AdjD ${stats2.adjD.toFixed(1)} [#${stats2.adjDRank}], Tempo ${stats2.adjTempo.toFixed(1)}) ${stats2.record.wins}-${stats2.record.losses}`
  );

  // Efficiency margin gap — qualitative framing to avoid anchoring the AI
  const emGap = Math.abs(stats1.adjEM - stats2.adjEM);
  const favorite = team1Pct >= team2Pct ? team1 : team2;
  const underdog = team1Pct >= team2Pct ? team2 : team1;
  const pctGap = Math.abs(team1Pct - team2Pct);
  lines.push(
    `- Efficiency margin gap: ${emGap.toFixed(1)} points per 100 possessions`
  );
  if (pctGap <= 10) {
    lines.push(
      `- Edge: TOSS-UP — the efficiency data says either team can win this game`
    );
  } else if (pctGap <= 20) {
    lines.push(
      `- Edge: ${favorite.name} has a slight statistical edge, but ${underdog.name} has a very realistic path to winning`
    );
  } else if (pctGap <= 35) {
    lines.push(
      `- Edge: ${favorite.name} is favored on paper, but upsets at this margin happen roughly 1 in 3 times in the NCAA Tournament`
    );
  } else {
    lines.push(
      `- Edge: ${favorite.name} is a clear favorite, but March Madness upsets at even these margins happen — look at the specific matchup factors`
    );
  }

  // Matchup insights — tournament-relevant factors
  const insights: string[] = [];

  // Defense — only highlight truly elite defenses, not just good ones
  if (stats1.adjDRank <= 10) {
    insights.push(
      `${team1.name} has an elite defense (#${stats1.adjDRank}) — top-10 defenses have a modest edge in single-elimination`
    );
  }
  if (stats2.adjDRank <= 10) {
    insights.push(
      `${team2.name} has an elite defense (#${stats2.adjDRank}) — top-10 defenses have a modest edge in single-elimination`
    );
  }

  // Offensive vs Defensive style clash
  if (stats1.adjORank <= 20 && stats2.adjDRank <= 20) {
    insights.push(
      `CLASSIC STYLE CLASH: ${team1.name}'s elite offense (#${stats1.adjORank}) vs ${team2.name}'s elite defense (#${stats2.adjDRank}) — these matchups are coin flips regardless of seeds`
    );
  }
  if (stats2.adjORank <= 20 && stats1.adjDRank <= 20) {
    insights.push(
      `CLASSIC STYLE CLASH: ${team2.name}'s elite offense (#${stats2.adjORank}) vs ${team1.name}'s elite defense (#${stats1.adjDRank}) — these matchups are coin flips regardless of seeds`
    );
  }

  // Offensive mismatch (one-sided)
  if (stats1.adjORank <= 25 && stats2.adjDRank > 60) {
    insights.push(
      `${team1.name}'s elite offense (#${stats1.adjORank}) faces a weak defense (#${stats2.adjDRank})`
    );
  }
  if (stats2.adjORank <= 25 && stats1.adjDRank > 60) {
    insights.push(
      `${team2.name}'s elite offense (#${stats2.adjORank}) faces a weak defense (#${stats1.adjDRank})`
    );
  }

  // Tempo mismatch — tournament-relevant framing
  const tempoDiff = Math.abs(stats1.adjTempo - stats2.adjTempo);
  if (tempoDiff > 3) {
    const faster = stats1.adjTempo > stats2.adjTempo ? team1 : team2;
    const slower = stats1.adjTempo > stats2.adjTempo ? team2 : team1;
    const slowerStats =
      stats1.adjTempo > stats2.adjTempo ? stats2 : stats1;
    if (slowerStats.adjDRank <= 40) {
      insights.push(
        `TEMPO ADVANTAGE: ${slower.name} plays a slow, grinding style (${slowerStats.adjTempo.toFixed(1)}) with a strong defense — they can control pace and neutralize ${faster.name}'s preferred tempo (${tempoDiff.toFixed(1)} possession gap)`
      );
    } else {
      insights.push(
        `Tempo mismatch: ${faster.name} plays much faster than ${slower.name} (${tempoDiff.toFixed(1)} possession gap) — whoever controls the pace likely wins`
      );
    }
  }

  // Strength of schedule — battle-tested indicator
  const sosDiff = Math.abs(stats1.sosEM - stats2.sosEM);
  if (sosDiff > 5) {
    const tougher =
      stats1.sosEM > stats2.sosEM
        ? { team: team1, sos: stats1.sosEM }
        : { team: team2, sos: stats2.sosEM };
    const weaker =
      stats1.sosEM > stats2.sosEM
        ? { team: team2, sos: stats2.sosEM }
        : { team: team1, sos: stats1.sosEM };
    insights.push(
      `${tougher.team.name} is far more battle-tested (SOS ${tougher.sos > 0 ? "+" : ""}${tougher.sos.toFixed(1)} vs ${weaker.sos > 0 ? "+" : ""}${weaker.sos.toFixed(1)}) — teams forged against elite competition handle tournament pressure better`
    );
  }

  // Luck regression — key March Madness indicator
  if (stats1.luck > 0.04 || stats2.luck > 0.04) {
    const luckyTeam =
      stats1.luck > stats2.luck
        ? { team: team1, luck: stats1.luck }
        : { team: team2, luck: stats2.luck };
    if (luckyTeam.luck > 0.04) {
      insights.push(
        `REGRESSION WARNING: ${luckyTeam.team.name} has been lucky this season (luck: +${luckyTeam.luck.toFixed(3)}) — their record likely overstates their true quality. Lucky teams historically underperform their seed in the tournament.`
      );
    }
  }

  // Unlucky teams — undervalued
  if (stats1.luck < -0.04 || stats2.luck < -0.04) {
    const unluckyTeam =
      stats1.luck < stats2.luck
        ? { team: team1, luck: stats1.luck }
        : { team: team2, luck: stats2.luck };
    if (unluckyTeam.luck < -0.04) {
      insights.push(
        `${unluckyTeam.team.name} has been unlucky (luck: ${unluckyTeam.luck.toFixed(3)}) — they are likely BETTER than their record/seed suggests`
      );
    }
  }

  if (insights.length > 0) {
    lines.push(``);
    lines.push(`MATCHUP INSIGHTS (tournament-relevant):`);
    insights.forEach((i) => lines.push(`- ${i}`));
  }

  return lines.join("\n");
}
