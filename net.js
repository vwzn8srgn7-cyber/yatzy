// Dünne Schicht über Supabase: Realtime (Raum-Kanal) für Spielzüge und Presence, Datenbank für die gemeinsame Rangliste.
(function (root) {
  let sb = null;
  let ch = null;
  let tracked = false;
  let cb = null;
  let meta = null;

  function client() {
    const cfg = root.YATZY_CONFIG;
    if (!sb && root.supabase && cfg) {
      sb = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 20 } } });
    }
    return sb;
  }

  function listFrom(state) {
    const arr = [];
    Object.keys(state).forEach((key) => {
      const metas = state[key];
      const m = metas[metas.length - 1];
      if (m.peek) return; // stille Beobachter (Namenswahl) zählen nicht als Spieler
      arr.push({ id: m.id || key, name: m.name, slot: m.slot ?? 9, ready: !!m.ready, ts: m.ts || 0 });
    });
    // Feste Reihenfolge: Platz der Namenswahl (Vreni, Peter, Marco, Gast), dann Beitrittszeit
    arr.sort((a, b) => (a.slot - b.slot) || (a.ts - b.ts) || a.id.localeCompare(b.id));
    return arr;
  }

  // Nur mitlesen, wer im Raum ist (ohne selbst aufzutauchen), damit vergebene Namen gesperrt werden können
  let pch = null;
  function unpeek() {
    if (pch && sb) { try { sb.removeChannel(pch); } catch { /* ignorieren */ } }
    pch = null;
  }
  function peek(room, onList) {
    if (pch || !client()) return;
    const c = sb.channel('yatzy-' + room, { config: { presence: { key: 'peek-' + Math.random().toString(36).slice(2) } } });
    pch = c;
    c.on('presence', { event: 'sync' }, () => { if (c === pch) onList(listFrom(c.presenceState())); })
      .subscribe(async (status) => {
        // Presence wird nur an Teilnehmer geliefert, die sich selbst eintragen: als unsichtbarer Beobachter
        if (status === 'SUBSCRIBED' && c === pch) { try { await c.track({ peek: true }); } catch { /* ignorieren */ } }
      });
  }

  function leave() {
    tracked = false;
    if (ch && sb) { try { sb.removeChannel(ch); } catch { /* ignorieren */ } }
    ch = null;
  }

  function join(room, o) {
    unpeek();
    leave();
    if (!client()) { o.onStatus('NO_LIB'); return; }
    cb = o;
    meta = { id: o.id, name: o.name, slot: o.slot, ready: false, ts: Date.now() };
    const c = sb.channel('yatzy-' + room, { config: { broadcast: { self: false, ack: false }, presence: { key: o.id } } });
    ch = c;
    c.on('broadcast', { event: 'm' }, ({ payload }) => { if (c === ch) cb.onMsg(payload); })
      .on('presence', { event: 'sync' }, () => { if (c === ch && tracked) cb.onPresence(listFrom(c.presenceState())); })
      .subscribe(async (status) => {
        if (c !== ch) return;
        if (status === 'SUBSCRIBED') {
          try { await c.track(meta); } catch { /* ignorieren */ }
          if (c !== ch) return;
          tracked = true;
          cb.onStatus('ok');
          cb.onPresence(listFrom(c.presenceState()));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          tracked = false;
          cb.onStatus(status);
        }
      });
  }

  async function setReady(ready) {
    if (!ch || !meta) return;
    meta = { ...meta, ready };
    try { await ch.track(meta); } catch { /* ignorieren */ }
  }

  function send(payload) {
    if (ch && tracked) ch.send({ type: 'broadcast', event: 'm', payload });
  }

  // Gemeinsame Rangliste: jede Runde wird einmal pro Spielplatz eingetragen (Doppelte werden ignoriert)
  async function saveResult(gameId, rows) {
    const c = client(); if (!c) return false;
    const { error } = await c.from('yatzy_results').upsert(
      rows.map((r, i) => ({ game_id: gameId, seat: i, name: r.name.slice(0, 12), score: r.score, won: r.won })),
      { onConflict: 'game_id,seat', ignoreDuplicates: true },
    );
    return !error;
  }
  async function fetchBoard() {
    const c = client(); if (!c) return null;
    const { data, error } = await c.from('yatzy_leaderboard').select('name,games,wins,best');
    return error ? null : data;
  }

  root.Net = { join, leave, peek, unpeek, send, setReady, saveResult, fetchBoard, connected: () => !!(ch && tracked) };
})(window);
