// Authoritative simulation. Runs ONLY on the server. Clients send inputs in,
// and render whatever state comes back out — they never decide outcomes themselves.
// Map geometry here is kept IN SYNC with the client's WORLD/BLUE_BASE/RED_BASE/
// laneWaypoints/setupTowers/setupJungle so the server's real map matches what
// players see: 3 lanes (top/mid/bot), a jungle with real camps, walls dividing
// the jungle from the lanes, 2 towers + 1 base tower per lane per side.

const WORLD = { w: 3200, h: 3200 };
const BLUE_BASE = { x: 260, y: WORLD.h - 260 };
const RED_BASE = { x: WORLD.w - 260, y: 260 };

function laneWaypoints(lane) {
  if (lane === 'top') {
    return [
      { x: BLUE_BASE.x, y: BLUE_BASE.y },   // blue base (260, 2940)
      { x: 260, y: 1900 },                   // brief run up the west edge
      { x: 500, y: 900 },                    // diagonal cut toward the top lane row (this is what actually shortens the vertical-only stretch)
      { x: 900, y: 260 },                    // reach the horizontal lane
      { x: 1900, y: 260 },
      { x: 2940, y: 260 },
      { x: RED_BASE.x, y: RED_BASE.y }       // red base (2940, 260)
    ];
  } else if (lane === 'mid') {
    return [
      { x: BLUE_BASE.x, y: BLUE_BASE.y },
      { x: 1000, y: 2100 },
      { x: 1600, y: 1600 },
      { x: 2200, y: 1100 },
      { x: RED_BASE.x, y: RED_BASE.y }
    ];
  } else {
    return [
      { x: BLUE_BASE.x, y: BLUE_BASE.y },
      { x: 1300, y: 2900 },                  // brief run east along the south edge
      { x: 2300, y: 2600 },                  // diagonal cut toward the bot lane column
      { x: 2940, y: 1900 },                  // reach the vertical lane
      { x: 2940, y: 900 },
      { x: RED_BASE.x, y: RED_BASE.y }
    ];
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}
function pointAlongPath(pts, t) {
  const total = pathLength(pts);
  let target = clamp(t, 0, 1) * total;
  for (let i = 1; i < pts.length; i++) {
    const segLen = dist(pts[i - 1], pts[i]);
    if (target <= segLen || i === pts.length - 1) {
      const segT = segLen === 0 ? 0 : target / segLen;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * segT,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * segT
      };
    }
    target -= segLen;
  }
  return pts[pts.length - 1];
}
// Closest point on path to an arbitrary world point, returned as {point, t}.
function closestPointOnPath(pts, p) {
  let best = pts[0], bestD = Infinity, bestT = 0, acc = 0;
  const total = pathLength(pts);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const segLen = dist(a, b);
    const segDx = (b.x - a.x) / (segLen || 1), segDy = (b.y - a.y) / (segLen || 1);
    const t = clamp((p.x - a.x) * segDx + (p.y - a.y) * segDy, 0, segLen);
    const cx = a.x + segDx * t, cy = a.y + segDy * t;
    const d = dist(p, { x: cx, y: cy });
    if (d < bestD) { bestD = d; best = { x: cx, y: cy }; bestT = (acc + t) / (total || 1); }
    acc += segLen;
  }
  return { point: best, t: bestT, dist: bestD };
}

const LANES = ['top', 'mid', 'bot'];
const LANE_PATHS = { top: laneWaypoints('top'), mid: laneWaypoints('mid'), bot: laneWaypoints('bot') };
const LANE_LENGTHS = { top: pathLength(LANE_PATHS.top), mid: pathLength(LANE_PATHS.mid), bot: pathLength(LANE_PATHS.bot) };

