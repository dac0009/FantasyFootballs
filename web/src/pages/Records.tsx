import { EditableText } from "../components/Editorial";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Band, Empty, ErrorState, Loading, OwnerLink, WeekLink } from "../components/primitives";
import { useRecordBook } from "../lib/data";
import { gameTypeLabel, points } from "../lib/format";
import type { RecordCategory, RecordEntry } from "../lib/types";

const GROUPS = [
  { id: "single-game", label: "Single game" },
  { id: "season", label: "Season" },
  { id: "career", label: "Career" },
  { id: "player", label: "Players" },
];

export default function Records() {
  const book = useRecordBook();
  const [group, setGroup] = useState("single-game");
  const [scope, setScope] = useState<"regular" | "all">("all");
  const [query, setQuery] = useState("");

  const categories = useMemo<RecordCategory[]>(() => {
    if (book.state !== "ready") return [];
    const data = book.data;
    let list: RecordCategory[];
    if (group === "single-game") list = data.scopes[scope]?.categories ?? [];
    else if (group === "season") list = data.season;
    else if (group === "career") list = data.career;
    else list = data.player;
    if (!query.trim()) return list;
    const needle = query.trim().toLowerCase();
    return list.filter(
      (category) =>
        category.title.toLowerCase().includes(needle) ||
        category.description.toLowerCase().includes(needle) ||
        category.entries.some((entry) =>
          [entry.owner_name, entry.team_name, entry.player_name, entry.home_team_name, entry.away_team_name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)),
        ),
    );
  }, [book, group, scope, query]);

  if (book.state === "loading") return <Loading what="the record book" />;
  if (book.state === "error") return <ErrorState error={book.error} what="The record book" />;

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}><EditableText id="site.records.25bf322f41" fallback="Record book"/></h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        Every all-time list, with enough context on each entry to understand it: who held it, in
        which season and week, and against whom. Career and season records aggregate by{" "}
        <strong>owner</strong>, so a team rename never splits a record.
      </p>

      <div className="record-controls">
        <div className="pill-row" role="group" aria-label="Record group">
          {GROUPS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="pill"
              aria-pressed={group === option.id}
              onClick={() => setGroup(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {group === "single-game" ? (
          <div className="pill-row" role="group" aria-label="Game scope">
            {(["all", "regular"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className="pill"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
              >
                {option === "all" ? "All games" : "Regular season"}
              </button>
            ))}
          </div>
        ) : null}
        <label style={{ marginLeft: "auto" }}>
          <span style={{ position: "absolute", left: "-9999px" }}>Filter records</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by record or name"
            className="select"
            style={{ minWidth: "14rem", backgroundImage: "none", paddingRight: "0.6rem" }}
          />
        </label>
      </div>

      {!categories.length ? (
        <Empty>
          {group === "player"
            ? "Player records need ESPN lineup data, which was not available for this league. See the glossary for what ESPN exposes."
            : "No records match that filter."}
        </Empty>
      ) : null}

      {categories.map((category) => (
        <section key={category.id} id={category.id} style={{ scrollMarginTop: "4.5rem" }}>
          <Band title={category.title} note={`${category.unit}, ${category.better === "high" ? "higher is better" : "lower is better"}`} />
          <p className="prose-narrow" style={{ margin: "0.5rem 0 0.8rem", fontSize: "0.86rem" }}>
            {category.description}
          </p>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {category.entries.map((entry, index) => (
              <li key={`${category.id}-${index}`} className="record-row">
                <span className="figure record-rank">{index + 1}</span>
                <span className="figure record-value">{entry.display}</span>
                <span className="record-detail">{describe(entry)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <p style={{ marginTop: "2.5rem", fontSize: "0.85rem" }}>
        <Link to="/glossary" className="link-quiet">
          How each of these is defined
        </Link>
      </p>

      <style>{`
        .record-controls {
          display: flex; flex-wrap: wrap; gap: 0.7rem 1.2rem; align-items: center;
          margin-top: 1.4rem; padding-bottom: 0.4rem;
        }
        .record-row {
          display: grid; grid-template-columns: 1.8rem 5.5rem 1fr; gap: 0.9rem;
          align-items: baseline; padding: 0.45rem 0;
          border-bottom: 1px solid var(--color-line-soft);
        }
        .record-rank { font-size: 0.85rem; color: var(--color-low); text-align: right; }
        .record-value { font-size: 1.05rem; }
        .record-detail { font-size: 0.87rem; color: var(--color-mid); }
        .record-row:first-child .record-value { color: var(--color-brass); font-size: 1.2rem; }
      `}</style>
    </div>
  );
}

/** One line of context per entry, shaped by which kind of record it is. */
function describe(entry: RecordEntry) {
  if (entry.player_name) {
    return (
      <>
        <strong style={{ color: "var(--color-hi)", fontWeight: 600 }}>{entry.player_name}</strong>{" "}
        <span style={{ color: "var(--color-low)" }}>
          {entry.position}
          {entry.nfl_team ? `, ${entry.nfl_team}` : ""}
        </span>
        {entry.owner_id ? (
          <>
            {" \u2014 "}
            <OwnerLink ownerId={entry.owner_id}>{entry.owner_name ?? "owner"}</OwnerLink>
          </>
        ) : null}
        {entry.season ? (
          <>
            {", "}
            <WeekLink season={entry.season} week={entry.week}>
              {entry.season} week {entry.week}
            </WeekLink>
          </>
        ) : null}
        {entry.lineup_slot ? (
          <span style={{ color: "var(--color-low)" }}>, {entry.lineup_slot}</span>
        ) : null}
      </>
    );
  }

  if (entry.home_team_name && entry.away_team_name) {
    return (
      <>
        <OwnerLink ownerId={entry.home_owner_id}>{entry.home_team_name}</OwnerLink>{" "}
        {points(entry.home_score)} &ndash; {points(entry.away_score)}{" "}
        <OwnerLink ownerId={entry.away_owner_id}>{entry.away_team_name}</OwnerLink>
        {entry.season ? (
          <span style={{ color: "var(--color-low)" }}>
            {", "}
            <WeekLink season={entry.season} week={entry.week}>
              {entry.season} week {entry.week}
            </WeekLink>
            {entry.game_type && entry.game_type !== "regular" ? `, ${gameTypeLabel(entry.game_type)}` : ""}
          </span>
        ) : null}
      </>
    );
  }

  const name = entry.team_name ?? entry.owner_name ?? entry.owner_id;
  return (
    <>
      <OwnerLink ownerId={entry.owner_id}>
        <strong style={{ color: "var(--color-hi)", fontWeight: 600 }}>{name}</strong>
      </OwnerLink>
      {entry.owner_name && entry.team_name && entry.owner_name !== entry.team_name ? (
        <span style={{ color: "var(--color-low)" }}> ({entry.owner_name})</span>
      ) : null}
      {entry.season ? (
        <span style={{ color: "var(--color-low)" }}>
          {", "}
          {entry.week ? (
            <WeekLink season={entry.season} week={entry.week}>
              {entry.season} week {entry.week}
            </WeekLink>
          ) : (
            <Link to={`/seasons/${entry.season}`} className="link-quiet">
              {entry.season}
            </Link>
          )}
        </span>
      ) : null}
      {entry.opponent_team_name ? (
        <>
          <span style={{ color: "var(--color-low)" }}>
            {entry.result === "L" ? " lost to " : entry.result === "W" ? " beat " : " tied "}
          </span>
          <OwnerLink ownerId={entry.opponent_owner_id}>{entry.opponent_team_name}</OwnerLink>
          <span style={{ color: "var(--color-low)" }}> ({points(entry.opponent_score)})</span>
        </>
      ) : null}
      {entry.record && !entry.opponent_team_name ? (
        <span style={{ color: "var(--color-low)" }}>, {entry.record}</span>
      ) : null}
      {entry.seasons ? (
        <span style={{ color: "var(--color-low)" }}>, {entry.seasons} seasons</span>
      ) : null}
      {entry.game_type && entry.game_type !== "regular" ? (
        <span style={{ color: "var(--color-low)" }}>, {gameTypeLabel(entry.game_type)}</span>
      ) : null}
    </>
  );
}
