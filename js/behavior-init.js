// ══════════════════════════════════════════════════════════
// behavior-init.js
// resetBehaviorFilters + BehaviorTabManager 懶載入協調器
// 依賴：tab-behavior-radar.js / tab-behavior-time.js /
//       tab-behavior-correlation.js（均以 defer 先行載入）
// ══════════════════════════════════════════════════════════

// ── §0 全域 CSP 合規工具樣式注入 ─────────────────────────
// 將 csp-utility-classes.css 內容整合於此，以 adoptedStyleSheets
// 注入（無須 unsafe-inline）；不支援時退回 nonce <style> fallback。
// 呼叫時機：DOMContentLoaded 前（此檔案無 defer），確保其他模組
// 初始化前樣式已就緒。
(function _injectUtilityStyles() {
  const _UTIL_STYLE_ID = '__ladash-utility-styles';
  if (document.getElementById(_UTIL_STYLE_ID)) return;

  const CSS = `
/* ── Text color utilities ──────────────────────────────── */
.text-accent        { color: var(--accent, #3498db); }
.text-muted         { color: var(--text-dim, #888); }
.ladash-accent3     { color: var(--accent3, #f7a44f); }
.ladash-accent4     { color: var(--accent4, #e74c3c); }
.ladash-yellow      { color: var(--yellow, #f1c40f); }
.ladash-color-success { color: #64d4a8; }
.ladash-color-warn  { color: #f0c85b; }

/* ── Layout utilities ───────────────────────────────────── */
.ladash-text-right  { text-align: right; }
.ladash-mb6         { margin-bottom: 6px; }
.ladash-mt14        { margin-top: 14px; }
.ladash-fw6         { font-weight: 600; }
.ladash-mono        { font-family: 'JetBrains Mono', 'Courier New', monospace; }
.ladash-c-flex1     { flex: 1; }
.ladash-dim-xs      { font-size: 10px; color: var(--text-dim, #888); }
.ladash-h180        { height: 180px; }

/* ── UI-HSCROLL-1 (0730)：隱藏式橫向捲動列 ──────────────── */
/* 用於膠囊按鈕群組（學習行為子分頁／高風險報告學期篩選）：單列排列、
   捲軸隱藏但保留左右拖曳捲動（觸控/滑鼠皆可）。 */
.ladash-hscroll-row {
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;      /* Firefox */
  -ms-overflow-style: none;   /* 舊版 Edge/IE */
}
.ladash-hscroll-row::-webkit-scrollbar { display: none; }  /* Chrome/Safari/PWA WebView */

/* ── Chart card title flex ──────────────────────────────── */
.ladash-c-card-title-flex {
  margin: 0;
  font-size: .92rem;
  font-weight: 700;
  color: var(--text, #172033);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* ── Color dot (enrollment table) ──────────────────────── */
.ladash-color-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  /* background set via JS setProperty */
}

/* ── Table cells ────────────────────────────────────────── */
.ladash-td-std {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}
.ladash-td-r    { text-align: right; }
.ladash-td-c    { text-align: center; }
.ladash-td-note { color: var(--text-dim, #888); font-style: italic; }
.ladash-tr-dim  { opacity: 0.55; }
/* Alternating row background set via JS setProperty on [data-row-bg] */

/* ── Student profile ─────────────────────────────────────── */
.ladash-student-profile-hdr {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.ladash-student-name {
  font-family: 'Space Mono', monospace;
  font-size: 20px;
  color: var(--text);
}

/* ── Popover ─────────────────────────────────────────────── */
.ladash-popover-desc {
  color: var(--text-mid);
  font-size: 11px;
  margin-bottom: 6px;
}
.ladash-popover-use {
  margin-top: 8px;
  font-size: 10px;
  color: var(--accent3);
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

/* ── Empty states ────────────────────────────────────────── */
.ladash-empty-error  { padding: 12px; color: var(--red); }
.ladash-empty-dim    { padding: 16px; color: var(--text-dim); }
.ladash-empty-center { padding: 24px; text-align: center; }

/* ── Semester capsule button ─────────────────────────────── */
.ladash-sem-cap-btn {
  padding: 3px 10px;
  border-radius: 14px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text-dim);
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  cursor: pointer;
  transition: all 0.15s;
}

/* ── Print panel messages ────────────────────────────────── */
.ladash-print-warn-msg    { padding: 20px; color: #b45309; }
.ladash-print-loading-msg { padding: 20px; color: #555; }

/* ── Banner close button ─────────────────────────────────── */
.ladash-banner-close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.7);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}

/* ── Correlation tab ─────────────────────────────────────── */
.ladash-c-corr-inner-card {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border, #d5dbea);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.ladash-c-corr-card3 {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border, #d5dbea);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin-top: 16px;
}
.ladash-c-corr-warn-banner {
  margin: 6px 0 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(255,193,7,0.12);
  border: 1px solid rgba(255,193,7,0.45);
  color: var(--text-mid, #9aa0b8);
  font-size: .78rem;
  line-height: 1.5;
}
.ladash-c-corr-global-note {
  margin: 4px 0 8px;
  padding: 6px 10px;
  border-radius: 5px;
  background: rgba(100,160,255,0.08);
  border: 1px solid rgba(100,160,255,0.25);
  color: var(--text-dim, #888);
  font-size: .75rem;
}
.ladash-c-corr-insights-badge {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
  padding: 9px 13px;
  border: 1px solid rgba(52,152,219,.25);
  border-radius: 9px;
  background: rgba(52,152,219,.06);
  font-size: .8rem;
  line-height: 1.6;
  color: var(--text-mid, #9aa0b8);
}
.ladash-c-corr-lag-note {
  font-size: .76rem;
  color: var(--text-dim, #888);
  margin-bottom: 8px;
  padding: 7px 10px;
  background: rgba(100,160,255,0.07);
  border: 1px solid rgba(100,160,255,0.2);
  border-radius: 6px;
  line-height: 1.6;
}
.ladash-c-corr-lag-panel {
  background: rgba(52,152,219,0.06);
  border: 1px solid rgba(52,152,219,0.22);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
}
.ladash-c-corr-lag-etl-badge {
  font-size: .72rem;
  background: rgba(52,152,219,0.12);
  border: 1px solid rgba(52,152,219,0.3);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--accent, #3498db);
}
/* Corr toggle-all regression button — static layout only;
   dynamic background/color set via JS setProperty */
.ladash-corr-regbtn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid rgba(247,164,79,0.6);
  transition: background 0.15s, color 0.15s;
}
/* btnP/S static layout — dynamic bg/color/weight set via setProperty */
#btnCorrPearson, #btnCorrSpearman {
  font-size: .76rem;
  padding: 3px 9px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--accent, #3498db);
}
#btnCorrPearson  { border-radius: 6px 0 0 6px; }
#btnCorrSpearman { border-radius: 0 6px 6px 0; }

/* ── Time tab ────────────────────────────────────────────── */
.ladash-c-time-cluster-hint {
  font-size: .76rem;
  color: rgba(241,196,15,.85);
  margin-bottom: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(241,196,15,.08);
  border: 1px solid rgba(241,196,15,.2);
}
.ladash-t-filterbadge {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  margin-bottom: 8px;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--card-bg2, #1c2030);
  border: 1px solid rgba(110,130,165,.2);
  font-size: .75rem;
  color: var(--text-mid, #4f5f78);
  line-height: 1.6;
  gap: 6px;
  white-space: nowrap;
}
/* AI insight box — dynamic background/border-color via JS setProperty */
.ladash-t-insight-box {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: .82rem;
  line-height: 1.7;
  color: var(--text, #dde3f5);
}

/* ── Midterm note (at-risk tab) ──────────────────────────── */
.ladash-midterm-note-style {
  font-size: 11px;
  color: var(--text-dim, #888);
  text-align: right;
  margin-top: 4px;
}

/* ── LSA tab ─────────────────────────────────────────────── */
.ladash-lsa-sel-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .78rem;
  color: var(--text-dim, #888);
  flex-shrink: 0;
  /* opacity / pointer-events set via JS setProperty when locked */
}
.ladash-lsa-select {
  font-size: .78rem;
  padding: 2px 4px;
  border-radius: 7px;
  border: 1px solid var(--border, #2a2f45);
  background: var(--surface2, #1c2030);
  color: var(--text-mid, #9aa0b8);
  /* max-width / cursor set via JS setProperty */
}
.ladash-lsa-filter-wrap {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  padding: 8px 12px;
  border: 1px solid rgba(110,130,165,.22);
  border-radius: 10px;
  background: var(--card-bg2, #1c2030);
  white-space: nowrap;
}
.ladash-lsa-infobar {
  font-size: .78rem;
  color: var(--text-dim, #888);
  margin-bottom: 10px;
  padding: 4px 14px;
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.ladash-lsa-interpret-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--surface2, #1c2030);
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  border: 1px solid rgba(110,130,165,.18);
}
.ladash-lsa-chevron {
  font-size: .75rem;
  color: var(--text-dim, #888);
  transition: transform .2s;
  display: inline-block;
  /* transform set via JS setProperty */
}
.ladash-lsa-interpret-body {
  overflow: hidden;
  transition: max-height .25s ease;
  /* max-height / margin-top set via JS setProperty */
}
.ladash-lsa-empty-box {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
  background: rgba(52,152,219,.04);
  border: 1px solid rgba(52,152,219,.15);
  border-radius: 8px;
  font-size: .83rem;
  color: var(--text-dim, #888);
  text-align: center;
}

/* ── BehaviorTabManager 自有樣式（原註解已移至此處集中管理）── */
/* .btm-err-banner */
.btm-err-banner {
  color: #c0392b;
  font-size: .85rem;
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(192,57,43,.08);
  border-radius: 6px;
  border: 1px solid rgba(192,57,43,.2);
}
/* .behavior-sub-btn */
.behavior-sub-btn {
  background: transparent;
  color: var(--accent, #3498db);
  flex-shrink: 0;      /* UI-HSCROLL-1 FIX(0730)：橫向捲動列中禁止被壓縮 */
  white-space: nowrap;
}
.behavior-sub-btn.is-active {
  background: var(--accent, #3498db);
  color: #fff;
}
/* .behavior-sub-pane */
.behavior-sub-pane.is-hidden { display: none; }
/* #behaviorLoadingOverlay */
#behaviorLoadingOverlay.is-hidden { display: none; }
`;

  // 優先使用 adoptedStyleSheets（CSP 合規，無需 unsafe-inline）
  const sentinel = document.createElement('meta');
  sentinel.id = _UTIL_STYLE_ID;
  if (typeof CSSStyleSheet !== 'undefined' && CSSStyleSheet.prototype.replaceSync) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
      sentinel.setAttribute('data-csp-adopted', '1');
      document.head.appendChild(sentinel);
      return;
    } catch (_) { /* fallback */ }
  }
  // Fallback：nonce <style>（nonce 由 HTML CSP meta / server header 提供）
  const el = document.createElement('style');
  el.id = _UTIL_STYLE_ID;
  const nonce = document.querySelector('meta[name=csp-nonce]')?.content || '';
  if (nonce) el.setAttribute('nonce', nonce);
  el.textContent = CSS;
  document.head.appendChild(el);
}());

