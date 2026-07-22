const http = require('http');
const WebSocket = require('ws');
const { Matchmaker } = require('./matchmaking');
const { Match } = require('./match');

const PORT = process.env.PORT || 8080;

// Tiny HTTP server so hosts like Render have something to health-check.
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Rift Clash server is running.\n');
});

const wss = new WebSocket.Server({ server: httpServer });

const activePlayers = new Map(); // playerId -> { id, name, socket, match }

const matchmaker = new Matchmaker((teamA, teamB) => {
  const match = new Match(teamA, teamB);
  for (const p of [...teamA, ...teamB]) {
    const rec = activePlayers.get(p.id);
    if (rec) rec.match = match;
  }
});

function send(socket, msg) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg));
}

wss.on('connection', (socket) => {
  let playerId = null;

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'hello': {
        playerId = 'p_' + Math.random().toString(36).slice(2, 10);
        const name = (msg.name || 'Player').toString().slice(0, 16);
        activePlayers.set(playerId, { id: playerId, name, socket, match: null });
        send(socket, { type: 'welcome', playerId });
        break;
      }
      case 'join_queue': {
        if (!playerId) return;
        const rec = activePlayers.get(playerId);
        matchmaker.enqueue({ id: rec.id, name: rec.name, socket: rec.socket });
        break;
      }
      case 'leave_queue': {
        if (!playerId) return;
        matchmaker.dequeue(playerId);
        break;
      }
      case 'ban': {
        const rec = activePlayers.get(playerId);
        if (rec && rec.match) rec.match.handleBan(playerId, msg.hero);
        break;
      }
      case 'pick': {
        const rec = activePlayers.get(playerId);
        if (rec && rec.match) rec.match.handlePick(playerId, msg.hero);
        break;
      }
      case 'load_progress': {
        const rec = activePlayers.get(playerId);
        if (rec && rec.match) rec.match.handleLoadProgress(playerId, msg.pct);
        break;
      }
      case 'input': {
        const rec = activePlayers.get(playerId);
        if (rec && rec.match) rec.match.handleInput(playerId, msg.input || {});
        break;
      }
      default:
        break;
    }
  });

  socket.on('close', () => {
    if (!playerId) return;
    matchmaker.dequeue(playerId);
    const rec = activePlayers.get(playerId);
    if (rec && rec.match) rec.match.removePlayer(playerId);
    activePlayers.delete(playerId);
  });
});

httpServer.listen(PORT, () => {
  console.log('Rift Clash server listening on port ' + PORT);
});
