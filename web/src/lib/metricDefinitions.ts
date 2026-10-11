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
  career_atlas: {
    label: "Career atlas",
    short: "Each row is one season; each point is one completed game. Select a point with a mouse, touch, or keyboard to open its scorecard.",
    formula: "The horizontal axis is week. Winning-margin mode plots owner score minus opponent score around zero; points-scored mode starts at zero. Both use a common scale across the owner's full career, including when a season is isolated.",
    limitation: "Blue marks wins, brown marks losses, gray marks ties; outlined points are championship-playoff games. Consolation games remain in the archive and are labeled in the scorecard. Season summaries here include every recorded game, unlike the regular-season career totals above. Unplayed weeks have no point, and gaps are not joined. Arrow buttons move chronologically; a year label selects that season's latest game.",
  },
  winning_margin: {
    label: "Winning margin",
    short: "Your score minus your opponent's score. Positive is a win; negative is a loss; zero is a tie.",
    formula: "Owner points − opponent points. Average winning margin on the rivalry page uses the absolute difference, so it measures closeness regardless of the winner.",
  },
  weekly_scoring: {
    label: "Weekly scoring charts",
    short: "Each team's small chart shows its score relative to that week's league average. Blue bars are above average; brown bars are below. W, L and T are actual matchup results.",
    formula: "Team score − mean score of all teams with a recorded regular-season result in that week. Every small chart uses the same vertical scale.",
    limitation: "This comparison is against the weekly mean, not the median or every opponent individually. A score above average does not guarantee a matchup win.",
  },
  playoff_scenarios: {
    label: "Playoff scenarios",
    short: "Pick winners and simulate the unpicked regular-season games 3,000 times in your browser. Picks stay on the page and do not change league results.",
    formula: "Scoring models pull early team averages toward the league mean and draw random weekly scores using pooled variability. Final standings rank by wins (ties count as half), then total points. Picked games use the selected winner and expected scores for the points tiebreaker. Baseline and scenario share random draws. Change is measured in percentage points.",
    limitation: "These are model estimates, not official clinching scenarios or ESPN projections. Injuries, roster changes, division rules and other ESPN tiebreakers are not modeled. Zero or 100% in a simulation is not proof of elimination or a clinch. The homepage uses 5,000 simulations, so baseline estimates can differ slightly. Seed distributions show final regular-season position, not championship probability. Reset clears every pick across all weeks.",
  },
  rivalry_history: {
    label: "Rivalry history",
    short: "The ledger compares current owners with at least three completed meetings. All recorded game types count, including playoffs and consolation games.",
    formula: "Most meetings: total games. Most evenly split wins: smallest absolute win difference divided by games. Smallest average winning margin: mean absolute score difference. Most playoff meetings: championship-playoff games only. Ties in a sort use total meetings, then stable owner IDs.",
    limitation: "There is no combined rivalry score in the current interface. Records follow confirmed owner accounts through team renames. Archived links can include departed owners. Most-played opponent callouts consider only current owners; career opponent tables retain the historical archive.",
  },
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
  playoff_odds: {
    label: "Playoff odds",
    short:
      "How often a team makes the bracket when the rest of the regular season is simulated thousands of times from each team's scoring so far.",
    formula:
      "weekly score ~ Normal(team mean shrunk toward league mean, league-pooled std dev); top N by wins then points after 5,000 simulated seasons",
    limitation:
      "Assumes every team keeps scoring the way it has. Ignores injuries, byes and trades, and does not know ESPN's exact tiebreaker. Early in the season it deliberately leans toward the league average.",
  },
  win_probability: {
    label: "Win probability",
    short: "The chance one team outscores the other, from the two teams' scoring distributions.",
    formula: "P(score A > score B) for two independent normal distributions",
    limitation: "Same assumptions as playoff odds. A 60% favourite loses two games in five.",
  },
  playoff_swing: {
    label: "This week's swing",
    short: "A team's playoff odds if it wins this week against its odds if it loses. The gap is how much the game matters.",
    formula: "playoff odds conditioned on winning minus playoff odds conditioned on losing",
  },
  rival: {
    label: "Rival",
    short:
      "Each active owner's single biggest rivalry among owners still in the league, by rivalry index. Reciprocal where both name each other; otherwise shown as a one-sided chief rival.",
    limitation:
      "Only owners with a team this season are considered, so a departed nemesis drops off. Needs at least three career meetings.",
  },
  game_of_week: {
    label: "Game of the Week",
    short:
      "The upcoming game most worth watching, scored on this season alone: how much it swings both teams' playoff odds, how well the two teams are scoring now, and how close it projects to be.",
    formula:
      "0.45 leverage (combined playoff-odds swing from the simulation) + 0.30 quality (mean all-play this season) + 0.25 closeness (from win probability)",
    limitation:
      "Current-season only; rivalry history is not a factor. Uses no ESPN projection. Before a team has three games its scoring is still stabilising, so early-season picks lean on leverage.",
  },
};