// Tower layout matches the client's setupTowers() exactly.
const TOWER_DEFS = [
  { team: 'blue', lane: 'top', x: 700, y: 300, tier: 'outer' },
  { team: 'blue', lane: 'top', x: 1500, y: 260, tier: 'inner' },
  { team: 'red', lane: 'top', x: 2400, y: 260, tier: 'outer' },
  { team: 'red', lane: 'top', x: 1900, y: 400, tier: 'inner' },

  { team: 'blue', lane: 'mid', x: 1000, y: 1900, tier: 'outer' },
  { team: 'blue', lane: 'mid', x: 1450, y: 1550, tier: 'inner' },
  { team: 'red', lane: 'mid', x: 2200, y: 1300, tier: 'outer' },
  { team: 'red', lane: 'mid', x: 1750, y: 1650, tier: 'inner' },

  { team: 'blue', lane: 'bot', x: 700, y: WORLD.h - 300, tier: 'outer' },
  { team: 'blue', lane: 'bot', x: 1500, y: WORLD.h - 300, tier: 'inner' },
  { team: 'red', lane: 'bot', x: 2400, y: WORLD.h - 300, tier: 'outer' },
  { team: 'red', lane: 'bot', x: 1900, y: WORLD.h - 500, tier: 'inner' },

  { team: 'blue', lane: 'base', x: BLUE_BASE.x + 90, y: BLUE_BASE.y - 90, tier: 'base' },
  { team: 'red', lane: 'base', x: RED_BASE.x - 90, y: RED_BASE.y + 90, tier: 'base' }
];

const JUNGLE_DEFS = [
  { x: 900, y: 1000, kind: 'buff-blue', hp: 1400, atk: 90 },
  { x: 2300, y: 2200, kind: 'buff-red', hp: 1400, atk: 90 },
  { x: 1600, y: 900, kind: 'lord', hp: 5500, atk: 180 },
  { x: 1600, y: 2300, kind: 'turtle', hp: 3800, atk: 90 },
  { x: 700, y: 1700, kind: 'small', hp: 900, atk: 90 },
  { x: 2500, y: 1500, kind: 'small', hp: 900, atk: 90 }
];

// ---------------------------------------------------------------------------
// WALLS: rectangular terrain segments dividing the jungle quadrants from the
// 3 lanes, mirroring MLBB's river/jungle wall layout. Units cannot pass
// through these — see resolveWallCollision(). Kept as simple axis-aligned
// rects (x, y, w, h) since the lanes themselves are all we need real
// pathing precision for; jungle wall edges just need to feel solid.
// ---------------------------------------------------------------------------
const WALLS = [
  // Blue buff camp cluster surround (camp at 900,1000 — 909px clear of mid lane)
  { x: 760, y: 780, w: 280, h: 90 },
  { x: 760, y: 780, w: 90, h: 300 },
  { x: 950, y: 990, w: 90, h: 300 },
  // Small camp near blue jungle entrance (700,1700 — 499px clear of mid lane)
  { x: 560, y: 1560, w: 90, h: 280 },
  { x: 560, y: 1840, w: 280, h: 90 },
  // Red buff camp cluster surround (camp at 2300,2200 — 909px clear of mid lane)
  { x: 2160, y: 2330, w: 280, h: 90 },
  { x: 2350, y: 2010, w: 90, h: 300 },
  { x: 2160, y: 2010, w: 90, h: 300 },
  // Small camp near red jungle entrance (2500,1500 — 499px clear of mid lane)
  { x: 2650, y: 1360, w: 90, h: 280 },
  { x: 2370, y: 1640, w: 280, h: 90 }
];

// ---------------------------------------------------------------------------
// SELF-CHECK: verify no wall intersects any lane's own path. Runs once at
// module load. If this ever throws, it means someone edited WALLS or a
// lane's waypoints without re-validating the other — exactly the bug that
// caused minions to visibly get stuck fighting terrain instead of advancing.
// ---------------------------------------------------------------------------
(function validateWallsAgainstLanes() {
  for (const lane of LANES) {
    const path = LANE_PATHS[lane];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      for (const wall of WALLS) {
        if (segmentIntersectsRectLoose(a, b, wall)) {
          throw new Error(
            `Map config error: wall ${JSON.stringify(wall)} intersects lane "${lane}" segment ${JSON.stringify(a)}->${JSON.stringify(b)}. ` +
            `Adjust WALLS or laneWaypoints() so lane paths and terrain never overlap.`
          );
        }
      }
    }
  }
})();
function segmentIntersectsRectLoose(a, b, rect) {
  // Same rect-vs-segment test as segmentIntersectsRect, duplicated here
  // (rather than reused) so this validation runs at module load time before
  // segmentIntersectsRect's own declaration is necessarily hoisted-safe to
  // call in every module loading order.
  const edges = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
    [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
    [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
    [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }]
  ];
  function ccw(p, q, r) { return (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x); }
  function segX(p1, p2, p3, p4) { return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4); }
  for (const [p1, p2] of edges) if (segX(a, b, p1, p2)) return true;
  return false;
}

