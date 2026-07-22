const {
  HEROES, BAN_SLOTS, BAN_TURN_MS, PICK_TURN_MS, LOADING_MS, TICK_RATE
} = require('./constants');
const { simulateTick, createInitialGameState, applyPlayerInput } = require('./simulation');

let matchCounter = 0;

/**
 * One full match: ban -> pick -> loading -> live simulation -> ended.
 * Broadcasts state to every connected player (real or spectating), drives bots itself.
 *
 * Both the ban phase and pick phase are turn-based, one action per player at a
 * time (matching the reference: a single active picker with their own visible
 * countdown, not one shared clock for the whole phase). Each turn gets its own
 * fresh phaseEndsAt broadcast to the whole match — this is what was missing
 * before, which was why the client's countdown flickered and hit 0 mid-draft:
 * the server was only ever sending the deadline for the ENTIRE phase, not the
 * current turn, so the visible number had no relationship to whose turn it was.
 */
class Match {
  constructor(teamA, teamB, registerMatch) {
    this.id = 'match_' + (++matchCounter) + '_' + Date.now().toString(36);
    this.teamA = teamA; // blue
    this.teamB = teamB; // red
    this.players = [...teamA, ...teamB];
    this.registerMatch = registerMatch;

    this.phase = 'ban'; // ban -> pick -> loading -> live -> ended
    this.bans = [];             // [{ team, hero, by }]
    this.picks = {};            // playerId -> hero
    this.banOrder = this._buildBanOrder();   // one ban-turn per slot, alternating teams, one player "on the clock" per team turn
    this.banIndex = 0;
    this.pickOrder = this._buildDraftOrder();
    this.pickIndex = 0;
    this.phaseEndsAt = Date.now() + BAN_TURN_MS;
    this.loadProgress = {};     // playerId -> 0..100

    this.gameState = null;
    this.tickHandle = null;
    this.phaseTimer = null;

    this._broadcastAll();
    this._scheduleNextBanTurn();
  }

  // ---------- ban order: alternate blue/red, cycling through each team's 5 players ----------
  _buildBanOrder() {
    const order = [];
    for (let i = 0; i < BAN_SLOTS / 2; i++) {
      order.push({ team: 'blue', playerId: this.teamA[i % this.teamA.length].id });
      order.push({ team: 'red', playerId: this.teamB[i % this.teamB.length].id });
    }
    return order;
  }

  // ---------- draft order: alternating blue/red, roughly MLBB-style ----------
  _buildDraftOrder() {
    const order = [];
    for (let i = 0; i < 5; i++) {
      order.push(this.teamA[i % this.teamA.length].id);
      order.push(this.teamB[i % this.teamB.length].id);
    }
    return order;
  }

  _playerById(id) { return this.players.find(p => p.id === id); }
  _teamOf(id) { return this.teamA.some(p => p.id === id) ? 'blue' : 'red'; }

  // ---------- BAN PHASE (turn-based) ----------
  _scheduleNextBanTurn() {
    if (this.banIndex >= this.banOrder.length) { this._startPickPhase(); return; }
    const turn = this.banOrder[this.banIndex];
    this.phaseEndsAt = Date.now() + BAN_TURN_MS; // fresh per-turn deadline, broadcast below
    this._broadcastAll();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    const player = this._playerById(turn.playerId);
    // Bots act quickly (4-5s in) instead of sitting through the whole turn
    // timer like a stalled human would — real players still get the full
    // BAN_TURN_MS grace period before auto-ban kicks in on their behalf.
    const delay = (player && player.isBot) ? (4000 + Math.random() * 1000) : BAN_TURN_MS;
    this.phaseTimer = setTimeout(() => {
      if (this.phase === 'ban' && this.banIndex < this.banOrder.length && this.banOrder[this.banIndex] === turn) {
        this._autoBan(turn);
      }
    }, delay);
  }

  handleBan(playerId, hero) {
    if (this.phase !== 'ban') return;
    const turn = this.banOrder[this.banIndex];
    if (!turn || turn.playerId !== playerId) return; // not your turn
    if (this.bans.some(b => b.hero === hero)) return;
    this.bans.push({ team: turn.team, hero, by: playerId });
    this.banIndex++;
    this._scheduleNextBanTurn();
  }

  _autoBan(turn) {
    const taken = new Set(this.bans.map(b => b.hero));
    const available = HEROES.filter(h => !taken.has(h));
    const hero = available[Math.floor(Math.random() * available.length)] || HEROES[0];
    this.bans.push({ team: turn.team, hero, by: null });
    this.banIndex++;
    this._scheduleNextBanTurn();
  }

