const { MATCH_SIZE, TEAM_SIZE, QUEUE_BOT_FILL_MS } = require('./constants');

/**
 * Simple FIFO matchmaking queue. When enough real players are queued,
 * or the fill timer expires, a match is formed (padded with bots).
 */
class Matchmaker {
  constructor(onMatchReady) {
    this.queue = [];           // [{ id, name, socket }]
    this.onMatchReady = onMatchReady;
    this.fillTimer = null;
  }

  enqueue(player) {
    this.queue.push(player);
    this._broadcastQueueStatus();

    if (this.queue.length >= MATCH_SIZE) {
      this._formMatch(MATCH_SIZE);
      return;
    }
    if (!this.fillTimer) {
      this.fillTimer = setTimeout(() => {
        this.fillTimer = null;
        if (this.queue.length > 0) this._formMatch(this.queue.length);
      }, QUEUE_BOT_FILL_MS);
    }
  }

  dequeue(playerId) {
    this.queue = this.queue.filter(p => p.id !== playerId);
    this._broadcastQueueStatus();
  }

  _broadcastQueueStatus() {
    for (const p of this.queue) {
      this._send(p, { type: 'queue_status', inQueue: this.queue.length, needed: MATCH_SIZE });
    }
  }

  _formMatch(realCount) {
    if (this.fillTimer) { clearTimeout(this.fillTimer); this.fillTimer = null; }
    const real = this.queue.splice(0, realCount);
    const botsNeeded = MATCH_SIZE - real.length;
    const bots = [];
    for (let i = 0; i < botsNeeded; i++) {
      bots.push({ id: 'bot_' + Math.random().toString(36).slice(2, 9), name: this._botName(i), isBot: true });
    }
    const allPlayers = [...real.map(p => ({ ...p, isBot: false })), ...bots];

    // Split into two balanced teams of TEAM_SIZE
    this._shuffle(allPlayers);
    const teamA = allPlayers.slice(0, TEAM_SIZE);
    const teamB = allPlayers.slice(TEAM_SIZE, TEAM_SIZE * 2);

    this.onMatchReady(teamA, teamB);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _botName(i) {
    const names = ['Shadow', 'Blaze', 'Nova', 'Grit', 'Echo', 'Vex', 'Talon', 'Rune', 'Frost', 'Ash'];
    return names[i % names.length] + '_AI';
  }

  _send(player, msg) {
    if (player.socket && player.socket.readyState === 1) {
      player.socket.send(JSON.stringify(msg));
    }
  }
}

module.exports = { Matchmaker };
