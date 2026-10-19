/* Кинематика автомобиля (велосипедная модель, точка отсчёта — центр задней оси). */
window.PA = window.PA || {};

PA.kin = (function () {
  const { rot } = PA.geo;

  function curvature(spec, steer) {
    return Math.tan(steer) / spec.wheelbase;
  }

  /** Поза после проезда пути s (со знаком) по дуге кривизны kappa. */
  function advance(pose, kappa, s) {
    const { x, y, h } = pose;
    if (Math.abs(kappa) < 1e-6) {
      return { x: x + s * Math.cos(h), y: y + s * Math.sin(h), h };
    }
    const nh = h + kappa * s;
    return {
      x: x + (Math.sin(nh) - Math.sin(h)) / kappa,
      y: y + (Math.cos(h) - Math.cos(nh)) / kappa,
      h: nh,
    };
  }

  function toWorld(pose, lx, ly) {
    const p = rot(lx, ly, pose.h);
    return { x: pose.x + p.x, y: pose.y + p.y };
  }

  /** Контур кузова с фасками на углах (выпуклый восьмиугольник). */
  function bodyLocal(spec) {
    const r = -spec.rearOverhang, f = spec.wheelbase + spec.frontOverhang, w = spec.width / 2;
    const cf = Math.min(0.16, w * 0.18), cr = Math.min(0.12, w * 0.14);
    return [
      [r + cr, -w], [f - cf, -w], [f, -w + cf], [f, w - cf],
      [f - cf, w], [r + cr, w], [r, w - cr], [r, -w + cr],
    ];
  }

  function bodyPoly(spec, pose) {
    return bodyLocal(spec).map(([lx, ly]) => toWorld(pose, lx, ly));
  }

  /** Углы бамперов: [заднийЛ, переднийЛ, переднийП, заднийП]. */
  function corners(spec, pose) {
    const r = -spec.rearOverhang, f = spec.wheelbase + spec.frontOverhang, w = spec.width / 2;
    return [toWorld(pose, r, -w), toWorld(pose, f, -w), toWorld(pose, f, w), toWorld(pose, r, w)];
  }

  /** Колёса с углами по Аккерману. Возвращает [ПЛ, ПП, ЗЛ, ЗП]. */
  function wheels(spec, pose, steer) {
    const L = spec.wheelbase, t = spec.track / 2;
    let al = 0, ar = 0;
    if (Math.abs(steer) > 1e-4) {
      const R = L / Math.tan(steer); // >0 — поворот вправо (центр справа)
      al = Math.atan(L / (R + t));
      ar = Math.atan(L / (R - t));
    }
    return [
      { ...toWorld(pose, L, -t), a: pose.h + al, front: true },
      { ...toWorld(pose, L, t), a: pose.h + ar, front: true },
      { ...toWorld(pose, 0, -t), a: pose.h, front: false },
      { ...toWorld(pose, 0, t), a: pose.h, front: false },
    ];
  }

  function turnCenter(pose, kappa) {
    if (Math.abs(kappa) < 1e-6) return null;
    const R = 1 / kappa;
    return { x: pose.x - Math.sin(pose.h) * R, y: pose.y + Math.cos(pose.h) * R, r: R };
  }

  return { curvature, advance, toWorld, bodyLocal, bodyPoly, corners, wheels, turnCenter };
})();

PA.Car = class Car {
  constructor(spec, pose) {
    this.setSpec(spec);
    this.reset(pose);
  }

  setSpec(spec) {
    this.spec = PA.vehicles.derive(spec);
    this.wheelAngle = PA.geo.clamp(this.wheelAngle || 0, -this.spec.maxWheelAngle, this.spec.maxWheelAngle);
  }

  reset(pose) {
    this.x = pose.x;
    this.y = pose.y;
    this.h = pose.h;
    this.wheelAngle = 0;
    this.speed = 0;
    this.gear = 'D';
  }

  get pose() { return { x: this.x, y: this.y, h: this.h }; }

  get steer() { return (this.wheelAngle / this.spec.maxWheelAngle) * this.spec.maxSteer; }

  get kappa() { return PA.kin.curvature(this.spec, this.steer); }

  setWheel(a) {
    this.wheelAngle = PA.geo.clamp(a, -this.spec.maxWheelAngle, this.spec.maxWheelAngle);
  }

  snapshot() {
    return { x: this.x, y: this.y, h: this.h, wheelAngle: this.wheelAngle, gear: this.gear };
  }

  restore(s) {
    Object.assign(this, s);
    this.speed = 0;
  }

  /**
   * Шаг симуляции. input: { steer: -1..1, drive: -1|0|1, brake: bool, slow: bool }.
   * collides(pose) → препятствие или null. Возвращает событие { hit, distance }.
   */
  update(dt, input, opts, collides) {
    const g = PA.geo;
    if (input.steer) {
      this.setWheel(this.wheelAngle + input.steer * g.rad(opts.steerSpeed) * dt);
    } else if (opts.autoCenter && Math.abs(this.speed) > 0.05) {
      // самовозврат руля пропорционально пройденному пути
      const back = Math.abs(this.speed) * dt * 1.2;
      this.setWheel(Math.sign(this.wheelAngle) * Math.max(0, Math.abs(this.wheelAngle) - back));
    }

    const vmax = (input.slow ? Math.min(1, opts.maxSpeed) : opts.maxSpeed) / 3.6;
    const accel = 1.6, brakeDec = 4.5, rollDec = 2.5;
    let v = this.speed;
    if (input.brake) {
      v = Math.sign(v) * Math.max(0, Math.abs(v) - brakeDec * dt);
    } else if (input.drive) {
      if (v !== 0 && Math.sign(v) !== input.drive) {
        v = Math.sign(v) * Math.max(0, Math.abs(v) - brakeDec * dt);
      } else {
        this.gear = input.drive > 0 ? 'D' : 'R';
        v = input.drive * Math.min(vmax, Math.abs(v) + accel * dt);
      }
    } else {
      v = Math.sign(v) * Math.max(0, Math.abs(v) - rollDec * dt);
    }
    if (Math.abs(v) > vmax) v = Math.sign(v) * Math.max(vmax, Math.abs(v) - brakeDec * dt);
    this.speed = v;

    const ds = v * dt;
    if (ds === 0) return { hit: null, distance: 0 };
    const k = this.kappa;
    let next = PA.kin.advance(this.pose, k, ds);
    const hit = collides(next);
    let lo = 1;
    if (hit) {
      // ищем максимально допустимую долю шага, чтобы встать вплотную
      let hi = 1;
      lo = 0;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (collides(PA.kin.advance(this.pose, k, ds * mid))) hi = mid;
        else lo = mid;
      }
      next = PA.kin.advance(this.pose, k, ds * lo);
      this.speed = 0;
    }
    const moved = Math.abs(ds * lo);
    this.x = next.x;
    this.y = next.y;
    this.h = next.h;
    return { hit, distance: moved };
  }
};
