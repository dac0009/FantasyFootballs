import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Column<T> {
  /** Stable key, also used as the sort key. */
  key: string;
  header: ReactNode;
  /** Cell contents. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null;
  /** Draw a magnitude bar under the value, scaled across the visible rows. */
  bar?: (row: T) => number | null;
  align?: "left" | "right";
  title?: string;
  /** Hide on narrow screens to keep the first columns readable. */
  secondary?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  /** Set on <tr> so pages can highlight a row (e.g. the current owner). */
  rowClass?: (row: T) => string | undefined;
  caption?: string;
}

/**
 * The table is the primary presentation element on this site, so it does the
 * work: client-side sorting, sticky header, right-aligned tabular figures and
 * optional in-cell magnitude bars instead of a separate chart.
 */
export function StatTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  rowClass,
  caption,
}: Props<T>) {
  const [sort, setSort] = useState(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * factor;
      }
      return (left - right) * factor;
    });
  }, [rows, columns, sort]);

  const barRanges = useMemo(() => {
    const ranges = new Map<string, { min: number; max: number }>();
    for (const column of columns) {
      if (!column.bar) continue;
      const values = rows.map(column.bar).filter((v): v is number => v !== null);
      if (!values.length) continue;
      ranges.set(column.key, { min: Math.min(...values, 0), max: Math.max(...values) });
    }
    return ranges;
  }, [rows, columns]);

  function toggle(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "desc" };
      if (current.direction === "desc") return { key, direction: "asc" };
      return null;
    });
  }

  return (
    <div className="sheet">
      <table>
        {caption ? (
          <caption className="sr-only" style={{ position: "absolute", left: "-9999px" }}>
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const ariaSort = active
                ? sort!.direction === "asc"
                  ? "ascending"
                  : "descending"
                : undefined;
              return (
                <th
                  key={column.key}
                  aria-sort={ariaSort}
                  title={column.title}
                  style={{
                    textAlign: column.align ?? (columns[0] === column ? "left" : "right"),
                  }}
                  data-secondary={column.secondary ? "true" : undefined}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className="sort-btn"
                      onClick={() => toggle(column.key)}
                      style={{
                        flexDirection: (column.align ?? "right") === "left" ? "row" : "row-reverse",
                      }}
                    >
                      <span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>
                        {active && sort!.direction === "asc" ? "\u2191" : "\u2193"}
                      </span>
                      <span>{column.header}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={rowClass?.(row)}>
              {columns.map((column) => {
                const barValue = column.bar?.(row) ?? null;
                const range = barRanges.get(column.key);
                const width =
                  barValue !== null && range && range.max > range.min
                    ? ((barValue - range.min) / (range.max - range.min)) * 100
                    : null;
                return (
                  <td
                    key={column.key}
                    style={{
                      textAlign: column.align ?? (columns[0] === column ? "left" : "right"),
                    }}
                    data-secondary={column.secondary ? "true" : undefined}
                  >
                    {column.cell(row)}
                    {width !== null ? (
                      <span className="cell-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(width, 1.5)}%` }} />
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length ? (
        <p style={{ color: "var(--color-low)", fontSize: "0.88rem", padding: "1.2rem 0" }}>
          Nothing to show here yet.
        </p>
      ) : null}
    </div>
  );
}
