/**
 * The recap archive. Every issue of The Record is a PDF (plus the Word file it
 * came from, where there is one) sitting in web/public/recaps, listed here.
 *
 * To add the next issue: drop `<slug>.pdf` and `<slug>-cover.png` into
 * web/public/recaps and add one entry at the top of ISSUES. Add `<slug>.docx`
 * and `word: true` when there is an editable copy worth offering.
 */
export interface Issue {
  /** URL slug and asset basename, e.g. "ffbffl-2026-week-3". */
  slug: string;
  season: number;
  /** Weeks this issue covers. A combined issue lists each one; a preview has none. */
  weeks: number[];
  title: string;
  dek: string;
  /** As printed on the issue. Omitted when the issue carries no date. */
  dateLabel?: string;
  /** Overrides the "Week N" kicker, for issues that are not a weekly recap. */
  label?: string;
  /** Set when a .docx sits beside the PDF. */
  word?: boolean;
}

export const ISSUES: Issue[] = [
  {
    slug: "ffbffl-2026-weeks-5-6",
    season: 2026,
    weeks: [5, 6],
    title: "Nobody Is Undefeated",
    dek: "Two weeks of results, one overdue public accounting, and a commissioner currently suspended by himself.",
    dateLabel: "October 21, 2026",
    word: true,
  },
  {
    slug: "ffbffl-2026-week-4",
    season: 2026,
    weeks: [4],
    title: "Don't Call It a Comeback",
    dek: "The commissioner wins a game and immediately starts drawing up the winning streak.",
    dateLabel: "October 2026",
  },
  {
    slug: "ffbffl-2026-week-3",
    season: 2026,
    weeks: [3],
    title: "This House Is a Fucking Prison",
    dek: "A lightly modified Truman quote, eleven co-conspirators, and 154.10 points that still were not enough.",
    dateLabel: "September 29, 2026",
  },
  {
    slug: "ffbffl-2026-week-2",
    season: 2026,
    weeks: [2],
    title: "I Hate It Here!",
    dek: "The early standings take shape, though they say as much about scheduling luck as roster strength, and the injury list keeps growing.",
  },
  {
    slug: "ffbffl-2026-week-1",
    season: 2026,
    weeks: [1],
    title: "It's Week One and I Already Want to Kill Myself",
    dek: "Season eight opens with a few teams firing, others barely escaping with their dignity, and several managers already in trouble.",
  },
  {
    slug: "ffbffl-2026-preseason-preview",
    season: 2026,
    weeks: [],
    label: "Preseason preview",
    title: "The 2026 Preview",
    dek: "A letter from the commissioner, a word from the reigning champion, and twelve men convinced they will etch their name into the history books. Eleven of them are wrong.",
    dateLabel: "August 2026",
  },
];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const issueAsset = (slug: string, ext: "pdf" | "docx" | "cover.png") =>
  `${BASE}/recaps/${slug}${ext === "cover.png" ? "-cover.png" : `.${ext}`}`;

export const findIssue = (slug: string | undefined) =>
  ISSUES.find((issue) => issue.slug === slug) ?? null;

/** "Weeks 5 & 6" / "Week 7" / whatever `label` says. */
export function weekLabel(issue: Issue): string {
  if (issue.label) return issue.label;
  const { weeks } = issue;
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks.slice(0, -1).join(", ")} & ${weeks[weeks.length - 1]}`;
}

/** Issues grouped by season, newest season and newest issue first. */
export function bySeason(): { season: number; issues: Issue[] }[] {
  const seasons = [...new Set(ISSUES.map((i) => i.season))].sort((a, b) => b - a);
  const lastWeek = (i: Issue) => (i.weeks.length ? i.weeks[i.weeks.length - 1] : 0);
  return seasons.map((season) => ({
    season,
    issues: ISSUES.filter((i) => i.season === season).sort((a, b) => lastWeek(b) - lastWeek(a)),
  }));
}
