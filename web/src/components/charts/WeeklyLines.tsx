import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisProps, seriesColor } from "../../lib/chartTheme";
import { points } from "../../lib/format";

export interface WeeklyPoint {
  week: number;
  [team: string]: number | null;
}

/**
 * Weekly scoring for every team. Twelve lines at once is unreadable, so the
 * legend is a filter: clicking a team isolates it against the rest, which are
 * kept as context at low contrast.
 */
export function WeeklyLines({
  data,
  teams,
  leagueMean,
  xLabel = "Week",
  tooltipLabel = (value) => `Week ${value}`,
}: {
  data: WeeklyPoint[];
  teams: string[];
  leagueMean?: number | null;
  xLabel?: string;
  tooltipLabel?: (value: number | string) => string;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  if (!data.length || !teams.length) return null;

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 22, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
          <XAxis
            dataKey="week"
            {...axisProps}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -12,
              fill: CHART.text,
              fontSize: 12,
            }}
          />
          <YAxis {...axisProps} width={46} />
          {leagueMean ? (
            <ReferenceLine
              y={leagueMean}
              stroke={CHART.brass}
              strokeDasharray="4 4"
              label={{
                value: "League average",
                fill: CHART.brass,
                fontSize: 10.5,
                position: "insideTopRight",
              }}
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: "3 3" }}
            contentStyle={{
              background: CHART.surface,
              border: "1px solid #2b313b",
              borderRadius: 3,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.textHi }}
            labelFormatter={tooltipLabel}
            formatter={(value: number, name: string) => [points(value, 1), name]}
            itemSorter={(item) => -(item.value as number)}
          />
          {teams.map((team, index) => {
            const dimmed = focus !== null && focus !== team;
            return (
              <Line
                key={team}
                type="monotone"
                dataKey={team}
                stroke={dimmed ? CHART.grid : seriesColor(index)}
                strokeWidth={focus === team ? 2.6 : 1.5}
                strokeOpacity={dimmed ? 0.55 : 1}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      <div className="pill-row" style={{ padding: "0.6rem 0.4rem 0.2rem" }}>
        {teams.map((team, index) => (
          <button
            key={team}
            type="button"
            className="pill"
            aria-pressed={focus === team}
            onClick={() => setFocus(focus === team ? null : team)}
            style={
              focus === team
                ? undefined
                : { borderColor: seriesColor(index), color: "var(--color-mid)" }
            }
          >
            {team}
          </button>
        ))}
      </div>
    </div>
  );
}
