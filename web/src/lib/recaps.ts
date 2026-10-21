/**
 * The recap archive. Every issue of The Record is a PDF (plus the Word file it
 * came from) sitting in web/public/recaps, listed here newest first.
 *
 * To add the next issue: drop `<slug>.pdf`, `<slug>.docx` and `<slug>-cover.png`
 * into web/public/recaps and add one entry at the top of ISSUES.
 */
export interface Issue {
  /** URL slug and asset basename, e.g. "ffbffl-2026-weeks-5-6". */
  slug: string;
  season: number;
  /** Weeks this issue covers. A combined issue lists each one. */
  weeks: number[];
  title: string;
  dek: string;
  /** Publication date, ISO. */
  published: string;
  /** Set false when there is no .docx beside the PDF. */
  word?: boolean;
}

export const ISSUES: Issue[] = [
  {
    slug: "ffbffl-2026-weeks-5-6",
    season: 2026,
    weeks: [5, 6],
    title: "Nobody Is Undefeated",
    dek: "Two weeks of results, one overdue public accounting, and a commissioner currently suspended by himself.",
    published: "2026-10-21",
    word: true,
  },
];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const issueAsset = (slug: string, ext: "pdf" | "docx" | "cover.png") =>
  `${BASE}/recaps/${slug}${ext === "cover.png" ? "-cover.png" : `.${ext}`}`;

export const findIssue = (slug: string | undefined) =>
  ISSUES.find((issue) => issue.slug === slug) ?? null;

/** "Weeks 5 & 6" / "Week 7" */
export function weekLabel(weeks: number[]): string {
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks.slice(0, -1).join(", ")} & ${weeks[weeks.length - 1]}`;
}

export function issueDate(published: string): string {
  const [year, month, day] = published.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Issues grouped by season, newest season first. */
export function bySeason(): { season: number; issues: Issue[] }[] {
  const seasons = [...new Set(ISSUES.map((i) => i.season))].sort((a, b) => b - a);
  return seasons.map((season) => ({
    season,
    issues: ISSUES.filter((i) => i.season === season).sort(
      (a, b) => b.weeks[b.weeks.length - 1] - a.weeks[a.weeks.length - 1],
    ),
  }));
}
