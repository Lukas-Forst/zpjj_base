# M4: Anwesenheit (Design)

## Warum
Die Teilnehmerzahlen stehen heute in einem WhatsApp-Chat ("10 1 (David)") und werden von Hand in `ZeroPressure_Retention.xlsm` (Google Drive) übertragen. Das ist doppelte Arbeit, die Zahlen fehlen oft, und die Base kennt sie nicht. Die Base soll die Zahlen **direkt in der Kurzschreibweise des Chats** annehmen, damit die Excel-Datei überflüssig wird.

## Ziele
- Ein Textfeld nimmt die Kurzzeile an, zeigt vor dem Speichern, wie sie verstanden wurde, und speichert mit einem Tipp.
- Der Trainer des Tages trägt abends selbst ein. Jeder aus dem Team kann einen früheren Tag nachtragen.
- Probetrainings-Namen aus der Zeile werden als Personen gespeichert (Grundlage für die spätere Nachverfolgung).
- Der Hinweis "Zahlen von gestern fehlen" mit Button "Eintragen" erscheint im Heute-Streifen (Rest von M2).
- Die Kachel "Anwesenheit" wird aktiv und führt zur Erfassung mit einer kurzen Übersicht.
- Die bisherige Historie aus der Excel-Datei wird einmalig importiert.

## Nicht-Ziele / Anti-Ziele
- **Nachverfolgung der Probetrainings** (zweiter Besuch, Anmeldung, Status, Quelle, "Follow-up nötig") kommt erst **am Ende**, als eigene Phase nach diesem Entwurf. Excel bleibt dafür vorerst Quelle.
- Kein vollständiges Dashboard wie im Excel-Tab. Nur eine kurze Übersicht (siehe unten).
- Keine Anwesenheitslisten pro Person für Mitglieder, nur Zahlen.
- Nie darf ein fehlender Eintrag als 0 zählen. "Nicht erfasst" ist nicht 0.
- Kein Raten bei Eingaben, die nicht zur Schreibweise passen: Fehler anzeigen statt falsch speichern.

## Entscheidungen des Auftraggebers
- Eingabe per Tippen der Chat-Schreibweise, auch für neue Probetrainings-Personen.
- Wochentage: `Gesamt Probetrainings (Name, Name)`, z. B. `10 1 (David)`. Gesamt = alle auf der Matte, Probetrainings sind darin enthalten.
- Sonntag: `Mitglieder Probetrainings Openmat (Anfängerkurs)`, z. B. `0 0 4 (15)`.
  - Die ersten beiden Zahlen gehören zur Vormittagseinheit 10:00–11:30, Openmat läuft 11:30–13:00.
  - Der Anfängerkurs läuft nicht jeden Sonntag. Ohne Klammerzahl gab es keinen Kurs. Findet kein Kurs statt, trainieren Mitglieder von 10:00–11:30 trotzdem, sie stehen dann in der ersten Zahl.
  - Findet der Kurs statt, sind meist keine Mitglieder und Probetrainings in der Vormittagseinheit (`0 0`).
  - Ein Name in Klammern steht für ein Probetraining (`(Tom)` in der Beispielzeile war ein Tippfehler des Auftraggebers und kein Format).
- Eintragen: der Trainer des Tages. Nachtragen: andere aus dem Team.

## Regeln
- Mitglieder an Wochentagen = Gesamt − Probetrainings. Am Sonntag ist die erste Zahl direkt die Mitgliederzahl der Vormittagseinheit.
- Montag ist geschlossen. Für Tage ohne Slot gibt es keine Erfassungspflicht.
- Ein Tag kann als **ausgefallen** markiert werden (Feiertag, Absage). Ausgefallen ist weder 0 noch fehlend.
- Anzahl der Namen soll zur Probetrainings-Zahl passen. Weicht sie ab, zeigt die Vorschau eine Warnung, speichern bleibt möglich.

