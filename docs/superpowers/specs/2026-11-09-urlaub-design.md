# M3: Urlaub und Besetzungswarnung (Design)

## Warum
Das Team trägt Urlaub heute als Termin "Vorname Urlaub" in einen gemeinsamen Google-Kalender ein und schaut nur gelegentlich hinein. Dadurch fällt zu spät auf, wenn eine Einheit ohne Trainer dasteht. **Es muss immer sichergestellt sein, dass ein Trainer da ist.**

## Ziele
- Trainer tragen ihren Urlaub in der Base ein (Von/Bis, ganze Tage). Alle sehen eine Übersicht, wer wann fehlt.
- Die Base warnt sichtbar, wenn eine Einheit an einem Datum **unbesetzt** ist (alle ihre Trainer im Urlaub, ohne Vertretung). Ist nur ein Teil der Trainer weg, gibt es einen schwächeren Hinweis.
- Abgleich mit Google Calendar in beide Richtungen als zweite Sicherheitsschicht:
  - Base → Kalender: jeder Urlaub aus der Base erscheint als ganztägiger Termin "Vorname Urlaub".
  - Kalender → Base: von Hand im Kalender angelegte Termine "Vorname Urlaub" werden eingelesen und zählen für die Warnung mit.

## Nicht-Ziele / Anti-Ziele
- Kein Genehmigungsworkflow, keine Urlaubstage-Kontingente.
- Keine halben Tage oder Uhrzeiten.
- Nie darf ein Sync-Fehler Urlaub stillschweigend löschen oder die Warnung verschwinden lassen. Im Zweifel gilt die Person als abwesend.
- Erfassung und Anwesenheit (M4) gehören nicht dazu.

## Entscheidungen des Auftraggebers
- Quelle: gemeinsamer Kalender, Titel "Vorname Urlaub" (Nico, Tim, Can, Chris, Lukas).
- Trainer pflegen ihren Urlaub selbst in der Base.
- Warnung direkt in der Base, auch auf der Startseite.
- Abgleich in beide Richtungen, Base ist Hauptquelle.

## Annahmen des Entwurfs (Vorschläge, noch nicht bestätigt)
- Zuordnung eines Kalendereintrags zu einem Nutzer über den Vornamen im Titel gegen `display_name` (ohne Groß-/Kleinschreibung, erstes Wort). Nicht zuordenbare Einträge werden ignoriert und in der Admin-Ansicht aufgelistet.
- Ein Trainer bearbeitet nur seinen eigenen Urlaub, Gesellschafter den aller.
- Vertretung: bei einer unbesetzten Einheit kann ein anderer Trainer "ich springe ein" antippen (Eintrag pro Slot und Datum). Eine Einheit mit Vertretung gilt als besetzt.
- Warnzeitraum: die nächsten 28 Tage.

## Constraints
- Bestehender Stack: FastAPI, SQLAlchemy/Alembic, SQLite auf Fly, Next.js-Export. Neue Migration nötig, neue Env-Variablen für Google (Zugang, Kalender-ID) analog zu Trello, nie im Repo.
- Google nur serverseitig, keine Zugangsdaten im Browser.
- Slotzeiten sind lokale Zeit Europe/Berlin. Urlaub ist in ganzen Tagen und daher zeitzonenunabhängig.

## Dem Builder überlassen
- Genaue Tabellen und Endpunkte, Form der Warnung in der UI, Sync-Takt, Art der Google-Authentifizierung (Service-Account bevorzugt), Behandlung von Löschungen und Änderungen auf beiden Seiten (z. B. ID des Base-Eintrags in `extendedProperties` des Termins), Tests mit simuliertem Google.
