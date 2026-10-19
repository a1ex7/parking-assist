/* Геометрия: векторы, полигоны, пересечения. Мировые координаты — метры, ось Y вниз. */
window.PA = window.PA || {};

PA.geo = (function () {
  const EPS = 1e-9;

  function rot(x, y, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  /** Прямоугольник с центром (cx, cy), длиной w вдоль угла a и шириной h. */
  function rectPoly(cx, cy, w, h, a) {
    const hw = w / 2, hh = h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => {
      const p = rot(px, py, a);
      return { x: cx + p.x, y: cy + p.y };
    });
  }

  function circlePoly(cx, cy, r, n = 14) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function bbox(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function bboxOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function project(poly, ax, ay) {
    let min = Infinity, max = -Infinity;
    for (const p of poly) {
      const d = p.x * ax + p.y * ay;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return [min, max];
  }

  /** Пересечение выпуклых полигонов (теорема о разделяющей оси). */
  function polysIntersect(a, b) {
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        const ax = -(p2.y - p1.y), ay = p2.x - p1.x;
        const [minA, maxA] = project(a, ax, ay);
        const [minB, maxB] = project(b, ax, ay);
        if (maxA < minB - EPS || maxB < minA - EPS) return false;
      }
    }
    return true;
  }

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) &&
          pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** Расстояние вдоль луча (ox, oy) + t·(dx, dy) до отрезка или Infinity. */
  function raySegment(ox, oy, dx, dy, a, b) {
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < EPS) return Infinity;
    const t = ((a.x - ox) * ey - (a.y - oy) * ex) / den;
    const u = ((a.x - ox) * dy - (a.y - oy) * dx) / den;
    return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
  }

  function rayPoly(ox, oy, dx, dy, poly) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const t = raySegment(ox, oy, dx, dy, poly[i], poly[(i + 1) % poly.length]);
      if (t < best) best = t;
    }
    return best;
  }

  /** Выпуклая оболочка (монотонная цепь Эндрю), обход против часовой в системе с осью Y вниз. */
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
      lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;

  return { rot, rectPoly, convexHull, circlePoly, bbox, bboxOverlap, polysIntersect, pointInPoly, rayPoly, normAngle, clamp, deg, rad };
})();
