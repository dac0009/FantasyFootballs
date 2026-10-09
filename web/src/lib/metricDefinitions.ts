/**
 * Plain-English definitions for every derived metric, shown in-place next to
 * the column that uses them. Kept in sync with docs/METRICS.md, which carries
 * the formulas and limitations in full.
 */
export interface MetricDefinition {
  label: string;
  short: string;
  formula?: string;
  limitation?: string;
}

export const METRICS: Record<string, MetricDefinition> = {
  all_play: {
    label: "All-play record",
    short:
      "How a team would have done if it had played every other team every week, instead of one scheduled opponent.",
    formula: "Each week, compare a team's score with all other scores: higher is a win, lower a loss, equal a tie.",
    limitation:
      "In playoff weeks only part of the league plays, so the comparison pool shrinks. Regular season is the default view for this reason.",
  },
  expected_wins: {
    label: "Expected wins",
    short: "The wins a team's scoring deserved, given an average schedule.",
    formula: "all-play win % \u00d7 games played",
    limitation: "Measures scoring strength, not roster management, and ignores who was actually played.",
  },
  schedule_luck: {
    label: "Schedule luck",
    short: "Wins above or below what the team's scoring earned. Positive means the schedule helped.",
    formula: "actual wins \u2212 expected wins",
    limitation: "Across a whole league this always sums to zero: nobody can be collectively lucky.",
  },
  sos_z: {
    label: "Strength of schedule",
    short: "How strong the scores a team had to beat were, in standard deviations above the weekly league average.",
    formula: "mean of (opponent score \u2212 weekly league mean) \u00f7 weekly league standard deviation",
    limitation: "Backward-looking. It describes the schedule that happened, not how hard the remaining one is.",
  },
  sos_points: {
    label: "Schedule strength in points",
    short: "Average opponent score minus the league average over the same weeks.",
    formula: "mean(opponent score) \u2212 mean(league score)",
  },
  consistency: {
    label: "Consistency",
    short: "Week-to-week standard deviation of scores. Lower is steadier.",
    limitation: "Steady is not the same as good: a reliably bad team also scores well here.",
  },
  dominance: {
    label: "Dominance rating",
    short: "A 0\u2013100 power score blending all-play record, scoring average and point differential.",
    formula: "100 \u00d7 (0.50 \u00d7 all-play + 0.30 \u00d7 avg score + 0.20 \u00d7 point diff), each min-max scaled within the group",
    limitation:
      "Relative to the teams being compared, so it cannot be compared across seasons unless both were scaled together.",
  },
  bad_beat_index: {
    label: "Bad Beat Index",
    short: "How often strong performances were wasted in losses.",
    formula: "sum over losses of max(0, the team's own weekly z-score)",
    limitation: "A running total, so it grows with games played. Descriptive, not predictive.",
  },
  fortunate_win_index: {
    label: "Fortunate Win Index",
    short: "How often wins arrived despite below-average scoring.",
    formula: "sum over wins of max(0, \u2212 the team's own weekly z-score)",
  },
  manager_efficiency: {
    label: "Manager efficiency",
    short: "Points the starting lineup actually scored, against the best lineup available that week.",
    formula: "started points \u00f7 optimal points",
    limitation:
      "Pure hindsight. It ignores injuries and bye-week information at lock time, so 100% is not a realistic target.",
  },
  bench_regret: {
    label: "Bench regret",
    short: "Points left on the bench relative to the best available lineup.",
    formula: "optimal points \u2212 started points",
  },
  rivalry_index: {
    label: "Rivalry Index",
    short: "A 0\u2013100 convenience score for sorting rivalries by how much they feel like one.",
    formula: "equal weights on meetings played, series parity, average closeness and playoff meetings",
    limitation: "The scale constants are arbitrary and chosen to spread this league's pairs out. Not a measurement.",
  },
  game_of_week: {
    label: "Game of the Week model",
    short: "Scheduled matchups scored on team quality, how evenly matched they are, stakes, recent form and rivalry history.",
    formula: "0.30 quality + 0.25 parity + 0.20 stakes + 0.15 form + 0.10 rivalry",
    limitation:
      "ESPN does not expose reliable projections for a future week, so no projection is used. Any projected margin shown comes from each team's own season average.",
  },
};
