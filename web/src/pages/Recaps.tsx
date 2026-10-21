import { Link } from "react-router-dom";
import { EditableText, useEditorial } from "../components/Editorial";
import { RecapLinkForm } from "../components/RecapLinkForm";
import { Band, Empty, ErrorState, Loading } from "../components/primitives";
import { bySeason, coverSrc, mergeIssues, pdfHref, recapFile, storedIssues, useIssues, weekLabel } from "../lib/recaps";

export default function Recaps() {
  const manifest = useIssues();
  const { documents } = useEditorial();
  const stored = storedIssues(documents);

  if (manifest.state === "loading") return <Loading what="the recap archive" />;
  if (manifest.state === "error" && stored.length === 0) return <ErrorState error={manifest.error} what="The recap archive" />;

  const issues = mergeIssues(manifest.state === "ready" ? manifest.data : [], stored);
  const seasons = bySeason(issues);

  return (
    <div className="shell" style={{ paddingTop: "2.2rem" }}>
      <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)" }}>
        <EditableText id="site.recaps.title" fallback="Recap archive" />
      </h1>
      <p className="prose-narrow" style={{ marginTop: "0.6rem" }}>
        <EditableText
          id="site.recaps.intro"
          fallback="Every issue of The Record, the league magazine, written by the commissioner. Read an issue in the browser or download it for later."
        />
      </p>

      <RecapLinkForm issues={issues} />

      {issues.length === 0 ? <Empty>No issues have been published yet.</Empty> : null}

      {seasons.map(({ season, issues: list }) => (
        <section key={season}>
          <Band title={`${season} season`} note={`${list.length} ${list.length === 1 ? "issue" : "issues"}`} />
          <ol className="issue-list">
            {list.map((issue) => {
              const cover = coverSrc(issue);
              const pdf = pdfHref(issue);
              return (
                <li key={issue.slug} className="issue-row">
                  <Link to={`/recaps/${issue.slug}`} className="issue-cover" aria-hidden="true" tabIndex={-1}>
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => { e.currentTarget.replaceWith(blank(weekLabel(issue))); }}
                      />
                    ) : (
                      <span className="issue-cover-blank">{weekLabel(issue)}</span>
                    )}
                  </Link>
                  <div>
                    <p className="issue-kicker">
                      {weekLabel(issue)}
                      {issue.dateLabel ? ` · ${issue.dateLabel}` : ""}
                      {issue.link ? (issue.link.kind === "drive" ? " · Google Drive" : " · Google Docs") : ""}
                    </p>
                    <h3 className="issue-title">
                      <Link to={`/recaps/${issue.slug}`}>{issue.title}</Link>
                    </h3>
                    {issue.dek ? <p className="issue-dek">{issue.dek}</p> : null}
                    <p className="pill-row" style={{ marginTop: "0.7rem" }}>
                      <Link to={`/recaps/${issue.slug}`} className="pill">Read the issue</Link>
                      {pdf ? (
                        issue.link
                          ? <a className="pill" href={pdf} target="_blank" rel="noreferrer">PDF</a>
                          : <a className="pill" href={pdf} download>PDF</a>
                      ) : null}
                      {issue.docx ? <a className="pill" href={recapFile(issue.docx)} download>Word</a> : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <style>{`
        .issue-list { list-style: none; padding: 0; margin: 0; }
        .issue-row {
          display: grid; grid-template-columns: 7.5rem 1fr; gap: 1.3rem;
          padding: 1.4rem 0; border-bottom: 1px solid var(--color-line-soft);
          align-items: start;
        }
        .issue-cover { display: block; line-height: 0; text-decoration: none; }
        .issue-cover img {
          width: 100%; height: auto; display: block;
          border: 1px solid var(--color-line);
          box-shadow: 0 1px 0 rgba(32, 32, 32, 0.08);
        }
        .issue-cover-blank {
          display: flex; align-items: center; justify-content: center; text-align: center;
          aspect-ratio: 8.5 / 11; border: 1px solid var(--color-line); background: var(--paper-deep);
          font: 600 0.7rem var(--font-body); letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-low); line-height: 1.3; padding: 0.5rem;
        }
        .issue-kicker {
          margin: 0; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.11em;
          text-transform: uppercase; color: var(--color-brass);
        }
        .issue-title {
          font-size: clamp(1.25rem, 3.6vw, 1.7rem); margin: 0.3rem 0 0; line-height: 1.08;
        }
        .issue-title a { text-decoration: none; }
        .issue-title a:hover { color: var(--ember); }
        .issue-dek {
          margin: 0.45rem 0 0; color: var(--color-mid); font-family: var(--font-display);
          font-style: italic; font-size: 1rem; line-height: 1.35; max-width: 34rem;
        }
        @media (max-width: 540px) {
          .issue-row { grid-template-columns: 5rem 1fr; gap: 1rem; }
        }
      `}</style>
    </div>
  );
}

function blank(label: string) {
  const span = document.createElement("span");
  span.className = "issue-cover-blank";
  span.textContent = label;
  return span;
}
