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
  const DEFAULT_NAMES = ['Vreni', 'Peter', 'Marco', 'Gast'];
  const COLORS = ['#2e8bd0', '#e0485a', '#4caf50', '#f2c14e']; // Blau, Rot, Grün, Gelb
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
  if (state.setup && state.setup.names && state.setup.names[3] === 'Spieler 4') state.setup.names[3] = 'Gast';   // alter Standardname bei bereits gespeicherten Einstellungen
  let setupMode = 'online';  // beim Start immer „Online“
  let justRolled = [];
  let pendingRoll = null;   // Wurf, der als 3D-Animation gezeigt werden soll (einmalig)
  const has3d = () => !!window.Dice3D;
  let tilts = [0, 1, 2, 3, 4].map(() => newTilt());
  let busy = false;
  let lobby = [];            // Presence-Liste des Raums
  let onlineIds = new Set(); // wer gerade verbunden ist
  let netStatus = '';        // Hinweistext in der Lobby
  let setupError = '';
  let boardData = null;      // gemeinsame Rangliste (aus der Datenbank)
  let offSince = 0;          // seit wann ist der aktive Spieler offline?
  let chatShow = {};         // Nachrichten, die gerade bei einem Avatar angezeigt werden: Platz -> { kind, value, until }
  let chatTimer = null, lastChatSent = 0;
  const CHAT_TEXTS = ['Bravo!', 'Glück!', 'Danke!', 'Wow!', 'Hee!', 'Ups!'];
  const CHAT_EMOJIS = ['😁', '😜', '😮', '😢', '😠'];
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
    const rows = state.players.map((p, i) => ({ name: p.name, score: totals[i], won: totals[i] === best, yatzy: (p.scores.yatzy || 0) > 0 }));
    setPending([...pendingList(), { gameId: state.gameId, rows }]);
    flushPending().then(refreshBoard);
  }
  // Rekorde vor dem Spiel merken, damit am Ende ein neuer Rekord erkannt wird (auf allen Geräten gleich)
  function snapshotBest(tries = 0) {
    const gid = state.gameId;
    Net.fetchBoard().then((d) => {
      if (state.gameId !== gid) return;
      if (!d) { if (tries < 3) setTimeout(() => snapshotBest(tries + 1), 2000); return; }   // kurzer Netzaussetzer: noch ein paar Mal versuchen
      state.prevBest = Object.fromEntries(d.map((r) => [r.name.toLowerCase(), r.best]));
      save();
    });
  }
  function calcRecords(players) {
    const prev = state.prevBest;
    if (!prev || players.length < 2) return [];
    return players.map((p) => ({ name: p.name, score: total(p.scores) }))
      .filter((r) => prev[r.name.toLowerCase()] !== undefined && r.score > prev[r.name.toLowerCase()]);
  }
  const newRecords = () => calcRecords(state.players);
  function clearFx() { document.querySelectorAll('.rec-fx,.turn-toast,.my-turn').forEach((e) => e.remove()); }
  // Live-Hinweis: sobald jemand schon während des Spiels seinen bisherigen Bestwert übertrifft (einmal pro Spiel und Person)
  let liveRecGame = null, liveRecDone = {};
  function checkLiveRecord() {
    if (state.phase !== 'game' || !state.prevBest || state.players.length < 2) return;
    const first = liveRecGame !== state.gameId;
    if (first) { liveRecGame = state.gameId; liveRecDone = {}; }
    const hits = [];
    state.players.forEach((p) => {
      const k = p.name.toLowerCase(), best = state.prevBest[k];
      if (best === undefined || liveRecDone[k]) return;
      const sc = total(p.scores);
      if (sc > best) { liveRecDone[k] = true; if (!first) hits.push({ name: p.name, score: sc }); }   // beim Wiedereinstieg in ein laufendes Spiel nicht erneut melden
    });
    if (hits.length) showLiveRecord(hits[0]);
  }
  function showLiveRecord(r) {
    document.querySelectorAll('.live-rec').forEach((e) => e.remove());
    const el = document.createElement('div');
    el.className = 'live-rec';
    el.innerHTML = `<span>🏆</span><div><b>Rekord geknackt!</b><small>${h(r.name)} · ${r.score} Punkte</small></div>`;
    document.body.appendChild(el);
    Sfx.rec();
    setTimeout(() => el.remove(), 2600);
  }

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
      ? top.map((s, i) => `<div class="brow" data-stat="${h(s.name)}" role="button" tabindex="0"><span class="rk">${i + 1}</span><span class="bn">${h(s.name)}</span><span class="bp">${s.pct} %</span><span class="br">Rekord ${s.best ?? '–'}</span></div>`).join('')
      : `<div class="bempty">${boardData ? 'Noch keine Spiele gespielt' : 'Lade …'}</div>`;
    return `<div class="board"><div class="bt"><span>Rangliste</span><span class="bcap">(Siege in Prozent)</span></div>${rows}${top.length ? '<div class="bhint">Namen antippen für die Statistik</div>' : ''}</div>`;
  }

  // ---------- Statistik einer Person (Antippen in der Rangliste) ----------
  // Felder (alle ausser games/wins optional): draws, losses, avg, avgWin, avgDraw, avgLoss, best, yatzys, form (z. B. ['S','S','N','U','S'])
  const fmt1 = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');
  function openStats(name) {
    const all = boardData || [];
    const s = all.find((r) => r.name === name);
    if (!s) return;
    const g = s.games || 0;
    const w = s.wins || 0, d = s.draws ?? null, l = s.losses ?? (d !== null ? g - w - d : null);
    const pct = (x) => (g ? Math.round((100 * x) / g) : 0);
    const seg = (n, cls) => (n > 0 ? `<i class="${cls}" style="flex:${n}"></i>` : '');
    const rank = boardRows().findIndex((r) => r.name === name) + 1;
    const grp = all.filter((r) => r.avg != null);
    const grpAvg = grp.length > 1 ? grp.reduce((x, r) => x + r.avg * r.games, 0) / grp.reduce((x, r) => x + r.games, 0) : null;
    const diff = s.avg != null && grpAvg != null ? Math.round(s.avg - grpAvg) : null;
    const cell = (label, val, sub) => `<div class="sc"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const form = (s.form || []).slice(-5).map((f) => `<span class="fm ${f === 'S' ? 'w' : f === 'N' ? 'l' : 'd'}">${f}</span>`).join('');
    const el = document.createElement('div');
    el.className = 'pop-overlay';
    el.innerHTML = `<div class="pop stat-pop">
      <div class="st-head"><span class="st-rk">${rank || ''}</span><h2>${h(s.name)}</h2><span class="st-big"><b>${pct(w)} %</b> Siegquote</span></div>
      ${d !== null ? `<div class="st-bar">${seg(w, 'w')}${seg(d, 'd')}${seg(l, 'l')}</div>
      <div class="st-leg"><span><i class="w"></i>${w} Siege</span><span><i class="d"></i>${d} Unentschieden</span><span><i class="l"></i>${l} Niederlagen</span></div>` : ''}
      <div class="st-grid">
        ${cell('Spiele', g)}
        ${s.avg != null ? cell('Ø Punkte', Math.round(s.avg), diff === null ? '' : `${diff >= 0 ? '+' : ''}${diff} zum Gruppenschnitt`) : ''}
        ${s.best != null ? cell('Rekord', s.best) : ''}
        ${s.yatzys != null ? cell('Yatzys', s.yatzys, g ? `in ${pct(s.yatzys)} % der Spiele${s.yatzys ? ' · alle ' + fmt1(g / s.yatzys) + ' Spiele' : ''}` : '') : ''}
      </div>
      ${form ? `<div class="st-sub">Letzte Spiele</div><div class="st-form">${form}<small>S Sieg · U Unentschieden · N Niederlage</small></div>` : ''}
      <div class="st-sub" id="h2h-t" hidden>Direktvergleich</div><div id="h2h" hidden></div>
      <button class="lime-btn" id="st-close">Schliessen</button></div>`;
    document.body.appendChild(el);
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    el.querySelector('#st-close').onclick = () => el.remove();
    loadH2H(el, s.name);
  }
  // Direktvergleich: Gegner wählen, Siege gegeneinander und Ø Punkte in gemeinsamen Spielen
  async function loadH2H(el, me) {
    const rows = ((await Net.fetchH2H(me)) || []).sort((x, y) => y.games - x.games);
    const box = el.querySelector('#h2h');
    if (!rows.length || !box) return;
    const draw = (i) => {
      const r = rows[i];
      const chips = rows.map((x, j) => `<button class="h-chip ${j === i ? 'on' : ''}" data-i="${j}">${h(x.b_name)}</button>`).join('');
      box.innerHTML = `<div class="h-chips">${chips}</div>
        <div class="h-score"><span><b>${r.a_wins}</b>${h(me)}</span><em>${r.ties ? r.ties + ' unentschieden' : r.games + ' Spiele'}</em><span><b>${r.b_wins}</b>${h(r.b_name)}</span></div>
        <div class="st-bar">${r.a_wins ? `<i class="w" style="flex:${r.a_wins}"></i>` : ''}${r.ties ? `<i class="d" style="flex:${r.ties}"></i>` : ''}${r.b_wins ? `<i class="l" style="flex:${r.b_wins}"></i>` : ''}</div>
        <div class="h-avg">Ø Punkte in diesen ${r.games} Spielen: <b>${r.a_avg}</b> zu <b>${r.b_avg}</b></div>`;
      box.querySelectorAll('.h-chip').forEach((b) => b.onclick = () => draw(+b.dataset.i));
    };
    el.querySelector('#h2h-t').hidden = false; box.hidden = false;
    draw(0);
  }
  document.addEventListener('click', (e) => { const r = e.target.closest && e.target.closest('[data-stat]'); if (r) openStats(r.dataset.stat); });

  async function refreshBoard() {
    const data = await Net.fetchBoard();
    if (data) boardData = data;
    const el = document.querySelector('.board');
    if (el) el.outerHTML = boardHTML();
  }

  // ---------- Online: Verbindung & Nachrichten ----------
  const pub = () => {
    const { players, current, dice, held, rollsLeft, phase, gameId, seq, records } = state;
    return { players, current, dice, held, rollsLeft, phase, gameId, seq, records };
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
    if (isMyTurn()) { Sfx.turn(); myTurnText(); }
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
    } else if (m.t === 'chat') {
      if (m.gameId === state.gameId && state.phase !== 'lobby') showChat(m.seat, m.kind, m.value);
    } else if (m.t === 'pick') {
      showPick(m);
    } else if (m.t === 'nudge') {
      if (m.gameId === state.gameId && state.phase === 'game' && !isMyTurn()) showTurnToast(`${state.players[state.current].name} ist dran`);
    } else if (m.t === 'ping') {
      if (state.gameId === m.gameId && state.seq > m.seq) broadcastState([]);
    }
  }

  // Grosser "YATZY!"-Schriftzug zur Explosion; hängt am Seitenrand, damit er das Neuzeichnen überlebt
  function yatzyText(el) {
    const r = el.getBoundingClientRect();
    const t = document.createElement('div');
    t.className = 'yatzy-text';
    t.textContent = 'YATZY!';
    t.style.left = (r.left + r.width / 2) + 'px';
    t.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1300);
  }

  // Effekt der Punktewahl bei den anderen: Zahl in der Zelle + Burst + Ton
  let pickPlayed = false;
  function showPick(m) {
    if (m.gameId !== state.gameId || state.phase !== 'game') return;
    const cell = document.querySelector(`[data-cell="${state.current}:${m.cat}"]`);
    if (cell) {
      cell.innerHTML = `<span class="peek picked">${m.pts}</span>`;
      const b = document.createElement('div');
      b.className = 'burst';
      cell.appendChild(b);
      if (m.cat === 'yatzy' && m.pts > 0) yatzyText(cell);
      setTimeout(() => b.remove(), 600);
    }
    if (m.cat === 'yatzy' && m.pts > 0) Sfx.yatzy(); else Sfx.score(m.pts);
    pickPlayed = true;
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
    pendingRoll = justRolled.some(Boolean) && s.dice.some(Boolean) ? { values: s.dice.slice(), mask: justRolled.slice() } : null;
    state = { ...state, ...s };
    busy = false;
    // Töne für Züge der anderen
    if (s.current === prev.current && s.rollsLeft < prev.rollsLeft) { if (!has3d()) Sfx.roll(); }
    else if (s.current !== prev.current || (s.phase === 'over' && prev.phase !== 'over')) {
      if (!pickPlayed) { // Ton nur, falls die Auswahl-Meldung nicht angekommen ist
        const who = prev.players[prev.current];
        const after = s.players[prev.current];
        const key = Object.keys(after.scores).find((k) => who.scores[k] === undefined);
        const pts = key ? after.scores[key] : 0;
        if (key === 'yatzy' && pts > 0) Sfx.yatzy(); else Sfx.score(pts);
      }
      pickPlayed = false;
    }
    if (s.phase === 'over' && prev.phase !== 'over') setTimeout(() => Sfx.win(), 250);
    else if (!wasMine && isMyTurn() && s.current !== prev.current) setTimeout(() => { Sfx.turn(); myTurnText(); }, 350);
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
    if (has3d() && Dice3D.busy()) return;   // erst wenn die Würfel liegen
    const dice = state.dice.map((d, i) => (state.held[i] && d ? d : 1 + Math.floor(Math.random() * 6)));
    justRolled = dice.map((_, i) => !(state.held[i] && state.dice[i]));
    tilts = tilts.map((t, i) => (justRolled[i] ? newTilt() : t));
    const held = state.held; // gehaltene Würfel bleiben auch nach dem letzten Wurf gerade
    pendingRoll = { values: dice.slice(), mask: justRolled.slice() };
    set({ dice, held, rollsLeft: state.rollsLeft - 1, seq: state.seq + 1 });
    broadcastState(justRolled);
    if (has3d()) Sfx.rollHaptic(); else Sfx.roll();   // mit 3D-Würfeln kommt der Ton vom Aufprall
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
      records: done ? calcRecords(players) : undefined, // Rekord-Effekt sehen alle gleich
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
    if (catId === 'yatzy' && pts > 0) yatzyText(bubble);
    if (catId === 'yatzy' && pts > 0) Sfx.yatzy(); else Sfx.score(pts);
    if (state.online) Net.send({ t: 'pick', gameId: state.gameId, cat: catId, pts }); // alle sehen den Effekt
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
  const LOGO_COLORS = ['#2e8bd0', '#e0485a', '#4caf50', '#f2c14e', '#2e8bd0'];
  const LOGO_TILT = [-6, 4, -3, 5, -4];
  function logoHTML() {
    const die = `<svg class="logo-die" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-12 32 32)">
      <rect x="7" y="11" width="50" height="50" rx="13" fill="#0e4a29" opacity=".3"/><rect x="7" y="8" width="50" height="50" rx="13" fill="#b9c8b2"/><rect x="7" y="5" width="50" height="50" rx="13" fill="#fff"/>
      <circle cx="21" cy="19" r="5.2" fill="#2e8bd0"/><circle cx="43" cy="19" r="5.2" fill="#e0485a"/><circle cx="32" cy="30" r="5.2" fill="#1c1917"/><circle cx="21" cy="41" r="5.2" fill="#4caf50"/><circle cx="43" cy="41" r="5.2" fill="#f2c14e"/></g></svg>`;
    const word = [...'YATZY'].map((c, i) => `<span style="--lc:${LOGO_COLORS[i]};--rot:${LOGO_TILT[i]}deg">${c}</span>`).join('');
    return `<div class="logo" role="img" aria-label="Yatzy">${die}<div class="wm">${word}</div></div>`;
  }
  async function shareApp() {
    const url = location.origin + location.pathname; // ohne Zusätze wie ?testroom
    try {
      if (navigator.share) { await navigator.share({ title: 'Yatzy', text: 'Spiel mit uns Yatzy!', url }); return; }
      await navigator.clipboard.writeText(url);
      bigBanner('Link kopiert ✓', 1700);
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

  // ---------- Nachrichten und Emojis (online): erscheinen kurz beim Avatar des Absenders ----------
  const liveChat = (i) => (chatShow[i] && chatShow[i].until > Date.now() ? chatShow[i] : null);
  function showChat(seat, kind, value) {
    if (!state.players || seat < 0 || seat >= state.players.length) return;
    if (kind === 'text' ? !CHAT_TEXTS.includes(value) : !CHAT_EMOJIS.includes(value)) return;   // nur bekannte Nachrichten annehmen
    chatShow[seat] = { kind, value, until: Date.now() + 5000 };
    Sfx.chat();
    if (state.phase === 'game' || state.phase === 'over') render();
    clearTimeout(chatTimer);
    chatTimer = setTimeout(function tick() {
      const now = Date.now(); let left = 0, gone = false;
      Object.keys(chatShow).forEach((k) => { if (chatShow[k].until <= now) { delete chatShow[k]; gone = true; } else left++; });
      if (gone && (state.phase === 'game' || state.phase === 'over')) render();   // nur neu zeichnen, wenn etwas verschwindet (sonst startet die Animation immer wieder neu)
      if (left) chatTimer = setTimeout(tick, 400);
    }, 5100);
  }
  function sendChat(kind, value) {
    const now = Date.now();
    if (!state.online || now - lastChatSent < 1200) return;   // höchstens eine Nachricht alle 1,2 Sekunden
    lastChatSent = now;
    const seat = state.players.findIndex((p) => p.id === myId);
    if (seat < 0) return;
    Net.send({ t: 'chat', gameId: state.gameId, seat, kind, value });
    showChat(seat, kind, value);
  }
  function openChat() {
    const el = document.createElement('div');
    el.className = 'pop-overlay';
    el.innerHTML = `<div class="chat-pop">
      <div class="ct">${CHAT_TEXTS.map((t) => `<button data-t="${h(t)}">${h(t)}</button>`).join('')}</div>
      <div class="ce">${CHAT_EMOJIS.map((e) => `<button data-e="${e}" aria-label="Emoji">${e}</button>`).join('')}</div></div>`;
    document.body.appendChild(el);
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { el.remove(); sendChat('text', b.dataset.t); });
    el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { el.remove(); sendChat('emoji', b.dataset.e); });
  }

  const offline = (p) => state.online && onlineIds.size > 0 && p.id !== myId && !onlineIds.has(p.id);

  function renderGame() {
    checkLiveRecord();
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
            inner = `<button class="bubble ${side} ${s ? '' : 'zero'}" data-cat="${id}">${s}</button>${s ? `<span class="peek">${s}</span>` : ''}`; // Blase und Zahl im Feld
          } else {
            inner = s ? `<span class="peek">${s}</span>` : ''; // Mitspieler sehen nur Zahlen, keine Nullen
          }
        }
        return `<div class="c ${isCur ? 'act' : ''} ${free && isCur && s > 0 ? 'optc' : ''} ${cv.soft ? 'soft' : ''} ${cv.got ? 'got' : ''}" data-cell="${i}:${id}" style="--pc:${COLORS[i]};--pt:#fff">${inner}</div>`;
      }).join('') + pad('<div class="c"></div>');
      const cls = ['row', free && s > 0 ? 'opt' : '', id === '_bonus' ? 'rule' : '', id === '_sum' || id === '_total' ? 'top3' : '', id === 'sixes' || id === 'yatzy' ? 'nob' : '', id === '_sum' || id === '_total' ? 'strong' : ''].join(' ');
      return `<div class="${cls}" style="--n:${cols}"><div class="lab">${label(id)}</div>${cells}</div>`;
    }).join('');

    const players = state.players.map((p, i) => {
      const c = liveChat(i);
      return `
      <div class="pl ${i === state.current ? 'cur' : ''} ${offline(p) ? 'off' : ''}">${c && c.kind === 'emoji' ? `<div class="avatar emoji"><span class="em e${CHAT_EMOJIS.indexOf(c.value)}">${c.value}</span></div>` : avatar(p, i)}
        <div style="min-width:0"><div class="nm">${h(p.name)}</div><div class="dot" style="background:${COLORS[i]}"></div></div>
        ${c && c.kind === 'text' ? `<div class="chat-bubble">${h(c.value)}</div>` : ''}</div>`;
    }).join('');

    app.innerHTML = `
      <div class="game ${n >= 4 ? 'many' : 'few'}">
        <section class="card" style="--ac:${curColor};--n:${cols}">${hdr}${header}${rows}</section>
        <aside class="side">
          <div class="players">${players}</div>
          <div class="dice" id="diceArea">${has3d() ? '' : state.dice.map(dieHTML).join('')}</div>
          <div class="btns">
            <button class="round big ${rolled || !mine ? '' : 'pulse'}" id="roll" aria-label="Würfeln" ${state.rollsLeft === 0 || state.phase !== 'game' || !mine ? 'disabled' : ''}>
              <span class="nm" style="font-size:${curName.length <= 5 ? 21 : curName.length <= 7 ? 17 : 13}px">${h(curName)}</span>
              <span class="badge">${state.rollsLeft}</span>
            </button>
            <div class="sm">
              ${state.online ? '<button class="round" id="chat" aria-label="Nachricht"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.5 3 2.5 6.6 2.5 11c0 2.3 1.1 4.3 2.9 5.7L4.6 21l4.3-2.2c1 .3 2 .4 3.1.4 5.5 0 9.5-3.6 9.5-8S17.5 3 12 3z"/></svg></button>' : ''}
              <button class="round" id="menu" aria-label="Menü"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h14"/></svg></button>
            </div>
          </div>
        </aside>
      </div>`;

    app.querySelectorAll('[data-die]').forEach((b) => b.onclick = () => toggleHold(+b.dataset.die));
    if (has3d()) {   // 3D-Würfel: eine dauerhafte Zeichenfläche, die bei jedem Neuaufbau in den neuen Würfelbereich umzieht
      Dice3D.mount(document.getElementById('diceArea'));
      if (pendingRoll) { const r = pendingRoll; pendingRoll = null; Dice3D.roll(r.values, r.mask); }
      else Dice3D.setDice(state.dice, state.held);
    }
    app.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => choose(b.dataset.cat, b));
    document.getElementById('roll').onclick = roll;
    document.getElementById('menu').onclick = openMenu;
    const chatBtn = document.getElementById('chat'); if (chatBtn) chatBtn.onclick = openChat;
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
      <button class="ghost-btn" id="pm-new">Spiel verlassen</button></div>`;
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
        : `<h2>Spiel wirklich verlassen?</h2>
        <p style="margin:0;color:#555">Der aktuelle Spielstand geht verloren.</p>
        <button class="lime-btn" id="pm-no">Nein</button>
        <button class="ghost-btn" id="pm-yes">Ja, verlassen</button>`;
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
    const recs = state.records && state.records.length ? state.records : newRecords();
    if (recs.length && state.recShown !== state.gameId) { state.recShown = state.gameId; save(); showRecord(recs); }
    el.querySelector('#again').onclick = () => {
      el.remove();
      if (isOnline()) startOnlineGame(state.players);
      else startGame(state.players.map((p) => p.name));
    };
    el.querySelector('#wmenu').onclick = () => { el.remove(); if (isOnline()) leaveRoom(); else newGame(); };
  }

  // Kurzer „Du bist dran!“-Schriftzug über den Würfeln (nur online, nur bei dem, der dran ist)
  function bigBanner(text, ms = 1700) {
    document.querySelectorAll('.my-turn').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'my-turn';
    t.textContent = text;
    t.style.animationDuration = ms + 'ms';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms + 50);
  }
  function myTurnText() {
    if (!state.online || state.phase !== 'game' || Sfx.quiet()) return;   // nicht anzeigen, wenn die App gerade erst aus dem Hintergrund kommt
    bigBanner('Du bist dran!');
  }

  // Erinnerung, wenn der aktive Spieler 20 Sekunden nichts tut (online nur auf dem Gerät, das dran ist)
  function showTurnToast(text) { bigBanner(text, 2600); }
  let idleTimer = null;
  function armIdle(first = 10000) {   // erste Erinnerung nach 10 Sekunden
    clearTimeout(idleTimer);
    if (state.phase !== 'game' || !isMyTurn()) return;
    idleTimer = setTimeout(() => {
      showTurnToast(`${state.players[state.current].name} ist dran`);
      if (state.online) Net.send({ t: 'nudge', gameId: state.gameId }); // alle anderen sehen es auch
      armIdle(20000); // danach alle 20 Sekunden, bis der Spieler reagiert
    }, first);
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

  // 3D-Würfel werden als eigenes Modul geladen; sobald sie bereit sind, zeichnet sich das Spiel einmal neu
  window.addEventListener('dice3d-ready', () => { Dice3D.onTap((i) => toggleHold(i)); if (state.phase === 'game' || state.phase === 'over') render(); });
  if (window.Dice3D) Dice3D.onTap((i) => toggleHold(i));

  function hideSplash() {
    clearTimeout(window.__splashTimer);
    const s = document.getElementById('splash');
    if (!s) return;
    s.classList.add('out');
    setTimeout(() => s.remove(), 300);
  }

  // Nach Reload wieder in den Raum, falls ein Online-Spiel offen war
  if (state.online && state.phase !== 'setup') connectOnline();
  render();
  const splashParam = new URLSearchParams(location.search).get('splash');   // ?splash=8 zeigt den Ladebildschirm 8 Sekunden lang (zum Ansehen)
  setTimeout(hideSplash, splashParam === null ? 0 : (Number(splashParam) || 2.5) * 1000);
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