function rectClosestPoint(rect, p) {
  return {
    x: clamp(p.x, rect.x, rect.x + rect.w),
    y: clamp(p.y, rect.y, rect.y + rect.h)
  };
}
// Pushes a unit back out of any wall it's currently overlapping. Called after
// every position update so movement (player input, AI, knockback, anything)
// always respects terrain the same way, in one place.
function resolveWallCollision(u) {
  const r = u.radius || 20;
  for (const wall of WALLS) {
    const insideX = u.x > wall.x && u.x < wall.x + wall.w;
    const insideY = u.y > wall.y && u.y < wall.y + wall.h;
    if (insideX && insideY) {
      // Fully inside the rectangle: rectClosestPoint would just return our
      // own position (distance 0), which can't tell us a push direction —
      // instead push out toward whichever real edge is nearest.
      const distLeft = u.x - wall.x, distRight = (wall.x + wall.w) - u.x;
      const distTop = u.y - wall.y, distBottom = (wall.y + wall.h) - u.y;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      if (minDist === distLeft) u.x = wall.x - r;
      else if (minDist === distRight) u.x = wall.x + wall.w + r;
      else if (minDist === distTop) u.y = wall.y - r;
      else u.y = wall.y + wall.h + r;
      continue;
    }
    const cp = rectClosestPoint(wall, u);
    const dx = u.x - cp.x, dy = u.y - cp.y;
    const d = Math.hypot(dx, dy);
    if (d < r && d > 0) {
      const push = (r - d);
      u.x += (dx / d) * push;
      u.y += (dy / d) * push;
    }
  }
  u.x = clamp(u.x, 20, WORLD.w - 20);
  u.y = clamp(u.y, 20, WORLD.h - 20);
}
// Simple line-of-sight check against all walls, used so movement/AI can tell
// "can I walk straight there" vs "I need to route around this wall".
function segmentIntersectsRect(a, b, rect) {
  // Quick reject via bounding box, then check the 4 rect edges against the segment.
  const edges = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
    [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
    [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
    [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }]
  ];
  for (const [p1, p2] of edges) if (segmentsIntersect(a, b, p1, p2)) return true;
  return false;
}
function segmentsIntersect(p1, p2, p3, p4) {
  function ccw(a, b, c) { return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x); }
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}
function hasLineOfSight(a, b) {
  for (const wall of WALLS) if (segmentIntersectsRect(a, b, wall)) return false;
  return true;
}
// Lightweight pathfinding: if a straight line to the target is blocked by a
// wall, route via the nearest wall corner (with a little clearance) instead
// of a full grid/A* search — cheap enough to run every tick per unit and good
// enough for rectangular terrain that's mostly "go around this block".
function nextStepToward(u, tx, ty) {
  const target = { x: tx, y: ty };
  if (hasLineOfSight(u, target)) return target;
  let best = null, bestScore = Infinity;
  for (const wall of WALLS) {
    const corners = [
      { x: wall.x - 24, y: wall.y - 24 },
      { x: wall.x + wall.w + 24, y: wall.y - 24 },
      { x: wall.x + wall.w + 24, y: wall.y + wall.h + 24 },
      { x: wall.x - 24, y: wall.y + wall.h + 24 }
    ];
    for (const c of corners) {
      if (!hasLineOfSight(u, c)) continue; // corner itself must be reachable in a straight line
      const score = dist(u, c) + dist(c, target);
      if (score < bestScore) { bestScore = score; best = c; }
    }
  }
  return best || target; // fall back to direct target if truly stuck (shouldn't happen with this wall layout)
}

function createInitialGameState(teamA, teamB, picks) {
  const units = {};
  teamA.forEach((p, i) => { units[p.id] = makeHero(p, 'blue', picks[p.id], i); });
  teamB.forEach((p, i) => { units[p.id] = makeHero(p, 'red', picks[p.id], i); });

  return {
    time: 0,
    units,           // id -> unit
    minions: [],
    towers: makeTowers(),
    jungle: makeJungle(),
    projectiles: [],
    killsBlue: 0,
    killsRed: 0,
    minionSpawnTimer: 3,
    nextId: 1
  };
}

