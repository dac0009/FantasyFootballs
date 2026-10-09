import { Link } from "react-router-dom";
import { CHART } from "../lib/chartTheme";
import { points } from "../lib/format";
import type { GameOfWeek } from "../lib/types";
import { Metric, OwnerLink, RivalryLink } from "./primitives";

/**
 * The feature slot on the homepage. It must justify the pick, so the reasons
 * the model produced are shown verbatim alongside the component scores that
 * drove them.
 */
export function GameOfWeekPanel({ data }: { data: GameOfWeek }) {
  const { pick, model, week } = data;
  const components = Object.entries(pick.components).sort(
    (a, b) => (model.weights[b[0]] ?? 0) * b[1] - (model.weights[a[0]] ?? 0) * a[1],
  );

  return (
    <section
      className="panel"
      style={{ borderTopWidth: 3, borderTopColor: "var(--color-brass)", borderRadius: "0 0 3px 3px" }}
    >
      <p style={{ color: "var(--color-brass)", fontSize: "0.8rem", margin: 0, fontWeight: 600 }}>
        Game of the week &middot; Week {week}
      </p>

      <h3 style={{ fontSize: "clamp(1.25rem, 3vw, 1.7rem)", margin: "0.5rem 0 0.1rem" }}>
        <OwnerLink ownerId={pick.away_owner_id} className="">
          {pick.away_team_name}
        </OwnerLink>
        <span style={{ color: "var(--color-low)", fontWeight: 500 }}> at </span>
        <OwnerLink ownerId={pick.home_owner_id} className="">
          {pick.home_team_name}
        </OwnerLink>
      </h3>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "0.9rem 0 0",
          display: "grid",
          gap: "0.3rem",
          color: "var(--color-mid)",
          fontSize: "0.88rem",
        }}
      >
        {pick.reasons.slice(0, 5).map((reason) => (
          <li key={reason} style={{ display: "flex", gap: "0.55rem" }}>
            <span aria-hidden="true" style={{ color: "var(--color-brass)" }}>
              &bull;
            </span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>

      {pick.projection ? (
        <p style={{ color: "var(--color-mid)", fontSize: "0.88rem", margin: "0.7rem 0 0" }}>
          Season averages put this within {points(pick.projection.expected_margin, 1)} points &mdash;{" "}
          <span style={{ color: "var(--color-low)" }}>
            {points(pick.projection.away_expected, 1)} to{" "}
            {points(pick.projection.home_expected, 1)}. Not an ESPN projection; ESPN does not
            publish one for a future week.
          </span>
        </p>
      ) : null}

      <div style={{ marginTop: "1.1rem", display: "grid", gap: "0.45rem" }}>
        {components.map(([name, value]) => (
          <div key={name} style={{ display: "grid", gridTemplateColumns: "6.5rem 1fr 2.6rem", gap: "0.6rem", alignItems: "center" }}>
            <span style={{ color: "var(--color-low)", fontSize: "0.76rem", textTransform: "capitalize" }}>
              {name}
            </span>
            <span style={{ height: "0.3rem", background: "var(--color-line)", display: "block" }}>
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(value * 100)}%`,
                  background: name === "rivalry" ? CHART.brass : CHART.steel,
                }}
              />
            </span>
            <span style={{ color: "var(--color-mid)", fontSize: "0.76rem", textAlign: "right" }}>
              {(model.weights[name] * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <p style={{ margin: "1rem 0 0", fontSize: "0.82rem" }}>
        <RivalryLink a={pick.home_owner_id} b={pick.away_owner_id}>
          Rivalry history
        </RivalryLink>
        <span style={{ color: "var(--color-line)", margin: "0 0.6rem" }}>|</span>
        <Link to="/methodology#game-of-the-week" className="link-quiet">
          <Metric name="game_of_week">How the pick is made</Metric>
        </Link>
      </p>
    </section>
  );
}
