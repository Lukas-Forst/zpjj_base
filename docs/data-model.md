# Datenmodell

## Migriert (M0-M4)
- `users`, `slots` (mit optionalem `location`, z. B. "Rheinheim"; leer = Hauptstandort; Anwesenheitszahlen, "Zahlen fehlen" und trainingsfreie Tage gelten nur für den Hauptstandort, die Besetzungswarnung für alle Orte), `slot_trainers` (M0), `timer_presets` (M1), `vacations`, `substitutes`, `sync_state` (M3: Urlaub, Vertretung pro Slot und Datum, Zustand des Kalender-Abgleichs). `attendance`, `trials`, `trial_attendance` (M4: eine Zeile pro Tag mit optionalen Open-Mat-/Anfänger-Zählern und einer Gäste-Anzahl `guests` (Default 0, `trials + guests <= total`) statt Sessions pro Slot; Probetrainierende per `name_key` eindeutig, mit `status` (`offen`, `mitglied`, `zahlt_pro_besuch`; Default `offen`) und optionalem `member_since`). Speicher ist Cloudflare D1 (SQLite); das Schema steht in den SQL-Migrationen `apps/worker/migrations` (kein Alembic), Datum als `YYYY-MM-DD`-Text, Zeitstempel als ISO-8601-UTC-Text.
- Slot-Zeiten sind lokale Gym-Zeit (Europe/Berlin), Zeitstempel UTC. Slots werden nur deaktiviert.

## Nur dokumentiert (nicht migriert)

## Regeln
- Mitglieder = Gesamt − Probetraining − Gäste. "Nicht erfasst" ist **nicht** 0.
- Mitgliedschaft fällig = `status = offen`, mindestens 2 Besuche (1 kostenloses Probetraining).
- Personen mit `status = zahlt_pro_besuch` zahlen pro Besuch: lösen das Banner nie aus und zählen nicht im Probetraining-Trichter. `status = mitglied` (mit `member_since`) ist konvertiert. Einstufung durch die Gesellschafter an der Person, nachträglich änderbar. Gäste sind nur eine Anzahl pro Tag (`attendance.guests`), keine Personen.
- Eintrag eines Tages: strukturiert (Gesamt, Probetrainierende per Namen, Gäste, optional Open Mat/Anfänger, oder ausgefallen) per `PUT /api/attendance/{day}`; die frühere Textzeile ist entfernt. Alle Personen mit Status, Besuchen und Flags (`due`, `recent`) liefert `GET /api/trials`, den Status ändert `PATCH /api/trials/{id}`. Wochenverlauf (12 Wochen) und Wochentags-Schnitt (2 oder 3 Monate) liefert `GET /api/attendance/stats`.
- Der Excel-Import (`npm run import-excel` in `apps/worker`, erzeugt SQL für `wrangler d1 execute`) legt Tage und Probetrainierende an; im Excel als Mitglied markierte Personen bekommen `mitglied`, alle anderen `offen`; wer pro Besuch zahlt, wird danach in der App gesetzt (Tab Probetrainings).
