import { OwnerLink } from "./primitives";

interface Week {
  week: number;
  diff: number;
  beat: boolean;
  won: boolean;
  tied: boolean;
}

interface TeamRow {
  ownerId: string;
  name: string;
  record: string;
  weeks: Week[];
  beats: number;
  total: number;
  aboveRecord: string;
}

/**
 * The novel one: every team as a strip of week cells. An ember cell means the
 * team outscored the league average that week; a faint cell means it didn't.
 * A small tick under each cell marks the actual game result. Read together you
 * can see "scored well, lost anyway" (ember cell, loss tick) and "scraped a
 * win on a bad week" (faint cell, win tick) at a glance -- the why behind the
 * schedule-luck number, the whole league in one block.
 */
export function AboveAverageGrid({ rows }: { rows: TeamRow[] }) {
  const maxWeeks = rows.reduce((m, r) => Math.max(m, r.total), 0);
  if (!maxWeeks) {
    return (
      <p style={{ color: "var(--ink-faint)", fontSize: "0.88rem" }}>
        No completed weeks yet this season.
      </p>
    );
  }
  return (
    <div>
      <div className="aa-head" aria-hidden="true">
        <span />
        <span className="aa-weeknums">
          {Array.from({ length: maxWeeks }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </span>
        <span className="aa-reclabel">vs avg</span>
      </div>
      <ul className="aa-list">
        {rows.map((row) => (
          <li key={row.ownerId} className="aa-row">
            <span className="aa-name">
              <OwnerLink ownerId={row.ownerId}>{row.name}</OwnerLink>
            </span>
            <span className="aa-cells">
              {row.weeks.map((w) => (
                <span
                  key={w.week}
                  className={`aa-cell${w.beat ? " aa-beat" : ""}`}
                  title={`Week ${w.week}: ${w.beat ? "beat" : "below"} the league average by ${Math.abs(
                    w.diff,
                  ).toFixed(1)}, ${w.won ? "won" : w.tied ? "tied" : "lost"}`}
                >
                  <span className={`aa-tick${w.won ? " aa-won" : w.tied ? " aa-tied" : ""}`} />
                </span>
              ))}
              {Array.from({ length: maxWeeks - row.total }, (_, i) => (
                <span key={`pad-${i}`} className="aa-cell aa-empty" />
              ))}
            </span>
            <span className="aa-rec">
              <b>{row.aboveRecord}</b>
              <span className="aa-real">{row.record} real</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="aa-key">
        <span className="aa-swatch aa-beat" /> beat the league average that week
        <span className="aa-swatch" style={{ marginLeft: "1rem" }} /> below it
        <span style={{ marginLeft: "1rem" }}>
          <span className="aa-tick aa-won aa-inline" /> won
          <span className="aa-tick aa-inline" style={{ marginLeft: "0.5rem" }} /> lost
        </span>
      </p>

      <style>{`
        .aa-head {
          display: grid;
          grid-template-columns: minmax(7rem, 11rem) 1fr 4.2rem;
          gap: 0 0.7rem;
          align-items: end;
          margin-bottom: 0.4rem;
        }
        .aa-weeknums { display: flex; gap: 2px; }
        .aa-weeknums span {
          flex: 1; text-align: center; font-size: 0.64rem; color: var(--ink-faint);
          font-variant-numeric: tabular-nums;
        }
        .aa-reclabel { font-size: 0.64rem; color: var(--ink-faint); text-align: right; }
        .aa-list { list-style: none; padding: 0; margin: 0; }
        .aa-row {
          display: grid;
          grid-template-columns: minmax(7rem, 11rem) 1fr 4.2rem;
          gap: 0 0.7rem;
          align-items: center;
          padding: 0.28rem 0;
          border-bottom: 1px solid var(--rule-soft);
        }
        .aa-name {
          font-size: 0.82rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        }
        .aa-cells { display: flex; gap: 2px; }
        .aa-cell {
          flex: 1; aspect-ratio: 1 / 1; min-width: 0;
          background: var(--rule);
          display: flex; align-items: flex-end; justify-content: center;
          position: relative;
        }
        .aa-cell.aa-beat { background: var(--ember); }
        .aa-cell.aa-empty { background: transparent; }
        .aa-tick {
          width: 60%; height: 2px; margin-bottom: 1px;
          background: var(--ink-faint);
        }
        .aa-tick.aa-won { background: var(--ink); }
        .aa-tick.aa-tied { background: var(--ink-soft); }
        .aa-beat .aa-tick { background: rgba(18, 14, 11, 0.45); }
        .aa-beat .aa-tick.aa-won { background: var(--paper-deep); }
        .aa-rec {
          text-align: right; display: flex; flex-direction: column; line-height: 1.1;
        }
        .aa-rec b {
          font-family: var(--font-display); font-weight: 700; font-size: 1rem;
          font-variant-numeric: lining-nums tabular-nums;
        }
        .aa-real { font-size: 0.64rem; color: var(--ink-faint); }
        .aa-key {
          display: flex; align-items: center; flex-wrap: wrap; gap: 0.3rem;
          margin-top: 0.7rem; font-size: 0.74rem; color: var(--ink-faint);
        }
        .aa-swatch {
          display: inline-block; width: 0.8rem; height: 0.8rem; background: var(--rule);
          margin-right: 0.3rem; vertical-align: -1px;
        }
        .aa-swatch.aa-beat { background: var(--ember); }
        .aa-tick.aa-inline {
          display: inline-block; width: 0.8rem; height: 2px; vertical-align: 3px;
          margin-right: 0.3rem;
        }
      `}</style>
    </div>
  );
}
