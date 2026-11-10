# Datenmodell

## Migriert (M0-M4)
- `users`, `slots`, `slot_trainers` (M0), `timer_presets` (M1), `vacations`, `substitutes`, `sync_state` (M3: Urlaub, Vertretung pro Slot und Datum, Zustand des Kalender-Abgleichs). `attendance`, `trials`, `trial_attendance` (M4: eine Zeile pro Tag mit optionalen Open-Mat-/Anfänger-Zählern und einer Gäste-Anzahl `guests` (Default 0, `trials + guests <= total`) statt Sessions pro Slot; Probetrainierende per `name_key` eindeutig, mit `status` (`offen`, `mitglied`, `zahlt_pro_besuch`; Default `offen`) und optionalem `member_since`). Siehe `apps/api/app/models.py`.
- Slot-Zeiten sind lokale Gym-Zeit (Europe/Berlin), Zeitstempel UTC. Slots werden nur deaktiviert.

## Nur dokumentiert (nicht migriert)

## Regeln
- Mitglieder = Gesamt − Probetraining − Gäste. "Nicht erfasst" ist **nicht** 0.
- Mitgliedschaft fällig = `status = offen`, mindestens 2 Besuche (1 kostenloses Probetraining).
- Personen mit `status = zahlt_pro_besuch` (früher `drop_in`) zahlen pro Besuch: lösen das Banner nie aus und zählen nicht im Probetraining-Trichter. `status = mitglied` (mit `member_since`) ist konvertiert. Einstufung durch die Gesellschafter an der Person, nachträglich änderbar. Gäste sind nur eine Anzahl pro Tag (`attendance.guests`), keine Personen.
- Importdateien (`sessions.csv`, `trials.csv`, `trial_attendance.csv`) kommen aus `import_excel.py`; der Import markiert Justus, Liam und Michael per `--drop-in` (künftig als `status = zahlt_pro_besuch`).
