/* Сцены-упражнения. Строятся под габариты выбранного авто и уровень сложности. */
window.PA = window.PA || {};

PA.scenarios = (function () {
  const H = Math.PI / 2;
  const LEVELS = {
    easy:   { par: 2.2, perp: 0.95, gar: 1.0,  lane: 7.0, road: 9.5 },
    normal: { par: 1.4, perp: 0.7,  gar: 0.7,  lane: 6.0, road: 8.0 },
    hard:   { par: 0.9, perp: 0.45, gar: 0.45, lane: 5.2, road: 6.8 },
  };
  const CAR_COLORS = ['#5d6675', '#8a2f2f', '#2f4f8a', '#c7c9cc', '#1f2328', '#3f6b4f', '#7a6a55', '#9a9ea6', '#6b3f7a', '#b8862f'];

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCar(r, x, y, a, opts = {}) {
    return {
      type: 'car', x, y, a,
      w: opts.len || 4.3 + r() * 0.6,
      h: opts.wid || 1.74 + r() * 0.16,
      color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)],
    };
  }

  const obj = (type, x, y, w, h, a = 0, extra = {}) => ({ type, x, y, w, h, a, ...extra });

  /** Параллельная парковка задом между двумя машинами у бордюра. */
  function parallel(spec, lv, exit) {
    const r = rng(11);
    const S = spec.length + (exit ? lv.par * 0.75 : lv.par);
    const o = [];
    const cy = -1.05;
    o.push(obj('sidewalk', S / 2, 1.6, 70, 3.2));
    o.push(obj('curb', S / 2, 0.075, 70, 0.15));
    o.push(obj('fence', S / 2, 3.2, 70, 0.08));
    const behind = makeCar(r, 0, cy, 0, { len: 4.5 });
    behind.x = -behind.w / 2;
    const ahead = makeCar(r, 0, cy, 0, { len: 4.6 });
    ahead.x = S + ahead.w / 2;
    o.push(behind, ahead);
    o.push(makeCar(r, behind.x - behind.w / 2 - 1.2 - 2.3, cy, 0));
    o.push(makeCar(r, ahead.x + ahead.w / 2 + 1.4 + 2.3, cy, 0));
    // встречная сторона
    const far = -1.95 - lv.lane * 2 + 1.0;
    o.push(obj('curb', S / 2, far - 0.075, 70, 0.15));
    o.push(obj('sidewalk', S / 2, far - 1.75, 70, 3.2));
    for (let i = -3; i <= 3; i++) {
      if (r() < 0.35) continue;
      o.push(makeCar(r, S / 2 + i * 5.8, far + 1.05, Math.PI));
    }
    for (let x = -30; x < 36; x += 6) o.push(obj('line', x, (far + -1.95) / 2, 3, 0.12));
    const goalH = spec.width + 0.45;
    let start;
    if (exit) {
      start = { x: (S - spec.length) / 2 + spec.rearOverhang, y: cy, h: 0 };
      o.push(obj('goal', S + 15, -1.95 - lv.lane / 2, 9, lv.lane - 0.6, 0));
    } else {
      start = { x: -9, y: -1.95 - 0.9 - spec.width / 2, h: 0 };
      o.push(obj('goal', S / 2, -0.05 - goalH / 2, S, goalH, 0));
    }
    return { name: exit ? 'Выезд из тесной параллельной' : 'Параллельная парковка', start, objects: o };
  }

  /** Ряд перпендикулярных мест: заезд задом (или передом). */
  function perpendicular(spec, lv, pillars) {
    const r = rng(23);
    const W = spec.width + lv.perp + (pillars ? 0.25 : 0);
    const D = Math.max(5.0, spec.length + 0.5);
    const o = [];
    o.push(obj('curb', 0, D + 0.075, 60, 0.15));
    o.push(obj(pillars ? 'wall' : 'fence', 0, D + (pillars ? 0.3 : 1.2), 60, pillars ? 0.25 : 0.08));
    for (let i = -6; i <= 6; i++) {
      o.push(obj('line', (i + 0.5) * W, D / 2, D, 0.12, H));
      if (i === 0) continue;
      const nose = r() < 0.6;
      const c = makeCar(r, i * W + (r() - 0.5) * 0.25, 0, (nose ? H : -H) + (r() - 0.5) * 0.06);
      c.y = D - c.w / 2 - 0.15 - r() * 0.35;
      o.push(c);
    }
    if (pillars) {
      for (const j of [-4, -1, 0, 3]) o.push(obj('pillar', (j + 0.5) * W, 0.55, 0.5, 0.5));
      o.push(obj('wall', 0, -lv.lane - 0.125, 60, 0.25));
      for (const j of [-5, -2, 1, 4]) o.push(obj('pillar', (j + 0.5) * W, -lv.lane + 0.3, 0.5, 0.5));
    } else {
      const top = -lv.lane;
      for (let i = -6; i <= 6; i++) {
        o.push(obj('line', (i + 0.5) * W, top - D / 2, D, 0.12, H));
        if (r() < 0.15) continue;
        const c = makeCar(r, i * W + (r() - 0.5) * 0.25, 0, (r() < 0.5 ? H : -H) + (r() - 0.5) * 0.06);
        c.y = top - D + c.w / 2 + 0.15 + r() * 0.35;
        o.push(c);
      }
      o.push(obj('curb', 0, top - D - 0.075, 60, 0.15));
    }
    o.push(obj('goal', 0, D / 2, D, W, H, { bidir: true }));
    return {
      name: pillars ? 'Паркинг с колоннами' : 'Перпендикулярная парковка',
      start: { x: -6 * W - 2, y: -lv.lane / 2, h: 0 },
      objects: o,
    };
  }

  /** Места «ёлочкой» под 45°. */
  function angled(spec, lv) {
    const r = rng(37);
    const a = Math.PI / 4;
    const W = spec.width + lv.perp;
    const Ls = Math.max(5.0, spec.length + 0.4);
    const p = W / Math.sin(a);
    const ax = Math.cos(a), ay = Math.sin(a);
    const depth = Ls * ay + W * Math.cos(a) / 2;
    const o = [];
    for (let i = -6; i <= 6; i++) {
      const cx = i * p, cy = (Ls / 2) * ay;
      const lx = cx + p / 2;
      o.push(obj('line', lx, cy, Ls, 0.12, a));
      if (i === 0) continue;
      const c = makeCar(r, 0, 0, a + (r() - 0.5) * 0.05);
      const off = Ls / 2 - c.w / 2 - 0.2 - r() * 0.3;
      c.x = cx + ax * off + (r() - 0.5) * 0.15;
      c.y = cy + ay * off;
      o.push(c);
    }
    o.push(obj('curb', 0, depth + 0.4, 60, 0.15));
    o.push(obj('fence', 0, depth + 1.6, 60, 0.08));
    o.push(obj('curb', 0, -lv.lane, 60, 0.15));
    o.push(obj('sidewalk', 0, -lv.lane - 1.6, 60, 3.0));
    o.push(obj('goal', 0, (Ls / 2) * ay, Ls, W, a));
    return { name: 'Парковка ёлочкой (45°)', start: { x: -6 * p - 6, y: -lv.lane / 2, h: 0 }, objects: o };
  }

  /** Заезд в узкий гараж из ряда гаражей. */
  function garage(spec, lv) {
    const Wg = spec.width + lv.gar;
    const Dg = spec.length + 0.8;
    const t = 0.25, step = Wg + t;
    const o = [];
    for (let k = -4; k <= 4; k++) {
      const x = k * step;
      o.push(obj('wall', x + step / 2, Dg / 2, Dg + t, t, H));
      if (k !== 0) o.push(obj('wall', x, -0.1, Wg, 0.2, 0, { color: '#59606b' }));
    }
    o.push(obj('wall', 0, Dg + t / 2, 9 * step + t, t));
    o.push(obj('fence', 0, -lv.lane, 60, 0.08));
    o.push(obj('grass', 0, -lv.lane - 1.6, 60, 3.1));
    o.push(obj('goal', 0, Dg / 2, Dg, Wg, H, { bidir: true }));
    return { name: 'Узкий гараж', start: { x: -12, y: -lv.lane / 2, h: 0 }, objects: o };
  }

  /** Разворот в три приёма на узкой дороге. */
  function threePoint(spec, lv) {
    const Wr = lv.road;
    const o = [];
    o.push(obj('curb', 0, 0.075, 60, 0.15));
    o.push(obj('curb', 0, -Wr - 0.075, 60, 0.15));
    o.push(obj('grass', 0, 1.1, 60, 2));
    o.push(obj('grass', 0, -Wr - 1.1, 60, 2));
    o.push(obj('fence', 0, 2.2, 60, 0.08));
    o.push(obj('fence', 0, -Wr - 2.2, 60, 0.08));
    for (let x = -28; x < 30; x += 6) o.push(obj('line', x, -Wr / 2, 3, 0.12));
    o.push(obj('post', -6, 0.9, 0.2, 0.2));
    o.push(obj('post', 7, -Wr - 0.9, 0.2, 0.2));
    o.push(obj('goal', 0, -Wr * 0.75, 16, Wr / 2 - 0.3, Math.PI));
    return {
      name: 'Разворот в три приёма',
      start: { x: -spec.wheelbase / 2 - 4, y: -1.0 - spec.width / 2, h: 0 },
      objects: o,
    };
  }

  function sandbox(spec) {
    const r = rng(5);
    const o = [];
    o.push(obj('fence', 0, -15, 40, 0.08), obj('fence', 0, 15, 40, 0.08));
    o.push(obj('fence', -20, 0, 30, 0.08, H), obj('fence', 20, 0, 30, 0.08, H));
    for (let i = 0; i < 6; i++) o.push(obj('cone', 4 + i * 2.2, -4 + (i % 2) * 2.5, 0.32, 0.32));
    o.push(makeCar(r, -8, 6, 0.2));
    o.push(obj('pillar', 6, 7, 0.5, 0.5));
    o.push(obj('wall', -10, -9, 6, 0.25, 0.4));
    return { name: 'Свободная площадка', start: { x: -spec.wheelbase / 2, y: 0, h: 0 }, objects: o };
  }

  const list = [
    { id: 'parallel', name: 'Параллельная парковка', build: (s, l) => parallel(s, l, false) },
    { id: 'perp', name: 'Перпендикулярная (задом)', build: (s, l) => perpendicular(s, l, false) },
    { id: 'pillars', name: 'Паркинг с колоннами', build: (s, l) => perpendicular(s, l, true) },
    { id: 'angled', name: 'Ёлочка 45°', build: angled },
    { id: 'garage', name: 'Узкий гараж', build: garage },
    { id: 'exit', name: 'Выезд из тесной параллельной', build: (s, l) => parallel(s, l, true) },
    { id: 'uturn', name: 'Разворот в три приёма', build: threePoint },
    { id: 'sandbox', name: 'Свободная площадка', build: sandbox },
  ];

  function build(id, spec, level) {
    const sc = list.find((s) => s.id === id) || list[0];
    const data = sc.build(PA.vehicles.derive(spec), LEVELS[level] || LEVELS.normal);
    data.id = sc.id;
    return data;
  }

  return { list, build, LEVELS };
})();
