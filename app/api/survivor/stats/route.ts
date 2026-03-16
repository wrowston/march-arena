import { NextResponse } from "next/server";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export const revalidate = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");

  try {
    const convex = getConvexClient();

    if (view === "leaderboard") {
      const leaderboard = await convex.query(api.survivor.getSurvivorLeaderboard);
      return NextResponse.json(leaderboard);
    }

    const stats = await convex.query(api.survivor.getSurvivorStats);
    return NextResponse.json(stats);
  } catch (e) {
    console.error("Failed to fetch survivor stats:", e);
    return NextResponse.json({ totalRuns: 0, days: [] });
  }
}
