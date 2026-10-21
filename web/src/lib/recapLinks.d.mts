export const KEY_PREFIX: string;
export const MAX_TEXT: number;

export interface GoogleRef {
  kind: 'gdoc' | 'drive';
  id: string;
  published: boolean;
}
export interface GoogleLinks {
  embed: string;
  open: string;
  download: string | null;
  edit: string | null;
  thumb: string | null;
}
export interface LinkedIssue {
  slug: string;
  season: number;
  weeks: number[];
  title: string;
  dek: string;
  dateLabel: string | null;
  label: string | null;
  pdf: string | null;
  cover: string | null;
  docx: string | null;
  pages: number;
  link?: GoogleLinks & { kind: GoogleRef['kind']; id: string; url: string };
  stored?: boolean;
  /** A link-less metadata override of an issue already in the archive. */
  override?: boolean;
  /** A removal entry: hides whatever issue carries this slug. */
  removed?: boolean;
}

export function encodeRemoval(fields: { season: number | string; weeks?: number[]; label?: string | null; slug: string }): { key: string; text: string };
export function mergeIssues(manifest: LinkedIssue[], stored: LinkedIssue[]): LinkedIssue[];

export function parseGoogleLink(url: string | null | undefined): GoogleRef | null;
export function linksFor(ref: GoogleRef): GoogleLinks;
export function parseWeeks(text: string | null | undefined): number[];
export function slugFor(season: number, weeks: number[], title?: string | null): string;
export function recapKey(season: number, slug: string): string;
export function encodeIssue(fields: {
  url?: string; season: number | string; weeks: number[] | string;
  title?: string; dek?: string; dateLabel?: string; label?: string; slug?: string;
}): { key: string; text: string };
export function decodeIssue(key: string, text: string | undefined | null): LinkedIssue | null;
