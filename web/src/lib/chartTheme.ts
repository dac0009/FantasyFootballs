/** Chart tokens for the print edition: dark ink on warm paper. */

export const CHART = {
  base: "#faf9f6",
  surface: "#f2f0eb",
  grid: "#e1ded7",
  axis: "#6b6964",
  text: "#505050",
  textHi: "#202020",
  brass: "#32627c", // editorial blue
  steel: "#505050",
  pos: "#37634b",
  neg: "#9a4037",
} as const;

/** Series palette: distinct inks with sufficient contrast on warm paper. */
export const SERIES = [
  "#32627c",
  "#202020",
  "#37634b",
  "#9a4037",
  "#516c93",
  "#8a691f",
  "#785b8c",
  "#3b766e",
  "#9a6149",
  "#6b6964",
  "#49658d",
  "#92576d",
] as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.text, fontSize: 11 },
  tickLine: false,
} as const;
