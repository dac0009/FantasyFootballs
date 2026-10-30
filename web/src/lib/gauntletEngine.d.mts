import type { DraftPick, Player, RosterRow, TeamWeek } from './types';
import type { SlotKey, SlotTemplate } from './wheelEngine.mjs';

export interface ChampTeam {
  team_id: number;
  owner_id: string;
  name: string;
}
export interface DraftablePlayer {
  player_id: number;
  name: string;
  position: string;
  draft_round: number | null;
  weekly: Record<number, number>;
  played: Record<number, boolean>;
  season_points: number;
  weeks_with_data: number;
}
export type Picks = Record<string, DraftablePlayer | null>;
export interface Board {
  season: number;
  weeks: number[];
  template: SlotTemplate;
  keys: SlotKey[];
  teams: Map<number, ChampTeam>;
  champion: ChampTeam;
  championRoster: DraftablePlayer[];
  pools: Map<number, DraftablePlayer[]>;
  spinTeams: number[];
  games: TeamWeek[];
  fillIns: Record<string, number>;
}
export interface FillIn {
  player_id: number;
  name: string;
  position: string;
  points: number;
}
export interface WeekResult {
  week: number;
  you: number;
  champ: number | null;
  result: 'W' | 'L' | 'T' | null;
  missing: number;
  fillIns: FillIn[];
  allWins: number;
  allLosses: number;
  allTies: number;
}
export interface TableRow {
  team_id: number | null;
  owner_id: string | null;
  name: string;
  points_for: number;
  you: boolean;
}
export type ScoredPlayer = DraftablePlayer & { total: number; games: number; fill_in_points: number };
export interface SeasonResult {
  weeks: WeekResult[];
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  average: number;
  league_average: number;
  rank: number;
  team_count: number;
  table: TableRow[];
  all_play: { wins: number; losses: number; ties: number };
  champion: { wins: number; losses: number; ties: number; points_for: number };
  best_week: WeekResult | null;
  worst_week: WeekResult | null;
  mvp: ScoredPlayer | null;
  dud: ScoredPlayer | null;
  by_player: ScoredPlayer[];
  missing_weeks: number;
  fill_in_points: number;
}

export function dayNumber(dateKey: string): number;
export function shuffle<T>(rng: () => number, list: T[]): T[];
export function dailySeason(dateKey: string, seasons: number[]): number;
export function spinOrder(seed: string, teamIds: number[], length?: number): number[];
export function regularWeeks(teamWeeks: TeamWeek[], season: number, regularSeasonWeeks: number | null): TeamWeek[];
export function buildSeason(args: {
  season: number;
  regularSeasonWeeks: number | null;
  rows: RosterRow[];
  players: Player[] | Map<number, Player>;
  teamWeeks: TeamWeek[];
  draft?: DraftPick[];
  championOwnerId: string;
}): Board;
export function slotsFor(player: DraftablePlayer, keys: SlotKey[], picks: Picks): SlotKey[];
export function spinOptions(board: Board, teamId: number, keys: SlotKey[], picks: Picks): DraftablePlayer[];
export function nextUsableSpin(board: Board, order: number[], from: number, keys: SlotKey[], picks: Picks): number;
export function simulate(board: Board, picks: Picks): SeasonResult;
export function shareText(board: Board, result: SeasonResult, label: string): string;
