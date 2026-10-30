import type { DraftablePlayer } from './gauntletEngine.mjs';

export interface PlaysFile {
  season: number;
  games: Record<string, string>;
  weeks: Record<string, Record<string, [number, number, string, string, number, string, PlayField | null][]>>;
}
/** [offense, yards to the goal before the snap, yards gained, kind, air yards, down, to go, touchdown, return yards] */
export type PlayField = [string, number, number, string, number | null, number | null, number | null, number, number];
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
  highlight: boolean;
  field: PlayField | null;
  gameId?: string;
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
export function isHighlight(field: PlayField | null): boolean;
export function spotLabel(offense: string, defense: string, yardline100: number): string;
export function downLabel(down: number | null, togo: number | null, yardline100: number): string;
export const MAX_HIGHLIGHTS: number;
export function summarize(parts: string[], name?: string): string;
