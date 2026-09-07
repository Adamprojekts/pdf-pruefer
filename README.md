# PDF-Prüfer

Ein kleines Werkzeug, das im Browser läuft und ein deutsches PDF auf
Rechtschreib- und Grammatikfehler prüft. Man öffnet ein PDF, das Tool liest
den Text Seite für Seite aus und schickt ihn an
[LanguageTool](https://languagetool.org). Die Fundstellen werden im Dokument
farbig markiert und rechts in einer Liste mit Korrekturvorschlägen angezeigt.

## ▶ [Live-Demo ausprobieren](https://adamprojekts.github.io/pdf-pruefer/)

<https://adamprojekts.github.io/pdf-pruefer/>

## Screenshot

![Oberfläche des PDF-Prüfers](screenshots/ui.png)

> Das Bild oben ist noch eine Designvorschau. Für einen echten Screenshot die
> Demo öffnen, ein PDF prüfen, einen Screenshot machen und damit die Datei
> **`screenshots/ui.png`** überschreiben:
> `git add screenshots/ui.png && git commit -m "Echter Screenshot" && git push`.
> Ein kurzes GIF (PDF öffnen → prüfen → Fehler anklicken) wirkt noch besser.

## Was es kann

- PDF direkt im Browser anzeigen (mit pdf.js) – die Datei wird **nicht
  hochgeladen**, sie bleibt auf dem eigenen Rechner
- Text pro Seite auslesen
- Rechtschreibung, Grammatik, Typografie und Stil über die LanguageTool-API prüfen
- Fehler farbig im PDF markieren (rot = Rechtschreibung, gelb = Grammatik,
  blau = Typografie, grün = Stil)
- Liste mit Kontext und Vorschlägen; Klick springt zur Stelle im PDF
- Einzelne Fehler ignorieren
- Sprachvariante wählen: Deutsch DE / AT / CH
- Nach Fehlerart filtern

## So funktioniert's

- **`index.html`** ist die Oberfläche.
- **`lib.js`** enthält die kleinen Hilfsfunktionen (Text in Stücke schneiden,
  Fehlertypen sortieren) – ausgelagert, damit `app.js` nicht zu lang wird.
- **`app.js`** macht den Rest: PDF laden, Text auslesen, LanguageTool fragen,
  Ergebnisse anzeigen und markieren.
- **`config.js`** hält die API-Adresse. Standard ist die öffentliche
  LanguageTool-API – **kein Schlüssel nötig**.

Zwei Dinge, die etwas Denken gekostet haben:

1. Die Gratis-API nimmt nur ~20.000 Zeichen pro Anfrage und ca. 20 Anfragen
   pro Minute. Deshalb wird langer Text an Satz-/Zeilengrenzen zerschnitten
   und zwischen den Anfragen kurz gewartet.
2. Um einen Fehler an der richtigen Stelle im PDF zu markieren, brauche ich
   die Position jedes Wortes. Die liefert pdf.js; daraus rechne ich für jede
   Fundstelle ein farbiges Kästchen über der passenden Stelle aus.

## Lokal starten

Es gibt keinen Build-Schritt, nur statische Dateien.

```bash
git clone https://github.com/Adamprojekts/pdf-pruefer.git
cd pdf-pruefer
python3 -m http.server 8000
```

Dann im Browser <http://localhost:8000> öffnen.

(Ein kleiner Webserver ist nötig, weil der Browser den pdf.js-Worker sonst
blockiert, wenn man `index.html` direkt per Doppelklick öffnet.)

## Bekannte Grenzen

- **Gescannte PDFs** (nur Bild, kein Text) können nicht geprüft werden – es
  ist keine Texterkennung eingebaut.
- Die Markierungen sitzen wortweise. Bei ungewöhnlichen Schriften können sie
  ein paar Pixel daneben liegen.
- Mit der Gratis-API dauern große Dokumente wegen der Wartezeiten länger.
- LanguageTool findet nicht jeden Fehler und meldet manchmal Fehlalarme –
  dafür gibt es den „Ignorieren"-Knopf.
- Getestet nur mit deutschsprachigen PDFs.

## Eigenen LanguageTool-Server nutzen

In `config.js` einfach `endpoint` auf die eigene Adresse setzen, z. B.
`"http://localhost:8081/v2/check"`. Für LanguageTool Premium zusätzlich
`username` und `apiKey` eintragen. Wenn dort ein echter Schlüssel steht,
sollte `config.js` nicht mit hochgeladen werden (Zeile in `.gitignore`
einkommentieren).

## Technik

- Reines JavaScript, kein Framework, kein Build
- [pdf.js](https://mozilla.github.io/pdf.js/) für Anzeige und Textauslesen (über CDN)
- [LanguageTool](https://languagetool.org)-API für die Prüfung

## Hinweis

Lernprojekt. Die Idee und der Aufbau sind von mir, beim Code hat mir ein
KI-Assistent geholfen.

## Lizenz

[MIT](LICENSE)
