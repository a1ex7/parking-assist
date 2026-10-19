/* Мир: препятствия, разметка, цель, проверка столкновений. */
window.PA = window.PA || {};

PA.TYPES = {
  wall:     { label: 'Стена',            solid: true,  tall: true,  w: 4,    h: 0.25, color: '#8b8f98' },
  fence:    { label: 'Забор',            solid: true,  tall: true,  w: 4,    h: 0.08, color: '#a0794f' },
  curb:     { label: 'Бордюр',           solid: true,  w: 4,    h: 0.15, color: '#c9c9c4', wheelOnly: true },
  car:      { label: 'Авто',             solid: true,  w: 4.6,  h: 1.82, color: '#5d6675' },
  pillar:   { label: 'Колонна',          solid: true,  tall: true,  w: 0.5,  h: 0.5,  color: '#9aa0a8' },
  post:     { label: 'Столбик',          solid: true,  w: 0.2,  h: 0.2,  color: '#f2c94c', round: true },
  cone:     { label: 'Конус',            solid: true,  w: 0.32, h: 0.32, color: '#ff7a1a', round: true },
  line:     { label: 'Разметка',         solid: false, w: 5,    h: 0.12, color: '#e8e8e8' },
  sidewalk: { label: 'Тротуар',          solid: false, w: 6,    h: 3,    color: '#3a3d43' },
  grass:    { label: 'Газон',            solid: false, w: 6,    h: 3,    color: '#2c4a2e' },
  goal:     { label: 'Парковочное место', solid: false, w: 5.2, h: 2.5,  color: '#34d399' },
};

