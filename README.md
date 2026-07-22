# Rift Clash Server

Authoritative 5v5 matchmaking + realtime game server. This is what makes the game
actually multiplayer: every player's moves and skills go THROUGH this server, and
everyone's screen renders the SAME state this server computes. Nothing is decided
locally on any player's device anymore.

## What it does
- Matchmaking queue (waits for 10 players, fills empty slots with bots after ~12s)
- Ban phase (6 bans) -> Pick phase (turn-based, auto-picks if someone stalls) -> Loading screen (0-100%) -> Live match
- Runs the whole match simulation itself (movement, combat, minions, towers, deaths, gold, XP) at 20 ticks/second
- Broadcasts state to all 10 players every tick over WebSocket

## 1. Push to GitHub
```bash
cd rift-clash-server
git init
git add .
git commit -m "Rift Clash server"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rift-clash-server.git
git push -u origin main
```

## 2. Deploy on Render (free)
1. Go to https://render.com and sign in with GitHub
2. Click **New +** -> **Web Service**
3. Pick your `rift-clash-server` repo
4. Render should auto-detect `render.yaml`. If not, set manually:
   - Build command: `npm install`
   - Start command: `npm start`
5. Click **Create Web Service**
6. Wait for the build to finish. You'll get a URL like:
   `https://rift-clash-server.onrender.com`

## 3. Connect the client
In the game HTML file, set the server URL to your Render URL but with `wss://` instead of `https://`:
```js
const SERVER_URL = "wss://rift-clash-server.onrender.com";
```

## Notes
- Free Render services sleep after inactivity; the first connection after a while takes ~30-50s to wake up. Fine for testing, upgrade to a paid instance later for instant availability.
- To test locally first: `npm install && npm start`, then point the client at `ws://localhost:8080`.
