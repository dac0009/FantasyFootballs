import type { H2HRecord, OwnerIndexRow } from "./types";

/** Old published datasets predate is_active; their roster timelines remain authoritative. */
export function currentOwners(owners: OwnerIndexRow[]): OwnerIndexRow[] {
  const season = Math.max(0, ...owners.flatMap((owner) => owner.seasons));
  return owners.filter((owner) => !owner.unlinked &&
    (owner.is_active ?? owner.seasons.includes(season)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function currentRivalries(owners: OwnerIndexRow[], pairs: H2HRecord[]): H2HRecord[] {
  const ids = new Set(currentOwners(owners).map((owner) => owner.owner_id));
  return pairs.filter((pair) => ids.has(pair.left_owner_id) && ids.has(pair.right_owner_id)
    && pair.overall.games >= 3)
    .sort((a, b) => b.rivalry_index.score - a.rivalry_index.score ||
      b.overall.games - a.overall.games || a.pair_key.localeCompare(b.pair_key));
}