// ── 清除條件：各分頁獨立 try/catch 確保互不影響 ──────────
function resetBehaviorFilters() {
  try {
    if (typeof BehaviorRadarTab !== 'undefined' &&
        typeof BehaviorRadarTab.resetFilters === 'function')
      BehaviorRadarTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] radar:', e); }

  try {
    if (typeof BehaviorTimeTab !== 'undefined' &&
        typeof BehaviorTimeTab.resetFilters === 'function')
      BehaviorTimeTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] time:', e); }

  try {
    if (typeof BehaviorCorrelationTab !== 'undefined' &&
        typeof BehaviorCorrelationTab.resetFilters === 'function')
      BehaviorCorrelationTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] correlation:', e); }

  try {
    if (typeof BehaviorLsaTab !== 'undefined' &&
        typeof BehaviorLsaTab.resetFilters === 'function')
      BehaviorLsaTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] lsa:', e); }

  try {
    if (typeof BehaviorCrossTab !== 'undefined' &&
        typeof BehaviorCrossTab.resetFilters === 'function')
      BehaviorCrossTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] cross:', e); }

  try {
    if (typeof BehaviorWarningTab !== 'undefined' &&
        typeof BehaviorWarningTab.resetFilters === 'function')
      BehaviorWarningTab.resetFilters();
  } catch(e) { console.error('[resetBehaviorFilters] warning:', e); }
}