PA.World = class World {
  constructor(data) {
    this.load(data || { name: 'Пустое поле', start: { x: 0, y: 0, h: 0 }, objects: [] });
  }

  load(data) {
    this.name = data.name || 'Сцена';
    this.start = { ...data.start };
    this.objects = data.objects.map((o) => ({ ...o }));
    this.dirty = true;
  }

  serialize() {
    const r = (v) => Math.round(v * 1000) / 1000;
    return {
      v: 1,
      name: this.name,
      start: { x: r(this.start.x), y: r(this.start.y), h: r(this.start.h) },
      objects: this.objects.map(({ _poly, _bb, _spec, ...o }) => {
        const out = { ...o, x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h), a: r(o.a || 0) };
        return out;
      }),
    };
  }

  get goal() { return this.objects.find((o) => o.type === 'goal') || null; }

  polyOf(o) {
    if (!o._poly) {
      const t = PA.TYPES[o.type] || {};
      o._poly = o.type === 'car' ? PA.carArt.parkedPoly(o)
        : t.round ? PA.geo.circlePoly(o.x, o.y, o.w / 2) : PA.geo.rectPoly(o.x, o.y, o.w, o.h, o.a || 0);
      o._bb = PA.geo.bbox(o._poly);
    }
    return o._poly;
  }

  touch(o) {
    delete o._poly;
    delete o._bb;
    delete o._spec;
    this.dirty = true;
  }

  solids() {
    if (this.dirty) {
      this._solids = this.objects.filter((o) => PA.TYPES[o.type]?.solid);
      this._solids.forEach((o) => this.polyOf(o));
      this.dirty = false;
    }
    return this._solids;
  }

  /** Препятствия, с которыми пересекается машина в позе (кузов или колёса для бордюров). */
  hits(spec, pose, steer, ignore) {
    return this.scan(spec, pose, steer, ignore, this.solids(), false);
  }

  /** first — остановиться на первом касании; list — какие препятствия проверять. */
  scan(spec, pose, steer, ignore, list, first) {
    const body = PA.kin.bodyPoly(spec, pose);
    const bb = PA.geo.bbox(body);
    let wheelPolys = null, mirrorPolys = null;
    const out = [];
    for (const o of list) {
      if (first && out.length) break;
      if (ignore && ignore.has(o)) continue;
      const t = PA.TYPES[o.type];
      // зеркала на высоте ~1 м задевают только высокие препятствия
      if (t.tall && this.mirrorHits && PA.geo.bboxOverlap({ minX: bb.minX - 0.3, minY: bb.minY - 0.3, maxX: bb.maxX + 0.3, maxY: bb.maxY + 0.3 }, o._bb)) {
        mirrorPolys = mirrorPolys || PA.carArt.mirrors(spec).map((m) =>
          PA.geo.convexHull(m.map((p) => PA.kin.toWorld(pose, p.x, p.y))));
        if (mirrorPolys.some((mp) => PA.geo.polysIntersect(mp, o._poly))) { out.push(o); continue; }
      }
      if (!PA.geo.bboxOverlap(bb, o._bb)) continue;
      if (t.wheelOnly) {
        wheelPolys = wheelPolys || PA.kin.wheels(spec, pose, steer).map((w) =>
          PA.geo.rectPoly(w.x, w.y, spec.wheelDiameter || 0.66, 0.22, w.a));
        if (wheelPolys.some((wp) => PA.geo.polysIntersect(wp, o._poly))) out.push(o);
      } else if (PA.geo.polysIntersect(body, o._poly)) {
        out.push(o);
      }
    }
    return out;
  }

  collides(spec, pose, steer, ignore) {
    return this.scan(spec, pose, steer, ignore, this.solids(), true)[0] || null;
  }

  pick(pt) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      const t = PA.TYPES[o.type] || {};
      const poly = t.round
        ? PA.geo.circlePoly(o.x, o.y, Math.max(o.w / 2, 0.25))
        : PA.geo.rectPoly(o.x, o.y, o.w, Math.max(o.h, 0.35), o.a || 0);
      if (PA.geo.pointInPoly(pt, poly)) return o;
    }
    return null;
  }

  /** Габариты сцены для «вписать в экран». */
  bounds(near = 8, minR = 12) {
    let b = { minX: this.start.x - 5, minY: this.start.y - 5, maxX: this.start.x + 5, maxY: this.start.y + 5 };
    for (const o of this.objects) {
      if (o.type === 'sidewalk' || o.type === 'grass') continue;
      const ob = PA.geo.bbox(this.polyOf(o));
      b = { minX: Math.min(b.minX, ob.minX), minY: Math.min(b.minY, ob.minY), maxX: Math.max(b.maxX, ob.maxX), maxY: Math.max(b.maxY, ob.maxY) };
    }
    // ограничиваем область вокруг старта и цели, чтобы длинные бордюры не уменьшали масштаб
    const g = this.goal || this.start;
    const fx = (this.start.x + g.x) / 2, fy = (this.start.y + g.y) / 2;
    const R = Math.max(minR, Math.hypot(this.start.x - g.x, this.start.y - g.y) / 2 + near);
    return {
      minX: Math.max(b.minX, fx - R), maxX: Math.min(b.maxX, fx + R),
      minY: Math.max(b.minY, fy - R), maxY: Math.min(b.maxY, fy + R),
    };
  }

  /** Машина стоит в цели: все углы внутри и курс совпадает. */
  checkGoal(spec, pose) {
    const g = this.goal;
    if (!g) return null;
    const poly = PA.geo.rectPoly(g.x, g.y, g.w, g.h, g.a || 0);
    const inside = PA.kin.corners(spec, pose).every((c) => PA.geo.pointInPoly(c, poly));
    const d = PA.geo.normAngle(pose.h - (g.a || 0));
    const tol = PA.geo.rad(10);
    let aligned = Math.abs(d) < tol;
    let reversed = false;
    if (!aligned && g.bidir && Math.abs(Math.abs(d) - Math.PI) < tol) {
      aligned = true;
      reversed = true;
    }
    return { inside, aligned, ok: inside && aligned, reversed, angleErr: PA.geo.deg(d) };
  }
};
