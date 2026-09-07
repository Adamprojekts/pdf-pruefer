// Kleine Hilfsfunktionen, ausgelagert damit app.js nicht zu lang wird.

var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
}

// LanguageTool schickt viele verschiedene Fehlertypen -> auf 5 Kategorien eindampfen.
function issueBucket(issueType) {
  if (issueType === "misspelling") return "misspelling";
  if (issueType === "grammar") return "grammar";
  if (issueType === "typographical") return "typographical";
  if (issueType === "style" || issueType === "register") return "style";
  return "other";
}

// Eindeutiger Schlüssel pro Fundstelle, damit man einzelne ignorieren kann.
function matchKey(m) {
  return m.page + "|" + m.offset + "|" + m.ruleId;
}

// Die öffentliche LanguageTool-API nimmt nur ~20.000 Zeichen pro Anfrage.
// Deshalb langen Seitentext in Stücke schneiden - möglichst an Zeilen-,
// sonst an Satz-, sonst an Wortgrenzen.
function chunkText(text, maxChars) {
  var limit = maxChars || 18000;
  var chunks = [];
  var pos = 0;

  while (text.length - pos > limit) {
    var slice = text.slice(pos, pos + limit);
    var cut = slice.lastIndexOf("\n");
    if (cut < limit * 0.5) cut = slice.lastIndexOf(". ");
    if (cut < limit * 0.5) cut = slice.lastIndexOf(" ");
    if (cut <= 0) cut = limit;
    chunks.push({ text: text.slice(pos, pos + cut), offset: pos });
    pos += cut;
  }
  chunks.push({ text: text.slice(pos), offset: pos });
  return chunks;
}

// Die Antwort von LanguageTool in ein einfacheres Objekt umbauen.
// base = Position des geprüften Stücks im gesamten Seitentext.
function normalizeMatch(m, page, base) {
  var rule = m.rule || {};
  var category = rule.category || {};
  var context = m.context || {};
  return {
    page: page,
    offset: (base || 0) + (m.offset || 0),
    length: m.length || 0,
    message: m.message || "",
    shortMessage: m.shortMessage || "",
    replacements: (m.replacements || []).slice(0, 6).map(function (r) { return r.value; }),
    contextText: context.text || "",
    contextOffset: context.offset || 0,
    contextLength: context.length || 0,
    issueType: rule.issueType || "other",
    categoryName: category.name || "Sonstige",
    ruleId: rule.id || ""
  };
}
