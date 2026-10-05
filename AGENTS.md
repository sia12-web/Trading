# Agent notes — Trading (Day Trading Railway)

## Railway deploy

- **Project:** Day Trading (`673bbfd3-ad02-4293-a6b6-7910d11d102d`)
- **Service:** Trading
- **Environment:** production
- **Never** deploy this app to the BOT / Strategy Desk Railway project.

### Token source (in order)

1. Env `RAILWAY_TOKEN` (Cursor Cloud secret — preferred for every new agent)
2. `railway-vars.local.json` (gitignored) → `RAILWAY_TOKEN`

Bootstrap local file from the secret:

```bash
node scripts/sync-railway-token.mjs
```

Deploy:

```bash
export RAILWAY_TOKEN="$(node -e "console.log(JSON.parse(require('fs').readFileSync('railway-vars.local.json','utf8')).RAILWAY_TOKEN||process.env.RAILWAY_TOKEN||'')")"
npx @railway/cli up --service Trading --environment production --detach
```

Do **not** commit `railway-vars.local.json` (public repo).
