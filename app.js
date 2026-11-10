(function () {
  const { CATEGORIES, BONUS_THRESHOLD, score, upperSum, bonus, total } = Scoring;
  const STORAGE_KEY = 'yatzy-state-v1';
  const PICK_KEY = 'yatzy-online-pick';
  const PENDING_KEY = 'yatzy-pending-results';
  const CLIENT_KEY = 'yatzy-client-id';
  const TEST_ROOM = new URLSearchParams(location.search).get('testroom'); // nur zum Testen: eigener Raum, keine Rangliste
  const ROOM = TEST_ROOM ? TEST_ROOM.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TEST' : 'ENGADIN'; // fester Raum, entsteht automatisch beim ersten Beitritt
  const ONLINE_NAMES = ['Vreni', 'Peter', 'Marco', 'Gast']; // Gast darf einen eigenen Namen eingeben
  const app = document.getElementById('app');
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const DEFAULT_NAMES = ['Vreni', 'Peter', 'Marco', 'Spieler 4'];
  const COLORS = ['#2e8bd0', '#e0485a', '#f2c14e', '#4caf50'];
  const ROW_ORDER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', '_sum', '_bonus',
    'pair', 'twoPairs', 'three', 'four', 'small', 'large', 'full', 'chance', 'yatzy', '_total'];
  const LABELS = { _sum: `Summe (${BONUS_THRESHOLD})`, _bonus: 'Bonus', _total: 'Gesamt', pair: '1 Paar', twoPairs: '2 Paare', three: '3 gleiche', four: '4 gleiche', small: 'Kleine Strasse', large: 'Grosse Strasse', yatzy: 'YATZY' };
  const EMPTY_DICE = () => [0, 0, 0, 0, 0];
  const NO_HOLD = () => [false, false, false, false, false];

  const rid = (n = 6) => Math.random().toString(36).slice(2, 2 + n);
  const myId = (() => {
    const q = new URLSearchParams(location.search).get('cid'); // nur zum Testen mit mehreren Tabs
    if (q) return q;
    try {
      let v = localStorage.getItem(CLIENT_KEY);
      if (!v) { v = rid(10); localStorage.setItem(CLIENT_KEY, v); }
      return v;
    } catch { return rid(10); }
  })();

  let state = load() || { phase: 'setup', setup: { count: 1, names: DEFAULT_NAMES.slice() } };
  let setupMode = 'online';  // beim Start immer „Online“
  let justRolled = [];
  let tilts = [0, 1, 2, 3, 4].map(() => newTilt());
  let busy = false;
  let lobby = [];            // Presence-Liste des Raums
  let onlineIds = new Set(); // wer gerade verbunden ist
  let netStatus = '';        // Hinweistext in der Lobby
  let setupError = '';
  let boardData = null;      // gemeinsame Rangliste (aus der Datenbank)
  let offSince = 0;          // seit wann ist der aktive Spieler offline?
  let takenSlots = new Set(); // Namen, die im Raum schon vergeben sind

  function newTilt() { return { r: Math.round(Math.random() * 70 - 35), x: Math.round(Math.random() * 28 - 14) }; }
  function load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Speicher nicht verfügbar */ } }
  function set(patch) { state = { ...state, ...patch }; save(); render(); }
  const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const label = (id) => LABELS[id] || CATEGORIES.find((c) => c.id === id).label;
  const initial = (p) => (/^Spieler \d$/.test(p.name) ? p.name.slice(-1) : p.name.slice(0, 1).toUpperCase());
  const avatar = (p, i, cls = '') => `<div class="avatar ${cls}" style="background:${COLORS[i]}">${h(initial(p))}</div>`;
  const isOnline = () => !!state.online;
  const isMyTurn = () => !state.online || (state.players && state.players[state.current] && state.players[state.current].id === myId);
  const getPick = () => { try { return JSON.parse(localStorage.getItem(PICK_KEY)) || {}; } catch { return {}; } };
  const setPick = (p) => { try { localStorage.setItem(PICK_KEY, JSON.stringify({ ...getPick(), ...p })); } catch { /* ignorieren */ } };

  // Gewählter Name (Platz 0–3), springt auf den ersten freien, falls der gewählte vergeben ist
  function currentSlot() {
    let slot = Math.min(Math.max(getPick().slot ?? 0, 0), 3);
    if (takenSlots.has(slot)) {
      const free = [0, 1, 2, 3].find((i) => !takenSlots.has(i));
      if (free !== undefined) slot = free;
    }
    return slot;
  }
  function startPeek() {
    Net.peek(ROOM, (list) => {
      takenSlots = new Set(list.filter((p) => p.id !== myId).map((p) => p.slot));
      if (state.phase !== 'setup' || setupMode !== 'online') return;
      const slot = currentSlot();
      const guestShown = !!document.getElementById('guest');
      if ((slot === 3) !== guestShown) { setPick({ slot }); render(); return; }
      document.querySelectorAll('[data-slot]').forEach((b) => {
        const i = +b.dataset.slot;
        b.classList.toggle('on', i === slot);
        b.classList.toggle('taken', takenSlots.has(i));
        b.disabled = takenSlots.has(i);
      });
      const j = document.getElementById('ojoin');
      if (j) j.disabled = takenSlots.size >= 4;
    });
  }

  // ---------- Gemeinsame Rangliste (Datenbank), mit Zwischenspeicher falls offline ----------
  function pendingList() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; } }
  function setPending(list) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* ignorieren */ } }
  async function flushPending() {
    const list = pendingList();
    if (!list.length) return;
    const rest = [];
    for (const g of list) { if (!(await Net.saveResult(g.gameId, g.rows))) rest.push(g); }
    setPending(rest);
  }
  // Pro Spiel nur einmal melden (auch nach Reload oder Wiederverbinden)
  function maybeRecord() {
    if (TEST_ROOM || state.phase !== 'over' || state.players.length < 2 || state.recordedId === state.gameId) return;
    state.recordedId = state.gameId;
    save();
    const totals = state.players.map((p) => total(p.scores));
    const best = Math.max(...totals);
    const rows = state.players.map((p, i) => ({ name: p.name, score: totals[i], won: totals[i] === best }));
    setPending([...pendingList(), { gameId: state.gameId, rows }]);
    flushPending().then(refreshBoard);
  }
  // Rekorde vor dem Spiel merken, damit am Ende ein neuer Rekord erkannt wird (auf allen Geräten gleich)
  function snapshotBest() {
    const gid = state.gameId;
    Net.fetchBoard().then((d) => {
      if (!d || state.gameId !== gid) return;
      state.prevBest = Object.fromEntries(d.map((r) => [r.name.toLowerCase(), r.best]));
      save();
    });
  }
  function newRecords() {
    const prev = state.prevBest;
    if (!prev || state.players.length < 2) return [];
    return state.players.map((p) => ({ name: p.name, score: total(p.scores) }))
      .filter((r) => prev[r.name.toLowerCase()] !== undefined && r.score > prev[r.name.toLowerCase()]);
  }
  function clearFx() { document.querySelectorAll('.rec-fx,.turn-toast').forEach((e) => e.remove()); }
  function showRecord(recs) {
    const el = document.createElement('div');
    el.className = 'rec-fx';
    const conf = Array.from({ length: 36 }, (_, i) => `<i style="left:${Math.round(Math.random() * 100)}%;background:${COLORS[i % 4]};animation-delay:${(Math.random() * 0.9).toFixed(2)}s;--dx:${Math.round(Math.random() * 140 - 70)}px"></i>`).join('');
    el.innerHTML = `${conf}<div class="rec-box"><div class="rec-t">🏆 Neuer Rekord</div>${recs.map((r) => `<div class="rec-n">${h(r.name)}</div><div class="rec-s">${r.score}</div>`).join('')}</div>`;
    document.body.appendChild(el);
    Sfx.yatzy();
    setTimeout(() => el.remove(), 4200);
  }

  function boardRows() {
    return (boardData || [])
      .map((s) => ({ ...s, pct: Math.round((100 * s.wins) / s.games) }))
      .sort((a, b) => b.pct - a.pct || b.games - a.games || a.name.localeCompare(b.name))
      .slice(0, 3);
  }
  function boardHTML() {
    const top = boardRows();
    const rows = top.length
      ? top.map((s, i) => `<div class="brow"><span class="rk">${i + 1}</span><span class="bn">${h(s.name)}</span><span class="bp">${s.pct} %</span><span class="br">Rekord ${s.best ?? '–'}</span></div>`).join('')
      : `<div class="bempty">${boardData ? 'Noch keine Spiele gespielt' : 'Lade …'}</div>`;
    return `<div class="board"><div class="bt"><span>Rangliste</span><span class="bcap">(Siege in Prozent)</span></div>${rows}</div>`;
  }
  async function refreshBoard() {
    const data = await Net.fetchBoard();
    if (data) boardData = data;
    const el = document.querySelector('.board');
    if (el) el.outerHTML = boardHTML();
  }

  // ---------- Online: Verbindung & Nachrichten ----------
  const pub = () => {
    const { players, current, dice, held, rollsLeft, phase, gameId, seq } = state;
    return { players, current, dice, held, rollsLeft, phase, gameId, seq };
  };
  function broadcastState(rolled) {
    if (state.online) Net.send({ t: 'state', s: pub(), rolled: rolled || [] });
  }

  function connectOnline() {
    const { room, name, slot } = state.online;
    netStatus = 'Verbinde …';
    Net.join(room, {
      id: myId, name, slot,
      onMsg: onNetMsg,
      onPresence,
      onStatus(st) {
        if (st === 'ok') { netStatus = ''; Net.send({ t: 'hello', id: myId }); }
        else if (st === 'NO_LIB') netStatus = 'Online-Modul konnte nicht geladen werden (Internet?)';
        else netStatus = 'Verbindung unterbrochen – verbinde neu …';
        if (state.phase === 'lobby') render();
      },
    });
  }

  function leaveRoom(msg) {
    Net.leave();
    clearFx();
    lobby = []; onlineIds = new Set(); offSince = 0;
    setupError = msg || '';
    justRolled = []; busy = false;
    setupMode = 'online';
    state = { phase: 'setup', setup: state.setup || { count: 1, names: DEFAULT_NAMES.slice() } };
    save(); render();
  }

  function onPresence(list) {
    lobby = list;
    onlineIds = new Set(list.map((p) => p.id));
    if (!state.online) return;
    if (state.phase === 'lobby') {
      const myIdx = list.findIndex((p) => p.id === myId);
      if (myIdx >= 4) { leaveRoom('Der Raum ist voll (max. 4 Spieler).'); return; }
      // Derselbe Name zweimal (gleichzeitig gewählt)? Wer später kam, wählt neu.
      if (myIdx > 0 && list.slice(0, myIdx).some((p) => p.slot === list[myIdx].slot)) { leaveRoom('Dieser Name ist gerade vergeben. Bitte einen anderen wählen.'); return; }
      // Alle bereit (mindestens 2)? Der erste in der festen Reihenfolge startet für alle.
      const shown = list.slice(0, 4);
      if (shown.length >= 2 && shown.every((p) => p.ready) && shown[0].id === myId) { startOnlineGame(shown); return; }
      render();
    } else if (!busy) {
      render(); // Avatare abdunkeln und Offline-Hinweis aktualisieren
    }
  }

  function beginOnline(m) {
    state = {
      setup: state.setup, online: state.online, phase: 'game',
      players: m.players.map((p) => ({ id: p.id, name: p.name, scores: {} })),
      current: 0, dice: EMPTY_DICE(), held: NO_HOLD(), rollsLeft: 3, gameId: m.gameId, seq: 0,
    };
    justRolled = []; busy = false; offSince = 0;
    clearFx();
    save(); render();
    snapshotBest();
    if (isMyTurn()) Sfx.turn();
  }

  function onNetMsg(m) {
    if (!state.online || !m) return;
    if (m.t === 'start') {
      if (m.gameId !== state.gameId && m.players.some((p) => p.id === myId)) beginOnline(m);
    } else if (m.t === 'state') {
      applyRemote(m);
    } else if (m.t === 'hello') {
      // Nur Mitspieler des laufenden Spiels bekommen den Stand (beim Wiederverbinden), nicht Fremde in der Lobby
      if (state.gameId && (state.phase === 'game' || state.phase === 'over') && state.players.some((p) => p.id === m.id)) broadcastState([]);
    } else if (m.t === 'ping') {
      if (state.gameId === m.gameId && state.seq > m.seq) broadcastState([]);
    }
  }

  function applyRemote(m) {
    const s = m.s;
    if (!s || !s.players) return;
    if (s.gameId !== state.gameId) {
      // Ein laufendes oder neues Spiel, in dem ich mitspiele (z. B. nach Wiederverbinden)
      if (state.phase === 'lobby' || state.phase === 'over') {
        if (s.players.some((p) => p.id === myId)) {
          state = { ...state, ...s, recordedId: undefined };
          justRolled = []; busy = false; save(); render();
        } else if (state.phase === 'lobby') {
          leaveRoom('Im Raum läuft gerade ein Spiel. Versuch es nach dem Spielende nochmal.');
        }
      }
      return;
    }
    if (s.seq <= state.seq) return;
    const prev = state;
    const wasMine = isMyTurn();
    justRolled = m.rolled || [];
    tilts = tilts.map((t, i) => (justRolled[i] ? newTilt() : t));
    state = { ...state, ...s };
    busy = false;
    // Töne für Züge der anderen
    if (s.current === prev.current && s.rollsLeft < prev.rollsLeft) Sfx.roll();
    else if (s.current !== prev.current || (s.phase === 'over' && prev.phase !== 'over')) {
      const who = prev.players[prev.current];
      const after = s.players[prev.current];
      const key = Object.keys(after.scores).find((k) => who.scores[k] === undefined);
      const pts = key ? after.scores[key] : 0;
      if (key === 'yatzy' && pts > 0) Sfx.yatzy(); else Sfx.score(pts);
    }
    if (s.phase === 'over' && prev.phase !== 'over') setTimeout(() => Sfx.win(), 250);
    else if (!wasMine && isMyTurn() && s.current !== prev.current) setTimeout(() => Sfx.turn(), 350);
    save();
    maybeRecord();
    render();
  }

  function enterLobby() {
    const pick = getPick();
    const slot = currentSlot();
    let name = ONLINE_NAMES[slot];
    if (slot === 3) name = (pick.guest || '').trim().slice(0, 12) || 'Gast';
    setupError = '';
    state = { setup: state.setup, phase: 'lobby', online: { room: ROOM, name, slot } };
    save(); render();
    connectOnline();
  }
  function startOnlineGame(players) {
    const m = { gameId: rid(), players: players.map(({ id, name }) => ({ id, name })) };
    beginOnline(m);
    Net.send({ t: 'start', ...m });
  }

  // ---------- Spiel-Logik ----------
  function startGame(names) {
    const count = names ? names.length : state.setup.count;
    const list = names || state.setup.names;
    const players = Array.from({ length: count }, (_, i) => ({
      name: (list[i] || '').trim() || DEFAULT_NAMES[i],
      scores: {},
    }));
    state = { setup: state.setup, phase: 'game', players, current: 0, dice: EMPTY_DICE(), held: NO_HOLD(), rollsLeft: 3, gameId: rid(), seq: 0 };
    justRolled = []; busy = false;
    clearFx();
    save(); render();
    snapshotBest();
  }

  function roll() {
    if (state.rollsLeft === 0 || state.phase !== 'game' || busy || !isMyTurn()) return;
    const dice = state.dice.map((d, i) => (state.held[i] && d ? d : 1 + Math.floor(Math.random() * 6)));
    justRolled = dice.map((_, i) => !(state.held[i] && state.dice[i]));
    tilts = tilts.map((t, i) => (justRolled[i] ? newTilt() : t));
    const held = state.held; // gehaltene Würfel bleiben auch nach dem letzten Wurf gerade
    set({ dice, held, rollsLeft: state.rollsLeft - 1, seq: state.seq + 1 });
    broadcastState(justRolled);
    Sfx.roll();
  }

  function toggleHold(i) {
    if (state.rollsLeft === 3 || state.rollsLeft === 0 || busy || !isMyTurn()) return;
    const held = state.held.slice();
    held[i] = !held[i];
    Sfx.hold();
    justRolled = [];
    set({ held, seq: state.seq + 1 });
    broadcastState([]);
  }

  function commit(catId) {
    const players = state.players.map((pl, i) =>
      i === state.current ? { ...pl, scores: { ...pl.scores, [catId]: score(catId, state.dice) } } : pl);
    const done = players.every((pl) => Object.keys(pl.scores).length === CATEGORIES.length);
    justRolled = []; busy = false;
    set({
      players,
      current: done ? state.current : (state.current + 1) % players.length,
      dice: EMPTY_DICE(), held: NO_HOLD(), rollsLeft: 3,
      phase: done ? 'over' : 'game',
      seq: state.seq + 1,
    });
    broadcastState([]);
    if (done) { maybeRecord(); setTimeout(() => Sfx.win(), 250); }
  }

  // Burst-Effekt auf dem Feld, danach eintragen
  function choose(catId, bubble) {
    const p = state.players[state.current];
    if (busy || !isMyTurn() || p.scores[catId] !== undefined || state.rollsLeft === 3) return;
    busy = true;
    bubble.classList.add('pressed');
    const burst = document.createElement('div');
    burst.className = 'burst';
    bubble.parentElement.appendChild(burst);
    const pts = score(catId, state.dice);
    if (catId === 'yatzy' && pts > 0) Sfx.yatzy(); else Sfx.score(pts);
    setTimeout(() => commit(catId), 480);
  }

  function newGame() {
    justRolled = []; busy = false;
    setupMode = 'local';
    const names = state.players ? DEFAULT_NAMES.map((d, i) => (state.players[i] ? state.players[i].name : d)) : DEFAULT_NAMES.slice();
    set({ phase: 'setup', setup: { ...state.setup, count: state.players ? state.players.length : 1, names } });
  }

  // ---------- Rendering ----------
  function soundIcon() {
    return Sfx.isOn()
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  }
  const LOGO_COLORS = ['#2e8bd0', '#e0485a', '#f2c14e', '#4caf50', '#2e8bd0'];
  const LOGO_TILT = [-6, 4, -3, 5, -4];
  function logoHTML() {
    const die = `<svg class="logo-die" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-12 32 32)">
      <rect x="7" y="11" width="50" height="50" rx="13" fill="#0e4a29" opacity=".3"/><rect x="7" y="8" width="50" height="50" rx="13" fill="#b9c8b2"/><rect x="7" y="5" width="50" height="50" rx="13" fill="#fff"/>
      <circle cx="21" cy="19" r="5.2" fill="#2e8bd0"/><circle cx="43" cy="19" r="5.2" fill="#e0485a"/><circle cx="32" cy="30" r="5.2" fill="#1c1917"/><circle cx="21" cy="41" r="5.2" fill="#f2c14e"/><circle cx="43" cy="41" r="5.2" fill="#4caf50"/></g></svg>`;
    const word = [...'YATZY'].map((c, i) => `<span style="--lc:${LOGO_COLORS[i]};--rot:${LOGO_TILT[i]}deg">${c}</span>`).join('');
    return `<div class="logo" role="img" aria-label="Yatzy">${die}<div class="wm">${word}</div></div>`;
  }
  async function shareApp() {
    const url = location.origin + location.pathname; // ohne Zusätze wie ?testroom
    try {
      if (navigator.share) { await navigator.share({ title: 'Yatzy', text: 'Spiel mit uns Yatzy!', url }); return; }
      await navigator.clipboard.writeText(url);
      const t = document.createElement('div');
      t.className = 'turn-toast'; t.style.setProperty('--pc', '#9edb2a'); t.textContent = 'Link kopiert ✓';
      t.onanimationend = () => t.remove();
      document.body.appendChild(t);
    } catch { /* abgebrochen */ }
  }
  function wireSound() {
    document.getElementById('snd').onclick = (e) => {
      Sfx.setOn(!Sfx.isOn());
      e.currentTarget.innerHTML = soundIcon();
      Sfx.hold();
    };
  }

  function renderSetup() {
    const { count, names } = state.setup;
    const pick = getPick();
    const slot = currentSlot();
    const local = `
        <div class="count">${[1, 2, 3, 4].map((n) => `<button data-count="${n}" class="${n === count ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="names">
          ${Array.from({ length: count }, (_, i) => `<input data-name="${i}" maxlength="12" placeholder="${DEFAULT_NAMES[i]}" value="${h(names[i])}">`).join('')}
        </div>
        <button class="lime-btn" id="start">Spiel starten</button>`;
    const onl = `
        <div class="who">${ONLINE_NAMES.map((n, i) => `<button data-slot="${i}" class="${i === slot ? 'on' : ''} ${takenSlots.has(i) ? 'taken' : ''}" ${takenSlots.has(i) ? 'disabled' : ''}>${n}</button>`).join('')}</div>
        ${slot === 3 ? `<div class="names"><input id="guest" maxlength="12" placeholder="Dein Name" value="${h(pick.guest || '')}"></div>` : ''}
        <button class="lime-btn" id="ojoin" ${takenSlots.size >= 4 ? 'disabled' : ''}>Zum Spiel</button>
        <div class="err">${h(setupError)}</div>`;
    app.innerHTML = `
      <div class="setup">
        <button class="round snd" id="snd" aria-label="Ton an/aus">${soundIcon()}</button>
        <button class="round snd share" id="share" aria-label="Link teilen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M6 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H18"/></svg></button>
        ${logoHTML()}
        <div class="modes"><button data-mode="online" class="${setupMode === 'online' ? 'on' : ''}">Online</button><button data-mode="local" class="${setupMode === 'local' ? 'on' : ''}">Offline</button></div>
        ${setupMode === 'local' ? local : onl}
        ${boardHTML()}
      </div>`;
    app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { setupError = ''; setupMode = b.dataset.mode; render(); });
    wireSound();
    document.getElementById('share').onclick = shareApp;
    if (setupMode === 'local') {
      app.querySelectorAll('[data-count]').forEach((b) => b.onclick = () => set({ setup: { ...state.setup, count: +b.dataset.count } }));
      app.querySelectorAll('[data-name]').forEach((inp) => inp.oninput = () => {
        const n = state.setup.names.slice(); n[+inp.dataset.name] = inp.value;
        state.setup = { ...state.setup, names: n }; save();
      });
      document.getElementById('start').onclick = () => startGame();
    } else {
      app.querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => { setPick({ slot: +b.dataset.slot }); render(); });
      const g = document.getElementById('guest');
      if (g) g.oninput = () => setPick({ guest: g.value });
      document.getElementById('ojoin').onclick = enterLobby;
    }
    if (setupMode === 'online') startPeek(); else Net.unpeek();
    refreshBoard();
  }

  function renderLobby() {
    const list = lobby.slice(0, 4);
    const me = list.find((p) => p.id === myId);
    const iReady = !!(me && me.ready);
    const rows = list.map((p, i) => `
        <div class="lrow">${avatar(p, i)}<span class="nm">${h(p.name)}${p.id === myId ? ' (du)' : ''}</span>
        <span class="tag ${p.ready ? '' : 'wait'}">${p.ready ? 'Bereit ✓' : 'wartet'}</span></div>`).join('');
    app.innerHTML = `
      <div class="setup lobby">
        <button class="round snd" id="snd" aria-label="Ton an/aus">${soundIcon()}</button>
        ${logoHTML()}
        <div class="hint2">${h(netStatus || 'Das Spiel startet, sobald alle auf „Start“ tippen.')}</div>
        <div class="lplayers">${rows || '<div class="bempty">Verbinde …</div>'}</div>
        <button class="lime-btn" id="oready" ${me ? '' : 'disabled'}>${iReady ? 'Bereit ✓ (tippen zum Abbrechen)' : 'Start'}</button>
        ${list.length < 2 && iReady ? '<div class="hint2">Warte auf Mitspieler …</div>' : ''}
        <button class="link" id="oleave">Verlassen</button>
      </div>`;
    wireSound();
    document.getElementById('oleave').onclick = () => leaveRoom();
    document.getElementById('oready').onclick = () => Net.setReady(!iReady);
  }

  function dieHTML(v, i) {
    const cls = ['die', state.held[i] ? 'held' : '', !v ? 'empty' : '', justRolled[i] ? 'roll' : ''].join(' ');
    const t = tilts[i];
    const pips = Array.from({ length: 9 }, (_, k) => `<span class="c2">${v && PIPS[v].includes(k) ? '<span class="pip"></span>' : ''}</span>`).join('');
    return `<button class="${cls}" style="--r:${t.r}deg;--x:${t.x}px" data-die="${i}" aria-label="Würfel ${v || 'leer'}">${pips}</button>`;
  }

  function cellValue(p, id) {
    if (id === '_sum') return { v: upperSum(p.scores), soft: false };
    if (id === '_total') return { v: total(p.scores), soft: false };
    if (id === '_bonus') {
      if (bonus(p.scores)) return { v: bonus(p.scores), got: true };
      const filled = CATEGORIES.filter((c) => c.upper && p.scores[c.id] !== undefined);
      if (!filled.length) return { v: '', soft: true };
      const par = filled.reduce((a, c) => a + 3 * (CATEGORIES.indexOf(c) + 1), 0);
      const d = filled.reduce((a, c) => a + p.scores[c.id], 0) - par;
      return { v: d > 0 ? '+' + d : d < 0 ? '−' + -d : '0', soft: true };
    }
    return { v: p.scores[id] !== undefined ? p.scores[id] : '' };
  }

  const offline = (p) => state.online && onlineIds.size > 0 && p.id !== myId && !onlineIds.has(p.id);

  function renderGame() {
    const n = state.players.length;
    const cols = Math.max(n, 3); // 1–2 Spieler: leere Spalten, damit das Blatt wie bei 3 Spielern aussieht
    const pad = (cell) => cell.repeat(cols - n);
    const rolled = state.rollsLeft < 3;
    const mine = isMyTurn();
    const curColor = COLORS[state.current];
    const curName = state.players[state.current].name;
    const actives = rolled && state.phase === 'game'; // Vorschau für alle: Blasen für den, der dran ist, Zahlen für die anderen
    let optIndex = 0;

    const hdr = `<div class="hdr"><span></span>${state.players.map((p, i) => `<span class="hb ${i === state.current && state.phase === 'game' ? 'on' : ''} ${offline(p) ? 'off' : ''}" style="--pc:${COLORS[i]}"><i>${h(initial(p))}</i></span>`).join('')}${pad('<span class="hb"></span>')}</div>`;
    const header = `<div class="row hd" style="--n:${cols}"><span></span>${COLORS.slice(0, n).map((c) => `<span class="c" style="background:${c}"></span>`).join('')}${pad('<span class="c"></span>')}</div>`;

    const rows = ROW_ORDER.map((id) => {
      const special = id.startsWith('_');
      const cur = state.players[state.current];
      const free = !special && cur.scores[id] === undefined && actives;
      const s = free ? score(id, state.dice) : 0;
      const cells = state.players.map((p, i) => {
        const isCur = i === state.current;
        const cv = cellValue(p, id);
        let inner = cv.v;
        if (free && isCur) {
          if (mine) {
            const side = optIndex++ % 2 === 0 ? 'L' : 'R';
            inner = `<button class="bubble ${side} ${s ? '' : 'zero'}" data-cat="${id}">${s}</button>`;
          } else {
            inner = s ? `<span class="peek">${s}</span>` : ''; // Mitspieler sehen nur Zahlen, keine Nullen
          }
        }
        return `<div class="c ${isCur ? 'act' : ''} ${cv.soft ? 'soft' : ''} ${cv.got ? 'got' : ''}" style="--pc:${COLORS[i]};--pt:${i === 2 ? '#3b2f00' : '#fff'}">${inner}</div>`;
      }).join('') + pad('<div class="c"></div>');
      const cls = ['row', free && s > 0 ? 'opt' : '', id === '_bonus' ? 'rule' : '', id === '_sum' || id === '_total' ? 'top3' : '', id === 'sixes' || id === 'yatzy' ? 'nob' : '', id === '_sum' || id === '_total' ? 'strong' : ''].join(' ');
      return `<div class="${cls}" style="--n:${cols}"><div class="lab">${label(id)}</div>${cells}</div>`;
    }).join('');

    const players = state.players.map((p, i) => `
      <div class="pl ${i === state.current ? 'cur' : ''} ${offline(p) ? 'off' : ''}">${avatar(p, i)}
        <div style="min-width:0"><div class="nm">${h(p.name)}</div><div class="dot" style="background:${COLORS[i]}"></div></div></div>`).join('');

    app.innerHTML = `
      <div class="game ${n >= 4 ? 'many' : 'few'}">
        <section class="card" style="--ac:${curColor};--n:${cols}">${hdr}${header}${rows}</section>
        <aside class="side">
          <div class="players">${players}</div>
          <div class="dice">${state.dice.map(dieHTML).join('')}</div>
          <div class="btns">
            <button class="round big ${rolled || !mine ? '' : 'pulse'}" id="roll" aria-label="Würfeln" ${state.rollsLeft === 0 || state.phase !== 'game' || !mine ? 'disabled' : ''}>
              <span class="nm" style="font-size:${curName.length <= 5 ? 21 : curName.length <= 7 ? 17 : 13}px">${h(curName)}</span>
              <span class="badge">${state.rollsLeft}</span>
            </button>
            <button class="round" id="menu" aria-label="Menü"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h14"/></svg></button>
          </div>
        </aside>
      </div>`;

    app.querySelectorAll('[data-die]').forEach((b) => b.onclick = () => toggleHold(+b.dataset.die));
    app.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => choose(b.dataset.cat, b));
    document.getElementById('roll').onclick = roll;
    document.getElementById('menu').onclick = openMenu;
  }

  // Hinweis für alle, wenn der Spieler, der dran ist, offline ist (erst nach 2 Sekunden, damit kurze Aussetzer nicht stören)
  let offTimer = null;
  function updateOfflinePop() {
    const old = document.getElementById('offpop');
    const cur = state.players && state.players[state.current];
    const cond = state.online && state.phase === 'game' && cur && offline(cur);
    if (!cond) { if (old) old.remove(); offSince = 0; clearTimeout(offTimer); offTimer = null; return; }
    if (!offSince) offSince = Date.now();
    const wait = 2000 - (Date.now() - offSince);
    if (wait > 0) {
      if (!offTimer) offTimer = setTimeout(() => { offTimer = null; updateOfflinePop(); }, wait);
      return;
    }
    const names = state.players.filter(offline).map((p) => p.name).join(', ');
    const html = `<div class="offbox"><div class="offt">⚠ Offline</div><div class="offn">${h(names)}</div><div class="offm">${h(cur.name)} ist dran. Das Spiel wartet, bis die Verbindung wieder steht.</div></div>`;
    if (old) { old.innerHTML = html; return; }
    const el = document.createElement('div');
    el.id = 'offpop'; el.className = 'pop-overlay soft';
    el.innerHTML = html;
    document.body.appendChild(el);
  }

  function openMenu() {
    const el = document.createElement('div');
    const onl = isOnline();
    el.className = 'pop-overlay';
    el.innerHTML = `<div class="pop"><h2>Menü</h2>
      <button class="lime-btn" id="pm-back">Zurück zum Spiel</button>
      <button class="ghost-btn" id="pm-sound">${Sfx.isOn() ? '🔊 Ton: an' : '🔇 Ton: aus'}</button>
      <button class="ghost-btn" id="pm-new">${onl ? 'Spiel verlassen' : 'Neues Spiel'}</button></div>`;
    document.body.appendChild(el);
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    el.querySelector('#pm-back').onclick = () => el.remove();
    el.querySelector('#pm-sound').onclick = (e) => {
      Sfx.setOn(!Sfx.isOn());
      e.currentTarget.textContent = Sfx.isOn() ? '🔊 Ton: an' : '🔇 Ton: aus';
      Sfx.hold();
    };
    el.querySelector('#pm-new').onclick = () => {
      el.querySelector('.pop').innerHTML = onl
        ? `<h2>Spiel wirklich verlassen?</h2>
        <p style="margin:0;color:#555">Du kannst über die Lobby wieder beitreten, solange das Spiel läuft.</p>
        <button class="lime-btn" id="pm-no">Nein</button>
        <button class="ghost-btn" id="pm-yes">Ja, verlassen</button>`
        : `<h2>Wirklich neues Spiel starten?</h2>
        <p style="margin:0;color:#555">Der aktuelle Spielstand geht verloren.</p>
        <button class="lime-btn" id="pm-no">Nein</button>
        <button class="ghost-btn" id="pm-yes">Ja, neues Spiel</button>`;
      el.querySelector('#pm-no').onclick = () => el.remove();
      el.querySelector('#pm-yes').onclick = () => { el.remove(); if (onl) leaveRoom(); else newGame(); };
    };
  }

  function crownSVG() {
    return `<svg class="crown" viewBox="0 0 110 60"><path d="M8 52 L4 14 L32 30 L55 4 L78 30 L106 14 L102 52 Z" fill="#f4bf2e" stroke="#c98a10" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="55" cy="12" r="5" fill="#e0222b"/><circle cx="14" cy="22" r="4" fill="#e0222b"/><circle cx="96" cy="22" r="4" fill="#e0222b"/></svg>`;
  }

  function renderOver() {
    const ranked = state.players.map((p, i) => ({ p, i, t: total(p.scores) })).sort((a, b) => b.t - a.t);
    const [w, ...rest] = ranked;
    const leaves = [[8, 6, -30], [62, 2, 15], [76, 30, -20], [2, 40, 25], [70, 62, 35], [20, 72, -10]]
      .map(([x, y, r]) => `<span class="leaf" style="left:${x}%;top:${y}%;transform:rotate(${r}deg)"></span>`).join('');
    const el = document.createElement('div');
    el.className = 'win';
    el.innerHTML = `${leaves}
      <button class="round menu-btn" id="wmenu" aria-label="Zur Startseite"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 10.5V20h4.5v-5.5h3V20H18v-9.5"/></svg></button>
      ${crownSVG()}
      <div class="big-avatar" style="background:${COLORS[w.i]}">${h(initial(w.p))}</div>
      <div class="banner">${ranked.length > 1 ? 'GEWINNER' : 'FERTIG'}</div>
      <div class="winner-name">${h(w.p.name)}</div>
      <div class="pts">${w.t} PUNKTE</div>
      <div class="others">${rest.map((r) => `<div class="orow">${avatar(r.p, r.i)}<span class="nm">${h(r.p.name)}</span><span class="p">${r.t} PUNKTE</span></div>`).join('')}</div>
      <button class="lime-btn again" id="again">Erneut spielen</button>`;
    document.body.appendChild(el);
    const recs = newRecords();
    if (recs.length && state.recShown !== state.gameId) { state.recShown = state.gameId; save(); showRecord(recs); }
    el.querySelector('#again').onclick = () => {
      el.remove();
      if (isOnline()) startOnlineGame(state.players);
      else startGame(state.players.map((p) => p.name));
    };
    el.querySelector('#wmenu').onclick = () => { el.remove(); if (isOnline()) leaveRoom(); else newGame(); };
  }

  // Erinnerung, wenn der aktive Spieler 20 Sekunden nichts tut (online nur auf dem Gerät, das dran ist)
  let idleTimer = null;
  function armIdle() {
    clearTimeout(idleTimer);
    if (state.phase !== 'game' || !isMyTurn()) return;
    idleTimer = setTimeout(() => {
      document.querySelectorAll('.turn-toast').forEach((t) => t.remove());
      const t = document.createElement('div');
      t.className = 'turn-toast';
      t.style.setProperty('--pc', COLORS[state.current]);
      t.textContent = `${state.players[state.current].name} ist dran`;
      t.onanimationend = () => t.remove();
      document.body.appendChild(t);
      armIdle(); // alle 20 Sekunden wiederholen, bis der Spieler reagiert
    }, 20000);
  }

  function render() {
    armIdle();
    document.querySelectorAll('.win').forEach((o) => o.remove());
    if (state.phase === 'setup') renderSetup();
    else if (state.phase === 'lobby') renderLobby();
    else { renderGame(); if (state.phase === 'over') renderOver(); }
    if (state.phase !== 'game') document.querySelectorAll('.turn-toast').forEach((t) => t.remove());
    updateOfflinePop();
  }

  // Nach Reload wieder in den Raum, falls ein Online-Spiel offen war
  if (state.online && state.phase !== 'setup') connectOnline();
  render();
  flushPending().then(refreshBoard);

  // Heilt verlorene Nachrichten: alle melden ihren Stand, wer mehr weiss, schickt ihn
  setInterval(() => {
    if (!state.online) return;
    if (state.phase === 'lobby') Net.send({ t: 'hello', id: myId });
    else if (state.gameId) Net.send({ t: 'ping', gameId: state.gameId, seq: state.seq });
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.online) Net.send({ t: 'hello', id: myId });
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
