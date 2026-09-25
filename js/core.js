// 昼休みの宇宙戦争・危険宙域編 — シミュレーション本体（描画・入力・音に依存しない）
// 前作までの移動・戦闘・敵AI・任務管理をそのまま使い、
// 戦場の危険（巨大レーザー砲台・質量兵器・機雷原・敵主力艦隊）だけを足している。
(function (root) {
  'use strict';

  const C = {
    W: 1600,
    V: 60,          // 通常前進速度。自艦隊・敵艦隊・敵主力・友軍すべて共通
    V_BACK: 24,     // 後退速度（前進より遅い）
    TURN: 1.5,
    ACC: 90,
    SLOT_P: 12,
    SLOT_E: 11,
    P: { hp: 8, dmg: 0.25, cd: 1.2, range: 130 },
    E: { hp: 6, dmg: 1, cd: 1.0, range: 120 },
    M: { hp: 8, dmg: 0.25, cd: 1.2, range: 130 },  // 敵主力艦隊：自艦隊と同じ性能
    N: { hp: 10, dmg: 0.3, cd: 1.2, range: 120 },  // 友軍：足止めはできるが敵主力には勝てない
    S: { hp: 60, dmg: 0.3, cd: 1.6, range: 100 },
    B: { hp: 100, dmg: 0, cd: 1, range: 0 },       // 砲台・質量兵器：通常の射撃はしない
    V_NPC: 0.85,
    V_CONVOY: 0.78,
    V_FLEE: 0.75,
    AGGRO: 180,      // 索敵距離（艦隊の外縁同士）
    LEASH: 260,      // 持ち場からこれ以上離れると戦列へ戻る
    MAIN_AGGRO: 290, // 敵主力は広く見張る
    MAIN_LEASH: 640,
    STANDOFF: 55,
    HOT_P: 60,
    HOT_N: 190,      // 友軍の戦闘は特に敵を引きつける
    THREAT_P: 40,
    PURSUE_DELAY: 5,
    PURSUE_R: 600,
    LOSE: 760,
    LURE_R: 600,
    SHADOW: 95,
    MIN_RATIO: 0.15,
    SECTORS: 16,
    SURROUND_NEED: 14,
    SURROUND_R: 110,
    SURROUND_T: 5,
    LASER_DPS: 16,   // 射線上の艦は1秒足らずで沈む
    MINE_TICK: 0.5,  // 機雷原の判定間隔（秒）
  };
  const TAU = Math.PI * 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const hostile = (a, b) => (a.fac === 'E') !== (b.fac === 'E');
  const statOf = g => C[g.stat || g.fac];
  const slotSp = g => (g.fac === 'P' || g.stat === 'M') ? C.SLOT_P : C.SLOT_E;
  // 砲台・質量兵器：艦隊ではない構造物（包囲・接触・機雷・レーザーの対象外）
  const inert = g => g.role === 'battery' || g.role === 'mass';
  function lerpAngle(a, b, k) {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * k;
  }
  const angDiff = (a, b) => Math.abs(((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI);
  // 進行方向（0 = 上、時計回り）の単位ベクトル
  const dirOf = a => [Math.sin(a), -Math.cos(a)];

  const slotCache = new Map();
  function hexSlots(n, sp) {
    const key = n + ':' + sp;
    let s = slotCache.get(key);
    if (s) return s;
    const pts = [];
    const R = Math.ceil(Math.sqrt(n)) + 2;
    for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
      const x = sp * (q + r / 2), y = sp * r * 0.8660254;
      pts.push({ x, y, d: x * x + y * y + Math.atan2(y, x) * 0.01 });
    }
    pts.sort((a, b) => a.d - b.d);
    s = pts.slice(0, n);
    slotCache.set(key, s);
    return s;
  }

  // ---------------------------------------------------------------- 生成
  function makeGroup(S, fac, x, y, n, extra) {
    const g = {
      id: S.nextId++, fac, x, y, vx: 0, vy: 0, r: 0, ships: [], alive: true, active: true,
      heading: fac === 'E' ? Math.PI : 0, face: fac === 'E' ? Math.PI : 0,
      mode: 'hold', target: null, retarget: S.rng() * 0.5, home: { x, y }, base: null, line: null, idx: 0,
      delay: 0, wps: [], wpi: 0, trigger: null, dirty: false, hot: 0,
      role: null, n0: n, arrived: false, out: 0, speed: C.V * C.V_NPC,
    };
    if (extra) Object.assign(g, extra);
    const st = statOf(g);
    g.formA = g.face;
    const slots = hexSlots(n, slotSp(g));
    for (let i = 0; i < n; i++) {
      g.ships.push({ x: x + slots[i].x, y: y + slots[i].y, hp: g.hp0 || st.hp, cd: S.rng() * st.cd, a: g.heading, g, alive: true, ph: S.rng() * TAU, flash: 0 });
    }
    updateRadius(g);
    S.groups.push(g);
    return g;
  }
  function updateRadius(g) {
    const n = g.ships.length, sp = slotSp(g);
    if (g.fixedR) { g.r = n ? g.fixedR : 0; return; }
    if (g.fac === 'S') { g.r = n ? 13 : 0; return; }
    g.r = n ? Math.sqrt(n * sp * sp * 0.866 / Math.PI) + 4 : 0;
  }
  function snapShips(g) {
    const slots = hexSlots(g.ships.length, slotSp(g));
    g.ships.forEach((s, i) => { s.x = g.x + slots[i].x; s.y = g.y + slots[i].y; s.a = g.face; });
  }

  // 戦列：o.breach = 'up' | 'down'、o.pursue = false で追撃なし
  function makeLine(S, o) {
    const L = {
      name: o.name, squads: [], breached: false, ring: o.ring || null, motion: o.motion || null,
      baseY: Infinity, baseMaxY: -Infinity, y: 0, maxY: 0, R: o.ring ? o.ring.R0 : 0, linkMax: o.linkMax != null ? o.linkMax : 175,
      breach: o.breach || null, pursue: o.pursue !== false, passed: false, hidden: !!o.hidden,
    };
    if (L.motion && L.motion.kind === 'follow') { L.motion.x0 = L.motion.g.x; L.motion.y0 = L.motion.g.y; }
    o.pts.forEach((p, i) => {
      const g = makeGroup(S, 'E', p.x, p.y, p.n, o.extra);
      g.line = L; g.idx = i; g.base = { x: p.x, y: p.y, a: p.a || 0 };
      if (L.ring) g.face = g.heading = p.a + Math.PI / 2 + Math.PI;
      L.squads.push(g);
      L.baseY = Math.min(L.baseY, p.y);
      L.baseMaxY = Math.max(L.baseMaxY, p.y);
    });
    S.lines.push(L);
    return L;
  }
  function row(S, y, x0, x1, count, n, skip, jitter) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      if (skip && skip.includes(i)) continue;
      pts.push({ x: x0 + (x1 - x0) * i / (count - 1), y: y + (S.rng() - 0.5) * (jitter || 0), n: typeof n === 'function' ? n(i) : n });
    }
    return pts;
  }
  // avoid: 射線の向き（進行方向の角度）の配列。その方向の持ち場は空けておく
  function ring(cx, cy, R, count, n, avoid) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + i * TAU / count;
      if (avoid && avoid.some(h => angDiff(a, Math.atan2(-Math.cos(h), Math.sin(h))) < 0.42)) continue;
      pts.push({ a, n, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    }
    return { ring: { cx, cy, R0: R, Rmin: R, rate: 0, start: 0 }, pts };
  }
  function makeNpc(S, x, y, n, wps, trigger) {
    const g = makeGroup(S, 'N', x, y, n);
    g.wps = wps; g.trigger = trigger || null; g.active = !trigger;
    return g;
  }
  function makeTarget(S, x, y, n, name) {
    const g = makeGroup(S, 'E', x, y, n, { role: 'target', leash: 90, name });
    S.target = g;
    return g;
  }
  // 敵主力艦隊：自艦隊と同じ性能・ほぼ同じ規模。持ち場（homeFn）の周りを広く見張る
  function makeMain(S, x, y, n, extra) {
    const g = makeGroup(S, 'E', x, y, n, Object.assign({
      role: 'main', stat: 'M', name: '敵主力艦隊', aggro: C.MAIN_AGGRO, leash: C.MAIN_LEASH,
    }, extra));
    S.mains.push(g);
    return g;
  }

  // 巨大レーザー砲台。aims を順に狙い、sweep（度）があれば発射中に射角が動く
  function makeBattery(S, x, y, o) {
    const aims = o.aims || [o.aim];
    const g = makeGroup(S, 'E', x, y, 1, {
      role: 'battery', stat: 'B', fixedR: 30, hp0: o.hp, name: o.name || 'レーザー砲台',
      heading: aims[0], face: aims[0], leash: 0,
    });
    g.ships[0].rad = 24;
    const sweep = (o.sweep || 0) * Math.PI / 180;
    g.laser = {
      aims, ai: 0, aim: aims[0], cur: aims[0] - sweep / 2, sweep, charge: o.charge, fire: o.fire,
      t: o.charge - o.first, state: 'charge', width: o.width || 44, dps: o.dps || C.LASER_DPS,
      range: o.range || 3400, len: 0, wlen: [0, 0], shots: 0,
    };
    g.ships[0].a = g.laser.cur;
    if (o.target) S.target = g;
    S.batteries.push(g);
    return g;
  }

  // 質量兵器：巨大・高耐久・低速。反撃せず一定方向へ進み続ける
  function makeMass(S, x, y, o) {
    const g = makeGroup(S, 'E', x, y, 1, {
      role: 'mass', stat: 'B', fixedR: o.r, hp0: o.hp, name: o.name || '質量兵器',
      dir: o.dir, mspeed: o.speed, goal: o.goal, leash: 0, spin: (S.rng() - 0.5) * 0.08,
    });
    g.ships[0].rad = o.r * 0.9;
    const verts = [], k = 16;
    for (let i = 0; i < k; i++) {
      const a = i / k * TAU + S.rng() * 0.15;
      verts.push([Math.cos(a) * o.r * (0.86 + S.rng() * 0.18), Math.sin(a) * o.r * (0.86 + S.rng() * 0.18)]);
    }
    g.verts = verts;
    g.craters = [];
    for (let i = 0; i < 6; i++) {
      const a = S.rng() * TAU, d = S.rng() * o.r * 0.55;
      g.craters.push([Math.cos(a) * d, Math.sin(a) * d, o.r * (0.08 + S.rng() * 0.1)]);
    }
    if (o.target) S.target = g;
    S.masses.push(g);
    return g;
  }

  // 機雷原（多角形）。中にいる艦は一定間隔ごとに一定確率で沈む
  function inPoly(P, x, y) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function makeMines(S, pts, o) {
    o = o || {};
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const m = {
      pts, rate: o.rate || 0.014, name: o.name || '機雷原',
      x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), dots: [],
    };
    let r = 0;
    for (let y = m.y0 + 18; y < m.y1; y += 44, r++) for (let x = m.x0 + 16 + (r % 2) * 26; x < m.x1; x += 52) {
      const jx = x + (S.rng() - 0.5) * 26, jy = y + (S.rng() - 0.5) * 20;
      if (inPoly(pts, jx, jy)) m.dots.push([jx, jy, S.rng() * TAU]);
    }
    m.cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    S.mines.push(m);
    return m;
  }

  function addRock(S, x, y, r) {
    const verts = [];
    const k = 9 + Math.floor(S.rng() * 5);
    for (let i = 0; i < k; i++) {
      const a = i / k * TAU + S.rng() * 0.3;
      const rr = r * (0.82 + S.rng() * 0.26);
      verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    S.rocks.push({ x, y, r, verts, rot: S.rng() * TAU, spin: (S.rng() - 0.5) * 0.03 });
  }
  function scatterRocks(S, y0, y1, count, rmin, rmax, gap, x0, x1) {
    x0 = x0 == null ? 60 : x0; x1 = x1 == null ? C.W - 60 : x1;
    let tries = 0;
    while (count > 0 && tries++ < 4000) {
      const r = rmin + S.rng() * (rmax - rmin);
      const x = x0 + S.rng() * (x1 - x0), y = y0 + S.rng() * (y1 - y0);
      if (S.rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + gap)) continue;
      if (S.mines.some(m => inPoly(m.pts, x, y))) continue;
      // 質量兵器の進路には置かない
      if (S.masses.some(m => { const [dx, dy] = dirOf(m.dir); return Math.abs(m.x + dx / dy * (y - m.y) - x) < m.fixedR + r + 70; })) continue;
      addRock(S, x, y, r);
      count--;
    }
  }
  function zone(S, name, z) { S.zones[name] = z; return z; }
  function inZone(S, name, g) {
    const z = S.zones[name];
    if (!z) return false;
    if (z.kind === 'circle') return Math.hypot(g.x - z.x, g.y - z.y) <= z.r;
    return z.side === 'top' ? g.y <= z.y : g.y >= z.y;
  }
  const atTime = t => s => s.t > t;
  const laneOf = a => [a]; // 読みやすさのための別名

  // ---------------------------------------------------------------- ステージ
  // phases: kind = kill | intercept | exit（前作の escort / breach / retreat / lure も使える）
  // limit: その任務の制限時間（秒）
  const STAGES = [
    {
      name: '砲撃圏', short: '砲台',
      sortie: 70, H: 2600, start: [800, 2380],
      phases: [
        { kind: 'kill', text: 'レーザー砲台を破壊せよ', sub: '友軍本隊が射程に入る前に', limit: 150, limitText: '友軍本隊 到着まで' },
      ],
      alarmR: 500,
      build(S) {
        const aim = Math.PI + 0.14; // 左下へ斜めに走る固定射線
        makeBattery(S, 800, 430, { aim, charge: 11, fire: 2.4, first: 9, hp: 120, width: 46, target: true, name: '大型レーザー砲台' });
        makeLine(S, Object.assign({ name: '砲台直衛' }, ring(800, 430, 175, 8, 5, laneOf(aim))));
        // 射線の右側は守りが厚く、左側は薄い
        makeLine(S, { name: '右翼守備隊', pts: [[1080, 560], [1170, 700], [1020, 790]].map(([x, y]) => ({ x, y, n: 6 })), linkMax: 0, extra: { leash: 300 } });
        makeGroup(S, 'E', 520, 820, 5);
        makeLine(S, { name: '哨戒線', pts: row(S, 1480, 380, 1220, 4, 5, null, 30), motion: { kind: 'sway', A: 200, T: 28, ph: 0 }, linkMax: 300 });
        scatterRocks(S, 1000, 1280, 4, 45, 80, 160, 700, 1500);
        scatterRocks(S, 1850, 2150, 3, 40, 70, 160, 850, 1500);
        // 友軍の先遣隊。射線の上を進んでしまう
        makeNpc(S, 470, 2150, 8, [[610, 1650], [650, 1250]], atTime(0.5));
        makeNpc(S, 330, 2240, 8, [[470, 1700], [520, 1300]], atTime(0.5));
      },
    },
    {
      name: '機雷帯', short: '機雷',
      sortie: 80, H: 3000, start: [800, 2800],
      phases: [
        { kind: 'exit', zone: 'goal', text: '機雷帯を越え、集結地点へ向かえ', sub: '通るか、迂回するか' },
      ],
      build(S) {
        zone(S, 'goal', { kind: 'band', side: 'top', y: 420, label: '集結地点' });
        makeMines(S, [[250, 1430], [520, 1330], [800, 1300], [1080, 1330], [1350, 1410], [1350, 1770], [1080, 1830], [800, 1860], [520, 1820], [250, 1710]], { rate: 0.014 });
        // 迂回路にはそれぞれ守備隊
        makeLine(S, { name: '左回廊守備隊', pts: [[100, 1480], [210, 1520], [120, 1640], [200, 1360], [110, 1250]].map(([x, y]) => ({ x, y, n: 6 })), linkMax: 130, extra: { leash: 300 } });
        makeLine(S, { name: '右回廊守備隊', pts: [[1500, 1500], [1390, 1540], [1480, 1660], [1400, 1380], [1490, 1270]].map(([x, y]) => ({ x, y, n: 6 })), linkMax: 130, extra: { leash: 300 } });
        addRock(S, 110, 1930, 58); addRock(S, 1500, 1960, 55); addRock(S, 1495, 1180, 50); addRock(S, 115, 1150, 52);
        makeLine(S, { name: '警戒線', pts: row(S, 960, 140, 1460, 7, 5, null, 30), breach: 'up' });
        scatterRocks(S, 2150, 2450, 4, 40, 70, 170, 200, 1400);
        // 後方から敵主力が追ってくる。迂回して足を止められると追いつかれる。機雷原を越えて追えば敵主力も削れる
        makeMain(S, 800, 3200, 66, { wake: { when: s => s.t > 4, mode: 'hunt' }, heading: 0, face: 0, formA: 0 });
      },
    },
    {
      name: '落下軌道', short: '迎撃',
      sortie: 80, H: 2900, start: [800, 2480],
      phases: [
        { kind: 'intercept', text: '質量兵器を破壊せよ', sub: '防衛ライン到達前に' },
        { kind: 'exit', zone: 'home', label: '後退', text: '防衛ラインまで後退せよ', sub: '防衛ラインへ', notice: ['MASS DESTROYED', '質量兵器 破壊', '防衛ラインまで後退せよ'] },
      ],
      alarmR: 700,
      build(S) {
        zone(S, 'home', { kind: 'band', side: 'bottom', y: 2720, label: '防衛ライン', friendly: true });
        const m = makeMass(S, 760, 250, { dir: Math.PI - 0.03, speed: 19, hp: 300, r: 78, goal: 'home', target: true, name: '質量弾' });
        const esc = makeLine(S, Object.assign({ name: '護衛隊' }, ring(760, 250, 200, 6, 5)));
        esc.ring.follow = m;
        makeLine(S, { name: '前衛', pts: row(S, 800, 520, 1000, 3, 5), motion: { kind: 'follow', g: m }, linkMax: 260 });
        scatterRocks(S, 1250, 2150, 3, 45, 80, 160, 120, 520);
        scatterRocks(S, 1250, 2150, 3, 45, 80, 160, 1060, 1480);
        // 質量弾に近づくと両翼の部隊が駆けつける
        const near = { when: s => s.masses[0].alive && dist(s.player, s.masses[0]) < 560, mode: 'hunt' };
        [[110, 1000], [1490, 1050]].forEach(([x, y]) => makeGroup(S, 'E', x, y, 5, { wake: near }));
        makeNpc(S, -150, 1500, 10, [[260, 1300]], atTime(35));
        makeNpc(S, 1750, 1450, 10, [[1340, 1250]], atTime(35));
      },
    },
    {
      name: '主力艦隊', short: '主力',
      sortie: 84, H: 3000, start: [800, 2780],
      phases: [
        { kind: 'kill', text: '敵主力をかわし、レーザー砲台を破壊せよ', sub: '敵主力の撃滅は不要', limit: 210, limitText: '友軍本隊 到着まで' },
      ],
      alarmR: 520,
      build(S) {
        const aims = [Math.PI - 0.30, Math.PI + 0.30];
        makeBattery(S, 800, 400, { aims, sweep: 6, charge: 12, fire: 3.6, first: 13, hp: 140, width: 40, target: true, name: '掃射レーザー砲台' });
        makeLine(S, Object.assign({ name: '砲台直衛' }, ring(800, 400, 165, 8, 5, aims)));
        makeLine(S, { name: '前衛線', pts: row(S, 860, 350, 1250, 5, 5, null, 20), extra: { leash: 260 } });
        // 自艦隊と同規模の敵主力。二つの射線のあいだを行き来している
        makeMain(S, 800, 1650, 72, { homeFn: s => [800 + 300 * Math.sin(TAU * s.t / 38), 1650] });
        scatterRocks(S, 1050, 1300, 4, 45, 80, 170, 150, 1450);
        scatterRocks(S, 2000, 2300, 3, 45, 75, 170, 150, 1450);
        // 友軍が左翼から敵主力に仕掛ける
        for (let i = 0; i < 3; i++) makeNpc(S, -150, 1880 + i * 90, 12, [[300, 1820 + i * 20], [560, 1680]], atTime(25));
      },
    },
    {
      name: '危険宙域', short: '総合', final: true,
      sortie: 90, H: 3600, start: [800, 3330],
      phases: [
        { kind: 'intercept', text: '質量兵器を最終防衛ライン到達前に破壊せよ', sub: '敵主力の撃滅は不要' },
      ],
      alarmR: 0,
      build(S) {
        zone(S, 'home', { kind: 'band', side: 'bottom', y: 3480, label: '最終防衛ライン', friendly: true });
        const m = makeMass(S, 830, 260, { dir: Math.PI + 0.04, speed: 19.5, hp: 460, r: 88, goal: 'home', target: true, name: '大質量弾' });
        const esc = makeLine(S, Object.assign({ name: '護衛隊' }, ring(830, 260, 200, 8, 5)));
        esc.ring.follow = m;
        // 敵主力は質量弾の右前方を進む
        makeMain(S, 1130, 640, 76, {
          homeFn: s => m.alive ? [Math.min(1380, m.x + 300), m.y + 380] : [1100, 1500],
        });
        // 右舷の砲台が宙域を横に掃射する（破壊は任務外）
        const aims = [-Math.PI / 2 - 0.08, -Math.PI / 2 - 0.28];
        makeBattery(S, 1530, 1300, { aims, sweep: 6, charge: 12, fire: 3.6, first: 16, hp: 120, width: 40, name: '側面レーザー砲台' });
        makeLine(S, { name: '砲台守備隊', pts: [[1470, 1150, 5], [1450, 1460, 5]].map(([x, y, n]) => ({ x, y, n })), linkMax: 0 });
        makeMines(S, [[120, 1700], [420, 1620], [660, 1690], [690, 1920], [620, 2200], [380, 2300], [130, 2240]], { rate: 0.013 });
        makeMines(S, [[1080, 2500], [1480, 2460], [1500, 2620], [1100, 2680]], { rate: 0.016 });
        makeLine(S, { name: '前哨線', pts: row(S, 2860, 260, 1340, 5, 5, null, 30), linkMax: 0 });
        scatterRocks(S, 2000, 2400, 4, 45, 80, 170, 780, 1450);
        scatterRocks(S, 850, 1150, 3, 40, 70, 170, 150, 600);
        // 友軍：右翼から敵主力へ、のちに左翼から質量弾へ
        for (let i = 0; i < 3; i++) makeNpc(S, 1750, 2250 + i * 90, 10, [[1350, 2100], [1150, 1500]], atTime(32));
        for (let i = 0; i < 2; i++) makeNpc(S, -150, 950 + i * 100, 10, [[300, 1050]], atTime(70));
      },
    },
  ];

  function createState(stageIdx, seed) {
    const def = STAGES[stageIdx];
    const S = {
      def, stageIdx, t: 0, rng: mulberry32(seed || 1), groups: [], lines: [], rocks: [], fx: [], zones: {}, nextId: 1,
      mines: [], batteries: [], masses: [], mains: [], obs: [], mineT: 0,
      W: C.W, H: def.H, sortie: def.sortie, required: Math.ceil(def.sortie * C.MIN_RATIO),
      breachCount: 0, surroundT: 0, sectors: new Array(C.SECTORS).fill(false), result: null, contact: 0,
      phaseIdx: 0, phaseT: 0, reachedAt: null, target: null, lured: 0, lureMax: 0,
      conv: { start: 0, out: 0, en: 0 }, flee: { start: 0, out: 0, en: 0 },
      npc: 0, npc0: 0, lostMine: 0, lostLaser: 0, killedLaser: 0, killedMine: 0, inMines: false,
    };
    S.player = makeGroup(S, 'P', def.start[0], def.start[1], def.sortie);
    S.player.speed = 0;
    S.player.heading = S.player.face = def.heading || 0;
    snapShips(S.player);
    def.build(S);
    for (const g of S.groups) if (g.homeFn) { const [hx, hy] = g.homeFn(S); g.home.x = hx; g.home.y = hy; }
    for (const L of S.lines) updateLine(S, L);
    for (const g of S.groups) if (g.fac === 'E' && !inert(g)) { g.x = g.home.x; g.y = g.home.y; snapShips(g); }
    S.phase = def.phases[0];
    buildObstacles(S);
    for (const b of S.batteries) aimBattery(S, b);
    for (const m of S.masses) massEta(S, m);
    tally(S);
    S.npc0 = S.groups.reduce((a, g) => a + (g.fac === 'N' && !g.role ? g.ships.length : 0), 0);
    S.conv.start = S.conv.en; S.flee.start = S.flee.en;
    return S;
  }

  // ---------------------------------------------------------------- 更新
  function updateLine(S, L) {
    const t = S.t;
    if (L.ring) {
      const rg = L.ring;
      if (rg.follow && rg.follow.alive) { rg.cx = rg.follow.x; rg.cy = rg.follow.y; }
      L.R = Math.max(rg.Rmin, rg.R0 - rg.rate * Math.max(0, t - rg.start));
      for (const g of L.squads) { g.home.x = rg.cx + L.R * Math.cos(g.base.a); g.home.y = rg.cy + L.R * Math.sin(g.base.a); }
    } else {
      let ox = 0, oy = 0;
      const m = L.motion;
      if (m && m.kind === 'sway') ox = m.A * Math.sin(TAU * t / m.T + m.ph);
      if (m && m.kind === 'advance') oy = m.A * (0.5 - 0.5 * Math.cos(TAU * t / m.T + m.ph));
      if (m && m.kind === 'shift') {
        if (L.t0 == null && m.when(S)) L.t0 = t;
        const k = L.t0 == null ? 0 : Math.min(1, (t - L.t0) / m.T), e = k * k * (3 - 2 * k);
        ox = m.dx * e; oy = m.dy * e;
      }
      if (m && m.kind === 'follow') { // 質量兵器などに付き従う
        if (m.g.alive) { m.ox = m.g.x - m.x0; m.oy = m.g.y - m.y0; }
        ox = m.ox || 0; oy = m.oy || 0;
      }
      L.y = L.baseY + oy;
      L.maxY = L.baseMaxY + oy;
      L.ox = ox;
      for (const g of L.squads) {
        let sx = 0;
        if (g.slide) {
          const sl = g.slide;
          if (sl.t0 == null && sl.when(S)) sl.t0 = t;
          const k = sl.t0 == null ? 0 : Math.min(1, (t - sl.t0) / sl.T);
          sx = sl.dx * k * k * (3 - 2 * k);
        }
        g.home.x = g.base.x + ox + sx; g.home.y = g.base.y + oy;
      }
    }
    if (!L.breach || L.breached || S.result) return;
    const p = S.player;
    let br;
    if (L.ring) br = Math.hypot(p.x - L.ring.cx, p.y - L.ring.cy) > L.ring.R0 + 60;
    else if (L.breach === 'up') br = p.y < L.y - 90;
    else {
      if (p.y < L.y - 90) L.passed = true;
      br = L.passed && p.y > L.maxY + 90;
    }
    if (br) {
      L.breached = true;
      S.breachCount++;
      S.fx.push({ t: 'breach', name: L.name, alive: p.ships.length });
      if (L.pursue) for (const g of L.squads) {
        if (!g.alive || dist(g, p) > C.PURSUE_R || g.mode === 'hunt' || g.mode === 'pursue') continue;
        g.mode = 'pursueWait'; g.delay = C.PURSUE_DELAY + S.rng() * 2.5;
      }
    }
  }

  function nearestHostile(S, g, range) {
    let best = null, bd = range;
    for (const h of S.groups) {
      if (!h.alive || !h.active || !hostile(g, h)) continue;
      if (S.result && h === S.player) continue;
      let d = dist(g, h) - g.r - h.r;
      if (g.fac === 'E') {
        if (h === S.player) d -= C.THREAT_P;
        if (h.hot > 0 && range < 1e8) d -= h.fac === 'P' ? C.HOT_P : C.HOT_N;
      } else if (inert(h)) d += 60; // 友軍は構造物より艦隊を先に狙う
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function standoff(g, t) {
    const dx = g.x - t.x, dy = g.y - t.y, d = Math.hypot(dx, dy) || 1;
    const want = g.r + t.r + (g.bait && g.mode === 'pursue' ? C.SHADOW : C.STANDOFF);
    return [t.x + dx / d * want, t.y + dy / d * want];
  }

  function alarm(S, x, y, R) {
    for (const g of S.groups) {
      if (g.fac !== 'E' || !g.alive || inert(g) || g.role === 'target' || g.mode === 'hunt' || g.mode === 'pursue') continue;
      if (Math.hypot(g.x - x, g.y - y) > R) continue;
      g.mode = 'pursueWait'; g.delay = 1 + S.rng() * 2.5;
    }
  }

  function aiEnemy(S, g, dt) {
    if (g.mode === 'pursueWait') { g.delay -= dt; if (g.delay <= 0) g.mode = 'pursue'; }
    g.retarget -= dt;
    if (g.retarget <= 0) {
      g.retarget = 0.4 + S.rng() * 0.3;
      if (g.wake && g.mode !== g.wake.mode && g.wake.when(S)) { g.mode = g.wake.mode; g.wake = null; }
      const leash = g.leash || C.LEASH;
      const near = nearestHostile(S, g, g.aggro || C.AGGRO);
      if (g.mode === 'hold' || g.mode === 'engage') {
        if (dist(g, g.home) > leash) { g.mode = 'return'; g.target = null; }
        else if (near) {
          g.mode = 'engage'; g.target = near;
          if (g.bait && near === S.player) g.mode = 'pursue';
        }
        else { g.mode = 'hold'; g.target = null; }
      } else if (g.mode === 'return') {
        if (dist(g, g.home) < leash * 0.4) g.mode = 'hold';
      } else if (g.mode === 'pursue') {
        g.target = near || (S.result ? null : S.player);
        if (!near && dist(g, S.player) - S.player.r > C.LOSE) { g.mode = 'return'; g.target = null; }
      } else if (g.mode === 'pursueWait') {
        g.target = near;
      } else if (g.mode === 'hunt') {
        g.target = nearestHostile(S, g, 1e9);
      }
    }
    let tx, ty;
    if (g.target && g.target.alive && !(S.result && g.target === S.player)) [tx, ty] = standoff(g, g.target);
    else if (g.mode === 'pursueWait' || g.mode === 'pursue' || g.mode === 'hunt') { tx = g.x; ty = g.y; }
    else { tx = g.home.x; ty = g.home.y; }
    // 持ち場にいる敵は味方砲台の発射を知っていて射線から退く。戦闘中・追撃中は目の前の相手しか見ていない
    if (g.mode === 'hold' || g.mode === 'return') {
      const esc = laserEscape(S, g);
      if (esc) { tx = esc[0]; ty = esc[1]; }
    }
    steer(S, g, tx, ty, C.V, dt);
  }
  function laserEscape(S, g) {
    for (const b of S.batteries) {
      if (!b.alive) continue;
      const L = b.laser;
      if (L.state === 'charge' && L.charge - L.t > 5) continue;
      const [a0, a1] = L.span, mid = (a0 + a1) / 2;
      const [dx, dy] = dirOf(mid);
      const cx = g.x - b.x, cy = g.y - b.y, along = cx * dx + cy * dy;
      if (along < 0 || along > L.len + g.r) continue;
      const cross = cx * dy - cy * dx;
      const spread = along * Math.abs(a1 - a0) / 2;
      if (Math.abs(cross) > L.width / 2 + spread + g.r + 25) continue;
      const side = cross >= 0 ? 1 : -1;
      return [g.x + dy * side * 160, g.y - dx * side * 160];
    }
    return null;
  }

  function aiNpc(S, g, dt) {
    if (!g.active) {
      if (g.trigger(S)) g.active = true; else return;
    }
    g.retarget -= dt;
    if (g.retarget <= 0) {
      g.retarget = 0.5;
      g.target = nearestHostile(S, g, C.AGGRO + 20);
      if (!g.target && g.wpi >= g.wps.length) g.target = nearestHostile(S, g, 1e9);
    }
    let tx = g.x, ty = g.y;
    if (g.target && g.target.alive) [tx, ty] = standoff(g, g.target);
    else if (g.wpi < g.wps.length) {
      [tx, ty] = g.wps[g.wpi];
      if (Math.hypot(tx - g.x, ty - g.y) < 40) g.wpi++;
    }
    steer(S, g, tx, ty, C.V * C.V_NPC, dt);
  }

  function aiRunner(S, g, dt) {
    if (g.trigger && !g.go) {
      if (g.trigger(S)) g.go = true;
      else { steer(S, g, g.x, g.y, g.speed, dt); return; }
    }
    const [tx, ty] = g.wps[Math.min(g.wpi, g.wps.length - 1)];
    if (g.wpi < g.wps.length - 1 && Math.hypot(tx - g.x, ty - g.y) < 50) g.wpi++;
    steer(S, g, tx, ty, g.speed, dt);
    if (inZone(S, g.dest, g)) {
      g.arrived = true; g.alive = false; g.out = g.ships.length;
      S.fx.push({ t: 'arrive', x: g.x, y: g.y, role: g.role, n: g.out });
    }
  }

  // 障害物：岩と、生きている質量兵器・砲台
  function buildObstacles(S) {
    const o = S.obs;
    o.length = 0;
    for (const r of S.rocks) o.push(r);
    for (const g of S.masses) if (g.alive) o.push(g);
    for (const g of S.batteries) if (g.alive) o.push(g);
  }

  function steer(S, g, tx, ty, vmax, dt) {
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
    const sp = Math.min(vmax, d * 1.2);
    let vx = d > 0.01 ? dx / d * sp : 0, vy = d > 0.01 ? dy / d * sp : 0;
    for (const o of S.groups) {
      if (o === g || !o.alive || !o.active || inert(o)) continue;
      const same = !hostile(g, o);
      const ox = g.x - o.x, oy = g.y - o.y;
      const min = g.r + o.r + (same ? 24 : 10);
      if (Math.abs(ox) > min || Math.abs(oy) > min) continue;
      const od = Math.hypot(ox, oy) || 0.01;
      if (od < min) {
        const push = (min - od) / min * vmax * 1.6;
        vx += ox / od * push; vy += oy / od * push;
        if (same && g.wps && g.wps.length && g.role && d > 0.01) {
          const side = (dx * oy - dy * ox) > 0 ? 1 : -1;
          vx += -dy / d * side * push * 0.8; vy += dx / d * side * push * 0.8;
        }
      }
    }
    for (const a of S.obs) {
      const ox = g.x - a.x, oy = g.y - a.y, od = Math.hypot(ox, oy) || 0.01;
      const clear = a.r + g.r + 30;
      if (od >= clear) continue;
      const nx = ox / od, ny = oy / od;
      const into = -(nx * vx + ny * vy);
      if (into > 0) {
        let tnx = -ny, tny = nx;
        if (tnx * vx + tny * vy < 0) { tnx = -tnx; tny = -tny; }
        vx += nx * into + tnx * into * 0.9;
        vy += ny * into + tny * into * 0.9;
      }
      const k = (clear - od) / clear;
      vx += nx * k * vmax * 0.8; vy += ny * k * vmax * 0.8;
    }
    const vl = Math.hypot(vx, vy);
    if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; }
    const ax = vx - g.vx, ay = vy - g.vy, al = Math.hypot(ax, ay), amax = 110 * dt;
    if (al > amax) { g.vx += ax / al * amax; g.vy += ay / al * amax; } else { g.vx = vx; g.vy = vy; }
    g.x += g.vx * dt; g.y += g.vy * dt;
  }

  function updatePlayer(S, dt, input) {
    const p = S.player;
    if (!S.result) {
      if (input.left) p.heading -= C.TURN * dt;
      if (input.right) p.heading += C.TURN * dt;
    }
    let want = 0;
    if (S.result) want = S.result.type === 'clear' ? C.V : 0;
    else if (input.up) want = C.V;
    else if (input.down) want = -C.V_BACK;
    const diff = want - p.speed, acc = C.ACC * dt;
    p.speed += Math.max(-acc, Math.min(acc, diff));
    // 交戦中は足が止まる（敵主力は大きいので強く捕まる）
    let contact = 0;
    if (!S.result) for (const g of S.groups) {
      if (g.fac !== 'E' || !g.alive || inert(g)) continue;
      if (dist(p, g) < p.r + g.r + C.STANDOFF + 15) contact += g.stat === 'M' ? 3 : 1;
    }
    S.contact = contact;
    const mul = Math.max(0.2, 1 - 0.2 * contact);
    const s = p.speed * mul;
    p.vx = Math.sin(p.heading) * s;
    p.vy = -Math.cos(p.heading) * s;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const m = 40 + p.r * 0.5;
    if (!S.result || S.result.type !== 'clear') {
      p.x = Math.max(m, Math.min(C.W - m, p.x));
      p.y = Math.max(40, Math.min(S.H - 40, p.y));
    }
  }

  function collideRocks(S, g) {
    for (const a of S.obs) {
      if (a === g) continue;
      const ox = g.x - a.x, oy = g.y - a.y, od = Math.hypot(ox, oy) || 0.01;
      const min = a.r * 0.95 + g.r * 0.75;
      if (od < min) { g.x = a.x + ox / od * min; g.y = a.y + oy / od * min; }
      if (od < a.r + g.r + 10) for (const s of g.ships) {
        const sx = s.x - a.x, sy = s.y - a.y, sd = Math.hypot(sx, sy) || 0.01;
        if (sd < a.r * 0.95 + 4) { s.x = a.x + sx / sd * (a.r * 0.95 + 4); s.y = a.y + sy / sd * (a.r * 0.95 + 4); }
      }
    }
  }

  function updateShips(S, g, dt) {
    const n = g.ships.length;
    const slots = hexSlots(n, slotSp(g));
    const k = Math.min(1, dt * 2.2);
    let face;
    if (g.fac === 'P') face = g.heading;
    else if (g.role !== 'convoy' && g.role !== 'flee' && g.target && g.target.alive && dist(g, g.target) < g.r + g.target.r + 200) face = Math.atan2(g.target.x - g.x, -(g.target.y - g.y));
    else if (Math.hypot(g.vx, g.vy) > 8) face = Math.atan2(g.vx, -g.vy);
    else face = g.face;
    g.face = face;
    // 陣形の向き：自艦隊は舵のとおり、敵主力はゆっくり向きを変える
    if (g.stat === 'M') g.formA = lerpAngle(g.formA, face, Math.min(1, dt * 0.8));
    const rot = g.fac === 'P' ? g.heading : g.stat === 'M' ? g.formA : 0;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const sh = g.ships[i], sl = slots[i];
      const tx = g.x + sl.x * c - sl.y * s + Math.sin(S.t * 0.9 + sh.ph) * 1.3;
      const ty = g.y + sl.x * s + sl.y * c + Math.cos(S.t * 0.7 + sh.ph) * 1.3;
      sh.x += g.vx * dt; sh.y += g.vy * dt;
      sh.x += (tx - sh.x) * k; sh.y += (ty - sh.y) * k;
      sh.a = lerpAngle(sh.a, face, Math.min(1, dt * 4));
      if (sh.flash > 0) sh.flash -= dt;
    }
  }

  // ---------------------------------------------------------------- 危険
  function updateMass(S, g, dt) {
    const [dx, dy] = dirOf(g.dir);
    g.vx = dx * g.mspeed; g.vy = dy * g.mspeed;
    g.x += g.vx * dt; g.y += g.vy * dt;
    const s = g.ships[0];
    s.x = g.x; s.y = g.y; s.a += g.spin * dt;
    if (s.flash > 0) s.flash -= dt;
  }
  // 質量兵器が防衛ラインへ届くまでの距離と時間
  function massEta(S, g) {
    const z = S.zones[g.goal];
    if (!z || !g.alive) return null;
    const [, dy] = dirOf(g.dir);
    const front = z.side === 'bottom' ? g.y + g.r * 0.6 : g.y - g.r * 0.6;
    const d = Math.max(0, z.side === 'bottom' ? z.y - front : front - z.y);
    const v = Math.abs(dy) * g.mspeed;
    return { d, t: v > 0 ? d / v : Infinity, total: g.eta0 || (g.eta0 = d) };
  }

  // 射線の長さ：岩や質量兵器に当たるとそこで止まる
  function beamLength(S, g, a, range) {
    const [dx, dy] = dirOf(a);
    let len = range;
    for (const o of S.obs) {
      if (o === g) continue;
      const cx = o.x - g.x, cy = o.y - g.y;
      const t = cx * dx + cy * dy;
      if (t <= 0 || t - o.r > len) continue;
      const rr = o.r * 0.85, p2 = cx * cx + cy * cy - t * t;
      if (p2 >= rr * rr) continue;
      len = Math.min(len, t - Math.sqrt(rr * rr - p2));
    }
    return len;
  }
  function sweepSpan(L) {
    const sgn = L.shots % 2 ? -1 : 1;
    return [L.aim - sgn * L.sweep / 2, L.aim + sgn * L.sweep / 2];
  }
  function aimBattery(S, g) {
    const L = g.laser;
    const [a0, a1] = sweepSpan(L);
    L.span = [a0, a1];
    L.wlen[0] = beamLength(S, g, a0, L.range);
    L.wlen[1] = beamLength(S, g, a1, L.range);
    L.len = beamLength(S, g, L.cur, L.range);
  }
  function updateBattery(S, g, dt) {
    const L = g.laser;
    L.t += dt;
    if (L.state === 'charge') {
      L.cur = lerpAngle(L.cur, sweepSpan(L)[0], Math.min(1, dt * 1.2)); // 砲身が次の射角へ向く
      if (L.t >= L.charge) {
        L.state = 'fire'; L.t = 0; L.cur = sweepSpan(L)[0];
        S.fx.push({ t: 'laserFire', g });
      }
    }
    if (L.state === 'fire') {
      const [a0, a1] = sweepSpan(L), k = Math.min(1, L.t / L.fire);
      L.cur = a0 + (a1 - a0) * k;
      L.len = beamLength(S, g, L.cur, L.range);
      burn(S, g, L, dt);
      if (L.t >= L.fire) {
        L.state = 'charge'; L.t = 0; L.shots++;
        L.ai = (L.ai + 1) % L.aims.length; L.aim = L.aims[L.ai];
        S.fx.push({ t: 'laserEnd', g });
      }
    }
    aimBattery(S, g);
    g.ships[0].a = L.cur;
    if (g.ships[0].flash > 0) g.ships[0].flash -= dt;
  }
  // 射線上の艦を焼く。敵味方を問わない
  function burn(S, bat, L, dt) {
    const [dx, dy] = dirOf(L.cur), half = L.width / 2, len = L.len;
    for (const g of S.groups) {
      if (!g.alive || !g.active || inert(g)) continue;
      if (S.result && g === S.player) continue;
      const cx = g.x - bat.x, cy = g.y - bat.y;
      const along = cx * dx + cy * dy;
      if (along < -g.r || along > len + g.r) continue;
      if (Math.abs(cx * dy - cy * dx) > half + g.r + 8) continue;
      for (const s of g.ships) {
        if (!s.alive) continue;
        const sx = s.x - bat.x, sy = s.y - bat.y, al = sx * dx + sy * dy;
        if (al < bat.r || al > len) continue;
        if (Math.abs(sx * dy - sy * dx) > half) continue;
        s.hp -= L.dps * dt; s.flash = 0.12;
        if (s.hp <= 0) {
          s.alive = false; g.dirty = true;
          if (g === S.player) S.lostLaser++; else if (g.fac === 'E') S.killedLaser++;
          S.fx.push({ t: 'boom', x: s.x, y: s.y, f: g.fac, big: g.fac === 'S', laser: true });
        }
      }
    }
  }

  function updateMines(S, dt) {
    S.inMines = S.mines.some(m => inPoly(m.pts, S.player.x, S.player.y));
    S.mineT += dt;
    if (S.mineT < C.MINE_TICK) return;
    S.mineT -= C.MINE_TICK;
    for (const m of S.mines) {
      const p = m.rate * C.MINE_TICK;
      for (const g of S.groups) {
        if (!g.alive || !g.active || inert(g)) continue;
        if (S.result && g === S.player) continue;
        if (g.x + g.r < m.x0 || g.x - g.r > m.x1 || g.y + g.r < m.y0 || g.y - g.r > m.y1) continue;
        for (const s of g.ships) {
          if (!s.alive || !inPoly(m.pts, s.x, s.y) || S.rng() >= p) continue;
          s.alive = false; g.dirty = true;
          if (g === S.player) S.lostMine++; else if (g.fac === 'E') S.killedMine++;
          S.fx.push({ t: 'mine', x: s.x, y: s.y, f: g.fac });
        }
      }
    }
  }

  function combat(S, dt) {
    const p = S.player;
    for (const g of S.groups) {
      if (!g.alive || !g.active) continue;
      if (S.result && g === p) continue;
      const st = statOf(g);
      if (!st.range) continue;
      let cands = null;
      for (const sh of g.ships) {
        if (!sh.alive) continue;
        sh.cd -= dt;
        if (sh.cd > 0) continue;
        if (!cands) {
          cands = [];
          for (const h of S.groups) {
            if (!h.alive || !h.active || !hostile(g, h)) continue;
            if (S.result && h === p) continue;
            if (dist(g, h) < g.r + h.r + st.range) cands.push(h);
          }
          // 大艦隊同士の接触
          if (g.stat === 'M') for (const h of cands) {
            if (h === p && !g.clashP) { g.clashP = true; S.fx.push({ t: 'clash', x: (g.x + h.x) / 2, y: (g.y + h.y) / 2, who: 'P' }); }
            else if (h.fac === 'N' && !g.clashN) { g.clashN = true; S.fx.push({ t: 'clash', x: (g.x + h.x) / 2, y: (g.y + h.y) / 2, who: 'N' }); }
          }
        }
        if (!cands.length) { sh.cd = 0.25; continue; }
        let best = null, bd = st.range * st.range;
        for (const h of cands) for (const t of h.ships) {
          if (!t.alive) continue;
          const dx = t.x - sh.x, dy = t.y - sh.y;
          let d2 = dx * dx + dy * dy;
          if (t.rad) { const e = Math.max(0, Math.sqrt(d2) - t.rad); d2 = e * e; }
          if (d2 < bd) { bd = d2; best = t; }
        }
        if (!best) { sh.cd = 0.15 + S.rng() * 0.1; continue; }
        sh.cd = st.cd * (0.8 + 0.4 * S.rng());
        best.hp -= st.dmg;
        best.flash = 0.12;
        if (g.fac === 'E') best.g.hot = 1.5;
        let x2 = best.x, y2 = best.y;
        if (best.rad) { // 大型目標は表面に当たる
          const dx = sh.x - best.x, dy = sh.y - best.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, best.rad * (0.85 + 0.15 * S.rng()) / d);
          x2 = best.x + dx * k; y2 = best.y + dy * k;
        }
        S.fx.push({ t: 'beam', x1: sh.x, y1: sh.y, x2, y2, f: g.stat === 'M' ? 'M' : g.fac, big: !!best.rad });
        if (best.hp <= 0 && best.alive) {
          best.alive = false;
          best.g.dirty = true;
          if (!inert(best.g)) S.fx.push({ t: 'boom', x: best.x, y: best.y, f: best.g.fac, big: best.g.fac === 'S' || best.g.role === 'target' });
        }
      }
    }
    for (const g of S.groups) if (g.dirty) {
      g.dirty = false;
      g.ships = g.ships.filter(s => s.alive);
      updateRadius(g);
      if (!g.ships.length) {
        g.alive = false;
        if (g.role === 'mass') S.fx.push({ t: 'massDown', x: g.x, y: g.y, r: g.fixedR, g });
        if (g.role === 'battery') S.fx.push({ t: 'batteryDown', x: g.x, y: g.y, g });
        if (g === S.target) {
          S.fx.push({ t: 'targetDown', x: g.x, y: g.y, role: g.role });
          alarm(S, g.x, g.y, S.def.alarmR != null ? S.def.alarmR : 900);
        } else if (g.role === 'convoy') S.fx.push({ t: 'convoyLost', x: g.x, y: g.y });
        if (inert(g)) buildObstacles(S);
      }
    }
  }

  function tally(S) {
    const cv = S.conv, fl = S.flee;
    cv.out = cv.en = fl.out = fl.en = 0;
    let npc = 0;
    for (const g of S.groups) {
      if (g.fac === 'N' && !g.role && g.alive) npc += g.ships.length;
      const T = g.role === 'convoy' ? cv : g.role === 'flee' ? fl : null;
      if (!T) continue;
      if (g.arrived) T.out += g.out; else if (g.alive) T.en += g.ships.length;
    }
    S.npc = npc;
    let lured = 0;
    const p = S.player;
    for (const g of S.groups) if (g.bait && g.alive && g.mode === 'pursue' && dist(g, p) < C.LURE_R) lured += g.ships.length;
    S.lured = lured;
    S.lureMax = Math.max(S.lureMax, lured);
  }

  function end(S, type, reason) {
    S.result = {
      type, reason, alive: S.player.ships.length, sortie: S.sortie, t: S.t,
      conv: Object.assign({}, S.conv), flee: Object.assign({}, S.flee),
      targetDown: S.target ? !S.target.alive : null, lureMax: S.lureMax, phaseIdx: S.phaseIdx,
      lostMine: S.lostMine, lostLaser: S.lostLaser, killedLaser: S.killedLaser, killedMine: S.killedMine,
      mains: S.mains.map(g => ({ n0: g.n0, n: g.alive ? g.ships.length : 0 })),
    };
    S.fx.push({ t: 'end', type, reason });
  }

  function phaseDone(S) {
    const ph = S.phase, p = S.player;
    switch (ph.kind) {
      case 'escort': case 'retreat': {
        const T = ph.kind === 'escort' ? S.conv : S.flee;
        if (T.out + T.en < ph.need) { end(S, 'fail', ph.kind); return false; }
        if (T.out < ph.need) return false;
        if (S.reachedAt == null) S.reachedAt = S.t;
        return T.en === 0 || S.t - S.reachedAt > 12;
      }
      case 'breach': return S.lines.some(L => L.name === ph.line && L.breached);
      case 'kill': case 'intercept': return !S.target.alive;
      case 'lure': return inZone(S, ph.zone, p) && S.lured >= ph.need;
      case 'exit': return inZone(S, ph.zone, p);
    }
    return false;
  }
  // 今の任務の残り時間（制限なしなら null）
  function timeLeft(S) {
    const ph = S.phase;
    return ph && ph.limit ? Math.max(0, ph.limit - (S.t - S.phaseT)) : null;
  }

  function checkEnd(S, dt) {
    const p = S.player, n = p.ships.length;
    const cov = S.sectors;
    cov.fill(false);
    const R = p.r + C.SURROUND_R;
    for (const g of S.groups) {
      if (g.fac !== 'E' || !g.alive || inert(g) || dist(p, g) > R + g.r) continue;
      for (const s of g.ships) {
        const dx = s.x - p.x, dy = s.y - p.y;
        if (dx * dx + dy * dy > R * R) continue;
        const k = Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * C.SECTORS) % C.SECTORS;
        cov[k] = true;
      }
    }
    const count = cov.reduce((a, b) => a + (b ? 1 : 0), 0);
    S.coverage = count;
    if (count >= C.SURROUND_NEED) S.surroundT += dt;
    else S.surroundT = Math.max(0, S.surroundT - dt * 1.5);

    if (n < S.required) return end(S, 'fail', n <= S.sortie * 0.08 ? 'annihilated' : 'insufficient');
    if (S.surroundT >= C.SURROUND_T) return end(S, 'fail', 'surrounded');
    for (const m of S.masses) { const e = massEta(S, m); if (e && e.d <= 0) return end(S, 'fail', 'mass'); }
    const tl = timeLeft(S);
    if (tl !== null && tl <= 0) return end(S, 'fail', 'timeout');
    let guard = 0;
    while (!S.result && phaseDone(S) && guard++ < 8) {
      const phases = S.def.phases;
      if (S.phaseIdx + 1 >= phases.length) { end(S, 'clear', 'goal'); break; }
      if (S.phase.kind === 'lure') for (const g of S.groups) g.bait = false;
      S.phaseIdx++;
      S.phase = phases[S.phaseIdx];
      S.phaseT = S.t;
      S.reachedAt = null;
      S.fx.push({ t: 'phase', notice: S.phase.notice || ['MISSION UPDATE', S.phase.text, ''] });
    }
  }

  function update(S, dt, input) {
    S.t += dt;
    for (const L of S.lines) updateLine(S, L);
    updatePlayer(S, dt, input || {});
    for (const g of S.masses) if (g.alive) updateMass(S, g, dt);
    buildObstacles(S);
    for (const g of S.groups) {
      if (!g.alive || g.fac === 'P' || inert(g)) continue;
      if (g.homeFn) { const [hx, hy] = g.homeFn(S); g.home.x = hx; g.home.y = hy; }
      if (g.fac === 'E') aiEnemy(S, g, dt);
      else if (g.role) aiRunner(S, g, dt);
      else aiNpc(S, g, dt);
    }
    for (const r of S.rocks) r.rot += r.spin * dt;
    for (const g of S.groups) if (g.hot > 0) g.hot -= dt;
    for (const g of S.groups) if (g.alive && g.active && !inert(g)) { collideRocks(S, g); updateShips(S, g, dt); }
    for (const g of S.batteries) if (g.alive) updateBattery(S, g, dt);
    updateMines(S, dt);
    combat(S, dt);
    tally(S);
    if (!S.result) checkEnd(S, dt);
  }

  const Core = { C, STAGES, createState, update, hexSlots, inZone, inPoly, massEta, timeLeft, dirOf, inert };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
