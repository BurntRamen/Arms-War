# Arms War

Arms War is a standalone online card game web app. It is separate from `gauntlet-online`, but it now runs like a small app/site with its own server, browser client, app manifest, icon, and start script.

## Run The App

```powershell
npm start
```

Or run the server directly:

```powershell
node server.js
```

Open `http://localhost:4173` in multiple browser windows. Create a table in one window, share that room code or invite link with 1-3 other players, choose factions in the lobby Action panel, then start the game.

## Check The App

```powershell
npm run check
npm run smoke
```

`npm run smoke` starts Arms War on a temporary local port, creates a four-player room, gets everyone through lobby readiness, runs into a fight, verifies raise/concede betting, places cards, reviews fight results, and finishes the fight.

## Deploy The Website

The recommended first deployment is a single Render Web Service. Arms War is a stateful multiplayer Node app, so keeping the frontend and backend together is simpler than splitting it across Vercel and Render right now.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Render setup. This repo includes `render.yaml`.

## App Features

- Installable browser app metadata through `public/manifest.json`.
- App icon at `public/icon.svg`.
- Service worker for the static app shell.
- Plain Node server with no dependency install required.
- Local API health check at `POST /api/health`.
- Render deployment config in `render.yaml`.
- Optional friends, messages, and leaderboard persistence with `ARMS_WAR_DATA_FILE`.

## Optional Social Persistence

By default, friends, messages, and leaderboard stats are in memory. To persist them to a writable file, start the app with `ARMS_WAR_DATA_FILE` set:

```powershell
$env:ARMS_WAR_DATA_FILE="C:\arms-war-data\social.json"
npm start
```

On Render, this should point to a mounted persistent disk path. Active multiplayer rooms are still intentionally in memory for this prototype.

## Implemented Rules

- Two-to-four-player online rooms with live updates.
- Each player starts with a shuffled 52-card deck split into a 26-card main deck and 26-card side deck.
- First player is decided by die roll.
- Each turn the active player rolls the action die and chooses one of the two listed options.
- Craft, Burn, Event, Fight, and Waygate are implemented.
- Players start with 10 gold because the rules did not specify a starting amount.
- Fight betting supports agree, raise, and concede.
- Fight cards are placed into three lanes face-down to the opponent, then revealed for commander abilities and lane comparison.
- Fight winners gain one technology. If they already have three technologies, the win triggers an event instead.
- Factions are included for Rumin, Sheen, Frumo, and Bizi. Each has a commander ability and city ability from the Arms War cards sheet.
