import { Link } from "react-router-dom";
import { GameOfWeekPanel } from "../components/GameOfWeekPanel";
import { MatchupPreviewCard, PreviewLegend } from "../components/MatchupPreview";
import { PlayoffPicture } from "../components/PlayoffPicture";
import { Scoreboard } from "../components/Scoreboard";
import { ShareButton } from "../components/ShareButton";
import { Band, Empty, ErrorState, Figure, Loading, OwnerLink, WeekLink } from "../components/primitives";
import { useCurrent, useGameOfWeek } from "../lib/data";
import { points } from "../lib/format";
import type { CurrentPayload, Meta } from "../lib/types";

/**
 * The homepage answers, in order: where do I stand, what happens this week,
 * what just happened. No generated prose -- the numbers carry it.
 */
export default function Home({ meta }: { meta: Meta }) {
  const current = useCurrent();
  const gotw = useGameOfWeek();

  if (current.state === "loading") return <Loading what="this week" />;
  if (current.state === "error") return <ErrorState error={current.error} what="This week" />;

  const data = current.data;
  const week = data.week;
  const picture = data.playoff_picture;
  const previews = picture?.previews ?? [];
  const pick = gotw.state === "ready" && gotw.data ? gotw.data : null;
  const siteUrl = typeof window !== "undefined" ? window.location.origin + import.meta.env.BASE_URL : "";

  return (
    <div className="shell" style={{ paddingTop: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "var(--color-brass)", fontSize: "0.82rem", fontWeight: 600, margin: 0 }}>
            {meta.league.name} {data.season}
          </p>
          <h1 style={{ fontSize: "clamp(1.7rem, 5vw, 2.4rem)", marginTop: "0.3rem" }}>
            {week ? `Week ${week.week} is in the books` : "Preseason"}
            {data.upcoming_week ? (
              <span style={{ color: "var(--color-low)", fontWeight: 500 }}>
                {" "}
                \u2014 week {data.upcoming_week} next
              </span>
            ) : null}
          </h1>
        </div>
        <ShareButton
          title={`${meta.league.name} \u2014 Week ${week?.week ?? ""}`}
          text={shareText(data, meta)}
          url={siteUrl}
        />
      </div>

      {picture ? (
        <>
          <Band
            title="Playoff picture"
            note={`After week ${picture.as_of_week}, ${picture.remaining_regular_season_games} games left`}
          />
          <PlayoffPicture picture={picture} />
        </>
      ) : null}

      {previews.length ? (
        <>
          <Band
            title={`Week ${picture?.next_week} preview`}
            note="Ordered by how much each game moves the playoff picture"
          />
          <div className="home-split" style={{ marginTop: "0.4rem" }}>
            <div>
              {previews.map((preview) => (
                <MatchupPreviewCard key={preview.matchup_id} preview={preview} />
              ))}
              <PreviewLegend />
            </div>
            {pick ? <GameOfWeekPanel data={pick} /> : null}
          </div>
        </>
      ) : null}

      {week ? (
        <>
          <Band
            title={`Week ${week.week} results`}
            action={
              <p className="band-note">
                <WeekLink season={data.season} week={week.week}>
                  Full breakdown and player highlights
                </WeekLink>
              </p>
            }
          />
          <div className="home-figures">
            <Figure
              value={points(week.summary.high?.score, 1)}
              label={
                <>
                  High, 
                  <OwnerLink ownerId={week.summary.high?.owner_id}>{week.summary.high?.team_name}</OwnerLink>
                </>
              }
              size="1.6rem"
            />
            <Figure
              value={points(week.summary.low?.score, 1)}
              label={
                <>
                  Low, 
                  <OwnerLink ownerId={week.summary.low?.owner_id}>{week.summary.low?.team_name}</OwnerLink>
                </>
              }
              size="1.6rem"
            />
            <Figure value={points(week.summary.league_mean, 1)} label="League average" size="1.6rem" />
            <Figure value={points(week.summary.closest_game?.margin, 2)} label="Closest margin" size="1.6rem" />
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <Scoreboard matchups={week.matchups} showType />
          </div>
        </>
      ) : (
        <Empty>
          No completed games yet this season. The{" "}
          <Link to="/seasons" className="link-quiet">
            archive
          </Link>{" "}
          has every result since {meta.seasons[0]}.
        </Empty>
      )}

      {data.milestones.length ? (
        <>
          <Band title="Into the record book" note="All-time lists this week's results entered" />
          <ul style={{ listStyle: "none", padding: 0, margin: "0.8rem 0 0", display: "grid", gap: "0.7rem" }}>
            {data.milestones.map((milestone, index) => (
              <li
                key={`${milestone.kind}-${index}`}
                style={{ display: "grid", gridTemplateColumns: "2.6rem 1fr", gap: "0.8rem", alignItems: "baseline" }}
              >
                <span className="figure" style={{ fontSize: "1.2rem", color: "var(--color-brass)" }}>
                  #{milestone.rank}
                </span>
                <span>
                  <Link to={milestone.record_id ? `/records#${milestone.record_id}` : "/records"} className="link-quiet">
                    {milestone.headline}
                  </Link>
                  <span style={{ color: "var(--color-low)", display: "block", fontSize: "0.84rem" }}>
                    {milestone.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p style={{ marginTop: "2.6rem" }}>
        <Link to="/season" className="link-quiet">
          Full standings and season analytics
        </Link>
      </p>

      <style>{`
        .home-figures {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.2rem 1rem;
          margin-top: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--color-line-soft);
        }
        @media (min-width: 760px) { .home-figures { grid-template-columns: repeat(4, 1fr); } }
        .home-split { display: grid; gap: 1.6rem; margin-top: 1rem; }
        @media (min-width: 1000px) {
          .home-split { grid-template-columns: 1.25fr 1fr; align-items: start; gap: 2.4rem; }
        }
      `}</style>
    </div>
  );
}

/** Plain-text summary for the share sheet: facts only, one per line. */
function shareText(data: CurrentPayload, meta: Meta): string {
  const lines: string[] = [];
  const week = data.week;
  if (week) {
    lines.push(`${meta.league.name} \u2014 Week ${week.week}`);
    if (week.summary.high) lines.push(`High: ${week.summary.high.team_name} ${points(week.summary.high.score, 1)}`);
    if (week.summary.low) lines.push(`Low: ${week.summary.low.team_name} ${points(week.summary.low.score, 1)}`);
    if (week.summary.closest_game) {
      const g = week.summary.closest_game;
      lines.push(`Closest: ${g.away_team_name} ${points(g.away_score, 1)} at ${g.home_team_name} ${points(g.home_score, 1)}`);
    }
  }
  const picture = data.playoff_picture;
  if (picture) {
    const cut = picture.playoff_teams;
    const inside = picture.teams.slice(0, cut).map((t) => `${t.team_name} ${Math.round(t.playoff_pct * 100)}%`);
    lines.push(`Playoff line: ${inside.join(", ")}`);
    const bubble = picture.teams.slice(cut, cut + 2).map((t) => `${t.team_name} ${Math.round(t.playoff_pct * 100)}%`);
    if (bubble.length) lines.push(`Chasing: ${bubble.join(", ")}`);
    if (picture.previews[0]) {
      const p = picture.previews[0];
      lines.push(
        `Biggest game week ${p.week}: ${p.away_team_name} (${Math.round(p.away_win_pct * 100)}%) at ${p.home_team_name} (${Math.round(p.home_win_pct * 100)}%)`,
      );
    }
  }
  return lines.join("\n");
}
