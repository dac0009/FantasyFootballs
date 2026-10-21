import type { Matchup, Player, RosterRow } from './types';

export type Rng = () => number;
export type SlotTemplate = Record<string, number>;
export type SlotKey = { key: string; slot: string };
export type Lineup = Record<string, number | null>;

export interface GamePlayer {
  player_id: number;
  name: string;
  position: string;
  nfl_team: string | null;
  projected: number | null;
  points: number;
  started: boolean;
  slot: string;
  team_id: number;
}
export interface PoolPlayer extends GamePlayer {
  from_team: string;
  from_owner_id: string | null;
}
export interface TeamInfo {
  name: string;
  owner_id: string | null;
}
export interface Game {
  season: number;
  week: number;
  you: TeamInfo & { teamId: number; recorded: number | null };
  opponent: TeamInfo & { teamId: number; points: number };
  template: SlotTemplate;
  keys: SlotKey[];
  roster: GamePlayer[];
  pool: PoolPlayer[];
  actual: { lineup: Lineup; points: number };
  optimal: { lineup: Lineup; points: number };
}

export function hashSeed(text: string): number;
export function mulberry32(seed: number): Rng;
export function pick<T>(rng: Rng, list: T[]): T;
export function dailyKey(date?: Date, timeZone?: string): string;
export function eligible(position: string, slot: string): boolean;
export function slotTemplate(rows: RosterRow[]): SlotTemplate;
export function slotKeys(template: SlotTemplate): SlotKey[];
export function teamCandidates(rows: RosterRow[], matchups: Matchup[]): number[];
export function pickSeasonWeek(rng: Rng, seasons: { season: number; weeks: number[] }[]): { season: number; week: number };
export function pickTeams(rng: Rng, candidates: number[]): { teamId: number; opponentId: number };
export function actualLineup(roster: GamePlayer[], keys: SlotKey[]): { lineup: Lineup; points: number };
export function optimalLineup(players: GamePlayer[], template: SlotTemplate): { lineup: Lineup; points: number };
export function lineupPoints(lineup: Lineup, byId: Map<number, { points: number }>): number;
export function validateLineup(lineup: Lineup, template: SlotTemplate, byId: Map<number, GamePlayer>): string[];
export function buildGame(input: {
  season: number;
  week: number;
  teamId: number;
  opponentId: number;
  rows: RosterRow[];
  players: Player[] | Map<number, Player>;
  matchups: Matchup[];
  teams: Map<number, TeamInfo>;
}): Game;
