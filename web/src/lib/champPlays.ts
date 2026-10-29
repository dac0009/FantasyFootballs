import { editorClient } from "./editor";

/** One saved daily result. Mirrors public.champ_plays. */
export interface ChampPlay {
  game_key: string;
  owner_id: string;
  season: number;
  champion_owner_id: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  champion_points: number;
  points_rank: number;
  team_count: number;
  all_play_wins: number;
  all_play_losses: number;
  created_at?: string;
}

export type ChampPlaysResult =
  | { status: "ready"; plays: ChampPlay[] }
  | { status: "not-configured" }
  | { status: "unavailable"; message: string };

const COLUMNS =
  "game_key,owner_id,season,champion_owner_id,wins,losses,ties,points_for,champion_points,points_rank,team_count,all_play_wins,all_play_losses,created_at";

const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";

export async function loadChampPlays(): Promise<ChampPlaysResult> {
  if (!editorClient) return { status: "not-configured" };
  const { data, error } = await editorClient
    .from("champ_plays")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    return { status: "unavailable", message: missingTable(error.code) ? "The board isn't set up yet." : error.message };
  }
  // numeric columns can arrive as strings; make them numbers once, here.
  const plays = (data ?? []).map((p) => {
    const row = p as unknown as Record<string, unknown>;
    return { ...row, points_for: Number(row.points_for), champion_points: Number(row.champion_points) } as ChampPlay;
  });
  return { status: "ready", plays };
}

export type ChampSaveResult =
  | { ok: true }
  | { ok: false; reason: "duplicate" | "closed" | "unavailable" | "not-configured" | "error"; message: string };

export async function saveChampPlay(
  play: ChampPlay & { user_id: string; picks: { slot: string; player_id: number }[] },
): Promise<ChampSaveResult> {
  if (!editorClient) return { ok: false, reason: "not-configured", message: "Scores aren't saved on this build." };
  const { error } = await editorClient.from("champ_plays").insert(play);
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, reason: "duplicate", message: "You already played today." };
  if (missingTable(error.code)) {
    return { ok: false, reason: "unavailable", message: "The board isn't set up yet, so this result can't be posted." };
  }
  if (error.code === "42501") return { ok: false, reason: "closed", message: "Today's board is closed, or this account can't post scores." };
  return { ok: false, reason: "error", message: error.message };
}

/** Per-owner totals across every saved daily. */
export function summarizeChamp(plays: ChampPlay[]) {
  const byOwner = new Map<string, { owner_id: string; plays: number; wins: number; losses: number; beatChamp: number; topScorer: number }>();
  for (const p of plays) {
    const row = byOwner.get(p.owner_id) ?? { owner_id: p.owner_id, plays: 0, wins: 0, losses: 0, beatChamp: 0, topScorer: 0 };
    row.plays += 1;
    row.wins += p.wins;
    row.losses += p.losses;
    if (p.wins > p.losses) row.beatChamp += 1;
    if (p.points_rank === 1) row.topScorer += 1;
    byOwner.set(p.owner_id, row);
  }
  return [...byOwner.values()]
    .map((r) => ({ ...r, pct: r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0 }))
    .sort((a, b) => b.beatChamp - a.beatChamp || b.pct - a.pct);
}
