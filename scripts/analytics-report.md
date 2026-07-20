# Analytics report

A scheduled rollup of the Vercel Web Analytics custom events the game reports
(defined in `src/analytics.ts`): the first-tower funnel, engagement, tool mix,
star progression, existing-tower state, crash reliability, and version adoption.

## How it runs

`.github/workflows/analytics-report.yml` runs `scripts/analytics-report.mjs`
twice a week (Tuesday and Friday) and uploads the result as a workflow artifact
named `analytics-report` (markdown + JSON, 90-day retention). You can also run it
on demand from the Actions tab with **Run workflow** and an optional look-back in
days.

## Setup (one secret)

Add a repository secret `VERCEL_TOKEN`:

1. Vercel > Account Settings > Tokens > Create Token, scoped to the team.
2. GitHub repo > Settings > Secrets and variables > Actions > New repository
   secret, name `VERCEL_TOKEN`.

The project and team IDs are set as plain `env` in the workflow (not secrets).

## Run it locally

```bash
VERCEL_TOKEN=xxx \
VERCEL_PROJECT_ID=prj_06eFZFQdFZ49EiEWmXkkphKAOSSF \
VERCEL_TEAM_ID=team_ArE8nhexpkACNIlDHVKU80Pj \
node scripts/analytics-report.mjs --days 30 --out reports
```

Output goes to `reports/analytics-report-<date>.md` and `.json`. The JSON keeps
every raw API response, so a run is useful even if a section fails to render.

## Plan note

Grouping by custom event properties (the `eventData/<prop>` breakdown tables)
needs a Vercel Pro plan. On Hobby the top-line counts still work and each
property table is reported as skipped with the reason. The equivalent Vercel CLI
query for a single breakdown is, for reference:

```bash
vercel metrics vercel.analytics_event.count \
  --filter "event_name eq 'boot'" --group-by event_data/reason --since 7d --prod
```
