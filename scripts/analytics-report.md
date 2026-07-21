# Analytics report

A scheduled rollup of the Vercel Web Analytics custom events the game reports
(defined in `src/analytics.ts`): the first-tower funnel, engagement, tool mix,
star progression, existing-tower state, crash reliability, and version adoption.

## How it runs

`.github/workflows/analytics-report.yml` runs `scripts/analytics-report.mjs`
twice a week (Tuesday and Friday) and uploads the result as a workflow artifact
named `analytics-report` (a single styled HTML report, 90-day retention). The
raw JSON API responses are printed to the run log rather than saved as a file.
You can also run it on demand from the Actions tab with **Run workflow** and an
optional look-back in days.

It also writes a plain-markdown version to the run's **job summary**, so you can
read the report inline on the workflow run page with no download. GitHub
sanitizes the summary (no custom CSS), so that view is plain; the HTML artifact
carries the retro styling.

Note: GitHub always packages an artifact as a `.zip` on download, even for one
file, so the download is `analytics-report.zip` containing the single `.html`.

The HTML report is a self-contained page styled to match the game's own look
(the Windows 3.1 / SimTower tokens from `src/styles/retro-tokens.css`, copied in
as literal values since this is a build-free script). Open the `.html` from the
artifact in any browser.

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

Output is `reports/analytics-report-<date>.html`; the raw JSON (every API
response) is printed to stdout, so a run is useful even if a section fails to
render.

To preview the layout and styling with sample data (no token or traffic needed):

```bash
node scripts/analytics-report.mjs --demo --out reports
```

## Plan note

Grouping by custom event properties (the `eventData/<prop>` breakdown tables)
needs a Vercel Pro plan. On Hobby the top-line counts still work and each
property table is reported as skipped with the reason. The equivalent Vercel CLI
query for a single breakdown is, for reference:

```bash
vercel metrics vercel.analytics_event.count \
  --filter "event_name eq 'boot'" --group-by event_data/reason --since 7d --prod
```