// ── BehaviorTabManager：懶載入協調器 ────────────────────
const BehaviorTabManager = (() => {
  const _init    = { radar: false, correlation: false, time: false, lsa: false, cross: false, warning: false };
  // BUG-R5-BI-1 FIX: _loading flag prevents concurrent lazyInit invocations
  // (two rapid clicks both passed `if (_init.radar)` before first resolved)
  let   _loading = false;
  // BUG-1 FIX (V9): _switching Set prevents TOCTOU double-init in switchSub()
  // Root cause: !_init[sub] check + await gap = second rapid click passes guard
  // before first call sets _init[sub] = true. Per-sub in-progress tracking closes gap.
  const _switching = new Set();

  // ── Helper: extract a plain-text error message ──────
  // CSP/XSS-AUDIT FIX (root cause): this value is only ever assigned via
  // `.textContent` (never `.innerHTML`) at every call site in this file,
  // so HTML-escaping here was actively harmful — textContent already
  // neutralizes markup, and pre-escaping caused literal "&lt;" / "&amp;"
  // sequences to render in the banner whenever an error message happened
  // to contain those characters (e.g. URLs with "&", stack text with "<").
  function _extractMsg(e) {
    return String(e?.message ?? e ?? '未知錯誤');
  }

  // ── Helper: show error banner inside a container element ──
  // above via _injectUtilityStyles — no longer needs a comment reminder).
  function _showSubError(containerId, label) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (el.querySelector('.btm-err-banner')) return;
    const div = document.createElement('div');
    div.className = 'btm-err-banner';
    div.textContent = `⚠️ ${label} 載入失敗，請重新整理頁面。`;
    el.prepend(div);
  }

  // with classList toggling. Classes defined in _injectUtilityStyles above.
  function _setSubBtn(sub) {
    document.querySelectorAll('#behaviorSubTabs .behavior-sub-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.sub === sub);
    });
  }

  // BUG-R5-BI-1 FIX: guard with _loading to prevent concurrent double-init
  async function lazyInit() {
    if (_init.radar || _loading) return;
    _loading = true;
    const overlay = document.getElementById('behaviorLoadingOverlay');
    if (overlay) overlay.classList.remove('is-hidden');
    try {
          if (typeof BehaviorRadarTab === 'undefined' || typeof BehaviorRadarTab.init !== 'function')
        throw new Error('BehaviorRadarTab 模組未載入，請確認 tab-behavior-radar.js 已正確引入。');
      await BehaviorRadarTab.init('radarChart', 'radarControls');
      BehaviorRadarTab.renderClusterSummary('clusterSummaryCards');
      _init.radar = true;
      if (typeof attachHelpButtons === 'function')        attachHelpButtons();
      if (typeof attachChartExpandButtons === 'function') attachChartExpandButtons();
      if (typeof autoFillSubjectFromBehavior === 'function')
        autoFillSubjectFromBehavior().catch(() => {});
    } catch (e) {
      console.error('[BehaviorTabManager] lazyInit:', e);
      const el = document.getElementById('tab-behavior');
      if (el) {
        if (!el.querySelector('.btm-err-banner')) {
          const div = document.createElement('div');
          div.className = 'btm-err-banner';
          div.textContent = `⚠️ 資料載入失敗：${_extractMsg(e)}`;
          el.prepend(div);
        }
      }
    } finally {
      _loading = false;
      if (overlay) overlay.classList.add('is-hidden');
    }
  }

  // OPT-BI-1(0802): 抽取自 switchSub 的通用子分頁初始化 helper
  // 消除原本 5 段結構完全相同的 if 塊（共 ~80 行重複碼）
  // initArgs: 傳給 TabModule.init() 的額外引數（correlation 需傳 containerId/scatterSectionId）
  async function _initSub(sub, key, TabModule, errorContainerId, label, ...initArgs) {
    if (sub !== key || _init[key] || _switching.has(key)) return false;
    _switching.add(key);
    if (typeof TabModule === 'undefined' || typeof TabModule.init !== 'function') {
      console.error(`[BehaviorTabManager] ${TabModule?.constructor?.name ?? key} 模組未載入`);
      _showSubError(errorContainerId, label);
      _switching.delete(key);
      return false;
    }
    try {
      await TabModule.init(...initArgs);
      _init[key] = true;
      return true;
    } catch (e) {
      console.error(`[BehaviorTabManager] ${key} init:`, e);
      _showSubError(errorContainerId, label);
      return false;
    } finally {
      _switching.delete(key);
    }
  }

  async function switchSub(sub) {
    _setSubBtn(sub);
    // BUG-BI-2 FIX: 子面板在 HTML 中以 style="display:none" 初始隱藏，
    // 但 is-hidden class 移除後 inline style 仍具最高優先權導致面板不顯示。
    // 解法：顯示目標面板時一併清除 inline display，
    // 隱藏面板則統一透過 is-hidden class 控制。
    document.querySelectorAll('.behavior-sub-pane').forEach(p => {
      const isTarget = p.id === `sub-${sub}`;
      p.classList.toggle('is-hidden', !isTarget);
      if (isTarget) {
        p.style.removeProperty('display');
      }
    });
    let didInit = false;

    // OPT-BI-1(0802): 5 個結構相同的 if 塊抽為 _initSub() 呼叫
    // BUG-BI-3 FIX(0802 第四輪)：_initSub 為 switchSub 的同層（非巢狀）函式，
    // 不共享 switchSub(sub) 參數的closure；原版在 _initSub 內直接引用 `sub`
    // 導致 ReferenceError（switchSub 每次呼叫必炸），已改為顯式傳入。
    didInit = await _initSub(sub, 'correlation', BehaviorCorrelationTab, 'corrHeatmap', '相關性分析', 'corrHeatmap', 'scatterSection') || didInit;
    didInit = await _initSub(sub, 'time',        BehaviorTimeTab,        'sub-time',    '時間分析')        || didInit;
    didInit = await _initSub(sub, 'lsa',         BehaviorLsaTab,         'sub-lsa',     'LSA 序列分析')    || didInit;
    didInit = await _initSub(sub, 'cross',       BehaviorCrossTab,       'sub-cross',   '行為預測分析')    || didInit;
    didInit = await _initSub(sub, 'warning',     BehaviorWarningTab,     'sub-warning', '提前預警')        || didInit;

    if (didInit) {
      if (typeof attachHelpButtons === 'function')        attachHelpButtons();
      if (typeof attachChartExpandButtons === 'function') attachChartExpandButtons();
    }
  }

  function reRenderActive() {
    const sub = document.querySelector('#behaviorSubTabs .behavior-sub-btn.is-active')?.dataset.sub || 'radar';
    const modules = {
      radar: BehaviorRadarTab,
      time: BehaviorTimeTab,
      correlation: BehaviorCorrelationTab,
      lsa: BehaviorLsaTab,
      cross: BehaviorCrossTab,
      warning: BehaviorWarningTab,
    };
    const module = modules[sub];
    if (module && typeof module.reRender === 'function') module.reRender();
  }

  return { lazyInit, switchSub, reRenderActive };
})();
