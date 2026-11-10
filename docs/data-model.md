# Datenmodell

## Migriert (M0-M4)
- `users`, `slots`, `slot_trainers` (M0), `timer_presets` (M1), `vacations`, `substitutes`, `sync_state` (M3: Urlaub, Vertretung pro Slot und Datum, Zustand des Kalender-Abgleichs). `attendance`, `trials`, `trial_attendance` (M4: eine Zeile pro Tag mit optionalen Open-Mat-/Anfänger-Zählern statt Sessions pro Slot; Probetrainierende per `name_key` eindeutig). Siehe `apps/api/app/models.py`.
- Slot-Zeiten sind lokale Gym-Zeit (Europe/Berlin), Zeitstempel UTC. Slots werden nur deaktiviert.

## Nur dokumentiert (nicht migriert)

## Regeln
- Mitglieder = Gesamt − Probetraining − Gäste. "Nicht erfasst" ist **nicht** 0.
- Mitgliedschaft fällig = `person_kind = trial`, mindestens 2 Besuche, nicht konvertiert (1 kostenloses Probetraining).
- Drop-ins (`drop_in`) zahlen pro Besuch: lösen das Banner nie aus, zählen nicht im Probetraining-Trichter, gehören in der Auslastung zu den Gästen. Einstufung durch die Gesellschafter an der Person, nachträglich änderbar.
- Importdateien (`sessions.csv`, `trials.csv`, `trial_attendance.csv`) kommen aus `import_excel.py`; der Import markiert Justus, Liam und Michael per `--drop-in` als `drop_in`.
