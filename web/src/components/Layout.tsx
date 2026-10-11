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
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          backgroundColor: "var(--turf-deep)",
          borderBottom: "2px solid var(--chalk)",
          paddingTop: "var(--safe-top)",
        }}
      >
        <div
          className="shell"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.4rem",
            minHeight: "3.5rem",
          }}
        >
          <Link
            to="/"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "1.45rem",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            {meta?.league.short_name ?? "League"}
          </Link>

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
        .main-nav { display: none; gap: 1.1rem; margin-left: auto; }
        .nav-toggle { margin-left: auto; }
        .mobile-nav { display: flex; flex-direction: column; gap: 0.1rem; }
        .nav-item {
          color: var(--color-mid);
          font-size: 0.86rem;
          padding: 0.45rem 0;
          border-bottom: 2px solid transparent;
          white-space: nowrap;
          transition: color 120ms ease;
        }
        .nav-item:hover { color: var(--color-hi); }
        .nav-item-quiet { color: var(--color-low); font-size: 0.8rem; }
        .nav-sep { width: 1px; height: 1rem; background: var(--color-line); align-self: center; }
        .nav-item-active { color: var(--color-hi); border-bottom-color: var(--amber); }
        @media (min-width: 940px) {
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
