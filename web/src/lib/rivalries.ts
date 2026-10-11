import type { H2HRecord, OwnerIndexRow } from "./types";

/** Old published datasets predate is_active; their roster timelines remain authoritative. */
export function currentOwners(owners: OwnerIndexRow[]): OwnerIndexRow[] {
  const season = Math.max(0, ...owners.flatMap((owner) => owner.seasons));
  return owners.filter((owner) => !owner.unlinked &&
    (owner.is_active ?? owner.seasons.includes(season)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RivalrySort = "meetings" | "balance" | "margin" | "playoffs";
export function currentRivalries(owners: OwnerIndexRow[], pairs: H2HRecord[], sort: RivalrySort = "meetings"): H2HRecord[] {
  const ids = new Set(currentOwners(owners).map((owner) => owner.owner_id));
  return pairs.filter((pair) => ids.has(pair.left_owner_id) && ids.has(pair.right_owner_id)
    && pair.overall.games >= 3)
    .sort((a, b) => {
      const value = (r: H2HRecord) => sort === "balance"
        ? Math.abs(r.overall.left_wins - r.overall.right_wins) / r.overall.games
        : sort === "margin" ? r.avg_abs_margin
        : sort === "playoffs" ? -r.playoff.games : -r.overall.games;
      return value(a) - value(b) || b.overall.games - a.overall.games || a.pair_key.localeCompare(b.pair_key);
    });
}
