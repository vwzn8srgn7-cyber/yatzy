// Töne (WebAudio, ohne Dateien) und Haptik. Ein gemeinsamer Ein/Aus-Schalter, bleibt auf dem Gerät gespeichert.
(function (root) {
  let ac = null;
  let noiseBuf = null;
  let on = true;
  try { on = localStorage.getItem('yatzy-sound') !== 'off'; } catch { /* ignorieren */ }

  // Audio-System holen. iOS stoppt es bei Hintergrund, Anruf oder Sperrbildschirm ("suspended" oder "interrupted")
  // und startet es nur nach einer Berührung wieder: darum hier alles, was nicht "running" ist, neu anstossen
  // und ein geschlossenes System neu erzeugen.
  function ctx() {
    if (!on) return null;
    if (ac && ac.state === 'closed') { ac = null; noiseBuf = null; }
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ac = new C(); } catch { return null; }
    }
    if (ac.state !== 'running') { try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignorieren */ } }
    return ac;
  }
  // Jede Berührung weckt das Audio-System wieder auf, damit spätere Töne (z. B. Züge der anderen Spieler) hörbar bleiben
  function wake() { if (on && ac && ac.state !== 'running' && ac.state !== 'closed') { try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignorieren */ } } }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { ctx(); wake(); }, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  function tone(freq, t0, dur, { type = 'sine', vol = 0.18, slideTo } = {}) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + t0;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function noise(a) {
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.06), a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Haptik: Android/Chrome per Vibration API, iOS-Safari (17.4+) über den Schalter-Trick
  let sw = null;
  function buzz(pattern) {
    if (!on) return;
    try {
      if (navigator.vibrate) { navigator.vibrate(pattern); return; }
      if (!sw) {
        sw = document.createElement('label');
        sw.setAttribute('aria-hidden', 'true');
        sw.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        sw.appendChild(input);
        document.head.appendChild(sw);
      }
      sw.click();
      if (Array.isArray(pattern) && pattern.length > 1) setTimeout(() => sw.click(), 90);
    } catch { /* Haptik nicht verfügbar */ }
  }

  const Sfx = {
    isOn: () => on,
    setOn(v) {
      on = !!v;
      try { localStorage.setItem('yatzy-sound', on ? 'on' : 'off'); } catch { /* ignorieren */ }
      if (on) ctx();   // beim Einschalten das Audio-System frisch anstossen
    },
    _state: () => (ac ? ac.state : 'noch nicht erzeugt'),
    buzz,
    // Würfel-Aufprall (3D-Würfel): dumpfer Schlag plus kurzes Klacken; delay in Sekunden ab jetzt, imp = Stärke 0..1 (leiser als vorher)
    knock(delay, imp) {
      const a = ctx(); if (!a) return;
      const t0 = a.currentTime + Math.max(0, delay);
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(190 + (Math.random() - .5) * 50, t0); o.frequency.exponentialRampToValueAtTime(70, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.27 * imp + 0.015, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + 0.13);
      const src = a.createBufferSource(); src.buffer = noise(a);
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + (Math.random() - .3) * 700; f.Q.value = 1.1;
      const g2 = a.createGain(); g2.gain.setValueAtTime(0.18 * imp, t0); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
      src.connect(f); f.connect(g2); g2.connect(a.destination); src.start(t0);
    },
    // Rattern der flachen Würfel (Rückfall ohne 3D)
    roll() {
      [0, 0.07, 0.13, 0.2, 0.29, 0.4, 0.55].forEach((t, i) => {
        tone(320 - i * 20 + Math.random() * 40, t, 0.07, { type: 'sine', vol: 0.16 * (1 - i * 0.1), slideTo: 110 });
        Sfx.knock(t, 0.35 * (1 - i * 0.1));
      });
      buzz([15, 40, 15]);
    },
    rollHaptic() { buzz([15, 40, 15]); },
    turn() { tone(784, 0, 0.12, { vol: 0.14 }); tone(1047, 0.1, 0.22, { vol: 0.14 }); buzz(20); },
    hold() { tone(880, 0, 0.05, { type: 'triangle', vol: 0.085 }); buzz(8); },
    rec() { [784, 988, 1319].forEach((f, i) => tone(f, i * 0.08, 0.22, { type: 'triangle', vol: 0.13 })); buzz([20, 30, 20]); },
    chat() { tone(880, 0, 0.07, { vol: 0.09 }); tone(1175, 0.06, 0.1, { vol: 0.09 }); },
    score(points) {
      if (points > 0) { tone(660, 0, 0.12); tone(990, 0.08, 0.18); }
      else tone(220, 0, 0.22, { type: 'triangle', slideTo: 120, vol: 0.2 });
      buzz(25);
    },
    yatzy() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.3, { type: 'triangle', vol: 0.2 })); buzz([30, 40, 30, 40, 60]); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1 + i * 0.14, 0.45, { type: 'triangle', vol: 0.2 })); tone(1047, 0.7, 0.8, { vol: 0.12 }); },
  };
  root.Sfx = Sfx;
})(window);
