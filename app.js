/* PDF-Prüfer — Kernlogik
 * PDF anzeigen (pdf.js), Text pro Seite auslesen, mit LanguageTool prüfen,
 * Fundstellen in der Seitenleiste UND direkt im PDF markieren,
 * einzelne Fundstellen ignorieren.
 */
(function () {
  "use strict";

  // escapeHtml, issueBucket, matchKey, chunkText, normalizeMatch kommen aus lib.js
  var CONFIG = window.PDFPRUEFER_CONFIG || {};
  var ENDPOINT = CONFIG.endpoint || "https://api.languagetool.org/v2/check";
  var MAX_CHARS = CONFIG.maxCharsPerRequest || 18000;
  var MIN_DELAY = CONFIG.minDelayBetweenRequestsMs || 3200;
  var SCALE = 1.3;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  var els = {
    openBtn: document.getElementById("openBtn"),
    fileInput: document.getElementById("fileInput"),
    langSelect: document.getElementById("langSelect"),
    checkBtn: document.getElementById("checkBtn"),
    filterSelect: document.getElementById("filterSelect"),
    viewer: document.getElementById("viewer"),
    pages: document.getElementById("pages"),
    viewerPlaceholder: document.getElementById("viewerPlaceholder"),
    status: document.getElementById("statusBar"),
    results: document.getElementById("results"),
    resultsEmpty: document.getElementById("resultsEmpty"),
    resultCount: document.getElementById("resultCount"),
    ignoredBar: document.getElementById("ignoredBar"),
    pillPages: document.querySelector("#pillPages span:last-child"),
    pillErrors: document.querySelector("#pillErrors span:last-child")
  };

  var state = {
    pdfDoc: null,
    pageTexts: [],   // Text je Seite (Index 0 = Seite 1)
    pageBoxes: [],    // je Seite: [{ start, end, left, top, width, height }] in Canvas-Pixeln
    matches: [],      // s. normalizeMatch() in lib.js
    ignored: new Set(),
    showIgnored: false,
    checking: false
  };

  // ---- Hilfsfunktionen -----------------------------------------------------

  function setStatus(text, kind) {
    if (!text) { els.status.hidden = true; els.status.textContent = ""; return; }
    els.status.hidden = false;
    els.status.textContent = text;
    els.status.className = "status" + (kind ? " status--" + kind : "");
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isIgnored(m) { return state.ignored.has(matchKey(m)); }

  function activeMatches() { return state.matches.filter(function (m) { return !isIgnored(m); }); }

  function visibleMatches() {
    var filter = els.filterSelect.value;
    return activeMatches().filter(function (m) {
      return filter === "all" || issueBucket(m.issueType) === filter;
    });
  }

  // ---- PDF laden und anzeigen --------------------------------------------

  function loadPdf(arrayBuffer) {
    resetAll();
    setStatus("PDF wird geladen …");
    els.pages.innerHTML = "";
    if (els.viewerPlaceholder) els.viewerPlaceholder.hidden = true;

    return pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (pdf) {
      state.pdfDoc = pdf;
      state.pageTexts = new Array(pdf.numPages);
      state.pageBoxes = new Array(pdf.numPages);
      els.pillPages.textContent = pdf.numPages + (pdf.numPages === 1 ? " Seite" : " Seiten");

      var seq = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pageNum) {
          seq = seq.then(function () { return renderPage(pageNum); });
        })(i);
      }
      return seq;
    }).then(function () {
      setStatus("");
      els.checkBtn.disabled = false;
    }).catch(function (err) {
      console.error(err);
      setStatus("PDF konnte nicht geladen werden: " + err.message, "error");
    });
  }

  function renderPage(pageNum) {
    return state.pdfDoc.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: SCALE });

      var wrap = document.createElement("div");
      wrap.className = "page";
      wrap.id = "page-" + pageNum;

      var label = document.createElement("div");
      label.className = "page-label";
      label.textContent = "Seite " + pageNum;
      wrap.appendChild(label);

      var canvasWrap = document.createElement("div");
      canvasWrap.className = "canvas-wrap";
      canvasWrap.style.width = Math.floor(viewport.width) + "px";
      canvasWrap.style.height = Math.floor(viewport.height) + "px";

      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvasWrap.appendChild(canvas);

      var textLayer = document.createElement("div");
      textLayer.className = "textlayer";
      canvasWrap.appendChild(textLayer);

      wrap.appendChild(canvasWrap);
      els.pages.appendChild(wrap);

      var renderTask = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport: viewport
      }).promise;

      var textTask = page.getTextContent().then(function (tc) {
        var parts = [];
        var boxes = [];
        var lastY = null;
        var cursor = 0;

        tc.items.forEach(function (it) {
          if (!("str" in it)) return;
          var sep = "";
          if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) sep = "\n";
          else if (parts.length) sep = " ";
          cursor += sep.length;
          parts.push(sep);

          var start = cursor;
          parts.push(it.str);
          cursor += it.str.length;
          lastY = it.transform[5];

          if (it.str.trim()) {
            var tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
            var fontHeight = Math.hypot(tx[2], tx[3]) || 10;
            boxes.push({
              start: start,
              end: start + it.str.length,
              left: tx[4],
              top: tx[5] - fontHeight,
              width: (it.width || 0) * SCALE || fontHeight * it.str.length * 0.5,
              height: fontHeight * 1.15
            });
          }
        });

        state.pageTexts[pageNum - 1] = parts.join("");
        state.pageBoxes[pageNum - 1] = boxes;
      });

      return Promise.all([renderTask, textTask]);
    });
  }

  // ---- Prüfung -----------------------------------------------------------

  function checkDocument() {
    if (state.checking || !state.pdfDoc) return;
    state.checking = true;
    state.matches = [];
    state.ignored = new Set();
    state.showIgnored = false;
    els.checkBtn.disabled = true;
    els.filterSelect.disabled = true;
    els.results.innerHTML = "";
    els.resultsEmpty.hidden = true;

    var language = els.langSelect.value;

    var jobs = [];
    state.pageTexts.forEach(function (t, i) {
      var text = t || "";
      if (!text.trim()) return;
      chunkText(text, MAX_CHARS).forEach(function (c) {
        jobs.push({ page: i + 1, text: c.text, base: c.offset });
      });
    });

    if (jobs.length === 0) {
      setStatus("Kein extrahierbarer Text gefunden. Ist das PDF gescannt (nur Bild)?", "warn");
      finishChecking();
      return;
    }

    var seq = Promise.resolve();
    jobs.forEach(function (job, idx) {
      seq = seq.then(function () {
        setStatus("Prüfe … (" + (idx + 1) + "/" + jobs.length + ")");
        return checkChunk(job.text, language).then(function (raw) {
          raw.forEach(function (r) {
            state.matches.push(normalizeMatch(r, job.page, job.base));
          });
          state.matches.sort(function (a, b) { return a.page - b.page || a.offset - b.offset; });
          renderMatches();
          if (idx < jobs.length - 1) return sleep(MIN_DELAY);
        });
      });
    });

    seq.then(function () {
      var n = state.matches.length;
      setStatus(n
        ? "Fertig — " + n + " Fundstelle(n)."
        : "Fertig — keine Auffälligkeiten gefunden.", "ok");
      finishChecking();
    }).catch(function (err) {
      console.error(err);
      setStatus("Prüfung abgebrochen: " + err.message, "error");
      finishChecking();
    });
  }

  function finishChecking() {
    state.checking = false;
    els.checkBtn.disabled = false;
    els.filterSelect.disabled = state.matches.length === 0;
    renderMatches();
  }

  function checkChunk(text, language) {
    var body = new URLSearchParams();
    body.set("text", text);
    body.set("language", language);
    body.set("level", "default");
    if (CONFIG.username && CONFIG.apiKey) {
      body.set("username", CONFIG.username);
      body.set("apiKey", CONFIG.apiKey);
    }

    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: body.toString()
    }).then(function (res) {
      if (res.status === 429) throw new Error("Zu viele Anfragen (Limit der Gratis-API). Später erneut versuchen oder eigenen LanguageTool-Server in config.js eintragen.");
      if (!res.ok) throw new Error("LanguageTool antwortete mit HTTP " + res.status);
      return res.json();
    }).then(function (data) { return data.matches || []; });
  }

  // ---- Markierungen im PDF -------------------------------------------

  function paintHighlights() {
    els.pages.querySelectorAll(".textlayer").forEach(function (l) { l.innerHTML = ""; });

    visibleMatches().forEach(function (m) {
      var layer = document.querySelector("#page-" + m.page + " .textlayer");
      var boxes = state.pageBoxes[m.page - 1];
      if (!layer || !boxes) return;

      var o = m.offset, e = m.offset + Math.max(m.length, 1);
      boxes.forEach(function (b) {
        if (b.end <= o || b.start >= e) return;
        var span = Math.max(b.end - b.start, 1);
        var f0 = Math.max(0, (o - b.start) / span);
        var f1 = Math.min(1, (e - b.start) / span);

        var hl = document.createElement("div");
        hl.className = "hl hl--" + issueBucket(m.issueType);
        hl.dataset.key = matchKey(m);
        hl.style.left = (b.left + b.width * f0) + "px";
        hl.style.top = b.top + "px";
        hl.style.width = Math.max(b.width * (f1 - f0), 4) + "px";
        hl.style.height = b.height + "px";
        hl.title = m.shortMessage || m.message;
        hl.addEventListener("click", function () { focusResult(matchKey(m)); });
        layer.appendChild(hl);
      });
    });
  }

  function pulse(key) {
    document.querySelectorAll('.hl[data-key="' + cssEsc(key) + '"]').forEach(function (hl) {
      hl.classList.add("hl--active");
      setTimeout(function () { hl.classList.remove("hl--active"); }, 1400);
    });
  }

  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  function scrollToPage(page) {
    var target = document.getElementById("page-" + page);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Klick auf eine PDF-Markierung -> Eintrag in der Seitenleiste hervorheben.
  function focusResult(key) {
    var li = els.results.querySelector('li[data-key="' + cssEsc(key) + '"]');
    if (!li) return;
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.classList.add("result--active");
    setTimeout(function () { li.classList.remove("result--active"); }, 1400);
  }

  // ---- Ergebnisliste ---------------------------------------------------

  function renderMatches() {
    var active = activeMatches();
    var visible = visibleMatches();
    var ignoredCount = state.matches.length - active.length;

    els.pillErrors.textContent = active.length +
      (active.length === 1 ? " Fundstelle" : " Fundstellen") +
      (ignoredCount ? " (+" + ignoredCount + " ignoriert)" : "");
    els.resultCount.textContent = state.matches.length
      ? visible.length + " von " + active.length
      : "—";

    els.results.innerHTML = "";

    if (state.matches.length === 0) {
      els.resultsEmpty.hidden = false;
      els.resultsEmpty.textContent = state.checking ? "Prüfung läuft …" : "Noch nichts geprüft.";
    } else {
      els.resultsEmpty.hidden = visible.length > 0;
      if (visible.length === 0) els.resultsEmpty.textContent = "Keine Treffer für diesen Filter.";
      visible.forEach(function (m) { els.results.appendChild(renderItem(m, false)); });

      if (state.showIgnored) {
        state.matches.filter(isIgnored).forEach(function (m) {
          els.results.appendChild(renderItem(m, true));
        });
      }
    }

    if (ignoredCount > 0) {
      els.ignoredBar.hidden = false;
      els.ignoredBar.textContent = ignoredCount + " ignoriert · " +
        (state.showIgnored ? "ausblenden" : "einblenden");
    } else {
      els.ignoredBar.hidden = true;
      state.showIgnored = false;
    }

    paintHighlights();
  }

  function renderItem(m, ignored) {
    var li = document.createElement("li");
    li.className = "result result--" + issueBucket(m.issueType) + (ignored ? " result--ignored" : "");
    li.dataset.key = matchKey(m);

    var head = document.createElement("div");
    head.className = "result-head";

    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = m.categoryName;
    head.appendChild(badge);

    var actions = document.createElement("span");
    actions.className = "result-actions";

    var jump = document.createElement("button");
    jump.className = "jump";
    jump.type = "button";
    jump.textContent = "Seite " + m.page;
    jump.addEventListener("click", function () { scrollToPage(m.page); pulse(matchKey(m)); });
    actions.appendChild(jump);

    var ignoreBtn = document.createElement("button");
    ignoreBtn.className = "ignore";
    ignoreBtn.type = "button";
    ignoreBtn.textContent = ignored ? "Wieder aufnehmen" : "Ignorieren";
    ignoreBtn.addEventListener("click", function () {
      if (ignored) state.ignored.delete(matchKey(m));
      else state.ignored.add(matchKey(m));
      renderMatches();
    });
    actions.appendChild(ignoreBtn);

    head.appendChild(actions);
    li.appendChild(head);

    var msg = document.createElement("p");
    msg.className = "result-msg";
    msg.textContent = m.message;
    li.appendChild(msg);

    if (m.contextText) {
      var ctx = document.createElement("p");
      ctx.className = "result-ctx";
      var a = m.contextOffset, b = m.contextOffset + m.contextLength;
      ctx.innerHTML = escapeHtml(m.contextText.slice(0, a)) +
        "<mark>" + escapeHtml(m.contextText.slice(a, b)) + "</mark>" +
        escapeHtml(m.contextText.slice(b));
      li.appendChild(ctx);
    }

    if (!ignored && m.replacements.length) {
      var repl = document.createElement("div");
      repl.className = "result-repl";
      m.replacements.forEach(function (val) {
        var chip = document.createElement("button");
        chip.className = "chip";
        chip.type = "button";
        chip.textContent = val;
        chip.title = "Vorschlag in die Zwischenablage kopieren";
        chip.addEventListener("click", function () {
          if (navigator.clipboard) navigator.clipboard.writeText(val).catch(function () {});
          chip.classList.add("chip--copied");
          setTimeout(function () { chip.classList.remove("chip--copied"); }, 900);
        });
        repl.appendChild(chip);
      });
      li.appendChild(repl);
    }

    return li;
  }

  // ---- Zurücksetzen ---------------------------------------------------

  function resetAll() {
    state.matches = [];
    state.ignored = new Set();
    state.showIgnored = false;
    els.results.innerHTML = "";
    els.resultsEmpty.hidden = false;
    els.resultsEmpty.textContent = "Noch nichts geprüft.";
    els.resultCount.textContent = "—";
    els.ignoredBar.hidden = true;
    els.pillErrors.textContent = "0 Fundstellen";
    els.filterSelect.disabled = true;
    els.filterSelect.value = "all";
  }

  // ---- Ereignisse ------------------------------------------------------

  els.openBtn.addEventListener("click", function () { els.fileInput.click(); });

  els.fileInput.addEventListener("change", function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (!file) return;
    els.checkBtn.disabled = true;
    var reader = new FileReader();
    reader.onload = function () { loadPdf(new Uint8Array(reader.result)); };
    reader.onerror = function () { setStatus("Datei konnte nicht gelesen werden.", "error"); };
    reader.readAsArrayBuffer(file);
  });

  els.checkBtn.addEventListener("click", checkDocument);
  els.filterSelect.addEventListener("change", renderMatches);
  els.ignoredBar.addEventListener("click", function () {
    state.showIgnored = !state.showIgnored;
    renderMatches();
  });
})();
