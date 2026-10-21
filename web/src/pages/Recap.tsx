import { Link, useParams } from "react-router-dom";
import { ErrorState, Loading } from "../components/primitives";
import { bySeason, recapFile, useIssues, weekLabel } from "../lib/recaps";

export default function Recap() {
  const { slug } = useParams();
  const issues = useIssues();
  if (issues.state === "loading") return <Loading what="that issue" />;
  if (issues.state === "error") return <ErrorState error={issues.error} what="The recap archive" />;

  const ordered = bySeason(issues.data).flatMap((s) => s.issues);
  const index = ordered.findIndex((i) => i.slug === slug);
  const issue = index >= 0 ? ordered[index] : null;

  if (!issue) {
    return (
      <div className="shell" style={{ paddingTop: "2.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>That issue is not in the archive</h1>
        <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
          <Link to="/recaps" className="link-quiet">
            Back to the recap archive
          </Link>
        </p>
      </div>
    );
  }

  const newer = index > 0 ? ordered[index - 1] : null;
  const older = index < ordered.length - 1 ? ordered[index + 1] : null;
  const pdf = recapFile(issue.pdf);

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <p className="issue-kicker">
        <Link to="/recaps" className="link-quiet">
          The Record
        </Link>{" "}
        · {issue.season} · {weekLabel(issue)}
      </p>
      <h1 className="issue-head">{issue.title}</h1>
      {issue.dek ? <p className="issue-dek">{issue.dek}</p> : null}
      <p className="issue-byline">
        By Dominick Cifelli, Commissioner
        {issue.dateLabel ? ` · ${issue.dateLabel}` : ""}
        {issue.pages ? ` · ${issue.pages} ${issue.pages === 1 ? "page" : "pages"}` : ""}
      </p>

      <p className="pill-row">
        <a className="pill" href={pdf} target="_blank" rel="noreferrer">
          Open in a new tab
        </a>
        <a className="pill" href={pdf} download>
          Download PDF
        </a>
        {issue.docx ? (
          <a className="pill" href={recapFile(issue.docx)} download>
            Download Word
          </a>
        ) : null}
      </p>

      <div className="issue-reader">
        <iframe className="issue-frame" src={pdf} title={`${issue.title}, ${weekLabel(issue)}`} />
        <a className="issue-mobile" href={pdf} target="_blank" rel="noreferrer">
          {issue.cover ? <img src={recapFile(issue.cover)} alt={`${issue.title}, page one`} /> : null}
          <span className="pill">Read the issue</span>
        </a>
      </div>

      {older || newer ? (
        <nav className="issue-nav" aria-label="Other issues">
          {older ? (
            <Link to={`/recaps/${older.slug}`} className="link-quiet">
              ← {weekLabel(older)}, {older.season}
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link to={`/recaps/${newer.slug}`} className="link-quiet">
              {weekLabel(newer)}, {newer.season} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <p className="prose-narrow" style={{ marginTop: "1.6rem", fontSize: "0.86rem" }}>
        Scoring and schedule-luck charts live on the{" "}
        <Link to="/season" className="link-quiet">
          season page
        </Link>
        , not in the issue.
      </p>

      <style>{`
        .issue-kicker {
          margin: 0; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.11em;
          text-transform: uppercase; color: var(--color-brass);
        }
        .issue-head {
          font-size: clamp(2rem, 6.5vw, 3.1rem); margin: 0.35rem 0 0; line-height: 1.02;
          letter-spacing: -0.015em;
        }
        .issue-dek {
          margin: 0.6rem 0 0; font-family: var(--font-display); font-style: italic;
          font-size: clamp(1.02rem, 2.6vw, 1.25rem); line-height: 1.36;
          color: var(--color-mid); max-width: 36rem;
        }
        .issue-byline {
          margin: 0.8rem 0 0; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--color-low);
        }
        .issue-reader { margin-top: 1.5rem; }
        .issue-frame {
          display: block; width: 100%; height: min(86vh, 58rem);
          border: 1px solid var(--color-line); background: var(--paper-deep);
        }
        .issue-mobile { display: none; }
        .issue-mobile img {
          display: block; width: 100%; height: auto;
          border: 1px solid var(--color-line);
        }
        .issue-mobile .pill { display: inline-block; margin-top: 0.9rem; }
        .issue-nav {
          display: flex; justify-content: space-between; gap: 1rem;
          margin-top: 1.4rem; padding-top: 0.9rem;
          border-top: 1px solid var(--color-line-soft); font-size: 0.86rem;
        }
        @media (max-width: 760px) {
          .issue-frame { display: none; }
          .issue-mobile { display: block; text-align: center; }
        }
      `}</style>
    </div>
  );
}
