/**
 * tab-behavior-cross.js  —  v1.0
 *
 * 行為預測分析 sub-tab（第5個，掛載於 sub-lsa 之後）。
 * MVP 範圍（依規劃 Phase 3）：
 *   ① R群 / S群 不及格率長條圖（Chart.js）
 *   ② Alert Card：自動偵測高風險 R×S 組合（不及格率 ≥25%）
 *   ③ BAS / QMI 摘要卡
 *
 * 資料來源：BehaviorLoader.load.crossAnalysis() → data/cross_analysis.json
 * 沿用既有色表（CLUSTER_NAMES 對應 R1-R5，與 tab-behavior-radar.js 一致）
 */

const BehaviorCrossTab = (() => {

  let _crossData = null;
  let _chart = null;
  let _trajChart = null;
  let _approachChart = null;

  const CLUSTER_NAMES = { R1:"影音輔導型", R2:"彈性聽覺型", R3:"平均使用型", R4:"題庫刷題型", R5:"被動低參與型" };
  // [BUG-S5-DEFAULT FIX] 改用與 index.html / tab-behavior-lsa.js 一致的
  // 序列轉移穩定性命名（LSA_TYPE_NAMES）。原本此處的「高主動切換型…序列不足」
  // 是另一套未對齊的舊命名，且 S5「序列不足」實為後端 s_cluster 預設值 bug
  // 造成的症狀（已於 ETL 修正，S5 現為真正的高風險分類，非樣本不足佔位）。
  const S_NAMES       = { S1:"穩定高效", S2:"規律中效", S3:"波動中效", S4:"低頻低效", S5:"高風險" };

  // [XGB-FEATURE-LABEL] Top5 預測特徵代號 → 中文語意對照。
  // MM/MQ_ratio 定義依據：19_XGBoost雙模型整合規格書v3.3 §5（10_lsa_transition.py
  // compute_lsa_by_lsa_type()）。M=教材類行為（影音/文字/輔助教材），Q=題庫作答行為。
  // [UI-FIX-3] 補齊缺漏項目；與 at-risk-report.js「Top Risk Factors」共用本對照表
  // （透過模組匯出的 featureLabel() 呼叫），確保兩處中文譯名一致。
  // 沿用 tab-behavior-correlation.js FEAT_LABELS 既有中文譯名（如聽覺教材完成率、
  // 題庫作答次數、首答正確率…），避免同一特徵在不同分頁出現不同譯名。
  const FEATURE_LABELS_ZH = {
    quz_pass_rate:      { zh: "題庫通過率",       desc: "題庫測驗中答對比例達及格標準的作答次數占比" },
    quz_cramming_ratio: { zh: "題庫集中刷題率",   desc: "作答時間集中於考前臨時抱佛腳的程度" },
    s_cluster_encoded:  { zh: "S群序列分型代碼",  desc: "序列轉移穩定性分群（S1穩定～S5高風險）轉換後的數值編碼" },
    MQ_ratio:           { zh: "教材→題庫轉換率",  desc: "學生完成教材類行為後，接續轉向題庫作答的比例（M→Q ÷ 教材總次數）" },
    MM_ratio:           { zh: "教材→教材連續率",  desc: "學生完成教材類行為後，再次接續教材類行為（未轉向題庫）的比例（M→M ÷ 教材總次數）" },
    quz_total_attempts:         { zh: "題庫作答次數",     desc: "學生在題庫測驗中累計嘗試作答的總次數" },
    quz_first_attempt_accuracy: { zh: "首答正確率",       desc: "每題「首次作答」即答對的比例，反映對知識點的原始掌握程度" },
    late_night_ratio:           { zh: "深夜學習比例",     desc: "學習行為發生於深夜時段（23:00–06:00）的次數占比" },
    aud_completion_rate:        { zh: "聽覺教材完成率",   desc: "聽覺類教材（音檔）完成度達完成門檻的比例" },
    tut_total_minutes:          { zh: "輔導資源時間",     desc: "使用輔導資源的累計學習分鐘數" },
    consistency_score:          { zh: "學習穩定性",       desc: "各週學習投入時間的分布穩定程度，數值越高代表學習節奏越規律" },
    quz_score_delta:            { zh: "答題進步率",       desc: "首次作答與最終作答正確率之間的成長幅度（MG Rate）" },
    total_learning_minutes:     { zh: "總學習時間",       desc: "學期內所有教材與題庫累計學習分鐘數" },
    reading_inflation_ratio:    { zh: "閱讀時數灌水倍數", desc: "原始累積閱讀時數 ÷ 教材離群值裁切後時數，越高代表時數中疑似有較多非真實閱讀（如掛自動播放）的成分" },
    policy_gaming_flag:         { zh: "累積時數達標存疑", desc: "原始時數達到課程規定門檻，但排除疑似異常時段後其實未達標" },
    sup_completion_rate:        { zh: "補充筆記完成率",   desc: "補充筆記／整理資源完成度達完成門檻的比例" },
    early_start_ratio:          { zh: "提早學習比例",     desc: "在教材開放後儘早開始學習（而非拖延）的行為比例" },
    cram_pattern_score:         { zh: "臨陣磨槍指數",     desc: "學習行為集中於考前臨時衝刺、平時投入偏低的程度" },
    active_weeks:               { zh: "活躍學習週數",     desc: "整學期中至少有一次學習行為紀錄的週數" },
    vid_completion_rate:        { zh: "影音教材完成率",   desc: "影音類教材完成觀看進度達完成門檻的比例" },
    txt_completion_rate:        { zh: "文字教材完成率",   desc: "文字類教材（講義／電子書）閱讀進度達完成門檻的比例" },
    weekly_minutes_std:         { zh: "週學習時間標準差", desc: "各週學習分鐘數的離散程度，數值越高代表學習時間分布越不穩定" },
  };
  function _featureLabel(code) {
    return FEATURE_LABELS_ZH[code] || { zh: code, desc: "" };
  }

  const COLORS = {
    R1: "#3498db", R2: "#9b59b6", R3: "#2ecc71", R4: "#e67e22", R5: "#e74c3c",
    // [BUG-S5-DEFAULT FIX] S5 原用灰色(#95a5a6)，是舊語意「序列不足＝無資料」
    // 的視覺殘留；S5 現為真正的高風險分類，改用暖色系呼應風險程度
    // （S1穩定→S5高風險，與 R 群 R1→R5 的色階邏輯一致）。
    S1: "#1abc9c", S2: "#3498db", S3: "#f1c40f", S4: "#e67e22", S5: "#c0392b",
  };

  const ALERT_THRESHOLD = 0.25; // 高出基準的不及格率即列入 Alert Card

  // ── CSP FIX: COLORS 為固定 10 組（R1-R5/S1-S5）已知色票，
  // 並非真正動態值，可在模組載入時一次性產生對應 CSS class，
  // 取代散落各處 `style="color:${COLORS[code]}"` 等 inline style。
  const _PALETTE_CSS = Object.entries(COLORS).map(([code, hex]) =>
    `.cc-text-${code}{color:${hex}}` +
    `.cc-badge-${code}{background:${hex}22;color:${hex}}`
  ).join("");

  // ── 樣式防重複注入（ARCH-3 FIX）────────────────────────────
  function _injectStyleOnce(id, css) {
    if (document.getElementById(id)) return;
    const sentinel = document.createElement("meta");
    sentinel.id = id;
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) { /* fallback */ }
    }
    const el = document.createElement("style");
    el.id = id;
    const nonce = document.querySelector("meta[name=csp-nonce]")?.content || "";
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = css;
    document.head.appendChild(el);
  }

  const _STYLES = {
    summaryCard: `
      .cross-stat-box{padding:10px;border-radius:6px;background:var(--surface2,#1c2030);
                      border:1px solid var(--border2,#2a2f45)}
      .cross-stat-label{font-size:0.72rem;color:var(--text-dim,#888);margin-bottom:4px}
      .cross-stat-value{font-size:1.1rem;font-weight:600;color:var(--text,#eee)}
      .cross-stat-sub{font-size:0.68rem;color:var(--text-dim,#888);margin-top:2px}`,
    alertCard: `
      .cross-alert-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
                       padding:8px 10px;margin-bottom:6px;border-radius:6px;
                       background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.18)}
      .cross-alert-badge{padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600}
      .cross-alert-stat{font-size:0.78rem;color:var(--text-dim,#888);margin-left:auto}`,
    xgbCard: `
      .cross-stat-zh{font-size:0.72rem;font-weight:600;color:var(--accent,#3498db);margin-top:3px}
      .cross-stat-desc{font-size:0.68rem;color:var(--text-dim,#888);margin-top:2px;line-height:1.4}
      .cross-feat-section{margin-top:10px}
      .cross-feat-header{display:grid;grid-template-columns:150px 1fr 64px;gap:8px;
                          font-size:0.68rem;color:var(--text-dim,#888);
                          padding-bottom:4px;margin-bottom:6px;
                          border-bottom:1px solid var(--border2,#2a2f45)}
      .cross-feat-header-val{text-align:right}
      .cross-feat-row{display:grid;grid-template-columns:150px 1fr 64px;align-items:center;
                       gap:8px;margin-bottom:8px;font-size:0.78rem}
      .cross-feat-name-wrap{overflow:hidden}
      .cross-feat-name{color:var(--text,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
      .cross-feat-code{font-size:0.66rem;color:var(--text-dim,#777);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cross-feat-bar{height:8px;border-radius:4px;background:var(--surface2,#1c2030);overflow:hidden}
      .cross-feat-bar-fill{height:100%;width:var(--w,0%);background:var(--accent2,#9b59b6);border-radius:4px}
      .cross-feat-val{color:var(--text-dim,#888);text-align:right;font-variant-numeric:tabular-nums}`,
    heatmap: `
      .cross-heatmap-grid{display:grid;grid-template-columns:90px repeat(5,1fr);gap:3px;min-width:420px}
      .cross-heatmap-cell{padding:6px 4px;text-align:center;border-radius:4px;min-height:48px;
                           display:flex;flex-direction:column;align-items:center;justify-content:center}
      .cross-heatmap-corner{background:transparent}
      .cross-heatmap-header{background:var(--surface2,#1c2030)}
      .cross-heatmap-data{cursor:pointer;transition:transform .12s,box-shadow .12s}
      .cross-heatmap-data:hover,.cross-heatmap-data:focus{
        transform:scale(1.04);box-shadow:0 0 0 2px var(--accent,#3498db);outline:none}
      .cross-heatmap-empty{
        background:repeating-linear-gradient(45deg,rgba(150,150,150,0.12),rgba(150,150,150,0.12) 4px,
                   transparent 4px,transparent 8px);
        border:1px dashed rgba(150,150,150,0.3)}
      .cross-legend-swatch{display:inline-block;width:14px;height:14px;border-radius:3px;
                            vertical-align:middle;margin-right:2px}
      .cross-legend-hatch{
        background:repeating-linear-gradient(45deg,rgba(150,150,150,0.25),rgba(150,150,150,0.25) 3px,
                   transparent 3px,transparent 6px);
        border:1px dashed rgba(150,150,150,0.4)}`,
    legend: `
      .cross-legend-card{
        margin:12px 0;border-radius:8px;overflow:hidden;
        border:1px solid var(--border2,#2a2f45);background:var(--surface2,#1c2030)}
      .cross-legend-summary{
        display:flex;align-items:center;gap:8px;padding:9px 14px;
        font-size:0.82rem;font-weight:600;color:var(--text-dim,#aaa);
        cursor:pointer;user-select:none;list-style:none;border-radius:8px;
        transition:background .15s,color .15s}
      .cross-legend-summary::-webkit-details-marker{display:none}
      .cross-legend-summary:hover{background:rgba(255,255,255,.04);color:var(--text,#eee)}
      .cross-legend-card[open]>.cross-legend-summary{
        color:var(--text,#eee);border-radius:8px 8px 0 0;
        border-bottom:1px solid var(--border2,#2a2f45)}
      .cross-legend-summary-icon{
        display:inline-block;font-size:0.65rem;
        transition:transform .2s ease;color:var(--accent,#3498db)}
      .cross-legend-card[open] .cross-legend-summary-icon{transform:rotate(90deg)}
      .cross-legend-body{padding:12px 14px;overflow-x:auto}
      .cross-legend-table{width:100%;border-collapse:collapse;font-size:0.8rem;line-height:1.55}
      .cross-legend-table th{
        text-align:left;padding:6px 10px;font-size:0.75rem;font-weight:600;
        color:var(--text-dim,#888);border-bottom:1px solid var(--border2,#2a2f45);white-space:nowrap}
      .cross-legend-table td{
        padding:7px 10px;color:var(--text,#eee);vertical-align:top;
        border-bottom:1px solid rgba(255,255,255,.04)}
      .cross-legend-table tr:last-child td{border-bottom:none}
      .cross-legend-table tbody tr:hover td{background:rgba(255,255,255,.03)}
      .cross-legend-code{font-weight:700;font-size:0.85rem;white-space:nowrap}
      .cross-legend-note{margin:8px 0 0;font-size:0.72rem;color:var(--text-dim,#777);line-height:1.5}
      /* CSP FIX: static colors matching TRAJ_COLORS / APPROACH_COLORS below,
         replacing per-cell inline style="color:..." in the legend tables */
      .cross-legend-code--SS,.cross-legend-code--DEEP{color:#2ecc71}
      .cross-legend-code--FS{color:#3498db}
      .cross-legend-code--SF{color:#e67e22}
      .cross-legend-code--FF,.cross-legend-code--SURFACE{color:#e74c3c}
      .cross-legend-code--MODERATE{color:#f1c40f}`,
    // CSP FIX: consolidates every remaining inline `style="..."` found in
    // this file's template strings into reusable classes, plus the
    // discrete-bucket color scales used by the heatmap/severity text
    // (both are small fixed sets, not continuous values, so they map
    // cleanly to a fixed CSS class per bucket — see _cellColorClass /
    // _severityTextColorClass below).
    shared: `
      ${_PALETTE_CSS}
      .cross-card-body{font-size:0.82rem;line-height:1.7}
      .cross-card-title{margin-bottom:8px;font-weight:600}
      .cross-box-info{margin-bottom:8px;padding:8px 10px;border-radius:6px;
        background:rgba(100,160,255,0.07);border:1px solid rgba(100,160,255,0.2)}
      .cross-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .cross-stat-value--sm{font-size:0.95rem}
      .cross-muted-note{font-size:0.8rem;color:var(--text-dim,#888)}
      .cross-x-sep{color:var(--text-dim,#888)}
      .cross-stat-danger{color:#e74c3c}
      .cross-empty-msg{color:#c0392b;font-size:0.85rem;padding:12px}
      .cross-scrollwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
      .cross-header-label{font-weight:700}
      .cross-header-name{font-size:0.65rem;color:var(--text-dim,#888)}
      .cross-cell-label{font-weight:700;font-size:0.85rem}
      .cross-cell-n{font-size:0.65rem;color:var(--text-dim,#888)}
      .cross-cell-n--xs{font-size:0.6rem;color:var(--text-dim,#888)}
      .cross-cell-n--padded{padding:6px 4px}
      .cross-legend-wrap{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
        margin-top:10px;font-size:0.7rem;color:var(--text-dim,#888)}
      .cross-detail-card{padding:10px 12px;border-radius:6px;background:var(--surface2,#1c2030);
        border:1px solid var(--border2,#2a2f45);font-size:0.82rem;line-height:1.7}
      .cross-detail-title{font-weight:700;margin-bottom:6px}
      .cross-detail-note{color:var(--text-dim,#888)}
      /* 熱力圖色階：5 個離散桶（非連續值），_cellColorClass() 回傳對應 class */
      .cross-heat-0{background:transparent}
      .cross-heat-1{background:rgba(46,204,113,0.55)}
      .cross-heat-2{background:rgba(46,204,113,0.25)}
      .cross-heat-3{background:rgba(241,196,15,0.35)}
      .cross-heat-4{background:rgba(230,126,34,0.45)}
      .cross-heat-5{background:rgba(231,76,60,0.55)}
      /* 嚴重度文字色階：4 個離散桶，_severityTextColorClass() 回傳對應 class */
      .cross-sev-default{color:var(--text,#eee)}
      .cross-sev-low{color:#2ecc71}
      .cross-sev-mid{color:#f1c40f}
      .cross-sev-high{color:#e67e22}
      .cross-sev-crit{color:#e74c3c}`,
  };

  function _safeText(s) {
    return typeof escapeHtml === "function" ? escapeHtml(String(s)) : String(s);
  }

  function _pct(x) {
    const n = Number(x);
    return (x == null || isNaN(n)) ? "—" : (n * 100).toFixed(1) + "%";
  }

  // ── ARCH-4 FIX: 渲染階段容錯隔離 ──────────────────────────
  // 原版 init() 內各 _render* 函式無獨立保護，任一函式因資料欄位
  // 缺失（如 bas_validation / spearman 結構不符預期）拋出例外時，
  // 會中斷 init() 同步呼叫鏈，導致後續所有圖表「無聲消失」且
  // 畫面無任何錯誤提示。改為逐一隔離執行，單一卡片失敗不影響其他。
  function _safeRender(label, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`[BehaviorCrossTab] ${label} 渲染失敗:`, e);
    }
  }

  // ── 初始化 ──────────────────────────────────────────────
  async function init() {
    // CSP FIX: inject the consolidated shared stylesheet once, up front,
    // so every render function below can rely on its classes existing.
    _injectStyleOnce("__cross-style-shared", _STYLES.shared);
    try {
      _crossData = await BehaviorLoader.load.crossAnalysis();
    } catch (e) {
      console.error("[BehaviorCrossTab] load error:", e);
      _renderEmpty("cross_analysis.json 載入失敗，請確認 ETL 是否已執行 11_cross_analysis.py。");
      throw e;
    }

    if (!_crossData || !_crossData.overall) {
      _renderEmpty("ETL 尚未產出跨模組分析資料，請執行 11_cross_analysis.py 後重整頁面。");
      return;
    }

    _safeRender("資料範圍說明", _renderScopeNote);
    _safeRender("BAS/QMI 摘要卡", _renderSummaryCard);
    _safeRender("XGB預測效能卡", _renderXgbCard);
    _safeRender("高風險組合警示", _renderAlertCard);
    _safeRender("R群/S群長條圖", _renderGroupChart);
    _safeRender("R×S 熱力圖", _renderHeatmap);
    _safeRender("分析框架說明卡", _renderLegendCards);
    _safeRender("軌跡分型堆疊圖", _renderTrajectoryChart);
    _safeRender("學習方法堆疊圖", _renderApproachChart);
  }

  // ── 動態更新資料範圍說明（不鎖死特定學期）─────────────────
  function _renderScopeNote() {
    const el = document.getElementById("crossScopeNote");
    if (!el) return;

    const meta = _crossData.meta || {};
    const excluded = meta.incomplete_semesters_excluded || [];
    const semNote = excluded.length
      ? `尚無期末成績的最新學期（${excluded.map(_safeText).join(', ')}）為驗證學期，不納入相關性計算`
      : `目前所有學期皆已有期末成績`;

    // INTEG-1: 被動讀取 BehaviorLoader.loadWarningForCurrentTarget() 設置的
    // window._latestWarningValidation（原版寫入後從未被任何 Tab 讀取的死碼）。
    // 此處不主動呼叫 loadWarningForCurrentTarget()，因該載入屬「🔮 提前預警」
    // 分頁的職責；若使用者尚未開過該分頁，此全域變數會是 undefined，此時
    // 略過顯示而非顯示「尚未驗證」字樣，避免誤導為模型本身未經驗證。
    const wv = typeof window !== "undefined" ? window._latestWarningValidation : null;
    const validationNote = wv
      ? `<br>🎯 <strong>預警模型驗證：</strong>第 ${_safeText(wv.semester)} 學期，
         驗證日期 ${_safeText(wv.date)}，HIGH 風險組校準誤差 ${_safeText(wv.highErrorPp)}pp`
      : "";

    // UNIFY-C：改用與「相關性分析」分頁 corrInfoToggleBtn 一致的按鈕＋div 摺疊樣式
    // （原生 <details> 改為統一格式），並將預設狀態改為關閉。
    // 沿用「記住上次展開/收合狀態」邏輯：若先前已渲染過且使用者展開過，重繪後維持展開；
    // 否則（含首次渲染）預設關閉。
    const prevBody = el.querySelector('#crossScopeBody');
    const wasOpen = prevBody ? prevBody.style.display !== 'none' : false;

    el.innerHTML = `
      <div style="border-radius:5px;background:rgba(100,160,255,0.07);border:1px solid rgba(100,160,255,0.2);overflow:hidden">
        <button type="button" id="crossScopeToggleBtn"
          style="width:100%;text-align:left;padding:7px 10px;background:none;border:none;cursor:pointer;
                 font-size:0.78rem;color:var(--text-dim,#888);display:flex;align-items:center;gap:6px">
          <span id="crossScopeIcon" style="font-size:10px;color:var(--accent,#4f8ef7)">${wasOpen ? '▼' : '▶'}</span>
          ℹ️ <strong style="color:var(--text,#dde3f5)">資料範圍說明</strong>
          <span style="font-size:10px;opacity:0.6;margin-left:auto">點擊展開</span>
        </button>
        <div id="crossScopeBody" style="display:${wasOpen ? 'block' : 'none'};padding:0 10px 10px 10px;font-size:0.78rem;color:var(--text-dim,#888);line-height:1.7">
          本分析僅納入正課（theory）學生，實習科目（practicum）採30分制計分且60%成績未記入學習系統，已完全排除。
          訓練集為已有期末成績之學期（n=${_safeText(meta.n_with_final ?? '—')}）；
          ${semNote}，
          可於「🔮 提前預警」分頁單獨查看其預警名單。${validationNote}
        </div>
      </div>
    `;
    // 摺疊開關本身由 help-modal.js 內統一的 delegated click listener 處理
    // （比照 corrInfoToggleBtn，見該檔 §「摺疊卡片統一 toggle 邏輯」）。
  }

  function resetFilters() {
    // UI-CROSS-RESET FIX(0810)：本頁籤本身無傳統下拉篩選器（MVP 階段設計，
    // 見下方原註解），但 R×S 熱力圖支援點擊格子展開詳細統計
    // （見 _showHeatmapDetail()）。該互動狀態先前完全不受「清除條件」
    // 影響——按下後詳細統計面板仍顯示使用者上次點擊的格子內容，與其他
    // 分頁「清除條件」應回到預設狀態的一致行為不符，容易誤讀為目前
    // 狀態下的預設呈現。改為呼叫共用的 _resetHeatmapDetailPanel()，
    // 回到「尚未點擊任何格子」的預設提示文字。
    // （MVP 無篩選器，故僅需重置這個互動狀態即可，不需重新整理熱力圖本身）
    _resetHeatmapDetailPanel();
  }

  function reRender() {
    if (!_crossData) return;
    _safeRender("資料範圍說明", _renderScopeNote);
    _safeRender("BAS/QMI 摘要卡", _renderSummaryCard);
    _safeRender("XGB預測效能卡", _renderXgbCard);
    _safeRender("高風險組合警示", _renderAlertCard);
    _safeRender("R群/S群長條圖", _renderGroupChart);
    _safeRender("R×S 熱力圖", _renderHeatmap);
    _safeRender("分析框架說明卡", _renderLegendCards);
    _safeRender("軌跡分型堆疊圖", _renderTrajectoryChart);
    _safeRender("學習方法堆疊圖", _renderApproachChart);
  }

  function _renderEmpty(msg) {
    const el = document.getElementById("sub-cross");
    if (!el) return;
    _injectStyleOnce("__cross-style-shared", _STYLES.shared);
    el.innerHTML = `<p class="cross-empty-msg">⚠️ ${_safeText(msg)}</p>`;
  }

  // ── ① BAS / QMI 摘要卡 ──────────────────────────────────
  function _renderSummaryCard() {
    const wrap = document.getElementById("crossSummaryCard");
    if (!wrap) return;

    const o = _crossData.overall;
    const sp = _crossData.spearman || {};
    const bv = _crossData.bas_validation || {};
    const meta = _crossData.meta || {};

    // ARCH-4 FIX: qmi_quintiles 缺失或為空陣列時降級顯示，
    // 而非直接存取 q[0] 拋出 TypeError 拖垮整個 init() 呼叫鏈。
    const q = Array.isArray(bv.qmi_quintiles) ? bv.qmi_quintiles : [];
    const q1 = q[0] ?? null, q5 = q[q.length - 1] ?? null;
    const rSp = sp.r_group_vs_final || {};
    const sSp = sp.s_group_vs_final || {};
    const approach = o.approach || {};

    _injectStyleOnce("__cross-style-summary", _STYLES.summaryCard);
    wrap.innerHTML = `
      <div class="cross-card-body">
        <div class="cross-box-info">
          ℹ️ 訓練集：${_safeText(meta.training_semester_range || '—')}（n=${_safeText(o.n)}），排除實習科目與
          ${(meta.incomplete_semesters_excluded||[]).map(_safeText).join(', ')}（驗證學期）
        </div>

        <div class="cross-grid-stats">
          <div class="cross-stat-box">
            <div class="cross-stat-label">全體不及格率</div>
            <div class="cross-stat-value">${_pct(o.fail_rate_final)}</div>
            <div class="cross-stat-sub">期中 ${_pct(o.fail_rate_midterm)}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">BAS 複合評分</div>
            <div class="cross-stat-value">${bv.bas_r?.r != null ? 'r = ' + _safeText(bv.bas_r.r) : '<span class="cross-muted-note">訓練中/資料不足</span>'}</div>
            <div class="cross-stat-sub">期中×0.35 + QMI×0.30 + (1−被動)×0.20 + 練習×0.15</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">BAS AUC</div>
            <div class="cross-stat-value">${_crossData.bas_auc?.auc != null ? _safeText(_crossData.bas_auc.auc) : '<span class="cross-muted-note">訓練中/資料不足</span>'}</div>
            <div class="cross-stat-sub">分類區辨力（同 XGBoost AUC 定義，取負號對齊：BAS低分=高風險）</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">QMI 五分位梯度</div>
            <div class="cross-stat-value">${q1?.fail_rate != null && q5?.fail_rate != null ? `${_pct(q1.fail_rate)} → ${_pct(q5.fail_rate)}` : '<span class="cross-muted-note">訓練中/資料不足</span>'}</div>
            <div class="cross-stat-sub">${q1 && q5 ? `Q1（最低）vs Q5（最高），n=${_safeText(q1.n)}/${_safeText(q5.n)}` : '資料不足'}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">R群 × 期末 Spearman</div>
            <div class="cross-stat-value">${rSp.rho != null ? 'ρ = ' + _safeText(rSp.rho) : '<span class="cross-muted-note">資料不足</span>'}</div>
            <div class="cross-stat-sub">${_safeText(rSp.note || '')}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">S群 × 期末 Spearman</div>
            <div class="cross-stat-value">${sSp.rho != null ? 'ρ = ' + _safeText(sSp.rho) : '<span class="cross-muted-note">資料不足</span>'}</div>
            <div class="cross-stat-sub">${_safeText(sSp.note || '')}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">學習方法分布</div>
            <div class="cross-stat-value cross-stat-value--sm">
              DEEP ${_pct(approach.DEEP)} / SURFACE ${_pct(approach.SURFACE)}
            </div>
            <div class="cross-stat-sub">MODERATE ${_pct(approach.MODERATE)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── ①b XGBoost Prediction Performance 卡 ──────────────────
  // xgb_validation 為 null（--disable-xgb）或含 status（樣本不足/套件缺失）
  // 時整張卡隱藏、不報錯（第10.1節：xgbAuc===null → 隱藏卡片）
  function _renderXgbCard() {
    const wrap = document.getElementById("crossXgbCard");
    const cardWrap = document.getElementById("crossXgbCardWrap");
    if (!wrap) return;

    const xv = _crossData.xgb_validation;
    const fi = Array.isArray(_crossData.feature_importance) ? _crossData.feature_importance : [];

    if (!xv || xv.status) {
      if (cardWrap) cardWrap.style.setProperty("display", "none");
      return;
    }
    if (cardWrap) cardWrap.style.setProperty("display", "");

    _injectStyleOnce("__cross-style-summary", _STYLES.summaryCard); // 重用 .cross-stat-box
    _injectStyleOnce("__cross-style-xgb", _STYLES.xgbCard);

    // isPartial===true：Learning類特徵未截斷至第12週，對齊論文揭露要求
    const isPartial = xv.partial_truncation ?? false;
    const partialNote = isPartial
      ? `<div class="cross-muted-note">⚠️ Learning 類特徵（${(xv.untruncated_features || []).map(_safeText).join('、')}）
           尚未截斷至第 ${_safeText(xv.week_limit ?? 12)} 週，採全學期值（Phase 1.5 待替換）</div>`
      : "";

    const top5 = fi.slice(0, 5);
    const maxImp = top5.length ? Math.max(...top5.map(f => f.importance || 0)) : 0;
    const featRows = top5.map(f => {
      const pct = maxImp > 0 ? Math.round(((f.importance || 0) / maxImp) * 100) : 0;
      const lbl = _featureLabel(f.feature);
      return `
        <div class="cross-feat-row">
          <div class="cross-feat-name-wrap">
            <div class="cross-feat-name">${_safeText(lbl.zh)}</div>
            <div class="cross-feat-code">${_safeText(f.feature)}</div>
          </div>
          <div class="cross-feat-bar"><div class="cross-feat-bar-fill" style="--w:${pct}%"></div></div>
          <div class="cross-feat-val">${(f.importance ?? 0).toFixed(4)}</div>
        </div>`;
    }).join("");

    wrap.innerHTML = `
      <div class="cross-card-body">
        <div class="cross-grid-stats">
          <div class="cross-stat-box">
            <div class="cross-stat-label">AUC</div>
            <div class="cross-stat-value">${(xv.auc ?? 0).toFixed(3)}</div>
            <div class="cross-stat-zh">模型區辨力</div>
            <div class="cross-stat-desc">分辨「不及格／及格」學生的能力，越接近1越準</div>
            <div class="cross-stat-sub">Week ${_safeText(xv.week_limit ?? 12)} 截斷特徵</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">Precision</div>
            <div class="cross-stat-value">${(xv.precision ?? 0).toFixed(3)}</div>
            <div class="cross-stat-zh">命中率</div>
            <div class="cross-stat-desc">預警為高風險的學生中，實際不及格的比例</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">Recall</div>
            <div class="cross-stat-value">${(xv.recall ?? 0).toFixed(3)}</div>
            <div class="cross-stat-zh">召回率</div>
            <div class="cross-stat-desc">實際不及格學生中，被模型成功抓出的比例</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">F1 / Accuracy</div>
            <div class="cross-stat-value cross-stat-value--sm">${(xv.f1 ?? 0).toFixed(3)} / ${(xv.accuracy ?? 0).toFixed(3)}</div>
            <div class="cross-stat-zh">綜合分數 / 整體準確率</div>
            <div class="cross-stat-desc">F1平衡命中率與召回率；準確率為整體預測正確比例</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">r</div>
            <div class="cross-stat-value">${xv.xgb_r?.r != null ? _safeText(xv.xgb_r.r) : '<span class="cross-muted-note">訓練中/資料不足</span>'}</div>
            <div class="cross-stat-zh">排名相關係數</div>
            <div class="cross-stat-desc">模型預測及格機率與期末實際成績的 Pearson r，方向與 BAS r 一致，可直接並排比較</div>
          </div>
        </div>
        ${partialNote}
        ${top5.length ? `
          <div class="cross-feat-section">
            <div class="cross-card-title">Top 5 預測特徵（XGBoost feature importance）</div>
            <div class="cross-feat-header">
              <div>行為特徵</div>
              <div>相對重要性</div>
              <div class="cross-feat-header-val">重要性分數</div>
            </div>
            ${featRows}
          </div>` : ""}
      </div>`;
  }

  // ── ② Alert Card：自動偵測高風險 R×S 組合 ────────────────
  function _renderAlertCard() {
    const wrap = document.getElementById("crossAlertCard");
    if (!wrap) return;

    const overall_fail = _crossData.overall.fail_rate_final;
    const matrix = _crossData.cross_matrix || {};
    const alerts = [];

    for (const [rg, row] of Object.entries(matrix)) {
      for (const [sg, cell] of Object.entries(row)) {
        if (cell.low_sample || cell.fail_rate_final == null) continue;
        if (cell.fail_rate_final >= ALERT_THRESHOLD) {
          alerts.push({ rg, sg, ...cell });
        }
      }
    }
    alerts.sort((a, b) => b.fail_rate_final - a.fail_rate_final);

    _injectStyleOnce("__cross-style-alert", _STYLES.alertCard);

    if (alerts.length === 0) {
      wrap.innerHTML = `<p class="cross-muted-note">
        目前無 R×S 組合不及格率達 ${(ALERT_THRESHOLD*100).toFixed(0)}% 以上。</p>`;
      return;
    }

    // XSS-AUDIT FIX (regression from this file's own prior CSP refactor):
    // a.rg/a.sg come from `Object.entries(matrix)` — i.e. real JSON keys
    // from cross_analysis.json — not a fixed hardcoded loop like the
    // heatmap's R_CODES/S_CODES. The original inline-style version only
    // ever used a.rg/a.sg as an *object lookup key* (`COLORS[a.rg]`),
    // so an unexpected key just produced `undefined` styling. Building
    // `class="cc-badge-${a.rg}"` directly writes a.rg's raw string value
    // into an HTML attribute — if cross_matrix ever contained a malformed
    // or attacker-influenced key (e.g. via a compromised ETL run), a
    // value containing a `"` could break out of the class attribute and
    // inject new attributes. Whitelisting against the known cluster
    // codes closes this off entirely (unrecognized codes just render
    // without a color class, same graceful-degradation behavior as
    // before).
    const _knownCode = (c) => (Object.prototype.hasOwnProperty.call(COLORS, c) ? c : "");

    const rows = alerts.map(a => `
      <div class="cross-alert-row">
        <span class="cross-alert-badge cc-badge-${_knownCode(a.rg)}">
          ${_safeText(a.rg)} ${CLUSTER_NAMES[a.rg] || ''}
        </span>
        <span class="cross-x-sep">×</span>
        <span class="cross-alert-badge cc-badge-${_knownCode(a.sg)}">
          ${_safeText(a.sg)} ${S_NAMES[a.sg] || ''}
        </span>
        <span class="cross-alert-stat">
          不及格率 <strong class="cross-stat-danger">${_pct(a.fail_rate_final)}</strong>
          （高出基準 ${_pct(a.fail_rate_final - overall_fail)}，n=${_safeText(a.n)}）
        </span>
      </div>
    `).join('');

    wrap.innerHTML = `
      <div class="cross-card-body">
        <div class="cross-card-title">
          ⚠️ 高風險 R×S 組合（不及格率 ≥ ${(ALERT_THRESHOLD*100).toFixed(0)}%）
        </div>
        ${rows}
      </div>
    `;
  }

  // ── ③ R群 / S群 不及格率長條圖 ───────────────────────────
  function _renderGroupChart() {
    const canvas = document.getElementById("crossGroupChart");
    if (!canvas || typeof Chart === "undefined") return;

    const overall_fail = _crossData.overall.fail_rate_final;
    const rStats = _crossData.by_r_cluster || {};
    const sStats = _crossData.by_s_cluster || {};

    const labels = [];
    const data = [];
    const bg = [];
    const meta = [];

    for (const code of ["R1","R2","R3","R4","R5"]) {
      const s = rStats[code];
      if (!s) continue;
      labels.push(`${code} ${CLUSTER_NAMES[code]}`);
      if (s.low_sample || s.no_baseline) {
        data.push(0);
        bg.push("rgba(150,150,150,0.25)");
        meta.push(`n=${s.n}（樣本不足/無基準，不計算）`);
      } else {
        data.push(s.fail_rate_final * 100);
        bg.push(COLORS[code]);
        meta.push(`n=${s.n}，期末均值 ${s.final_mean}`);
      }
    }

    labels.push(""); // 分隔
    data.push(null);
    bg.push("transparent");
    meta.push("");

    for (const code of ["S1","S2","S3","S4","S5"]) {
      const s = sStats[code];
      if (!s) continue;
      labels.push(`${code} ${S_NAMES[code]}`);
      if (s.low_sample || s.no_baseline) {
        data.push(0);
        bg.push("rgba(150,150,150,0.25)");
        meta.push(`n=${s.n}（樣本不足/無基準，不計算）`);
      } else {
        data.push(s.fail_rate_final * 100);
        bg.push(COLORS[code]);
        meta.push(`n=${s.n}，期末均值 ${s.final_mean}`);
      }
    }

    if (_chart) _chart.destroy();
    _chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "期末不及格率 (%)",
          data,
          backgroundColor: bg,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = meta[ctx.dataIndex];
                const v = ctx.parsed.x;
                return v == null ? "" : `不及格率 ${v.toFixed(1)}%　${m}`;
              },
            },
          },
          // [垃圾碼已移除] annotation: undefined 對 Chart.js 無效果
        },
        scales: {
          x: {
            title: { display: true, text: "期末不及格率 (%)" },
            min: 0,
          },
        },
      },
      plugins: [{
        // 全體基準虛線
        id: "overallLine",
        afterDraw: (chart) => {
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          const x = xScale.getPixelForValue(overall_fail * 100);
          const ctx = chart.ctx;
          ctx.save();
          ctx.strokeStyle = "rgba(231,76,60,0.7)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, yScale.top);
          ctx.lineTo(x, yScale.bottom);
          ctx.stroke();
          ctx.fillStyle = "rgba(231,76,60,0.9)";
          ctx.font = "10px sans-serif";
          ctx.fillText(`全體基準 ${(overall_fail*100).toFixed(1)}%`, x + 4, yScale.top + 10);
          ctx.restore();
        },
      }],
    });
  }

  // ── ④ R×S 5×5 熱力圖 ──────────────────────────────────────
  // 色階：以 fail_rate_final 相對於全體基準 (overall.fail_rate_final) 的
  // 倍數決定顏色深淺；low_sample 格子顯示灰色斜線紋理（S1–S5 一致規則，
  // S5 不再是特例佔位代碼，見 BUG-S5-DEFAULT FIX）。
  // 點擊格子展開詳細統計（n / mean±SD / fail_rate / z）。
  const R_CODES = ["R1","R2","R3","R4","R5"];
  const S_CODES = ["S1","S2","S3","S4","S5"];

  // CSP FIX: was `_cellColor()` returning a raw rgba() string for
  // `style="background:${bg}"`. The ratio is bucketed into 5 fixed tiers
  // (not a continuous value), so it maps cleanly onto the 5 static
  // `.cross-heat-N` classes defined in _STYLES.shared — renamed to make
  // the return type explicit.
  function _cellColorClass(fail_rate, overall_fail) {
    if (fail_rate == null) return "cross-heat-0";
    const ratio = overall_fail > 0 ? fail_rate / overall_fail : 1;
    // ratio: <0.7 綠 / 0.7-1.3 黃 / >1.3 橘 / >1.6 紅
    if (ratio < 0.7)  return "cross-heat-1";   // 低於基準70% → 綠
    if (ratio < 1.0)  return "cross-heat-2";   // 略低於基準 → 淺綠
    if (ratio < 1.3)  return "cross-heat-3";   // 略高於基準 → 黃
    if (ratio < 1.6)  return "cross-heat-4";   // 中高 → 橘
    return "cross-heat-5";                      // 高 → 紅
  }

  // UI-CROSS-RESET FIX(0810)：R×S 熱力圖詳細統計面板的預設提示文字，
  // 供 _renderHeatmap() 初始渲染與 resetFilters() 共用（見下方 resetFilters）。
  function _resetHeatmapDetailPanel() {
    const detail = document.getElementById("crossHeatmapDetail");
    if (detail) detail.innerHTML = `<p class="cross-cell-n cross-cell-n--padded">
      點擊上方格子查看該 R×S 組合的詳細統計。</p>`;
  }

  function _renderHeatmap() {
    const wrap = document.getElementById("crossHeatmapGrid");
    const detail = document.getElementById("crossHeatmapDetail");
    if (!wrap) return;

    const matrix = _crossData.cross_matrix || {};
    const overall_fail = _crossData.overall.fail_rate_final;

    _injectStyleOnce("__cross-style-heatmap", _STYLES.heatmap);

    // 表頭（S群）— 外層加 overflow-x:auto 讓手機可左右捲動，不讓格子變形
    let html = `<div class="cross-scrollwrap">`;
    html += `<div class="cross-heatmap-grid">`;
    html += `<div class="cross-heatmap-cell cross-heatmap-corner"></div>`;
    S_CODES.forEach(sg => {
      html += `<div class="cross-heatmap-cell cross-heatmap-header">
                 <div class="cross-header-label cc-text-${sg}">${sg}</div>
                 <div class="cross-header-name">${S_NAMES[sg]}</div>
               </div>`;
    });

    // 各列（R群）
    R_CODES.forEach(rg => {
      html += `<div class="cross-heatmap-cell cross-heatmap-header">
                 <div class="cross-header-label cc-text-${rg}">${rg}</div>
                 <div class="cross-header-name">${CLUSTER_NAMES[rg]}</div>
               </div>`;

      S_CODES.forEach(sg => {
        const cell = (matrix[rg] && matrix[rg][sg]) || {};
        const isLowSample = !!cell.low_sample;
        const hasStats = cell.fail_rate_final != null && !isLowSample;

        if (!hasStats) {
          // 灰色斜線紋理：樣本不足（S1–S5 一致規則）
          html += `<div class="cross-heatmap-cell cross-heatmap-empty"
                        title="${rg}×${sg}：樣本不足（n=${_safeText(cell.n ?? 0)}）"
                        data-r="${rg}" data-s="${sg}">
                     <div class="cross-cell-n">n=${_safeText(cell.n ?? 0)}</div>
                     <div class="cross-cell-n--xs">樣本不足</div>
                   </div>`;
        } else {
          const heatClass = _cellColorClass(cell.fail_rate_final, overall_fail);
          html += `<div class="cross-heatmap-cell cross-heatmap-data ${heatClass}" data-r="${rg}" data-s="${sg}"
                        role="button" tabindex="0"
                        title="點擊查看 ${rg}×${sg} 詳細統計">
                     <div class="cross-cell-label">${_pct(cell.fail_rate_final)}</div>
                     <div class="cross-cell-n">n=${_safeText(cell.n)}</div>
                   </div>`;
        }
      });
    });
    html += `</div></div>`; // close .cross-heatmap-grid + overflow wrapper

    // 圖例
    html += `
      <div class="cross-legend-wrap">
        <span>不及格率（相對全體基準 ${_pct(overall_fail)}）：</span>
        <span><span class="cross-legend-swatch cross-heat-1"></span>&lt;70%</span>
        <span><span class="cross-legend-swatch cross-heat-2"></span>70–100%</span>
        <span><span class="cross-legend-swatch cross-heat-3"></span>100–130%</span>
        <span><span class="cross-legend-swatch cross-heat-4"></span>130–160%</span>
        <span><span class="cross-legend-swatch cross-heat-5"></span>&gt;160%</span>
        <span><span class="cross-legend-swatch cross-legend-hatch"></span>樣本不足（n &lt; 5）</span>
      </div>
    `;

    wrap.innerHTML = html;

    // 點擊事件：展開詳細統計
    wrap.querySelectorAll(".cross-heatmap-data").forEach(el => {
      el.addEventListener("click", () => _showHeatmapDetail(el.dataset.r, el.dataset.s));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          _showHeatmapDetail(el.dataset.r, el.dataset.s);
        }
      });
    });

    if (detail) _resetHeatmapDetailPanel();
  }

  // CSP FIX: was `_severityTextColor()` returning a raw hex string for
  // `style="color:${...}"`. Same as the heatmap, ratio is bucketed into
  // 4 fixed tiers, mapped onto static `.cross-sev-*` classes.
  function _severityTextColorClass(fail_rate, overall_fail) {
    if (fail_rate == null || overall_fail <= 0) return "cross-sev-default";
    const ratio = fail_rate / overall_fail;
    if (ratio < 0.7) return "cross-sev-low";
    if (ratio < 1.3) return "cross-sev-mid";
    if (ratio < 1.6) return "cross-sev-high";
    return "cross-sev-crit";
  }

  function _showHeatmapDetail(rg, sg) {
    const detail = document.getElementById("crossHeatmapDetail");
    if (!detail) return;

    const cell = ((_crossData.cross_matrix || {})[rg] || {})[sg] || {};
    const overall = _crossData.overall;

    const zNote = (zRaw) => {
      if (zRaw == null) return "";
      const z = Number(zRaw);
      if (isNaN(z)) return "";
      const abs = Math.abs(z);
      const sig = abs >= 2.58 ? "p&lt;0.01 ***" : abs >= 1.96 ? "p&lt;0.05 *" : "未達顯著";
      const dir = z > 0 ? "高於" : "低於";
      return `（z=${z.toFixed(2)}，${dir}全體平均，${sig}）`;
    };

    detail.innerHTML = `
      <div class="cross-detail-card">
        <div class="cross-detail-title">
          <span class="cc-text-${rg}">${rg} ${CLUSTER_NAMES[rg]}</span>
          ×
          <span class="cc-text-${sg}">${sg} ${S_NAMES[sg]}</span>
        </div>
        <div>樣本數：<strong>${_safeText(cell.n ?? 0)}</strong></div>
        ${cell.final_mean != null ? `<div>期末成績：<strong>${Number(cell.final_mean).toFixed(1)} ± ${cell.final_sd != null ? Number(cell.final_sd).toFixed(1) : '—'}</strong></div>` : ''}
        ${cell.fail_rate_final != null ? `
          <div>期末不及格率：<strong class="${_severityTextColorClass(cell.fail_rate_final, overall.fail_rate_final)}">
            ${_pct(cell.fail_rate_final)}</strong>
            （全體基準 ${_pct(overall.fail_rate_final)}）
            ${zNote(cell.z_vs_overall_final)}
          </div>` : ''}
        ${cell.note ? `<div class="cross-detail-note">ℹ️ ${_safeText(cell.note)}</div>` : ''}
      </div>
    `;
  }

  // ── ⑤ 軌跡分型 & 學習方法說明卡（可收折）────────────────────
  function _renderLegendCards() {
    _injectStyleOnce("__cross-style-legend", _STYLES.legend);

    const trajWrap = document.getElementById("crossTrajLegend");
    if (trajWrap && !trajWrap.dataset.ready) {
      trajWrap.dataset.ready = "1";
      trajWrap.innerHTML = `<summary class="cross-legend-summary">
          <span class="cross-legend-summary-icon">▶</span>
          分析框架說明 — 期中→期末軌跡分型（SS / FS / SF / FF）
        </summary>
        <div class="cross-legend-body">
          <table class="cross-legend-table">
            <thead><tr><th>代碼</th><th>名稱</th><th>行為特徵</th><th>量化判斷條件</th><th>教學建議</th></tr></thead>
            <tbody>
              <tr>
                <td class="cross-legend-code cross-legend-code--SS">SS</td>
                <td>穩定及格</td>
                <td>期中、期末皆及格，學習軌跡穩定</td>
                <td>期中成績 ≥ 60 且 期末成績 ≥ 60</td>
                <td>正向強化，鼓勵維持節奏與自主學習習慣</td>
              </tr>
              <tr>
                <td class="cross-legend-code cross-legend-code--FS">FS</td>
                <td>自救成功</td>
                <td>期中不及格但期末翻轉，屬高韌性學習者</td>
                <td>期中成績 &lt; 60 且 期末成績 ≥ 60</td>
                <td>分析翻轉策略，複製成功模式，強化學生信心</td>
              </tr>
              <tr>
                <td class="cross-legend-code cross-legend-code--SF">SF</td>
                <td>成績滑落</td>
                <td>期中及格但期末退步，後期投入下降</td>
                <td>期中成績 ≥ 60 且 期末成績 &lt; 60</td>
                <td>關注後半學期出勤與作答頻率，主動介入追蹤</td>
              </tr>
              <tr>
                <td class="cross-legend-code cross-legend-code--FF">FF</td>
                <td>持續不及格</td>
                <td>期中、期末皆不及格，高風險長期低效</td>
                <td>期中成績 &lt; 60 且 期末成績 &lt; 60</td>
                <td>優先介入，轉介學習支援資源，評估學習障礙</td>
              </tr>
            </tbody>
          </table>
          <p class="cross-legend-note">
            ※ 基準：期中／期末成績及格線均為 60 分；低樣本群（n &lt; 5）不計入軌跡分布。
          </p>
        </div>
      `;
    }

    const appWrap = document.getElementById("crossApproachLegend");
    if (appWrap && !appWrap.dataset.ready) {
      appWrap.dataset.ready = "1";
      appWrap.innerHTML = `<summary class="cross-legend-summary">
          <span class="cross-legend-summary-icon">▶</span>
          分析框架說明 — 學習方法三型分布（DEEP / SURFACE / MODERATE）
        </summary>
        <div class="cross-legend-body">
          <table class="cross-legend-table">
            <thead><tr><th>代碼</th><th>名稱</th><th>行為特徵</th><th>量化判斷條件</th><th>教學建議</th></tr></thead>
            <tbody>
              <tr>
                <td class="cross-legend-code cross-legend-code--DEEP">DEEP</td>
                <td>深層學習</td>
                <td>主動切換資源，影音與閱讀兼用，序列多元</td>
                <td>QMI ≥ 0.6 且 score_delta &lt; 0.2（首次高正確率、進步空間小）</td>
                <td>引導自主探究，鼓勵跨資源整合與知識建構</td>
              </tr>
              <tr>
                <td class="cross-legend-code cross-legend-code--SURFACE">SURFACE</td>
                <td>表層學習</td>
                <td>首次作答正確率低，反覆練習後才達標，依賴重複刷題</td>
                <td>score_delta ≥ 0.3（首次低、多次練習才通過，依賴題海戰術）</td>
                <td>強化學習計畫與策略指導，提供多元資源引導</td>
              </tr>
              <tr>
                <td class="cross-legend-code cross-legend-code--MODERATE">MODERATE</td>
                <td>中間型</td>
                <td>介於深層與表層之間，行為模式尚未穩定</td>
                <td>QMI 0.4–0.6 或 score_delta 0.2–0.3（介於深層與表層之間）</td>
                <td>引導提升學習深度，追蹤是否向深層或表層偏移</td>
              </tr>
            </tbody>
          </table>
          <p class="cross-legend-note">
            ※ QMI（題庫精熟指數）＝ 首次作答正確率×0.55 + 最終作答正確率×0.45 − 分數成長幅度×0.3；被動指數 ＝ 集中刷題率×0.70 + 考前衝刺強度×0.30。
            各群閾值依全體中位數動態計算，非固定常數。
          </p>
        </div>
      `;
    }
  }

  // ── ⑥ 軌跡分型堆疊圖（V-T：SS/FS/SF/FF）──────────────────
  // 依 R群/S群分組，顯示各群組「期中→期末」四種軌跡的比例分布。
  // R2/S5（no_baseline，無 trajectory 資料）顯示為單一灰色佔位列。
  const TRAJ_KEYS  = ["SS", "FS", "SF", "FF"];
  const TRAJ_NAMES = { SS: "穩定及格", FS: "自救成功", SF: "成績滑落", FF: "持續不及格" };
  const TRAJ_COLORS = { SS: "#2ecc71", FS: "#3498db", SF: "#e67e22", FF: "#e74c3c" };

  const APPROACH_KEYS  = ["DEEP", "SURFACE", "MODERATE"];
  const APPROACH_NAMES = { DEEP: "深層學習", SURFACE: "表層學習", MODERATE: "中間型" };
  const APPROACH_COLORS = { DEEP: "#2ecc71", SURFACE: "#e74c3c", MODERATE: "#f1c40f" };

  /**
   * 共用的分布類堆疊圖建構器（V-T / V-A）。
   * @param {string}   canvasId
   * @param {function} getChart     () => Chart|null  取得外部模組變數
   * @param {function} setChart     (Chart) => void   回寫外部模組變數
   * @param {string[]} keys         例如 TRAJ_KEYS 或 APPROACH_KEYS
   * @param {object}   names        代碼 → 顯示名稱
   * @param {object}   colors       代碼 → 顏色
   * @param {string}   distField    'trajectory' 或 'approach'
   * @param {string}   legendTitle
   */
  // ARCH-2 FIX: 原版使用 getter/setter wrapper 物件（反模式），
  // 改為 getChart/setChart callback，語意清晰且無 closure 陷阱。
  function _renderDistributionStackedChart(canvasId, getChart, setChart, keys, names, colors, distField, legendTitle) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return;

    const rStats = _crossData.by_r_cluster || {};
    const sStats = _crossData.by_s_cluster || {};

    const labels = [];
    const rows = []; // 每列：{ dist: {key:ratio,...} | null, n, lowSample }

    function pushGroup(code, statMap, nameMap) {
      const s = statMap[code];
      if (!s) return;
      labels.push(`${code} ${nameMap[code]}`);
      if (s.low_sample || s.no_baseline || !s[distField]) {
        rows.push({ dist: null, n: s.n ?? 0, lowSample: true });
      } else {
        rows.push({ dist: s[distField], n: s.n, lowSample: false });
      }
    }

    for (const code of ["R1","R2","R3","R4","R5"]) pushGroup(code, rStats, CLUSTER_NAMES);
    labels.push(""); rows.push({ dist: null, n: null, separator: true });
    for (const code of ["S1","S2","S3","S4","S5"]) pushGroup(code, sStats, S_NAMES);

    const datasets = keys.map(key => ({
      label: `${key} ${names[key]}`,
      data: rows.map(r => {
        if (r.separator) return null;
        if (r.dist == null) return 0;
        return (r.dist[key] ?? 0) * 100;
      }),
      backgroundColor: colors[key],
      stack: "dist",
    }));

    // 樣本不足/分隔列：疊加一個灰色全幅佔位 dataset，避免空白誤判為 0%
    datasets.push({
      label: "樣本不足／無資料",
      data: rows.map(r => (r.lowSample ? 100 : null)),
      backgroundColor: "rgba(150,150,150,0.25)",
      stack: "dist",
    });

    const existing = getChart();
    if (existing) existing.destroy();
    setChart(new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              title: (items) => items[0]?.label || "",
              label: (ctx) => {
                const row = rows[ctx.dataIndex];
                if (!row || row.separator) return "";
                if (row.lowSample) {
                  if (ctx.dataset.label !== "樣本不足／無資料") return "";
                  return `樣本不足（n=${row.n}），無分布資料`;
                }
                if (ctx.dataset.label === "樣本不足／無資料") return "";
                const v = ctx.parsed.x;
                return `${ctx.dataset.label}：${v.toFixed(1)}%（n≈${Math.round(row.n * v / 100)}）`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            min: 0, max: 100,
            title: { display: true, text: `${legendTitle} (%)` },
          },
          y: { stacked: true },
        },
      },
    }));
  }

  function _renderTrajectoryChart() {
    _renderDistributionStackedChart(
      "crossTrajectoryChart",
      () => _trajChart,
      (c) => { _trajChart = c; },
      TRAJ_KEYS, TRAJ_NAMES, TRAJ_COLORS, "trajectory", "期中→期末軌跡分布"
    );
  }

  function _renderApproachChart() {
    _renderDistributionStackedChart(
      "crossApproachChart",
      () => _approachChart,
      (c) => { _approachChart = c; },
      APPROACH_KEYS, APPROACH_NAMES, APPROACH_COLORS, "approach", "學習方法分布"
    );
  }

  // featureLabel：匯出供 at-risk-report.js「Top Risk Factors」共用，
  // 確保與本頁「Top 5 預測特徵」使用同一份中文譯名對照表（UI-FIX-3）。
  return { init, resetFilters, featureLabel: _featureLabel, reRender };
})();
