import { Link } from "react-router-dom";
import { EditableText } from "../components/Editorial";
import { Band, Empty } from "../components/primitives";
import { useEditorial } from "../components/Editorial";
import { AddIssueForm } from "../components/AddIssueForm";
import { allIssues, bySeason, coverSrc, isExternal, issueAsset, issueHref, weekLabel } from "../lib/recaps";

export default function Recaps() {
  const { documents } = useEditorial();
  const issues = allIssues(documents);
  const seasons = bySeason(issues);
  const count = issues.length;

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

      <AddIssueForm issues={issues} />

      {count === 0 ? <Empty>No issues have been published yet.</Empty> : null}

      {seasons.map(({ season, issues }) => (
        <section key={season}>
          <Band
            title={`${season} season`}
            note={`${issues.length} ${issues.length === 1 ? "issue" : "issues"}`}
          />
          <ol className="issue-list">
            {issues.map((issue) => (
              <li key={issue.slug} className="issue-row">
                {isExternal(issue) ? (
                  <a href={issueHref(issue)} target="_blank" rel="noreferrer" className="issue-cover" aria-hidden="true" tabIndex={-1}>
                    <img src={coverSrc(issue)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  </a>
                ) : (
                <Link to={`/recaps/${issue.slug}`} className="issue-cover" aria-hidden="true" tabIndex={-1}>
                  <img src={coverSrc(issue)} alt="" loading="lazy" />
                </Link>
                )}
                <div>
                  <p className="issue-kicker">
                    {weekLabel(issue)}
                    {issue.dateLabel ? ` · ${issue.dateLabel}` : ""}
                  </p>
                  <h3 className="issue-title">
                    {isExternal(issue) ? (
                      <a href={issueHref(issue)} target="_blank" rel="noreferrer">{issue.title}</a>
                    ) : (
                      <Link to={`/recaps/${issue.slug}`}>{issue.title}</Link>
                    )}
                  </h3>
                  <p className="issue-dek">{issue.dek}</p>
                  <p className="pill-row" style={{ marginTop: "0.7rem" }}>
                    {isExternal(issue) ? (
                      <a className="pill" href={issueHref(issue)} target="_blank" rel="noreferrer">
                        Read the issue
                      </a>
                    ) : (
                      <>
                        <Link to={`/recaps/${issue.slug}`} className="pill">
                          Read the issue
                        </Link>
                        <a className="pill" href={issueHref(issue)} download>
                          PDF
                        </a>
                      </>
                    )}
                    {issue.word ? (
                      <a className="pill" href={issueAsset(issue.slug, "docx")} download>
                        Word
                      </a>
                    ) : null}
                  </p>
                </div>
              </li>
            ))}
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
        .issue-cover { display: block; line-height: 0; }
        .issue-cover img {
          width: 100%; height: auto; display: block;
          border: 1px solid var(--color-line);
          box-shadow: 0 1px 0 rgba(32, 32, 32, 0.08);
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
