/**
 * Print panel controller for the V10 docs4 dashboard.
 *
 * This file intentionally owns the print panel UI because the dashboard has
 * changed faster than the older print block in main.js. It intercepts print
 * panel actions in the capture phase, rebuilds the item list, renders hidden
 * panels when needed, and captures Chart.js canvas/SVG/DOM content into a
 * printable report.
 */
const PrintPanel = (() => {
  "use strict";

  const PRINT_ITEMS = [
    { id: "chartCohortTrend", label: "跨學期成績趨勢", tab: "D 成績總覽", type: "canvas", checked: true },
    { id: "chartProgramBar", label: "各學制成績比較", tab: "D 成績總覽", type: "canvas", checked: true },
    { id: "chartPassRate", label: "各學制及格率比較", tab: "D 成績總覽", type: "canvas", checked: true },
    { id: "chartPassRateRange", label: "及格率趨勢", tab: "D 成績總覽", type: "canvas", checked: false },
    { id: "heatmapWrap", label: "學期與班級成績熱圖", tab: "D 成績總覽", type: "dom", checked: true },
    { id: "boxplotWrap", label: "學制成績箱型圖", tab: "D 成績總覽", type: "dom", checked: true },
    { id: "chartCorrelation", label: "修課人數與及格率關聯", tab: "D 成績總覽", type: "canvas", checked: false },
    { id: "dDetailTable", label: "班級明細表", tab: "D 成績總覽", type: "dom", checked: false },

    { id: "chartMidFinal", label: "期中期末與學期成績", tab: "A 單班分析", type: "canvas", checked: false },
    { id: "chartTrend", label: "單班歷年趨勢", tab: "A 單班分析", type: "canvas", checked: false },
    { id: "chartNormalOverlay", label: "班級成績分布（含常態疊圖）", tab: "A 單班分析", type: "canvas", checked: false },
    { id: "chartRegression", label: "期中期末迴歸", tab: "A 單班分析", type: "canvas", checked: false },
    { id: "chartVariance", label: "變異與離散分析", tab: "A 單班分析", type: "canvas", checked: false },

    { id: "cChartDist", label: "全體學生分布", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartAnomalyDensity", label: "異常密度分布", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartRetakerTrend", label: "重修生成績跨學期趨勢", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartRetakerPassRate", label: "重修生及格率趨勢", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartRetakerFirstDist", label: "重修生首修成績分布", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "slopeChart", label: "重修前後斜率圖", tab: "C 學生/重修", type: "svg", checked: false },
    { id: "chartDelta", label: "重修前後差異", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartQuadrant", label: "重修象限分析", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartDeltaByProgram", label: "重修成績變化量依學制", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartRetakeCount", label: "重修次數分布", tab: "C 學生/重修", type: "canvas", checked: false },
    { id: "chartFirstVsDelta", label: "首修成績與成績變化量", tab: "C 學生/重修", type: "canvas", checked: false },

    { id: "radarChart", label: "學習行為雷達圖", tab: "L 行為雷達", type: "canvas", checked: false },
    { id: "radarInsightsPanel", label: "雷達圖洞察", tab: "L 行為雷達", type: "dom", checked: false },
    { id: "corrHeatmap", label: "行為關聯熱圖", tab: "L 行為關聯", type: "dom", checked: false },
    { id: "scatterChart", label: "行為關聯散點圖", tab: "L 行為關聯", type: "canvas", checked: false },
    { id: "weeklyQuizChart", label: "每週測驗與學習分布", tab: "L 時間行為", type: "canvas", checked: false },
    { id: "preExamChart", label: "考前學習時間", tab: "L 時間行為", type: "canvas", checked: false },
    { id: "timeSlotChart", label: "學習時段分布", tab: "L 時間行為", type: "canvas", checked: false },
    { id: "studyHeatmapWrap", label: "學習時間熱圖", tab: "L 時間行為", type: "dom", checked: false },
    { id: "hourlyLineChart", label: "24 小時學習趨勢", tab: "L 時間行為", type: "canvas", checked: false },
    { id: "lsaClusterSummaryCards", label: "序列轉移資源分群卡片", tab: "L LSA", type: "dom", checked: false },
    { id: "lsaGraphWrap", label: "LSA 行為序列圖", tab: "L LSA", type: "dom", checked: false },
    { id: "lsaInsightsPanel", label: "序列轉移學習行為洞察", tab: "L LSA", type: "dom", checked: false },
    { id: "lsaInterpretCard", label: "LSA 解讀摘要", tab: "L LSA", type: "dom", checked: false },
    { id: "crossSummaryCard", label: "行為與成績交叉摘要", tab: "L 交叉分析", type: "dom", checked: false },
    { id: "crossAlertCard", label: "交叉分析警示", tab: "L 交叉分析", type: "dom", checked: false },
    { id: "crossGroupChart", label: "行為群組與成績", tab: "L 交叉分析", type: "canvas", checked: false },
    { id: "crossTrajectoryChart", label: "行為軌跡與成績", tab: "L 交叉分析", type: "canvas", checked: false },
    { id: "crossApproachChart", label: "學習策略與成績", tab: "L 交叉分析", type: "canvas", checked: false },

    { id: "rRadarChart", label: "高風險學生雷達圖", tab: "R 高風險", type: "canvas", checked: false },
    { id: "rTemporalChart", label: "高風險時間趨勢", tab: "R 高風險", type: "canvas", checked: false },
    { id: "rRedFlags", label: "高風險紅旗摘要", tab: "R 高風險", type: "dom", checked: false },
    { id: "rReadingShortfallList", label: "8小時閱讀門檻逐生清單", tab: "R 高風險", type: "dom", checked: false },
    { id: "rPrescriptions", label: "教學介入建議", tab: "R 高風險", type: "dom", checked: false },
  ];

  const PREVIEW_STYLE_ID = "print-panel-preview-style";
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    renderPanel();
    bindActions();
    installGlobalFallbacks();
  }

  function installGlobalFallbacks() {
    window.PrintPanel = api;
  }

  function renderPanel() {
    populateYearFilters();
    buildCheckboxes();
    updateSummary();
  }

  function buildCheckboxes() {
    const container = document.getElementById("printSelections");
    if (!container) return;

    container.innerHTML = PRINT_ITEMS.map((item) => `
      <label class="print-choice ${item.checked ? "selected" : ""}" data-print-id="${escapeAttr(item.id)}">
        <input type="checkbox" value="${escapeAttr(item.id)}" ${item.checked ? "checked" : ""}>
        <span class="print-tab">${escapeHtml(item.tab)}</span>
        <span class="print-label">${escapeHtml(item.label)}</span>
      </label>`).join("");

    container.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
      const label = input.closest(".print-choice");
      if (label) label.classList.toggle("selected", input.checked);
      updateSummary();
    });
  }

  function bindActions() {
    document.addEventListener("click", (event) => {
      const panel = document.getElementById("panelP");
      if (panel && !panel.contains(event.target)) return;

      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;

      if (action === "doPrintPreview") {
        event.preventDefault();
        event.stopImmediatePropagation();
        doPreview();
      } else if (action === "doPrint") {
        event.preventDefault();
        event.stopImmediatePropagation();
        doPrint();
      } else if (action === "printSelectAll") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setAllChecked(true);
      } else if (action === "printClearAll") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setAllChecked(false);
      } else if (action === "closePrintPreview") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const area = document.getElementById("printPreviewArea");
        if (area) area.style.setProperty("display", "none");
      }
    }, true);
  }

  function populateYearFilters() {
    const start = document.getElementById("printYearStart");
    const end = document.getElementById("printYearEnd");
    if (!start || !end) return;

    const years = getAvailableYears();
    if (!years.length) {
      start.innerHTML = '<option value="">無資料</option>';
      end.innerHTML = '<option value="">無資料</option>';
      return;
    }

    const prevStart = start.value;
    const prevEnd = end.value;
    const options = years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)} 學年</option>`).join("");
    start.innerHTML = options;
    end.innerHTML = options;

    const ascending = [...years].sort((a, b) => Number(a) - Number(b));
    start.value = years.includes(prevStart) ? prevStart : ascending[0];
    end.value = years.includes(prevEnd) ? prevEnd : ascending.at(-1);
    syncYearRange();

    start.onchange = () => syncYearRange();
    end.onchange = () => syncYearRange();
  }

  function getAvailableYears() {
    if (typeof window.printYears === "function") {
      try {
        const years = window.printYears().map(String).filter(Boolean);
        if (years.length) return [...new Set(years)].sort((a, b) => Number(a) - Number(b));
      } catch (_) {}
    }

    const yearSet = new Set();
    document.querySelectorAll("[data-sem], [data-semester], option[value]").forEach((node) => {
      const value = node.dataset?.sem || node.dataset?.semester || node.value || "";
      const match = String(value).match(/^(\d{3})(?:[12])?$/);
      if (match) yearSet.add(match[1]);
    });
    return [...yearSet].sort((a, b) => Number(a) - Number(b));
  }

  function syncYearRange() {
    const start = document.getElementById("printYearStart");
    const end = document.getElementById("printYearEnd");
    if (!start || !end || !start.value || !end.value) return;
    if (Number(start.value) > Number(end.value)) {
      if (document.activeElement === start) end.value = start.value;
      else start.value = end.value;
    }
  }

  function selectedIds() {
    return [...document.querySelectorAll('#printSelections input[type="checkbox"]:checked')]
      .map((input) => input.value);
  }

  function selectedItems() {
    const ids = new Set(selectedIds());
    return PRINT_ITEMS.filter((item) => ids.has(item.id));
  }

  function setAllChecked(checked) {
    document.querySelectorAll('#printSelections input[type="checkbox"]').forEach((input) => {
      input.checked = checked;
      input.closest(".print-choice")?.classList.toggle("selected", checked);
    });
    updateSummary();
  }

  function updateSummary() {
    const summary = document.getElementById("printSummary");
    if (!summary) return;
    const selected = selectedIds().length;
    summary.textContent = `已選 ${selected} / ${PRINT_ITEMS.length} 個列印項目`;
  }

  function getRangeLabel() {
    const start = document.getElementById("printYearStart")?.value || "";
    const end = document.getElementById("printYearEnd")?.value || "";
    if (!start || !end) return "全部學年";
    return start === end ? `${start} 學年` : `${start} 至 ${end} 學年`;
  }

  function getSubjectLabel() {
    return document.getElementById("subjectInput")?.textContent?.trim()
      || window.BEHAVIOR_SUMMARY?.course_name
      || "微生物免疫學成績與學習行為儀表板";
  }

  async function preparePrintableContent(task) {
    await lazyInitDynamicPanels();
    const runWithRange = typeof window.withPrintDataRange === "function"
      ? window.withPrintDataRange
      : (fn) => fn();
    const runVisible = typeof window.withPrintablePanelsVisible === "function"
      ? window.withPrintablePanelsVisible
      : withPanelsTemporarilyVisible;

    return runWithRange(() => runVisible(() => {
      if (typeof window.renderPrintCharts === "function") {
        try { window.renderPrintCharts(); } catch (error) { console.warn("[PrintPanel] renderPrintCharts failed", error); }
      }
      resizeKnownCharts();
      return task();
    }));
  }

  async function lazyInitDynamicPanels() {
    const jobs = [];
    if (typeof window.BehaviorTabManager?.lazyInit === "function") {
      jobs.push(window.BehaviorTabManager.lazyInit());
    }
    if (typeof window.AtRiskReportManager?.lazyInit === "function") {
      jobs.push(window.AtRiskReportManager.lazyInit());
    }
    await Promise.allSettled(jobs);
  }

  function withPanelsTemporarilyVisible(task) {
    const panels = [...document.querySelectorAll(".panel")].filter((panel) => panel.id !== "panelP");
    const panelStyles = panels.map((el) => ({
      el,
      display: el.style.display,
      visibility: el.style.visibility,
      position: el.style.position,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      pointerEvents: el.style.pointerEvents,
    }));
    // BUG-BI-2 CSP FIX: 子面板改用 is-hidden class 控制顯示/隱藏
    const panes = [...document.querySelectorAll(".behavior-sub-pane")];
    const paneStates = panes.map((el) => ({ el, wasHidden: el.classList.contains('is-hidden') }));

    panels.forEach((el) => {
      el.style.setProperty('display',        'block');
      el.style.setProperty('visibility',     'hidden');
      el.style.setProperty('position',       'absolute');
      el.style.setProperty('left',           '-10000px');
      el.style.setProperty('top',            '0');
      el.style.setProperty('width',          '1200px');
      el.style.setProperty('pointer-events', 'none');
    });
    panes.forEach((el) => { el.classList.remove('is-hidden'); el.style.removeProperty('display'); });

    try {
      return task();
    } finally {
      // Restore saved styles via setProperty (Object.assign(el.style) replaced)
      panelStyles.forEach(({ el, display, visibility, position, left, top, width, pointerEvents }) => {
        el.style.setProperty('display',        display        ?? '');
        el.style.setProperty('visibility',     visibility     ?? '');
        el.style.setProperty('position',       position       ?? '');
        el.style.setProperty('left',           left           ?? '');
        el.style.setProperty('top',            top            ?? '');
        el.style.setProperty('width',          width          ?? '');
        el.style.setProperty('pointer-events', pointerEvents  ?? '');
      });
      paneStates.forEach(({ el, wasHidden }) => { el.classList.toggle('is-hidden', wasHidden); });
    }
  }

  function resizeKnownCharts() {
    PRINT_ITEMS.filter((item) => item.type === "canvas").forEach((item) => {
      const canvas = document.getElementById(item.id);
      const chart = getChartInstance(canvas);
      if (!chart) return;
      try {
        chart.resize();
        chart.update("none");
      } catch (_) {}
    });
  }

  function captureItem(item) {
    const title = `
      <div class="print-page-header">
        <span class="print-page-tab">${escapeHtml(item.tab)}</span>
        <span class="print-page-title">${escapeHtml(item.label)}</span>
      </div>`;

    let body = "";
    if (item.type === "canvas") body = captureCanvas(item);
    else if (item.type === "svg") body = captureSvg(item);
    else body = captureDom(item);

    if (!body) {
      body = '<div class="print-empty">此項目目前沒有可列印內容，請先切換到相關分頁讓圖表完成載入。</div>';
    }

    return `<section class="print-page">${title}<div class="print-page-body">${body}</div></section>`;
  }

  function captureCanvas(item) {
    const canvas = document.getElementById(item.id);
    if (!(canvas instanceof HTMLCanvasElement)) return "";

    const chart = getChartInstance(canvas);
    try {
      if (chart) {
        chart.stop?.();
        chart.resize(1100, 520);
        chart.update("none");
      }
      const dataUrl = chart?.toBase64Image?.("image/png", 1) || canvas.toDataURL("image/png");
      if (!dataUrl || dataUrl === "data:,") return "";
      return `<figure class="print-figure"><img src="${dataUrl}" alt="${escapeAttr(item.label)}"></figure>`;
    } catch (error) {
      console.warn("[PrintPanel] canvas capture failed", item.id, error);
      return "";
    } finally {
      if (chart) {
        try {
          chart.resize();
          chart.update("none");
        } catch (_) {}
      }
    }
  }

  function getChartInstance(canvas) {
    if (!canvas || typeof Chart === "undefined") return null;
    try {
      return Chart.getChart(canvas) || Chart.getChart(canvas.id) || null;
    } catch (_) {
      return null;
    }
  }

  function captureSvg(item) {
    const el = document.getElementById(item.id);
    if (!el) return "";
    const svg = el.tagName?.toLowerCase() === "svg" ? el : el.querySelector("svg");
    if (!svg) return "";
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute("viewBox")) {
      const width = parseFloat(svg.getAttribute("width") || svg.getBoundingClientRect().width) || 900;
      const height = parseFloat(svg.getAttribute("height") || svg.getBoundingClientRect().height) || 420;
      clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.style.setProperty("width", "100%");
    clone.style.setProperty("height", "auto");
    return `<figure class="print-figure">${clone.outerHTML}</figure>`;
  }

  function captureDom(item) {
    const el = document.getElementById(item.id);
    if (!el) return "";

    const svgHtml = captureSvg(item);
    if (svgHtml) return svgHtml;

    const canvas = el.querySelector?.("canvas");
    if (canvas) {
      const nestedItem = { ...item, id: canvas.id || item.id, label: item.label };
      const captured = captureCanvas(nestedItem);
      if (captured) return captured;
    }

    const clone = el.cloneNode(true);
    sanitizeClone(clone);
    const content = clone.outerHTML || clone.innerHTML;
    return content?.trim() ? `<div class="print-dom">${content}</div>` : "";
  }

  function sanitizeClone(root) {
    root.querySelectorAll("script, button, .chart-popover, .chart-expand-btn, .chart-info-btn").forEach((node) => node.remove());
    // UNIFY-R PRINT-FIX (2026-07-28)：紅旗警示卡的詳細說明預設摺疊（display:none），
    // cloneNode 會原樣保留此行內樣式，若不處理，使用者未展開就直接列印會導致
    // 內容空白。列印本來就無法互動摺疊，故此處強制展開；折疊按鈕已被上一行的
    // button 選擇器移除，不會殘留在列印輸出中。
    // .r-shortfall-body（36號規格書第八節新增的逐生清單）沿用同一類收合
    // 元件手感，會踩到一模一樣的「未展開就列印→內容空白」問題，一併納入。
    root.querySelectorAll(".r-flag-body, .r-shortfall-body").forEach((node) => node.style.removeProperty("display"));
    root.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    root.querySelectorAll("[data-action], [data-tip], [onclick]").forEach((node) => {
      node.removeAttribute("data-action");
      node.removeAttribute("data-tip");
      node.removeAttribute("onclick");
    });
    root.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach((node) => {
      if (!node.textContent.trim() && !node.querySelector("canvas,svg,img,table")) node.remove();
    });
  }

  async function buildPrintHTML(items) {
    let pages = "";
    await preparePrintableContent(() => {
      pages = items.map(captureItem).join("");
    });

    if (!pages) {
      pages = '<section class="print-page"><div class="print-empty">尚未選取任何可列印項目。</div></section>';
    }

    const date = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" });
    return `
      <div class="print-doc">
        <header class="print-doc-header">
          <div>
            <h1>微免成績與學習行為儀表板</h1>
            <p>${escapeHtml(getSubjectLabel())}</p>
          </div>
          <dl>
            <div><dt>範圍</dt><dd>${escapeHtml(getRangeLabel())}</dd></div>
            <div><dt>日期</dt><dd>${escapeHtml(date)}</dd></div>
            <div><dt>項目</dt><dd>${items.length}</dd></div>
          </dl>
        </header>
        <main class="print-pages">${pages}</main>
      </div>`;
  }

  function injectPreviewStyles() {
    if (document.getElementById(PREVIEW_STYLE_ID)) return;
    const sentinel = document.createElement("meta");
    sentinel.id = PREVIEW_STYLE_ID;
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(previewCss());
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) { /* fallback */ }
    }
    const style = document.createElement("style");
    style.id = PREVIEW_STYLE_ID;
    const nonce = document.querySelector("meta[name=csp-nonce]")?.content || "";
    if (nonce) style.setAttribute("nonce", nonce);
    style.textContent = previewCss();
    document.head.appendChild(style);
  }

  async function doPreview() {
    const items = selectedItems();
    const area = document.getElementById("printPreviewArea");
    const content = document.getElementById("printPreviewContent");
    if (!area || !content) return;

    if (!items.length) {
      content.innerHTML = '<p class="ladash-print-warn-msg">請至少選擇一個列印項目。</p>';
      area.style.setProperty("display", "block");
      return;
    }

    injectPreviewStyles();
    content.innerHTML = '<p class="ladash-print-loading-msg">正在產生列印預覽...</p>';
    area.style.setProperty("display", "block");
    await nextFrame();
    content.innerHTML = await buildPrintHTML(items);
    area.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function doPrint() {
    const items = selectedItems();
    if (!items.length) {
      alert("請至少選擇一個列印項目。");
      return;
    }

    const html = await buildPrintHTML(items);
    const doc = `<!DOCTYPE html><html lang="zh-TW"><head>
      <meta charset="UTF-8">
      <title>微免儀表板列印報告</title>
      <style>${windowCss()}</style>
    </head><body>${html}</body></html>`;

    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "width=1200,height=850,noopener,noreferrer");
    if (!win) {
      const link = document.createElement("a");
      link.href = url;
      link.download = "dashboard-print-report.html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }

    win.addEventListener("load", () => {
      waitForImages(win.document).then(() => {
        win.focus();
        win.print();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    });
  }

  function waitForImages(doc) {
    const images = [...doc.images];
    if (!images.length) return Promise.resolve();
    return Promise.allSettled(images.map((image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }));
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function previewCss() {
    return `
      #printPreviewContent { min-width: 900px; }
      #printPreviewContent .print-doc { background:#fff; color:#111827; font-family:"Noto Sans TC","Microsoft JhengHei",Arial,sans-serif; }
      ${sharedCss("#printPreviewContent ")}
    `;
  }

  function windowCss() {
    return `
      * { box-sizing:border-box; }
      body { margin:0; padding:18px; background:#fff; color:#111827; font-family:"Noto Sans TC","Microsoft JhengHei",Arial,sans-serif; }
      ${sharedCss("")}
      @page { size:A4 landscape; margin:12mm; }
      @media print {
        body { padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .print-page { break-inside:avoid; page-break-inside:avoid; }
      }
    `;
  }

  function sharedCss(scope) {
    return `
      ${scope}.print-doc-header {
        display:flex; justify-content:space-between; gap:20px; align-items:flex-end;
        padding:0 0 14px; margin:0 0 18px; border-bottom:2px solid #2563eb;
      }
      ${scope}.print-doc-header h1 { margin:0 0 6px; font-size:20px; line-height:1.25; color:#111827; }
      ${scope}.print-doc-header p { margin:0; font-size:12px; color:#4b5563; }
      ${scope}.print-doc-header dl { display:flex; gap:12px; flex-wrap:wrap; justify-content:flex-end; margin:0; }
      ${scope}.print-doc-header dl div { min-width:84px; padding:6px 9px; border:1px solid #dbe3ef; border-radius:6px; background:#f8fafc; }
      ${scope}.print-doc-header dt { margin:0 0 2px; font-size:10px; color:#64748b; }
      ${scope}.print-doc-header dd { margin:0; font-size:12px; color:#0f172a; font-weight:600; }
      ${scope}.print-pages { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; align-items:start; }
      ${scope}.print-page { border:1px solid #dbe3ef; border-radius:8px; padding:12px; background:#fff; overflow:hidden; }
      ${scope}.print-page-header { display:flex; gap:8px; align-items:center; padding-bottom:8px; margin-bottom:10px; border-bottom:1px solid #e5e7eb; }
      ${scope}.print-page-tab { flex:0 0 auto; padding:2px 7px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:10px; font-weight:700; }
      ${scope}.print-page-title { min-width:0; font-size:13px; font-weight:700; color:#111827; }
      ${scope}.print-figure { margin:0; width:100%; overflow:visible; }
      ${scope}.print-figure img,
      ${scope}.print-figure svg { display:block; width:100%; height:auto; max-width:100%; }
      ${scope}.print-dom { width:100%; overflow:auto; font-size:11px; line-height:1.5; }
      ${scope}.print-dom table { width:100%; border-collapse:collapse; font-size:10px; }
      ${scope}.print-dom th,
      ${scope}.print-dom td { border:1px solid #dbe3ef; padding:5px 7px; color:#111827; }
      ${scope}.print-dom th { background:#f1f5f9; font-weight:700; }
      ${scope}.print-empty { padding:18px 0; color:#b45309; font-size:12px; }
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function observePanel() {
    const panel = document.getElementById("panelP");
    if (!panel) return;

    const visible = () => panel.classList.contains("active") || getComputedStyle(panel).display !== "none";
    if (visible()) {
      init();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!visible()) return;
      observer.disconnect();
      init();
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class", "style"] });
  }

  const api = { init, renderPanel, doPreview, doPrint };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observePanel);
  } else {
    observePanel();
  }

  return api;
})();
