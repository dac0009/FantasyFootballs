import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, axisProps } from "../../lib/chartTheme";
import { signed } from "../../lib/format";

export interface DivergingDatum {
  name: string;
  value: number;
  detail?: string;
}

/** Horizontal bars diverging from zero: schedule luck, point differential. */
export function DivergingBars({
  data,
  height = 380,
  axisLabel,
  positiveLabel,
  negativeLabel,
}: {
  data: DivergingDatum[];
  height?: number;
  axisLabel?: string;
  positiveLabel?: string;
  negativeLabel?: string;
}) {
  if (!data.length) return null;
  const sorted = [...data].sort((a, b) => a.value - b.value);
  const extent = Math.max(...sorted.map((d) => Math.abs(d.value))) * 1.3 || 1;

  return (
    <div className="chart-frame">
      {positiveLabel || negativeLabel ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.74rem",
            color: CHART.text,
            padding: "0 0.4rem 0.3rem",
          }}
        >
          <span style={{ color: CHART.neg }}>{negativeLabel}</span>
          <span style={{ color: CHART.pos }}>{positiveLabel}</span>
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 4, right: 46, bottom: axisLabel ? 26 : 8, left: 4 }}
          barCategoryGap="22%"
        >
          <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            domain={[-extent, extent]}
            {...axisProps}
            label={
              axisLabel
                ? {
                    value: axisLabel,
                    position: "insideBottom",
                    offset: -12,
                    fill: CHART.text,
                    fontSize: 12,
                  }
                : undefined
            }
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            {...axisProps}
            tick={{ fill: CHART.text, fontSize: 11 }}
          />
          <ReferenceLine x={0} stroke={CHART.brass} strokeWidth={1.5} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            contentStyle={{
              background: CHART.surface,
              border: "1px solid #2b313b",
              borderRadius: 3,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.textHi }}
            formatter={(value: number, _k, item) => [
              signed(value),
              (item?.payload as DivergingDatum)?.detail ?? "",
            ]}
          />
          <Bar dataKey="value" isAnimationActive={false}>
            {sorted.map((d) => (
              <Cell key={d.name} fill={d.value >= 0 ? CHART.pos : CHART.neg} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => signed(v)}
              style={{ fill: CHART.text, fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
