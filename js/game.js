// 昼休みの宇宙戦争・危険宙域編 — 描画・入力・画面遷移
// 操作・画面構成は前作のまま。危険（レーザー・質量兵器・機雷原）の描画と、重要な瞬間だけの演出を足している。
(function () {
  'use strict';
  const { C, STAGES, createState, update, inZone, massEta, timeLeft, dirOf, inert } = Core;
  const TAU = Math.PI * 2;

  const COL = {
    P: '#8fdcff', Pglow: '143,220,255',
    N: '#86f5a4', Nglow: '134,245,164',
    E: '#ff5f4c', Eglow: '255,95,76',
    S: '#d4b8ff', Sglow: '212,184,255',
    goal: '255,208,120',
    tgt: '255,120,215',
    laser: '255,112,64',    // 巨大レーザー（射線・警告線）
    mine: '255,150,40',     // 機雷原
    home: '150,200,255',    // 味方の防衛ライン
  };
  const FONT = '"Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","Meiryo",sans-serif';
  const MONO = '"Consolas","Menlo",monospace';
  const KIND_LABEL = { escort: '護衛', breach: '突破', kill: '撃破', intercept: '迎撃', retreat: '撤退支援', lure: '誘導', exit: '到達' };
  const phaseLabel = q => q.label || KIND_LABEL[q.kind];
  const HINTS = [
    '橙の警告線が射線。撃った直後が近づく好機',
    '機雷原は通れる。ただし少しずつ沈む',
    '質量弾は反撃しない。張り付いて削り切れ',
    '敵主力を射線へ、あるいは友軍へ向けさせろ',
    'すべてを相手にする必要はない',
  ];

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- 入力（前作と同じ）
  const keys = {};
  const input = { left: false, right: false, up: false, down: false };
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  };
  function codeOf(e) {
    if (e.code) return e.code;
    const k = e.key || '';
    if (k === ' ') return 'Space';
    if (/^[a-zA-Z]$/.test(k)) return 'Key' + k.toUpperCase();
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    return k;
  }
  window.addEventListener('keydown', e => {
    Sfx.init();
    const code = codeOf(e);
    if (KEYMAP[code] || code === 'Space') e.preventDefault();
    if (e.repeat) { if (KEYMAP[code]) keys[code] = true; return; }
    keys[code] = true;
    onKey(code);
  });
  window.addEventListener('keyup', e => { keys[codeOf(e)] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'play') mode = 'pause'; });
  function readInput() {
    input.left = input.right = input.up = input.down = false;
    for (const k in KEYMAP) if (keys[k]) input[KEYMAP[k]] = true;
  }

  // ---------------------------------------------------------------- 状態
  let mode = 'title';     // title | play | pause | result
  let S = null;
  let sel = 0;
  let cleared = loadCleared();
  let notice = null;
  let toast = null;
  let resultShownAt = 0;
  let clock = 0, vdt = 0;
  const beams = [], booms = [], sparks = [], rings = [], motes = [], chunks = [], bursts = [];
  const trails = new Map();
  let trailT = 0;
  let cam = { x: C.W / 2, y: 0, scale: 1, sx: 0, sy: 0 };
  // 重要な瞬間だけの演出（閃光・揺れ・シネマスコープの帯・赤い縁）
  const cine = { flash: 0, flashRgb: '255,236,215', shake: 0, box: 0, boxWant: 0, red: 0 };
  let stars = makeStars();
  let dust = makeDust();
  let scenery = null;
  let nebulae = [];
  let lastTick = {};

  function loadCleared() {
    try { return JSON.parse(localStorage.getItem('houi-toppa-3-cleared') || '[]'); } catch (e) { return []; }
  }
  function saveCleared() {
    try { localStorage.setItem('houi-toppa-3-cleared', JSON.stringify(cleared)); } catch (e) { /* 保存できなくても遊べる */ }
  }

  function startStage(i) {
    sel = i;
    S = createState(i, (Math.random() * 1e9) | 0);
    mode = 'play';
    notice = null; toast = null;
    for (const a of [beams, booms, sparks, rings, motes, chunks, bursts]) a.length = 0;
    trails.clear();
    Object.assign(cine, { flash: 0, shake: 0, box: 0, boxWant: 0, red: 0 });
    lastTick = {};
    const r = S.rng;
    nebulae = [];
    for (let k = 0; k < 5; k++) nebulae.push({ x: r() * C.W, y: r() * S.H, rad: 350 + r() * 550, hue: r() < 0.5 ? '60,80,150' : '110,55,120', a: 0.03 + r() * 0.035 });
    scenery = {
      planetSide: i % 2 ? -1 : 1, planetHue: ['70,110,190', '150,90,70', '90,130,170', '120,80,150', '160,100,70'][i],
      moon: { x: 0.15 + r() * 0.2, y: 0.1 + r() * 0.2, r: 14 + r() * 10 },
    };
    const view = viewSize();
    cam.y = clampCamY(S.player.y - view.h * camLead(), view.h);
    cam.x = C.W / 2;
  }

  function onKey(code) {
    if (code === 'KeyM') { Sfx.setMuted(!Sfx.isMuted()); return; }
    if (mode === 'title') {
      if (code === 'ArrowUp' || code === 'KeyW') { sel = (sel + STAGES.length - 1) % STAGES.length; Sfx.select(); }
      else if (code === 'ArrowDown' || code === 'KeyS') { sel = (sel + 1) % STAGES.length; Sfx.select(); }
      else if (/^Digit[1-9]$/.test(code)) { const n = +code.slice(5) - 1; if (n < STAGES.length) { sel = n; Sfx.select(); } }
      else if (code === 'Enter' || code === 'Space') startStage(sel);
    } else if (mode === 'play') {
      if (code === 'KeyP' || code === 'Escape') mode = 'pause';
    } else if (mode === 'pause') {
      if (code === 'KeyP' || code === 'Enter' || code === 'Space') mode = 'play';
      else if (code === 'Escape') mode = 'title';
      else if (code === 'KeyR') startStage(sel);
    } else if (mode === 'result') {
      if (clock - resultShownAt < 0.8) return;
      const clear = S.result.type === 'clear';
      if (code === 'Enter' || code === 'Space') {
        if (clear && sel + 1 < STAGES.length) startStage(sel + 1);
        else if (clear) mode = 'title';
        else startStage(sel);
      } else if (code === 'KeyR') startStage(sel);
      else if (code === 'Escape') mode = 'title';
    }
  }

  // ---------------------------------------------------------------- ループ
  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt; vdt = dt;
    readInput();
    if ((mode === 'play' || mode === 'result') && S) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) { update(S, STEP, input); consumeFx(); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      if (S.result && mode === 'play' && S.t - S.result.t > 1.6) {
        mode = 'result'; resultShownAt = clock;
        if (S.result.type === 'clear' && !cleared.includes(sel)) { cleared.push(sel); saveCleared(); }
      }
    }
    ageFx(mode === 'pause' ? 0 : dt);
    Sfx.ambience(S && mode !== 'title' ? Math.abs(S.player.speed) / C.V : 0, clock, mode === 'play');
    if (S && mode === 'play') laserCues();
    draw();
    requestAnimationFrame(frame);
  }

  // 発射3秒前から秒読みの音（画面に射線か砲台が見えているときだけ）
  function laserCues() {
    for (const b of S.batteries) {
      if (!b.alive) continue;
      const L = b.laser;
      if (L.state !== 'charge') continue;
      const rem = L.charge - L.t, sec = Math.ceil(rem);
      if (sec <= 3 && sec >= 1 && lastTick[b.id] !== sec && laserVisible(b)) { lastTick[b.id] = sec; Sfx.tick(sec === 1); }
      if (sec > 3) lastTick[b.id] = null;
    }
  }
  function laserVisible(b) {
    const v = viewSize(), L = b.laser;
    const [dx, dy] = dirOf((L.span[0] + L.span[1]) / 2);
    for (let k = 0; k <= 1; k += 0.1) {
      const x = b.x + dx * L.len * k, y = b.y + dy * L.len * k;
      if (Math.abs(x - cam.x) < v.w / 2 && Math.abs(y - cam.y) < v.h / 2) return true;
    }
    return false;
  }

  function setNotice(tag, title, sub, rgb) { notice = { tag, title, sub, t: clock, rgb }; }
  function consumeFx() {
    const view = viewSize();
    const onScreen = (x, y) => Math.abs(y - cam.y) < view.h * 0.6 && Math.abs(x - cam.x) < view.w * 0.6;
    const pan = x => Math.max(-0.8, Math.min(0.8, (x - cam.x) / (view.w * 0.5)));
    for (const f of S.fx) {
      if (f.t === 'beam') {
        const rgb = f.f === 'P' ? COL.Pglow : f.f === 'N' ? COL.Nglow : f.f === 'S' ? COL.Sglow : COL.Eglow;
        beams.push({ x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, rgb, life: 0.2 });
        if (Math.random() < (f.big ? 0.5 : 0.25)) sparks.push({ x: f.x2, y: f.y2, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, life: 0.18 + Math.random() * 0.12, rgb });
        if (onScreen(f.x2, f.y2) && Math.random() < 0.5) Sfx.beam(f.f === 'M' ? 'E' : f.f, pan(f.x1));
      } else if (f.t === 'boom') {
        addBoom(f.x, f.y, f.f, f.big);
        if (onScreen(f.x, f.y)) Sfx.boom(pan(f.x), f.f === 'P' || f.big);
      } else if (f.t === 'mine') {
        bursts.push({ x: f.x, y: f.y, life: 0.55 });
        addBoom(f.x, f.y, f.f, false);
        if (onScreen(f.x, f.y)) Sfx.mine(pan(f.x));
      } else if (f.t === 'laserFire') {
        const vis = laserVisible(f.g);
        cine.flash = Math.max(cine.flash, vis ? 0.3 : 0.1); cine.flashRgb = '255,228,200';
        if (vis) cine.shake = Math.max(cine.shake, 7);
        Sfx.laser(pan(f.g.x), f.g.laser.fire, vis);
      } else if (f.t === 'massDown') {
        cine.flash = 0.5; cine.flashRgb = '255,235,210'; cine.shake = 14;
        rings.push({ x: f.x, y: f.y, life: 1.8, T: 1.8, rgb: '255,200,150', R: 420, w: 4 });
        rings.push({ x: f.x, y: f.y, life: 1.2, T: 1.2, rgb: COL.tgt, R: 220, w: 3 });
        const g = f.g;
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * TAU, v = 20 + Math.random() * 70, r = f.r * (0.12 + Math.random() * 0.2);
          const verts = [];
          for (let k = 0; k < 6; k++) { const b = k / 6 * TAU; verts.push([Math.cos(b) * r * (0.6 + Math.random() * 0.5), Math.sin(b) * r * (0.6 + Math.random() * 0.5)]); }
          chunks.push({ x: g.x + Math.cos(a) * f.r * 0.4, y: g.y + Math.sin(a) * f.r * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 2, verts, life: 2.4 + Math.random() * 0.8 });
        }
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * TAU, v = 40 + Math.random() * 160;
          sparks.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.8, rgb: '255,190,120' });
        }
        Sfx.quake();
      } else if (f.t === 'batteryDown') {
        cine.flash = Math.max(cine.flash, 0.3); cine.flashRgb = '255,220,190'; cine.shake = Math.max(cine.shake, 9);
        rings.push({ x: f.x, y: f.y, life: 1.4, T: 1.4, rgb: COL.laser, R: 200, w: 3 });
        addBoom(f.x, f.y, 'E', true);
        Sfx.quake();
      } else if (f.t === 'clash') {
        if (f.who === 'P') {
          setNotice('CONTACT', '敵主力艦隊と接触', '正面から殴り合えば双方が大きく損耗する', COL.Eglow);
          cine.shake = Math.max(cine.shake, 5); cine.red = Math.max(cine.red, 0.5);
          Sfx.clash();
        } else toast = { text: '友軍が敵主力と交戦開始', t: clock, good: true };
      } else if (f.t === 'breach') {
        setNotice('BREAKTHROUGH', f.name + ' 突破', '残存艦 ' + f.alive);
        Sfx.chime();
      } else if (f.t === 'arrive') {
        rings.push({ x: f.x, y: f.y, life: 1.2, T: 1.2, rgb: f.role === 'convoy' ? COL.Sglow : COL.Nglow, R: 50, w: 2 });
        toast = { text: f.role === 'convoy' ? '補給船 到着' : `友軍 ${f.n}隻 離脱`, t: clock, good: true };
        Sfx.select();
      } else if (f.t === 'targetDown') {
        rings.push({ x: f.x, y: f.y, life: 1.6, T: 1.6, rgb: COL.tgt, R: 140, w: 3 });
        if (f.role === 'mass') setNotice('TARGET DESTROYED', '質量兵器 破壊', '');
        else if (f.role === 'battery') setNotice('TARGET DESTROYED', 'レーザー砲台 破壊', '');
        else setNotice('TARGET DESTROYED', '目標撃破', '');
        Sfx.chime();
      } else if (f.t === 'phase') {
        const [tag, title, sub] = f.notice;
        setNotice(tag, title, sub);
        Sfx.chime();
      } else if (f.t === 'end') {
        Sfx.endCue(f.type === 'clear');
        if (f.type === 'clear') cine.boxWant = 1;
      }
    }
    S.fx.length = 0;
  }
  function addBoom(x, y, f, big) {
    booms.push({ x, y, f, life: big ? 0.7 : 0.45, T: big ? 0.7 : 0.45, big });
    for (let i = 0; i < (big ? 10 : 4); i++) {
      const a = Math.random() * TAU, v = 15 + Math.random() * (big ? 70 : 45);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, rgb: '255,190,120' });
    }
  }
  function ageFx(dt) {
    for (const arr of [beams, booms, sparks, rings, motes, chunks, bursts]) {
      for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) arr.splice(i, 1); }
    }
    for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.96; s.vy *= 0.96; }
    for (const c of chunks) { c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt; c.vx *= 0.99; c.vy *= 0.99; }
    for (const m of motes) { m.x += (m.tx - m.x) * Math.min(1, dt * 3.2); m.y += (m.ty - m.y) * Math.min(1, dt * 3.2); }
    cine.flash = Math.max(0, cine.flash - dt * 1.6);
    cine.shake = Math.max(0, cine.shake - dt * 18);
    cine.red = Math.max(0, cine.red - dt * 0.6);
    cine.box += (cine.boxWant - cine.box) * Math.min(1, dt * 3);
    // 艦隊の航跡（中心の軌跡を少しだけ残す）
    trailT += dt;
    if (S && trailT > 0.1) {
      trailT = 0;
      for (const g of S.groups) {
        if (!g.alive || !g.active || inert(g)) { trails.delete(g.id); continue; }
        let tr = trails.get(g.id);
        if (!tr) trails.set(g.id, tr = []);
        tr.push(g.x, g.y);
        if (tr.length > 28) tr.splice(0, 2);
      }
    }
  }

  // ---------------------------------------------------------------- カメラ
  function viewSize() {
    const scale = Math.max(0.05, Math.min(cw / (C.W + 120), ch / 820));
    return { scale, w: cw / scale, h: ch / scale };
  }
  function camLead() { return S && Math.cos(S.player.heading) < -0.3 ? -0.18 : 0.18; }
  function clampCamY(y, vh) {
    const lo = vh / 2 - 60, hi = S.H - vh / 2 + 40;
    return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, y));
  }
  function updateCamera() {
    const v = viewSize();
    cam.scale = v.scale;
    const p = S.player;
    const ty = clampCamY(p.y - v.h * camLead(), v.h);
    if (!isFinite(cam.y)) cam.y = ty;
    cam.y += (ty - cam.y) * 0.05;
    if (v.w >= C.W + 120) cam.x = C.W / 2;
    else {
      const half = v.w / 2;
      const tx = Math.max(half - 60, Math.min(C.W + 60 - half, p.x));
      cam.x += (tx - cam.x) * 0.08;
    }
    const sh = cine.shake;
    cam.sx = sh ? (Math.random() - 0.5) * sh : 0;
    cam.sy = sh ? (Math.random() - 0.5) * sh : 0;
    return v;
  }
  function worldTransform() {
    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * (cw / 2 - cam.x * cam.scale + cam.sx), dpr * (ch / 2 - cam.y * cam.scale + cam.sy));
  }
  function screenTransform() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const toScreen = (x, y) => [(x - cam.x) * cam.scale + cw / 2, (y - cam.y) * cam.scale + ch / 2];

  // ---------------------------------------------------------------- 任務の見え方
  function objective() {
    const ph = S.phase;
    if (!ph || S.result) return null;
    if (ph.kind === 'kill' || ph.kind === 'intercept') return S.target && S.target.alive ? { x: S.target.x, y: S.target.y, label: 'TARGET', rgb: COL.tgt } : null;
    if (ph.kind === 'breach') {
      const L = S.lines.find(l => l.name === ph.line);
      return L ? { x: cam.x, y: L.y - 120, label: '突破', rgb: COL.goal } : null;
    }
    let zn = ph.zone;
    if (!zn) { const g = S.groups.find(g => g.role === (ph.kind === 'escort' ? 'convoy' : 'flee')); zn = g && g.dest; }
    const z = zn && S.zones[zn];
    if (!z) return null;
    const rgb = z.friendly ? COL.home : COL.goal;
    if (z.kind === 'circle') return { x: z.x, y: z.y, label: z.label, rgb, zone: zn };
    return { x: cam.x, y: z.y + (z.side === 'top' ? -60 : 60), label: z.label, rgb, zone: zn };
  }
  const mmss = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function progressText() {
    const ph = S.phase;
    const tl = timeLeft(S);
    const lim = tl !== null ? `${ph.limitText || '残り時間'} ${mmss(tl)}` : '';
    switch (ph.kind) {
      case 'kill': case 'intercept': {
        const g = S.target;
        if (!g.alive) return ['TARGET 撃破', lim];
        const hp = g.ships[0] ? Math.ceil(g.ships[0].hp / g.hp0 * 100) : 0;
        return [`TARGET 耐久 ${hp}%`, lim];
      }
      case 'exit': return [S.inMines ? '機雷原を通過中' : `${S.zones[ph.zone].label}へ到達せよ`, lim];
      case 'breach': return [`${ph.line}を越えよ`, lim];
    }
    return ['', lim];
  }

  // ---------------------------------------------------------------- 背景（低コントラスト）
  function makeStars() {
    const layers = [];
    for (const [n, par, size, a] of [[240, 0.05, 0.8, 0.28], [110, 0.12, 1.1, 0.38], [30, 0.25, 1.5, 0.55]]) {
      const pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: Math.random(), y: Math.random(), tw: Math.random() * TAU, warm: Math.random() < 0.2 });
      layers.push({ pts, par, size, a });
    }
    return layers;
  }
  function makeDust() {
    const pts = [];
    for (let i = 0; i < 90; i++) pts.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.2 });
    return pts;
  }
  function drawBackground(camY, scale) {
    screenTransform();
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, '#03050b'); g.addColorStop(1, '#070a13');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    for (const L of stars) {
      const off = camY * scale * L.par;
      for (const s of L.pts) {
        const y = ((s.y * ch - off) % ch + ch) % ch;
        ctx.globalAlpha = L.a * (0.75 + 0.25 * Math.sin(clock * 1.1 + s.tw));
        ctx.fillStyle = s.warm ? '#ffe2c8' : '#cfe0ff';
        ctx.fillRect(s.x * cw, y, L.size, L.size);
      }
    }
    ctx.globalAlpha = 1;
    if (scenery) drawScenery(camY, scale);
  }
  // 遠くの惑星の縁と衛星。ゆっくり流れ、戦場より前に出ない
  function drawScenery(camY, scale) {
    const sc = scenery;
    // 画面の隅にかかる細い縁だけを見せる
    const R = Math.max(cw, ch) * 1.1;
    const px = sc.planetSide > 0 ? cw + R * 0.78 : -R * 0.78;
    const py = ch + R * 0.72 + Math.sin(camY * scale * 0.0004) * 20;
    const gr = ctx.createRadialGradient(px, py, R * 0.97, px, py, R * 1.03);
    gr.addColorStop(0, `rgba(${sc.planetHue},0.02)`);
    gr.addColorStop(0.5, `rgba(${sc.planetHue},0.09)`);
    gr.addColorStop(1, `rgba(${sc.planetHue},0)`);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(px, py, R * 1.03, 0, TAU); ctx.fill();
    ctx.fillStyle = '#04060b';
    ctx.beginPath(); ctx.arc(px, py, R * 0.985, 0, TAU); ctx.fill();
    // 衛星
    const m = sc.moon, mx = cw * m.x, my = ch * m.y - (camY * scale * 0.04) % (ch * 1.4);
    const mr = m.r;
    const yy = ((my % (ch * 1.4)) + ch * 1.4) % (ch * 1.4) - ch * 0.2;
    const mg = ctx.createRadialGradient(mx - mr * 0.4, yy - mr * 0.4, mr * 0.1, mx, yy, mr);
    mg.addColorStop(0, 'rgba(120,125,140,0.28)'); mg.addColorStop(1, 'rgba(40,44,56,0.2)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(mx, yy, mr, 0, TAU); ctx.fill();
  }
  function drawDust(top, bottom) {
    // 宇宙塵：戦場よりわずかに速く流れて奥行きを出す
    ctx.fillStyle = 'rgba(170,190,220,0.10)';
    const span = 900;
    const off = cam.y * 0.15;
    for (const d of dust) {
      const x = d.x * C.W;
      let y = d.y * span + Math.floor((top + off) / span) * span - off;
      for (let k = 0; k < 3; k++, y += span) {
        const wy = y;
        if (wy < top || wy > bottom) continue;
        ctx.fillRect(x, wy, d.s, d.s);
      }
    }
  }

  // ---------------------------------------------------------------- 盤面
  function drawWorld() {
    const v = updateCamera();
    drawBackground(cam.y, cam.scale);
    worldTransform();
    const top = cam.y - v.h / 2 - 100, bottom = cam.y + v.h / 2 + 100;

    for (const n of nebulae) {
      if (n.y + n.rad < top || n.y - n.rad > bottom) continue;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.rad);
      g.addColorStop(0, `rgba(${n.hue},${n.a})`); g.addColorStop(1, `rgba(${n.hue},0)`);
      ctx.fillStyle = g; ctx.fillRect(n.x - n.rad, n.y - n.rad, n.rad * 2, n.rad * 2);
    }
    drawDust(top, bottom);

    ctx.strokeStyle = 'rgba(140,170,220,0.10)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 14]);
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(0, bottom); ctx.moveTo(C.W, top); ctx.lineTo(C.W, bottom); ctx.stroke();
    ctx.setLineDash([]);

    const obj = objective();
    drawZones(obj);
    drawMines(top, bottom);
    drawMassPaths();
    drawLaserWarnings();
    drawLines();
    drawRocks(top, bottom);
    drawTrails(top, bottom);
    drawMasses(top, bottom);
    drawBatteries();

    // 艦隊の淡い光
    ctx.globalCompositeOperation = 'lighter';
    for (const g of S.groups) {
      if (!g.alive || !g.active || inert(g) || g.y < top || g.y > bottom) continue;
      const rgb = g.fac === 'P' ? COL.Pglow : g.fac === 'N' ? COL.Nglow : g.fac === 'S' ? COL.Sglow : COL.Eglow;
      const rad = g.r + (g.fac === 'P' ? 34 : g.stat === 'M' ? 30 : 22);
      const gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rad);
      gr.addColorStop(0, `rgba(${rgb},${g.fac === 'P' ? 0.12 : g.stat === 'M' ? 0.1 : 0.1})`); gr.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(g.x, g.y, rad, 0, TAU); ctx.fill();
    }
    // 自動攻撃のビーム：細い芯と短い残光
    for (const b of beams) {
      const a = Math.min(1, b.life / 0.14);
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${b.rgb},${0.12 * a})`;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = `rgba(${b.rgb},${0.8 * a * a})`;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    for (const r of rings) {
      const k = 1 - r.life / r.T;
      ctx.strokeStyle = `rgba(${r.rgb},${(1 - k) * 0.7})`;
      ctx.lineWidth = r.w;
      ctx.beginPath(); ctx.arc(r.x, r.y, 10 + (1 - (1 - k) * (1 - k)) * r.R, 0, TAU); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    drawPlayerMarks();
    drawShips(g => g.fac === 'E' && !inert(g) && g.stat !== 'M', COL.E, 5.8, top, bottom, COL.Eglow);
    drawShips(g => g.stat === 'M', COL.E, 6.4, top, bottom, COL.Eglow, 'rgba(255,200,185,0.55)');
    drawShips(g => g.fac === 'N', COL.N, 5.8, top, bottom, COL.Nglow);
    drawShips(g => g.fac === 'P', COL.P, 6.8, top, bottom, COL.Pglow);
    drawMainMarks();
    drawLaserBeams();
    drawTarget();

    ctx.globalCompositeOperation = 'lighter';
    for (const b of bursts) { // 機雷の炸裂：橙の小さな輪
      const k = 1 - b.life / 0.55;
      ctx.strokeStyle = `rgba(${COL.mine},${(1 - k) * 0.8})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4 + k * 22, 0, TAU); ctx.stroke();
    }
    for (const b of booms) {
      const k = 1 - b.life / b.T;
      if (k < 0.18) { // 一瞬の閃光
        ctx.fillStyle = `rgba(255,245,225,${(0.18 - k) * 5})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.big ? 16 : 9, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = `rgba(255,${b.f === 'P' ? 220 : 170},120,${(1 - k) * 0.7})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 + k * (b.big ? 30 : b.f === 'P' ? 17 : 12), 0, TAU); ctx.stroke();
    }
    for (const s of sparks) {
      ctx.fillStyle = `rgba(${s.rgb},${Math.min(1, s.life * 3) * 0.85})`;
      ctx.fillRect(s.x - 0.8, s.y - 0.8, 1.6, 1.6);
    }
    for (const m of motes) {
      ctx.fillStyle = `rgba(255,200,160,${Math.min(1, m.life * 2) * 0.7})`;
      ctx.fillRect(m.x - 1, m.y - 1, 2, 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const c of chunks) { // 質量兵器の破片
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.globalAlpha = Math.min(1, c.life / 0.8);
      ctx.fillStyle = '#4a4038';
      ctx.beginPath(); c.verts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,90,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // 目的地点・防衛ライン
  function drawZones(obj) {
    const cur = obj && obj.zone;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 2);
    for (const name in S.zones) {
      const z = S.zones[name];
      const on = name === cur;
      const rgb = z.friendly ? COL.home : COL.goal;
      const a = on || z.friendly ? 1 : 0.3;
      ctx.font = `20px ${FONT}`;
      ctx.textAlign = 'center';
      if (z.kind === 'band') {
        const up = z.side === 'top';
        const y = z.y, d = up ? -1 : 1;
        const g = ctx.createLinearGradient(0, y + d * 260, 0, y);
        g.addColorStop(0, `rgba(${rgb},${(z.friendly ? 0.07 : 0.10) * a})`); g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g; ctx.fillRect(-200, Math.min(y, y + d * 260), C.W + 400, 260);
        ctx.strokeStyle = `rgba(${rgb},${(0.45 + 0.25 * pulse) * a})`;
        ctx.lineWidth = z.friendly ? 2.5 : 2;
        ctx.setLineDash(z.friendly ? [28, 8] : [18, 12]);
        ctx.beginPath(); ctx.moveTo(-200, y); ctx.lineTo(C.W + 200, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${rgb},${0.85 * a})`;
        ctx.fillText(z.label, C.W / 2, y + d * 22 + (up ? 0 : 8));
        for (let i = 0; i < 9; i++) {
          const x = 100 + i * 175, yy = y + d * 50;
          ctx.beginPath();
          if (z.friendly) { ctx.moveTo(x - 12, yy + d * 6); ctx.lineTo(x, yy - d * 6); ctx.lineTo(x + 12, yy + d * 6); }
          else { ctx.moveTo(x - 12, yy - d * 6); ctx.lineTo(x, yy + d * 6); ctx.lineTo(x + 12, yy - d * 6); }
          ctx.strokeStyle = `rgba(${rgb},${0.28 * a})`; ctx.lineWidth = 2; ctx.stroke();
        }
      } else {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
        g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(1, `rgba(${rgb},${0.10 * a})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},${(0.45 + 0.25 * pulse) * a})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([18, 12]);
        ctx.lineDashOffset = -clock * 12;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        ctx.fillStyle = `rgba(${rgb},${0.85 * a})`;
        ctx.fillText(z.label, z.x, z.y + 7);
      }
    }
  }

  // 機雷原：薄い危険エリアと小さな機雷
  function drawMines(top, bottom) {
    for (const m of S.mines) {
      if (m.y1 < top || m.y0 > bottom) continue;
      const inside = S.inMines && m.pts && require_inside(m);
      ctx.beginPath();
      m.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fillStyle = `rgba(${COL.mine},${inside ? 0.075 : 0.05})`;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = `rgba(${COL.mine},0.06)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = m.x0 - (m.y1 - m.y0); x < m.x1; x += 26) { ctx.moveTo(x, m.y1); ctx.lineTo(x + (m.y1 - m.y0), m.y0); }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      m.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.strokeStyle = `rgba(${COL.mine},${inside ? 0.6 + 0.2 * Math.sin(clock * 6) : 0.38})`;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([10, 7]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [x, y, ph] of m.dots) {
        const blink = Math.sin(clock * 1.7 + ph * 3) > 0.93;
        ctx.fillStyle = blink ? 'rgba(255,120,80,0.9)' : `rgba(${COL.mine},0.5)`;
        ctx.beginPath(); ctx.moveTo(x, y - 3.2); ctx.lineTo(x + 3.2, y); ctx.lineTo(x, y + 3.2); ctx.lineTo(x - 3.2, y); ctx.closePath(); ctx.fill();
      }
      ctx.font = `16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${COL.mine},0.6)`;
      ctx.fillText(m.name, m.cx, m.y0 - 10);
    }
  }
  function require_inside(m) { return Core.inPoly(m.pts, S.player.x, S.player.y); }

  // 質量兵器の進路と、防衛ラインへの到達地点
  function drawMassPaths() {
    for (const g of S.masses) {
      if (!g.alive) continue;
      const z = S.zones[g.goal], e = massEta(S, g);
      if (!z || !e) continue;
      const [dx, dy] = dirOf(g.dir);
      const k = (z.y - g.y) / dy;
      const ex = g.x + dx * k, ey = z.y;
      const urgent = e.t < 25;
      ctx.strokeStyle = urgent ? `rgba(255,120,100,${0.45 + 0.25 * Math.sin(clock * 8)})` : 'rgba(210,190,170,0.22)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 12]);
      ctx.lineDashOffset = -clock * 20;
      ctx.beginPath(); ctx.moveTo(g.x + dx * g.r, g.y + dy * g.r); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      // 到達予定地点
      ctx.strokeStyle = urgent ? 'rgba(255,120,100,0.8)' : 'rgba(210,190,170,0.45)';
      ctx.beginPath(); ctx.arc(ex, ey, 16, 0, TAU); ctx.moveTo(ex - 24, ey); ctx.lineTo(ex + 24, ey); ctx.stroke();
      ctx.font = `bold 15px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = urgent ? 'rgba(255,150,130,0.95)' : 'rgba(220,205,190,0.7)';
      ctx.fillText(`到達まで ${mmss(e.t)}`, ex + 30, ey - 10);
    }
  }

  // レーザーの予兆：次に撃つ方向を薄い帯で。発射が近いほど濃く
  function drawLaserWarnings() {
    for (const b of S.batteries) {
      if (!b.alive) continue;
      const L = b.laser;
      if (L.state !== 'charge') continue;
      const rem = L.charge - L.t, k = L.t / L.charge;
      const soon = rem < 4;
      const pulse = 0.5 + 0.5 * Math.sin(clock * (soon ? 14 : 4));
      const al = soon ? 0.22 + 0.22 * pulse : 0.05 + 0.1 * k;
      const [a0, a1] = L.span;
      const [d0x, d0y] = dirOf(a0), [d1x, d1y] = dirOf(a1);
      const e0 = [b.x + d0x * L.wlen[0], b.y + d0y * L.wlen[0]], e1 = [b.x + d1x * L.wlen[1], b.y + d1y * L.wlen[1]];
      // 帯（射線の太さ）
      ctx.lineCap = 'butt';
      ctx.strokeStyle = `rgba(${COL.laser},${al * 0.28})`;
      ctx.lineWidth = L.width;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(e0[0], e0[1]);
      if (L.sweep) { ctx.moveTo(b.x, b.y); ctx.lineTo(e1[0], e1[1]); }
      ctx.stroke();
      if (L.sweep) { // 掃射で薙ぐ範囲
        ctx.fillStyle = `rgba(${COL.laser},${al * 0.22})`;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.closePath(); ctx.fill();
      }
      // 中心の警告線
      ctx.strokeStyle = `rgba(${COL.laser},${Math.min(0.9, al * 1.6)})`;
      ctx.lineWidth = soon ? 2 : 1.3;
      ctx.setLineDash(soon ? [22, 8] : [8, 14]);
      ctx.lineDashOffset = -clock * (soon ? 60 : 16);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(e0[0], e0[1]);
      if (L.sweep) { ctx.moveTo(b.x, b.y); ctx.lineTo(e1[0], e1[1]); }
      ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      // 掃射の向き：どちらからどちらへ薙ぐか
      if (L.sweep) {
        const t = 0.55;
        const m0 = [b.x + d0x * L.wlen[0] * t, b.y + d0y * L.wlen[0] * t], m1 = [b.x + d1x * L.wlen[1] * t, b.y + d1y * L.wlen[1] * t];
        const ax = m1[0] - m0[0], ay = m1[1] - m0[1], al2 = Math.hypot(ax, ay) || 1;
        const ux = ax / al2, uy = ay / al2;
        ctx.strokeStyle = `rgba(${COL.laser},${Math.min(0.8, al * 1.4)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]);
        ctx.moveTo(m1[0] - ux * 12 - uy * 7, m1[1] - uy * 12 + ux * 7); ctx.lineTo(m1[0], m1[1]); ctx.lineTo(m1[0] - ux * 12 + uy * 7, m1[1] - uy * 12 - ux * 7);
        ctx.stroke();
      }
      // 射線上の秒読み（画面のどこにいても見えるよう、射線沿いに数か所）
      if (rem < 6) {
        ctx.font = `bold ${soon ? 18 : 14}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,190,150,${soon ? 0.6 + 0.35 * pulse : 0.45})`;
        const len = Math.min(L.wlen[0], L.wlen[1]);
        for (let d = 380; d < len; d += 520) {
          const [mx, my] = dirOf((a0 + a1) / 2);
          ctx.fillText(rem.toFixed(1), b.x + mx * d + 30, b.y + my * d);
        }
      }
    }
  }

  // 発射中のレーザー：派手だが射線ははっきり
  function drawLaserBeams() {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of S.batteries) {
      if (!b.alive || b.laser.state !== 'fire') continue;
      const L = b.laser;
      const [dx, dy] = dirOf(L.cur);
      const ex = b.x + dx * L.len, ey = b.y + dy * L.len;
      const k = Math.min(1, L.t / 0.12, (L.fire - L.t) / 0.3);
      const w = L.width * (0.93 + 0.07 * Math.sin(clock * 70)) * k;
      const sx = b.x + dx * 26, sy = b.y + dy * 26;
      ctx.strokeStyle = `rgba(${COL.laser},0.14)`; ctx.lineWidth = w * 1.7;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = `rgba(${COL.laser},0.42)`; ctx.lineWidth = w * 0.8;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,244,230,0.95)'; ctx.lineWidth = w * 0.26;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      // 砲口と着弾点
      for (const [x, y, r] of [[sx, sy, 46 * k], [ex, ey, L.len < L.range - 5 ? 40 * k : 0]]) {
        if (r <= 0) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,240,220,0.8)'); g.addColorStop(0.4, `rgba(${COL.laser},0.35)`); g.addColorStop(1, `rgba(${COL.laser},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      if (L.len < L.range - 5 && Math.random() < 0.6) {
        const a = Math.random() * TAU, v = 40 + Math.random() * 80;
        sparks.push({ x: ex, y: ey, vx: Math.cos(a) * v - dx * 40, vy: Math.sin(a) * v - dy * 40, life: 0.3 + Math.random() * 0.3, rgb: '255,200,150' });
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBatteries() {
    for (const b of S.batteries) {
      if (!b.alive) continue;
      const L = b.laser, s = b.ships[0];
      const charging = L.state === 'charge';
      const k = charging ? L.t / L.charge : 1;
      const rem = L.charge - L.t;
      // 光が集まる
      if (charging && rem < 4 && mode === 'play' && Math.random() < 0.5) {
        const a = Math.random() * TAU, r = 80 + Math.random() * 60;
        const [dx, dy] = dirOf(L.cur);
        motes.push({ x: b.x + Math.cos(a) * r, y: b.y + Math.sin(a) * r, tx: b.x + dx * 30, ty: b.y + dy * 30, life: 0.7 });
      }
      // 台座
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 32, Math.sin(a) * 32); }
      ctx.closePath();
      const bg = ctx.createRadialGradient(-10, -10, 4, 0, 0, 34);
      bg.addColorStop(0, '#3a404c'); bg.addColorStop(1, '#171a21');
      ctx.fillStyle = s.flash > 0 ? '#5a5f6a' : bg; ctx.fill();
      ctx.strokeStyle = 'rgba(255,120,90,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      // 砲身
      ctx.rotate(L.cur);
      ctx.fillStyle = '#2c313b';
      ctx.fillRect(-7, -44, 14, 40);
      ctx.strokeStyle = 'rgba(255,140,100,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(-7, -44, 14, 40);
      ctx.restore();
      // 充填の光
      ctx.globalCompositeOperation = 'lighter';
      const glow = charging ? k * k : 1;
      const cg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 26 + 20 * glow);
      cg.addColorStop(0, `rgba(255,235,210,${0.25 + 0.6 * glow})`); cg.addColorStop(1, `rgba(${COL.laser},0)`);
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(b.x, b.y, 26 + 20 * glow, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // 充填ゲージ
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,140,100,0.15)';
      ctx.beginPath(); ctx.arc(b.x, b.y, 46, 0, TAU); ctx.stroke();
      const soon = charging && rem < 3;
      ctx.strokeStyle = !charging ? 'rgba(255,240,220,0.95)' : soon ? `rgba(255,220,190,${0.7 + 0.3 * Math.sin(clock * 16)})` : `rgba(${COL.laser},0.8)`;
      ctx.beginPath(); ctx.arc(b.x, b.y, 46, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      // 秒読み・耐久
      ctx.textAlign = 'center';
      ctx.font = `bold ${soon ? 20 : 14}px ${MONO}`;
      ctx.fillStyle = charging ? `rgba(255,200,170,${soon ? 0.95 : 0.7})` : 'rgba(255,240,220,0.95)';
      ctx.fillText(charging ? rem.toFixed(1) : '照射中', b.x, b.y + 72);
      const hp = s.hp / b.hp0;
      ctx.fillStyle = 'rgba(20,16,30,0.7)'; ctx.fillRect(b.x - 30, b.y + 80, 60, 4);
      ctx.fillStyle = b === S.target ? `rgba(${COL.tgt},0.9)` : 'rgba(255,140,110,0.8)'; ctx.fillRect(b.x - 30, b.y + 80, 60 * hp, 4);
      if (b !== S.target) {
        ctx.font = `13px ${FONT}`;
        ctx.fillStyle = 'rgba(255,160,130,0.6)';
        ctx.fillText(b.name, b.x, b.y - 58);
      }
    }
  }

  function drawMasses(top, bottom) {
    for (const g of S.masses) {
      if (!g.alive || g.y + g.r < top || g.y - g.r > bottom) continue;
      const s = g.ships[0], r = g.fixedR;
      const [dx, dy] = dirOf(g.dir);
      // 進行方向の縁が熱で光る
      ctx.globalCompositeOperation = 'lighter';
      const hg = ctx.createRadialGradient(g.x + dx * r * 0.7, g.y + dy * r * 0.7, 0, g.x + dx * r * 0.7, g.y + dy * r * 0.7, r * 1.1);
      hg.addColorStop(0, 'rgba(255,130,70,0.22)'); hg.addColorStop(1, 'rgba(255,130,70,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(g.x + dx * r * 0.7, g.y + dy * r * 0.7, r * 1.1, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(g.x, g.y); ctx.rotate(s.a);
      const gr = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
      gr.addColorStop(0, s.flash > 0 ? '#7d7064' : '#6b5f54'); gr.addColorStop(1, '#1c1814');
      ctx.fillStyle = gr;
      ctx.beginPath(); g.verts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(190,160,130,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      for (const [cx, cy, cr] of g.craters) {
        ctx.fillStyle = 'rgba(15,12,10,0.45)'; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(160,140,120,0.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, cr, Math.PI * 0.9, Math.PI * 1.8); ctx.stroke();
      }
      ctx.restore();
      // 耐久
      const hp = s.hp / g.hp0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(40,30,50,0.6)';
      ctx.beginPath(); ctx.arc(g.x, g.y, r + 12, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(${COL.tgt},0.85)`;
      ctx.beginPath(); ctx.arc(g.x, g.y, r + 12, -Math.PI / 2, -Math.PI / 2 + TAU * hp); ctx.stroke();
    }
  }

  function drawLines() {
    ctx.lineWidth = 2;
    for (const L of S.lines) {
      const sq = L.squads.filter(g => g.alive);
      if (!sq.length) continue;
      const links = L.ring ? sq.length : sq.length - 1;
      for (let i = 0; i < links; i++) {
        const a = sq[i], b = sq[(i + 1) % sq.length];
        if (a === b) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > L.linkMax || L.linkMax <= 110) continue;
        const k = Math.max(0, Math.min(1, (L.linkMax - d) / (L.linkMax - 110)));
        const al = (L.breached ? 0.12 : 0.34) * k;
        const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        ctx.strokeStyle = `rgba(${COL.Eglow},${al})`;
        ctx.beginPath(); ctx.moveTo(a.x + ux * a.r, a.y + uy * a.r); ctx.lineTo(b.x - ux * b.r, b.y - uy * b.r); ctx.stroke();
      }
      ctx.font = `15px ${FONT}`;
      ctx.fillStyle = `rgba(${COL.Eglow},${L.breached ? 0.25 : 0.45})`;
      let lx, ly;
      if (L.ring) { ctx.textAlign = 'center'; lx = L.ring.cx; ly = L.ring.cy - L.R - 40; }
      else {
        ctx.textAlign = 'left';
        let mx = Infinity, my = Infinity;
        for (const g of sq) { mx = Math.min(mx, g.x - g.r); my = Math.min(my, g.y - g.r); }
        lx = Math.max(14, Math.min(C.W - 160, mx)); ly = my - 20;
      }
      ctx.fillText(L.name + (L.breached ? '　突破' : ''), lx, ly);
    }
  }

  function drawRocks(top, bottom) {
    for (const r of S.rocks) {
      if (r.y + r.r < top || r.y - r.r > bottom) continue;
      ctx.save();
      ctx.translate(r.x, r.y); ctx.rotate(r.rot);
      const g = ctx.createRadialGradient(-r.r * 0.35, -r.r * 0.35, r.r * 0.1, 0, 0, r.r * 1.1);
      g.addColorStop(0, '#5b534b'); g.addColorStop(1, '#1f1c19');
      ctx.fillStyle = g;
      ctx.beginPath();
      r.verts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(170,150,130,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
  }

  // 航跡：艦隊がどこから来てどこへ向かうかを淡く残す
  function drawTrails(top, bottom) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const g of S.groups) {
      if (!g.alive || !g.active || inert(g) || g.y < top - 200 || g.y > bottom + 200) continue;
      const tr = trails.get(g.id);
      if (!tr || tr.length < 6) continue;
      const rgb = g.fac === 'P' ? COL.Pglow : g.fac === 'N' ? COL.Nglow : g.fac === 'S' ? COL.Sglow : COL.Eglow;
      const n = tr.length / 2;
      for (let i = 1; i < n; i++) {
        const a = i / n;
        ctx.strokeStyle = `rgba(${rgb},${0.07 * a})`;
        ctx.lineWidth = Math.max(2, g.r * 0.9 * a);
        ctx.beginPath(); ctx.moveTo(tr[i * 2 - 2], tr[i * 2 - 1]); ctx.lineTo(i === n - 1 ? g.x : tr[i * 2], i === n - 1 ? g.y : tr[i * 2 + 1]); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.globalCompositeOperation = 'source-over';
  }

  function tri(x, y, a, sz) {
    const c = Math.cos(a), s = Math.sin(a);
    ctx.moveTo(x + s * sz, y - c * sz);
    ctx.lineTo(x - 0.62 * sz * c - 0.75 * sz * s, y - 0.62 * sz * s + 0.75 * sz * c);
    ctx.lineTo(x - 0.3 * sz * s, y + 0.3 * sz * c);
    ctx.lineTo(x + 0.62 * sz * c - 0.75 * sz * s, y + 0.62 * sz * s + 0.75 * sz * c);
    ctx.closePath();
  }
  // 艦影。旋回時は前の艦から向きを変え、後ろの艦がわずかに遅れて追従する（見た目だけ）
  function drawShips(pred, color, sz, top, bottom, rgb, edge) {
    const list = [];
    for (const g of S.groups) {
      if (!pred(g) || !g.alive || !g.active || g.y < top - 50 || g.y > bottom + 50) continue;
      list.push(g);
      const lag = g.fac === 'P' || g.stat === 'M';
      const hx = Math.sin(g.fac === 'P' ? g.heading : g.face), hy = -Math.cos(g.fac === 'P' ? g.heading : g.face);
      for (const s of g.ships) {
        if (s.ra == null) s.ra = s.a;
        let rate = 7;
        if (lag && g.r > 0) {
          const front = ((s.x - g.x) * hx + (s.y - g.y) * hy) / g.r; // -1（後）〜 1（前）
          rate = 2.2 + 5 * Math.max(0, Math.min(1, (front + 1) / 2));
        }
        s.ra = lerpA(s.ra, s.a, Math.min(1, vdt * rate));
      }
    }
    // エンジン噴射
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${rgb},0.5)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const g of list) {
      const sp = Math.hypot(g.vx, g.vy);
      if (sp < 6) continue;
      const k = Math.min(1, sp / C.V);
      for (const s of g.ships) {
        const hx = Math.sin(s.ra), hy = -Math.cos(s.ra);
        if (g.vx * hx + g.vy * hy <= 0) continue;
        const bx = s.x - hx * sz * 0.35, by = s.y - hy * sz * 0.35;
        const L = (3 + 7 * k) * (0.75 + 0.25 * Math.sin(clock * 40 + s.ph * 7));
        ctx.moveTo(bx, by); ctx.lineTo(bx - hx * L, by - hy * L);
      }
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    const hit = [];
    for (const g of list) {
      const z = g.role === 'target' ? sz * 1.3 : sz;
      for (const s of g.ships) { tri(s.x, s.y, s.ra, z); if (s.flash > 0) hit.push([s, z]); }
    }
    ctx.fillStyle = color; ctx.fill();
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.stroke(); }
    if (hit.length) {
      ctx.beginPath();
      for (const [s, z] of hit) tri(s.x, s.y, s.ra, z);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fill();
    }
  }
  function lerpA(a, b, k) {
    const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * k;
  }

  // 敵主力艦隊：輪郭と名前・残存数
  function drawMainMarks() {
    for (const g of S.mains) {
      if (!g.alive || !g.ships.length) continue;
      const R = g.r + 16;
      ctx.strokeStyle = `rgba(${COL.Eglow},0.4)`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 7]);
      ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.font = `bold 14px ${FONT}`;
      ctx.fillStyle = `rgba(${COL.Eglow},0.9)`;
      ctx.fillText(`${g.name}  ${g.ships.length}`, g.x, g.y - R - 10);
    }
  }

  function drawTarget() {
    const g = S.target;
    if (!g || !g.alive) return;
    const base = g.role === 'mass' ? g.r + 24 : g.role === 'battery' ? 56 : g.r + 16;
    const R = base + Math.sin(clock * 4) * 2, L = 14;
    ctx.strokeStyle = `rgba(${COL.tgt},0.95)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = g.x + sx * R, y = g.y + sy * R;
      ctx.moveTo(x, y - sy * L); ctx.lineTo(x, y); ctx.lineTo(x - sx * L, y);
    }
    ctx.stroke();
    ctx.font = `bold 15px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(${COL.tgt},0.95)`;
    ctx.fillText('TARGET', g.x, g.y - R - 8);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = `rgba(${COL.tgt},0.7)`;
    ctx.fillText(g.name || '', g.x, g.y - R - 26);
  }

  function drawPlayerMarks() {
    const p = S.player;
    if (!p.ships.length) return;
    const R = p.r + 30, n = C.SECTORS;
    const danger = S.surroundT / C.SURROUND_T;
    ctx.lineWidth = 3;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI + i * TAU / n + 0.04, a1 = -Math.PI + (i + 1) * TAU / n - 0.04;
      if (S.sectors[i]) ctx.strokeStyle = `rgba(255,80,60,${0.35 + 0.45 * danger * (0.6 + 0.4 * Math.sin(clock * 12))})`;
      else ctx.strokeStyle = 'rgba(143,220,255,0.10)';
      ctx.beginPath(); ctx.arc(p.x, p.y, R, a0, a1); ctx.stroke();
    }
    if (!S.result) {
      const hx = Math.sin(p.heading), hy = -Math.cos(p.heading);
      const d = R + 16, x = p.x + hx * d, y = p.y + hy * d;
      const px = -hy, py = hx;
      ctx.strokeStyle = `rgba(143,220,255,${input.up ? 0.85 : 0.45})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - hx * 8 + px * 9, y - hy * 8 + py * 9); ctx.lineTo(x, y); ctx.lineTo(x - hx * 8 - px * 9, y - hy * 8 - py * 9);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 演出の重ね描き
  function updateCine() {
    if (!S || S.result) return;
    const g = S.target;
    // 任務成功直前：目標の耐久が残りわずか
    const nearWin = g && g.alive && g.ships[0] && (g.role === 'mass' || g.role === 'battery') && g.ships[0].hp / g.hp0 < 0.2;
    cine.boxWant = nearWin ? 1 : 0;
  }
  function drawCine() {
    screenTransform();
    // 最終防衛ライン目前：画面の縁が赤く脈打つ
    let red = cine.red;
    if (S && !S.result) for (const m of S.masses) {
      const e = massEta(S, m);
      if (e && e.t < 20) red = Math.max(red, (0.35 + 0.25 * Math.sin(clock * 5)) * (1 - e.t / 20) + 0.15);
    }
    if (red > 0.01) {
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
      g.addColorStop(0, 'rgba(255,40,30,0)'); g.addColorStop(1, `rgba(255,40,30,${Math.min(0.4, red * 0.4)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
    }
    if (cine.box > 0.01) {
      const h = Math.round(ch * 0.055 * cine.box);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, cw, h); ctx.fillRect(0, ch - h, cw, h);
    }
    if (cine.flash > 0.005) {
      ctx.fillStyle = `rgba(${cine.flashRgb},${cine.flash})`;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  // ---------------------------------------------------------------- HUD
  function text(str, x, y, size, color, align, font) {
    ctx.font = `${size}px ${font || FONT}`;
    ctx.fillStyle = color; ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
  }
  function bar(x, y, w, k, rgb, a) {
    ctx.fillStyle = `rgba(${rgb},${0.15 * a})`; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = `rgba(${rgb},${0.85 * a})`; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), 4);
  }
  // HUD の下に大事なもの（艦隊・砲台・質量兵器）が入ったら HUD を薄くして盤面を優先する
  const hudFade = { L: 1, R: 1, M: 1 };
  function updateHudFade() {
    const pts = [];
    for (const g of S.groups) if (g.alive && g.active && (g.fac === 'P' || inert(g) || g.stat === 'M')) pts.push([g.x, g.y, g.r]);
    const hit = (x0, y0, x1, y1) => pts.some(([x, y, r]) => { const [sx, sy] = toScreen(x, y), rr = r * cam.scale; return sx + rr > x0 && sx - rr < x1 && sy + rr > y0 && sy - rr < y1; });
    const k = Math.min(1, vdt * 6);
    const want = { L: hit(0, 0, 340, 200) ? 0.3 : 1, R: hit(cw - 190, 0, cw, 190) ? 0.3 : 1, M: hit(cw / 2 - 170, 0, cw / 2 + 170, 90) ? 0.35 : 1 };
    for (const key in hudFade) hudFade[key] += (want[key] - hudFade[key]) * k;
  }
  function drawHud() {
    screenTransform();
    const p = S.player, def = S.def, ph = S.phase;
    const top = Math.round(ch * 0.055 * cine.box);
    updateHudFade();
    // 左上：任務
    ctx.globalAlpha = hudFade.L;
    let y0 = top;
    text(`STAGE ${sel + 1}　${def.name}`, 24, y0 + 30, 12, 'rgba(160,190,230,0.6)', 'left');
    text('MISSION', 24, y0 + 54, 11, `rgba(${COL.goal},0.75)`, 'left', MONO);
    text(ph.text, 24, y0 + 80, 20, 'rgba(235,242,255,0.95)');
    const [pr, pr2] = progressText();
    text(pr, 24, y0 + 106, 15, `rgba(${COL.goal},0.9)`);
    let ly = y0 + 126;
    if (pr2) {
      const tl = timeLeft(S);
      text(pr2, 24, ly, 14, tl !== null && tl < 30 ? `rgba(255,150,120,${0.7 + 0.3 * Math.sin(clock * 6)})` : 'rgba(170,200,235,0.75)', 'left');
      ly += 20;
    }
    if (def.phases.length > 1) {
      let x = 24;
      def.phases.forEach((q, i) => {
        const lab = phaseLabel(q);
        const done = i < S.phaseIdx || (S.result && S.result.type === 'clear');
        const now = i === S.phaseIdx && !(S.result && S.result.type === 'clear');
        const col = now ? `rgba(${COL.goal},0.95)` : done ? 'rgba(160,190,230,0.45)' : 'rgba(160,190,230,0.3)';
        text((done ? '✓ ' : '') + lab, x, ly + 6, 12, col);
        x += ctx.measureText((done ? '✓ ' : '') + lab).width + 8;
        if (i < def.phases.length - 1) { text('›', x, ly + 6, 12, 'rgba(160,190,230,0.3)'); x += 14; }
      });
      ly += 24;
    }
    if (toast && clock - toast.t < 2.5) {
      const a = Math.min(1, (2.5 - (clock - toast.t)) / 0.6);
      text(toast.text, 24, ly + 6, 13, toast.good ? `rgba(${COL.Nglow},${a * 0.9})` : `rgba(255,140,120,${a * 0.95})`);
    }

    // 右上：残存
    ctx.globalAlpha = hudFade.R;
    text('自艦隊', cw - 24, y0 + 30, 12, 'rgba(160,190,230,0.6)', 'right');
    const n = S.result ? S.result.alive : p.ships.length;
    const low = n < S.required * 1.6;
    text(String(n), cw - 24, y0 + 68, 38, low ? 'rgba(255,150,120,0.95)' : 'rgba(220,240,255,0.95)', 'right', MONO);
    text(`出撃 ${S.sortie}`, cw - 24, y0 + 88, 12, 'rgba(160,190,230,0.55)', 'right');
    let ry = y0 + 114;
    if (S.npc0) { text(`友軍 ${S.npc} / ${S.npc0}`, cw - 24, ry, 14, `rgba(${COL.Nglow},0.8)`, 'right'); ry += 22; }
    for (const g of S.mains) { text(`敵主力 ${g.alive ? g.ships.length : 0} / ${g.n0}`, cw - 24, ry, 14, `rgba(${COL.Eglow},0.8)`, 'right'); ry += 22; }
    if (S.inMines && !S.result) text('機雷原 通過中', cw - 24, ry + 4, 14, `rgba(${COL.mine},${0.7 + 0.3 * Math.sin(clock * 6)})`, 'right');

    // 上中央：危険の残り時間（数字は補助。位置と形は盤面で読む）
    ctx.globalAlpha = hudFade.M;
    drawHazardPanel(top);
    ctx.globalAlpha = 1;

    const obj = objective();
    if (obj && S.t > 6) drawPointer(obj);

    if (S.surroundT > 1 && !S.result) text('包囲されつつある', cw / 2, ch - 60 - top, 16, `rgba(255,110,90,${0.5 + 0.4 * Math.sin(clock * 8)})`, 'center');

    const age = S.t;
    if (age < 7 && !S.result) {
      const a = Math.min(1, age * 1.5, (7 - age) / 1.2);
      const cy = ch * 0.3;
      text(`STAGE ${sel + 1}`, cw / 2, cy - 34, 12, `rgba(160,190,230,${a * 0.7})`, 'center', MONO);
      text(def.name, cw / 2, cy, 30, `rgba(230,240,255,${a})`, 'center');
      text('作戦指示', cw / 2, cy + 34, 12, `rgba(${COL.goal},${a * 0.8})`, 'center');
      text(def.phases[0].text, cw / 2, cy + 60, 18, `rgba(235,242,255,${a})`, 'center');
      text(HINTS[sel] || '', cw / 2, cy + 88, 14, `rgba(255,190,150,${a * 0.8})`, 'center');
    }
    if (age < 10 && !S.result) {
      const a = Math.min(1, (10 - age) / 2) * 0.55;
      text('← → 方向　↑ 前進　↓ 後退　攻撃は自動', cw / 2, ch - 24 - top, 13, `rgba(170,200,235,${a})`, 'center');
    }

    if (notice && !S.result) {
      const t = clock - notice.t;
      if (t > 3.6) notice = null;
      else {
        const a = Math.min(1, t * 3, (3.6 - t) / 0.9);
        const y = Math.max(230, ch * 0.24);
        const rgb = notice.rgb || (notice.tag === 'TARGET DESTROYED' ? COL.tgt : COL.goal);
        text(notice.tag, cw / 2, y - 30, 12, `rgba(${rgb},${a * 0.9})`, 'center', MONO);
        text(notice.title, cw / 2, y, 28, `rgba(235,242,255,${a})`, 'center');
        if (notice.sub) text(notice.sub, cw / 2, y + 32, 15, `rgba(${rgb},${a * 0.9})`, 'center');
      }
    }
  }
  function drawHazardPanel(top) {
    const rows = [];
    for (const b of S.batteries) {
      if (!b.alive) continue;
      const L = b.laser, rem = L.charge - L.t;
      if (L.state === 'fire') rows.push({ tag: 'LASER', label: b.name, val: '照射中', k: 1, rgb: '255,240,220', hot: true });
      else rows.push({ tag: 'LASER', label: b.name + '　発射まで', val: rem.toFixed(1) + 's', k: L.t / L.charge, rgb: COL.laser, hot: rem < 3 });
    }
    for (const m of S.masses) {
      const e = massEta(S, m);
      if (!e) continue;
      rows.push({ tag: 'MASS', label: '防衛ライン到達まで', val: mmss(e.t), k: 1 - e.d / e.total, rgb: e.t < 25 ? '255,120,100' : '210,190,170', hot: e.t < 25 });
    }
    if (!rows.length) return;
    const w = 300, x = cw / 2 - w / 2;
    let y = top + 22;
    for (const r of rows) {
      const a = r.hot ? 0.75 + 0.25 * Math.sin(clock * 10) : 0.85;
      text(r.tag, x, y, 11, `rgba(${r.rgb},${a * 0.8})`, 'left', MONO);
      text(r.label, x + 52, y, 12, `rgba(${r.rgb},${a * 0.85})`, 'left');
      text(r.val, x + w, y, 16, `rgba(${r.rgb},${a})`, 'right', MONO);
      bar(x, y + 6, w, r.k, r.rgb, a);
      y += 30;
    }
  }

  function drawPointer(obj) {
    const [sx, sy] = toScreen(obj.x, obj.y);
    const m = 40;
    if (sx > 0 && sx < cw && sy > 0 && sy < ch) return;
    const cx = cw / 2, cy = ch / 2;
    const dx = sx - cx, dy = sy - cy;
    const k = Math.min((cw / 2 - m) / Math.abs(dx || 1e-6), (ch / 2 - m) / Math.abs(dy || 1e-6));
    const x = cx + dx * k, y = cy + dy * k;
    const a = Math.atan2(dy, dx);
    const al = 0.55 + 0.3 * Math.sin(clock * 3);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = `rgba(${obj.rgb},${al})`;
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    const lx = x - Math.cos(a) * 30, ly = y - Math.sin(a) * 22 + 4;
    text(obj.label, lx, ly, 12, `rgba(${obj.rgb},${al})`, 'center', obj.label === 'TARGET' ? MONO : FONT);
  }

  const FAIL = {
    annihilated: ['艦隊壊滅', ''],
    insufficient: ['作戦続行不能', '自艦隊の損耗が限界を超えた'],
    surrounded: ['包囲殲滅', '四方を塞がれた'],
    mass: ['防衛ライン突破', '質量兵器が防衛ラインに到達した'],
    timeout: ['作戦時間切れ', '友軍本隊が砲台の射程に入った'],
  };
  function drawResult() {
    screenTransform();
    const t = clock - resultShownAt;
    const a = Math.min(1, t / 0.8);
    ctx.fillStyle = `rgba(2,4,10,${0.64 * a})`;
    ctx.fillRect(0, 0, cw, ch);
    const r = S.result, def = S.def;
    let y = ch / 2 - 130;
    if (r.type === 'clear') {
      text('MISSION COMPLETE', cw / 2, y - 34, 12, `rgba(${COL.goal},${a * 0.8})`, 'center', MONO);
      text('作戦完了', cw / 2, y, 34, `rgba(235,242,255,${a})`, 'center');
    } else {
      const [ti, sub] = FAIL[r.reason] || ['作戦失敗', ''];
      text('MISSION FAILED', cw / 2, y - 34, 12, `rgba(255,140,120,${a * 0.8})`, 'center', MONO);
      text(ti, cw / 2, y, 34, `rgba(255,190,175,${a})`, 'center');
      if (sub) text(sub, cw / 2, y + 28, 14, `rgba(255,190,175,${a * 0.7})`, 'center');
      text(`到達：${phaseLabel(def.phases[r.phaseIdx])}`, cw / 2, y + 50, 12, `rgba(170,200,235,${a * 0.6})`, 'center');
    }
    y += r.type === 'clear' ? 64 : 92;
    const block = (head, rows) => {
      text(head, cw / 2, y, 14, `rgba(${COL.goal},${a * 0.8})`, 'center');
      y += 28;
      for (const [k, v] of rows) { row2(k, v, y, a); y += 26; }
      y += 10;
    };
    block('自艦隊', [['出撃', r.sortie], ['残存', r.alive]]);
    const loss = [];
    if (S.mines.length) loss.push(['機雷で喪失', r.lostMine]);
    if (S.batteries.length) loss.push(['レーザーで喪失', r.lostLaser]);
    if (loss.length) block('危険宙域', loss);
    const enemy = [];
    if (r.targetDown !== null) enemy.push([S.target.name || 'TARGET', r.targetDown ? '破壊' : '健在']);
    r.mains.forEach(m => enemy.push(['敵主力', `${m.n} / ${m.n0}`]));
    if (r.killedLaser) enemy.push(['射線に巻き込んだ敵', r.killedLaser]);
    if (r.killedMine) enemy.push(['機雷原で沈んだ敵', r.killedMine]);
    if (enemy.length) block('敵', enemy);
    if (t > 1) {
      const b = Math.min(1, t - 1) * 0.6;
      let hint;
      if (r.type === 'clear') hint = sel + 1 < STAGES.length ? 'Enter 次の作戦へ　　R 再出撃　　Esc タイトル' : 'Enter タイトルへ　　R 再出撃';
      else hint = 'Enter 再出撃　　Esc タイトル';
      text(hint, cw / 2, Math.min(ch - 24, y + 16), 13, `rgba(170,200,235,${b})`, 'center');
    }
  }
  function row2(label, value, y, a) {
    text(label, cw / 2 - 16, y, 15, `rgba(170,200,235,${a})`, 'right');
    text(String(value), cw / 2 + 16, y, 19, `rgba(235,242,255,${a})`, 'left', typeof value === 'number' ? MONO : FONT);
  }

  function drawPause() {
    screenTransform();
    ctx.fillStyle = 'rgba(2,4,10,0.55)'; ctx.fillRect(0, 0, cw, ch);
    text('一時停止', cw / 2, ch / 2 - 30, 28, 'rgba(230,240,255,0.95)', 'center');
    text('MISSION　' + S.phase.text, cw / 2, ch / 2 + 6, 15, `rgba(${COL.goal},0.85)`, 'center');
    text('P 再開　　R やり直し　　Esc タイトル　　M 消音', cw / 2, ch / 2 + 40, 13, 'rgba(170,200,235,0.7)', 'center');
  }

  function drawTitle() {
    drawBackground(clock * 30, 1);
    screenTransform();
    const cx = cw / 2;
    // 遠くを横切る一筋のレーザー（タイトルだけの飾り）
    const ph = (clock % 9) / 9;
    if (ph < 0.08) {
      const k = Math.sin(ph / 0.08 * Math.PI);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${COL.laser},${0.18 * k})`; ctx.lineWidth = 18 * k;
      ctx.beginPath(); ctx.moveTo(-50, ch * 0.9); ctx.lineTo(cw + 50, ch * 0.62); ctx.stroke();
      ctx.strokeStyle = `rgba(255,240,225,${0.5 * k})`; ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.moveTo(-50, ch * 0.9); ctx.lineTo(cw + 50, ch * 0.62); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    let y = Math.max(104, ch * 0.13);
    text('昼休みの宇宙戦争', cx, y - 40, 17, 'rgba(170,200,235,0.75)', 'center');
    text('危 険 宙 域 編', cx, y, 46, 'rgba(230,240,255,0.95)', 'center');
    text('HAZARD ZONE', cx, y + 30, 12, 'rgba(143,220,255,0.55)', 'center', MONO);

    y += 74;
    for (let i = 0; i < STAGES.length; i++) {
      const on = i === sel;
      const yy = y + i * 36;
      if (on) {
        ctx.fillStyle = 'rgba(143,220,255,0.08)';
        ctx.fillRect(cx - 210, yy - 23, 420, 32);
        ctx.fillStyle = 'rgba(143,220,255,0.8)';
        ctx.beginPath(); tri(cx - 190, yy - 7, Math.PI / 2, 7); ctx.fill();
      }
      text(String(i + 1), cx - 160, yy, 14, on ? 'rgba(143,220,255,0.9)' : 'rgba(140,160,200,0.5)', 'left', MONO);
      text(STAGES[i].name, cx - 134, yy, 18, on ? 'rgba(235,242,255,1)' : 'rgba(170,190,220,0.6)', 'left');
      text(STAGES[i].phases.map(phaseLabel).join('›'), cx + 128, yy, 11, on ? `rgba(${COL.goal},0.75)` : 'rgba(140,160,200,0.4)', 'right');
      if (cleared.includes(i)) text('完了', cx + 195, yy, 12, `rgba(${COL.goal},0.6)`, 'right');
    }
    y += STAGES.length * 36 + 14;
    const s = STAGES[sel];
    text('作戦指示：' + s.phases[0].text, cx, y, 14, `rgba(${COL.goal},0.8)`, 'center');
    text(HINTS[sel] || '', cx, y + 22, 13, 'rgba(255,190,150,0.7)', 'center');
    y += 58;
    const lines = [
      '← →  方向転換　　↑  前進　　↓  後退（低速）　　WASD 可',
      '攻撃は自動。前進速度は敵と同じ。包囲されれば負ける。',
    ];
    lines.forEach((l, i) => text(l, cx, y + i * 22, 13, 'rgba(160,185,220,0.7)', 'center'));
    y += lines.length * 22 + 26;
    const items = [
      ['P', '自艦隊'], ['N', '友軍'], ['E', '敵艦隊'], ['M', '敵主力'], ['T', 'TARGET'],
      ['L', 'レーザー射線'], ['X', '質量兵器'], ['K', '機雷原'], ['G', '目的地点'], ['H', '防衛ライン'],
    ];
    const perRow = cw < 760 ? 4 : 5;
    const step = Math.min(120, (cw - 40) / perRow);
    items.forEach(([k, label], i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const x = cx - step * perRow / 2 + 14 + c * step, yy = y + r * 28;
      ctx.beginPath();
      if (k === 'T') {
        ctx.strokeStyle = `rgba(${COL.tgt},0.95)`; ctx.lineWidth = 2;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const px = x + sx * 7, py = yy - 5 + sy * 7; ctx.moveTo(px, py - sy * 4); ctx.lineTo(px, py); ctx.lineTo(px - sx * 4, py); }
        ctx.stroke();
      } else if (k === 'G') { ctx.fillStyle = `rgba(${COL.goal},0.8)`; ctx.fillRect(x - 9, yy - 6, 18, 2); }
      else if (k === 'H') { ctx.fillStyle = `rgba(${COL.home},0.8)`; ctx.fillRect(x - 9, yy - 6, 18, 3); }
      else if (k === 'L') { ctx.fillStyle = `rgba(${COL.laser},0.35)`; ctx.fillRect(x - 10, yy - 9, 20, 7); ctx.fillStyle = 'rgba(255,240,225,0.9)'; ctx.fillRect(x - 10, yy - 6, 20, 1.5); }
      else if (k === 'X') { ctx.fillStyle = '#5d5248'; ctx.arc(x, yy - 5, 8, 0, TAU); ctx.fill(); }
      else if (k === 'K') { ctx.fillStyle = `rgba(${COL.mine},0.18)`; ctx.fillRect(x - 10, yy - 12, 20, 13); ctx.fillStyle = `rgba(${COL.mine},0.7)`; ctx.fillRect(x - 2, yy - 7, 3, 3); }
      else if (k === 'M') { tri(x - 4, yy - 5, 0, 6); tri(x + 4, yy - 5, 0, 6); ctx.fillStyle = COL.E; ctx.fill(); ctx.strokeStyle = 'rgba(255,200,185,0.6)'; ctx.lineWidth = 0.8; ctx.stroke(); }
      else { tri(x, yy - 5, 0, 7); ctx.fillStyle = COL[k]; ctx.fill(); }
      text(label, x + 14, yy, 12, 'rgba(170,190,220,0.8)');
    });
    y += Math.ceil(items.length / perRow) * 28;
    text('Enter 出撃　　↑↓ / 1-5 選択　　M 消音', cx, Math.min(ch - 24, y + 30), 13, `rgba(143,220,255,${0.5 + 0.3 * Math.sin(clock * 3)})`, 'center');
  }

  function draw() {
    if (cw !== window.innerWidth || ch !== window.innerHeight) resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (mode === 'title' || !S) { drawTitle(); return; }
    updateCine();
    drawWorld();
    drawCine();
    drawHud();
    if (mode === 'result') drawResult();
    if (mode === 'pause') drawPause();
  }

  requestAnimationFrame(frame);

  // 検証用：URL に #debug を付けたときだけ手動でコマ送りできる
  if (location.hash === '#debug') {
    window.__game = {
      start: startStage,
      get S() { return S; }, cam, cine,
      step(sec, inp) {
        Object.assign(input, { left: false, right: false, up: false, down: false }, inp);
        for (let i = 0; i < sec * 60; i++) { clock += STEP; vdt = STEP; if (S && !(mode === 'result' && S.result && S.t - S.result.t > 3)) { update(S, STEP, input); consumeFx(); } ageFx(STEP); }
        if (S && S.result && mode === 'play') { mode = 'result'; resultShownAt = clock - 2; }
        draw();
        return S && { t: +S.t.toFixed(1), alive: S.player.ships.length, phase: S.phase.kind, result: S.result && S.result.type };
      },
    };
  }
})();
