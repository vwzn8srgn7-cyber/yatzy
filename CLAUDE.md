# Yatzy – Familien-Würfelspiel (Web-App für den iPhone-Home-Bildschirm)

Gespräche mit dem Besitzer auf **Deutsch (Schweizer Rechtschreibung, «ss» statt «ß» ausser bei «Straße»)**, einfach und ohne Fachwörter erklären. Der Besitzer ist Programmier-Neuling und prüft jede Änderung gern selbst auf dem iPhone.

## So arbeiten wir (wichtig)

- **Erst zeigen, dann hochladen.** Jede sichtbare Änderung zuerst im Browser-Fenster (Handy-Grösse 390×780) zeigen und auf das Ja des Besitzers warten. Nie ungefragt hochladen.
- **Hochladen** = `git commit` + `git push origin main` (GitHub Pages veröffentlicht automatisch). Danach prüfen, dass `sw.js` auf der Seite die neue Version zeigt:
  `curl -s https://vwzn8srgn7-cyber.github.io/yatzy/sw.js | grep -o "yatzy-v[0-9]*"`
- **Version erhöhen bei jedem Upload:** `?v=NN` in `index.html` (8 Stellen) und in `sw.js` (`FILES` und `CACHE = 'yatzy-vNN'`) gleichzeitig erhöhen, sonst sehen die Geräte die alte Version. Mit `sed -i '' 's/?v=81/?v=82/g; s/yatzy-v81/yatzy-v82/' index.html sw.js` (macOS-sed braucht `''`).
- **Neue Dateien** (Bilder, Schriften) auch in die Liste `FILES` in `sw.js` eintragen.
- **Neu-Setzen der App auf dem iPhone** (Home-Bildschirm-Symbol löschen und neu hinzufügen) ist nur nötig, wenn sich Statusleiste, App-Name oder Symbol ändern. Das dem Besitzer **ausdrücklich sagen**, sonst reicht Schliessen und Öffnen (manchmal zweimal).
- Vor dem Hochladen: `node scoring.test.js` (muss «Alle Tests bestanden» ausgeben) und `node --check app.js`.
- Unumkehrbares (Daten löschen, Backups löschen, Datenbank ändern) immer vorher fragen.

## Aufbau

Reine Browser-App ohne Build-Schritt, alles liegt direkt im Ordner:

| Datei | Inhalt |
|---|---|
| `index.html` | Seite, Startbild (Splash), Versionsnummern der Skripte |
| `app.js` | Das ganze Spiel: Oberfläche, Spielablauf, Online-Raum, Gewinnerseite, Serie |
| `scoring.js` + `scoring.test.js` | Punkteregeln und Tests (Bonus erst nach Einser bis Sechser) |
| `dice3d.js` + `vendor/` | 3D-Würfel (three.js) |
| `net.js` | Online-Anbindung an Supabase (Realtime, Rangliste speichern/lesen) |
| `sfx.js` | Töne und Vibration |
| `style.css` | Aussehen |
| `sw.js`, `manifest.webmanifest`, Symbole | Offline-Zwischenspeicher und App-Installation |
| `avatars/` | Fotos für Vreni, Peter, Marco (Gast hat einen Buchstaben-Avatar) |
| `config.js` | Öffentlicher Supabase-Zugang (anon-Schlüssel, darf im Browser stehen) |
| `server.py` | Lokaler Testserver (läuft über `.claude/launch.json`, Name «yatzy», Port 5173) |
| `.github/workflows/keepalive.yml` | Wochen-Ping, hält die kostenlose Datenbank wach |

