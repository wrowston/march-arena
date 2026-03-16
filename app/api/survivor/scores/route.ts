import { NextResponse } from "next/server";
import { TOURNAMENT_DAYS } from "@/lib/survivor/tournament-days";

export const revalidate = 120;

interface EspnCompetitor {
  id: string;
  team: { id: string; displayName: string; abbreviation: string };
  score: string;
  winner: boolean;
  curatedRank?: { current: number };
}

interface EspnEvent {
  id: string;
  name: string;
  date: string;
  status: { type: { name: string; completed: boolean } };
  competitions: Array<{
    competitors: EspnCompetitor[];
  }>;
}

interface EspnScoreboard {
  events: EspnEvent[];
}

export interface ScoreboardGame {
  espnEventId: string;
  team1Id: number;
  team1Name: string;
  team1Score: number;
  team2Id: number;
  team2Name: string;
  team2Score: number;
  winnerTeamId: number | null;
  status: "scheduled" | "in_progress" | "final";
}

export interface SurvivorScoresResponse {
  day: number;
  date: string;
  games: ScoreboardGame[];
}

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

const DATE_MAP: Record<number, string> = {
  1: "20260319",
  2: "20260320",
  3: "20260321",
  4: "20260322",
  5: "20260326",
  6: "20260327",
  7: "20260328",
  8: "20260329",
  9: "20260404",
  10: "20260406",
};

function mapStatus(
  statusName: string
): "scheduled" | "in_progress" | "final" {
  if (statusName === "STATUS_FINAL") return "final";
  if (statusName === "STATUS_IN_PROGRESS") return "in_progress";
  return "scheduled";
}

async function fetchScoreboard(dateStr: string): Promise<ScoreboardGame[]> {
  const url = `${ESPN_BASE}?dates=${dateStr}&groups=100&limit=50`;
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) return [];

  const data: EspnScoreboard = await res.json();
  if (!data.events) return [];

  return data.events.map((event) => {
    const comp = event.competitions[0]!;
    const c1 = comp.competitors[0]!;
    const c2 = comp.competitors[1]!;
    const status = mapStatus(event.status.type.name);
    const winnerTeamId =
      status === "final"
        ? c1.winner
          ? Number(c1.team.id)
          : c2.winner
            ? Number(c2.team.id)
            : null
        : null;

    return {
      espnEventId: event.id,
      team1Id: Number(c1.team.id),
      team1Name: c1.team.displayName,
      team1Score: Number(c1.score) || 0,
      team2Id: Number(c2.team.id),
      team2Name: c2.team.displayName,
      team2Score: Number(c2.score) || 0,
      winnerTeamId,
      status,
    };
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dayParam = searchParams.get("day");

  if (dayParam) {
    const dayNum = Number(dayParam);
    const tourneyDay = TOURNAMENT_DAYS.find((d) => d.day === dayNum);
    if (!tourneyDay) {
      return NextResponse.json({ error: "Invalid day" }, { status: 400 });
    }
    const dateStr = DATE_MAP[dayNum];
    if (!dateStr) {
      return NextResponse.json({ error: "No date mapping" }, { status: 400 });
    }
    const games = await fetchScoreboard(dateStr);
    const resp: SurvivorScoresResponse = {
      day: dayNum,
      date: tourneyDay.date,
      games,
    };
    return NextResponse.json(resp);
  }

  const allDays: SurvivorScoresResponse[] = [];
  for (const td of TOURNAMENT_DAYS) {
    const dateStr = DATE_MAP[td.day];
    if (!dateStr) continue;
    const games = await fetchScoreboard(dateStr);
    allDays.push({ day: td.day, date: td.date, games });
  }
  return NextResponse.json(allDays);
}
