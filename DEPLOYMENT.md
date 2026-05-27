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

Rooms, messages, friends, and leaderboard data are stored in memory. They work while the server is running, but reset when the server restarts or redeploys. For a more permanent public version, add a database such as Supabase, Neon/Postgres, or Render Postgres.
