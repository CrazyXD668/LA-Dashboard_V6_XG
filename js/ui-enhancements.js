/*
 * LA DASH UI/UX enhancement layer.
 * Adds semantic labels, keyboard affordances, and a consistent icon treatment
 * after the existing renderers have built their controls. No data or actions
 * are changed.
 */
(() => {
  "use strict";

  const ICONS = {
    info: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10.5v5.2M12 7.6h.01" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    expand: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 4H4v4.5M4.2 4.2l5 5M15.5 20H20v-4.5M19.8 19.8l-5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  };

  const LIVE_IDS = [
    "metaInfo",
    "aLoading",
    "aNoData",
    "cLoading",
    "cNoData",
    "dLoading",
    "dNoData",
    "behaviorLoadingOverlay",
    "behaviorNoData",
    "rLoading",
    "rNoData",
    "warningSummaryBanner",
  ];

  const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function ensureId(element, prefix, index) {
    if (!element) return "";
    if (!element.id) element.id = prefix + index;
    return element.id;
  }

  function labelText(element) {
    return cleanText(element?.textContent || "");
  }

  function chartHeading(button) {
    const card = button?.closest(".chart-card");
    const heading = card?.querySelector(".chart-title");
    if (!heading) return "";
    const copy = heading.cloneNode(true);
    copy.querySelectorAll(".chart-title-actions, button").forEach((node) => node.remove());
    return labelText(copy);
  }

  function refreshThemeButton() {
    const button = document.getElementById("themeToggle");
    if (!button) return;
    const next = document.body.classList.contains("light") ? "深色" : "淺色";
    button.setAttribute("aria-label", "切換至" + next + "模式");
    button.title = "切換至" + next + "模式";
  }

  function labelFilterControls() {
    let labelIndex = 0;
    document.querySelectorAll(".filter-pair, .filter-pair-search, .filter-pair-inline").forEach((pair) => {
      const label = pair.querySelector(".filter-label");
      if (!label) return;
      const controls = pair.querySelectorAll("select, input:not([type='hidden']), textarea");
      if (!controls.length) return;
      const labelId = ensureId(label, "uiux-filter-label-", ++labelIndex);
      controls.forEach((control) => {
        if (!control.getAttribute("aria-labelledby") && !control.getAttribute("aria-label")) {
          control.setAttribute("aria-labelledby", labelId);
        }
      });
      pair.querySelectorAll(".mode-toggle, .view-toggle").forEach((group) => {
        if (!group.getAttribute("role")) group.setAttribute("role", "group");
        if (!group.getAttribute("aria-label")) group.setAttribute("aria-label", labelText(label));
      });
    });

    const printLabels = [
      ["printYearStart", "輸出年份起始"],
      ["printYearEnd", "輸出年份結束"],
    ];
    printLabels.forEach(([id, label]) => {
      const control = document.getElementById(id);
      if (control && !control.getAttribute("aria-label")) control.setAttribute("aria-label", label);
    });
  }

  function labelCharts() {
    document.querySelectorAll("canvas").forEach((canvas) => {
      const title = chartHeading(canvas) || canvas.getAttribute("aria-label");
      if (!title) return;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "圖表：" + title);
    });
  }

  function replaceIcon(button, type) {
    if (!button || button.dataset.uiuxIcon === type) return;
    button.innerHTML = ICONS[type];
    button.dataset.uiuxIcon = type;
  }

  function labelButtons() {
    document.querySelectorAll(".chart-info-btn").forEach((button) => {
      const storedTitle = cleanText(button.dataset.uiuxTitle);
      const currentTitle = cleanText(button.getAttribute("title")).replace(/說明+$/g, "");
      const title = storedTitle || chartHeading(button) || currentTitle || "圖表";
      button.dataset.uiuxTitle = title;
      const description = title.endsWith("說明") ? title : title + "說明";
      button.setAttribute("aria-label", description);
      button.title = description;
      replaceIcon(button, "info");
    });

    document.querySelectorAll(".chart-expand-btn").forEach((button) => {
      const title = cleanText(button.dataset.uiuxTitle) || chartHeading(button) || "圖表";
      button.dataset.uiuxTitle = title;
      const expanded = button.classList.contains("active");
      const action = expanded ? "縮小" : "放大";
      button.setAttribute("aria-label", action + "「" + title + "」");
      button.title = action + "圖表";
      replaceIcon(button, expanded ? "close" : "expand");
    });

    document.querySelectorAll("button").forEach((button) => {
      const excluded = button.matches(".tab, #themeToggle, .chart-info-btn, .chart-expand-btn");
      const isToggle = button.matches(
        ".mode-btn, .seg-btn, #panelD .view-btn, .behavior-sub-btn, " +
        ".retaker-switch, .r-sem-btn, .lsa-group-btn"
      ) || button.hasAttribute("aria-pressed");
      if (!excluded && isToggle) {
        const pressed = button.classList.contains("active") ||
          button.classList.contains("is-active");
        button.setAttribute("role", "button");
        button.setAttribute("aria-pressed", pressed ? "true" : "false");
      }
      if (!button.hasAttribute("aria-label") && !labelText(button)) {
        const fallback = button.id ? "操作 " + button.id : "未命名操作";
        button.setAttribute("aria-label", fallback);
      }
    });

    document.querySelectorAll("#rSemesterBtns [data-sem]").forEach((button) => {
      button.setAttribute("role", "button");
      button.setAttribute("aria-pressed", button.style.fontWeight === "600" ? "true" : "false");
    });
  }

  function makeRiskCardsKeyboardAccessible() {
    document.querySelectorAll("#rCohortSummary [data-action]").forEach((card) => {
      if (card.matches("button, a, input, select")) return;
      card.setAttribute("role", "button");
      if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "0");
      if (!card.getAttribute("aria-label")) {
        card.setAttribute("aria-label", "依" + labelText(card) + "聚焦雷達圖");
      }
      if (card.dataset.uiuxKeyboard === "1") return;
      card.dataset.uiuxKeyboard = "1";
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        card.click();
      });
    });
  }

  function markLiveRegions() {
    LIVE_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (!element.hasAttribute("aria-live")) element.setAttribute("aria-live", "polite");
      if (!element.hasAttribute("aria-atomic")) element.setAttribute("aria-atomic", "true");
    });
  }

  function enhance() {
    refreshThemeButton();
    labelFilterControls();
    labelCharts();
    labelButtons();
    makeRiskCardsKeyboardAccessible();
    markLiveRegions();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  function start() {
    enhance();
    document.addEventListener("click", schedule, true);
    document.addEventListener("change", schedule, true);
    window.addEventListener("resize", schedule, { passive: true });
    if (document.body) {
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.LAUiEnhancements = { refresh: enhance };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
