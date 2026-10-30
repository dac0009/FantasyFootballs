import type { DraftablePlayer } from './gauntletEngine.mjs';

export interface PlaysFile {
  season: number;
  games: Record<string, string>;
  weeks: Record<string, Record<string, [number, number, string, string, number, string][]>>;
}
export interface BroadcastEvent {
  side: 'you' | 'champ';
  qtr: number;
  clock: number;
  game: string;
  text: string;
  pts: number;
  play: string;
  players: DraftablePlayer[];
  parts: { player: DraftablePlayer; pts: number; text: string }[];
  score: { you: number; champ: number };
  big: boolean;
  touchdown: boolean;
}
export interface Broadcast {
  events: BroadcastEvent[];
  quarters: { you: number[]; champ: number[] };
  final: { you: number; champ: number };
}
export function buildBroadcast(
  plays: PlaysFile | null,
  week: number,
  you: { player: DraftablePlayer | null; points: number }[],
  champ: { player: DraftablePlayer | null; points: number }[],
  totals: { you: number; champ: number | null },
): Broadcast | null;
export function clockLabel(qtr: number, clock: number): string;
