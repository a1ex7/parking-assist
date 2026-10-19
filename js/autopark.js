/* Автопарковка: поиск манёвра, карточка шагов, отрисовка плана и автопилот. */
window.PA = window.PA || {};

// время одного шага автопилота: поворот руля + движение — не больше секунды
const STEER_TIME = 0.3, DRIVE_TIME = 0.7;

PA.Autopark = class Autopark {
  constructor(app) {
    this.app = app;
    this.plan = null;
    this.idx = 0;
    this.progress = 0; // пройдено в текущем шаге (для продолжения после паузы)
    this.exec = null;
    this.cancel = null;
    const $ = (id) => document.getElementById(id);
    this.el = { card: $('planCard'), title: $('planTitle'), info: $('planInfo'), list: $('planSteps'), run: $('planRun'), step: $('planStep') };
    $('planBtn').onclick = () => this.find();
    $('planBtnPanel').onclick = () => this.find();
    $('planClose').onclick = () => this.clear();
    this.el.run.onclick = () => this.execute(true);
    this.el.step.onclick = () => this.execute(false);
  }

  get searching() { return !!this.cancel; }

  find() {
    const app = this.app;
    if (app.mode === 'edit') return;
    const goal = app.world.goal;
    if (!goal) { app.toast('В этой сцене нет парковочного места', 'info'); return; }
    this.clear();
    app.car.speed = 0;
    this.showCard('Ищу манёвр…', 'Перебираю положения руля: ½, 1, 1½ оборота и до упора', true);
    const start = app.car.pose;
    this.cancel = PA.planner.plan(app.world, app.car.spec, start, goal, (plan, ms) => {
      this.cancel = null;
      if (!plan) {
        this.showCard('Манёвр не найден', 'Отъедьте в другое место или выберите уровень «Просторно». Если мешают зеркала — их можно отключить в «Подсказках».');
        return;
      }
      plan.ms = ms;
      plan.offset = this.centerOffset(plan, goal);
      this.plan = plan;
      this.idx = 0;
      this.progress = 0;
      this.render();
    });
  }

  /** Насколько центр кузова в конце плана отстоит от центра места. */
  centerOffset(plan, goal) {
    const s = this.app.car.spec;
    const c = PA.kin.toWorld(plan.end, (s.wheelbase + s.frontOverhang - s.rearOverhang) / 2, 0);
    return Math.hypot(c.x - goal.x, c.y - goal.y);
  }

  clear() {
    if (this.cancel) this.cancel();
    this.cancel = null;
    this.plan = null;
    this.exec = null;
    this.el.card.hidden = true;
  }

  /** Пользователь сам поехал — план больше не соответствует позе. */
  invalidate() {
    if (this.plan || this.searching) this.clear();
  }

  execute(all) {
    if (!this.plan || this.idx >= this.plan.steps.length) return;
    this.exec = { all, phase: 'steer' };
    this.render();
  }

  stop() {
    this.exec = null;
    this.app.car.speed = 0;
    this.render();
  }

  /** Шаг автопилота. true — машиной управляет автопилот в этом кадре. */
  update(dt, now) {
    const e = this.exec;
    if (!e) return false;
    const app = this.app, car = app.car, k = app.keys;
    // любое ручное управление забирает машину у автопилота
    const manual = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyX'].some((c) => k.has(c)) || app.pad.drive || app.pad.brake;
    if (manual) { this.stop(); app.toast('Автопилот выключен — управление у вас', 'info'); return false; }

    const s = this.plan.steps[this.idx];
    if (app.run.started && !app.run.done) app.run.time += dt;
    if (e.phase === 'steer') {
      car.centering = false;
      car.speed = 0;
      // руль доворачивается не дольше STEER_TIME
      if (e.steerFrom == null) e.steerFrom = car.wheelAngle;
      const diff = s.wheel - car.wheelAngle;
      const rate = Math.max(PA.geo.rad(720), Math.abs(s.wheel - e.steerFrom) / STEER_TIME) * dt;
      if (Math.abs(diff) <= rate) {
        car.setWheel(s.wheel);
        // время движения фиксировано: длинный отрезок едет быстрее, короткий — быстрее заканчивается
        const left = s.dist - this.progress;
        Object.assign(e, { phase: 'drive', base: car.pose, dist: left, t: 0, T: PA.geo.clamp(left / 1.4, 0.3, DRIVE_TIME), done: 0, begun: false, steerFrom: null });
      } else {
        car.setWheel(car.wheelAngle + Math.sign(diff) * rate);
      }
      return true;
    }

    if (!e.begun) {
      app.beginMove(car.snapshot(), s.dir);
      car.gear = s.dir > 0 ? 'D' : 'R';
      e.begun = true;
    }
    e.t = Math.min(e.T, e.t + dt);
    const tau = e.t / e.T;
    const target = e.dist * tau * tau * (3 - 2 * tau); // плавный разгон и торможение
    const ds = target - e.done;
    // проверка подшагами по 10 см: за кадр машина может проехать больше полуметра
    const world = app.world;
    const ignore = new Set(world.hits(car.spec, car.pose, car.steer));
    const n = Math.max(1, Math.ceil(ds / 0.1));
    for (let i = 1; i <= n; i++) {
      const q = PA.kin.advance(e.base, s.kappa, s.dir * (e.done + (ds * i) / n));
      const hit = world.collides(car.spec, q, car.steer, ignore);
      if (hit) {
        this.stop();
        app.toast(`Автопилот остановлен: впереди ${PA.TYPES[hit.type].label.toLowerCase()}`);
        return true;
      }
    }
    const next = PA.kin.advance(e.base, s.kappa, s.dir * target);
    car.x = next.x; car.y = next.y; car.h = next.h;
    car.speed = dt > 0 ? (s.dir * ds) / dt : 0;
    e.done = target;
    this.progress = s.dist - e.dist + target;
    app.trackMove(ds, now);
    e.left = e.dist - target;
    if (e.t >= e.T) {
      car.speed = 0;
      car.x = s.to.x; car.y = s.to.y; car.h = s.to.h; // без накопления погрешности
      this.idx++;
      this.progress = 0;
      e.phase = 'steer';
      if (this.idx >= this.plan.steps.length) {
        this.exec = null;
        this.plan = null;
        this.el.card.hidden = true;
        return true;
      }
      if (!e.all) this.exec = null;
      this.render();
    }
    return true;
  }

  // ------------------------------------------------------------ карточка
  showCard(title, info, busy = false) {
    const el = this.el;
    el.card.hidden = false;
    el.card.classList.toggle('busy', busy);
    el.title.textContent = title;
    el.info.textContent = info;
    el.list.innerHTML = '';
    el.run.hidden = el.step.hidden = true;
  }

  render() {
    const p = this.plan, el = this.el;
    if (!p) return;
    el.card.hidden = false;
    el.card.classList.remove('busy');
    el.title.textContent = `Манёвр: ${p.actions} ${plural(p.actions, 'действие', 'действия', 'действий')} · ${p.length.toFixed(1)} м`;
    const where = p.offset < 0.02 ? 'ровно по центру места' : `смещение от центра ${Math.round(p.offset * 100)} см`;
    el.info.textContent = `${where} · запас до препятствий ${Math.round(p.margin * 100)} см · найдено за ${(p.ms / 1000).toFixed(1)} с`;
    el.list.innerHTML = '';
    p.steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = i < this.idx ? 'done' : i === this.idx ? 'on' : '';
      const w = document.createElement('b');
      w.textContent = s.text.wheel;
      const m = document.createElement('span');
      m.className = s.dir > 0 ? 'fwd' : 'rev';
      m.textContent = s.text.move;
      li.append(w, m);
      el.list.appendChild(li);
    });
    const left = this.idx < p.steps.length;
    el.run.hidden = el.step.hidden = !left;
    el.run.textContent = this.exec ? '⏸ Пауза' : '▶ Выполнить';
    el.run.onclick = () => (this.exec ? this.stop() : this.execute(true));
    el.step.disabled = !!this.exec;
  }
};

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
