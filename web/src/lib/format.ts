/** Formatting helpers. One place so a score looks identical on every page. */

export const nf1 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const nf2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const DASH = "\u2014";

export function points(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return DASH;
  return digits === 2 ? nf2.format(value) : nf1.format(value);
}

export function total(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return nf1.format(value);
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toFixed(3).replace(/^0\./, ".");
}

export function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return DASH;
  const formatted = digits === 2 ? nf2.format(Math.abs(value)) : nf1.format(Math.abs(value));
  if (Math.abs(value) < 0.005) return formatted;
  return `${value > 0 ? "+" : "\u2212"}${formatted}`;
}

export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Math.abs(value) < 0.005) return "";
  return value > 0 ? "num-pos" : "num-neg";
}

export function ordinal(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export const GAME_TYPE_LABEL: Record<string, string> = {
  regular: "Regular season",
  playoff: "Playoffs",
  consolation: "Consolation",
  postseason_other: "Postseason",
};

export function gameTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return GAME_TYPE_LABEL[value] ?? value;
}

export function weekLabel(season: number, week: number | null | undefined): string {
  if (!week) return `${season}`;
  return `${season} Week ${week}`;
}

export function generatedAt(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const dash = DASH;
