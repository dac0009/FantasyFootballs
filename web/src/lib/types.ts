/** Shapes of the datasets produced by the Python pipeline (see docs/DATA_MODEL.md). */

export type GameType = "regular" | "playoff" | "consolation" | "postseason_other";
export type Result = "W" | "L" | "T";

export interface Meta {
  schema_version: number;
  pipeline_version: string;
  generated_at: string;
  source: "espn" | "sample";
  league: {
    league_id: number;
    name: string;
    short_name: string;
    site_title: string;
    timezone: string;
  };
  seasons: number[];
  current_season: number;
  current_week: number | null;
  upcoming_week: number | null;
  counts: Record<string, number>;
  limitations: string[];
  warnings: string[];
}

export interface TeamNameRow {
  season: number;
  team_id: number;
  team_name: string;
  abbrev: string | null;
}

export interface Matchup {
  matchup_id: string;
  season: number;
  week: number;
  game_type: GameType;
  playoff_tier: string | null;
  is_bye: boolean;
  completed: boolean;
  home_team_id: number | null;
  away_team_id: number | null;
  home_owner_id: string | null;
  away_owner_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  winner: string;
  margin: number | null;
  combined: number | null;
  home_seed?: number | null;
  away_seed?: number | null;
}

export interface TeamWeek {
  season: number;
  week: number;
  matchup_id: string;
  game_type: GameType;
  team_id: number;
  owner_id: string;
  team_name: string;
  score: number;
  opponent_team_id: number;
  opponent_owner_id: string;
  opponent_team_name: string;
  opponent_score: number;
  differential: number;
  result: Result;
  is_home: boolean;
}

export interface StandingsRow {
  owner_id: string;
  team_id: number | null;
  team_name: string | null;
  abbrev: string | null;
  logo: string | null;
  rank: number;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  win_pct: number | null;
  points_for: number | null;
  points_against: number | null;
  point_diff: number | null;
  avg_score: number | null;
  avg_against: number | null;
  median_score: number | null;
  high_score: number | null;
  low_score: number | null;
  score_stdev: number | null;
  coefficient_of_variation: number | null;
  avg_margin: number | null;
  games_150_plus: number;
  games_under_100: number;
  all_play_wins: number;
  all_play_losses: number;
  all_play_ties: number;
  all_play_record: string;
  all_play_win_pct: number | null;
  expected_wins: number | null;
  actual_wins?: number | null;
  schedule_luck: number | null;
  luck_per_game?: number | null;
  sos_points: number | null;
  sos_z: number | null;
  opponent_avg_score: number | null;
  bad_beat_index: number | null;
  fortunate_win_index: number | null;
  worst_bad_beat: WeekRef | null;
  luckiest_win: WeekRef | null;
  dominance: number | null;
  components?: Record<string, number>;
  longest_win_streak: number;
  longest_loss_streak: number;
  current_streak: string | null;
  playoff_seed: number | null;
  final_rank: number | null;
  is_champion: boolean;
  is_runner_up: boolean;
  is_last: boolean;
}

export interface WeekRef {
  season: number;
  week: number;
  team_name?: string | null;
  score: number;
  opponent_owner_id?: string | null;
  opponent_team_name?: string | null;
  opponent_score?: number | null;
  result?: Result;
  margin?: number | null;
  game_type?: GameType;
  matchup_id?: string | null;
  z?: number;
}

export interface WeekLeaderboardRow {
  rank: number;
  owner_id: string;
  team_name: string;
  score: number;
  result: Result;
  opponent_owner_id: string;
  opponent_team_name: string;
  opponent_score: number;
  game_type: GameType;
  matchup_id: string;
}

export interface WeekPayload {
  season: number;
  week: number;
  has_results: boolean;
  matchups: Matchup[];
  leaderboard: WeekLeaderboardRow[];
  summary: {
    teams_played: number;
    league_mean: number | null;
    league_median: number | null;
    league_stdev: number | null;
    high: WeekLeaderboardRow | null;
    low: WeekLeaderboardRow | null;
    biggest_blowout: Matchup | null;
    closest_game: Matchup | null;
    highest_combined: Matchup | null;
    lowest_combined: Matchup | null;
    highest_score_in_loss: WeekRef | null;
    lowest_score_in_win: WeekRef | null;
  };
}

export interface SeasonMeta {
  season: number;
  league_name: string | null;
  team_count: number | null;
  regular_season_weeks: number | null;
  total_matchup_periods: number | null;
  playoff_team_count: number | null;
  scoring_type: string | null;
  current_matchup_period: number | null;
  is_active: boolean;
  weeks_observed: number[];
}

export interface LeaderBoard {
  id: string;
  label: string;
  unit: string;
  entries: { owner_id: string; team_name: string | null; value: number }[];
}