// ---------------------------------------------------------------------------
// ROLE -> LANE ASSIGNMENT. A 5-player team is assigned one lane/role each:
// exp lane (top, usually Fighter/Tank), mid (Mage/Assassin), gold lane
// (bot, usually Marksman), jungle (roams + clears camps + ganks), roam
// (Support, follows the lane needing help / stays near bot early).
// This mirrors real MLBB team comp instead of "everyone dumped in mid".
// ---------------------------------------------------------------------------
const ROLE_ASSIGNMENT = ['top', 'jungle', 'mid', 'bot', 'roam'];
const HERO_ROLES = {
  Ronin: 'Fighter', Seren: 'Mage', Vexa: 'Marksman', Kael: 'Assassin', Nyx: 'Assassin',
  Brix: 'Tank', Tala: 'Support', Doran: 'Fighter', Ashka: 'Mage', Miri: 'Marksman'
};
// Given the 5 heroes on a team, assign each a lane role — prefer natural
// role fits (Fighter/Tank -> top, Mage/Assassin -> mid or jungle, Marksman ->
// bot, Support -> roam) but always fill all 5 slots even if the team comp
// doesn't have a clean 1-to-1 match.
function assignTeamRoles(heroNames) {
  const slots = { top: null, jungle: null, mid: null, bot: null, roam: null };
  const pool = heroNames.map((name, idx) => ({ idx, name, role: HERO_ROLES[name] || 'Fighter' }));
  const preferenceOrder = [
    { slot: 'bot', roles: ['Marksman'] },
    { slot: 'mid', roles: ['Mage'] },
    { slot: 'jungle', roles: ['Assassin'] },
    { slot: 'top', roles: ['Fighter', 'Tank'] },
    { slot: 'roam', roles: ['Support', 'Tank'] }
  ];
  for (const pref of preferenceOrder) {
    if (slots[pref.slot] !== null) continue;
    const found = pool.find(p => pref.roles.includes(p.role) && !Object.values(slots).includes(p.idx));
    if (found) slots[pref.slot] = found.idx;
  }
  // Fill any still-empty slots with whatever heroes are left, in order.
  const used = new Set(Object.values(slots).filter(v => v !== null));
  const leftover = pool.filter(p => !used.has(p.idx));
  for (const slotName of ROLE_ASSIGNMENT) {
    if (slots[slotName] === null && leftover.length) slots[slotName] = leftover.shift().idx;
  }
  // Return idx -> laneRole
  const out = {};
  for (const slotName of ROLE_ASSIGNMENT) out[slots[slotName]] = slotName;
  return out;
}

function makeHero(player, team, hero, slotIndex, laneRoleOverride) {
  const base = team === 'blue' ? BLUE_BASE : RED_BASE;
  const angle = (slotIndex || 0) * (Math.PI * 2 / 5);
  const spreadRadius = 70;
  const ox = Math.cos(angle) * spreadRadius;
  const oy = Math.sin(angle) * spreadRadius;
  return {
    id: player.id, kind: 'hero', name: player.name, hero: hero || 'Ronin', isBot: !!player.isBot,
    team, x: base.x + ox, y: base.y + oy, radius: 20,
    hp: 640, maxHp: 640, mp: 280, maxMp: 280,
    level: 1, xp: 0, xpNeeded: 100, gold: 350,
    attackDamage: 55, armor: 20, attackRange: 60, speed: 150,
    atkCd: 0, abilityCd: [0, 0, 0, 0],
    dead: false, respawnAt: 0, facing: team === 'blue' ? Math.PI * 0.25 : Math.PI * 1.25,
    laneRole: laneRoleOverride || 'mid', // top/jungle/mid/bot/roam — drives bot AI behavior
    botState: 'lane', // lane | jungle_clear | gank | recall | base_defend
    input: { moveX: 0, moveY: 0, attackTargetId: null, castAbility: null },
    lastInputAt: 0,
    kills: 0, deaths: 0
  };
}

function makeTowers() {
  return TOWER_DEFS.map((d, i) => ({
    id: 'tower_' + i, kind: 'tower', team: d.team, lane: d.lane, tier: d.tier,
    x: d.x, y: d.y, radius: d.tier === 'base' ? 40 : 30,
    hp: d.tier === 'base' ? 3000 : d.tier === 'inner' ? 2200 : 1800,
    maxHp: d.tier === 'base' ? 3000 : d.tier === 'inner' ? 2200 : 1800,
    dead: false, atkCd: 0
  }));
}

