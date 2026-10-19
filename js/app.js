/* Связующий слой: состояние, цикл симуляции, ввод, панель настроек, сохранение. */
(function () {
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'parking-assist:v1';

  const DEFAULT_OPTS = {
    fill: true, marks: true, wheels: false, both: true, extremes: false, center: false,
    sensors: true, sound: false, trail: true,
    length: 6, maxSpeed: 5, steerSpeed: 360, autoCenter: false, carColor: '#2563eb',
  };
  const TOGGLES = [
    ['fill', 'Заливка траектории (габарит кузова)'],
    ['marks', 'Метки 0.5 / 1 / 2 / 3 м от бампера'],
    ['wheels', 'Колеи колёс'],
    ['both', 'Траектория и вперёд, и назад'],
    ['extremes', 'Крайние траектории (руль до упора)'],
    ['center', 'Центр и радиус поворота'],
    ['sensors', 'Парктроники'],
    ['sound', 'Звук парктроников'],
    ['trail', 'След движения'],
  ];
  const VIEWS = { free: ['🗺', 'Свободный вид'], follow: ['🎯', 'Следовать за авто'], car: ['🚘', 'Вид 360° (авто вверх)'] };
  const CAR_FIELDS = [
    ['length', 'Длина, м', 0.01], ['width', 'Ширина, м', 0.01], ['wheelbase', 'Колёсная база, м', 0.01],
    ['track', 'Колея, м', 0.01], ['frontOverhang', 'Передний свес, м', 0.01],
    ['turningCircle', 'Диаметр разворота, м', 0.1], ['steeringTurns', 'Оборотов руля (упор–упор)', 0.1],
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  const saved = load();
  const app = {
    canvas: $('view'),
    opts: { ...DEFAULT_OPTS, ...(saved.opts || {}) },
    spec: saved.spec || { ...PA.vehicles.byId('golf') },
    sceneId: saved.sceneId || 'parallel',
    level: saved.level || 'normal',
    view: saved.view || 'free',
    mode: 'drive',
    isModified: false,
    selected: null,
    handle: null,
    keys: new Set(),
    pad: { drive: 0, brake: false },
    hitMarks: new Map(),
    lastMoveAt: 0,
  };
  app.renderer = new PA.Renderer(app.canvas);
  app.world = new PA.World();
  app.car = new PA.Car(app.spec, { x: 0, y: 0, h: 0 });

  // ------------------------------------------------------------ сцена
  function newRun() {
    return { maneuvers: 0, collisions: 0, distance: 0, time: 0, started: false, lastDir: 0, done: false, contact: false, trail: [], undo: [] };
  }

  function buildScene() {
    app.world.load(PA.scenarios.build(app.sceneId, app.spec, app.level));
    app.isModified = false;
    restart();
    fitScene();
    syncSceneSel();
    save();
  }

  function restart() {
    app.car.reset(app.world.start);
    app.run = newRun();
    app.run.trail.push({ x: app.car.x, y: app.car.y });
    $('success').hidden = true;
  }

  app.modified = function () {
    if (!app.isModified) {
      app.isModified = true;
      syncSceneSel();
    }
    save();
  };

  // ------------------------------------------------------------ хранилище
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          opts: app.opts, spec: app.spec, sceneId: app.sceneId, level: app.level, view: app.view,
          world: app.isModified ? app.world.serialize() : null,
        }));
      } catch (e) { /* приватный режим — работаем без сохранения */ }
    }, 300);
  }

  const b64 = (bytes) => {
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  async function pipeBytes(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** Стандартное упражнение — короткая ссылка, своя сцена — сжатый JSON. */
  async function encodeShare() {
    const pkg = app.isModified
      ? { scene: app.world.serialize(), car: app.spec }
      : { sceneId: app.sceneId, level: app.level, car: app.spec };
    const bytes = new TextEncoder().encode(JSON.stringify(pkg));
    if (window.CompressionStream) return `z=${b64(await pipeBytes(bytes, new CompressionStream('deflate-raw')))}`;
    return `s=${b64(bytes)}`;
  }

  async function decodeShare(kind, data) {
    let bytes = unb64(data);
    if (kind === 'z') bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function validScene(d) {
    return d && Array.isArray(d.objects) && d.start && Number.isFinite(d.start.x) &&
      d.objects.every((o) => PA.TYPES[o.type] && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(o[k])));
  }

  function loadPackage(pkg) {
    if (pkg.sceneId && PA.scenarios.list.some((x) => x.id === pkg.sceneId)) {
      app.sceneId = pkg.sceneId;
      if (PA.scenarios.LEVELS[pkg.level]) app.level = pkg.level;
      if (pkg.car && Number.isFinite(pkg.car.wheelbase)) setSpec(pkg.car, false);
      buildScene();
      return;
    }
    const scene = pkg.scene || pkg;
    if (!validScene(scene)) throw new Error('bad scene');
    if (pkg.car && Number.isFinite(pkg.car.wheelbase)) setSpec(pkg.car, false);
    app.world.load(scene);
    app.isModified = true;
    restart();
    fitScene();
    syncSceneSel();
    syncCarUI();
    save();
  }

  // ------------------------------------------------------------ уведомления
  let toastTimer = 0;
  function toast(text, kind = '') {
    const t = $('toast');
    t.textContent = text;
    t.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = kind; }, 1800);
  }

  // ------------------------------------------------------------ панель
  function syncSceneSel() {
    const sel = $('sceneSel');
    sel.innerHTML = '';
    for (const s of PA.scenarios.list) sel.add(new Option(s.name, s.id));
    if (app.isModified) sel.add(new Option(`Своя сцена: ${app.world.name}`, 'custom'));
    sel.value = app.isModified ? 'custom' : app.sceneId;
    $('levelSel').value = app.level;
  }

  function setSpec(spec, rebuild = true) {
    app.spec = { ...spec };
    app.car.setSpec(app.spec);
    syncCarUI();
    if (rebuild && !app.isModified) buildScene();
    else { restart(); save(); }
  }

  function syncCarUI() {
    const sel = $('carSel');
    if (!sel.options.length) {
      for (const p of PA.vehicles.presets) sel.add(new Option(p.name, p.id));
      sel.add(new Option('Свой автомобиль', 'custom'));
    }
    sel.value = PA.vehicles.presets.some((p) => p.id === app.spec.id) ? app.spec.id : 'custom';
    const box = $('carFields');
    if (!box.children.length) {
      for (const [key, label, step] of CAR_FIELDS) {
        const l = document.createElement('label');
        l.className = 'field';
        l.textContent = label;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = step;
        inp.min = 0.1;
        inp.dataset.key = key;
        inp.onchange = () => {
          const v = parseFloat(inp.value);
          if (!Number.isFinite(v) || v <= 0) return;
          setSpec({ ...app.spec, id: 'custom', name: 'Свой автомобиль', [key]: v });
        };
        l.appendChild(inp);
        box.appendChild(l);
      }
    }
    for (const inp of box.querySelectorAll('input')) {
      if (document.activeElement !== inp) inp.value = app.spec[inp.dataset.key];
    }
    const d = app.car.spec;
    const rows = [
      ['Макс. угол колёс', `${PA.geo.deg(d.maxSteer).toFixed(1)}°`],
      ['Мин. радиус (задняя ось)', `${d.minRadiusRear.toFixed(2)} м`],
      ['Задний свес', `${d.rearOverhang.toFixed(2)} м`],
      ['Руль до упора', `±${Math.round(PA.geo.deg(d.maxWheelAngle))}°`],
      ['Рулевое передаточное', `${(d.maxWheelAngle / d.maxSteer).toFixed(1)} : 1`],
    ];
    $('carDerived').innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      $('carDerived').append(dt, dd);
    }
  }

  function initPanel() {
    syncSceneSel();
    $('sceneSel').onchange = (e) => {
      if (e.target.value === 'custom') return;
      app.sceneId = e.target.value;
      buildScene();
    };
    $('levelSel').onchange = (e) => {
      app.level = e.target.value;
      if (app.isModified && $('sceneSel').value === 'custom') { save(); return; }
      buildScene();
    };
    $('resetBtn').onclick = restart;
    $('undoBtn').onclick = undo;

    syncCarUI();
    $('carSel').onchange = (e) => {
      if (e.target.value === 'custom') { $('carDetails').open = true; return; }
      setSpec(PA.vehicles.byId(e.target.value));
    };
    $('carColor').value = app.opts.carColor;
    $('carColor').oninput = (e) => { app.opts.carColor = e.target.value; save(); };

    const tg = $('toggles');
    for (const [key, label] of TOGGLES) {
      const l = document.createElement('label');
      l.className = 'check';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = !!app.opts[key];
      inp.onchange = () => {
        app.opts[key] = inp.checked;
        if (key === 'sound') PA.sensors.setEnabled(inp.checked);
        save();
      };
      l.append(inp, ` ${label}`);
      tg.appendChild(l);
    }

    const range = (id, valId, key, fmt) => {
      const r = $(id);
      r.value = app.opts[key];
      const upd = () => { $(valId).textContent = fmt(app.opts[key]); };
      upd();
      r.oninput = () => { app.opts[key] = parseFloat(r.value); upd(); save(); };
    };
    range('lenRange', 'lenVal', 'length', (v) => `${v} м`);
    range('spdRange', 'spdVal', 'maxSpeed', (v) => `${v} км/ч`);
    range('strRange', 'strVal', 'steerSpeed', (v) => `${v}°/с`);
    $('autoCenter').checked = app.opts.autoCenter;
    $('autoCenter').onchange = (e) => { app.opts.autoCenter = e.target.checked; save(); };

    $('shareBtn').onclick = async () => {
      const url = `${location.href.split('#')[0]}#${await encodeShare()}`;
      history.replaceState(null, '', url);
      try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка на сцену скопирована', 'info');
      } catch (e) {
        toast('Ссылка в адресной строке', 'info');
      }
    };
    $('exportBtn').onclick = () => {
      const blob = new Blob([JSON.stringify({ scene: app.world.serialize(), car: app.spec }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'parking-scene.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('importInp').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        loadPackage(JSON.parse(await file.text()));
        toast('Сцена загружена', 'info');
      } catch (err) {
        toast('Не удалось прочитать файл сцены');
      }
    };

    for (const b of $('modeSeg').querySelectorAll('button')) b.onclick = () => setMode(b.dataset.mode);
    $('doneBtn').onclick = () => setMode('drive');
    $('clearBtn').onclick = () => {
      app.world.objects = [];
      app.world.dirty = true;
      app.selected = null;
      app.editor.renderProps();
      app.modified();
    };

    $('panelOpen').onclick = () => document.body.classList.add('panel-open');
    $('panelClose').onclick = () => document.body.classList.remove('panel-open');
    $('viewMode').onclick = cycleView;
    $('fitBtn').onclick = fitView;
    $('zoomIn').onclick = () => zoomAt(app.renderer.w / 2, app.renderer.h / 2, 1.25);
    $('zoomOut').onclick = () => zoomAt(app.renderer.w / 2, app.renderer.h / 2, 0.8);
    $('sucAgain').onclick = restart;
    $('sucContinue').onclick = () => { $('success').hidden = true; };
    updateViewBtn();
  }

  function setMode(mode) {
    app.mode = mode;
    for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
    const editing = mode === 'edit';
    document.body.classList.toggle('editing', editing);
    $('editBar').hidden = !editing;
    app.selected = null;
    app.editor.setTool('select');
    app.editor.renderProps();
    restart();
    if (editing && app.view !== 'free') { app.view = 'free'; app.renderer.cam.rot = 0; updateViewBtn(); }
    document.body.classList.remove('panel-open');
  }

  // ------------------------------------------------------------ камера
  function cycleView() {
    const order = Object.keys(VIEWS);
    app.view = order[(order.indexOf(app.view) + 1) % order.length];
    if (app.view === 'free') app.renderer.cam.rot = 0;
    updateViewBtn();
    toast(VIEWS[app.view][1], 'info');
    save();
  }

  function updateViewBtn() {
    $('viewMode').textContent = VIEWS[app.view][0];
    $('viewMode').title = `${VIEWS[app.view][1]} (V)`;
  }

  function fitView() {
    app.view = 'free';
    updateViewBtn();
    fitScene();
  }

  function fitScene() {
    const narrow = app.renderer.w < 700;
    app.renderer.fit(narrow ? app.world.bounds(3, 6) : app.world.bounds(), narrow ? 0.6 : 1.5);
  }

  function zoomAt(sx, sy, f) {
    const r = app.renderer;
    const before = r.screenToWorld(sx, sy);
    r.cam.scale = PA.geo.clamp(r.cam.scale * f, 5, 300);
    if (app.view === 'free') {
      const after = r.screenToWorld(sx, sy);
      r.cam.x += before.x - after.x;
      r.cam.y += before.y - after.y;
    }
  }

  function updateCamera(dt) {
    const cam = app.renderer.cam;
    if (app.view === 'free' || app.mode === 'edit') return;
    const s = app.car.spec;
    const c = PA.kin.toWorld(app.car.pose, (s.wheelbase + s.frontOverhang - s.rearOverhang) / 2, 0);
    const k = 1 - Math.exp(-dt * 8);
    cam.x += (c.x - cam.x) * k;
    cam.y += (c.y - cam.y) * k;
    if (app.view === 'car') {
      const target = -app.car.h - Math.PI / 2;
      cam.rot += PA.geo.normAngle(target - cam.rot) * k;
    }
  }

  // ------------------------------------------------------------ ввод
  function initInput() {
    const cv = app.canvas;
    const pointers = new Map();
    let pan = null, pinch = null, editorDrag = false;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    cv.addEventListener('pointerdown', (e) => {
      wakeAudio();
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        pan = null;
        if (editorDrag) { app.editor.pointerUp(); editorDrag = false; }
        return;
      }
      if (app.mode === 'edit' && app.editor.pointerDown(app.renderer.screenToWorld(p.x, p.y), e)) {
        editorDrag = true;
        return;
      }
      pan = { x: p.x, y: p.y };
      cv.classList.add('dragging');
    });

    cv.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const r = app.renderer;
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        zoomAt(mx, my, d / pinch.d);
        if (app.view === 'free') panBy(mx - pinch.mx, my - pinch.my);
        pinch = { d, mx, my };
        return;
      }
      if (editorDrag) {
        app.editor.pointerMove(r.screenToWorld(p.x, p.y), e);
        return;
      }
      if (pan) {
        if (app.view !== 'free' && Math.hypot(p.x - pan.x, p.y - pan.y) > 4) { app.view = 'free'; updateViewBtn(); }
        if (app.view === 'free') panBy(p.x - pan.x, p.y - pan.y);
        pan = { x: p.x, y: p.y };
      }
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (editorDrag) { app.editor.pointerUp(); editorDrag = false; }
      pan = null;
      cv.classList.remove('dragging');
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    function panBy(dx, dy) {
      const cam = app.renderer.cam;
      const d = PA.geo.rot(dx / cam.scale, dy / cam.scale, -cam.rot);
      cam.x -= d.x;
      cam.y -= d.y;
    }

    // руль
    const wheel = $('wheel');
    let wheelDrag = null;
    const wheelAngleAt = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    wheel.addEventListener('pointerdown', (e) => {
      wakeAudio();
      wheel.setPointerCapture(e.pointerId);
      wheelDrag = wheelAngleAt(e);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (wheelDrag == null) return;
      const a = wheelAngleAt(e);
      app.car.setWheel(app.car.wheelAngle + PA.geo.normAngle(a - wheelDrag));
      wheelDrag = a;
    });
    const wheelEnd = () => { wheelDrag = null; };
    wheel.addEventListener('pointerup', wheelEnd);
    wheel.addEventListener('pointercancel', wheelEnd);
    wheel.addEventListener('dblclick', () => app.car.setWheel(0));

    // педали
    for (const b of document.querySelectorAll('.pedal')) {
      const on = (e) => {
        wakeAudio();
        b.setPointerCapture(e.pointerId);
        b.classList.add('active');
        if (b.dataset.drive) app.pad.drive = +b.dataset.drive;
        if (b.dataset.brake) app.pad.brake = true;
      };
      const off = () => {
        b.classList.remove('active');
        if (b.dataset.drive) app.pad.drive = 0;
        if (b.dataset.brake) app.pad.brake = false;
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // клавиатура
    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      wakeAudio();
      if (app.mode === 'edit') {
        if (app.editor.keyDown(e)) { e.preventDefault(); return; }
      } else {
        if (e.code === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ')) { e.preventDefault(); undo(); return; }
        if (e.code === 'KeyC') app.car.setWheel(0);
      }
      if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey) cycleView();
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) fitView();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      app.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => app.keys.delete(e.code));
    window.addEventListener('blur', () => app.keys.clear());
    window.addEventListener('resize', () => app.renderer.resize());
  }

  let audioWoken = false;
  function wakeAudio() {
    if (audioWoken || !app.opts.sound) return;
    audioWoken = true;
    PA.sensors.setEnabled(true);
  }

  function readInput() {
    const k = app.keys;
    const steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let drive = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (app.pad.drive) drive = app.pad.drive;
    return { steer, drive, brake: k.has('Space') || app.pad.brake, slow: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  // ------------------------------------------------------------ манёвры
  function undo() {
    const s = app.run.undo.pop();
    if (!s) { toast('Нечего отменять', 'info'); return; }
    app.car.restore(s.car);
    Object.assign(app.run, s.run);
    app.run.trail.length = s.trailLen;
    app.run.done = false;
    $('success').hidden = true;
    toast('Манёвр отменён', 'info');
  }

  function step(dt, now) {
    const car = app.car, run = app.run, world = app.world;
    const input = readInput();
    const pre = car.snapshot();
    const wasStopped = car.speed === 0;
    const ignore = new Set(world.hits(car.spec, car.pose, car.steer));
    const ev = car.update(dt, input, app.opts, (pose) => world.collides(car.spec, pose, car.steer, ignore));

    if (wasStopped && car.speed !== 0) {
      run.undo.push({
        car: pre, trailLen: run.trail.length,
        run: { maneuvers: run.maneuvers, collisions: run.collisions, distance: run.distance, time: run.time, lastDir: run.lastDir, started: run.started },
      });
      if (run.undo.length > 100) run.undo.shift();
      const dir = Math.sign(car.speed);
      if (dir !== run.lastDir) run.maneuvers++;
      run.lastDir = dir;
      run.started = true;
    }
    if (car.speed !== 0 || ev.hit) app.lastMoveAt = now;
    run.distance += ev.distance;
    const last = run.trail[run.trail.length - 1];
    if (!last || Math.hypot(car.x - last.x, car.y - last.y) > 0.05) run.trail.push({ x: car.x, y: car.y });
    if (run.trail.length > 6000) run.trail.splice(0, 1000);

    if (ev.hit) {
      if (!run.contact) {
        run.collisions++;
        PA.sensors.thud();
        toast(`Касание: ${PA.TYPES[ev.hit.type].label.toLowerCase()}`);
      }
      run.contact = true;
      app.hitMarks.set(ev.hit, now + 1500);
    } else if (ev.distance > 0) {
      run.contact = false;
    }
    if (run.started && !run.done) run.time += dt;
    return input;
  }

  function showSuccess(gs) {
    const run = app.run;
    run.done = true;
    const g = app.world.goal;
    $('sucTitle').textContent = 'Цель достигнута!';
    const rows = [
      ['Время', fmtTime(run.time)],
      ['Манёвров (смен направления)', run.maneuvers],
      ['Касаний', run.collisions],
      ['Пройдено', `${run.distance.toFixed(1)} м`],
      ['Отклонение курса', `${Math.abs(gs.reversed ? 180 - Math.abs(gs.angleErr) : gs.angleErr).toFixed(1)}°`],
    ];
    if (g && g.bidir) rows.push(['Заезд', gs.reversed ? 'задом' : 'передом']);
    const dl = $('sucStats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    $('success').hidden = false;
  }

  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  // ------------------------------------------------------------ HUD
  const hudCache = {};
  function setText(id, v) {
    if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; }
  }

  function updateHud(path, gs) {
    const car = app.car;
    const gear = car.gear;
    setText('hudGear', gear);
    $('hudGear').classList.toggle('r', gear === 'R');
    setText('hudSpeed', (Math.abs(car.speed) * 3.6).toFixed(1));
    const wDeg = Math.round(PA.geo.deg(car.wheelAngle));
    setText('hudWheel', `${wDeg > 0 ? '+' : ''}${wDeg}°`);
    setText('hudSteer', `${PA.geo.deg(car.steer).toFixed(1)}°`);
    const k = car.kappa;
    setText('hudRadius', Math.abs(k) < 1e-3 ? '∞' : `${Math.abs(1 / k).toFixed(1)} м`);
    const chip = $('hudDistChip');
    if (path && path.hitS != null) {
      setText('hudDist', `${path.hitS.toFixed(2)} м`);
      chip.classList.toggle('danger', path.hitS < 0.5);
      chip.classList.toggle('warn', path.hitS >= 0.5 && path.hitS < 1.2);
    } else {
      setText('hudDist', path ? `> ${path.length.toFixed(0)} м` : '—');
      chip.classList.remove('danger', 'warn');
    }
    setText('wheelVal', `руль ${wDeg > 0 ? '+' : ''}${wDeg}° · колёса ${PA.geo.deg(car.steer).toFixed(1)}°`);
    $('wheel').style.transform = `rotate(${PA.geo.deg(car.wheelAngle)}deg)`;

    const goalEl = $('stGoal');
    let gtxt = '';
    if (gs) gtxt = gs.ok ? '✓ в месте' : gs.inside ? `курс ±${Math.abs(gs.angleErr).toFixed(0)}°` : 'цель: вне места';
    setText('stGoal', gtxt);
    goalEl.classList.toggle('ok', !!(gs && gs.ok));
    setText('stMan', String(app.run.maneuvers));
    setText('stHit', String(app.run.collisions));
    setText('stTime', fmtTime(app.run.time));
  }

  // ------------------------------------------------------------ цикл
  const nullWorld = { collides: () => null };
  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const car = app.car, world = app.world, opts = app.opts;
    const editing = app.mode === 'edit';
    let input = { brake: false };
    if (!editing && $('success').hidden) input = step(dt, now);

    const steer = car.steer;
    const overlap = world.hits(car.spec, car.pose, steer);
    const ignore = new Set(overlap);
    const gs = world.checkGoal(car.spec, car.pose);
    if (!editing && gs && gs.ok && car.speed === 0 && app.run.started && !app.run.done) showSuccess(gs);

    let path = null, backPath = null, extremes = [], sensors = null;
    if (!editing) {
      const dir = car.gear === 'R' ? -1 : 1;
      path = PA.predict(world, car.spec, car.pose, steer, dir, opts.length, ignore);
      if (opts.both) backPath = PA.predict(world, car.spec, car.pose, steer, -dir, opts.length, ignore);
      if (opts.extremes) {
        extremes = [-1, 1].map((sg) => PA.predict(nullWorld, car.spec, car.pose, sg * car.spec.maxSteer, dir, opts.length));
      }
      if (opts.sensors || opts.sound) {
        sensors = PA.sensors.read(world, car.spec, car.pose);
        const active = sensors.filter((s) => car.gear === 'R' || s.front).map((s) => s.dist).filter((d) => d != null);
        const recent = now - app.lastMoveAt < 2500;
        PA.sensors.beep(opts.sound && recent && active.length ? Math.min(...active) : null);
      }
    }

    const hitSet = new Set();
    for (const [o, t] of app.hitMarks) { if (t > now) hitSet.add(o); else app.hitMarks.delete(o); }

    updateCamera(dt);
    const st = {
      world, car, opts, path, backPath, extremes, sensors, trail: app.run.trail, goalState: gs,
      editing, selected: app.selected, hitSet, colliding: overlap.length > 0, braking: input.brake || (input.drive && Math.sign(input.drive) !== Math.sign(car.speed) && car.speed !== 0),
    };
    app.renderer.draw(st);
    app.handle = st.handle || null;
    if (!editing) updateHud(path, gs);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ старт
  app.editor = new PA.Editor(app);
  initPanel();
  initInput();

  async function boot() {
    const m = location.hash.match(/^#([sz])=([\w-]+)/);
    if (m) {
      try {
        loadPackage(await decodeShare(m[1], m[2]));
        toast('Сцена загружена по ссылке', 'info');
        return;
      } catch (e) {
        toast('Ссылка на сцену повреждена');
      }
    }
    if (saved.world && validScene(saved.world)) {
      app.world.load(saved.world);
      app.isModified = true;
      restart();
      fitScene();
      syncSceneSel();
      return;
    }
    buildScene();
  }
  boot().then(() => requestAnimationFrame(frame));

  window.PA.app = app; // для отладки из консоли
})();
