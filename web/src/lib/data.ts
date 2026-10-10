import { useEffect, useState } from "react";
import type {
  CurrentPayload,
  DraftPick,
  GameOfWeek,
  H2HRecord,
  Meta,
  Matchup,
  OwnerIndexRow,
  OwnerPayload,
  Player,
  PlayoffPicture,
  RecordBook,
  RosterRow,
  SeasonIndexRow,
  SeasonPayload,
  TeamWeek,
} from "./types";

/**
 * Every dataset is a static JSON file under <base>/data. Fetches are cached
 * in-module so moving between pages never refetches, and nothing is loaded
 * until a page actually asks for it: the record book, rosters and drafts are
 * the big files and most visits never touch them.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const cache = new Map<string, Promise<unknown>>();

/**
 * Single-file builds (see scripts/build_single_file.py) embed every dataset
 * on `window.__LEAGUE_DATA__` so the page works with no network at all. The
 * normal GitHub Pages build leaves this undefined and fetches as usual.
 */
declare global {
  interface Window {
    __LEAGUE_DATA__?: Record<string, unknown>;
  }
}

function embedded<T>(path: string): T | undefined {
  const bundle = typeof window === "undefined" ? undefined : window.__LEAGUE_DATA__;
  return bundle ? (bundle[path] as T | undefined) : undefined;
}

export class DataError extends Error {
  constructor(public readonly path: string, public readonly status?: number) {
    super(
      status === 404
        ? `No data file at ${path}. Run the pipeline to generate it.`
        : `Could not load ${path}${status ? ` (HTTP ${status})` : ""}.`,
    );
  }
}

function load<T>(path: string): Promise<T> {
  const existing = cache.get(path);
  if (existing) return existing as Promise<T>;

  const inline = embedded<T>(path);
  if (inline !== undefined) {
    const resolved = Promise.resolve(inline);
    cache.set(path, resolved);
    return resolved;
  }
  // An embedded bundle that is missing this file is a real 404, not a reason
  // to fall back to the network: there is no server behind a single-file build.
  if (typeof window !== "undefined" && window.__LEAGUE_DATA__) {
    return Promise.reject(new DataError(path, 404));
  }

  const request = fetch(`${BASE}/data/${path}`)
    .then((response) => {
      if (!response.ok) throw new DataError(path, response.status);
      return response.json() as Promise<T>;
    })
    .catch((error) => {
      cache.delete(path);
      throw error instanceof DataError ? error : new DataError(path);
    });
  cache.set(path, request);
  return request;
}

export type Async<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; error: Error };

/** Load one dataset. `path` of null means "nothing to load yet". */
export function useData<T>(path: string | null): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: "loading" });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setResult({ state: "loading" });
    load<T>(path)
      .then((data) => live && setResult({ state: "ready", data }))
      .catch((error: Error) => live && setResult({ state: "error", error }));
    return () => {
      live = false;
    };
  }, [path]);
  return result;
}

/** Load several datasets as one unit, so a page renders once it has everything. */
export function useDataset<T extends Record<string, unknown>>(paths: {
  [K in keyof T]: string | null;
}): Async<T> {
  const key = JSON.stringify(paths);
  const [result, setResult] = useState<Async<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setResult({ state: "loading" });
    const entries = Object.entries(paths).filter(([, p]) => p) as [string, string][];
    Promise.all(entries.map(([name, path]) => load(path).then((data) => [name, data] as const)))
      .then((pairs) => {
        if (live) setResult({ state: "ready", data: Object.fromEntries(pairs) as T });
      })
      .catch((error: Error) => live && setResult({ state: "error", error }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result;
}

export const paths = {
  meta: "meta.json",
  seasons: "seasons.json",
  owners: "owners.json",
  current: "current.json",
  playoffs: "playoffs.json",
  gameOfWeek: "game_of_week.json",
  records: "records.json",
  headToHead: "head_to_head.json",
  matchups: "matchups.json",
  teamWeeks: "team_weeks.json",
  players: "players.json",
  season: (year: number | string) => `seasons/${year}.json`,
  owner: (ownerId: string) => `owners/${ownerId}.json`,
  draft: (year: number | string) => `drafts/${year}.json`,
  roster: (year: number | string) => `rosters/${year}.json`,
};

export const useMeta = () => useData<Meta>(paths.meta);
export const useSeasonIndex = () => useData<SeasonIndexRow[]>(paths.seasons);
export const useOwnerIndex = () => useData<OwnerIndexRow[]>(paths.owners);
export const useCurrent = () => useData<CurrentPayload>(paths.current);
export const usePlayoffs = () => useData<PlayoffPicture | null>(paths.playoffs);
export const useGameOfWeek = () => useData<GameOfWeek | null>(paths.gameOfWeek);
export const useRecordBook = () => useData<RecordBook>(paths.records);
export const useHeadToHead = () => useData<Record<string, H2HRecord>>(paths.headToHead);
export const useSeason = (year: number | string | null) =>
  useData<SeasonPayload>(year ? paths.season(year) : null);
export const useOwner = (ownerId: string | null) =>
  useData<OwnerPayload>(ownerId ? paths.owner(ownerId) : null);
export const useDraft = (year: number | string | null) =>
  useData<DraftPick[]>(year ? paths.draft(year) : null);
export const useRoster = (year: number | string | null) =>
  useData<RosterRow[]>(year ? paths.roster(year) : null);
export const usePlayers = () => useData<Player[]>(paths.players);
export const useMatchups = () => useData<Matchup[]>(paths.matchups);
export const useTeamWeeks = () => useData<TeamWeek[]>(paths.teamWeeks);

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}
