import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { METRICS } from "../lib/metricDefinitions";

export function Band({
  title,
  note,
  action,
  id,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="band" id={id}>
      <div className="band-head">
        <h2 className="band-title">{title}</h2>
        {action ?? (note ? <p className="band-note">{note}</p> : null)}
      </div>
      <hr className="yardline" aria-hidden="true" />
    </div>
  );
}

/** A statistic's name, linking to its definition in the glossary. */
export function Metric({ name, children }: { name: keyof typeof METRICS | string; children?: ReactNode }) {
  const definition = METRICS[name];
  if (!definition) return <>{children}</>;
  return (
    <Link to={`/glossary#${String(name).replace(/_/g, "-")}`} className="term">
      {children ?? definition.label}
    </Link>
  );
}

export function Loading({ what = "data" }: { what?: string }) {
  return (
    <p className="shell" style={{ color: "var(--color-low)", padding: "3rem 1.15rem" }} role="status">
      Loading {what}…
    </p>
  );
}

export function ErrorState({ error, what }: { error: Error; what?: string }) {
  return (
    <div className="shell" style={{ padding: "3rem 1.15rem" }}>
      <h1 style={{ fontSize: "1.4rem", marginBottom: "0.6rem" }}>
        {what ? `${what} is not available` : "That data is not available"}
      </h1>
      <p className="prose-narrow">{error.message}</p>
      <p className="prose-narrow" style={{ marginTop: "0.8rem" }}>
        If you maintain this site, generate the datasets with{" "}
        <code>python -m pipeline refresh</code> (or <code>python -m pipeline sample</code> for
        placeholder data) and redeploy.
      </p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: "var(--color-low)", padding: "1.4rem 0", fontSize: "0.9rem" }}>{children}</p>
  );
}

export function OwnerLink({
  ownerId,
  children,
  className = "link-quiet",
}: {
  ownerId: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!ownerId) return <>{children}</>;
  return (
    <Link to={`/owners/${ownerId}`} className={className}>
      {children}
    </Link>
  );
}

export function WeekLink({
  season,
  week,
  children,
}: {
  season: number;
  week: number | null | undefined;
  children: ReactNode;
}) {
  if (!week) return <>{children}</>;
  return (
    <Link to={`/seasons/${season}/weeks/${week}`} className="link-quiet">
      {children}
    </Link>
  );
}

export function RivalryLink({
  a,
  b,
  children,
}: {
  a: string | null | undefined;
  b: string | null | undefined;
  children: ReactNode;
}) {
  if (!a || !b) return <>{children}</>;
  return (
    <Link to={`/head-to-head?a=${a}&b=${b}`} className="link-quiet">
      {children}
    </Link>
  );
}

export function Figure({
  value,
  label,
  size = "2.1rem",
  tone,
}: {
  value: ReactNode;
  label: ReactNode;
  size?: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="figure" style={{ fontSize: size, color: tone }}>
        {value}
      </div>
      <div className="figure-label" style={{ marginTop: "0.3rem" }}>
        {label}
      </div>
    </div>
  );
}
