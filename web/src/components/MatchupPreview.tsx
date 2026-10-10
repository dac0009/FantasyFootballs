import { points } from "../lib/format";
import type { MatchupPreview as Preview, ScoringModel } from "../lib/types";
import { Metric, OwnerLink, RivalryLink } from "./primitives";

function pct(value: number): string {
  if (value >= 0.995) return ">99%";
  if (value <= 0.005) return "<1%";
  return `${Math.round(value * 100)}%`;
}

function Side({
  name,
  ownerId,
  winPct,
  model,
  swing,
  align,
}: {
  name: string | null;
  ownerId: string;
  winPct: number;
  model: ScoringModel;
  swing: { if_win: number; if_loss: number };
  align: "left" | "right";
}) {
  const favourite = winPct >= 0.5;
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div
        style={{
          fontWeight: favourite ? 600 : 400,
          color: favourite ? "var(--color-hi)" : "var(--color-mid)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <OwnerLink ownerId={ownerId}>{name}</OwnerLink>
      </div>
      <div className="figure" style={{ fontSize: "1.5rem", marginTop: "0.15rem", color: favourite ? "var(--color-hi)" : "var(--color-mid)" }}>
        {pct(winPct)}
      </div>
      <div style={{ color: "var(--color-low)", fontSize: "0.76rem", marginTop: "0.25rem" }}>
        typically {points(model.low, 0)}&ndash;{points(model.high, 0)}
      </div>
      <div style={{ fontSize: "0.76rem", marginTop: "0.15rem" }}>
        <span style={{ color: "var(--color-low)" }}>playoffs </span>
        <span className="num-pos">{pct(swing.if_win)}</span>
        <span style={{ color: "var(--color-low)" }}> / </span>
        <span className="num-neg">{pct(swing.if_loss)}</span>
      </div>
    </div>
  );
}

/**
 * One upcoming matchup, with the three numbers that matter: who is likely
 * to win, what each team usually scores, and what the result does to each
 * team's playoff odds.
 */
export function MatchupPreviewCard({ preview, featured }: { preview: Preview; featured?: boolean }) {
  return (
    <div
      className={featured ? "panel" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        gap: "0.8rem",
        alignItems: "start",
        padding: featured ? undefined : "0.8rem 0",
        borderBottom: featured ? undefined : "1px solid var(--color-line-soft)",
      }}
    >
      <Side
        name={preview.away_team_name}
        ownerId={preview.away_owner_id}
        winPct={preview.away_win_pct}
        model={preview.away_model}
        swing={preview.away_swing}
        align="left"
      />
      <div style={{ textAlign: "center", color: "var(--color-low)", fontSize: "0.74rem", paddingTop: "0.3rem" }}>
        <div>at</div>
        <div style={{ marginTop: "1.1rem" }}>
          <RivalryLink a={preview.home_owner_id} b={preview.away_owner_id}>
            history
          </RivalryLink>
        </div>
      </div>
      <Side
        name={preview.home_team_name}
        ownerId={preview.home_owner_id}
        winPct={preview.home_win_pct}
        model={preview.home_model}
        swing={preview.home_swing}
        align="right"
      />
    </div>
  );
}

export function PreviewLegend() {
  return (
    <p style={{ color: "var(--color-low)", fontSize: "0.78rem", margin: "0.7rem 0 0" }}>
      Percentages are <Metric name="win_probability">win probability</Metric> from each team's scoring
      so far; the range is one standard deviation around a team's expected score; the green/red pair is{" "}
      <Metric name="playoff_swing">playoff odds if they win / if they lose</Metric>. Games are ordered
      by how much they move the playoff picture.
    </p>
  );
}
