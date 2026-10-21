import { editorClient } from "./editor";

/** One saved daily result. Mirrors public.wheel_plays. */
export interface WheelPlay {
  game_key: string;
  owner_id: string;
  season: number;
  week: number;
  team_id: number;
  opponent_team_id: number;
  points: number;
  opponent_points: number;
  actual_points: number;
  optimal_points: number;
  created_at?: string;
}

export type PlaysResult =
  | { status: "ready"; plays: WheelPlay[] }
  | { status: "not-configured" }
  | { status: "unavailable"; message: string };

const COLUMNS =
  "game_key,owner_id,season,week,team_id,opponent_team_id,points,opponent_points,actual_points,optimal_points,created_at";

export async function loadPlays(): Promise<PlaysResult> {
  if (!editorClient) return { status: "not-configured" };
  const { data, error } = await editorClient
    .from("wheel_plays")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return { status: "unavailable", message: error.message };
  return { status: "ready", plays: (data ?? []) as unknown as WheelPlay[] };
}

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "duplicate" | "closed" | "unavailable" | "not-configured" | "error"; message: string };

export async function savePlay(
  play: WheelPlay & { user_id: string; lineup: Record<string, number | null>; pickups: number[] },
): Promise<SaveResult> {
  if (!editorClient) return { ok: false, reason: "not-configured", message: "Scores are not being saved on this build." };
  const { error } = await editorClient.from("wheel_plays").insert(play);
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, reason: "duplicate", message: "You already played today." };
  if (error.code === "42P01") return { ok: false, reason: "unavailable", message: "The scoreboard table has not been created yet." };
  if (error.code === "42501") return { ok: false, reason: "closed", message: "Today's board is closed, or this account cannot post scores." };
  return { ok: false, reason: "error", message: error.message };
}

/** Per-owner totals across every saved daily. */
export function summarize(plays: WheelPlay[]) {
  const byOwner = new Map<string, { owner_id: string; plays: number; wins: number; beatOwner: number; points: number; best: number }>();
  for (const p of plays) {
    const row = byOwner.get(p.owner_id) ?? { owner_id: p.owner_id, plays: 0, wins: 0, beatOwner: 0, points: 0, best: 0 };
    row.plays += 1;
    if (p.points > p.opponent_points) row.wins += 1;
    if (p.points > p.actual_points) row.beatOwner += 1;
    row.points += p.points;
    row.best = Math.max(row.best, p.points);
    byOwner.set(p.owner_id, row);
  }
  return [...byOwner.values()]
    .map((r) => ({ ...r, avg: r.plays ? r.points / r.plays : 0 }))
    .sort((a, b) => b.wins - a.wins || b.avg - a.avg);
}
