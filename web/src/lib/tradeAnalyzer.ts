import type { Player, RosterRow, TradeTeamValue, TradeValues } from "./types";

/**
 * Live combination of the pipeline's precomputed Trade Analyzer values for
 * one specific proposed trade. Everything expensive or reusable (a player's
 * value_base/reliability/recent_form, a team's need_fit/leverage) is already
 * in `trade_values.json`; this only does the trade-specific sum, the same
 * split `playoffScenario.ts` uses for the playoff explorer.
 *
 * See pipeline/trade_value.py for the full formula and its limitations.
 */

export interface TradeComponent {
  playerId: number;
  name: string;
  position: string;
  valueBase: number;
  reliabilityFactor: number;
  recentFormFactor: number;
  needFitFactor: number;
  leverageFactor: number;
  contribution: number;
  /** False when the player has no `trade_values.json` entry at all (no
   * projection history yet) and this used the league-wide position rate
   * instead — the UI must label this case, never hide it. */
  hasHistory: boolean;
}

export interface TradeSide {
  ownerId: string;
  score: number;
  gains: TradeComponent[];
  losses: TradeComponent[];
}

export interface TradeResult {
  teamA: TradeSide;
  teamB: TradeSide;
}

/** One player's value to one specific team, with the full component breakdown. */
export function valueToTeam(
  trade: TradeValues,
  player: Player,
  team: TradeTeamValue | undefined,
): TradeComponent {
  const known = trade.players[String(player.player_id)];
  const positionInfo = trade.positions[player.position];
  const valueBase = known?.value_base ?? positionInfo?.value_rate ?? 0;
  const reliabilityFactor = known?.reliability_factor ?? 1;
  const recentFormFactor = known?.recent_form_factor ?? 1;
  const needFitFactor = team?.need_fit[player.position]?.need_fit_factor ?? 1;
  const leverageFactor = team?.leverage_factor ?? 1;
  return {
    playerId: player.player_id,
    name: player.name,
    position: player.position,
    valueBase,
    reliabilityFactor,
    recentFormFactor,
    needFitFactor,
    leverageFactor,
    contribution: valueBase * reliabilityFactor * recentFormFactor * needFitFactor * leverageFactor,
    hasHistory: !!known,
  };
}

/** Each owner's current roster: the player ids present in the most recent
 * roster week on record. Roster membership can change mid-season, so the
 * latest week is the only reliable answer to "whose team is this player on
 * right now." */
export function currentRosterByOwner(rosterRows: RosterRow[]): Map<string, number[]> {
  const latestWeek = rosterRows.reduce((max, row) => Math.max(max, row.week), 0);
  const out = new Map<string, number[]>();
  for (const row of rosterRows) {
    if (row.week !== latestWeek || !row.owner_id) continue;
    const list = out.get(row.owner_id);
    if (list) list.push(row.player_id);
    else out.set(row.owner_id, [row.player_id]);
  }
  return out;
}

function sumContribution(rows: TradeComponent[]): number {
  return rows.reduce((total, row) => total + row.contribution, 0);
}

/**
 * Score a proposed trade: team A sends `aGives` to team B and receives
 * `bGives` back. Each side's score is (value of what it received, to it)
 * minus (value of what it gave up, to it) — the two numbers need not be
 * opposites, since need_fit and leverage are specific to each team.
 */
export function computeTradeValue(
  trade: TradeValues,
  teamAId: string,
  teamBId: string,
  aGives: Player[],
  bGives: Player[],
): TradeResult {
  const teamA = trade.teams[teamAId];
  const teamB = trade.teams[teamBId];

  const teamAGains = bGives.map((p) => valueToTeam(trade, p, teamA));
  const teamALosses = aGives.map((p) => valueToTeam(trade, p, teamA));
  const teamBGains = aGives.map((p) => valueToTeam(trade, p, teamB));
  const teamBLosses = bGives.map((p) => valueToTeam(trade, p, teamB));

  return {
    teamA: {
      ownerId: teamAId,
      score: sumContribution(teamAGains) - sumContribution(teamALosses),
      gains: teamAGains,
      losses: teamALosses,
    },
    teamB: {
      ownerId: teamBId,
      score: sumContribution(teamBGains) - sumContribution(teamBLosses),
      gains: teamBGains,
      losses: teamBLosses,
    },
  };
}
