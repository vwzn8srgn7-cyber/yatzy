// 3D-Würfel für das Spiel (three.js, lokal in vendor/). Bewegung und Zeiten sind nach dem Vorbild-Video nachgebaut.
// Schnittstelle (window.Dice3D):  mount(element), setDice(werte, gehalten), roll(werte, maske), onTap(fn), busy()
// Zeichnet nur während etwas in Bewegung ist; danach steht die Szene still (spart Akku und Wärme).
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

(function () {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    if (!renderer.getContext()) throw new Error('kein WebGL');
  } catch (err) {
    window.dispatchEvent(new Event('dice3d-failed'));   // das Spiel bleibt bei den flachen Würfeln
    return;
  }

  // ---------- Aus dem Video gemessen ----------
  const PITCH = 1.51;                          // Abstand der Plätze in Würfelbreiten
  const START_X = 1.9;                         // Start knapp ausserhalb des Bildes rechts
  const STAGGER = [0, 0.04, 0.08, 0.13, 0.18]; // Startversatz der Würfel (s), zufällige Reihenfolge
  const ROLL_END = 0.62;                       // alle Würfel liegen nach rund 0,6 s gemeinsam still
  const X_SPREAD = 0.33;                       // seitliche Abweichung der Landeplätze
  const PROG = [[0, 0], [.083, .10], [.167, .20], [.25, .44], [.333, .55], [.417, .62], [.5, .76], [.583, .79], [.667, .82], [.75, .88], [.833, .94], [.917, .985], [1, 1]];
  const G = 80, H0 = 1.9, REST = 0.36;         // Fall mit Abprallen
  function heightAt(t) {
    const tf = Math.sqrt(2 * H0 / G);
    if (t < tf) return H0 - 0.5 * G * t * t;
    let tt = t - tf, v = G * tf * REST;
    while (v > 0.9) { const fl = 2 * v / G; if (tt < fl) return v * tt - 0.5 * G * tt * tt; tt -= fl; v *= REST; }
    return 0;
  }
  const LANDINGS = (() => {
    const a = []; let tt = Math.sqrt(2 * H0 / G), v = G * tt * REST, imp = 1; a.push([tt, imp]);
    while (v > 0.9) { tt += 2 * v / G; imp *= REST; a.push([tt, imp]); v *= REST; }
    return a;
  })();

  const HALF = 0.5;
  const SLOT = (i) => (i - 2) * PITCH;
  const TILT = 76 * Math.PI / 180;             // Blick fast von oben

  const PR = Math.min(window.devicePixelRatio * 1.4, 4);   // feiner rendern als der Bildschirm, der Browser verkleinert sauber
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'dice3d';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fb79a, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-3, 14, 4);
  scene.add(sun);

  // ---------- Würfel ----------
  const PIPS = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.27, .27], [.5, .5], [.73, .73]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
    5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]], 6: [[.27, .22], [.73, .22], [.27, .5], [.73, .5], [.27, .78], [.73, .78]] };
  function faceTexture(n, held) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.scale(2, 2);
    const bg = g.createLinearGradient(0, 0, 256, 256);
    if (held) { bg.addColorStop(0, '#fffbb8'); bg.addColorStop(1, '#ecdf5c'); } else { bg.addColorStop(0, '#fffefa'); bg.addColorStop(1, '#e4e1d3'); }
    g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
    PIPS[n].forEach(([x, y]) => {
      const px = x * 256, py = y * 256, r = 29;
      const dent = g.createRadialGradient(px - 7, py - 7, 2, px, py, r);
      dent.addColorStop(0, '#2c2c2c'); dent.addColorStop(1, '#000');
      g.fillStyle = dent; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3.5; g.beginPath(); g.arc(px, py, r + 2, 0, Math.PI * 2); g.stroke();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  // Seiten in three: +x, -x, +y, -y, +z, -z ; gegenüberliegende ergeben 7
  const FACES = [
    { n: new THREE.Vector3(1, 0, 0), v: 3 }, { n: new THREE.Vector3(-1, 0, 0), v: 4 },
    { n: new THREE.Vector3(0, 1, 0), v: 2 }, { n: new THREE.Vector3(0, -1, 0), v: 5 },
    { n: new THREE.Vector3(0, 0, 1), v: 1 }, { n: new THREE.Vector3(0, 0, -1), v: 6 },
  ];
  const mk = (held) => FACES.map((f) => new THREE.MeshPhysicalMaterial({ map: faceTexture(f.v, held), roughness: 0.4, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22 }));
  const MAT_NORMAL = mk(false), MAT_HELD = mk(true);
  const geo = new RoundedBoxGeometry(1, 1, 1, 5, 0.13);

  // Leuchten und Schatten als exakt berechnete Texturen (eine Zeichenfläche würde schwache Farbverläufe verrauscht speichern)
  const smooth = (a, b, x) => { const s = Math.min(1, Math.max(0, (x - a) / (b - a))); return s * s * (3 - 2 * s); };
  function alphaTexture(size, rgb, fn) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, a = fn((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, a)));
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    return tex;
  }
  const sq = (u, v) => Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
  const glowTex = alphaTexture(128, [205, 255, 70], (u, v) => 0.92 * (1 - smooth(0.66, 1, sq(u, v))));
  const shadowTex = alphaTexture(128, [0, 0, 0], (u, v) => 0.62 * (1 - smooth(0.42, 0.98, sq(u, v))));

  const UP = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(UP, a);
  function faceUpQuat(v, yaw) {   // gewünschte Zahl oben, beliebig gedreht
    const f = FACES.find((x) => x.v === v);
    const twist = new THREE.Quaternion().setFromAxisAngle(f.n, Math.floor(Math.random() * 4) * Math.PI / 2);
    return yawQ(yaw).multiply(new THREE.Quaternion().setFromUnitVectors(f.n, UP).multiply(twist));
  }
  function straightQuat(q, yawExtra) {   // gerade ausrichten, Kanten parallel zur Spalte
    let best = FACES[0], bd = -2;
    for (const f of FACES) { const y = f.n.clone().applyQuaternion(q).y; if (y > bd) { bd = y; best = f; } }
    const q2 = new THREE.Quaternion().setFromUnitVectors(best.n.clone().applyQuaternion(q), UP).multiply(q);
    const a = Math.abs(best.n.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const wa = a.applyQuaternion(q2);
    const ang = Math.atan2(-wa.z, wa.x);
    return yawQ(Math.round(ang / (Math.PI / 2)) * (Math.PI / 2) - ang + yawExtra).multiply(q2);
  }
  function lerpKeys(keys, u) {
    if (u <= keys[0][0]) return keys[0][1];
    for (let k = 1; k < keys.length; k++) {
      if (u <= keys[k][0]) {
        const [u0, v0] = keys[k - 1], [u1, v1] = keys[k];
        const s = (u - u0) / (u1 - u0);
        return v0 + (v1 - v0) * (s * s * (3 - 2 * s) * 0.35 + s * 0.65);
      }
    }
    return keys[keys.length - 1][1];
  }

  const _e = new THREE.Euler();
  const dice = Array.from({ length: 5 }, (_, i) => {
    const mesh = new THREE.Mesh(geo, MAT_NORMAL); mesh.visible = false; scene.add(mesh);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.42), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.visible = false; glow.renderOrder = 1; scene.add(glow);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.order = 'YXZ'; shadow.rotation.x = -Math.PI / 2; shadow.visible = false; shadow.renderOrder = 2; scene.add(shadow);
    return { i, mesh, glow, shadow, value: 0, held: false, roll: null, anim: null };
  });
  // Leuchten (gehaltene Würfel) und weicher, schwacher Schatten folgen dem Würfel
  function syncAux(d) {
    const p = d.mesh.position, vis = d.mesh.visible;
    const h = Math.max(0, p.y - HALF);
    d.shadow.visible = vis; d.glow.visible = vis && d.held && !d.roll;
    if (!vis) return;
    _e.setFromQuaternion(d.mesh.quaternion, 'YXZ');
    d.shadow.rotation.y = _e.y;
    d.shadow.position.set(p.x + 0.08 + 0.3 * h, 0.012, p.z + 0.1 + 0.3 * h);
    d.shadow.scale.setScalar(1 + 0.25 * h);
    d.shadow.material.opacity = (d.held ? 0.12 : 0.26) / (1 + 1.6 * h);
    d.glow.position.set(p.x, 0.006, p.z);
  }
  function setRest(d, p, q) { d.mesh.position.copy(p); d.mesh.quaternion.copy(q); syncAux(d); }
  function paintHeld(d) { d.mesh.material = d.held ? MAT_HELD : MAT_NORMAL; syncAux(d); }

  // ---------- Kamera: alle fünf Plätze passen immer ganz ins Bild, Würfelgrösse wie im Spiel ----------
  let host = null, ro = null, lastW = 0, lastH = 0;
  function fit() {
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    if (w !== lastW || h !== lastH) { renderer.setSize(w, h, false); lastW = w; lastH = h; }   // nur bei echter Grössenänderung neu anlegen
    camera.aspect = w / h;
    const dpx = Math.min(window.innerWidth * 0.15, 70);      // Würfelkante in Pixeln
    const edge = 2 * PITCH + 0.95;
    const pts = [[-1.2, 0, -edge], [1.2, 0, -edge], [-1.2, 0, edge], [1.2, 0, edge], [0, 1.4, -edge], [0, 1.4, edge]].map((a) => new THREE.Vector3(...a));
    const place = (dist) => { camera.position.set(0, Math.sin(TILT) * dist, Math.cos(TILT) * dist); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); };
    const fits = () => pts.every((p) => { const v = p.clone().project(camera); return Math.abs(v.x) <= 0.99 && Math.abs(v.y) <= 0.985; });
    let lo = 6, hi = 400;
    for (let it = 0; it < 34; it++) {
      const dist = (lo + hi) / 2; place(dist);
      const a = new THREE.Vector3(-0.5, 0.5, 0).project(camera), b = new THREE.Vector3(0.5, 0.5, 0).project(camera);
      if ((b.x - a.x) / 2 * w > dpx) lo = dist; else hi = dist;
    }
    let dist = (lo + hi) / 2; place(dist);
    while (!fits() && dist < 400) { dist += 0.4; place(dist); }
    requestRender();
  }
  function mount(el) {
    if (!el) return;
    if (host === el && canvas.parentNode === el) return;
    host = el;
    el.appendChild(canvas);
    if (ro) ro.disconnect();
    ro = new ResizeObserver(fit); ro.observe(el);
    fit();
  }

  // ---------- Ablauf ----------
  let mode = 'idle', rafId = 0, last = 0, clock = 0, rollEnd = 0, pendingSet = null, tapFn = null, rollStartReal = 0;

  function restPlace(d, v, held) {   // Würfel ruhend an seinem Platz ablegen (Wiederherstellen, Halten)
    d.value = v; d.held = held;
    const x = held ? 0 : rnd(-X_SPREAD, X_SPREAD);
    const q = faceUpQuat(v, held ? 0 : rnd(-.55, .55));
    d.mesh.visible = true; d.mesh.material = held ? MAT_HELD : MAT_NORMAL;
    setRest(d, new THREE.Vector3(x, HALF, SLOT(d.i)), held ? straightQuat(q, 0) : q);
  }

  // werte: 5 Zahlen (0 = noch nicht gewürfelt, Würfel unsichtbar), gehalten: 5 Wahrheitswerte
  function setDice(values, held) {
    const cancel = values.some((v) => !v) && mode === 'rolling';
    if (mode === 'rolling' && !cancel) { pendingSet = { values: values.slice(), held: held.slice() }; dice.forEach((d, i) => { if (!d.roll) applyOne(d, values[i], !!held[i]); }); return; }
    if (cancel) { dice.forEach((d) => { d.roll = null; }); mode = 'idle'; }
    dice.forEach((d, i) => applyOne(d, values[i], !!held[i]));
    requestRender();
  }
  function applyOne(d, v, held) {
    if (!v) { d.value = 0; d.held = false; d.anim = null; d.mesh.visible = false; syncAux(d); return; }
    if (!d.mesh.visible || d.value !== v) { restPlace(d, v, held); return; }
    if (d.held !== held) {   // Halten: gelb und gerade, in der Spaltenmitte; Loslassen: wieder leicht gekippt
      d.held = held; paintHeld(d);
      const p = d.mesh.position.clone(); if (held) p.x = 0;
      startAnim(d, straightQuat(d.mesh.quaternion, held ? 0 : rnd(-.55, .55)), 200, p);
    }
  }

  // maske[i] = true: Würfel i wird neu geworfen und landet auf werte[i]
  function roll(values, mask) {
    const loose = dice.filter((d, i) => mask[i] && values[i]);
    dice.forEach((d, i) => { if (!(mask[i] && values[i])) applyOne(d, values[i], d.held); });
    if (!loose.length) { requestRender(); return; }
    mode = 'rolling'; pendingSet = null; rollStartReal = performance.now();
    const order = loose.slice().sort(() => Math.random() - .5);
    // gemeinsam für alle Würfel dieses Wurfs: gleiche Drehrichtung, gleiche Überschläge, gleiche Ruhezeit
    const turnsAll = 3 + Math.floor(Math.random() * 3), yawAll = rnd(1.8, 2.8), endAll = clock + ROLL_END + rnd(-0.015, 0.015);
    order.forEach((d, k) => {
      const v = values[d.i];
      d.value = v; d.held = false; d.anim = null;
      d.mesh.material = MAT_NORMAL;
      d.roll = {
        t0: clock + STAGGER[k], dur: endAll - (clock + STAGGER[k]) + rnd(-0.012, 0.012),
        span: Math.max(0.42, endAll - 0.1 - (clock + STAGGER[k])),   // Bewegung und Drehung enden gemeinsam
        xf: rnd(-X_SPREAD, X_SPREAD), zf: SLOT(d.i) + rnd(-0.03, 0.03), qf: faceUpQuat(v, rnd(-.6, .6)),
        turns: turnsAll, yaw0: yawAll * rnd(0.97, 1.03),
      };
      d.mesh.visible = false; syncAux(d);
      if (window.Sfx) LANDINGS.forEach(([lt, imp]) => window.Sfx.knock(d.roll.t0 - clock + lt, imp));
    });
    rollEnd = Math.max(...loose.map((d) => d.roll.t0 + d.roll.dur));
    requestRender();
  }

  function stepRoll(d) {
    const r = d.roll; if (!r) return false;
    const u = (clock - r.t0) / r.dur;
    if (u < 0) return true;
    d.mesh.visible = true;
    if (u >= 1) { d.roll = null; setRest(d, new THREE.Vector3(r.xf, HALF, r.zf), r.qf); return false; }
    const ue = Math.min(1, (clock - r.t0) / r.span);
    const p = lerpKeys(PROG, ue);
    const pr = 1 - Math.pow(1 - ue, 2.4);
    const rolling = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -r.turns * Math.PI / 2 * (1 - pr));
    d.mesh.position.set(r.xf + START_X * (1 - p), HALF + heightAt(clock - r.t0), r.zf);
    d.mesh.quaternion.copy(yawQ(-r.yaw0 * (1 - pr)).multiply(rolling).multiply(r.qf));
    syncAux(d);
    return true;
  }

  const easeInOut = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function startAnim(d, toQ, ms, toP) {
    d.anim = { t0: performance.now(), ms, fromP: d.mesh.position.clone(), fromQ: d.mesh.quaternion.clone(), toP, toQ };
    requestRender();
  }
  function stepAnim(d, now) {
    const a = d.anim; if (!a) return false;
    const t = Math.min(1, (now - a.t0) / a.ms), e = easeInOut(t);
    d.mesh.position.lerpVectors(a.fromP, a.toP, e); d.mesh.quaternion.slerpQuaternions(a.fromQ, a.toQ, e);
    syncAux(d);
    if (t >= 1) d.anim = null;
    return t < 1;
  }

  // ---------- Zeichnen (nur solange etwas in Bewegung ist) ----------
  function requestRender() { if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(loop); } }
  function loop(now) {
    rafId = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let moving = false;
    if (mode === 'rolling') {
      clock += dt;
      if (performance.now() - rollStartReal > 3500) clock = rollEnd + 1;   // Sicherung (z. B. App war im Hintergrund): Würfel sofort an ihren Platz
      dice.forEach((d) => { if (stepRoll(d)) moving = true; });
      if (clock >= rollEnd) {
        mode = 'idle';
        dice.forEach(syncAux);
        if (pendingSet) { const s = pendingSet; pendingSet = null; dice.forEach((d, i) => applyOne(d, s.values[i], !!s.held[i])); }
      }
    }
    dice.forEach((d) => { if (stepAnim(d, now)) moving = true; });
    renderer.render(scene, camera);
    if (moving || mode !== 'idle') rafId = requestAnimationFrame(loop);
  }

  // ---------- Antippen ----------
  const ray = new THREE.Raycaster();
  canvas.addEventListener('pointerdown', (e) => {
    if (!tapFn || mode !== 'idle') return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(dice.filter((d) => d.mesh.visible).map((d) => d.mesh))[0];
    if (hit) tapFn(dice.find((d) => d.mesh === hit.object).i);
  });
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => requestRender());
  window.addEventListener('resize', fit);

  // Bildschirmposition und Radius jedes sichtbaren Würfels (für die Vibrations-Schalter über den Würfeln)
  function rects() {
    const r = canvas.getBoundingClientRect();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    return dice.filter((d) => d.mesh.visible).map((d) => {
      const c = d.mesh.position.clone().project(camera);
      const e = d.mesh.position.clone().addScaledVector(right, 0.6).project(camera);
      return { i: d.i, x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height, r: Math.abs(((e.x - c.x) / 2) * r.width) };
    });
  }

  window.Dice3D = { mount, setDice, roll, rects, busy: () => mode === 'rolling', onTap: (fn) => { tapFn = fn; }, values: () => dice.map((d) => (d.mesh.visible ? d.value : 0)), heldFlags: () => dice.map((d) => d.held) };
  window.dispatchEvent(new Event('dice3d-ready'));
})();
