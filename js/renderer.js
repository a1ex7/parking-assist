/* Отрисовка сцены на canvas: вид сверху, как в системах кругового обзора. */
window.PA = window.PA || {};

PA.Renderer = class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.cam = { x: 0, y: 0, scale: 40, rot: 0 };
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = this.layer.width = Math.round(r.width * this.dpr);
    this.canvas.height = this.layer.height = Math.round(r.height * this.dpr);
  }

  applyCam(ctx) {
    const { cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.w / 2, this.h / 2);
    ctx.rotate(cam.rot);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);
  }

  screenToWorld(sx, sy) {
    const { cam } = this;
    const p = PA.geo.rot((sx - this.w / 2) / cam.scale, (sy - this.h / 2) / cam.scale, -cam.rot);
    return { x: p.x + cam.x, y: p.y + cam.y };
  }

  fit(b, pad = 1.5) {
    const bw = b.maxX - b.minX + pad * 2, bh = b.maxY - b.minY + pad * 2;
    this.cam.x = (b.minX + b.maxX) / 2;
    this.cam.y = (b.minY + b.maxY) / 2;
    this.cam.rot = 0;
    this.cam.scale = PA.geo.clamp(Math.min(this.w / bw, this.h / bh), 6, 200);
  }

  visibleBounds() {
    const pts = [[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]].map(([x, y]) => this.screenToWorld(x, y));
    return PA.geo.bbox(pts);
  }

  // ------------------------------------------------------------------ кадр
  draw(st) {
    const { ctx } = this;
    const px = 1 / this.cam.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#25282d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyCam(ctx);

    this.drawGrid(px);
    const objs = st.world.objects;
    for (const o of objs) if (o.type === 'sidewalk' || o.type === 'grass') this.drawArea(o);
    for (const o of objs) if (o.type === 'line') this.drawRect(o, PA.TYPES.line.color);
    for (const o of objs) if (o.type === 'goal') this.drawGoal(o, st.goalState, px);
    if (st.opts.trail && st.trail.length > 1) this.drawTrail(st.trail, px);
    if (!st.editing && st.plan) this.drawPlan(st.car.spec, st.plan, st.planIdx, px);

    if (!st.editing) {
      if (st.opts.extremes) for (const p of st.extremes) this.drawGhost(st.car.spec, p, px);
      if (st.opts.both && st.backPath) this.drawPath(st.car.spec, st.backPath, px, true, st.opts);
      if (st.path) this.drawPath(st.car.spec, st.path, px, false, st.opts);
    }

    for (const o of objs) if (PA.TYPES[o.type]?.solid) this.drawObstacle(o, px, st.hitSet && st.hitSet.has(o));
    this.drawPlayer(st.car, st, px);
    if (!st.editing && st.opts.sensors && st.sensors) this.drawSensors(st.sensors, px);
    if (!st.editing && st.opts.center) this.drawTurnCenter(st.car, px);
    if (st.editing) this.drawEditor(st, px);

    this.drawScale();
  }

  drawGrid(px) {
    const { ctx } = this;
    const b = this.visibleBounds();
    const fine = this.cam.scale > 14;
    ctx.lineWidth = px;
    ctx.beginPath();
    if (fine) {
      for (let x = Math.floor(b.minX); x <= b.maxX; x++) if (x % 5) { ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY); }
      for (let y = Math.floor(b.minY); y <= b.maxY; y++) if (y % 5) { ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y); }
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.stroke();
    }
    ctx.beginPath();
    for (let x = Math.floor(b.minX / 5) * 5; x <= b.maxX; x += 5) { ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY); }
    for (let y = Math.floor(b.minY / 5) * 5; y <= b.maxY; y += 5) { ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y); }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.stroke();
  }

  withObj(o, fn) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.a || 0);
    fn(ctx);
    ctx.restore();
  }

  drawRect(o, color) {
    this.withObj(o, (c) => {
      c.fillStyle = color;
      c.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
    });
  }

  drawArea(o) {
    this.withObj(o, (c) => {
      c.fillStyle = PA.TYPES[o.type].color;
      c.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
      if (o.type === 'sidewalk') {
        c.strokeStyle = 'rgba(255,255,255,0.04)';
        c.lineWidth = 0.02;
        c.beginPath();
        for (let x = -o.w / 2; x <= o.w / 2; x += 0.5) { c.moveTo(x, -o.h / 2); c.lineTo(x, o.h / 2); }
        for (let y = -o.h / 2; y <= o.h / 2; y += 0.5) { c.moveTo(-o.w / 2, y); c.lineTo(o.w / 2, y); }
        c.stroke();
      }
    });
  }

  drawGoal(o, gs, px) {
    const ok = gs && gs.ok;
    this.withObj(o, (c) => {
      c.fillStyle = ok ? 'rgba(52,211,153,0.32)' : 'rgba(52,211,153,0.10)';
      c.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
      c.setLineDash([0.3, 0.2]);
      c.lineWidth = Math.max(0.05, 2 * px);
      c.strokeStyle = ok ? '#34d399' : 'rgba(52,211,153,0.7)';
      c.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
      c.setLineDash([]);
      // стрелка курса
      c.strokeStyle = 'rgba(52,211,153,0.45)';
      c.lineWidth = 0.08;
      c.beginPath();
      const l = Math.min(o.w, 2.4) / 2;
      c.moveTo(-l, 0); c.lineTo(l, 0);
      c.moveTo(l - 0.35, -0.3); c.lineTo(l, 0); c.lineTo(l - 0.35, 0.3);
      if (o.bidir) { c.moveTo(-l + 0.35, -0.3); c.lineTo(-l, 0); c.lineTo(-l + 0.35, 0.3); }
      c.stroke();
    });
  }

  drawTrail(trail, px) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (const p of trail) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(167,139,250,0.55)';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ------------------------------------------------------------ траектории
  pathColor(dir) { return dir > 0 ? [34, 211, 238] : [251, 191, 36]; }

  drawPath(spec, path, px, secondary, opts) {
    const { ctx, lctx } = this;
    const [r, g, b] = this.pathColor(path.dir);
    const hitS = path.hitS;
    const safe = path.poses.filter((p) => hitS == null || p.s <= hitS);
    const blocked = hitS == null ? [] : path.poses.filter((p) => p.s >= hitS);
    if (hitS != null) safe.push({ s: hitS, ...path.hitPose });

    if (opts.fill) {
      // объединение силуэтов кузова — заметаемая область
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, this.layer.width, this.layer.height);
      this.applyCam(lctx);
      const fillPoses = (list, color) => {
        lctx.fillStyle = color;
        lctx.beginPath();
        for (const p of list) {
          const poly = PA.kin.bodyPoly(spec, p);
          lctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) lctx.lineTo(poly[i].x, poly[i].y);
          lctx.closePath();
        }
        lctx.fill('nonzero');
      };
      if (blocked.length && !secondary) fillPoses(blocked, '#ef4444');
      fillPoses(safe, `rgb(${r},${g},${b})`);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = secondary ? 0.08 : 0.24;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }

    const line = (list, fn, color, width, dash) => {
      if (list.length < 2) return;
      ctx.beginPath();
      list.forEach((p, i) => {
        const q = fn(p);
        if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
      ctx.setLineDash(dash ? dash.map((d) => d * px) : []);
      ctx.stroke();
    };
    const alpha = secondary ? 0.35 : 0.95;
    const col = `rgba(${r},${g},${b},${alpha})`;
    // траектории углов кузова — границы коридора
    for (let k = 0; k < 4; k++) {
      line(safe, (p) => PA.kin.corners(spec, p)[k], col, secondary ? 1 : 2);
      if (!secondary && blocked.length) line(blocked, (p) => PA.kin.corners(spec, p)[k], 'rgba(239,68,68,0.6)', 1.5, [5, 4]);
    }
    if (secondary) return;

    // колеи колёс
    if (opts.wheels) {
      for (let k = 0; k < 4; k++) {
        line(safe, (p) => PA.kin.wheels(spec, p, 0)[k], 'rgba(255,255,255,0.55)', 1.2, [4, 4]);
      }
    }

    // поперечные метки расстояния от бампера (как на камерах: 0.5 / 1 / 2 / 3 м)
    if (opts.marks) {
      const marks = [[0.5, '#ef4444'], [1, '#fbbf24'], [2, '#22c55e'], [3, '#22c55e']];
      ctx.setLineDash([]);
      for (const [s, color] of marks) {
        if (s > path.length) break;
        const blockedMark = hitS != null && s > hitS;
        const p = path.at(s);
        const cs = PA.kin.corners(spec, p);
        const [a, b2] = path.dir > 0 ? [cs[1], cs[2]] : [cs[0], cs[3]];
        ctx.strokeStyle = blockedMark ? 'rgba(239,68,68,0.35)' : color;
        ctx.lineWidth = 3 * px;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.stroke();
        this.label(`${s} м`, b2.x, b2.y, px, blockedMark ? 'rgba(239,68,68,0.6)' : color, 10);
      }
    }

    // точка удара
    if (path.hitPose) {
      const poly = PA.kin.bodyPoly(spec, path.hitPose);
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.stroke();
      ctx.setLineDash([]);
      const cs = PA.kin.corners(spec, path.hitPose);
      const [a, b2] = path.dir > 0 ? [cs[1], cs[2]] : [cs[0], cs[3]];
      const mx = (a.x + b2.x) / 2, my = (a.y + b2.y) / 2;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(mx, my, 7 * px, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(mx - 3 * px, my - 3 * px); ctx.lineTo(mx + 3 * px, my + 3 * px);
      ctx.moveTo(mx + 3 * px, my - 3 * px); ctx.lineTo(mx - 3 * px, my + 3 * px);
      ctx.stroke();
      this.label(`${path.hitS.toFixed(2)} м`, mx, my - 16 * px, px, '#fecaca', 12, true);
    }
  }

  /** Контур крайней траектории (полный выворот руля) — без заливки. */
  drawGhost(spec, path, px) {
    const { ctx } = this;
    const [r, g, b] = this.pathColor(path.dir);
    ctx.setLineDash([3 * px, 5 * px]);
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
    for (const k of [0, 1, 2, 3]) {
      ctx.beginPath();
      path.poses.forEach((p, i) => {
        const q = PA.kin.corners(spec, p)[k];
        if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** План автопарковки: путь задней оси, силуэты в точках смены действия, итоговая поза. */
  drawPlan(spec, plan, idx, px) {
    const { ctx } = this;
    const outline = (pose) => {
      const poly = PA.kin.bodyPoly(spec, pose);
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    };
    plan.steps.forEach((s, i) => {
      const [r, g, b] = this.pathColor(s.dir);
      const n = Math.max(2, Math.ceil(s.dist / 0.15));
      ctx.beginPath();
      for (let j = 0; j <= n; j++) {
        const p = PA.kin.advance(s.from, s.kappa, (s.dir * s.dist * j) / n);
        if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = `rgba(${r},${g},${b},${i < idx ? 0.25 : 0.95})`;
      ctx.lineWidth = 3 * px;
      ctx.setLineDash(i === idx ? [] : [8 * px, 5 * px]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (i >= idx && i < plan.steps.length - 1) {
        outline(s.to);
        ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    outline(plan.end);
    ctx.fillStyle = 'rgba(52,211,153,0.12)';
    ctx.fill();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2 * px;
    ctx.stroke();
    // номера шагов у начала каждого действия
    plan.steps.forEach((s, i) => {
      if (i < idx) return;
      ctx.beginPath();
      ctx.arc(s.from.x, s.from.y, 9 * px, 0, Math.PI * 2);
      ctx.fillStyle = i === idx ? '#f8fafc' : 'rgba(30,33,39,0.9)';
      ctx.fill();
      ctx.strokeStyle = s.dir > 0 ? '#22d3ee' : '#fbbf24';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      this.label(String(i + 1), s.from.x, s.from.y, px, i === idx ? '#111' : '#f8fafc', 11);
    });
  }

  label(text, x, y, px, color, size = 11, boxed = false) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-this.cam.rot);
    ctx.scale(px, px);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (boxed) {
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = 'rgba(127,29,29,0.9)';
      ctx.fillRect(-w / 2, -size * 0.8, w, size * 1.6);
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // ------------------------------------------------------------ препятствия
  drawObstacle(o, px, hit) {
    const t = PA.TYPES[o.type];
    const { ctx } = this;
    if (o.type === 'car') {
      const spec = PA.carArt.parkedSpec(o);
      PA.carArt.draw(ctx, spec, PA.carArt.parkedPose(o, spec), { color: o.color || t.color, style: o.style });
    } else if (t.round) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.w / 2, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      if (o.type === 'cone') {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.w / 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.w / 8, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.fill();
      } else {
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#1f1f1f';
        ctx.stroke();
      }
    } else {
      this.withObj(o, (c) => {
        c.fillStyle = o.color || t.color;
        c.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
        if (o.type === 'fence') {
          c.fillStyle = '#6b4a2b';
          for (let x = -o.w / 2; x <= o.w / 2 + 1e-6; x += 2) c.fillRect(x - 0.06, -0.08, 0.12, 0.16);
        } else if (o.type === 'pillar') {
          c.strokeStyle = '#f2c94c';
          c.lineWidth = 0.06;
          c.strokeRect(-o.w / 2 + 0.03, -o.h / 2 + 0.03, o.w - 0.06, o.h - 0.06);
        } else if (o.type === 'curb') {
          c.fillStyle = 'rgba(0,0,0,0.12)';
          for (let x = -o.w / 2; x < o.w / 2; x += 1) c.fillRect(x, -o.h / 2, 0.03, o.h);
        } else {
          c.lineWidth = px;
          c.strokeStyle = 'rgba(0,0,0,0.4)';
          c.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
        }
      });
    }
    if (hit) {
      const poly = this.polyFor(o);
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3 * px;
      ctx.stroke();
    }
  }

  polyFor(o) {
    if (o.type === 'car') return PA.carArt.parkedPoly(o);
    return PA.TYPES[o.type].round ? PA.geo.circlePoly(o.x, o.y, o.w / 2) : PA.geo.rectPoly(o.x, o.y, o.w, o.h, o.a || 0);
  }

  roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  drawPlayer(car, st, px) {
    const s = car.spec;
    const { ctx } = this;
    // колёса под кузовом: при повороте видны края шин, выступающие из арок
    for (const w of PA.kin.wheels(s, car.pose, car.steer)) {
      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.a);
      ctx.fillStyle = '#0d0e10';
      this.roundRect(ctx, -0.33, -0.11, 0.66, 0.22, 0.06);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      for (const x of [-0.2, -0.07, 0.07, 0.2]) { ctx.moveTo(x, -0.11); ctx.lineTo(x, 0.11); }
      ctx.stroke();
      ctx.restore();
    }
    PA.carArt.draw(ctx, s, car.pose, {
      color: st.opts.carColor || '#2563eb', brake: st.braking, reverse: car.gear === 'R',
      shadow: true,
    });
    if (st.colliding) {
      const poly = PA.kin.bodyPoly(s, car.pose);
      ctx.beginPath();
      poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3 * px;
      ctx.stroke();
    }
  }

  drawSensors(list, px) {
    const { ctx } = this;
    const colors = ['#ef4444', '#fbbf24', '#22c55e'];
    for (const s of list) {
      if (s.dist == null) continue;
      const z = PA.sensors.zone(s.dist, s.range);
      const d = Math.max(0.12, s.dist);
      ctx.beginPath();
      ctx.arc(s.x, s.y, d, s.dirA - 0.36, s.dirA + 0.36);
      ctx.strokeStyle = colors[z];
      ctx.lineWidth = 5 * px;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  drawTurnCenter(car, px) {
    const tc = PA.kin.turnCenter(car.pose, car.kappa);
    if (!tc) return;
    const { ctx } = this;
    const s = car.spec;
    const cs = PA.kin.corners(s, car.pose);
    const rOuter = Math.max(...cs.map((c) => Math.hypot(c.x - tc.x, c.y - tc.y)));
    const inner = PA.kin.toWorld(car.pose, 0, Math.sign(tc.r) * s.width / 2);
    const rInner = Math.hypot(inner.x - tc.x, inner.y - tc.y);
    ctx.setLineDash([4 * px, 6 * px]);
    ctx.lineWidth = px;
    ctx.strokeStyle = 'rgba(244,114,182,0.55)';
    for (const r of [rOuter, rInner]) {
      ctx.beginPath();
      ctx.arc(tc.x, tc.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(tc.x, tc.y);
    ctx.lineTo(car.x, car.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(tc.x, tc.y, 4 * px, 0, Math.PI * 2);
    ctx.fill();
    this.label(`R ${Math.abs(tc.r).toFixed(2)} м`, (tc.x + car.x) / 2, (tc.y + car.y) / 2, px, '#f9a8d4', 11);
  }

  drawEditor(st, px) {
    const { ctx } = this;
    const sel = st.selected;
    if (!sel) return;
    let poly, handle;
    if (sel === 'start') {
      poly = PA.kin.bodyPoly(st.car.spec, st.car.pose);
      handle = PA.kin.toWorld(st.car.pose, st.car.spec.wheelbase + st.car.spec.frontOverhang + 0.8, 0);
    } else {
      const t = PA.TYPES[sel.type];
      poly = t.round ? PA.geo.circlePoly(sel.x, sel.y, sel.w / 2 + 0.05) : PA.geo.rectPoly(sel.x, sel.y, sel.w, Math.max(sel.h, 0.1), sel.a || 0);
      const p = PA.geo.rot(sel.w / 2 + 0.8, 0, sel.a || 0);
      handle = t.round ? null : { x: sel.x + p.x, y: sel.y + p.y };
    }
    ctx.beginPath();
    poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (handle) {
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 8 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#60a5fa';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
    st.handle = handle;
  }

  drawScale() {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const steps = [0.5, 1, 2, 5, 10, 20];
    const m = steps.find((s) => s * this.cam.scale > 70) || 20;
    const w = m * this.cam.scale;
    const x = 16, y = this.w < 820 ? 128 : this.h - 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${m} м`, x + w / 2, y - 6);
  }
};
