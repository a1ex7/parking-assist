/* Прогноз траектории при текущем угле колёс: позы вдоль дуги и первая точка столкновения. */
window.PA = window.PA || {};

PA.predict = function predict(world, spec, pose, steer, dir, length, ignore) {
  const kappa = PA.kin.curvature(spec, steer);
  // не дальше одного полного круга
  if (Math.abs(kappa) > 1e-6) length = Math.min(length, (Math.PI * 2) / Math.abs(kappa));
  const step = 0.05;
  const at = (s) => PA.kin.advance(pose, kappa, dir * s);
  const hitAt = (s) => world.collides(spec, at(s), steer, ignore);

  let hitS = null, hitObj = null;
  let prev = 0;
  for (let s = step; s <= length + 1e-9; s += step) {
    const o = hitAt(s);
    if (o) {
      let lo = prev, hi = s;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (hitAt(mid)) hi = mid; else lo = mid;
      }
      hitS = lo;
      hitObj = o;
      break;
    }
    prev = s;
  }

  const poses = [];
  const ds = 0.08;
  const n = Math.max(2, Math.ceil(length / ds));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * length;
    poses.push({ s, ...at(s) });
  }
  return { kappa, dir, length, poses, hitS, hitObj, hitPose: hitS != null ? at(hitS) : null, at };
};
