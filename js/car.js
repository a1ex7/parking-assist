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

  /** Контур кузова в плане (выпуклый, с сужением кормы) — см. PA.carArt.outline. */
  function bodyPoly(spec, pose) {
    return PA.carArt.outline(spec).map((p) => toWorld(pose, p.x, p.y));
  }

  /** Углы кузова: [заднийЛ, переднийЛ, переднийП, заднийП]. */
  function corners(spec, pose) {
    return PA.carArt.corners(spec).map((p) => toWorld(pose, p.x, p.y));
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

  return { curvature, advance, toWorld, bodyPoly, corners, wheels, turnCenter };
})();

/* Фиксаторы руля: центр и каждый полный оборот (метка руля снова вверху). */
PA.steering = (function () {
  const FULL = Math.PI * 2;
  const ZONE = PA.geo.rad(8); // зона удержания при перетаскивании
  const RAMP = PA.geo.rad(8); // зона плавного выхода из фиксатора

  const nearest = (a) => Math.round(a / FULL) * FULL;

  /** Перетаскивание: сырой угол → угол с залипанием; функция непрерывна и без накопления смещения. */
  function detent(raw) {
    const d = nearest(raw), off = raw - d, abs = Math.abs(off);
    if (abs <= ZONE) return d;
    if (abs <= ZONE + RAMP) return d + Math.sign(off) * ((abs - ZONE) * (ZONE + RAMP)) / RAMP;
    return raw;
  }

  /** Клавиши: фиксатор, через который (или на который) прошёл руль за шаг, иначе null. */
  function crossed(prev, next) {
    const lo = Math.min(prev, next), hi = Math.max(prev, next);
    for (let d = Math.ceil(lo / FULL) * FULL; d <= hi; d += FULL) {
      if (Math.abs(d - prev) > 1e-9) return d;
    }
    return null;
  }

  const isDetent = (a) => Math.abs(a - nearest(a)) < 1e-6;

  return { detent, crossed, isDetent };
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
    this.centering = false;
    this.detentHold = 0;
  }

  /** Плавное выравнивание руля в центр. */
  center() {
    this.centering = true;
    this.detentHold = 0;
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
    this.centering = false;
    this.detentHold = 0;
  }

  /**
   * Шаг симуляции. input: { steer: -1..1, drive: -1|0|1, brake: bool, slow: bool }.
   * collides(pose) → препятствие или null. Возвращает событие { hit, distance }.
   */
  update(dt, input, opts, collides) {
    const g = PA.geo;
    if (input.steer) {
      this.centering = false;
      if (this.detentHold > 0) {
        this.detentHold -= dt;
      } else {
        const prev = this.wheelAngle;
        let next = prev + input.steer * g.rad(opts.steerSpeed) * dt;
        const d = PA.steering.crossed(prev, next);
        if (d != null && Math.abs(d) <= this.spec.maxWheelAngle) {
          next = d;
          this.detentHold = 0.22;
          if (this.onDetent) this.onDetent();
        }
        this.setWheel(next);
      }
    } else if (this.centering) {
      this.detentHold = 0;
      const step = g.rad(1440) * dt;
      this.setWheel(Math.abs(this.wheelAngle) <= step ? 0 : this.wheelAngle - Math.sign(this.wheelAngle) * step);
      if (this.wheelAngle === 0) this.centering = false;
    } else if (opts.autoCenter && Math.abs(this.speed) > 0.05) {
      this.detentHold = 0;
      // самовозврат руля пропорционально пройденному пути
      const back = Math.abs(this.speed) * dt * 1.2;
      this.setWheel(Math.sign(this.wheelAngle) * Math.max(0, Math.abs(this.wheelAngle) - back));
    } else {
      this.detentHold = 0;
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
