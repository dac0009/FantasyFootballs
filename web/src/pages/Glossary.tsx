import { Band } from "../components/primitives";
import { METRICS } from "../lib/metricDefinitions";
import { generatedAt } from "../lib/format";
import type { Meta } from "../lib/types";

/**
 * Every custom metric is defined here with its formula and its limitations.
 * This page exists so that no number anywhere on the site is unexplained.
 */
export default function Glossary({ meta }: { meta: Meta }) {
  const order = [
    "playoff_odds",
    "win_probability",
    "playoff_swing",
    "all_play",
    "expected_wins",
    "schedule_luck",
    "sos_z",
    "sos_points",
    "consistency",
    "dominance",
    "bad_beat_index",
    "fortunate_win_index",
    "manager_efficiency",
    "bench_regret",
    "rivalry_index",
    "rival",
    "game_of_week",
  ];

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.9rem, 5vw, 2.8rem)" }}>Glossary</h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Nothing on this site is computed in your browser. A Python pipeline reads the league's
        history from ESPN, works out every statistic, and publishes plain JSON files that these
        pages only format and chart. If a number here looks wrong, it is wrong in the data, which
        makes it findable and fixable.
      </p>

      <Band title="Ground rules" />
      <div className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        <ul style={{ paddingLeft: "1.2rem", display: "grid", gap: "0.55rem" }}>
          <li>
            <strong>Owners, not team names.</strong> Team names change almost every season. Career
            and all-time records aggregate by the person who managed the team, using ESPN's member
            account as the identity. Historical pages always show the team name that existed in
            that season.
          </li>
          <li>
            <strong>Only completed games count.</strong> A scheduled future matchup is displayed
            but never included in a record, average or standing.
          </li>
          <li>
            <strong>Regular season is the default.</strong> Records, rate statistics and all-play
            cover the regular season unless a page says otherwise, because mixing a consolation
            ladder into a career win percentage produces a number nobody can interpret. Playoff and
            consolation games are separated and can be viewed on their own.
          </li>
          <li>
            <strong>A tie counts as half a win</strong> in every win percentage.
          </li>
          <li>
            <strong>Standard deviation is the sample kind</strong> (dividing by n&minus;1). A team
            with a single game shows no standard deviation rather than zero, which would wrongly
            suggest perfect consistency.
          </li>
          <li>
            <strong>Season lengths differ.</strong> The league has changed size and schedule length
            over the years, so counting records such as "most wins in a season" show the number of
            games alongside them.
          </li>
          <li>
            <strong>Playoff byes are not games.</strong> They appear in the bracket and are
            excluded from every statistic.
          </li>
        </ul>
      </div>

      <Band title="Metric definitions" note="Formula and limitations for each" />
      <dl style={{ margin: "0.9rem 0 0" }}>
        {order
          .filter((key) => METRICS[key])
          .map((key) => {
            const metric = METRICS[key];
            return (
              <div key={key} id={key.replace(/_/g, "-")} className="metric-row">
                <dt>{metric.label}</dt>
                <dd>
                  <p style={{ margin: 0 }}>{metric.short}</p>
                  {metric.formula ? (
                    <p className="metric-formula">
                      <span>Formula</span> {metric.formula}
                    </p>
                  ) : null}
                  {metric.limitation ? (
                    <p className="metric-limitation">
                      <span>Limitation</span> {metric.limitation}
                    </p>
                  ) : null}
                </dd>
              </div>
            );
          })}
      </dl>

      <Band title="Playoff odds" id="playoff-odds" />
      <div className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        <p>
          The rest of the regular season is played out 5,000 times. In each run, every remaining
          game is decided by drawing a score for both teams from a normal distribution: the team's
          average so far, pulled toward the league average in proportion to how few games it has
          played, with a standard deviation pooled across the whole league (a single team's spread
          over four games is too noisy to trust). Final standings rank by wins, then points. The
          top six make the bracket and the top two get byes, matching the league's settings.
        </p>
        <p>
          The "win / lose" column re-runs the simulation twice with this week's game forced each
          way. The gap between the two is how much the game matters to that team, and the week's
          games are ordered by the sum of that gap for both sides.
        </p>
        <p>
          <strong>What it assumes:</strong> that every team keeps scoring the way it has. It
          knows nothing about injuries, bye weeks, trades or lineup changes, and it does not know
          ESPN's exact tiebreaker. Early in the season it deliberately leans toward the league
          average, so September odds cluster near six-in-twelve and sharpen as games are played.
          Treat 70% as "likely", not "certain".
        </p>
      </div>

      <Band title="Game of the Week" id="game-of-the-week" />
      <div className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        <p>
          Every scheduled matchup in the next unplayed week is scored on five components, each
          scaled from 0 to 1 and then weighted: team quality (30%), how evenly matched the two
          teams are (25%), what the game decides (20%), recent scoring form over the last three
          weeks (15%), and rivalry history (10%). The highest total is the pick, and the reasons
          shown on the homepage are generated from whichever components actually drove it.
        </p>
        <p>
          <strong>ESPN projections are not used.</strong> ESPN exposes projected team totals only
          while a week is live, and never for a future week or historically. Rather than invent
          one, the "projected margin" shown with the pick comes from each team's own season scoring
          average and is labelled as such.
        </p>
      </div>

      <Band title="Where the data comes from" />
      <div className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        <p>
          Results, standings and owner identity come from ESPN's fantasy API and are reliable for
          every season this league has played. Lineup-level data, drafts and transactions are less
          consistent: ESPN does not serve them uniformly for older seasons. Where something could
          not be retrieved it is recorded as a limitation rather than estimated, and the affected
          pages say so instead of showing a blank.
        </p>
        {meta.limitations.length ? (
          <>
            <p style={{ marginBottom: "0.4rem" }}>
              <strong>Known gaps in the current dataset:</strong>
            </p>
            <ul style={{ paddingLeft: "1.2rem", display: "grid", gap: "0.35rem" }}>
              {meta.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>No data gaps were recorded in the most recent refresh.</p>
        )}
      </div>

      <Band title="This dataset" />
      <dl className="facts">
        <div>
          <dt>Source</dt>
          <dd>{meta.source === "espn" ? "ESPN Fantasy Football API" : "Generated sample league"}</dd>
        </div>
        <div>
          <dt>Last refreshed</dt>
          <dd>{generatedAt(meta.generated_at, meta.league.timezone)}</dd>
        </div>
        <div>
          <dt>Seasons</dt>
          <dd>
            {meta.seasons[0]}&ndash;{meta.seasons[meta.seasons.length - 1]}
          </dd>
        </div>
        <div>
          <dt>Pipeline version</dt>
          <dd>
            {meta.pipeline_version} (schema {meta.schema_version})
          </dd>
        </div>
        {Object.entries(meta.counts).map(([key, value]) => (
          <div key={key}>
            <dt>{key.replace(/_/g, " ")}</dt>
            <dd>{value.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>

      <Band title="Privacy" />
      <p className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        ESPN identifies league members by an account GUID, which is the same value as an ESPN
        session identifier. It is never published here. The datasets behind this site carry only a
        one-way hash of it, so owner history stays linked across seasons without exposing anyone's
        ESPN account. No ESPN credentials are ever sent to your browser; the site is static files
        only.
      </p>

      <style>{`
        .metric-row {
          display: grid; gap: 0.3rem 1.5rem; padding: 0.95rem 0;
          border-bottom: 1px solid var(--color-line-soft); scroll-margin-top: 4.5rem;
        }
        @media (min-width: 820px) { .metric-row { grid-template-columns: 13rem 1fr; } }
        .metric-row dt {
          font-family: var(--font-display); font-weight: 600; font-size: 0.98rem;
        }
        .metric-row dd { margin: 0; color: var(--color-mid); font-size: 0.89rem; line-height: 1.6; }
        .metric-formula, .metric-limitation { margin: 0.4rem 0 0; font-size: 0.85rem; }
        .metric-formula span, .metric-limitation span {
          color: var(--color-low); margin-right: 0.4rem;
        }
        .metric-formula { color: var(--color-hi); }
        .metric-limitation { color: var(--color-low); }
        .facts { display: grid; gap: 0; margin: 0.9rem 0 0; }
        @media (min-width: 680px) { .facts { grid-template-columns: 1fr 1fr; gap: 0 2.5rem; } }
        .facts > div {
          display: flex; justify-content: space-between; gap: 1rem;
          padding: 0.42rem 0; border-bottom: 1px solid var(--color-line-soft);
          font-size: 0.86rem;
        }
        .facts dt { color: var(--color-low); }
        .facts dd { margin: 0; }
      `}</style>
    </div>
  );
}
