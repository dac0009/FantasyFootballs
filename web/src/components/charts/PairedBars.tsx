import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisProps } from "../../lib/chartTheme";
import { points } from "../../lib/format";

/** Actual wins against expected wins, team by team. */
export function PairedBars({
  data,
  height = 400,
}: {
  data: { name: string; actual: number; expected: number }[];
  height?: number;
}) {
  if (!data.length) return null;
  const sorted = [...data].sort((a, b) => a.expected - b.expected);
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 4, right: 22, bottom: 24, left: 4 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            {...axisProps}
            label={{
              value: "Wins",
              position: "insideBottom",
              offset: -12,
              fill: CHART.text,
              fontSize: 12,
            }}
          />
          <YAxis type="category" dataKey="name" width={150} {...axisProps} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            contentStyle={{
              background: CHART.surface,
              border: "1px solid #2b313b",
              borderRadius: 3,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.textHi }}
            formatter={(value: number, name: string) => [points(value, 1), name]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: CHART.text, paddingTop: 6 }}
            iconType="square"
          />
          <Bar dataKey="actual" name="Actual wins" fill={CHART.steel} isAnimationActive={false} />
          <Bar
            dataKey="expected"
            name="Expected wins"
            fill={CHART.brass}
            fillOpacity={0.8}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
