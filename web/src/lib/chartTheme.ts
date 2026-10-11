/** Chart tokens for the night edition: parchment ink on dark paper. */

export const CHART = {
  base: "#191410",
  surface: "#120e0b",
  grid: "#2a241c",
  axis: "#998d74",
  text: "#c4b89f",
  textHi: "#eae1cf",
  brass: "#e0742f", // ember
  steel: "#c4b89f",
  pos: "#a6c98a",
  neg: "#e08a6d",
} as const;

/** Series palette: inks that read on dark paper; ember anchors the first. */
export const SERIES = [
  "#e0742f",
  "#eae1cf",
  "#a6c98a",
  "#e08a6d",
  "#9db8d2",
  "#cdb36a",
  "#b795c9",
  "#8fbfae",
  "#d99a84",
  "#998d74",
  "#7f9fc9",
  "#c98fa6",
] as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.text, fontSize: 11 },
  tickLine: false,
} as const;
