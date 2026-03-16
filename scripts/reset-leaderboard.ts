/**
 * Clear all leaderboard data in Convex.
 * Run before re-seeding or to start fresh.
 *
 * Usage:
 *   pnpm tsx scripts/reset-leaderboard.ts
 *
 * Requires CONVEX_URL in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local may not exist
}

async function main() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL not found in .env.local");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);

  const before = await client.query(api.leaderboard.getLeaderboard);
  const result = await client.mutation(api.leaderboard.resetLeaderboard);

  if (result.deletedTeams > 0 || before.totalSimulations > 0) {
    console.log(
      `Leaderboard reset. Removed ${result.deletedTeams} team records (had total=${before.totalSimulations} simulations).`
    );
  } else {
    console.log("Leaderboard was already empty.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
