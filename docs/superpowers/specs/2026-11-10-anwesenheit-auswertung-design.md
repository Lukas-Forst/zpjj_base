# M4b: Anwesenheit mit Feldern, Auswertung und Probetrainings (Design)

Baut auf `2026-11-10-anwesenheit-design.md` (M4, gemerged) auf. Die Seite `/anwesenheit/` bekommt drei Reiter. Die Eingabe per Textzeile wird durch Felder ersetzt.

## Warum
- Die Coaches wollen schnell sehen, **welche Tage und Kurse wie gut besucht sind** und wie sich das entwickelt.
- Probetrainings sind auf **2 kostenlose Besuche** begrenzt. Danach muss die Person Mitglied werden oder pro Besuch zahlen. Das Team muss **wissen, wer in den letzten 2–4 Wochen im Probetraining war**, um die Person beim Wiederkommen anzusprechen.
- Die Textzeile ist für neue Leute unübersichtlich. Felder sind klarer, besonders für die Namen.

## Ziele
- Reiter **Eintragen**, **Auswertung**, **Probetrainings** auf der Seite `/anwesenheit/`.
- **Eintragen:** Felder statt Textzeile. "Probetraining" ist vorbelegt mit 0. Wird die Zahl größer als 0, erscheint pro Person ein freies Namensfeld. Bekannte Namen werden beim Tippen vorgeschlagen (mit Hinweis, wie oft die Person schon da war).
- **Auswertung:** ein **Liniendiagramm** (Ø Teilnehmer pro Woche, zeigt die Entwicklung) und ein **Balkendiagramm** (Ø Teilnehmer pro Wochentag über die letzten 2 oder 3 Monate, umschaltbar).
- **Probetrainings:** Liste aller Personen mit einem Probetraining in den letzten 4 Wochen. Wer zwei Besuche hat und noch nicht entschieden ist, steht oben mit "Entscheidung fällig". Ein Tipp setzt den Status: Mitglied geworden oder zahlt pro Besuch.
- Importierte Probetrainings aus der Excel-Datei erscheinen mit ihrem alten Status.

## Nicht-Ziele / Anti-Ziele
- Kein Export, keine Filter nach Trainer oder Kurs, keine Vergleiche mit Vorjahren.
- Keine Benachrichtigungen, kein Versand von Nachrichten an die Person. Die Liste ist nur eine Gedächtnisstütze.
- Openmat und Anfängerkurs gehen **nie** in die Durchschnitte ein (Entscheidung aus M4, bleibt).
- Nie darf ein nicht erfasster Tag als 0 in einen Durchschnitt oder ins Diagramm eingehen. Lücken bleiben Lücken.
- Die Probetraining-Liste darf eine Person nie stillschweigend verlieren: Eine Entscheidung wird gespeichert und ist änderbar.

## Entscheidungen des Auftraggebers
- Eingabe mit Feldern, Probetraining standardmäßig 0, bei Zahl über 0 ein freies Namensfeld pro Person.
- Alles bleibt im Bereich Anwesenheit, mit der Aufteilung in Reiter. Der Probetraining-Reiter gefällt in der gezeigten Form (Karten mit Name, Besuchen und Datum, "Entscheidung fällig" rot, Rest nach letztem Besuch).
- Auswertung: ein Linienchart für die Entwicklung, ein Balkendiagramm mit dem Durchschnitt der letzten 2–3 Monate.
- Max. 2 Probetrainings: danach Mitgliedschaft oder pro Besuch zahlen.

