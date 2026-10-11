/** Chart tokens for the print edition: dark ink on warm paper. */

export const CHART = {
  base: "#e9e3d6",
  surface: "#ded5c3",
  grid: "#cdc3ae",
  axis: "#62655d",
  text: "#445354",
  textHi: "#1d303a",
  brass: "#285568", // editorial blue
  steel: "#445354",
  pos: "#37634b",
  neg: "#9a4037",
} as const;

/** Series palette: distinct inks with sufficient contrast on warm paper. */
export const SERIES = [
  "#285568",
  "#1d303a",
  "#37634b",
  "#9a4037",
  "#516c93",
  "#8a691f",
  "#785b8c",
  "#3b766e",
  "#9a6149",
  "#62655d",
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
