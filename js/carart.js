/* Форма кузова в плане и реалистичная отрисовка автомобиля сверху.
   Локальные координаты: начало — центр задней оси, +x вперёд, +y вправо, метры. */
window.PA = window.PA || {};

PA.carArt = (function () {
  const { rad, clamp } = PA.geo;

  /* Пропорции силуэта: доли длины от переднего бампера.
     ws — основание лобового стекла, roofF/roofR — крыша, rw — низ заднего стекла,
     roofW — ширина остекления относительно габаритной (сужение кузова вверх). */
  const STYLES = {
    sedan:  { label: 'Седан',      ws: 0.29, roofF: 0.42, roofR: 0.70, rw: 0.83, roofW: 0.72 },
    hatch:  { label: 'Хэтчбек',    ws: 0.28, roofF: 0.41, roofR: 0.83, rw: 0.93, roofW: 0.74 },
    suv:    { label: 'Кроссовер',  ws: 0.25, roofF: 0.36, roofR: 0.87, rw: 0.95, roofW: 0.78, rails: true },
    van:    { label: 'Минивэн',    ws: 0.13, roofF: 0.24, roofR: 0.96, rw: 0.985, roofW: 0.84 },
    pickup: { label: 'Пикап',      ws: 0.25, roofF: 0.35, roofR: 0.55, rw: 0.58, roofW: 0.78, bed: [0.605, 0.975] },
    micro:  { label: 'Микро',      ws: 0.17, roofF: 0.33, roofR: 0.86, rw: 0.95, roofW: 0.78 },
  };

  function shade(hex, k) {
    const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x5d6675;
    const f = (c) => Math.round(clamp(k > 0 ? c + (255 - c) * k : c * (1 + k), 0, 255));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // ------------------------------------------------------------ контур
  const outlineCache = new WeakMap();

  /**
   * Выпуклый контур кузова (пропорции сняты с вида сверху Hyundai Tucson IV).
   * Шире всего у колёсных арок. Углы — эллипсы: спереди ≈0.6×0.6 м, сзади ≈0.6×0.45 м.
   * За задней осью борт дополнительно уходит внутрь по параболе y = w − c·x²,
   * c = 1.15 / (2(R + w)), R — минимальный радиус задней оси: при выезде от стены
   * впритык с рулём до упора корма не выходит за линию борта (запас 15%).
   */
  function outline(spec) {
    let o = outlineCache.get(spec);
    if (o) return o;
    const L = spec.wheelbase, fo = spec.frontOverhang, ro = spec.rearOverhang, w = spec.width / 2;
    const F = L + fo, Rr = -ro;
    const R = spec.minRadiusRear || 4.5;
    const cR = 1.15 / (2 * (R + w));
    const cF = 0.4 * cR;
    const fa = Math.min(0.62, 0.66 * fo), fb = Math.min(0.6, 0.64 * w);
    const ra = Math.min(0.6, 0.62 * ro), rb = Math.min(0.46, 0.5 * w);
    const corner = (d, a, b) => (d >= a ? 0 : b * (1 - Math.sqrt(1 - ((a - d) / a) ** 2)));
    const hw = (x) => {
      let y = w;
      if (x < 0) y -= cR * x * x;
      if (x > L) y -= cF * (x - L) ** 2;
      return y - corner(x - Rr, ra, rb) - corner(F - x, fa, fb);
    };
    // гуще у бамперов, где контур сильнее изогнут
    const xs = [];
    for (const k of [0, 0.03, 0.1, 0.22, 0.4, 0.65, 1]) xs.push(Rr + ra * k);
    xs.push(Rr / 2, 0, L, L + (F - fa - L) / 2);
    for (const k of [1, 0.65, 0.4, 0.22, 0.1, 0.03, 0]) xs.push(F - fa * k);
    const side = xs.map((x) => ({ x, y: Math.max(0.05, hw(x)) }));
    o = PA.geo.convexHull(side.concat(side.map((p) => ({ x: p.x, y: -p.y }))));
    outlineCache.set(spec, o);
    return o;
  }

  /** Зеркала (локально): база у основания стойки A, выступают на spec.mirror за борт. */
  function mirrors(spec) {
    const st = STYLES[spec.style] || STYLES.sedan;
    const F = spec.wheelbase + spec.frontOverhang, len = F + spec.rearOverhang, w = spec.width / 2;
    const xs = F - st.ws * len;
    const m = spec.mirror != null ? spec.mirror : 0.15;
    const inner = st.roofW * w * 0.98;
    const x0 = xs - 0.36;
    return [-1, 1].map((sg) => [
      { x: x0, y: sg * inner }, { x: x0 - 0.1, y: sg * (w + m * 0.75) }, { x: x0 - 0.17, y: sg * (w + m) },
      { x: x0 - 0.3, y: sg * (w + m * 0.9) }, { x: x0 - 0.3, y: sg * inner },
    ]);
  }

  /** Реальные «углы» кузова — вершины контура, ближайшие к углам габаритного прямоугольника. */
  function corners(spec) {
    const poly = outline(spec);
    const r = -spec.rearOverhang, f = spec.wheelbase + spec.frontOverhang, w = spec.width / 2;
    return [[r, -w], [f, -w], [f, w], [r, w]].map(([cx, cy]) => {
      let best = poly[0], bd = Infinity;
      for (const p of poly) {
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    });
  }

  /** Точка контура на бампере при заданном y (для датчиков парковки). */
  function bumperX(spec, y, front) {
    const poly = outline(spec);
    let best = front ? -Infinity : Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      best = front ? Math.max(best, x) : Math.min(best, x);
    }
    return Number.isFinite(best) ? best : (front ? spec.wheelbase + spec.frontOverhang : -spec.rearOverhang);
  }

  // ------------------------------------------------------------ припаркованные авто
  /** Параметры для объекта-машины сцены (длина w, ширина h, центр x/y). */
  function parkedSpec(o) {
    if (o._spec) return o._spec;
    const len = o.w, wid = o.h;
    const wheelbase = len * (o.style === 'van' ? 0.62 : o.style === 'micro' ? 0.7 : 0.6);
    const frontOverhang = len * (o.style === 'van' ? 0.18 : 0.205);
    o._spec = {
      length: len, width: wid, wheelbase, frontOverhang,
      rearOverhang: len - wheelbase - frontOverhang, track: wid - 0.25,
      minRadiusRear: len > 5.2 ? 5.4 : 4.4, style: o.style || 'sedan',
    };
    return o._spec;
  }

  function parkedPose(o, spec) {
    const back = len2(spec) / 2 - spec.rearOverhang;
    const a = o.a || 0;
    return { x: o.x - Math.cos(a) * back, y: o.y - Math.sin(a) * back, h: a };
  }

  const len2 = (s) => s.wheelbase + s.frontOverhang + s.rearOverhang;

  function parkedPoly(o) {
    const s = parkedSpec(o);
    return outline(s).map((p) => PA.kin.toWorld(parkedPose(o, s), p.x, p.y));
  }

  // ------------------------------------------------------------ отрисовка
  /** Сглаженный путь через вершины (квадратичные кривые через середины рёбер). */
  function smoothPath(c, pts) {
    const n = pts.length;
    const mid = (i) => ({ x: (pts[i].x + pts[(i + 1) % n].x) / 2, y: (pts[i].y + pts[(i + 1) % n].y) / 2 });
    const m0 = mid(n - 1);
    c.beginPath();
    c.moveTo(m0.x, m0.y);
    for (let i = 0; i < n; i++) {
      const m = mid(i);
      c.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
    }
    c.closePath();
  }

  function polyPath(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
  }

  /**
   * Рисует автомобиль. pose — центр задней оси в мире.
   * opts: color, style, brake, reverse, ghost, shadow (по умолчанию да).
   */
  function draw(c, spec, pose, opts = {}) {
    const st = STYLES[opts.style || spec.style] || STYLES.sedan;
    const color = opts.color || '#5d6675';
    const L = spec.wheelbase, w = spec.width / 2;
    const F = L + spec.frontOverhang, Rr = -spec.rearOverhang, len = F - Rr;
    const X = (t) => F - t * len; // доля длины от переднего бампера → x
    const out = outline(spec);

    c.save();
    c.translate(pose.x, pose.y);
    c.rotate(pose.h);
    if (opts.ghost) c.globalAlpha *= 0.55;

    // тень: свет сверху-слева экрана, смещение фиксировано в мире
    if (opts.shadow !== false) {
      const off = PA.geo.rot(0.07, 0.11, -pose.h);
      c.save();
      c.translate(off.x, off.y);
      c.fillStyle = 'rgba(0,0,0,0.22)';
      smoothPath(c, out.map((p) => ({ x: p.x * 1.02 + 0.02, y: p.y * 1.05 })));
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.28)';
      smoothPath(c, out);
      c.fill();
      c.restore();
    }

    // нижний пояс кузова (бамперы, пороги, арки) — затенён
    smoothPath(c, out);
    c.fillStyle = shade(color, -0.32);
    c.fill();
    c.save();
    c.clip();

    // верх кузова (плечо): уже на 4–5 см с каждой стороны
    const cx = (F + Rr) / 2, kx = (len / 2 - 0.035) / (len / 2), ky = (w - 0.045) / w;
    const upper = out.map((p) => ({ x: cx + (p.x - cx) * kx, y: p.y * ky }));
    const g = c.createLinearGradient(0, -w, 0, w);
    g.addColorStop(0, shade(color, -0.2));
    g.addColorStop(0.22, shade(color, 0.04));
    g.addColorStop(0.5, shade(color, 0.16));
    g.addColorStop(0.78, shade(color, 0.04));
    g.addColorStop(1, shade(color, -0.2));
    smoothPath(c, upper);
    c.fillStyle = g;
    c.fill();

    // выштамповки арок
    c.fillStyle = shade(color, 0.22);
    for (const ax of [0, L]) {
      for (const sg of [-1, 1]) {
        c.beginPath();
        c.ellipse(ax, sg * (w - 0.05), 0.46, 0.035, 0, 0, Math.PI * 2);
        c.globalAlpha *= 0.55;
        c.fill();
        c.globalAlpha /= 0.55;
      }
    }

    const xs = X(st.ws), xRF = X(st.roofF), xRR = X(st.roofR), xRW = X(st.rw);
    const gW = st.roofW * w;

    // капот: рёбра и блик
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 0.025;
    c.beginPath();
    for (const sg of [-1, 1]) {
      c.moveTo(F - 0.12, sg * w * 0.42);
      c.quadraticCurveTo((F + xs) / 2, sg * w * 0.34, xs + 0.06, sg * gW * 0.62);
    }
    c.stroke();

    // кузов пикапа
    if (st.bed) {
      const b0 = X(st.bed[1]), b1 = X(st.bed[0]);
      c.fillStyle = shade(color, -0.1);
      c.fillRect(b0, -w + 0.05, b1 - b0, 2 * w - 0.1);
      c.fillStyle = '#26292e';
      c.fillRect(b0 + 0.08, -w + 0.12, b1 - b0 - 0.14, 2 * w - 0.24);
      c.strokeStyle = 'rgba(255,255,255,0.06)';
      c.lineWidth = 0.03;
      c.beginPath();
      for (let y = -w + 0.3; y < w - 0.2; y += 0.22) { c.moveTo(b0 + 0.1, y); c.lineTo(b1 - 0.08, y); }
      c.stroke();
      c.fillStyle = shade(color, -0.25);
      c.fillRect(b0, -w + 0.05, 0.07, 2 * w - 0.1);
    }

    const pillars = st.bed ? [] : [xRF + (xRR - xRF) * 0.42];
    if (xRR - xRF > 2.2) pillars.push(xRF + (xRR - xRF) * 0.78);
    // остекление (под крышей видны боковые окна — кузов сужается вверх)
    const glass = c.createLinearGradient(xs, 0, xRW, 0);
    glass.addColorStop(0, '#1b2531');
    glass.addColorStop(1, '#0d131b');
    c.fillStyle = glass;
    c.beginPath();
    c.moveTo(xs, -gW * 1.04);
    c.quadraticCurveTo(xs + 0.12, 0, xs, gW * 1.04);
    c.lineTo(xRF, gW);
    c.lineTo(xRR, gW * 0.98);
    c.lineTo(xRW, gW * 0.9);
    c.quadraticCurveTo(xRW - 0.08, 0, xRW, -gW * 0.9);
    c.lineTo(xRR, -gW * 0.98);
    c.lineTo(xRF, -gW);
    c.closePath();
    c.fill();

    // блик на лобовом стекле
    const refl = c.createLinearGradient(xs, -gW, xRF, gW);
    refl.addColorStop(0, 'rgba(255,255,255,0)');
    refl.addColorStop(0.45, 'rgba(200,225,255,0.16)');
    refl.addColorStop(0.6, 'rgba(255,255,255,0)');
    c.fillStyle = refl;
    c.beginPath();
    c.moveTo(xs, -gW);
    c.quadraticCurveTo(xs + 0.11, 0, xs, gW);
    c.lineTo(xRF + 0.02, gW * 0.86);
    c.lineTo(xRF + 0.02, -gW * 0.86);
    c.closePath();
    c.fill();

    // крыша
    const roofG = c.createLinearGradient(0, -gW, 0, gW);
    roofG.addColorStop(0, shade(color, -0.05));
    roofG.addColorStop(0.5, shade(color, 0.22));
    roofG.addColorStop(1, shade(color, -0.05));
    c.fillStyle = spec.glassRoof ? '#121a24' : roofG;
    c.beginPath();
    c.moveTo(xRF, -gW * 0.84);
    c.quadraticCurveTo(xRF + 0.05, 0, xRF, gW * 0.84);
    c.lineTo(xRR, gW * 0.8);
    c.quadraticCurveTo(xRR - 0.04, 0, xRR, -gW * 0.8);
    c.closePath();
    c.fill();
    if (spec.glassRoof) {
      c.strokeStyle = shade(color, 0.1);
      c.lineWidth = 0.05;
      c.stroke();
    }

    // стойки B (и C у длинного остекления)
    c.fillStyle = shade(color, 0.05);
    for (const px of pillars) {
      c.fillRect(px - 0.05, -gW * 1.0, 0.1, gW * 0.2);
      c.fillRect(px - 0.05, gW * 0.8, 0.1, gW * 0.2);
    }

    // рейлинги и антенна
    if (st.rails) {
      c.strokeStyle = 'rgba(20,22,26,0.85)';
      c.lineWidth = 0.045;
      c.lineCap = 'round';
      c.beginPath();
      for (const sg of [-1, 1]) { c.moveTo(xRF - 0.12, sg * gW * 0.74); c.lineTo(xRR + 0.08, sg * gW * 0.72); }
      c.stroke();
      c.lineCap = 'butt';
    }
    if (!st.bed) {
      c.fillStyle = '#16191d';
      c.beginPath();
      c.ellipse(xRR + 0.13, 0, 0.09, 0.035, 0, 0, Math.PI * 2);
      c.fill();
    }

    // швы дверей и ручки на плечевом поясе
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 0.012;
    c.beginPath();
    const seams = st.bed ? [xs - 0.06, xRR] : st.label === 'Микро' ? [xs - 0.06, xRR - 0.1] : [xs - 0.06, pillars[0], Math.min(xRR + 0.05, 0.55)];
    for (const sx of seams) {
      for (const sg of [-1, 1]) { c.moveTo(sx, sg * gW * 1.02); c.lineTo(sx, sg * (w - 0.04)); }
    }
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (const sx of seams.slice(1)) {
      for (const sg of [-1, 1]) c.fillRect(sx - 0.22, sg * (w - 0.075) - 0.01, 0.12, 0.02);
    }

    // фары, решётка, номер
    c.fillStyle = '#1a1d22';
    c.fillRect(F - 0.07, -w * 0.4, 0.07, w * 0.8);
    for (const sg of [-1, 1]) {
      c.fillStyle = '#dfe6ee';
      polyPath(c, [[F, sg * w * 0.42], [F, sg * w * 1.05], [F - 0.3, sg * w * 1.05], [F - 0.16, sg * w * 0.72], [F - 0.06, sg * w * 0.45]]);
      c.fill();
      c.fillStyle = 'rgba(120,170,230,0.35)';
      polyPath(c, [[F - 0.05, sg * w * 0.55], [F - 0.04, sg * w * 0.9], [F - 0.16, sg * w * 0.92], [F - 0.1, sg * w * 0.62]]);
      c.fill();
    }
    c.fillStyle = '#e9e9e4';
    c.fillRect(F - 0.03, -0.26, 0.03, 0.52);

    // задние фонари
    const tail = opts.brake ? '#ff2b2b' : '#8e1515';
    for (const sg of [-1, 1]) {
      c.fillStyle = tail;
      polyPath(c, [[Rr, sg * w * 0.5], [Rr, sg * w * 1.05], [Rr + 0.24, sg * w * 1.05], [Rr + 0.12, sg * w * 0.82], [Rr + 0.05, sg * w * 0.5]]);
      c.fill();
      if (opts.reverse) {
        c.fillStyle = '#ffffff';
        c.fillRect(Rr, sg * w * 0.5 - (sg > 0 ? 0 : 0.12), 0.05, 0.12);
      }
    }
    c.fillStyle = '#e9e9e4';
    c.fillRect(Rr, -0.26, 0.03, 0.52);
    c.restore(); // clip

    // кромка кузова: тёмная линия и светлый кант, чтобы контур читался на любом фоне
    const tf = c.getTransform();
    const dpx = 1 / Math.hypot(tf.a, tf.b);
    smoothPath(c, out);
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = Math.max(0.02, 2.5 * dpx);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = Math.max(0.008, 1 * dpx);
    c.stroke();

    // зеркала — выступают за борт, как на виде сверху реальных авто
    for (const m of mirrors(spec)) {
      const sh = m.map((p) => ({ x: p.x - 0.04, y: p.y + 0.05 }));
      c.fillStyle = 'rgba(0,0,0,0.3)';
      smoothPath(c, sh);
      c.fill();
      const mg = c.createLinearGradient(m[0].x, 0, m[3].x, 0);
      mg.addColorStop(0, shade(color, 0.25));
      mg.addColorStop(1, shade(color, -0.15));
      c.fillStyle = mg;
      smoothPath(c, m);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = Math.max(0.012, 1.5 * dpx);
      c.stroke();
      // корпус зеркального элемента — тёмная задняя кромка
      c.strokeStyle = '#121418';
      c.lineWidth = Math.max(0.02, 2 * dpx);
      c.beginPath();
      c.moveTo(m[2].x - 0.02, m[2].y);
      c.lineTo(m[3].x + 0.01, m[3].y);
      c.stroke();
    }

    // свечение стоп-сигналов и света заднего хода
    if (opts.brake || opts.reverse) {
      const gl = c.createRadialGradient(Rr, 0, 0.1, Rr, 0, 1.6);
      gl.addColorStop(0, opts.reverse ? 'rgba(255,255,255,0.28)' : 'rgba(255,40,40,0.3)');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gl;
      c.beginPath();
      c.moveTo(Rr, -w);
      c.lineTo(Rr - 1.6, -w * 1.5);
      c.lineTo(Rr - 1.6, w * 1.5);
      c.lineTo(Rr, w);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  return { STYLES, shade, outline, mirrors, corners, bumperX, parkedSpec, parkedPose, parkedPoly, draw };
})();
