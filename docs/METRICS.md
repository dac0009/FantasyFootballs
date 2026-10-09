# Metrics

Every derived statistic, with its formula and its limitations. The same definitions appear on
the site's Methodology page, generated from `web/src/lib/metricDefinitions.ts`.

## Conventions that apply everywhere

- A **tie counts as half a win** in every win percentage.
- Only **completed** games count. Scheduled games are displayed but never aggregated.
- The default scope is the **regular season**. Playoff and consolation games are classified
  separately.
- Standard deviation is the **sample** kind (n&minus;1). A single game yields `None`, not `0`.
- Season lengths differ across the league's history, so counting records show the game count.
- Playoff byes are not games and are excluded from every statistic.

---

## All-play record

**What it measures.** How a team would have done against the entire league every week, rather
than against the one opponent the schedule gave it. It isolates scoring strength from schedule.

**Formula.** For each (season, week), compare each participating team's score with every other
participating team's score: higher is a win, lower a loss, equal a tie.

**Limitation.** In postseason weeks only part of the league plays, so the comparison pool
shrinks and the number means less. This is why the regular season is the default scope.

## Expected wins

**What it measures.** The wins a team's scoring deserved, given an average schedule.

**Formula.** `all_play_win_pct × games_played`

**Limitation.** Measures scoring, not management. A team that happens to peak in weeks when the
rest of the league is cold will look better than it was.

## Schedule luck

**What it measures.** Whether the schedule helped or hurt.

**Formula.** `actual_wins − expected_wins`, where actual wins count ties as 0.5.

**Interpretation.** +1.5 means the schedule handed the team roughly a win and a half.

**Limitation.** Across a closed league this always sums to zero — nobody can be collectively
lucky. There is an invariant test asserting exactly that.

## Strength of schedule

Two complementary figures.

**`sos_points`** — `mean(opponent_score) − mean(league_score)` over the same weeks. Units:
points. Positive means tougher opponents.

**`sos_z`** — the mean of each opponent's weekly z-score:
`mean((opponent_score − weekly_league_mean) / weekly_league_stdev)`. Unitless, so comparable
across seasons with different scoring settings, and not distorted by one freak week.

**Limitation.** Both treat the opponent's actual score as the difficulty of the matchup. That is
the honest measure for a fantasy schedule — you play a score, not a roster — but it is strictly
backward-looking. It is not a forecast of remaining schedule difficulty.

## Consistency

**Formula.** Sample standard deviation of weekly scores. `coefficient_of_variation` is
`stdev / mean`, for comparing teams with different scoring levels.

**Limitation.** Steady is not the same as good. A reliably bad team scores well on consistency.

## Dominance rating

**What it measures.** A single 0–100 power score.

**Formula.** `100 × (0.50 × all_play + 0.30 × avg_score + 0.20 × point_diff)`, where each
component is min-max scaled across the teams being compared.

**Why those weights.** All-play carries the most weight because it is the least
schedule-dependent signal available. Scoring average and point differential add scale
information all-play discards.

**Limitation.** It is *relative to the group being scaled*, so it answers "who was strongest in
this league, this season" and cannot be compared across seasons unless both were scaled
together. With fewer than two teams, or no spread in a component, that component contributes a
neutral 0.5 rather than dividing by zero.

## Bad Beat Index

**What it measures.** How often strong performances were wasted.

**Formula.** `Σ over losses of max(0, z)` where `z` is the team's own weekly z-score against the
league that week. Losing while two standard deviations above the mean contributes 2.0.

**Limitation.** A running sum, so it grows with games played; `bad_beat_per_game` is provided for
cross-season comparison. Purely descriptive.

## Fortunate Win Index

**Formula.** `Σ over wins of max(0, −z)`. High values mean wins arrived despite below-average
scoring. Same limitations as above.

## Manager efficiency

**What it measures.** How much of the available points the starting lineup actually captured.

**Formula.** `started_points / optimal_points`, where the optimal lineup is computed by filling
slots from most restrictive to least restrictive, taking the highest remaining eligible scorer
each time.

That greedy approach is **provably optimal** for standard fantasy slot sets because the
eligibility sets are nested (QB ⊂ superflex, RB ⊂ flex, and so on). It becomes a heuristic only
if a league defines overlapping, non-nested slots.

**Limitation.** Pure hindsight. It assumes the manager should have known which bench player
would outscore which starter, ignores injury and bye information at lock time, and ignores IR
slot rules. Read it as "points left on the table", not as a verdict on decision quality. 100% is
not a realistic target.

## Bench regret

**Formula.** `optimal_points − started_points`, reported as a total and per week.

## Rivalry Index

**What it measures.** A convenience score for sorting rivalries by how much they feel like one.

**Formula.** `100 × (0.25 × volume + 0.25 × parity + 0.25 × closeness + 0.25 × stakes)`

| Component | Definition |
|---|---|
| volume | `min(meetings / 20, 1)` |
| parity | `max(0, 1 − 2 × abs(win_pct − 0.5))` — peaks at a dead-even series |
| closeness | `max(0, 1 − mean_abs_margin / 40)` |
| stakes | `min(playoff_meetings / 3, 1)` |

**Limitation.** The scale constants (20 meetings, 40 points, 3 playoff games) are arbitrary,
chosen so a typical eight-year league spreads across the range. This is a sorting aid, not a
measurement, and it is labelled as such on the site.

## Game of the Week

**What it measures.** Which upcoming matchup is worth watching.

**Formula.** Each scheduled, unplayed matchup in the next unplayed week is scored on five
components, each scaled 0–1:

| Component | Weight | Definition |
|---|---|---|
| quality | 0.30 | mean of the two teams' all-play win % |
| parity | 0.25 | `1 − abs(all_play_a − all_play_b) × 2`, clamped |
| stakes | 0.20 | closeness of both teams to the playoff cut line, plus a lateness factor |
| form | 0.15 | mean scoring z-score over the last 3 completed weeks |
| rivalry | 0.10 | the pair's rivalry index / 100 |

The reasons shown on the page are generated from whichever components actually drove the pick.

**Limitation — and this one matters.** **No ESPN projection is used.** ESPN exposes projected
team totals only while a week is live, and never for a future week or historically. Rather than
fabricate one, the projected margin shown alongside the pick is derived from each team's own
season scoring average, requires at least three completed games from both teams, and is labelled
as such wherever it appears.

---

## Metrics that were considered and rejected

**Draft value / draft grades.** Would require season-long points per drafted player attributed
back to the drafting owner. Possible in principle, but ESPN's historical lineup coverage is
inconsistent, and a draft grade computed from partial roster data would be confidently wrong.
Revisit if `python -m pipeline probe` shows complete `mBoxscore` coverage for all seasons.

**Playoff probability.** Needs a Monte Carlo over remaining schedules. Defensible, but it is a
forecast rather than an archive feature, and a weekly-refreshed static site is a poor vehicle
for a number that changes with injury news.

**Power rankings with recency weighting.** The weighting would be an unjustifiable free
parameter. Dominance rating plus the three-week form figure in the Game of the Week model covers
the same ground without inventing a decay constant.
