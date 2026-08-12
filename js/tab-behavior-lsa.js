/**
 * tab-behavior-lsa.js  —  v16.16
 *
 * 累積修正（v16.3–v16.7）：
 *   副標題放大、?說明 Modal、視覺優化、放大 overlay 重渲染
 *   CSP inline onclick 移除、marker refX 修正、ResizeObserver guard
 *   自環 sweep=0 幾何修正（突出 91px）、badge 分散（t=0.22 貝茲點）
 *   dead variable 移除（zMQ）、_mkMarker 提升至 module 層
 *   isTop 改為 index 判斷、getElementById 快取
 * v16.15：filterBar（學期 + 分群）篩選導入、_resolveGroupData、
 *   CLUSTER_NAMES 提升至 module 層、init() filter 狀態重置
 * v16.16（code-review --fix）：
 *   BUG-6：compareHtml 改讀當前篩選脈絡 pass/fail，不再硬寫 _lsaData.groups
 *   BUG-7：resetFilters 移除冗餘 DOM sync（已由 _renderFilterBar 處理）
 *   Q2/Q3/Q5 fixes：hasLsaType/hasCluster 偵測修正、互斥鎖定、優先順序調整
 */

const BehaviorLsaTab = (() => {

  // CSP-LSA FIX: all static style= extracted to CSS classes via adoptedStyleSheets
  const _LSA_STYLE_ID = "__ladash-lsa-style";
  (function _injectLsaStyle() {
    if (document.getElementById(_LSA_STYLE_ID)) return;
    const CSS = `.ladash-lsa-bold-hdr{font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px}
    .ladash-lsa-sub{color:var(--text-mid,#9aa0b8);margin:0 0 14px}
    .ladash-lsa-val{color:var(--text,#dde3f5)}
    .ladash-lsa-card{background:var(--surface2,#1c2030);border:1px solid var(--border2,#2a2f45);border-radius:8px;padding:10px 14px;margin-bottom:12px}
    .ladash-lsa-sub0{color:var(--text-mid,#9aa0b8);margin:0}
    .ladash-lsa-accent-bold{color:var(--accent,#3498db);font-weight:600}
    .ladash-lsa-dim-bold{color:rgba(150,160,190,0.9);font-weight:600}
    .ladash-lsa-section-hdr{font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78)}
    .ladash-lsa-sep{color:var(--border,#2a2f45);margin:0 2px}
    .ladash-lsa-mr14{margin-right:14px}
    .ladash-lsa-vmid{vertical-align:middle}
    .ladash-lsa-ml14-dim{margin-left:14px;opacity:.7}
    .ladash-lsa-info-box{margin-top:10px;padding:10px 12px;background:var(--surface2,#1c2030);border-radius:8px}
    .ladash-lsa-info-hdr{font-weight:600;color:var(--text,#dde3f5);margin-bottom:4px}
    .ladash-lsa-accent{color:var(--accent,#3498db)}
    .ladash-lsa-warn{color:#e67e22}
    .ladash-lsa-label-bold{font-size:.82rem;font-weight:600;color:var(--text,#dde3f5)}
    .ladash-lsa-label-sub{font-weight:400;color:var(--text-dim,#888);margin-left:8px}
    .ladash-lsa-stat-box{padding:10px 12px;background:var(--surface2,#1c2030);border-radius:8px;margin-bottom:8px}
    .ladash-lsa-mb4{margin-bottom:4px}
    .ladash-lsa-dim-sm{font-size:.75rem;color:var(--text-dim,#888)}
    .ladash-lsa-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
    .ladash-lsa-blue-box{padding:10px 12px;background:rgba(52,152,219,0.08);border:1px solid rgba(52,152,219,0.2);border-radius:8px}
    .ladash-lsa-blue-hdr{font-weight:600;color:var(--accent,#3498db);margin-bottom:4px}
    .ladash-lsa-note{margin-top:4px;font-size:.75rem}
    .ladash-lsa-red-box{padding:10px 12px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);border-radius:8px}
    .ladash-lsa-warn-hdr{font-weight:600;color:#e67e22;margin-bottom:4px}
    .ladash-lsa-mono-box{background:var(--surface2,#1c2030);border:1px solid var(--border2,#2a2f45);border-radius:8px;padding:12px 14px;font-family:monospace;font-size:.82rem;color:var(--text,#dde3f5);margin-bottom:14px}
    .ladash-lsa-mono-lh{line-height:2}
    .ladash-lsa-interpret-body{max-height:0;overflow:hidden;transition:max-height .25s ease,margin-top .25s ease}
    .ladash-cc-wrap{display:flex;flex-direction:row;align-items:stretch;overflow-x:auto;padding:4px 2px 8px}
    .behavior-cluster-card{border-radius:8px;box-shadow:0 2px 8px rgba(20,35,60,.06)}
    .ladash-cc-total{border:1px solid rgba(46,204,113,.28);background:rgba(46,204,113,.08)}
    .ladash-cc-lbl{color:var(--text-dim,#888)}
    .ladash-cc-total-num{margin-top:4px;font-weight:800;color:var(--green,#239b56);line-height:1}
    .ladash-cc-pct{margin-top:6px;line-height:1.25;color:var(--text-mid,#9aa0b8)}
    .ladash-cc-item{cursor:pointer}
    .ladash-cc-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
    .ladash-cc-key{font-weight:700;font-family:'JetBrains Mono','Courier New',monospace}
    .ladash-cc-count{font-weight:700;line-height:1}
    .ladash-cc-name{margin-top:6px;line-height:1.25;color:var(--text-mid,#4f5f78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ladash-cc-pct2{margin-top:3px;line-height:1.2;color:var(--text-dim,#888)}
    .ladash-ins-panel{border:1px solid var(--border,#2a2f45);border-radius:10px;background:var(--surface,#13161f);margin-bottom:14px}
    .ladash-ins-title{font-size:.82rem;font-weight:700;color:var(--text,#dde3f5);margin-bottom:10px;display:flex;align-items:center;gap:8px}
    .ladash-ins-dot{display:inline-block;width:8px;height:8px;border-radius:50%}
    .ladash-ins-section{margin-bottom:10px}
    .ladash-ins-hdr{font-size:.78rem;font-weight:700;margin-bottom:6px;letter-spacing:.04em}
    .ladash-ins-hdr-str{color:var(--green,#64d4a8)}
    .ladash-ins-hdr-gap{color:var(--red,#f07070)}
    .ladash-ins-hdr-rec{color:var(--accent3,#f7a44f)}
    .ladash-ins-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap}
    .ladash-ins-dim{font-family:'JetBrains Mono','Courier New',monospace;font-size:.78rem;font-weight:700;min-width:36px}
    .ladash-ins-lbl{font-size:.78rem;color:var(--text-mid,#9aa0b8);flex:1;min-width:80px}
    .ladash-ins-vals{display:flex;gap:4px;align-items:center}
    .ladash-ins-bench{font-size:.76rem;color:var(--text-dim,#888)}
    .ladash-ins-val-str{font-size:.82rem;font-weight:700;color:var(--green,#64d4a8)}
    .ladash-ins-val-gap{font-size:.82rem;font-weight:700;color:var(--red,#f07070)}
    .ladash-ins-diff-str{font-size:.76rem;color:var(--green,#64d4a8);background:rgba(100,212,168,.12);border-radius:6px;padding:1px 5px}
    .ladash-ins-diff-gap{font-size:.76rem;color:var(--red,#f07070);background:rgba(240,112,112,.12);border-radius:6px;padding:1px 5px}
    .ladash-ins-summary{font-size:.80rem;color:var(--text-mid,#9aa0b8);line-height:1.6;background:var(--surface2,#1c2030);border-radius:0 8px 8px 0;padding:8px 12px;margin-bottom:10px}
    .ladash-ins-rec-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
    .ladash-ins-rec-icon{font-size:1rem;line-height:1.4}
    .ladash-ins-rec-txt{font-size:.80rem;color:var(--text-mid,#9aa0b8);line-height:1.5}
    .ladash-ins-fallback{font-size:.74rem;color:var(--accent3,#f7a44f);margin-bottom:8px;padding:4px 8px;background:rgba(247,164,79,.08);border-radius:6px}
    .ladash-ins-export-wrap{margin-top:4px}
    .ladash-ins-export-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:transparent;font-size:.78rem;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}
    .ladash-ins-export-cnt{font-size:.72rem;color:var(--text-dim,#888);margin-left:8px}`; // CSP-V6: initial closed state + CSS transition
    const sentinel = document.createElement("meta");
    sentinel.id = _LSA_STYLE_ID;
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) {}
    }
    const el = document.createElement("style");
    el.id = _LSA_STYLE_ID;
    const nonce = document.querySelector("meta[name=csp-nonce]")?.content || "";
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = CSS;
    document.head.appendChild(el);
  })();

  let _lsaData        = null;
  let _behaviorStudents = [];   // A-2：匯出用學生名單（含 masked_id/cluster），與資源使用雷達圖分頁共用同一份 behavior.json
  let _group          = "all";
  let _filterSemester = "all";
  let _filterCluster  = "all";   // by_cluster（R 資源分群切片，R→S 換牌）
  let _filterLsaType  = "all";   // by_lsa_type（真正 S 序列行為分群）
  let _ro             = null;

  const BEHAVIOR_LABELS = { M: "教材閱讀", Q: "題庫作答" };
  // CLUSTER_NAMES：by_cluster dropdown，key 對應 ETL by_cluster 的 R1–R5
  const CLUSTER_NAMES  = { R1:"影音輔導型", R2:"彈性聽覺型", R3:"平均使用型", R4:"題庫刷題型", R5:"被動低參與型" };
  // CLUSTER_COLORS：A-1 資訊卡片／A-2 洞察卡片配色，比照資源使用雷達圖分頁 tab-behavior-radar.js 同名常數
  const CLUSTER_COLORS = {
    R1:{border:"rgba(52,152,219,0.9)",bg:"rgba(52,152,219,0.15)"},
    R2:{border:"rgba(46,204,113,0.9)",bg:"rgba(46,204,113,0.15)"},
    R3:{border:"rgba(155,89,182,0.9)",bg:"rgba(155,89,182,0.15)"},
    R4:{border:"rgba(230,126,34,0.9)",bg:"rgba(230,126,34,0.15)"},
    R5:{border:"rgba(189,195,199,0.9)",bg:"rgba(189,195,199,0.15)"},
  };
  // LSA_TYPE_NAMES：by_lsa_type dropdown，key 對應 ETL by_lsa_type 的 S1–S5
  const LSA_TYPE_NAMES = { S1:"穩定高效", S2:"規律中效", S3:"波動中效", S4:"低頻低效", S5:"高風險" };
  // BUGFIX-A（0716 穿透式審查）：A-1/A-2 卡片與洞察面板的分析主體應為「行為序列分群」
  // （S1–S5，本頁「序列轉移」的分析對象），先前誤用「資源使用分型」（R1–R5，那是
  // 資源使用雷達圖分頁的分析對象）。LSA_TYPE_COLORS 配色獨立於 CLUSTER_COLORS（R系）。
  const LSA_TYPE_COLORS = {
    S1:{border:"rgba(46,204,113,0.9)", bg:"rgba(46,204,113,0.15)"},   // 穩定高效 → 綠
    S2:{border:"rgba(52,152,219,0.9)", bg:"rgba(52,152,219,0.15)"},   // 規律中效 → 藍
    S3:{border:"rgba(241,196,15,0.9)", bg:"rgba(241,196,15,0.15)"},   // 波動中效 → 黃
    S4:{border:"rgba(230,126,34,0.9)", bg:"rgba(230,126,34,0.15)"},   // 低頻低效 → 橙
    S5:{border:"rgba(231,76,60,0.9)",  bg:"rgba(231,76,60,0.15)"},    // 高風險   → 紅
  };
  // A-2：洞察比對用門檻與建議文案（比照 tab-behavior-radar.js 的 INSIGHT_THRESHOLD / RECOMMENDATION_MAP，
  // 改用「連續性比率」而非六維完成率——理由見 _lsaRatios() 註記）
  const LSA_MIN_PASS_COUNT    = 10;    // 及格群樣本數低於此值時標示為 fallback（見 _getLsaPassBenchmark）
  const LSA_INSIGHT_THRESHOLD = 0.03;  // 差距 ≥ 3 個百分點才列入洞察
  const LSA_DIM_LABELS = {
    mPersist: "教材閱讀連續性（M→M）",
    qPersist: "題庫作答連續性（Q→Q）",
  };
  const LSA_RECOMMENDATION_MAP = {
    mPersist: { action:"建議引導本群學生延長單次教材閱讀時間，避免頻繁中斷切換，強化深度理解。", icon:"📖" },
    qPersist: { action:"建議鼓勵本群學生以連續刷題方式累積練習量，強化輸出記憶與熟練度。", icon:"📋" },
  };
  const NODE_BASE_R  = 40;   // 32 × 1.25
  const NODE_SCALE   = 0.008;
  const EDGE_Z_SCALE = 0.55;
  const SIG_COLOR    = "var(--accent,#3498db)";
  const INSIG_COLOR  = "rgba(120,130,160,0.35)";
  const NODE_COLOR   = "rgba(52,152,219,0.30)";
  const NODE_STROKE  = "rgba(52,152,219,0.9)";

  // ── marker 建立輔助（提升至 module 層，避免每次渲染重複定義）──────
  function _mkMarker(defs, id, color, mSize) {
    defs.append("marker")
      .attr("id", id)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 10)
      .attr("refY", 0)
      .attr("markerWidth",  mSize)
      .attr("markerHeight", mSize)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", color);
  }

  // ── 初始化 ────────────────────────────────────────────────────
  async function init() {
    // 按鈕事件無論資料是否存在都需綁定，必須在資料檢查前執行
    _group          = "all";
    _filterSemester = "all";
    _filterCluster  = "all";
    _filterLsaType  = "all";
    _syncGroupBtnStyles();
    _bindGroupButtons();
    _bindHelpButton();
    _bindExpandButton();
    _bindReadToggle();

    try {
      if (typeof d3 === "undefined") {
        throw new Error("D3.js 載入失敗，請確認網路連線後重新整理。");
      }
      const [corrData, behaviorData] = await Promise.all([
        BehaviorLoader.load.correlation(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);
      const lsaRaw = corrData?.lsa_transition;
      _behaviorStudents = behaviorData?.students || [];

      if (!lsaRaw || !lsaRaw.groups) {
        _renderEmpty("ETL 尚未產出 LSA 資料，請重新執行 lms_etl.py 後重整頁面。");
        return;
      }

      _lsaData = lsaRaw;
      _renderFilterBar();
      _render();
      _renderLsaInsights();

      const wrap = document.getElementById("lsaGraphWrap");
      if (wrap && typeof ResizeObserver !== "undefined") {
        if (_ro) _ro.disconnect();
        _ro = new ResizeObserver(() => {
          const pane = document.getElementById("sub-lsa");
          if (!pane || pane.style.getPropertyValue("display") === "none") return;
          if (!wrap || wrap.clientWidth < 10) return;
          _render();
        });
        _ro.observe(wrap);
      }
    } catch (e) {
      console.error("[BehaviorLsaTab] init:", e);
      _renderEmpty(`初始化失敗：${_safeText(String(e?.message ?? e))}`);
      throw e; // BUG-LSA-2 FIX: re-throw so behavior-init.js switchSub can catch & log
    }
  }

  // ── cloneNode 清除舊 listener ─────────────────────────────────
  function _freshBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return null;
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    return clone;
  }

  // ── 解讀說明卡片收放 ──────────────────────────────────────────
  function _bindReadToggle() {
    const toggle  = document.getElementById("lsaReadToggle");
    const body    = document.getElementById("lsaReadBody");
    const chevron = document.getElementById("lsaReadChevron");
    if (!toggle || !body || !chevron) return;
    let _open = false;
    toggle.addEventListener("click", function () {
      _open = !_open;
      body.style.setProperty('max-height', _open ? '900px' : '0'); // CSP-V5-FIX
      chevron.style.setProperty('transform', _open ? 'rotate(180deg)' : 'rotate(0deg)'); // CSP-V5-FIX
    });
  }

  // ── Help 按鈕 ─────────────────────────────────────────────────
  function _bindHelpButton() {
    const btn = _freshBtn("lsaHelpBtn");
    if (!btn) return;
    btn.addEventListener("click", () => renderHelpModal(HELP_CONTENT.lsaHelp));
  }


  // ── 放大按鈕（FIX-4：重新渲染至大尺寸，不 clone 原 SVG）────────
  function _bindExpandButton() {
    const btn = _freshBtn("lsaExpandBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const existing = document.getElementById("lsaExpandOverlay");
      if (existing) { existing.remove(); return; }
      if (!_lsaData) return;

      const overlay = document.createElement("div");
      overlay.id = "lsaExpandOverlay";
        overlay.style.setProperty('position', "fixed");
      overlay.style.setProperty('inset', "0");
      overlay.style.setProperty('z-index', "9998");
      overlay.style.setProperty('background', "rgba(10,13,22,0.95)");
      overlay.style.setProperty('display', "flex");
      overlay.style.setProperty('flex-direction', "column");
      overlay.style.setProperty('align-items', "center");
      overlay.style.setProperty('justify-content', "center");
      overlay.style.setProperty('padding', "calc(52px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px))");
      overlay.style.setProperty('box-sizing', "border-box");

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✕ 關閉";
        closeBtn.style.setProperty('position', "absolute");
      closeBtn.style.setProperty('top', "calc(14px + env(safe-area-inset-top, 0px))");
      closeBtn.style.setProperty('right', "20px");
      closeBtn.style.setProperty('background', "var(--surface2,#1c2030)");
      closeBtn.style.setProperty('border', "1px solid var(--border2,#2a2f45)");
      closeBtn.style.setProperty('border-radius', "20px");
      closeBtn.style.setProperty('color', "var(--text,#dde3f5)");
      closeBtn.style.setProperty('padding', "6px 18px");
      closeBtn.style.setProperty('cursor', "pointer");
      closeBtn.style.setProperty('font-size', ".85rem");
      closeBtn.style.setProperty('z-index', "1");
      closeBtn.addEventListener("click", () => overlay.remove());

      const svgContainer = document.createElement("div");
      svgContainer.id = "lsaExpandSvgContainer";
      svgContainer.style.setProperty('background', "var(--surface,#13161f)");
      svgContainer.style.setProperty('border-radius', "10px");
      svgContainer.style.setProperty('overflow-x', "auto");
      svgContainer.style.setProperty('overflow-y', "visible");
      svgContainer.style.setProperty('webkit-overflow-scrolling', "touch");

      overlay.appendChild(closeBtn);
      overlay.appendChild(svgContainer);
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);

      setTimeout(() => {
        // Fill overlay width; SVG tight-fit will shrink height but keep full width
        const W = Math.max(600, window.innerWidth - 48);
        const H = 400;
        svgContainer.style.setProperty("width", "100%");
        svgContainer.style.setProperty("max-width", W + "px");
        _renderToContainer(svgContainer, W, H);
      }, 0);
    });
  }

  // ── filterBar（學期 + 分群篩選）─────────────────────────────
  // Avoids "找不到群組資料" error if user selects a filter with no ETL data.
  function _renderFilterBar() {
    const anchor = document.getElementById("lsaFilterBarAnchor");
    if (!anchor) return;

    const semesters  = Object.keys(_lsaData?.by_semester ?? {}).sort().reverse(); // 近→遠
    const hasSem     = semesters.length > 0;

    // 偵測 by_cluster：接受 R1–R5（新版）或 S1–S5（舊版 JSON 尚未重跑）
    const clusterKeys = Object.keys(_lsaData?.by_cluster ?? {});
    const hasCluster  = clusterKeys.length > 0;

    // 偵測 by_lsa_type：接受 S1–S5，排除空分群（n_sequences == 0）
    // Q-FILTER：只顯示有實際資料的序列分群，避免使用者選到空白畫面
    const lsaTypeKeys = Object.keys(_lsaData?.by_lsa_type ?? {}).filter(k =>
      /^S\d$/.test(k) &&
      (_lsaData.by_lsa_type[k]?.all?.n_sequences ?? 0) > 0
    );
    const hasLsaType  = lsaTypeKeys.length > 0;

    // 診斷用（可在 DevTools Console 確認實際 key）

    if (!hasSem && !hasCluster && !hasLsaType) { anchor.innerHTML = ""; return; }

    const semOptions = [
      `<option value="all">全部年度</option>`,
      ...semesters.map(s => {
        const yr  = s.slice(0, 3);
        const sem = s.slice(3) === "1" ? "(1)" : "(2)";
        return `<option value="${s}"${s === _filterSemester ? " selected" : ""}>${yr}${sem}</option>`;
      }),
    ].join("");

    // by_cluster：優先用 CLUSTER_NAMES（R 前綴），若 JSON key 仍是舊版 S 前綴則 fallback
    const clusterNameMap = clusterKeys.every(k => k.startsWith("S"))
      ? { S1:"影音輔導型", S2:"彈性聽覺型", S3:"平均使用型", S4:"題庫刷題型", S5:"被動低參與型" }
      : CLUSTER_NAMES;  // R1–R5
    const clusterOptions = [
      `<option value="all">全部分群</option>`,
      ...clusterKeys.sort().map(k =>
        `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${clusterNameMap[k] ?? k}</option>`),
    ].join("");

    const lsaTypeOptions = [
      `<option value="all">全部序列型</option>`,
      ...lsaTypeKeys.sort().map(k =>
        `<option value="${k}"${k === _filterLsaType ? " selected" : ""}>${k} ${LSA_TYPE_NAMES[k] ?? k}</option>`),
    ].join("");

    // FIX-Q5：互斥鎖定規則
    // 選資源分群 → 鎖學期（by_cluster 無學期交叉維度）
    // 選序列分群 → 鎖學期 + 資源分群（by_lsa_type 為獨立維度）
    const semLocked     = _filterCluster !== "all" || _filterLsaType !== "all";
    const clusterLocked = _filterLsaType !== "all";

    const _sel = (id, opts, label, maxW, locked) => `
      <label class="ladash-lsa-sel-label" data-locked="${locked ? '1' : '0'}">
        ${label}
        <select id="${id}" ${locked ? "disabled" : ""} class="ladash-lsa-select" data-maxw="${maxW}" data-cursor="${locked ? 'not-allowed' : 'pointer'}">${opts}</select>
      </label>`;

    anchor.innerHTML = `
      <div class="ladash-c-filter-bar ladash-lsa-filter-wrap">
        <span class="ladash-lsa-section-hdr">篩選條件</span>
        ${hasSem     ? _sel("lsaSemFilter",     semOptions,     "學期",     "90px",  semLocked)     : ""}
        ${hasCluster ? _sel("lsaClusterFilter", clusterOptions, "資源分群", "120px", clusterLocked) : ""}
        ${hasLsaType ? _sel("lsaTypeFilter",    lsaTypeOptions, "序列分群", "120px", false)         : ""}
      </div>
      <div id="lsaClusterSummaryCards"></div>
      <div id="lsaInfoBar" class="ladash-lsa-infobar"></div>`;

        anchor.querySelectorAll("[data-locked='1']").forEach(function(el) {
      el.style.setProperty("opacity", ".4");
      el.style.setProperty("pointer-events", "none");
    });
    anchor.querySelectorAll(".ladash-lsa-select[data-maxw]").forEach(function(el) {
      el.style.setProperty("max-width", el.dataset.maxw);
      el.style.setProperty("cursor", el.dataset.cursor || "pointer");
    });
    document.getElementById("lsaSemFilter")
      ?.addEventListener("change", _onFilterChange);
    document.getElementById("lsaClusterFilter")
      ?.addEventListener("change", _onFilterChange);
    document.getElementById("lsaTypeFilter")
      ?.addEventListener("change", _onFilterChange);

    // A-1：行為序列分群資訊卡片，僅在 by_lsa_type 有資料時渲染
    if (hasLsaType) _renderSeqTypeCards("lsaClusterSummaryCards");
  }

  // ── A-1：行為序列分群資訊卡片（比照資源使用雷達圖分頁 renderClusterSummary，
  //         改用本頁的分析主體 S1–S5／by_lsa_type）──
  function _renderSeqTypeCards(containerId) {
    const el = document.getElementById(containerId);
    if (!el || !_lsaData?.by_lsa_type) return;

    // 固定跑 S1–S5 五個 key（而非 Object.keys 動態取得），確保像 S5 這種目前
    // n_sequences=0（無資料）的分群仍顯示「0 人」卡片，而不是靜默消失、
    // 讓使用者誤以為卡片沒有載入成功。
    const typeKeys = Object.keys(LSA_TYPE_NAMES);

    // 分母採 by_lsa_type 各分群人數加總，理由同 R 版：groups.all 排除「尚無期末
    // 成績」驗證學期學生，但 by_lsa_type 分群不受此限，兩者分母口徑不同。
    const total = typeKeys.reduce(
      (sum, k) => sum + (_lsaData.by_lsa_type[k]?.all?.n_students || 0), 0
    );

    const isMobile = window.innerWidth < 600;
    const cardW  = isMobile ? "110px" : "150px";
    const cardW2 = isMobile ? "104px" : "144px";
    const pad    = isMobile ? "7px 9px" : "10px 12px";
    const numSz  = isMobile ? "1.15rem" : "1.45rem";
    const lblSz  = isMobile ? ".72rem"  : ".78rem";
    const nameSz = isMobile ? ".76rem"  : ".82rem";
    const pcSz   = isMobile ? ".70rem"  : ".76rem";
    const keySz  = isMobile ? ".84rem"  : ".92rem";

    const totalCard = `<div class="behavior-cluster-card ladash-cc-total"
      data-cw="${cardW}" data-pad="${pad}" data-lsz="${lblSz}" data-nsz="${numSz}">
      <div class="ladash-cc-lbl">分析人數</div>
      <div class="ladash-cc-total-num">${total.toLocaleString()}</div>
      <div class="ladash-cc-pct">100.0%</div>
    </div>`;

    const cards = typeKeys.map(key => {
      const row  = _lsaData.by_lsa_type[key]?.all;
      const n    = row?.n_students || 0;
      const pct  = total ? (n / total) * 100 : 0;
      const col  = LSA_TYPE_COLORS[key] || LSA_TYPE_COLORS.S1;
      const name = LSA_TYPE_NAMES[key] || key;
      const isSelected = _filterLsaType === key;
      const emptyNote = n === 0 ? `<div class="ladash-cc-pct2" style="opacity:.7">目前無資料</div>` : "";
      return `<div class="behavior-cluster-card ladash-cc-item${isSelected ? " ladash-cc-sel" : ""}"
        data-seqtype-card="${key}"
        data-cw="${cardW2}" data-pad="${pad}" data-ksz="${keySz}" data-nsz="${numSz}"
        data-nmsz="${nameSz}" data-pcsz="${pcSz}"
        data-col-border="${col.border}" data-col-bg="${col.bg}" data-is-sel="${isSelected ? 1 : 0}">
        <div class="ladash-cc-row">
          <span class="ladash-cc-key" data-clr="${col.border}">${key}</span>
          <span class="ladash-cc-count" data-clr="${col.border}">${n}</span>
        </div>
        <div class="ladash-cc-name" title="${name}">${name}</div>
        ${n > 0 ? `<div class="ladash-cc-pct2">佔 ${pct.toFixed(1)}%</div>` : emptyNote}
      </div>`;
    }).join("");

    el.innerHTML = `<div class="ladash-cc-wrap" data-gap="${isMobile ? '6px' : '10px'}">${totalCard}${cards}</div>`;

    const ccWrap = el.querySelector(".ladash-cc-wrap");
    if (ccWrap) ccWrap.style.setProperty("gap", ccWrap.dataset.gap || "8px");
    el.querySelectorAll(".ladash-cc-total[data-cw]").forEach(c => {
      c.style.setProperty("flex", `0 0 ${c.dataset.cw || "auto"}`);
      c.style.setProperty("min-width", c.dataset.cw || "auto");
      c.style.setProperty("padding", c.dataset.pad || "8px");
      const lbl = c.querySelector(".ladash-cc-lbl");
      const num = c.querySelector(".ladash-cc-total-num");
      const pct = c.querySelector(".ladash-cc-pct");
      if (lbl) lbl.style.setProperty("font-size", c.dataset.lsz || ".78rem");
      if (num) num.style.setProperty("font-size", c.dataset.nsz || "1rem");
      if (pct) pct.style.setProperty("font-size", c.dataset.lsz || ".78rem");
    });
    el.querySelectorAll(".ladash-cc-item[data-cw]").forEach(c => {
      c.style.setProperty("flex", `0 0 ${c.dataset.cw}`);
      c.style.setProperty("min-width", c.dataset.cw);
      c.style.setProperty("padding", c.dataset.pad);
      const isSel = c.dataset.isSel === "1";
      c.style.setProperty("border", isSel ? `2px solid ${c.dataset.colBorder || "var(--accent)"}` : "1px solid rgba(110,130,165,.22)");
      c.style.setProperty("background", isSel ? (c.dataset.colBg || "var(--surface2)") : "var(--surface,#13161f)");
      c.querySelectorAll("[data-clr]").forEach(sp => { if (sp.dataset.clr) sp.style.setProperty("color", sp.dataset.clr); });
      const key = c.querySelector(".ladash-cc-key");
      const cnt = c.querySelector(".ladash-cc-count");
      const nm  = c.querySelector(".ladash-cc-name");
      const pc  = c.querySelector(".ladash-cc-pct2");
      if (key) key.style.setProperty("font-size", c.dataset.ksz || ".78rem");
      if (cnt) cnt.style.setProperty("font-size", c.dataset.nsz || "1rem");
      if (nm)  nm.style.setProperty("font-size", c.dataset.nmsz || ".78rem");
      if (pc)  pc.style.setProperty("font-size", c.dataset.pcsz || ".76rem");
    });
    el.querySelectorAll("[data-seqtype-card]").forEach(card => {
      card.addEventListener("click", () => _selectSeqTypeCard(card.dataset.seqtypeCard));
    });
    // 總卡（分析人數）點擊＝清除序列分群篩選，回到全部序列型
    const totalCardEl = el.querySelector(".ladash-cc-total");
    if (totalCardEl) totalCardEl.addEventListener("click", () => _selectSeqTypeCard("all"));
  }

  // 點擊資訊卡片＝選定行為序列分群，套用與序列分群下拉選單相同的互斥規則（FIX-Q5：
  // 選序列分群→鎖學期＋資源分群，因為 by_lsa_type 是獨立於學期/資源分群的維度）
  function _selectSeqTypeCard(key) {
    _filterLsaType = key === "all" ? "all" : key;
    _filterSemester = "all";
    _filterCluster  = "all";
    _renderFilterBar();
    if (_lsaData) { _render(); _renderLsaInsights(); }
  }

  // ── A-2：LSA 行為序列比率換算 ─────────────────────────────────
  // 說明：資源使用雷達圖分頁比較的是六維「完成率」，可直接取百分比差值；
  // 但 LSA 的 z_score 會隨樣本數（序列對數）等比放大，不同分群人數差異極大
  // （如 R2 僅 4 人、R1 近千人），直接比較 z_score 大小沒有統計意義。
  // 因此改用「條件轉移機率」（樣本數無關的比率）作為比較基準：
  //   mPersist = P(下一動作仍為 M | 目前為 M) = M→M ÷ (M→M + M→Q)
  //   qPersist = P(下一動作仍為 Q | 目前為 Q) = Q→Q ÷ (Q→Q + Q→M)
  // 比率越高代表該分群在該行為上的「連續／專注」傾向越強。
  function _lsaRatios(groupRow) {
    const obs = groupRow?.observed || {};
    const mm = Number(obs["M→M"]) || 0, mq = Number(obs["M→Q"]) || 0;
    const qm = Number(obs["Q→M"]) || 0, qq = Number(obs["Q→Q"]) || 0;
    const mTotal = mm + mq, qTotal = qq + qm;
    const bt = groupRow?.behavior_totals || {};
    const mSum = Number(bt.M) || 0, qSum = Number(bt.Q) || 0;
    return {
      mPersist: mTotal > 0 ? mm / mTotal : null,
      qPersist: qTotal > 0 ? qq / qTotal : null,
      qShare:   (mSum + qSum) > 0 ? qSum / (mSum + qSum) : null,
      mShare:   (mSum + qSum) > 0 ? mSum / (mSum + qSum) : null,
      count:    groupRow?.n_students ?? null,
    };
  }

  // 及格群基準：insight 面板僅在選定資源分群時顯示，此時依 FIX-Q5 互斥規則
  // _filterSemester 必為 "all"，故直接採用全體及格群（_lsaData.groups.pass）即可，
  // 無需比照雷達圖再做學期範圍 fallback。
  function _getLsaPassBenchmark() {
    const g = _lsaData?.groups?.pass;
    if (!g) return null;
    const ratios = _lsaRatios(g);
    return { ...ratios, isFallback: (g.n_students ?? 0) < LSA_MIN_PASS_COUNT };
  }

  // ── A-2：學習行為洞察（序列轉移分群）── 比照資源使用雷達圖分頁 _renderInsights() ──
  function _renderLsaInsights() {
    const panel = document.getElementById("lsaInsightsPanel");
    if (!panel) return;

    // 未選定行為序列分群（全部序列型／依學期／依資源分群）時不顯示，
    // 比照雷達圖「R0 全體不顯示洞察」的邏輯
    if (_filterLsaType === "all" || !_lsaData?.by_lsa_type?.[_filterLsaType]) {
      panel.style.setProperty("display", "none");
      return;
    }

    const typeRow = _lsaData.by_lsa_type[_filterLsaType].all;
    const typeName  = LSA_TYPE_NAMES[_filterLsaType] || _filterLsaType;
    const typeColor = LSA_TYPE_COLORS[_filterLsaType]?.border || "var(--accent)";

    // BUGFIX-A：部分序列型（如目前的 S5「高風險」）可能剛好 0 位學生
    // （n_sequences=0），過去版本會直接隱藏面板，使用者容易誤會成「卡片沒載入」。
    // 改為明確顯示「此分群目前無資料」，而非靜默消失。
    if (!typeRow || (typeRow.n_sequences ?? 0) === 0) {
      panel.style.setProperty("display", "block");
      panel.innerHTML = `
        <div class="ladash-ins-panel">
          <div class="ladash-ins-title">
            <span class="ladash-ins-dot" data-clr="${typeColor}"></span>
            學習行為洞察（行為序列分群）— ${_filterLsaType} ${typeName}
          </div>
          <div class="ladash-ins-summary">此分群目前無足夠序列資料可供分析（0 位學生），暫無法產生洞察。</div>
        </div>`;
      panel.querySelectorAll("[data-clr]").forEach(node => {
        if (node.classList.contains("ladash-ins-dot")) node.style.setProperty("background", node.dataset.clr);
      });
      return;
    }

    const bench = _getLsaPassBenchmark();
    if (!bench) { panel.style.setProperty("display", "none"); return; }

    // 一律採該分群「全體（不分及格/不及格）」列，與雷達圖洞察邏輯一致
    // （不隨畫面上的 全體/及格組/不及格組 按鈕變動，避免比較基準與比較對象混淆）
    const row = _lsaRatios(typeRow);
    if (row.mPersist === null && row.qPersist === null) {
      panel.style.setProperty("display", "none");
      return;
    }

    const clName  = typeName;
    const clColor = typeColor;
    const pct  = v => v === null ? "—" : `${(v * 100).toFixed(1)}%`;
    const sign = v => v > 0 ? "+" : "";

    const diffs = ["mPersist", "qPersist"]
      .filter(dim => row[dim] !== null && bench[dim] !== null)
      .map(dim => ({
        dim,
        label: LSA_DIM_LABELS[dim] || dim,
        clVal: row[dim],
        benchVal: bench[dim],
        diff: row[dim] - bench[dim],
      }));

    const strengths = diffs.filter(x => x.diff >=  LSA_INSIGHT_THRESHOLD).sort((a, b) => b.diff - a.diff);
    const gaps      = diffs.filter(x => x.diff <= -LSA_INSIGHT_THRESHOLD).sort((a, b) => a.diff - b.diff);

    const strHTML = strengths.length ? `
      <div class="ladash-ins-section">
        <div class="ladash-ins-hdr ladash-ins-hdr-str">▲ 高於及格群基準</div>
        ${strengths.map(x => `
          <div class="ladash-ins-row">
            <span class="ladash-ins-lbl">${x.label}</span>
            <div class="ladash-ins-vals">
              <span class="ladash-ins-bench">${pct(x.benchVal)} →</span>
              <span class="ladash-ins-val-str">${pct(x.clVal)}</span>
              <span class="ladash-ins-diff-str">${sign(x.diff)}${pct(x.diff)}</span>
            </div>
          </div>`).join("")}
      </div>` : "";

    const gapHTML = gaps.length ? `
      <div class="ladash-ins-section">
        <div class="ladash-ins-hdr ladash-ins-hdr-gap">▼ 低於及格群基準</div>
        ${gaps.map(x => `
          <div class="ladash-ins-row">
            <span class="ladash-ins-lbl">${x.label}</span>
            <div class="ladash-ins-vals">
              <span class="ladash-ins-bench">${pct(x.benchVal)} →</span>
              <span class="ladash-ins-val-gap">${pct(x.clVal)}</span>
              <span class="ladash-ins-diff-gap">${sign(x.diff)}${pct(x.diff)}</span>
            </div>
          </div>`).join("")}
      </div>` : "";

    // 行為佔比為中性描述資訊，不計入強弱項評分（方向見 _lsaRatios 上方註記）
    const shareHTML = (row.mShare !== null) ? `
      <div class="ladash-ins-row" style="margin-top:2px">
        <span class="ladash-ins-lbl">M/Q 行為佔比</span>
        <div class="ladash-ins-vals">
          <span class="ladash-ins-bench">教材 ${pct(row.mShare)}／刷題 ${pct(row.qShare)}</span>
          <span class="ladash-ins-bench">（及格群基準：教材 ${pct(bench.mShare)}／刷題 ${pct(bench.qShare)}）</span>
        </div>
      </div>` : "";

    const summaryParts = [];
    if (strengths.length) {
      const top = strengths[0];
      summaryParts.push(`本群學生（${_filterLsaType}）在 <strong>${top.label}</strong> 高出及格群基準 <strong class="ladash-ins-val-str">${pct(Math.abs(top.diff))}</strong>`);
    }
    if (gaps.length) {
      const top = gaps[0];
      summaryParts.push(`但在 <strong>${top.label}</strong> 低於及格群基準 <strong class="ladash-ins-val-gap">${pct(Math.abs(top.diff))}</strong>`);
    }
    const summaryHTML = summaryParts.length ? `
      <div class="ladash-ins-summary" data-clr="${clColor}">${summaryParts.join("，")}。</div>` : "";

    const recItems = gaps.map(g => LSA_RECOMMENDATION_MAP[g.dim]).filter(Boolean);
    const recHTML = recItems.length ? `
      <div class="ladash-ins-section">
        <div class="ladash-ins-hdr ladash-ins-hdr-rec">💡 建議措施</div>
        ${recItems.map(r => `
          <div class="ladash-ins-rec-row">
            <span class="ladash-ins-rec-icon">${r.icon}</span>
            <span class="ladash-ins-rec-txt">${r.action}</span>
          </div>`).join("")}
      </div>` : "";

    const fallbackHTML = bench.isFallback ? `
      <div class="ladash-ins-fallback">※ 及格群樣本數不足（&lt;${LSA_MIN_PASS_COUNT}人），比較結果僅供參考。</div>` : "";

    // BUG-FOUND-穿透式審查（沿用0712輪發現的教訓，此輪換成 S 維度重新確認）：
    // row.count 來自 by_lsa_type 限定樣本，但 behavior.json 的學生紀錄本身不帶
    // S 型別欄位（只有 R 型別的 cluster 欄位），必須透過 _lsaData.lsa_type_map
    // （key 為 `${anon_id}||${semester}`）才能還原「這位學生這學期屬於哪個 S 型別」。
    // 匯出人數與面板「共 X 人」一律採 lsa_type_map 實際比對結果，確保兩者一致
    // （不重蹈 0712 輪 R1 卡片「面板寫951人、實際匯出998筆」對不上的錯誤）。
    const seqMap = _lsaData.lsa_type_map || {};
    const matchedStudents = _behaviorStudents.filter(
      s => seqMap[`${s.anon_id}||${s.semester}`] === _filterLsaType
    );
    const exportCount = matchedStudents.length;

    const exportHTML = `
      <div class="ladash-ins-export-wrap">
        <button data-export-lsa-seqtype-csv="1" class="ladash-ins-export-btn" data-clr="${clColor}">
          ⬇ 匯出 ${_filterLsaType} 學生名單（CSV）
        </button>
        <span class="ladash-ins-export-cnt">共 ${exportCount} 人</span>
      </div>`;

    panel.style.setProperty("display", "block");
    panel.innerHTML = `
      <div class="ladash-ins-panel">
        <div class="ladash-ins-title">
          <span class="ladash-ins-dot" data-clr="${clColor}"></span>
          學習行為洞察（行為序列分群）— ${_filterLsaType} ${clName}
        </div>
        ${fallbackHTML}
        ${summaryHTML}
        ${strHTML}
        ${gapHTML}
        ${shareHTML}
        ${recHTML}
        ${exportHTML}
      </div>`;

    panel.querySelectorAll("[data-clr]").forEach(node => {
      const clr = node.dataset.clr;
      if (node.classList.contains("ladash-ins-dot"))     node.style.setProperty("background", clr);
      if (node.classList.contains("ladash-ins-summary")) node.style.setProperty("border-left", `3px solid ${clr}`);
      if (node.classList.contains("ladash-ins-export-btn")) {
        node.style.setProperty("border", `1.5px solid ${clr}`);
        node.style.setProperty("color", clr);
      }
    });
    const insPanelEl = panel.querySelector(".ladash-ins-panel");
    if (insPanelEl) insPanelEl.style.setProperty("padding", window.innerWidth < 600 ? "10px" : "14px");

    const exportBtn = panel.querySelector("[data-export-lsa-seqtype-csv]");
    if (exportBtn) {
      const hoverBg = LSA_TYPE_COLORS[_filterLsaType]?.bg || "rgba(79,142,247,.15)";
      exportBtn.addEventListener("click", () => _exportLsaSeqTypeCSV(matchedStudents));
      exportBtn.addEventListener("mouseenter", () => exportBtn.style.setProperty("background", hoverBg));
      exportBtn.addEventListener("mouseleave", () => exportBtn.style.setProperty("background", "transparent"));
    }
  }

  // ── A-2：匯出行為序列分群學生名單（CSV）── 沿用資源使用雷達圖分頁同一份 behavior.json，
  //         透過 lsa_type_map 還原每位學生的 S 型別（見上方 _renderLsaInsights 註記）──
  function _exportLsaSeqTypeCSV(matchedStudents) {
    if (!matchedStudents || !matchedStudents.length) { alert("目前篩選條件下無學生資料"); return; }
    const header = ["masked_id", "seq_type", "cluster", "semester", "final_score"].join(",");
    const rows = matchedStudents.map(s =>
      [s.masked_id || "", _filterLsaType, s.cluster || "", s.semester || "", s.final_score ?? s.semester_score ?? ""].join(",")
    );
    const csv = "\uFEFF" + [header, ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `${_filterLsaType}_students_lsa.csv`,
      style: "display:none",
    });
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function _onFilterChange() {
    _filterSemester = document.getElementById("lsaSemFilter")?.value     ?? "all";
    _filterCluster  = document.getElementById("lsaClusterFilter")?.value ?? "all";
    _filterLsaType  = document.getElementById("lsaTypeFilter")?.value    ?? "all";
    // FIX-Q5：選序列分群時自動清除其他；選資源分群時清除學期
    if (_filterLsaType !== "all") {
      _filterSemester = "all";
      _filterCluster  = "all";
    } else if (_filterCluster !== "all") {
      _filterSemester = "all";
    }
    // 重繪 filterBar 更新 disabled 狀態
    _renderFilterBar();
    if (_lsaData) { _render(); _renderLsaInsights(); }
  }

  // ── 群組按鈕 ──────────────────────────────────────────────────
  function _bindGroupButtons() {
    document.querySelectorAll("#lsaGroupControls .lsa-group-btn").forEach(btn => {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener("click", () => onGroupChange(clone.dataset.group));
    });
  }

  function onGroupChange(group) {
    _group = group || "all";
    _syncGroupBtnStyles();
    if (_lsaData) { _render(); _renderLsaInsights(); }
  }

  function _syncGroupBtnStyles() {
    document.querySelectorAll("#lsaGroupControls .lsa-group-btn").forEach(btn => {
      const active = btn.dataset.group === _group;
      btn.style.setProperty('background',   active ? 'var(--accent,#3498db)' : 'var(--surface2,#1c2030)');
      btn.style.setProperty('color',        active ? '#fff' : 'var(--text-dim,#888)');
      btn.style.setProperty('border-color', 'var(--border2,#2a2f45)');
      });
  }

  function resetFilters() {
    _group          = "all";
    _filterSemester = "all";
    _filterCluster  = "all";
    _filterLsaType  = "all";
    _syncGroupBtnStyles();
    _renderFilterBar();   // re-renders dropdowns with correct disabled state & selected values
    if (_lsaData) { _render(); _renderLsaInsights(); }
  }

  function reRender() {
    if (_lsaData) { _render(); _renderLsaInsights(); }
  }

  // ── 依 filter 狀態取得對應 groupData ─────────────────────────
  // FIX-Q3 優先順序：學期 > 資源分群 > 序列分群 > 全體
  // 及格狀況（_group = all/pass/fail）永遠是最終一層
  function _resolveGroupData() {
    if (_filterSemester !== "all") {
      return _lsaData.by_semester?.[_filterSemester]?.[_group] ?? null;
    }
    if (_filterCluster !== "all") {
      return _lsaData.by_cluster?.[_filterCluster]?.[_group] ?? null;
    }
    if (_filterLsaType !== "all") {
      return _lsaData.by_lsa_type?.[_filterLsaType]?.[_group] ?? null;
    }
    return _lsaData.groups?.[_group] ?? null;
  }

  // ── 主渲染（委派至 _renderToContainer）────────────────────────
  function _render() {
    const wrap = document.getElementById("lsaGraphWrap");
    if (!wrap) return;
    // Use actual container width; SVG canvas will be at least 520px
    // The wrap will get overflow-x:auto so narrow mobile can scroll
    const W = Math.max(wrap.clientWidth || 340, 520);
    const H = 400;
    _renderToContainer(wrap, W, H);
    _updateInfoBar();   // 同步更新人數資訊列

    // 若放大 overlay 開著，同步更新 overlay 內的圖形
    const overlayContainer = document.getElementById("lsaExpandSvgContainer");
    if (overlayContainer) {
      const oW = Math.max(600, overlayContainer.clientWidth  || window.innerWidth  * 0.9);
      const oH = 400;
      _renderToContainer(overlayContainer, oW, oH);
    }
  }

  // ── 人數資訊列更新 ──────────────────────────────────────────
  function _updateInfoBar() {
    const bar = document.getElementById("lsaInfoBar");
    if (!bar || !_lsaData) return;

    const groupData = _resolveGroupData();
    if (!groupData) { bar.innerHTML = ""; return; }

    // 全體 all 的 n_students 作為母群分母
    const allData    = (() => {
      if (_filterSemester !== "all") return _lsaData.by_semester?.[_filterSemester]?.all;
      if (_filterCluster  !== "all") return _lsaData.by_cluster?.[_filterCluster]?.all;
      if (_filterLsaType  !== "all") return _lsaData.by_lsa_type?.[_filterLsaType]?.all;
      return _lsaData.groups?.all;
    })();
    const grandTotal = _lsaData.groups?.all?.n_students ?? null; // 全資料集人數（佔比基準）
    const groupAll   = allData?.n_students ?? null;              // 本篩選條件全體人數
    const groupCur   = groupData.n_students ?? null;             // 本篩選條件+及格組人數

    const pct = (a, b) => (b && b > 0) ? ` (${(a / b * 100).toFixed(1)}%)` : "";

    const groupLabel = _group === "pass" ? "及格組"
                     : _group === "fail" ? "不及格組" : "全體";

    // 篩選條件標籤
    let filterLabel = "全資料集";
    if (_filterSemester !== "all") {
      const yr = _filterSemester.slice(0,3);
      const s  = _filterSemester.slice(3) === "1" ? "(1)" : "(2)";
      filterLabel = `學期 ${yr}${s}`;
    } else if (_filterCluster !== "all") {
      filterLabel = `資源分群 ${_filterCluster}`;
    } else if (_filterLsaType !== "all") {
      filterLabel = `序列分群 ${_filterLsaType}`;
    }

    const items = [];
    if (groupAll !== null && grandTotal !== null) {
      items.push(`<span>📊 <strong>${filterLabel}</strong>：${groupAll.toLocaleString()} 人${pct(groupAll, grandTotal)}</span>`);
    }
    if (groupCur !== null && groupAll !== null && _group !== "all") {
      items.push(`<span>👥 ${groupLabel}：${groupCur.toLocaleString()} 人${pct(groupCur, groupAll)}</span>`);
    } else if (groupCur !== null && grandTotal !== null && _group === "all") {
      items.push(`<span>👥 ${groupLabel}：${groupCur.toLocaleString()} 人</span>`);
    }

    const seqN = groupData.n_sequences ?? 0;
    items.push(`<span>🔢 序列對：${seqN.toLocaleString()}</span>`);

    bar.innerHTML = items.join(
      `<span class="ladash-lsa-sep">|</span>`
    );
  }

  // ── 核心渲染函式（可複用至 overlay）──────────────────────────
  function _renderToContainer(container, W_in, H) {
    let W = W_in;  // mutable: may expand if layout requires wider canvas
    if (!_lsaData) { _renderEmptyTo(container, "資料尚未載入"); return; }

    const groupData = _resolveGroupData();
    if (!groupData) { _renderEmptyTo(container, `找不到群組 ${_group} 的資料`); return; }

    const n = groupData.n_sequences ?? 0;
    // 快取主容器參照，供後續 isMain 判斷複用
    const mainWrap = document.getElementById("lsaGraphWrap");
    const isMain   = container === mainWrap;

    if (n === 0) {
      if (isMain) _renderEmptyTo(container, "本批資料無有效行為序列對（reading_log 可能為空）");
      return;
    }

    container.innerHTML = "";
    // For main wrap: enable horizontal scroll when SVG canvas > container width
    if (isMain) {
      container.style.setProperty('overflow-x', 'auto');                   // CSP-V7-FIX
      container.style.setProperty('overflow-y', 'hidden');                 // CSP-V7-FIX
      container.style.setProperty('-webkit-overflow-scrolling', 'touch'); // CSP-V7-FIX
    }

    let svg;
    try {
      svg = d3.select(container).append("svg")
        .attr("width",  "100%")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("height", "auto")   // SVG-HEIGHT-AUTO-FIX（0721）：height 為 CSS 概念，
                                    // 用 .attr() 設成 SVG 屬性會被瀏覽器判定為不合法的
                                    // length 值（"Expected length, 'auto'"），改用 .style()
                                    // 設定 CSS height，視覺效果不變（仍由 viewBox 決定比例）。
        .style("font-family", "sans-serif")
        .style("display", "block");
    } catch (e) {
      if (isMain) _renderEmptyTo(container, "D3.js 載入失敗，請確認網路連線。");
      return;
    }

    // ── marker ─────────────────────────────────────────────────────
    const defs = svg.append("defs");
    _mkMarker(defs, "arrow-sig",        SIG_COLOR,               5);
    _mkMarker(defs, "arrow-insig",      "rgba(120,130,160,0.6)", 4);
    _mkMarker(defs, "arrow-self-sig",   SIG_COLOR,               5);
    _mkMarker(defs, "arrow-self-insig", "rgba(120,130,160,0.6)", 4);

    // ── 節點 ──────────────────────────────────────────────────────
    const behaviors = _lsaData.behaviors ?? ["M", "Q"];
    const totals    = groupData.behavior_totals ?? {};
    const nodes = behaviors.map((b, i) => ({
      id:    b,
      label: BEHAVIOR_LABELS[b] || b,
      total: totals[b] ?? 0,
      r:     NODE_BASE_R + Math.sqrt(totals[b] ?? 0) * NODE_SCALE,
      x:     W * (0.25 + i * 0.5),
      y:     H * 0.5,
    }));

    // ── 邊 ────────────────────────────────────────────────────────
    const zScores = groupData.z_score    ?? {};
    const sigMap  = groupData.significant ?? {};
    const links = [];
    for (const a of behaviors) {
      for (const b of behaviors) {
        const key = `${a}→${b}`;
        const z   = zScores[key] ?? null;
        const sig = sigMap[key]  ?? false;
        const sw  = z != null ? Math.max(1, Math.min(4, Math.abs(z) * EDGE_Z_SCALE)) : 1;
        links.push({
          source: a, target: b, z, sig, sw,
          isSelf: a === b,
          color:  sig ? SIG_COLOR : INSIG_COLOR,
          marker: sig ? "url(#arrow-sig)" : "url(#arrow-insig)",
        });
      }
    }

    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));
    links.forEach(l => {
      l.source = nodeById.get(l.source) ?? l.source;
      l.target = nodeById.get(l.target) ?? l.target;
    });

    // Deterministic horizontal layout — guarantee no badge↔node overlap.
    // Each badge is ~160px wide (CJK); two badges side-by-side in the gap need 2×160 + 24px padding.
    // Inter-node distance = r₀ + r₁ + 2×BADGE_W + padding
    const BADGE_W    = 160;  // per-badge width budget
    const nodeR0 = nodes[0]?.r ?? NODE_BASE_R;
    const nodeR1 = nodes[1]?.r ?? NODE_BASE_R;
    const minDist = nodeR0 + nodeR1 + BADGE_W * 2 + 24;
    const naturalDist = W * 0.52;
    const dist = Math.max(minDist, naturalDist);
    const cx = W / 2;
    // If dist > W*0.9, expand canvas W to fit (triggers scroll on narrow containers)
    const requiredW = dist + nodeR0 + nodeR1 + 24;
    if (requiredW > W) {
      W = requiredW;
      svg.attr("viewBox", `0 0 ${W} ${H}`);
    }
    if (nodes[0]) nodes[0].x = cx - dist / 2;
    if (nodes[1]) nodes[1].x = cx + dist / 2;

    // Force only adjusts Y; X is pinned
    const nonSelf = links.filter(l => !l.isSelf);
    const sim = d3.forceSimulation(nodes)
      .force("link",      d3.forceLink(nonSelf).id(d => d.id).distance(dist).strength(0.3))
      .force("charge",    d3.forceManyBody().strength(-80))
      .force("center",    d3.forceCenter(cx, H / 2))
      .force("collision", d3.forceCollide().radius(d => d.r + 20))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();
    // Re-pin X after simulation
    if (nodes[0]) nodes[0].x = cx - dist / 2;
    if (nodes[1]) nodes[1].x = cx + dist / 2;
    nodes.forEach(nd => {
      nd.x = Math.max(nd.r + 12, Math.min(W - nd.r - 12, nd.x));
      nd.y = Math.max(nd.r + 12, Math.min(H - nd.r - 12, nd.y));
    });

    // ── 邊線 ──────────────────────────────────────────────────────
    const edgeG = svg.append("g").attr("class", "lsa-edges");

    nonSelf.forEach(l => {
      const ndS = l.source, ndT = l.target;
      const sx = ndS.x, sy = ndS.y;
      const tx = ndT.x, ty = ndT.y;
      const dx = tx - sx, dy = ty - sy;
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;

      // 雙向邊垂直偏移（offset=40 讓兩弧 Y 間距 80px，badge 清楚分離）
      const offset = 40;
      const cx = (sx + tx) / 2 - (dy / norm) * offset;
      const cy = (sy + ty) / 2 + (dx / norm) * offset;

      // 終點切線方向 = (終點 - 控制點) 的方向
      const tDx = tx - cx, tDy = ty - cy;
      const tLen = Math.sqrt(tDx * tDx + tDy * tDy) || 1;
      const tUx = tDx / tLen, tUy = tDy / tLen;  // 終點切線單位向量

      const markerReach = 5 * l.sw * 0.5;  // marker 突出長度（用戶空間）
      const retreat     = ndT.r + markerReach + 2;  // +2 margin

      const ex = tx - tUx * retreat;
      const ey = ty - tUy * retreat;

      // 起點也需退縮，避免從節點中心出發
      const sDx = cx - sx, sDy = cy - sy;
      const sLen = Math.sqrt(sDx * sDx + sDy * sDy) || 1;
      const sUx = sDx / sLen, sUy = sDy / sLen;
      const startX = sx + sUx * (ndS.r + 2);
      const startY = sy + sUy * (ndS.r + 2);

      edgeG.append("path")
        .attr("d", `M${startX},${startY} Q${cx},${cy} ${ex},${ey}`)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.sw)
        .attr("marker-end",   l.marker)
        .attr("opacity",      l.sig ? 0.85 : 0.4);

      // Z-score pill：放在弧線中點（t=0.5），沿弧曲法線方向往外偏移，兩條弧的 badge 自然分離
      if (l.sig && l.z != null) {
        const t  = 0.5;
        const u  = 1 - t;
        // 弧中點座標
        const lx = u*u*startX + 2*u*t*cx + t*t*ex;
        const ly = u*u*startY + 2*u*t*cy + t*t*ey;
        // 切線方向 (導數 = 2(1-t)(P1-P0) + 2t(P2-P1))
        const tanX = 2*(1-t)*(cx - startX) + 2*t*(ex - cx);
        const tanY = 2*(1-t)*(cy - startY) + 2*t*(ey - cy);
        const tanLen = Math.sqrt(tanX*tanX + tanY*tanY) || 1;
        // 法線方向（切線旋轉 90°）— 指向弧的彎曲外側
        const nxRaw = -tanY / tanLen;
        const nyRaw =  tanX / tanLen;
        // 確認法線指向弧的外側（控制點方向）
        const toCPx = cx - lx, toCPy = cy - ly;
        const dot = nxRaw * toCPx + nyRaw * toCPy;
        const nx = dot > 0 ? nxRaw : -nxRaw;
        const ny = dot > 0 ? nyRaw : -nyRaw;
        // badge 往外偏移 30px（讓 badge 不壓在弧線上）
        const bx = lx + nx * 30;
        const by = ly + ny * 30;

        // 第1行：方向 + 白話
        const tName = BEHAVIOR_LABELS[l.target.id] || l.target.id;
        const meaning = l.z < 0 ? "顯著迴避" : "顯著偏好";
        const line1 = `${l.source.id}→${l.target.id} 後切換${tName}`;
        const line2 = `Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}  ${meaning} ✦`;
        // CJK-aware width: non-ASCII chars ~10px, ASCII ~6.5px at font-size 11
        const _bwE = s => { let w = 0; for (const c of s) w += c.codePointAt(0) > 0x7F ? 10 : 6.5; return w + 20; };
        const bw  = Math.max(100, _bwE(line1), _bwE(line2));
        const bh  = 48;
        // clamp so badge doesn't escape SVG canvas
        const clampedBX = Math.max(4, Math.min(W - bw - 4, bx - bw / 2));

        edgeG.append("rect")
          .attr("x", clampedBX).attr("y", by - bh / 2)
          .attr("width", bw).attr("height", bh)
          .attr("rx", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.95);

        const bCx = clampedBX + bw / 2;

        edgeG.append("text")
          .attr("x", bCx).attr("y", by - 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    11)
          .attr("font-weight",  "700")
          .attr("fill",         SIG_COLOR)
          .attr("pointer-events","none")
          .text(line1);
        edgeG.append("text")
          .attr("x", bCx).attr("y", by + 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    10)
          .attr("font-weight",  "400")
          .attr("fill",         "var(--text-mid,#9aa0b8)")
          .attr("pointer-events","none")
          .text(line2);
      }
    });

    // ── 自環：三次貝茲曲線（SVG arc 突出不足，改用貝茲）
    // M→M 上側拱形：從左上角出發繞到右上角，控制點在節點正上方 60px
    // Q→Q 下側拱形：從右下角出發繞到左下角，控制點在節點正下方 60px
    // 幾何驗證：突出量 43px，badge 在弧頂外側 12px，不出框 ✓
    const loopAngle = 40 * Math.PI / 180;  // 端點從節點中心偏40°
    const loopH     = 60;                   // 控制點高出節點邊緣距離

    links.filter(l => l.isSelf).forEach(l => {
      const nd    = l.source;
      if (!nd) return;
      const isTop = behaviors.indexOf(nd.id) === 0;

      // 端點（節點邊緣上 ±40°）
      const sinA = Math.sin(loopAngle), cosA = Math.cos(loopAngle);
      let sx, sy, ex, ey, cp1x, cp1y, cp2x, cp2y;

      if (isTop) {
        // 上側：起點左上，終點右上，控制點在上方
        sx   = nd.x - nd.r * sinA;  sy   = nd.y - nd.r * cosA;
        ex   = nd.x + nd.r * sinA;  ey   = sy;
        cp1x = sx - 20;              cp1y = nd.y - nd.r - loopH;
        cp2x = ex + 20;              cp2y = cp1y;
      } else {
        // 下側：起點右下，終點左下，控制點在下方
        sx   = nd.x + nd.r * sinA;  sy   = nd.y + nd.r * cosA;
        ex   = nd.x - nd.r * sinA;  ey   = sy;
        cp1x = sx + 20;              cp1y = nd.y + nd.r + loopH;
        cp2x = ex - 20;              cp2y = cp1y;
      }

      const mId = l.sig ? "url(#arrow-self-sig)" : "url(#arrow-self-insig)";
      edgeG.append("path")
        .attr("d", `M${sx},${sy} C${cp1x},${cp1y} ${cp2x},${cp2y} ${ex},${ey}`)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.sw ?? 1.5)
        .attr("marker-end",   mId)
        .attr("opacity",      l.sig ? 0.85 : 0.4);

      if (l.sig && l.z != null) {
        const behaviorName = BEHAVIOR_LABELS[nd.id] || nd.id;
        // 第1行：行為方向 + 白話意義
        const line1 = `${nd.id}→${nd.id} 連續${behaviorName}`;
        // 第2行：Z值 + 顯著標記
        const line2 = `Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}  顯著偏好 ✦`;
        // CJK-aware width: non-ASCII chars ~10px, ASCII ~6.5px at font-size 11
        const _bwS = s => { let w = 0; for (const c of s) w += c.codePointAt(0) > 0x7F ? 10 : 6.5; return w + 20; };
        const bw  = Math.max(100, _bwS(line1), _bwS(line2));
        const bh  = 48;  // 兩行高度 × 1.25

        const topX = 0.125*sx + 0.375*cp1x + 0.375*cp2x + 0.125*ex;
        const topY = 0.125*sy + 0.375*cp1y + 0.375*cp2y + 0.125*ey;

        const badgeY = isTop ? topY - 20 : topY + 20;
        const rawBX  = topX - bw / 2;
        const badgeX = Math.max(4, Math.min(W - bw - 4, rawBX));

        edgeG.append("rect")
          .attr("x", badgeX).attr("y", badgeY - bh / 2)
          .attr("width", bw).attr("height", bh)
          .attr("rx", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.95);

        const bCx = badgeX + bw / 2;
        edgeG.append("text")
          .attr("x", bCx).attr("y", badgeY - 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    11)
          .attr("font-weight",  "700")
          .attr("fill",         SIG_COLOR)
          .attr("pointer-events","none")
          .text(line1);
        edgeG.append("text")
          .attr("x", bCx).attr("y", badgeY + 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    10)
          .attr("font-weight",  "400")
          .attr("fill",         "var(--text-mid,#9aa0b8)")
          .attr("pointer-events","none")
          .text(line2);
      }
    }); // end self-loop

    // ── 節點（繪製在邊線之上）─────────────────────────────────────
    const nodeG = svg.append("g").attr("class", "lsa-nodes");
    nodes.forEach(nd => {
      const g = nodeG.append("g")
        .attr("transform", `translate(${nd.x},${nd.y})`)
        .style("cursor", "default");

      g.append("circle")
        .attr("r",            nd.r)
        .attr("fill",         NODE_COLOR)
        .attr("stroke",       NODE_STROKE)
        .attr("stroke-width", 2);

      // 節點文字：id 置中偏上，label 置中偏下
      // dy="0.35em" 讓字的視覺重心落在 y 座標位置
      g.append("text")
        .attr("text-anchor", "middle")
        .attr("y", -7)
        .attr("dy", "0.35em")
        .attr("font-size",   20)
        .attr("font-weight", "bold")
        .attr("fill",        "var(--text,#fff)")
        .text(nd.id);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("y", 12)
        .attr("dy", "0.35em")
        .attr("font-size",   13)
        .attr("fill",        "var(--text-mid,#ccc)")
        .text(nd.label);

      g.append("title")
        .text(`${nd.id}：${nd.label}\n出現次數：${nd.total.toLocaleString()}`);
    });

    // ── 內容自適應：重算 viewBox 消除上下空白 ────────────────────
    // 在所有元素繪製完成後，透過 getBBox() 取得實際內容範圍
    // 加 PAD px 上下左右留白，讓圖形緊密貼合內容
    try {
      const PAD = 20;
      const gAll = svg.node().querySelectorAll("path,rect,circle,text");
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      gAll.forEach(el => {
        try {
          const b = el.getBBox();
          if (b.width === 0 && b.height === 0) return;
          if (b.y < minY) minY = b.y;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
          if (b.x < minX) minX = b.x;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
        } catch (_) {}
      });
      if (isFinite(minY) && isFinite(maxY)) {
        const vx = Math.max(0, minX - PAD);
        const vy = Math.max(0, minY - PAD);
        const vw = maxX + PAD - vx;
        const vh = maxY + PAD - vy;
        svg.attr("viewBox", `${vx} ${vy} ${vw} ${vh}`)
           .attr("width",  Math.ceil(vw))
           .attr("height", Math.ceil(vh));
        if (isMain) {
          container.style.setProperty("width", "");
          container.style.setProperty("height", Math.ceil(vh) + "px");
        }
      }
    } catch (_) {}

    // ── 圖例 + 解讀卡片（只在主容器更新）────────────────────────
    if (isMain) {
      const legEl = document.getElementById("lsaLegend");
      if (legEl) {
        legEl.innerHTML = `
          <span class="ladash-lsa-mr14">
            <svg width="24" height="8" class="ladash-lsa-vmid">
              <line x1="0" y1="4" x2="24" y2="4" stroke="${SIG_COLOR}" stroke-width="2.5"/>
            </svg>顯著轉移（|Z|&gt;1.96）
          </span>
          <span>
            <svg width="24" height="8" class="ladash-lsa-vmid">
              <line x1="0" y1="4" x2="24" y2="4" stroke="rgba(120,130,160,0.7)" stroke-width="1.5"/>
            </svg>不顯著
          </span>
          <span class="ladash-lsa-ml14-dim">序列對數：${n.toLocaleString()}</span>`;
      }
      _updateInterpretCard(groupData, _group);
    }
  }

  // ── 白話解讀卡片 ─────────────────────────────────────────────
  function _updateInterpretCard(groupData, group) {
    const cardEl = document.getElementById("lsaInterpretCard");
    if (!cardEl) return;

    const obs   = groupData.observed        ?? {};
    const exp   = groupData.expected        ?? {};
    const z     = groupData.z_score         ?? {};
    const bt    = groupData.behavior_totals ?? {};
    const n     = groupData.n_sequences     ?? 0;
    const total = (bt.M ?? 0) + (bt.Q ?? 0);
    const mPct  = total ? ((bt.M ?? 0) / total * 100).toFixed(1) : "—";
    const qPct  = total ? ((bt.Q ?? 0) / total * 100).toFixed(1) : "—";

    const groupLabel = { all: "全體", pass: "及格組", fail: "不及格組" }[group] || group;

    const zMM  = z["M→M"] ?? 0;
    const oMM  = (obs["M→M"] ?? 0).toLocaleString();
    const oMQ  = (obs["M→Q"] ?? 0).toLocaleString();
    const oQM  = (obs["Q→M"] ?? 0).toLocaleString();
    const oQQ  = (obs["Q→Q"] ?? 0).toLocaleString();
    const eMM  = Math.round(exp["M→M"] ?? 0).toLocaleString();
    const eMQ  = Math.round(exp["M→Q"] ?? 0).toLocaleString();
    const zAbs = Math.abs(zMM).toFixed(1);
    const zAbsNum = Math.abs(zMM);
    const zSigNote = zAbsNum >= 2.58 ? "遠大於臨界值 1.96，達 p<0.01 顯著水準"
                    : zAbsNum >= 1.96 ? "大於臨界值 1.96，達 p<0.05 顯著水準"
                    : "未達 1.96 顯著門檻，此組轉移模式尚不具統計顯著性";

    // 及格 vs 不及格比較（只在 all 組顯示，使用當前篩選脈絡的 pass/fail）
    let compareHtml = "";
    if (group === "all") {
      // _resolveGroupData 已依篩選優先順序取得當前脈絡；這裡取同脈絡的 pass/fail
      const _getCtxGroup = (g) => {
        if (_filterSemester !== "all") return _lsaData.by_semester?.[_filterSemester]?.[g];
        if (_filterCluster  !== "all") return _lsaData.by_cluster?.[_filterCluster]?.[g];
        if (_filterLsaType  !== "all") return _lsaData.by_lsa_type?.[_filterLsaType]?.[g];
        return _lsaData.groups?.[g];
      };
      const passData = _getCtxGroup("pass");
      const failData = _getCtxGroup("fail");
      if (passData && failData) {
        const zPass = Math.abs(passData.z_score?.["M→M"] ?? 0).toFixed(1);
        const zFail = Math.abs(failData.z_score?.["M→M"] ?? 0).toFixed(1);
        compareHtml = `
          <div class="ladash-lsa-info-box">
            <div class="ladash-lsa-info-hdr">📌 及格 vs 不及格比較</div>
            及格組「連續專注」Z = <strong class="ladash-lsa-accent">${zPass}</strong>，
            不及格組 Z = <strong class="ladash-lsa-warn">${zFail}</strong>。<br>
            Z 值差距（${(parseFloat(zPass) - parseFloat(zFail)).toFixed(1)}）反映：
            及格組的<strong class="ladash-lsa-val">連續專注行為更為穩定集中</strong>，
            不及格組行為序列相對分散，切換頻率較高。
          </div>`;
      }
    }

    // 保留上次展開狀態（跨群組切換時維持使用者選擇）
    const wasOpen = cardEl.dataset.open === "1";

    cardEl.innerHTML = `
      <div id="lsaInterpretToggle" class="ladash-lsa-interpret-toggle">
        <span class="ladash-lsa-label-bold">
          📊 怎麼看這張圖？— 白話解讀
          <span class="ladash-lsa-label-sub">
            ${groupLabel} M ${mPct}% ／ Q ${qPct}% ／ |Z|=${zAbs}
          </span>
        </span>
        <span id="lsaInterpretChevron" class="ladash-lsa-chevron" data-open="${wasOpen ? '1' : '0'}">▼</span>
      </div>

      <div id="lsaInterpretBody" class="ladash-lsa-interpret-body" data-open="${wasOpen ? '1' : '0'}">

        <div class="ladash-lsa-stat-box">
          <div class="ladash-lsa-mb4">
            ⚡ 行為組成：教材閱讀（M）佔 <strong class="ladash-lsa-accent">${mPct}%</strong>，
            題庫作答（Q）佔 <strong class="ladash-lsa-accent">${qPct}%</strong>
          </div>
          <div>
            📐 本組所有轉移方向的 |Z| 均為 <strong class="ladash-lsa-accent">${zAbs}</strong>
            （${zSigNote}）<br>
            <span class="ladash-lsa-dim-sm">
              ※ 2×2 轉移矩陣的數學性質：|Z(M→M)| = |Z(M→Q)| = |Z(Q→M)| = |Z(Q→Q)|，正負號代表偏好或迴避。
            </span>
          </div>
        </div>

        <div class="ladash-lsa-grid2">
          <div class="ladash-lsa-blue-box">
            <div class="ladash-lsa-blue-hdr">✅ 偏好：連續專注</div>
            <div>M→M 觀察 <strong>${oMM}</strong> 次，期望僅 ${eMM} 次</div>
            <div>Q→Q 觀察 <strong>${oQQ}</strong> 次</div>
            <div class="ladash-lsa-note">
              白話：學生傾向「一直讀教材」或「一直刷題」，不輕易切換，專注度高。
            </div>
          </div>
          <div class="ladash-lsa-red-box">
            <div class="ladash-lsa-warn-hdr">🚫 迴避：跨行為切換</div>
            <div>M→Q 觀察 <strong>${oMQ}</strong> 次，期望應有 ${eMQ} 次</div>
            <div>Q→M 觀察 <strong>${oQM}</strong> 次</div>
            <div class="ladash-lsa-note">
              白話：學生極少「讀完教材馬上去做題」或「做完題馬上回去讀材料」，兩種學習模式分開進行。
            </div>
          </div>
        </div>
        ${compareHtml}
      </div>`;

    const _initBody   = document.getElementById("lsaInterpretBody");
    const _initChevron = document.getElementById("lsaInterpretChevron");
    if (_initBody) {
      _initBody.style.setProperty('max-height', wasOpen ? '600px' : '0');   // CSP-V6-FIX
      _initBody.style.setProperty('margin-top', wasOpen ? '8px'   : '0');   // CSP-V6-FIX
    }
    if (_initChevron) {
      _initChevron.style.setProperty('transform', wasOpen ? 'rotate(180deg)' : 'rotate(0deg)'); // CSP-V6-FIX
    }

    // 綁定收放事件（重新渲染後 DOM 已替換，需重綁）
    document.getElementById("lsaInterpretToggle")?.addEventListener("click", () => {
      const body    = document.getElementById("lsaInterpretBody");
      const chevron = document.getElementById("lsaInterpretChevron");
      if (!body) return;
      // 使用 dataset.open 作為狀態源，避免依賴 style.maxHeight 字串比對
      const isOpen  = cardEl.dataset.open === "1";
      const opening = !isOpen;
      body.style.setProperty('max-height', opening ? '600px' : '0');   // CSP-V6-FIX
      body.style.setProperty('margin-top', opening ? '8px'   : '0');   // CSP-V6-FIX
      chevron.style.setProperty('transform', opening ? 'rotate(180deg)' : 'rotate(0deg)'); // CSP-V6-FIX
      cardEl.dataset.open = opening ? "1" : "0";
    });
  }

  // ── Graceful Degradation ──────────────────────────────────────
  function _renderEmptyTo(container, msg) {
    if (!container) return;
    container.innerHTML = `
      <div class="ladash-lsa-empty-box">
        ⚠️ ${_safeText(msg)}
      </div>`;
    const _chev = document.getElementById("lsaInterpretChevron");
    const _body = document.getElementById("lsaInterpretBody");
    if (_chev) _chev.style.setProperty("transform", _chev.dataset.open === "1" ? "rotate(180deg)" : "rotate(0deg)");
    if (_body) {
      _body.style.setProperty("max-height", _body.dataset.open === "1" ? "600px" : "0");
      _body.style.setProperty("margin-top", _body.dataset.open === "1" ? "8px" : "0");
    }
      }

  function _renderEmpty(msg) {
    const wrap = document.getElementById("lsaGraphWrap");
    if (wrap) _renderEmptyTo(wrap, msg);
    const legEl = document.getElementById("lsaLegend");
    if (legEl) legEl.innerHTML = "";
  }

  function _safeText(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init, resetFilters, onGroupChange, reRender };
})();