  // ---------- PICK PHASE (turn-based) ----------
  _startPickPhase() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phase = 'pick';
    this.pickIndex = 0;
    this._scheduleNextPickTurn();
  }

  _scheduleNextPickTurn() {
    if (this.pickIndex >= this.pickOrder.length) { this._startLoading(); return; }
    const currentPlayerId = this.pickOrder[this.pickIndex];
    this.phaseEndsAt = Date.now() + PICK_TURN_MS; // fresh per-turn deadline, broadcast below
    this._broadcastAll();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    const player = this._playerById(currentPlayerId);
    const delay = (player && player.isBot) ? (4000 + Math.random() * 1000) : PICK_TURN_MS;
    this.phaseTimer = setTimeout(() => {
      if (this.phase === 'pick' && this.pickOrder[this.pickIndex] === currentPlayerId && !this.picks[currentPlayerId]) {
        this._autoPick(currentPlayerId);
      }
    }, delay);
  }

  handlePick(playerId, hero) {
    if (this.phase !== 'pick') return;
    if (this.pickOrder[this.pickIndex] !== playerId) return; // not your turn
    if (this.bans.some(b => b.hero === hero)) return;
    if (Object.values(this.picks).includes(hero)) return;
    this.picks[playerId] = hero;
    this.pickIndex++;
    this._scheduleNextPickTurn();
  }

  _autoPick(playerId) {
    const taken = new Set([...this.bans.map(b => b.hero), ...Object.values(this.picks)]);
    const available = HEROES.filter(h => !taken.has(h));
    const hero = available[Math.floor(Math.random() * available.length)] || HEROES[0];
    this.picks[playerId] = hero;
    this.pickIndex++;
    this._scheduleNextPickTurn();
  }

  // ---------- LOADING PHASE ----------
  _startLoading() {
    this.phase = 'loading';
    this.phaseEndsAt = Date.now() + LOADING_MS;
    for (const p of this.players) this.loadProgress[p.id] = p.isBot ? 100 : 0;
    this._broadcastAll();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => this._startLive(), LOADING_MS);
  }

  handleLoadProgress(playerId, pct) {
    if (this.phase !== 'loading') return;
    this.loadProgress[playerId] = Math.max(0, Math.min(100, pct));
    this._broadcastAll();
  }

  // ---------- LIVE MATCH ----------
  _startLive() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phase = 'live';
    this.gameState = createInitialGameState(this.teamA, this.teamB, this.picks);
    this._broadcastAll();

    const dt = 1 / TICK_RATE;
    this.tickHandle = setInterval(() => {
      const result = simulateTick(this.gameState, dt);
      this._broadcastState();
      if (result.matchOver) this._endMatch(result.winner);
    }, 1000 / TICK_RATE);
  }

  handleInput(playerId, input) {
    if (this.phase !== 'live' || !this.gameState) return;
    applyPlayerInput(this.gameState, playerId, input);
  }

  _endMatch(winner) {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.phase = 'ended';
    this.winner = winner;
    this._broadcastAll();
  }

  // ---------- networking ----------
  _send(player, msg) {
    if (player.socket && player.socket.readyState === 1) {
      player.socket.send(JSON.stringify(msg));
    }
  }

  _broadcastAll() {
    const activeBanTurn = (this.phase === 'ban' && this.banIndex < this.banOrder.length) ? this.banOrder[this.banIndex] : null;
    const payload = {
      type: 'match_state',
      matchId: this.id,
      phase: this.phase,
      teamA: this.teamA.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
      teamB: this.teamB.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
      bans: this.bans,
      banOrder: this.banOrder,
      banIndex: this.banIndex,
      activeBanPlayerId: activeBanTurn ? activeBanTurn.playerId : null,
      picks: this.picks,
      pickOrder: this.pickOrder,
      pickIndex: this.pickIndex,
      phaseEndsAt: this.phaseEndsAt,
      loadProgress: this.loadProgress,
      winner: this.winner || null
    };
    for (const p of this.players) this._send(p, { ...payload, you: p.id, yourTeam: this._teamOf(p.id) });
  }

  _broadcastState() {
    if (!this.gameState) return;
    const payload = { type: 'game_tick', matchId: this.id, state: this.gameState };
    for (const p of this.players) this._send(p, payload);
  }

  removePlayer(playerId) {
    // Real player disconnected mid-match: hand control to a bot rather than crashing the match.
    const p = this._playerById(playerId);
    if (p) p.isBot = true;
  }
}

module.exports = { Match };
