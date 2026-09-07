/*
 * Konfiguration für den PDF-Prüfer.
 *
 * Standard: die ÖFFENTLICHE LanguageTool-API. Sie braucht KEINEN Schlüssel
 * und keine Anmeldung. Grenzen der Gratis-Nutzung (Stand 2026):
 *   - ca. 20 Anfragen pro Minute
 *   - max. 20 000 Zeichen pro Anfrage  (das Tool zerlegt lange Seiten selbst)
 *
 * Eigener Server oder LanguageTool Premium?
 *   1. "endpoint" auf die eigene URL setzen, z. B.
 *      "http://localhost:8081/v2/check"  (lokaler LanguageTool-Server)
 *   2. Für Premium zusätzlich "username" und "apiKey" ausfüllen.
 *
 * ACHTUNG: Wenn hier ein echter Schlüssel eingetragen wird, sollte diese
 * Datei NICHT mit veröffentlicht werden. Dann in .gitignore eine Zeile
 * "config.js" ergänzen und stattdessen "config.example.js" pflegen.
 */
window.PDFPRUEFER_CONFIG = {
  endpoint: "https://api.languagetool.org/v2/check",
  username: "",
  apiKey: "",

  // Technische Grenzwerte – nur anfassen, wenn ein eigener Server genutzt wird.
  maxCharsPerRequest: 18000,
  minDelayBetweenRequestsMs: 3200
};
