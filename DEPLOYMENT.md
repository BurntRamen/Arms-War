# Arms War Deployment

## Recommendation

Deploy Arms War as one Node.js web service first. The app serves its own frontend from `public/` and keeps multiplayer rooms alive in the Node process with live update streams, so a single always-on server is simpler and safer than splitting frontend and backend.

## Best First Host: Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Render can use `render.yaml`, or you can enter these settings manually:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/`
4. After deploy, Render gives the game an `onrender.com` URL.
5. Open that URL, create a table, and share the invite link with players.

## Why Not Vercel First?

Vercel is excellent for static sites and frontend apps, but Arms War is currently a stateful multiplayer Node server. Splitting it into Vercel plus a separate backend would add complexity without much benefit yet. If the app later moves to a React/Next frontend, then Vercel for the frontend plus Render for the backend would make more sense.

## Current Limitation

Active game rooms are stored in memory. They work while the server is running, but reset when the server restarts or redeploys. For a more permanent public version, add a database such as Supabase, Neon/Postgres, or Render Postgres.

Friends, messages, and leaderboard data can now persist to a file if the server has a writable durable path. Set this environment variable:

- `ARMS_WAR_DATA_FILE`: full path to a JSON file, such as `/var/data/arms-war-social.json`

On Render, use a persistent disk before relying on that file for public data. Without a persistent disk, the file can still disappear on redeploys.

## Pre-Deploy Checks

Run these before pushing changes:

```powershell
npm run check
npm run smoke
```

The smoke test starts a temporary local server and walks through a four-player multiplayer fight, including raise, concede, lane placement, and fight-result acknowledgement.
