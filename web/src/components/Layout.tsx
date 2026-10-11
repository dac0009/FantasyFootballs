import { EditableText, EditorToolbar } from "./Editorial";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { generatedAt } from "../lib/format";
import type { Meta } from "../lib/types";

// Four things people actually open from a phone. Everything else is one tap
// further: linked from these pages and listed in the footer.
interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "This week", end: true },
  { to: "/season", label: "Standings" },
  { to: "/playoffs", label: "Playoff explorer" },
  { to: "/records", label: "Records" },
  { to: "/owners", label: "Owners" },
];

const MORE: NavItem[] = [
  { to: "/seasons", label: "Season archive" },
  { to: "/head-to-head", label: "Head to head" },
  { to: "/drafts", label: "Drafts" },
  { to: "/glossary", label: "Glossary" },
];

export function Layout({ meta, children }: { meta: Meta | null; children: ReactNode }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    const frame = window.requestAnimationFrame(() => {
      const anchor = location.hash ? document.getElementById(location.hash.slice(1)) : null;
      if (anchor) anchor.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, meta]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header"
        style={{
          position: "relative",
          top: 0,
          zIndex: 20,
          backgroundColor: "var(--paper-deep)",
          paddingTop: "var(--safe-top)",
        }}
      >
        <div className="shell publication-folio"><span><EditableText id="masthead.folio" fallback="Fantasy football"/></span><span>{meta ? `${meta.seasons[0]}–${meta.seasons[meta.seasons.length-1]}` : 'League archive'} / The digital edition</span></div>
        <div className="shell masthead">
          <div className="nameplate">
            <span><Link to="/">{meta?.league.short_name ?? "League"}</Link></span> <EditableText id="masthead.title" fallback="The Record"/>
          </div>
          <div className="masthead-motto"><EditableText id="masthead.motto" fallback=""/></div>
          <nav aria-label="Primary" className="main-nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item${isActive ? " nav-item-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
            <span className="nav-sep" aria-hidden="true" />
            {MORE.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item nav-item-quiet${isActive ? " nav-item-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            className="pill nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
        <hr className="yardline" style={{ opacity: 1 }} aria-hidden="true" />

        {menuOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="shell mobile-nav"
            style={{ paddingBottom: "0.9rem" }}
          >
            {[...NAV, ...MORE].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item${isActive ? " nav-item-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      {meta?.source === "sample" ? (
        <div className="shell" style={{ paddingTop: "1rem" }}>
          <p className="notice">
            This site is showing a generated sample league, not real results. Add{" "}
            <code>SWID</code> and <code>ESPN_S2</code> as repository secrets and run the{" "}
            <strong>Refresh ESPN data</strong> workflow to replace it.
          </p>
        </div>
      ) : null}

      <EditorToolbar/>
      <main id="main">{children}</main>

      <footer
        style={{
          borderTop: "1px solid var(--color-line)",
          marginTop: "4rem",
          paddingTop: "1.4rem",
          paddingBottom: "calc(2.5rem + var(--safe-bottom))",
          color: "var(--color-low)",
          fontSize: "0.8rem",
        }}
      >
        <div
          className="shell"
          style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem 2rem", justifyContent: "space-between" }}
        >
          <p style={{ margin: 0 }}>
            {meta?.league.name ?? "League"} record book,{" "}
            {meta ? `${meta.seasons[0]}\u2013${meta.seasons[meta.seasons.length - 1]}` : ""}
          </p>
          <p style={{ margin: 0 }}>
            {meta
              ? `${meta.source === "espn" ? "ESPN data" : "Sample data"}, updated ${generatedAt(
                  meta.generated_at,
                  meta.league.timezone,
                )}`
              : ""}
          </p>
          <p style={{ margin: 0, display: "flex", gap: "1.1rem", flexWrap: "wrap" }}>
            {MORE.map((item) => (
              <Link key={item.to} to={item.to} className="link-quiet">
                {item.label}
              </Link>
            ))}
          </p>
        </div>
      </footer>

      <style>{`
        .masthead {
          display: flex; align-items: baseline; gap: 1.4rem;
          min-height: 3.6rem; padding-top: 0.55rem; padding-bottom: 0.45rem;
        }
        .nameplate {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.7rem;
          line-height: 1;
          letter-spacing: 0.01em;
          text-decoration: none;
          color: var(--ink);
        }
        .main-nav { display: none; gap: 1.05rem; margin-left: auto; align-items: baseline; }
        .nav-toggle { margin-left: auto; }
        .mobile-nav { display: flex; flex-direction: column; gap: 0.1rem; padding-bottom: 0.9rem; }
        .nav-item {
          color: var(--ink-soft);
          font-size: 0.85rem;
          font-weight: 500;
          padding: 0.45rem 0;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
          text-decoration: none;
        }
        .nav-item:hover { color: var(--ink); }
        .nav-item-quiet { color: var(--ink-faint); font-size: 0.79rem; }
        .nav-sep { width: 1px; height: 0.95rem; background: var(--rule); align-self: center; }
        .nav-item-active { color: var(--ink); border-bottom-color: var(--ember); }
        @media (min-width: 980px) {
          .main-nav { display: flex; }
          .nav-toggle { display: none; }
          .mobile-nav { display: none; }
        }
        @media (max-width: 760px) {
          [data-secondary="true"] { display: none; }
        }
      `}</style>
    </>
  );
}
