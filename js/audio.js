// 昼休みの宇宙戦争・危険宙域編 — 効果音と環境音（前作と共通の音に、危険宙域の音を足した。WebAudio で合成、外部ファイルなし）
(function (root) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let engGain = null, droneGain = null;
  let muted = false;
  let lastBeam = 0, lastBoom = 0;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { // ブラウンノイズ
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    // 低いエンジン音
    const eng = ctx.createBufferSource();
    eng.buffer = noiseBuf; eng.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    eng.connect(lp); lp.connect(engGain); engGain.connect(master);
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 41;
    const humG = ctx.createGain(); humG.gain.value = 0.35;
    hum.connect(humG); humG.connect(engGain);
    eng.start(); hum.start();

    // 控えめなドローン（長い無音をはさむ）
    droneGain = ctx.createGain(); droneGain.gain.value = 0;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 260;
    droneGain.connect(dlp); dlp.connect(master);
    [55, 82.4, 110.3].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'sine' : 'triangle'; o.frequency.value = f;
      o.detune.value = (i - 1) * 6;
      const g = ctx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.5;
      o.connect(g); g.connect(droneGain); o.start();
    });
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
  }

  // speed01: 0..1, t: 経過秒（ドローンの周期に使う）
  function ambience(speed01, t, active) {
    if (!ctx) return;
    const now = ctx.currentTime;
    engGain.gain.setTargetAtTime(active ? 0.05 + speed01 * 0.12 : 0.02, now, 0.3);
    // 70秒周期：20秒かけて鳴り、あとは静か
    const ph = (t % 70) / 70;
    let v = 0;
    if (ph < 0.12) v = ph / 0.12; else if (ph < 0.3) v = 1; else if (ph < 0.45) v = 1 - (ph - 0.3) / 0.15;
    droneGain.gain.setTargetAtTime(active ? v * 0.035 : 0.02, now, 0.8);
  }

  function beam(fac, pan) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (now - lastBeam < 0.07) return;
    lastBeam = now;
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = 'sine';
    const f0 = fac === 'E' ? 900 : 1500;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, now + 0.09);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.025, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
    o.start(now); o.stop(now + 0.12);
  }

  function boom(pan, big) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (now - lastBoom < 0.06) return;
    lastBoom = now;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(big ? 900 : 700, now);
    f.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.35 : 0.2, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(f); f.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
    s.start(now, Math.random() * 1.5, 0.5);
  }

  function tone(freq, start, dur, vol, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }
  function chime() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    tone(880, now, 0.35, 0.07);
    tone(1318.5, now + 0.14, 0.5, 0.06);
  }
  function endCue(clear) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (clear) { tone(440, now, 1.6, 0.05); tone(659.3, now + 0.2, 1.6, 0.04); tone(880, now + 0.4, 1.8, 0.035); }
    else { tone(110, now, 2.2, 0.08, 'triangle'); tone(103.8, now + 0.3, 2.4, 0.06, 'triangle'); }
  }
  function select() {
    if (!ctx || muted) return;
    tone(660, ctx.currentTime, 0.12, 0.04);
  }

  function noiseHit(start, dur, f0, f1, vol, type, pan) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass';
    f.frequency.setValueAtTime(f0, start);
    f.frequency.exponentialRampToValueAtTime(f1, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f); f.connect(g);
    const p = ctx.createStereoPanner && pan != null ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
    s.start(start, Math.random() * 1.2, dur + 0.1);
  }
  // 巨大レーザー：低い衝撃と、照射のあいだ続く唸り
  function laser(pan, dur, near) {
    if (!ctx || muted) return;
    const now = ctx.currentTime, v = near ? 1 : 0.35;
    noiseHit(now, 0.9, 1800, 60, 0.4 * v, 'lowpass', pan);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(70, now + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.07 * v, now + 0.05);
    g.gain.setValueAtTime(0.07 * v, now + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(now); o.stop(now + dur + 0.05);
    noiseHit(now + 0.05, dur, 3000, 1500, 0.05 * v, 'bandpass', pan);
  }
  function mine(pan) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (now - lastBoom < 0.05) return;
    lastBoom = now;
    noiseHit(now, 0.25, 2400, 200, 0.16, 'lowpass', pan);
  }
  function quake() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    noiseHit(now, 2.2, 700, 30, 0.6, 'lowpass', 0);
    tone(55, now, 1.8, 0.1, 'triangle');
  }
  function clash() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    noiseHit(now, 0.8, 500, 50, 0.3, 'lowpass', 0);
    tone(98, now, 1.2, 0.07, 'triangle'); tone(92.5, now + 0.05, 1.2, 0.05, 'triangle');
  }
  // 発射の秒読み
  function tick(last) {
    if (!ctx || muted) return;
    tone(last ? 1320 : 990, ctx.currentTime, 0.09, 0.035, 'square');
  }

  root.Sfx = { init, setMuted, isMuted: () => muted, ambience, beam, boom, chime, endCue, select, laser, mine, quake, clash, tick };
})(this);