- **Spieler online:** feste Namen Vreni, Peter, Marco, Gast (Gast darf eigenen Namen). Raum «ENGADIN». Maximal 4. Wer während einer Runde beitritt, wartet in der Lobby (Warteliste) und spielt in der nächsten Runde mit.
- **Serie:** nach jedem Online-Spiel ein Zwischenstand auf der Gewinnerseite, nach 4 Spielen das Fenster «Resultat nach 4 Spielen» (`SERIES_LEN` in `app.js`). Wird nicht in der Datenbank gespeichert. «Meiste Yatzys» zählt jedes «5 gleiche» beim Eintragen (Zähler `y` am Spieler), nur für dieses Resultat.
- **Datenbank:** Supabase-Projekt `yatzy-online` (kostenlos), Tabelle `yatzy_results`, Ansichten `yatzy_leaderboard`, `yatzy_stats`, `yatzy_h2h`. Das Rezept zum Neuaufbau steht im Backup (`2-datenbank/aufbau.sql`).
- **Spielfarben** Blau, Rot, Grün, Gelb stehen in `app.js` (`COLORS`, `LOGO_COLORS`) und in `style.css` (`--pc1…4`).

## Testen im Browser (ohne die echte Rangliste zu berühren)

- Lokal: `preview_start` mit Name «yatzy» (nie den Server per Bash starten). Handy-Grösse mit `resize_window` 390×780, danach wieder `desktop`.
- URL-Parameter: `?testroom=NAME` (eigener Raum, keine Einträge in der Rangliste), `?cid=ID` (eigene Geräte-ID, für mehrere Tabs), `?serie=N` (Serienlänge), `?splash=N`.
- Spielzustände zum Anschauen kann man in `localStorage` unter `yatzy-state-v1` setzen (Phase `game`/`over`, Spieler mit `scores`, bei Online `online: {room, name, slot}`); danach neu laden. Nach dem Test den Eintrag wieder entfernen.
- Mehrere Geräte nachstellen: zweiter Tab auf `127.0.0.1` statt `localhost` (getrennter Speicher), gleicher `?testroom`.
- Hintergrund-Tabs laufen gebremst; für Bildschirmfotos den Tab nach vorne holen. Wenn lokal alles grün/leer bleibt (Startbild hängt bei 90 %): einfach neu laden, das ist der Testserver, nicht die App.

## Stolpersteine auf dem iPhone

- **Statusleiste:** durchsichtig (`black-translucent`) mit 7 pt Zusatzabstand. iOS rechnet die Fensterhöhe manchmal zu klein; mit fester Höhe nachzuhelfen machte es schlimmer. Rückweg zum weissen Rand steht in der Notiz «statusleiste-gruen-oder-weiss» (Commit 9d6c0cf).
- **Vibration** geht nur über durchsichtige `input[switch]`-Schalter unter den Tasten (`hz`).
- **Neuzeichnen:** `render()` baut die Seite bei jedem Antippen neu. Darum bleiben die Spieler-Avatare (`.players`) als Element erhalten, solange sich an ihnen nichts ändert, und die Gewinnerseite (`.win`) wird nicht neu aufgebaut. Das nicht wieder kaputt machen (sonst flackern Fotos und Puls).
- Punkte-Blasen erscheinen erst, wenn die 3D-Würfel liegen (Ereignis `dice3d-settled`).

## Wartung

- **Supabase-Pause:** Kostenlose Projekte werden nach etwa einer Woche ohne Nutzung pausiert (max. 2 aktive Projekte). Der Wochen-Ping läuft montags und donnerstags und schaltet sich selbst wieder ein (GitHub schaltet geplante Läufe sonst nach ca. 60 Tagen ohne Änderung ab). Bei Fehler schickt GitHub eine E-Mail. Wenn Rangliste oder Online-Spiel nicht gehen: zuerst prüfen, ob das Projekt pausiert ist («Restore project») und `gh run list --workflow=keepalive.yml`.
- **Backup:** Ordner `Backup-Yatzy-<Datum>-v<NN>` im Projektordner (von Git ignoriert) mit `1-projekt/` (Dateien über `git archive HEAD` plus `yatzy-komplette-geschichte.bundle` über `git bundle create … --all`), `2-datenbank/aufbau.sql` und `ANLEITUNG.html/pdf` (PDF mit Chrome im Headless-Modus), dazu eine Zip-Datei. Nach dem Erstellen `git bundle verify` und `unzip -t` ausführen. Alte Backups nie ungefragt löschen.
- **Gespräch exportieren:** das Werkzeug `export_transcript` legt eine Zip in Downloads.
