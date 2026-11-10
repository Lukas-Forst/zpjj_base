# Offene Fragen

- Logo-Dateien für Icons und App-Shell (aktuell Platzhalter, `TODO: Logo ersetzen` in `components/Logo.tsx` und `apps/web/public/icons/`).
- Echte E-Mail-Adressen der Teammitglieder (nur lokal in `apps/worker/seed/users.local.yaml`, nie im Repo).
- Soll der Stundenplan später aus der Homepage-Quelle (`zpjj.de/schedule`) gespeist werden statt doppelt gepflegt zu werden?
- Anfängerkurs ist ein separater Kurs und steht nicht im Wochenplan. Gehört er ins CRM (Kohorte)? Hier nicht abgebildet.
- Cloudflare-Access-Application, Team-Domain und AUD-Tag sind noch manuell anzulegen und als Worker-Secrets zu setzen (siehe `deploy.md`).
- HeroUI v3 hat keine `Navbar`-Komponente: die Kopfzeile ist eigener Markup plus `Drawer` (Entscheidung, siehe Kurzbericht).
- Konto-Button ist vorerst ein deaktivierter Namens-Button (kein Logout bei Cloudflare Access ohne Team-Domain-URL): Logout-Link `https://<team>.cloudflareaccess.com/cdn-cgi/access/logout` ergänzen, sobald bekannt.
- Umbenennung: Die App heißt jetzt **ZPJJ Base** (vorher "ZPJJ Hub", wegen Assoziation mit 18+-Seiten). Domain ist `base.zpjj.de`, Worker `zpjj-base`, D1-Datenbank `zpjj-base`. Das Repo-Verzeichnis und der Prompt `docs/m0_promptplan.md` tragen noch den alten Namen (Prompt bleibt als Historie unverändert).
- Probetraining-Follow-up, noch offen: Quelle und Kontakt der Probetrainierenden (nicht erfasst), Verknüpfung mit den Trello-Themen, und nach dem Excel-Import die erfassten Pro-Besuch-Zahler im Tab Probetrainings markieren.