export interface SeasonPayload {
  season: number;
  meta: SeasonMeta;
  completed_weeks: number[];
  scheduled_weeks: number[];
  standings: StandingsRow[];
  weeks: WeekPayload[];
  bracket: { rounds: { week: number; games: Matchup[] }[]; has_playoffs: boolean };
  champion: { owner_id: string; owner_name: string | null; team_name: string | null; record: string; points_for: number | null } | null;
  runner_up: { owner_id: string; owner_name: string | null; team_name: string | null } | null;
  champion_source: string | null;
  league_scoring: { mean: number | null; median: number | null; stdev: number | null; high: number | null; low: number | null };
  weekly_series: {
    week: number;
    owner_id: string;
    team_name: string | null;
    score: number;
    opponent_score: number;
    result: Result;
    game_type: GameType;
    league_mean: number | null;
    weekly_rank: number;
  }[];
  leaders: LeaderBoard[];
  limitations: string[];
}

export interface SeasonIndexRow {
  season: number;
  team_count: number | null;
  regular_season_weeks: number | null;
  completed_weeks: number[];
  champion: SeasonPayload["champion"];
  runner_up: SeasonPayload["runner_up"];
  league_name: string | null;
  is_current: boolean;
}

export interface OwnerIndexRow {
  is_active?: boolean;
  owner_id: string;
  name: string;
  current_team_name: string | null;
  seasons: number[];
  seasons_played: number;
  first_season: number | null;
  last_season: number | null;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  win_pct: number | null;
  points_for: number | null;
  points_against: number | null;
  point_diff: number | null;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  score_stdev: number | null;
  all_play_win_pct: number | null;
  championships: number;
  runner_ups: number;
  playoff_appearances: number;
  avg_finish: number | null;
  best_finish: number | null;
  longest_win_streak: number;
  longest_loss_streak: number;
  unlinked: boolean;
  team_name_timeline: TeamNameRow[];
}

export interface OwnerSeasonRow {
  season: number;
  team_name: string | null;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  win_pct: number | null;
  points_for: number | null;
  points_against: number | null;
  avg_score: number | null;
  rank: number | null;
  final_rank: number | null;
  playoff_seed: number | null;
  all_play_win_pct: number | null;
  expected_wins: number | null;
  schedule_luck: number | null;
  dominance: number | null;
  made_playoffs: boolean;
  is_champion: boolean;
  is_runner_up: boolean;
  is_last: boolean;
}

export interface OpponentRow {
  opponent_owner_id: string;
  opponent_name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  record: string;
  win_pct: number | null;
  pair_key: string;
  rivalry_index: number | null;
}

export interface Rival {
  rival_owner_id: string;
  rival_name: string;
  pair_key: string;
  rivalry_score: number;
  meetings: number;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  reciprocal: boolean;
  last_meeting: { season: number; week: number };
  current_streak: { owner_id: string | null; length: number };
}

export interface OwnerPayload extends OwnerIndexRow {
  rival?: Rival | null;
  note: string | null;
  playoff_record: { games: number; record: string; win_pct: number | null; points_for: number | null; avg_score?: number | null };
  all_games_record: { games: number; record: string; win_pct: number | null; points_for: number | null };
  seasons_detail: OwnerSeasonRow[];
  best_season: OwnerSeasonRow | null;
  worst_season: OwnerSeasonRow | null;
  best_week: WeekRef | null;
  worst_week: WeekRef | null;
  biggest_win: WeekRef | null;
  worst_loss: WeekRef | null;
  head_to_head: {
    favorite_victim: OpponentRow | null;
    nemesis: OpponentRow | null;
    min_meetings: number;
    opponents: OpponentRow[];
  };
  efficiency: {
    started_points: number;
    optimal_points: number;
    manager_efficiency: number;
    bench_regret_total: number;
    bench_regret_per_week: number;
    weeks_measured: number;
    worst_lineup_week: { season: number; week: number; regret: number; actual: number; optimal: number } | null;
    biggest_bench_performance: { season: number; week: number; player: string; position: string; points: number } | null;
  } | null;
  weekly_history: {
    season: number;
    week: number;
    team_name: string | null;
    score: number;
    opponent_owner_id: string;
    opponent_team_name: string | null;
    opponent_score: number;
    result: Result;
    game_type: GameType;
    matchup_id: string;
  }[];
}

export interface Meeting {
  season: number;
  week: number;
  matchup_id: string | null;
  game_type: GameType;
  left_team_name: string | null;
  right_team_name: string | null;
  left_score: number;
  right_score: number;
  margin: number;
  combined: number;
  result: Result;
}

export interface ScopeRecord {
  games: number;
  left_wins: number;
  right_wins: number;
  ties: number;
  record: string;
  left_win_pct: number | null;
}

export interface H2HRecord {
  pair_key: string;
  left_owner_id: string;
  right_owner_id: string;
  left_owner_name: string;
  right_owner_name: string;
  overall: ScopeRecord;
  regular: ScopeRecord;
  playoff: ScopeRecord;
  consolation: ScopeRecord;
  left_points: number;
  right_points: number;
  left_avg: number;
  right_avg: number;
  avg_margin: number;
  avg_abs_margin: number;
  first_meeting: { season: number; week: number };
  last_meeting: Meeting;
  biggest_left_win: Meeting;
  biggest_right_win: Meeting;
  closest_meeting: Meeting;
  highest_scoring_meeting: Meeting;
  current_streak: { owner_id: string; type: Result; length: number };
  rivalry_index: { score: number; components: Record<string, number> };
  meetings: Meeting[];
}

