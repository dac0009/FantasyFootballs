import { useEffect, useState } from "react";
import type { Async } from "./data";

/**
 * The recap archive is built from the PDFs in web/public/recaps by
 * scripts/recaps_manifest.py, which writes index.json. Publishing an issue is
 * dropping a PDF in that folder; see the README there.
 */
export interface Issue {
  slug: string;
  season: number;
  /** Weeks this issue covers. A combined issue lists each one; a preview has none. */
  weeks: number[];
  title: string;
  dek: string;
  /** As printed on the issue, when it carries one. */
  dateLabel: string | null;
  /** Replaces the "Week N" kicker for issues that are not a weekly recap. */
  label: string | null;
  /** File names inside web/public/recaps. */
  pdf: string;
  cover: string | null;
  docx: string | null;
  pages: number;
}

interface Manifest {
  generated_at: string;
  issues: Issue[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const recapFile = (name: string) => `${BASE}/recaps/${encodeURIComponent(name)}`;

let cached: Promise<Issue[]> | null = null;

function load(): Promise<Issue[]> {
  if (!cached) {
    cached = fetch(`${BASE}/recaps/index.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "The recap archive has not been built yet. Run `npm run recaps` in web/."
              : `Could not load the recap archive (HTTP ${response.status}).`,
          );
        }
        return response.json() as Promise<Manifest>;
      })
      .then((manifest) => manifest.issues)
      .catch((error: Error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

export function useIssues(): Async<Issue[]> {
  const [result, setResult] = useState<Async<Issue[]>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setResult({ state: "ready", data }))
      .catch((error: Error) => live && setResult({ state: "error", error }));
    return () => {
      live = false;
    };
  }, []);
  return result;
}

/** "Weeks 5 & 6" / "Week 7" / whatever `label` says. */
export function weekLabel(issue: Issue): string {
  if (issue.label) return issue.label;
  const { weeks } = issue;
  if (weeks.length === 0) return "Special issue";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks.slice(0, -1).join(", ")} & ${weeks[weeks.length - 1]}`;
}

/** Issues grouped by season, newest season and newest issue first. */
export function bySeason(issues: Issue[]): { season: number; issues: Issue[] }[] {
  const seasons = [...new Set(issues.map((i) => i.season))].sort((a, b) => b - a);
  const lastWeek = (i: Issue) => (i.weeks.length ? i.weeks[i.weeks.length - 1] : 0);
  return seasons.map((season) => ({
    season,
    issues: issues.filter((i) => i.season === season).sort((a, b) => lastWeek(b) - lastWeek(a)),
  }));
}
