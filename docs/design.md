# Design: Ink & Paper

Tokens: `apps/web/styles/tokens.css` (HeroUI-Variablen werden dort überschrieben). Schriften: Inter Tight, JetBrains Mono (Zeiten, Zähler, Timer) über `next/font`.

## Regeln
1. Haarlinien statt Karten: kein Schatten, kein Verlauf, Radius höchstens 2 px (Ausnahme runder Avatar).
2. Blau (`--action`) ist die einzige Farbe für Buttons und Links. Rot (`--brand-red`) nur als Logo-Balken. Bernstein (`--warn`) nur als kleiner Punkt oder Timer-Vorbereitung. Fehlertext ist Ink, nie Rot.
3. Keine Emojis, Icons nur als Inline-SVG (`lucide-react`, Strichstärke 1.75).
4. Keine erfundenen Daten. Leere Zustände sind ein ruhiger Satz.
5. Kontrast mindestens 4.5:1, Tippflächen mindestens 44 px, Fokusring 2 px Blau mit 2 px Abstand.
6. Farben in Komponenten ausschließlich über Token-Klassen (`bg-paper`, `text-ink`, `text-muted-ink`, `border-hairline`, `bg-action`, `bg-night` ...).

## Komponenten
`components/ui/index.tsx`: AppHeader, SectionHeader, ListRow, SlotTag, Button, TextLink, StatusMark, EmptyState. Übersicht: `/dev/ui` (nur Dev-Server).

## Prüfung
`npm run check:design` (läuft in CI) schlägt bei Emojis, Schatten, Verläufen, großen Radien und Hex-Farben in Komponenten fehl.
