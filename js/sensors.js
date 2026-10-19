/* Ультразвуковые парктроники (4 спереди, 4 сзади) и звуковой сигнал. */
window.PA = window.PA || {};

PA.sensors = (function () {
  const SPREAD = PA.geo.rad(22);
  const RAYS = 5;

  function layout(spec) {
    const f = spec.wheelbase + spec.frontOverhang, r = -spec.rearOverhang, w = spec.width / 2;
    const c = PA.geo.rad(55);
    return [
      { lx: f - 0.06, ly: -w * 0.86, a: -c, range: 0.9, front: true },
      { lx: f, ly: -w * 0.32, a: 0, range: 1.5, front: true },
      { lx: f, ly: w * 0.32, a: 0, range: 1.5, front: true },
      { lx: f - 0.06, ly: w * 0.86, a: c, range: 0.9, front: true },
      { lx: r + 0.06, ly: -w * 0.86, a: Math.PI + c, range: 0.9, front: false },
      { lx: r, ly: -w * 0.32, a: Math.PI, range: 1.8, front: false },
      { lx: r, ly: w * 0.32, a: Math.PI, range: 1.8, front: false },
      { lx: r + 0.06, ly: w * 0.86, a: Math.PI - c, range: 0.9, front: false },
    ];
  }

  function read(world, spec, pose) {
    const solids = world.solids();
    return layout(spec).map((s) => {
      const p = PA.kin.toWorld(pose, s.lx, s.ly);
      const dirA = pose.h + s.a;
      let dist = Infinity;
      const near = solids.filter((o) =>
        o._bb.maxX > p.x - s.range - 0.5 && o._bb.minX < p.x + s.range + 0.5 &&
        o._bb.maxY > p.y - s.range - 0.5 && o._bb.minY < p.y + s.range + 0.5);
      for (let i = 0; i < RAYS; i++) {
        const a = dirA - SPREAD + (2 * SPREAD * i) / (RAYS - 1);
        const dx = Math.cos(a), dy = Math.sin(a);
        for (const o of near) {
          const t = PA.geo.rayPoly(p.x, p.y, dx, dy, o._poly);
          if (t < dist) dist = t;
        }
      }
      return { ...s, x: p.x, y: p.y, dirA, dist: dist <= s.range ? dist : null };
    });
  }

  /** Зона по расстоянию: 0 — красная, 1 — жёлтая, 2 — зелёная. */
  function zone(d, range) {
    if (d == null) return -1;
    if (d < 0.35) return 0;
    if (d < Math.min(0.8, range * 0.6)) return 1;
    return 2;
  }

  // ---- Звук ----
  let ctx = null, gain = null, osc = null, nextBeep = 0, enabled = false;

  function setEnabled(on) {
    enabled = on;
    if (on && !ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1900;
      osc.connect(gain);
      osc.start();
    }
    if (ctx && on && ctx.state === 'suspended') ctx.resume();
    if (gain && !on) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
  }

  /** Вызывается каждый кадр с минимальной дистанцией активных датчиков. */
  function beep(minDist) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    if (minDist == null) {
      gain.gain.setTargetAtTime(0, t, 0.01);
      return;
    }
    if (minDist < 0.3) {
      gain.gain.setTargetAtTime(0.12, t, 0.01);
      return;
    }
    if (t >= nextBeep) {
      const period = 0.12 + Math.min(1, (minDist - 0.3) / 1.3) * 0.7;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.setValueAtTime(0, t + 0.07);
      nextBeep = t + period;
    }
  }

  function thud() {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.32);
  }

  return { read, zone, setEnabled, beep, thud };
})();