export interface RecordEntry {
  value: number;
  display: string;
  owner_id?: string | null;
  owner_name?: string | null;
  team_name?: string | null;
  season?: number | null;
  week?: number | null;
  game_type?: GameType;
  opponent_owner_id?: string | null;
  opponent_team_name?: string | null;
  opponent_score?: number | null;
  score?: number | null;
  result?: Result;
  matchup_id?: string | null;
  home_owner_id?: string | null;
  home_team_name?: string | null;
  home_score?: number | null;
  away_owner_id?: string | null;
  away_team_name?: string | null;
  away_score?: number | null;
  margin?: number | null;
  combined?: number | null;
  record?: string | null;
  seasons?: number | null;
  player_name?: string | null;
  position?: string | null;
  nfl_team?: string | null;
  lineup_slot?: string | null;
  points_for?: number | null;
  avg_score?: number | null;
  games?: number | null;
}

export interface RecordCategory {
  id: string;
  title: string;
  group: string;
  description: string;
  unit: string;
  better: "high" | "low";
  entries: RecordEntry[];
}

export interface RecordBook {
  scopes: Record<string, { label: string; categories: RecordCategory[] }>;
  season: RecordCategory[];
  career: RecordCategory[];
  player: RecordCategory[];
}

export interface GameOfWeekCandidate {
  matchup_id: string;
  week: number;
  season: number;
  home_owner_id: string;
  away_owner_id: string;
  home_team_name: string | null;
  away_team_name: string | null;
  score: number;
  components: Record<string, number>;
  weights: Record<string, number>;
  reasons: string[];
  preview?: MatchupPreview | null;
  projection: {
    basis: string;
    home_expected: number;
    away_expected: number;
    expected_margin: number;
    favorite_owner_id: string;
    caveat: string;
  } | null;
}

export interface GameOfWeek {
  season: number;
  week: number;
  model: { weights: Record<string, number>; form_window: number; notes: string };
  pick: GameOfWeekCandidate;
  ranked: GameOfWeekCandidate[];
}

export interface Milestone {
  kind: string;
  rank: number;
  headline: string;
  detail: string;
  owner_id?: string;
  record_id?: string;
}

export interface ScoringModel {
  games: number;
  raw_mean: number;
  mean: number;
  sd: number;
  low: number;
  high: number;
}

export interface Swing {
  if_win: number;
  if_loss: number;
}

export interface MatchupPreview {
  matchup_id: string;
  week: number;
  home_owner_id: string;
  away_owner_id: string;
  home_team_name: string | null;
  away_team_name: string | null;
  home_win_pct: number;
  away_win_pct: number;
  home_model: ScoringModel;
  away_model: ScoringModel;
  home_swing: Swing;
  away_swing: Swing;
  leverage: number;
}

export interface PlayoffTeam {
  owner_id: string;
  team_name: string | null;
  rank: number;
  record: string;
  points_for: number | null;
  status: "clinched" | "eliminated" | "alive";
  playoff_pct: number;
  bye_pct: number | null;
  expected_final_wins: number;
  seed_distribution: Record<string, number>;
  top_seed_pct: number;
  model: ScoringModel;
  this_week: Swing | null;
}

export interface PlayoffPicture {
  season: number;
  as_of_week: number | null;
  next_week: number | null;
  remaining_regular_season_games: number;
  playoff_teams: number;
  byes: number;
  simulations: number;
  league_model: { mean: number; sd: number; games_per_team: number };
  teams: PlayoffTeam[];
  previews: MatchupPreview[];
  model: { shrinkage_games: number; tiebreak: string; notes: string };
}

export interface CurrentPayload {
  playoff_picture: PlayoffPicture | null;
  season: number;
  latest_completed_week: number | null;
  upcoming_week: number | null;
  regular_season_weeks: number | null;
  playoff_team_count: number | null;
  is_active: boolean;
  week: WeekPayload | null;
  upcoming_matchups: (Matchup & { preview?: MatchupPreview | null })[];
  standings: StandingsRow[];
  milestones: Milestone[];
  movement: { owner_id: string; team_name: string | null; rank: number; previous_rank: number; change: number }[];
  scoring_leaders: { owner_id: string; team_name: string | null; avg_score: number | null; points_for: number | null; all_play_win_pct: number | null; dominance: number | null }[];
}

export interface DraftPick {
  season: number;
  overall_pick: number | null;
  round: number | null;
  round_pick: number | null;
  team_id: number | null;
  owner_id: string | null;
  team_name: string | null;
  player_id: number | null;
  keeper: boolean;
  bid_amount: number | null;
  auto_pick: boolean;
}

export interface Player {
  player_id: number;
  name: string;
  position: string;
  nfl_team: string | null;
}

export interface RosterRow {
  season: number;
  week: number;
  team_id: number;
  owner_id: string | null;
  player_id: number;
  lineup_slot_id: number;
  lineup_slot: string;
  started: boolean;
  points: number | null;
  projected: number | null;
}
