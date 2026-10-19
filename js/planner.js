/* Автоматический поиск манёвра парковки.
   Действие = фиксированное положение руля (прямо, ½, 1, 1½ оборота или до упора) + движение
   вперёд или назад на нужное расстояние. Ищем минимум действий, затем минимум пути.
   Схема: послойный перебор действий от текущей позы + точное «дотягивание» в центр места
   кривыми Ридса — Шеппа с радиусом одного из дискретных положений руля. */
window.PA = window.PA || {};

PA.planner = (function () {
  const PI = Math.PI, TWO = 2 * PI, ZERO = 1e-9;

  // ------------------------------------------------------------ Ридс — Шепп (радиус 1)
  // Формулы Reeds & Shepp (1990) в редакции OMPL; L — кривизна +1, R — −1, S — 0.
  const TYPES = [
    [1, -1, 1], [-1, 1, -1], [1, -1, 1, -1], [-1, 1, -1, 1],
    [1, -1, 0, 1], [-1, 1, 0, -1], [1, 0, -1, 1], [-1, 0, 1, -1],
    [1, -1, 0, -1], [-1, 1, 0, 1], [-1, 0, -1, 1], [1, 0, 1, -1],
    [1, 0, -1], [-1, 0, 1], [1, 0, 1], [-1, 0, -1],
    [1, -1, 0, 1, -1], [-1, 1, 0, -1, 1],
  ];
  const { sin, cos, atan2, sqrt } = Math;

  function mod2pi(x) {
    let v = x % TWO;
    if (v < -PI) v += TWO;
    else if (v > PI) v -= TWO;
    return v;
  }

  function tauOmega(u, v, xi, eta, phi) {
    const delta = mod2pi(u - v), A = sin(u) - sin(delta), B = cos(u) - cos(delta) - 1;
    const t1 = atan2(eta * A - xi * B, xi * A + eta * B), t2 = 2 * (cos(delta) - cos(v) - cos(u)) + 3;
    const tau = t2 < 0 ? mod2pi(t1 + PI) : mod2pi(t1);
    return [tau, mod2pi(tau - u + v - phi)];
  }

  function LpSpLp(x, y, phi) {
    const xi = x - sin(phi), eta = y - 1 + cos(phi);
    const u = Math.hypot(xi, eta), t = atan2(eta, xi);
    if (t >= -ZERO) {
      const v = mod2pi(phi - t);
      if (v >= -ZERO) return [t, u, v];
    }
    return null;
  }

  function LpSpRp(x, y, phi) {
    const xi = x + sin(phi), eta = y - 1 - cos(phi);
    const u1 = xi * xi + eta * eta, t1 = atan2(eta, xi);
    if (u1 >= 4) {
      const u = sqrt(u1 - 4), t = mod2pi(t1 + atan2(2, u)), v = mod2pi(t - phi);
      if (t >= -ZERO && v >= -ZERO) return [t, u, v];
    }
    return null;
  }

  function LpRmL(x, y, phi) {
    const xi = x - sin(phi), eta = y - 1 + cos(phi);
    const u1 = Math.hypot(xi, eta), theta = atan2(eta, xi);
    if (u1 <= 4) {
      const u = -2 * Math.asin(0.25 * u1), t = mod2pi(theta + 0.5 * u + PI), v = mod2pi(phi - t + u);
      if (t >= -ZERO && u <= ZERO) return [t, u, v];
    }
    return null;
  }

  function LpRupLumRm(x, y, phi) {
    const xi = x + sin(phi), eta = y - 1 - cos(phi), rho = 0.25 * (2 + Math.hypot(xi, eta));
    if (rho <= 1) {
      const u = Math.acos(rho), [t, v] = tauOmega(u, -u, xi, eta, phi);
      if (t >= -ZERO && v <= ZERO) return [t, u, v];
    }
    return null;
  }

  function LpRumLumRp(x, y, phi) {
    const xi = x + sin(phi), eta = y - 1 - cos(phi), rho = (20 - xi * xi - eta * eta) / 16;
    if (rho >= 0 && rho <= 1) {
      const u = -Math.acos(rho);
      if (u >= -0.5 * PI) {
        const [t, v] = tauOmega(u, u, xi, eta, phi);
        if (t >= -ZERO && v >= -ZERO) return [t, u, v];
      }
    }
    return null;
  }

  function LpRmSmLm(x, y, phi) {
    const xi = x - sin(phi), eta = y - 1 + cos(phi);
    const rho = Math.hypot(xi, eta), theta = atan2(eta, xi);
    if (rho >= 2) {
      const r = sqrt(rho * rho - 4), u = 2 - r, t = mod2pi(theta + atan2(r, -2)), v = mod2pi(phi - 0.5 * PI - t);
      if (t >= -ZERO && u <= ZERO && v <= ZERO) return [t, u, v];
    }
    return null;
  }

  function LpRmSmRm(x, y, phi) {
    const xi = x + sin(phi), eta = y - 1 - cos(phi);
    const rho = Math.hypot(-eta, xi), theta = atan2(xi, -eta);
    if (rho >= 2) {
      const t = theta, u = 2 - rho, v = mod2pi(t + 0.5 * PI - phi);
      if (t >= -ZERO && u <= ZERO && v <= ZERO) return [t, u, v];
    }
    return null;
  }

  function LpRmSLmRp(x, y, phi) {
    const xi = x + sin(phi), eta = y - 1 - cos(phi), rho = Math.hypot(xi, eta);
    if (rho >= 2) {
      const u = 4 - sqrt(rho * rho - 4);
      if (u <= ZERO) {
        const t = mod2pi(atan2((4 - u) * xi - 2 * eta, -2 * xi + (u - 4) * eta)), v = mod2pi(t - phi);
        if (t >= -ZERO && v >= -ZERO) return [t, u, v];
      }
    }
    return null;
  }

  /** Все допустимые слова Ридса — Шеппа из (0,0,0) в (x,y,phi): [{ type, lens }]. */
  function rsCandidates(x, y, phi) {
    const out = [];
    // исходная задача, обращение времени, отражение, обращение+отражение
    const four = (fn, X, Y, tA, tB, map) => {
      let r;
      if ((r = fn(X, Y, phi))) out.push({ type: tA, lens: map(r, 1) });
      if ((r = fn(-X, Y, -phi))) out.push({ type: tA, lens: map(r, -1) });
      if ((r = fn(X, -Y, -phi))) out.push({ type: tB, lens: map(r, 1) });
      if ((r = fn(-X, -Y, phi))) out.push({ type: tB, lens: map(r, -1) });
    };
    const xb = x * cos(phi) + y * sin(phi), yb = x * sin(phi) - y * cos(phi);
    const tuv = ([t, u, v], k) => [k * t, k * u, k * v];
    const vut = ([t, u, v], k) => [k * v, k * u, k * t];
    const h = PI / 2;
    four(LpSpLp, x, y, 14, 15, tuv);
    four(LpSpRp, x, y, 12, 13, tuv);
    four(LpRmL, x, y, 0, 1, tuv);
    four(LpRmL, xb, yb, 0, 1, vut);
    four(LpRupLumRm, x, y, 2, 3, ([t, u, v], k) => [k * t, k * u, -k * u, k * v]);
    four(LpRumLumRp, x, y, 2, 3, ([t, u, v], k) => [k * t, k * u, k * u, k * v]);
    four(LpRmSmLm, x, y, 4, 5, ([t, u, v], k) => [k * t, -k * h, k * u, k * v]);
    four(LpRmSmRm, x, y, 8, 9, ([t, u, v], k) => [k * t, -k * h, k * u, k * v]);
    four(LpRmSmLm, xb, yb, 6, 7, ([t, u, v], k) => [k * v, k * u, -k * h, k * t]);
    four(LpRmSmRm, xb, yb, 10, 11, ([t, u, v], k) => [k * v, k * u, -k * h, k * t]);
    four(LpRmSLmRp, x, y, 16, 17, ([t, u, v], k) => [k * t, -k * h, k * u, -k * h, k * v]);
    return out;
  }

  // ------------------------------------------------------------ модель руля
  /** Положительные дискретные положения руля (рад): ½, 1, 1½ оборота и упор, если он дальше. */
  function wheelLevels(spec) {
    const max = spec.maxWheelAngle, lv = [];
    for (const t of [0.5, 1, 1.5]) if (t * TWO <= max + 1e-6) lv.push(t * TWO);
    if (max - (lv[lv.length - 1] || 0) > PA.geo.rad(15)) lv.push(max);
    return lv;
  }

  function model(spec) {
    const levels = wheelLevels(spec);
    const wheel = (lv) => (lv === 0 ? 0 : Math.sign(lv) * levels[Math.abs(lv) - 1]);
    const steer = (lv) => (wheel(lv) / spec.maxWheelAngle) * spec.maxSteer;
    const kappa = (lv) => Math.tan(steer(lv)) / spec.wheelbase;
    return { levels, wheel, steer, kappa };
  }

  // ------------------------------------------------------------ проверки
  /** Кузов, раздутый на margin, для поиска с запасом до препятствий. */
  function inflate(spec, m) {
    return { ...spec, width: spec.width + 2 * m, length: spec.length + 2 * m,
      frontOverhang: spec.frontOverhang + m, rearOverhang: spec.rearOverhang + m };
  }

  function makeChecker(world, spec, margin, poses) {
    const big = inflate(spec, margin);
    const solids = world.solids();
    // с чем раздутый кузов соприкасается уже на старте или в цели — проверяем без запаса
    const soft = new Set();
    for (const p of poses) for (const o of world.hits(big, p, 0)) soft.add(o);
    const softList = [...soft];
    return (pose, steer) =>
      world.scan(big, pose, steer, soft, solids, true).length > 0 ||
      (softList.length > 0 && world.scan(spec, pose, steer, null, softList, true).length > 0);
  }

  /** Длина пути со штрафом за отрезки короче 30 см — их неудобно выполнять. */
  function cost(segs) {
    return segs.reduce((a, x) => a + x.dist + (x.dist < 0.3 ? 3 : 0), 0);
  }

  function merge(segs) {
    const out = [];
    for (const s of segs) {
      const l = out[out.length - 1];
      if (l && l.lv === s.lv && l.dir === s.dir) l.dist += s.dist;
      else out.push({ ...s });
    }
    return out;
  }

  // ------------------------------------------------------------ точные «парковочные» семейства
  /**
   * Слова, начинающиеся с прямого отрезка (их нет среди Ридса — Шеппа):
   *   S C S — прямо, дуга, прямо по оси места (перпендикулярная, гараж, ёлочка);
   *   S C C — прямо, две дуги (параллельная: «назад вправо, назад влево»).
   * Длины непрерывные, радиусы — из дискретных положений руля. Каждый отрезок со своим направлением.
   */
  function familyCandidates(P, G, M) {
    const out = [];
    const n = M.levels.length;
    const u0 = { x: cos(P.h), y: sin(P.h) }, ug = { x: cos(G.h), y: sin(G.h) };
    const dGx = G.x - P.x, dGy = G.y - P.y;
    const delta = PA.geo.normAngle(G.h - P.h);
    const seg = (lv, l) => ({ lv, dir: Math.sign(l), dist: Math.abs(l) });
    const push = (list) => out.push(list.filter((x) => x.dist > 1e-3));

    // S C S: дуга поворачивает ровно на delta, прямые находятся из линейной системы 2×2
    const det = u0.x * ug.y - u0.y * ug.x;
    if (Math.abs(delta) > 1e-3 && Math.abs(det) > 1e-6) {
      for (let lv = -n; lv <= n; lv++) {
        if (!lv) continue;
        const k = M.kappa(lv), a = delta / k;
        const d = PA.kin.advance({ x: 0, y: 0, h: P.h }, k, a);
        const Dx = dGx - d.x, Dy = dGy - d.y;
        const s1 = (Dx * ug.y - Dy * ug.x) / det, s3 = (u0.x * Dy - u0.y * Dx) / det;
        push([seg(0, s1), seg(lv, a), seg(0, s3)]);
      }
    }

    // S C C: длина первой дуги — корень уравнения по нормали к прямой, вторая — из курса
    const nx = -u0.y, ny = u0.x, target = nx * dGx + ny * dGy;
    for (let i = -n; i <= n; i++) {
      if (!i) continue;
      const k1 = M.kappa(i);
      for (let j = -n; j <= n; j++) {
        if (!j || Math.sign(j) === Math.sign(i)) continue;
        const k2 = M.kappa(j);
        const end = (a2) => {
          const p1 = PA.kin.advance({ x: 0, y: 0, h: P.h }, k1, a2);
          return PA.kin.advance(p1, k2, (delta - k1 * a2) / k2);
        };
        const f = (a2) => { const e = end(a2); return nx * e.x + ny * e.y - target; };
        const lim = PI / Math.abs(k1), N = 32;
        let pa = -lim, pf = f(pa);
        for (let m = 1; m <= N; m++) {
          const ca = -lim + (2 * lim * m) / N, cf = f(ca);
          if (pf * cf <= 0 && Number.isFinite(pf) && Number.isFinite(cf)) {
            let lo = pa, hi = ca, flo = pf;
            for (let it = 0; it < 30; it++) {
              const mid = (lo + hi) / 2, fm = f(mid);
              if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
            }
            const a2 = (lo + hi) / 2, e = end(a2);
            const s1 = u0.x * (dGx - e.x) + u0.y * (dGy - e.y);
            push([seg(0, s1), seg(i, a2), seg(j, (delta - k1 * a2) / k2)]);
          }
          pa = ca; pf = cf;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ поиск
  const MAX_DIST = 11, MAX_STRAIGHT = 30, MAX_ACTIONS = 6;
  // мелкий шаг вблизи (доводки в тесноте), дальше крупнее
  const DISTS = [];
  for (let d = 0.15; d < 2; d += 0.15) DISTS.push(d);
  for (let d = 2; d <= MAX_STRAIGHT; d += 0.4) DISTS.push(d);
  const CAPS = [1, 500, 220, 120, 80, 60, 40];

  function* layered(world, spec, M, start, goals, margin, state, maxActions) {
    const check = makeChecker(world, spec, margin, [start, ...goals]);
    goals = goals.filter((g) => !check(g, 0));
    if (!goals.length || check(start, 0)) return null;
    const adv = PA.kin.advance;
    const n = M.levels.length;
    let best = null;
    const better = (a, len) => !best || a < best.actions || (a === best.actions && len < best.length - 1e-6);

    function pathFree(pose, segs) {
      for (const step of [0.5, 0.1]) {
        let p = pose;
        for (const s of segs) {
          const k = M.kappa(s.lv), st = M.steer(s.lv), cnt = Math.max(1, Math.ceil(s.dist / step));
          for (let i = 1; i <= cnt; i++) if (check(adv(p, k, (s.dir * s.dist * i) / cnt), st)) return false;
          p = adv(p, k, s.dir * s.dist);
        }
      }
      return true;
    }

    function connect(node) {
      const cands = [];
      for (const g of goals) {
        const c = cos(node.pose.h), s = sin(node.pose.h);
        const dx = g.x - node.pose.x, dy = g.y - node.pose.y;
        for (let i = 1; i <= n; i++) {
          const R = 1 / Math.abs(M.kappa(i));
          for (const w of rsCandidates((c * dx + s * dy) / R, (-s * dx + c * dy) / R, g.h - node.pose.h)) {
            const segs = [];
            let len = 0;
            w.lens.forEach((l, j) => {
              const d = Math.abs(l) * R;
              if (d < 1e-3) return;
              segs.push({ lv: TYPES[w.type][j] * i, dir: Math.sign(l), dist: d });
              len += d;
            });
            const total = merge(node.segs.concat(segs));
            const length = cost(total) + g.penalty;
            if (!better(total.length, length)) continue;
            cands.push({ segs, total, length });
          }
        }
      }
      for (const g of goals) {
        for (const segs of familyCandidates(node.pose, g, M)) {
          const total = merge(node.segs.concat(segs));
          const length = cost(total) + g.penalty;
          if (better(total.length, length)) cands.push({ segs, total, length });
        }
      }
      cands.sort((a, b) => a.total.length - b.total.length || a.length - b.length);
      for (const c of cands) {
        if (!better(c.total.length, c.length)) continue;
        // защита от численных ошибок: путь обязан приходить в цель
        let p = node.pose;
        for (const s of c.segs) p = adv(p, M.kappa(s.lv), s.dir * s.dist);
        if (!goals.some((g) => Math.hypot(p.x - g.x, p.y - g.y) < 0.01 && Math.abs(PA.geo.normAngle(p.h - g.h)) < 0.01)) continue;
        if (pathFree(node.pose, c.segs)) {
          best = { actions: c.total.length, length: c.length, segs: c.total, end: p, margin };
          state.best = best;
        }
      }
    }

    const heur = (p) => Math.min(...goals.map((g) => Math.hypot(p.x - g.x, p.y - g.y) +
      1.5 * Math.abs(PA.geo.normAngle(p.h - g.h))));
    const key = (p) => `${Math.round(p.x / 0.2)},${Math.round(p.y / 0.2)},${Math.round(PA.geo.normAngle(p.h) / PA.geo.rad(5))}`;
    const seen = new Set([key(start)]);
    let layer = [{ pose: start, segs: [], len: 0 }];

    for (let k = 0; k <= maxActions; k++) {
      for (const node of layer) {
        connect(node);
        yield;
      }
      // узел слоя k + хотя бы одно новое действие даст не меньше k + 1
      if (best && best.actions <= k + 1) break;
      if (k === maxActions) break;
      const next = [];
      for (const node of layer) {
        const last = node.segs[node.segs.length - 1];
        for (let lv = -n; lv <= n; lv++) {
          const kk = M.kappa(lv), st = M.steer(lv);
          for (const dir of [1, -1]) {
            if (last && last.lv === lv && last.dir === dir) continue;
            let prev = 0;
            for (const d of DISTS) {
              if (d > (lv ? MAX_DIST : MAX_STRAIGHT) || Math.abs(kk) * d > TWO) break;
              const q = adv(node.pose, kk, dir * d);
              const mid = adv(node.pose, kk, dir * (d + prev) / 2);
              prev = d;
              if (check(mid, st) || check(q, st)) break;
              const kq = key(q);
              if (seen.has(kq)) continue;
              seen.add(kq);
              next.push({ pose: q, segs: node.segs.concat([{ lv, dir, dist: d }]), len: node.len + d, h: heur(q) });
            }
          }
        }
        yield;
      }
      next.sort((a, b) => a.h - b.h);
      layer = next.slice(0, CAPS[k + 1]);
      if (!layer.length) break;
    }
    return best;
  }

  /** Позы цели: центр машины в центре места; для «любым ходом» — оба направления. */
  function goalPoses(spec, goal) {
    const off = (spec.wheelbase + spec.frontOverhang - spec.rearOverhang) / 2;
    const a = goal.a || 0;
    // место «любым ходом»: задом предпочтительнее (лучше обзор при выезде) — заезд передом штрафуем
    const heads = goal.bidir ? [[a + PI, 0], [a, 4]] : [[a, 0]];
    const at = ([h, penalty], shift) => {
      const cx = goal.x + cos(a) * shift, cy = goal.y + sin(a) * shift;
      return { x: cx - cos(h) * off, y: cy - sin(h) * off, h: PA.geo.normAngle(h), penalty };
    };
    const exact = heads.map((h) => at(h, 0));
    const shifted = [];
    for (const sh of [0.15, -0.15, 0.3, -0.3]) for (const h of heads) shifted.push(at(h, sh));
    return [exact, shifted];
  }

  function* search(world, spec, start, goal, state) {
    const M = model(spec);
    const [exact, shifted] = goalPoses(spec, goal);
    // сначала точно в центр с запасом 10 см и коротким планом; затем меньше запас, длиннее план, сдвиг вдоль места
    const passes = [[exact, 0.1, 4], [exact, 0.05, 4], [exact, 0.1, MAX_ACTIONS], [exact, 0.02, MAX_ACTIONS],
      [shifted, 0.05, MAX_ACTIONS], [shifted, 0.02, MAX_ACTIONS]];
    for (const [goals, margin, maxA] of passes) {
      const r = yield* layered(world, spec, M, start, goals, margin, state, maxA);
      if (r) return r;
    }
    return null;
  }

  /**
   * Запускает поиск кусками, не блокируя интерфейс. onDone(plan | null).
   * Возвращает функцию отмены.
   */
  function plan(world, spec, start, goal, onDone, limitMs = 9000) {
    const state = { best: null };
    const it = search(world, spec, { x: start.x, y: start.y, h: start.h }, goal, state);
    const t0 = performance.now();
    let cancelled = false;
    const finish = (best) => onDone(best ? describe(spec, start, best) : null, performance.now() - t0);
    function tick() {
      if (cancelled) return;
      const until = performance.now() + 12;
      while (performance.now() < until) {
        const r = it.next();
        if (r.done) { finish(r.value); return; }
      }
      if (performance.now() - t0 > limitMs) { it.return(); finish(state.best); return; }
      setTimeout(tick, 0);
    }
    setTimeout(tick, 0);
    return () => { cancelled = true; };
  }

  /** План для показа и исполнения: шаги с углом руля, позы концов шагов. */
  function describe(spec, start, best) {
    const M = model(spec);
    let p = { x: start.x, y: start.y, h: start.h };
    const steps = best.segs.map((s) => {
      const from = p;
      p = PA.kin.advance(p, M.kappa(s.lv), s.dir * s.dist);
      return { ...s, wheel: M.wheel(s.lv), kappa: M.kappa(s.lv), from, to: p, text: stepText(s, M, spec) };
    });
    const length = best.segs.reduce((a, x) => a + x.dist, 0);
    return { steps, actions: best.actions, length, margin: best.margin, start, end: p };
  }

  function wheelText(lv, M, spec) {
    if (lv === 0) return 'руль прямо';
    const a = M.levels[Math.abs(lv) - 1], turns = a / TWO;
    const side = lv > 0 ? 'вправо' : 'влево';
    const names = { 0.5: '½ оборота', 1: '1 оборот', 1.5: '1½ оборота' };
    const name = names[Math.round(turns * 2) / 2];
    if (Math.abs(turns * 2 - Math.round(turns * 2)) > 1e-3 || !name) return `руль до упора ${side} (${turns.toFixed(2)} об.)`;
    return `руль ${name} ${side}`;
  }

  function stepText(s, M, spec) {
    return { wheel: wheelText(s.lv, M, spec), move: `${s.dir > 0 ? 'вперёд' : 'назад'} ${s.dist.toFixed(2)} м` };
  }

  return { plan, rsCandidates, wheelLevels, TYPES };
})();
