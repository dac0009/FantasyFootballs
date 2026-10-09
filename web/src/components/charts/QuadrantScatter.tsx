import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { CHART, axisProps } from "../../lib/chartTheme";
import { points } from "../../lib/format";
import type { StandingsRow } from "../../lib/types";

/**
 * Points For against Points Against, split into quadrants at the league
 * averages. The whole point of the figure is the quadrant a team sits in, so
 * the quadrants are labelled in place rather than explained in a legend.
 */
export function QuadrantScatter({ rows }: { rows: StandingsRow[] }) {
  const data = rows
    .filter((r) => r.points_for !== null && r.points_against !== null)
    .map((r) => ({
      x: r.points_for as number,
      y: r.points_against as number,
      name: r.team_name ?? r.owner_id,
      record: r.record,
      z: 100,
    }));
  if (data.length < 2) return null;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xAvg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yAvg = ys.reduce((a, b) => a + b, 0) / ys.length;
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.12 || 10;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.12 || 10;
  const xDomain: [number, number] = [Math.min(...xs) - padX, Math.max(...xs) + padX];
  const yDomain: [number, number] = [Math.min(...ys) - padY, Math.max(...ys) + padY];

  const quadrant = (
    x1: number,
    x2: number,
    y1: number,
    y2: number,
    text: string,
    fill?: string,
  ) => (
    <ReferenceArea
      key={text}
      x1={x1}
      x2={x2}
      y1={y1}
      y2={y2}
      stroke="none"
      fill={fill ?? "transparent"}
      fillOpacity={fill ? 0.07 : 0}
      label={{ value: text, fill: CHART.axis, fontSize: 10.5, position: "center" }}
    />
  );

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 34, left: 8 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            domain={xDomain}
            {...axisProps}
            label={{
              value: "Points for",
              position: "insideBottom",
              offset: -18,
              fill: CHART.text,
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain}
            {...axisProps}
            label={{
              value: "Points against",
              angle: -90,
              position: "insideLeft",
              offset: 14,
              fill: CHART.text,
              fontSize: 12,
            }}
          />
          <ZAxis dataKey="z" range={[90, 90]} />
          {quadrant(xAvg, xDomain[1], yDomain[0], yAvg, "Scoring well, easy schedule", CHART.pos)}
          {quadrant(xAvg, xDomain[1], yAvg, yDomain[1], "Scoring well, hard schedule")}
          {quadrant(xDomain[0], xAvg, yDomain[0], yAvg, "Scoring poorly, easy schedule")}
          {quadrant(xDomain[0], xAvg, yAvg, yDomain[1], "Scoring poorly, hard schedule", CHART.neg)}
          <ReferenceLine x={xAvg} stroke={CHART.brass} strokeDasharray="4 4" />
          <ReferenceLine y={yAvg} stroke={CHART.brass} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            contentStyle={{
              background: CHART.surface,
              border: "1px solid #2b313b",
              borderRadius: 3,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.textHi }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <div
                  style={{
                    background: CHART.surface,
                    border: "1px solid #2b313b",
                    borderRadius: 3,
                    padding: "0.5rem 0.65rem",
                    fontSize: 12,
                  }}
                >
                  <div style={{ color: CHART.textHi, fontWeight: 600 }}>{d.name}</div>
                  <div style={{ color: CHART.text }}>{d.record}</div>
                  <div style={{ color: CHART.text }}>
                    {points(d.x, 1)} for / {points(d.y, 1)} against
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            data={data}
            fill={CHART.steel}
            stroke={CHART.textHi}
            strokeWidth={1}
            fillOpacity={0.85}
            label={{
              dataKey: "name",
              position: "top",
              fill: CHART.text,
              fontSize: 10.5,
              offset: 9,
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
