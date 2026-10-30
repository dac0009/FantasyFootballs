import type { DraftPick, Player, RosterRow, TeamWeek } from './types';
import type { SlotKey, SlotTemplate } from './wheelEngine.mjs';

export const BENCH_SIZE: number;
export const WAIVER_CHOICES: number;

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
  projected: Record<number, number>;
  estimated: Record<number, boolean>;
  season_points: number;
}
export type Picks = Record<string, DraftablePlayer | null>;
export type Lineup = Record<string, DraftablePlayer | undefined>;
export interface Board {
  season: number;
  weeks: number[];
  template: SlotTemplate;
  keys: SlotKey[];
  benchKeys: SlotKey[];
  draftKeys: SlotKey[];
  teams: Map<number, ChampTeam>;
  champion: ChampTeam;
  championRoster: DraftablePlayer[];
  pools: Map<number, DraftablePlayer[]>;
  spinTeams: number[];
  games: TeamWeek[];
  waiverPool: Record<number, number[]>;
  estimatedWeeks: number[];
  describe: (id: number) => DraftablePlayer;
}
export type Status = 'active' | 'out' | 'nodata' | 'empty';
export interface WeekRow {
  key: string;
  slot: string;
  player: DraftablePlayer | null;
  points: number;
  projected: number | null;
  status: Status;
}
export interface WeekResult {
  week: number;
  you: number;
  champ: number | null;
  result: 'W' | 'L' | 'T' | null;
  rows: WeekRow[];
  allWins: number;
  allLosses: number;
  allTies: number;
  optimal?: number;
}
export interface TableRow {
  team_id: number | null;
  owner_id: string | null;
  name: string;
  points_for: number;
  you: boolean;
}
export type ScoredPlayer = DraftablePlayer & { total: number; starts: number };
export interface SeasonResult {
  weeks: WeekResult[];
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  optimal_points: number;
  lineup_iq: number;
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
  by_player: ScoredPlayer[];
  benched_points: number;
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
export function fits(position: string, slot: string): boolean;
export function slotsFor(player: DraftablePlayer, keys: SlotKey[], picks: Picks): SlotKey[];
export function spinOptions(board: Board, teamId: number, keys: SlotKey[], picks: Picks): DraftablePlayer[];
export function nextUsableSpin(board: Board, order: number[], from: number, keys: SlotKey[], picks: Picks): number;
export function outlook(player: DraftablePlayer, week: number): { projected: number | null; status: Status; estimated?: boolean };
export function actualPoints(player: DraftablePlayer, week: number): number;
export function bestLineup(board: Board, roster: DraftablePlayer[], week: number, by?: 'projected' | 'actual'): Lineup;
export function checkLineup(board: Board, roster: DraftablePlayer[], lineup: Lineup): string | null;
export function waiverOptions(board: Board, seed: string, week: number, rosterIds?: number[]): DraftablePlayer[];
export function playWeek(board: Board, week: number, lineup: Lineup): WeekResult;
export function optimalPoints(board: Board, roster: DraftablePlayer[], week: number): number;
export function summarize(board: Board, played: WeekResult[]): SeasonResult;
export function autoplay(board: Board, roster: DraftablePlayer[], fromWeekIndex?: number): WeekResult[];
export function shareText(board: Board, result: SeasonResult, label: string): string;