function makeJungle() {
  return JUNGLE_DEFS.map((d, i) => ({
    id: 'jungle_' + i, kind: 'jungle', team: 'neutral', x: d.x, y: d.y,
    radius: d.kind === 'lord' ? 38 : d.kind === 'turtle' ? 32 : 22,
    hp: d.hp, maxHp: d.hp, atkDamage: d.atk, campKind: d.kind,
    dead: false, atkCd: 0, respawnAt: 0
  }));
}

// Client calls this whenever the local player moves the joystick, taps attack, or casts a skill.
// The server is the only place that turns that intent into an actual state change.
function applyPlayerInput(state, playerId, input) {
  const u = state.units[playerId];
  if (!u || u.dead) return;
  if (typeof input.moveX === 'number') u.input.moveX = clamp(input.moveX, -1, 1);
  if (typeof input.moveY === 'number') u.input.moveY = clamp(input.moveY, -1, 1);
  if (input.attackTargetId !== undefined) u.input.attackTargetId = input.attackTargetId;
  if (input.castAbility !== undefined) u.input.castAbility = input.castAbility; // {slot, targetX, targetY}
  u.lastInputAt = state.time;
}

function allUnits(state) {
  return [...Object.values(state.units), ...state.minions, ...state.towers, ...state.jungle];
}
function targetableUnits(state) {
  return [...Object.values(state.units), ...state.minions, ...state.towers];
}

const INPUT_STALE_AFTER = 0.6; // seconds; see updateHero

function simulateTick(state, dt) {
  state.time += dt;

  // Assign lane roles once heroes exist and haven't been assigned yet (first tick).
  if (!state._rolesAssigned) {
    assignRolesForMatch(state);
    state._rolesAssigned = true;
  }

  state.minionSpawnTimer -= dt;
  if (state.minionSpawnTimer <= 0) {
    for (const lane of LANES) {
      for (let i = 0; i < 3; i++) {
        state.minions.push(makeMinion(state, 'blue', lane));
        state.minions.push(makeMinion(state, 'red', lane));
      }
    }
    state.minionSpawnTimer = 10;
  }

  for (const u of Object.values(state.units)) updateHero(state, u, dt);
  for (const m of state.minions) if (!m.dead) updateMinion(state, m, dt);
  for (const t of state.towers) if (!t.dead) updateTower(state, t, dt);
  for (const j of state.jungle) updateJungleCamp(state, j, dt);

  // Passive safety net: resolve wall overlap for every hero every tick, even
  // ones that didn't move this tick (e.g. attacking in place, or respawned
  // directly on top of a wall edge) — movement-triggered resolution alone
  // only fixes units that are actively walking through the code path.
  for (const u of Object.values(state.units)) if (!u.dead) resolveWallCollision(u);

  state.minions = state.minions.filter(m => !m.dead || (m._cullT = (m._cullT || 0) + dt) < 1);
  updateProjectiles(state, dt);

  const towersBlueAlive = state.towers.some(t => t.team === 'blue' && !t.dead);
  const towersRedAlive = state.towers.some(t => t.team === 'red' && !t.dead);
  if (!towersRedAlive) return { matchOver: true, winner: 'blue' };
  if (!towersBlueAlive) return { matchOver: true, winner: 'red' };
  return { matchOver: false };
}

function assignRolesForMatch(state) {
  for (const team of ['blue', 'red']) {
    const teamHeroes = Object.values(state.units).filter(u => u.team === team);
    const heroNames = teamHeroes.map(u => u.hero);
    const roleMap = assignTeamRoles(heroNames); // idx (within this team's array) -> laneRole
    teamHeroes.forEach((u, idx) => { u.laneRole = roleMap[idx] || 'mid'; });
  }
}

function makeMinion(state, team, lane) {
  const path = LANE_PATHS[lane];
  const start = team === 'blue' ? path[0] : path[path.length - 1];
  return {
    id: 'minion_' + (state.nextId++), kind: 'minion', team, lane, radius: 14, x: start.x, y: start.y,
    t: team === 'blue' ? 0 : 1, dir: team === 'blue' ? 1 : -1,
    hp: 220, maxHp: 220, speed: 60, attackRange: 55, attackDamage: 22, atkCd: 0, dead: false,
    targetId: null // locked target; only re-picked when target dies or leaves leash range
  };
}

function findTarget(state, u, range) {
  let best =  
