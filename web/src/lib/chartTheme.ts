/** Shared chart tokens: chalk on turf, like the rest of the field. */

export const CHART = {
  base: "#1e3b2b",
  surface: "#162d20",
  grid: "#2b4836",
  axis: "#90ab97",
  text: "#b7c9ba",
  textHi: "#edf1e6",
  brass: "#ffb52e", // scoreboard amber
  steel: "#b7c9ba",
  pos: "#93dc9e",
  neg: "#ff9183",
} as const;

/** Series palette: chalk-adjacent tones that stay legible on turf, with the
 *  amber anchor first so a highlighted line reads as the scoreboard. */
export const SERIES = [
  "#ffb52e",
  "#edf1e6",
  "#93dc9e",
  "#ff9183",
  "#9fd0e8",
  "#d8c27a",
  "#c5a3d6",
  "#8fc7b2",
  "#e8a46b",
  "#a9bfad",
  "#7fa8d9",
  "#d98fa6",
] as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.text, fontSize: 11 },
  tickLine: false,
} as const;
