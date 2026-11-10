// Töne (WebAudio, ohne Dateien) und Haptik. Ein gemeinsamer Ein/Aus-Schalter.
(function (root) {
  let ac = null;
  let noiseBuf = null;
  let on = true;
  try { on = localStorage.getItem('yatzy-sound') !== 'off'; } catch { /* ignorieren */ }

  function ctx() {
    if (!on) return null;
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

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

  // Kurzer „Klack“ aus gefiltertem Rauschen (Würfel auf Holz)
  function knock(t0, vol, freq) {
    const a = ctx(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.06), a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + t0;
    const s = a.createBufferSource(); s.buffer = noiseBuf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(t);
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
    },
    buzz,
    roll() {
      // weiches Holz-„Tok-tok“: tiefe, kurze Töne statt scharfem Rauschen
      [0, 0.07, 0.13, 0.2, 0.29, 0.4, 0.55].forEach((t, i) => {
        const v = 0.22 * (1 - i * 0.1);
        tone(320 - i * 20 + Math.random() * 40, t, 0.07, { type: 'sine', vol: v, slideTo: 110 });
        knock(t, 0.12 * (1 - i * 0.1), 700 + Math.random() * 500);
      });
      buzz([15, 40, 15]);
    },
    turn() { tone(784, 0, 0.12, { vol: 0.16 }); tone(1047, 0.1, 0.22, { vol: 0.16 }); buzz(20); },
    // Würfel-Aufprall (3D-Würfel): dumpfer Schlag plus kurzes Klacken; delay in Sekunden ab jetzt, imp = Stärke 0..1
    knock(delay, imp) {
      const a = ctx(); if (!a) return;
      const t0 = a.currentTime + Math.max(0, delay);
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(190 + (Math.random() - .5) * 50, t0); o.frequency.exponentialRampToValueAtTime(70, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.45 * imp + 0.02, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + 0.13);
      if (!noiseBuf) {
        noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.06), a.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = a.createBufferSource(); src.buffer = noiseBuf;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + (Math.random() - .3) * 700; f.Q.value = 1.1;
      const g2 = a.createGain(); g2.gain.setValueAtTime(0.32 * imp, t0); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
      src.connect(f); f.connect(g2); g2.connect(a.destination); src.start(t0);
    },
    rollHaptic() { buzz([15, 40, 15]); },
    hold() { tone(880, 0, 0.05, { type: 'triangle', vol: 0.12 }); buzz(8); },
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
