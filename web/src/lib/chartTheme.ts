/** Shared chart tokens so every figure matches the page, not Recharts' defaults. */

export const CHART = {
  base: "#0f1115",
  surface: "#171a20",
  grid: "#242a33",
  axis: "#6a7280",
  text: "#98a1ae",
  textHi: "#e8ebf0",
  brass: "#c8963e",
  steel: "#6e9bc5",
  pos: "#4e9e72",
  neg: "#c25b52",
} as const;

/** A restrained 12-step series palette: cool neutrals with two warm anchors. */
export const SERIES = [
  "#6e9bc5",
  "#c8963e",
  "#79b394",
  "#b4788f",
  "#8d93c7",
  "#c58d6e",
  "#6fa9b0",
  "#a9a86e",
  "#9d7fb0",
  "#5f8878",
  "#c47a74",
  "#8697a8",
] as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.text, fontSize: 11 },
  tickLine: false,
} as const;