## Annahmen des Entwurfs (Vorschläge, vom Auftraggeber zu prüfen)
- **Zahlt pro Besuch** (Gast): zählt bei späteren Besuchen **nicht** als Probetraining und löst die Warnung nie wieder aus. Er steht in der Eintragen-Maske in einem eigenen Feld "Davon Gäste (zahlen pro Besuch)", vorbelegt mit 0, mit Namensvorschlag aus dieser Gruppe. Mitglieder = Gesamt − Probetrainings − Gäste (wie die Excel-Formel). Das entspricht der Regel in `docs/data-model.md` (Drop-ins).
- **Status einer Person** (`trials.status`): `offen` (Standard), `mitglied`, `zahlt_pro_besuch`. "Entscheidung fällig" = Status `offen` und mindestens 2 Besuche. Wer Status `mitglied` oder `zahlt_pro_besuch` hat, steht nicht mehr oben, bleibt aber 4 Wochen in der Liste, danach verschwindet die Person aus ihr (nicht aus der Datenbank).
- **Flagge "Mitglied" (Klarstellung des Auftraggebers):** Der Status dient dazu, eine Person zu kennzeichnen, die sich als Mitglied angemeldet hat und deshalb **nichts mehr pro Besuch zahlen muss**. Ab dann gilt: kein "Entscheidung fällig", kein Hinweis auf Zahlung, und der Name wird in der Eintragen-Maske nicht mehr als Probetraining vorgeschlagen (die Person zählt bei den Mitgliedern). Die Karte zeigt "Mitglied seit {Datum}" (`trials.member_since`, beim Setzen auf heute, änderbar). Die Flagge lässt sich zurücknehmen. Entsprechend zeigt "zahlt pro Besuch" ein "zahlt pro Besuch"-Etikett.
- **Liste "letzte 4 Wochen"** = Personen mit mindestens einem Besuch in den letzten 28 Tagen. Dritter Besuch bei Status `offen` ist weiterhin "fällig" und wird hervorgehoben ("3 Besuche").
- **Diagramme:** Wochen-Linie über die letzten 12 Wochen, Ø pro Woche aus den Tagen mit Zahl (ohne Openmat, Anfängerkurs, ausgefallene Tage). Balken: Ø pro Wochentag, Auswahl "2 Monate" oder "3 Monate", Standard 3. Nicht erfasste Wochen und Wochentage sind sichtbar leer, nicht 0.
- **Sonntag in der Eintragen-Maske:** Felder "Mitglieder (10:00–11:30)", "Davon Probetraining", "Davon Gäste", "Openmat", "Anfängerkurs" (leer = kein Kurs). Die gespeicherte Gesamtzahl der Vormittagseinheit = Mitglieder + Probetraining + Gäste.
- **Textzeile und Parser fallen weg** (Endpunkt `parse`, `attendance_parse.py`), weil die Felder sie ersetzen. Der Excel-Import bleibt.
- **Excel-Import:** Der Tab "Probetrainings" liefert `Status`, `Angemeldet?`: "Mitglied geworden" oder "Angemeldet? = Ja" → `mitglied`; alles andere → `offen`. "Zahlt pro Besuch" gibt es in der alten Datei nicht. Die drei Personen, die schon als Drop-in bekannt sind, setzen die Gesellschafter nach dem Import in der App.
- **Rechte:** Wie bisher darf jede angemeldete Person eintragen und Status setzen; gespeichert wird, wer zuletzt geändert hat.

## Regeln
- Mitglieder = Gesamt − Probetrainings − Gäste. Anzahl der Namen im Probetraining-Feld = Zahl Probetrainings (Pflicht in der Maske, kein Raten); leere Namensfelder werden abgelehnt.
- Eine Person mit demselben Namen (ohne Groß-/Kleinschreibung) ist dieselbe Person.
- Zwei Besuche am selben Tag zählen als ein Besuch.
- Ein nicht erfasster Tag ist nicht 0. Ein ausgefallener Tag fließt nicht in Durchschnitte ein.

## Constraints
- Bestehender Stack: FastAPI, SQLAlchemy/Alembic, SQLite, Next.js-Export, HeroUI, Tailwind. Neue Migration (`attendance.guests`, `trials.status` mit Standard `offen`).
- **Keine neue Chart-Bibliothek, wenn zwei einfache Diagramme als SVG reichen** (Entscheidung des Builders, Begründung im Plan). Farben und Beschriftung müssen im hellen und dunklen Modus lesbar sein, Werte sind auch als Zahl sichtbar (nicht nur über Farbe oder Hover).
- Mobil zuerst: Reiter, Diagramme und Karten funktionieren auf einem Handy, Tippziele mindestens 44 px.
- Datum und Zeiträume in Europe/Berlin.

## Dem Builder überlassen
- Tabellenform und Endpunkte (z. B. `GET /api/attendance/stats`, `GET /api/trials/recent`, `PATCH /api/trials/{id}`), Form der Reiter, Vorschlagsliste für Namen, Diagrammdetails (Achsen, Beschriftungen), Umgang mit gleichzeitigem Speichern, Tests.

## Beantwortet
- Status-Punkt vom Auftraggeber geprüft: Er soll vor allem die Mitglied-Flagge sein (siehe Annahmen). Sonst in Ordnung.

## Noch offen (nur der Auftraggeber kann antworten)
- Keine.
