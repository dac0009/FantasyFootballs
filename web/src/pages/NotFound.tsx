import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="shell" style={{ paddingTop: "3.5rem" }}>
      <h1 style={{ fontSize: "clamp(1.6rem, 5vw, 2.4rem)" }}>There is no page here</h1>
      <p className="prose-narrow" style={{ marginTop: "0.7rem" }}>
        The link may be from an older version of this site. Everything is reachable from the
        navigation above, or start from these:
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "1.2rem 0 0", display: "grid", gap: "0.5rem" }}>
        {[
          { to: "/", label: "This week" },
          { to: "/seasons", label: "Season archive" },
          { to: "/records", label: "Record book" },
          { to: "/owners", label: "Owners" },
        ].map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="link-quiet">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