## Annahmen des Entwurfs (Vorschläge, vom Auftraggeber zu prüfen)
- **Ablage pro Tag und Block.** Blöcke: `training` (Wochentage und Sonntag-Vormittag), `open_mat`, `anfaenger`. Ein Eintrag pro Datum und Block, Zählwerte `gesamt` und `probetraining`; Anfängerkurs und Openmat sind eigene Zähler. Das entspricht der Zeile in Excel, nicht dem einzelnen Slot (Freitag und Samstag haben zwei Slots, es gibt aber nur eine Zahl pro Tag).
- **Probetrainings-Namen:** Person mit Name und erstem Datum (Tabelle `trials`) plus Verknüpfung zum Eintrag (`trial_attendance`). Gleicher Name (ohne Groß-/Kleinschreibung) am anderen Tag ist dieselbe Person, ein zweiter Besuch wird also erkannt, noch ohne Auswertung. Bei Namensgleichheit unterschiedlicher Menschen korrigieren Gesellschafter später.
- **Rechte:** Jede angemeldete Person darf Einträge für heute und die Vergangenheit anlegen und ändern, nicht für die Zukunft. Gespeichert wird, wer zuletzt geändert hat und wann.
- **Übersicht** auf der Seite: letzte Einträge mit Gesamt, Probetrainings, Mitglieder; Ø Teilnehmer der letzten 14 Tage; Ø pro Wochentag. Mehr (Probequote, Verläufe) später.
- **Heute-Streifen:** zeigt den Hinweis, wenn der letzte Öffnungstag (Montag zählt nicht) keinen Eintrag hat. Der Teil "nächste Einheit mit Zeit und Trainern" aus dem alten M2-Mockup bleibt draußen.
- **Excel-Import:** einmaliger CLI-Befehl liest den Tab "Trainingseinheiten" und "Probetrainings" (nur Namen und erstes Datum). Wiederholbar ohne Doppelungen. Openmat-Zeilen der alten Datei werden als Openmat-Zahl übernommen (siehe Beantwortet).

## Eingabe-Schreibweise (genau)
- Zahlen durch Leerzeichen getrennt, Klammern optional.
- Klammer mit Zahl = Anfängerkurs. Klammer mit Text = Namen, durch Komma getrennt.
- Wochentag: 1 oder 2 Zahlen (Probetrainings fehlt = 0). Sonntag: 3 Zahlen, Anfängerkurs optional.
- Beispiele: `10`, `10 1 (David)`, `8 2 (Mathias, Anthony)`, `5 0 4`, `0 0 4 (15)`, `6 0 3`.
- Leere Eingabe oder Zahlen, die sich widersprechen (mehr Probetrainings als Gesamt), werden abgelehnt.

## Constraints
- Bestehender Stack: FastAPI, SQLAlchemy/Alembic, SQLite auf Fly, Next.js-Export, Cloudflare Access. Neue Migration, neuer Router, OpenAPI-Schema neu erzeugen.
- Datum und Slots in Europe/Berlin. "Heute" ist der Berliner Tag.
- Zahlen gehen über die API, nicht über Excel oder Google. Keine neuen Geheimnisse.
- Offline gilt wie bisher nur für Timer und Stundenplan, Eintragen braucht Netz.

## Dem Builder überlassen
- Genaue Tabellenform und Endpunkte, Parser (als reine Funktion mit Tests auf allen Beispielen oben), Gestaltung von Vorschau und Seite, Umgang mit Doppel-Einreichung (zweiter Eintrag für denselben Tag ersetzt den ersten nach Bestätigung), Import-Details.

## Beantwortet
- Openmat zählt **nicht** zur Tagesgesamtzahl (würde Durchschnitte verzerren). Es wird getrennt ausgewiesen.
- Excel-Spalte "Openmat/Gäste" sind überwiegend Openmat-Besucher, keine Gäste. Beim Import werden die Openmat-Zeilen der alten Datei (Kursart "Open Mat", Spalte "Teilnehmer gesamt") als Openmat-Zahl übernommen, nicht als Gäste.
