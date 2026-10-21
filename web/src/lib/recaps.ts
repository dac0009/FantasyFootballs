import { useEffect, useState } from "react";
import type { Async } from "./data";
import { decodeIssue, mergeIssues, type LinkedIssue } from "./recapLinks.mjs";

/**
 * The recap archive has two sources, merged for display:
 *
 *  - Issues written in Google Docs. The commissioner pastes a share link on
 *    the Recaps page; it is stored as one editor document and read live from
 *    Google, so editing the Doc updates the site by itself.
 *  - PDFs in web/public/recaps, listed in archive.json by
 *    scripts/recaps_manifest.py at build time.
 *
 * A Doc and a PDF for the same week share a slug, and the Doc wins, so moving
 * an old issue into Docs is just pasting its link.
 */
export type Issue = LinkedIssue;

interface Manifest {
  generated_at: string;
  issues: Issue[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const recapFile = (name: string) => `${BASE}/recaps/${encodeURIComponent(name)}`;

let cached: Promise<Issue[]> | null = null;

function load(): Promise<Issue[]> {
  if (!cached) {
    cached = fetch(`${BASE}/recaps/archive.json`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "The PDF archive has not been built yet. Run `npm run recaps` in web/."
              : `Could not load the PDF archive (HTTP ${response.status}).`,
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

/** Issues from the PDF manifest only. */
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

/** Everything saved from the site, read from the editor documents everyone can see. */
export function storedIssues(documents: { kind: string; key: string; body: { text?: string; display?: string } }[]): Issue[] {
  const out: Issue[] = [];
  for (const doc of documents) {
    if (doc.kind !== "copy" || doc.body?.display === "hidden") continue;
    const issue = decodeIssue(doc.key, doc.body?.text);
    if (issue) out.push(issue);
  }
  return out;
}

/** Merge rules (links replace PDFs, removals hide, overrides edit) live in recapLinks.mjs so they are tested. */
export { mergeIssues };

export const coverSrc = (issue: Issue): string | null =>
  issue.link?.thumb ?? (issue.cover ? recapFile(issue.cover) : null);

/** The PDF to download, if the issue has one. */
export const pdfHref = (issue: Issue): string | null =>
  issue.link ? issue.link.download : issue.pdf ? recapFile(issue.pdf) : null;

/** Where "open" goes: Google for linked issues, the PDF for committed ones. */
export const openHref = (issue: Issue): string | null => issue.link?.open ?? pdfHref(issue);

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
