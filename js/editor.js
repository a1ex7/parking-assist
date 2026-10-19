/* Редактор сцены: размещение и правка препятствий, стартовой позиции и цели. */
window.PA = window.PA || {};

PA.Editor = class Editor {
  constructor(app) {
    this.app = app;
    this.tool = 'select';
    this.drag = null;
    this.tools = [
      ['select', '⬚', 'Выбор'], ['wall', '▬', 'Стена'], ['fence', '┅', 'Забор'], ['curb', '▭', 'Бордюр'],
      ['car', '🚗', 'Авто'], ['pillar', '■', 'Колонна'], ['post', '●', 'Столбик'], ['cone', '▲', 'Конус'],
      ['line', '╌', 'Разметка'], ['sidewalk', '▦', 'Тротуар'], ['grass', '▩', 'Газон'], ['goal', 'P', 'Место'],
    ];
    this.renderTools();
    document.getElementById('dupBtn').onclick = () => this.duplicate();
    document.getElementById('delBtn').onclick = () => this.remove();
  }

  get world() { return this.app.world; }
  get selected() { return this.app.selected; }
  set selected(v) { this.app.selected = v; this.renderProps(); }

  renderTools() {
    const box = document.getElementById('tools');
    box.innerHTML = '';
    for (const [id, icon, label] of this.tools) {
      const b = document.createElement('button');
      b.innerHTML = `<i>${icon}</i>${label}`;
      b.className = id === this.tool ? 'on' : '';
      b.onclick = () => this.setTool(id);
      box.appendChild(b);
    }
  }

  setTool(id) {
    this.tool = id;
    this.renderTools();
    this.app.canvas.classList.toggle('place', id !== 'select');
  }

  snap(v) { return Math.round(v / 0.05) * 0.05; }

  carCenterOffset() {
    const s = this.app.car.spec;
    return (s.wheelbase + s.frontOverhang - s.rearOverhang) / 2;
  }

  // ------------------------------------------------------------ указатель
  pointerDown(pt, e) {
    const tool = this.tool;
    if (tool === 'select') {
      const h = this.app.handle;
      const tol = 14 / this.app.renderer.cam.scale;
      if (this.selected && h && Math.hypot(pt.x - h.x, pt.y - h.y) < tol) {
        this.drag = { kind: 'rotate' };
        return true;
      }
      const car = this.app.car;
      if (PA.geo.pointInPoly(pt, PA.kin.bodyPoly(car.spec, car.pose))) {
        this.selected = 'start';
        const c = PA.kin.toWorld(car.pose, this.carCenterOffset(), 0);
        this.drag = { kind: 'move', dx: c.x - pt.x, dy: c.y - pt.y };
        return true;
      }
      const o = this.world.pick(pt);
      if (o) {
        this.selected = o;
        this.drag = { kind: 'move', dx: o.x - pt.x, dy: o.y - pt.y };
        return true;
      }
      this.selected = null;
      return false;
    }

    const t = PA.TYPES[tool];
    const o = { type: tool, x: this.snap(pt.x), y: this.snap(pt.y), w: t.w, h: t.h, a: 0 };
    if (tool === 'car') {
      const colors = ['#5d6675', '#8a2f2f', '#2f4f8a', '#c7c9cc', '#1f2328', '#3f6b4f', '#7a6a55'];
      o.color = colors[Math.floor(Math.random() * colors.length)];
      o.style = ['sedan', 'hatch', 'suv'][Math.floor(Math.random() * 3)];
    }
    if (tool === 'goal') {
      this.world.objects = this.world.objects.filter((x) => x.type !== 'goal');
      o.bidir = true;
    }
    this.world.objects.push(o);
    this.world.touch(o);
    this.selected = o;
    if (['wall', 'fence', 'curb', 'line'].includes(tool)) this.drag = { kind: 'segment', o, ax: o.x, ay: o.y };
    else if (tool === 'sidewalk' || tool === 'grass') this.drag = { kind: 'area', o, ax: o.x, ay: o.y };
    else this.drag = { kind: 'move', dx: 0, dy: 0 };
    this.app.modified();
    return true;
  }

  pointerMove(pt, e) {
    const d = this.drag;
    if (!d) return false;
    const sel = this.selected;
    if (d.kind === 'move') {
      const x = this.snap(pt.x + d.dx), y = this.snap(pt.y + d.dy);
      if (sel === 'start') this.placeStart(x, y, this.app.car.h);
      else { sel.x = x; sel.y = y; this.world.touch(sel); }
    } else if (d.kind === 'rotate') {
      const c = sel === 'start' ? PA.kin.toWorld(this.app.car.pose, this.carCenterOffset(), 0) : sel;
      let a = Math.atan2(pt.y - c.y, pt.x - c.x);
      if (!e.shiftKey) a = PA.geo.rad(Math.round(PA.geo.deg(a) / 5) * 5);
      if (sel === 'start') this.placeStart(c.x, c.y, a);
      else { sel.a = a; this.world.touch(sel); }
    } else if (d.kind === 'segment') {
      const bx = this.snap(pt.x), by = this.snap(pt.y);
      let a = Math.atan2(by - d.ay, bx - d.ax);
      if (!e.shiftKey) a = PA.geo.rad(Math.round(PA.geo.deg(a) / 15) * 15);
      const len = Math.max(0.1, Math.hypot(bx - d.ax, by - d.ay));
      d.o.w = len;
      d.o.a = a;
      d.o.x = d.ax + Math.cos(a) * len / 2;
      d.o.y = d.ay + Math.sin(a) * len / 2;
      d.moved = len > 0.3;
      this.world.touch(d.o);
    } else if (d.kind === 'area') {
      const bx = this.snap(pt.x), by = this.snap(pt.y);
      d.o.w = Math.max(0.2, Math.abs(bx - d.ax));
      d.o.h = Math.max(0.2, Math.abs(by - d.ay));
      d.o.x = (bx + d.ax) / 2;
      d.o.y = (by + d.ay) / 2;
      d.moved = d.o.w > 0.3 || d.o.h > 0.3;
      this.world.touch(d.o);
    }
    this.renderProps();
    this.app.modified();
    return true;
  }

  pointerUp() {
    const d = this.drag;
    if (d && (d.kind === 'segment' || d.kind === 'area') && !d.moved) {
      const t = PA.TYPES[d.o.type];
      Object.assign(d.o, { x: d.ax, y: d.ay, w: t.w, h: t.h, a: 0 });
      this.world.touch(d.o);
      this.renderProps();
    }
    this.drag = null;
  }

  /** Стартовая поза задаётся центром кузова и курсом. */
  placeStart(cx, cy, h) {
    const off = this.carCenterOffset();
    const pose = { x: cx - Math.cos(h) * off, y: cy - Math.sin(h) * off, h };
    this.world.start = pose;
    this.app.car.reset(pose);
  }

  // ------------------------------------------------------------ клавиши
  keyDown(e) {
    const sel = this.selected;
    if (e.key === 'Escape') { this.setTool('select'); this.selected = null; return true; }
    if (!sel) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') { this.remove(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { this.duplicate(); return true; }
    const step = e.shiftKey ? 1 : 0.1;
    const rotStep = PA.geo.rad(e.shiftKey ? 1 : 5);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] || e.code === 'KeyQ' || e.code === 'KeyE') {
      const [dx, dy] = moves[e.key] || [0, 0];
      const da = e.code === 'KeyQ' ? -rotStep : e.code === 'KeyE' ? rotStep : 0;
      if (sel === 'start') {
        const c = PA.kin.toWorld(this.app.car.pose, this.carCenterOffset(), 0);
        this.placeStart(c.x + dx, c.y + dy, this.app.car.h + da);
      } else {
        sel.x += dx; sel.y += dy; sel.a = (sel.a || 0) + da;
        this.world.touch(sel);
      }
      this.renderProps();
      this.app.modified();
      return true;
    }
    return false;
  }

  remove() {
    const sel = this.selected;
    if (!sel || sel === 'start') return;
    this.world.objects = this.world.objects.filter((o) => o !== sel);
    this.world.dirty = true;
    this.selected = null;
    this.app.modified();
  }

  duplicate() {
    const sel = this.selected;
    if (!sel || sel === 'start' || sel.type === 'goal') return;
    const { _poly, _bb, _spec, ...rest } = sel;
    const c = { ...rest, x: sel.x + 0.5, y: sel.y + 0.5 };
    this.world.objects.push(c);
    this.world.dirty = true;
    this.selected = c;
    this.app.modified();
  }

  // ------------------------------------------------------------ свойства
  renderProps() {
    const box = document.getElementById('props');
    const sel = this.selected;
    box.hidden = !sel;
    if (!sel) return;
    const f = document.getElementById('propsFields');
    const fields = [];
    const num = (key, label, val, step = 0.05) => fields.push({ key, label, val, step });
    if (sel === 'start') {
      document.getElementById('propsTitle').textContent = 'Старт автомобиля';
      const c = PA.kin.toWorld(this.app.car.pose, this.carCenterOffset(), 0);
      num('x', 'X, м', c.x);
      num('y', 'Y, м', c.y);
      num('a', 'Курс, °', PA.geo.deg(this.app.car.h), 1);
    } else {
      const t = PA.TYPES[sel.type];
      document.getElementById('propsTitle').textContent = t.label;
      num('x', 'X, м', sel.x);
      num('y', 'Y, м', sel.y);
      if (!t.round) num('a', 'Угол, °', PA.geo.deg(sel.a || 0), 1);
      num('w', t.round ? 'Диаметр' : 'Длина, м', sel.w);
      if (!t.round) num('h', 'Ширина, м', sel.h);
    }
    // не перерисовываем поле, в котором сейчас печатают
    const active = document.activeElement;
    if (active && f.contains(active) && active.dataset.owner === String(this.ownerKey(sel))) {
      for (const fd of fields) {
        const inp = f.querySelector(`[data-key="${fd.key}"]`);
        if (inp && inp !== active) inp.value = fd.val.toFixed(2);
      }
      return;
    }
    f.innerHTML = '';
    for (const fd of fields) {
      const l = document.createElement('label');
      l.className = 'field';
      l.textContent = fd.label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = fd.step;
      inp.value = fd.val.toFixed(2);
      inp.dataset.key = fd.key;
      inp.dataset.owner = String(this.ownerKey(sel));
      inp.oninput = () => this.applyField(fd.key, parseFloat(inp.value));
      l.appendChild(inp);
      f.appendChild(l);
    }
    if (sel !== 'start' && sel.type === 'car') {
      const l = document.createElement('label');
      l.className = 'field';
      l.textContent = 'Цвет';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = sel.color || '#5d6675';
      inp.oninput = () => { sel.color = inp.value; this.app.modified(); };
      l.appendChild(inp);
      f.appendChild(l);
    }
    if (sel !== 'start' && sel.type === 'goal') {
      const l = document.createElement('label');
      l.className = 'check';
      l.style.gridColumn = '1 / -1';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = !!sel.bidir;
      inp.onchange = () => { sel.bidir = inp.checked; this.app.modified(); };
      l.append(inp, ' Передом или задом');
      f.appendChild(l);
    }
  }

  ownerKey(sel) {
    if (sel === 'start') return 'start';
    return this.world.objects.indexOf(sel);
  }

  applyField(key, v) {
    if (!Number.isFinite(v)) return;
    const sel = this.selected;
    if (sel === 'start') {
      const c = PA.kin.toWorld(this.app.car.pose, this.carCenterOffset(), 0);
      if (key === 'x') this.placeStart(v, c.y, this.app.car.h);
      if (key === 'y') this.placeStart(c.x, v, this.app.car.h);
      if (key === 'a') this.placeStart(c.x, c.y, PA.geo.rad(v));
    } else {
      if (key === 'a') sel.a = PA.geo.rad(v);
      else if (key === 'w' || key === 'h') sel[key] = Math.max(0.05, v);
      else sel[key] = v;
      if (key === 'w' && PA.TYPES[sel.type].round) sel.h = sel.w;
      this.world.touch(sel);
    }
    this.app.modified();
  }
};
