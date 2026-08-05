# Leaderboards

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `leaderboards.ts` | `Leaderboard`, `LeaderboardEntry`, `LeaderboardConfig`, `STANDARD_LEADERBOARDS` | #6 |

9 standard leaderboards: Agent (top_performers, fastest, most_autonomous), Provider (best_uptime, lowest_cost), Workflow (most_reliable), Tool (most_reliable, most_cost_effective), Prompt (highest_quality, most_efficient). Refresh intervals from hourly to daily.