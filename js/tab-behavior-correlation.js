/**
 * tab-behavior-correlation.js
 * 相關性分析 Tab — Pearson / Spearman 熱力圖 + 散佈圖
 * 依賴：Chart.js (scatter)、behavior-loader.js
 *
 * 架構說明：
 *   篩選快取  — _filteredScatterData() 以 _lastFilterKey 避免重複過濾
 *   全量模式  — _isUnfiltered() 判斷，熱力圖優先讀 ETL 預算值
 *   即時計算  — 篩選後以 _pearsonValue / _spearmanValue 即時重算 r
 *   segment   — _canUseSeg() 時優先讀 segment_pearson 預聚合（快）
 *   onFilterChange 支援外部 overrides 物件覆蓋，防 DOM 值未同步問題
 *   _pearsonValue / _spearmanValue 回傳 {r, reason?, n?} 診斷物件
 */

const BehaviorCorrelationTab = (() => {

  // BUG-3 FIX (V11): cache nonce once at module level — avoids 6× repeated DOM query
  // Safe: GitHub Pages static CSP sets nonce via <meta name=csp-nonce> at parse time
  const _CSP_NONCE = document.querySelector('meta[name=csp-nonce]')?.content || '';

  // ── 欄位中文標籤 ─────────────────────────────────────────
  const FEAT_LABELS = {
    aud_completion_rate:          "聽覺教材完成率",
    aud_total_minutes:            "聽覺教材學習時間",
    vid_completion_rate:          "影音教材完成率",
    vid_total_minutes:            "影音教材學習時間",
    txt_completion_rate:          "文字教材完成率",
    txt_total_minutes:            "文字教材學習時間",
    sup_completion_rate:          "補充筆記完成率",
    sup_total_minutes:            "補充筆記學習時間",
    tut_total_minutes:            "輔導資源時間",
    quz_total_attempts:           "題庫作答次數",
    quz_pass_rate:                "題庫通過率",
    quz_coverage:                 "題庫涵蓋率",
    quz_late_cram:                "題庫考前集中度(3天)",
    total_learning_minutes:       "總學習時間",
    material_diversity_score:     "教材多樣性",
    consistency_score:            "學習穩定性",
    early_start_ratio:            "提早學習比例",
    cram_pattern_score:           "臨陣磨槍指數",
    pre_exam_intensity:           "考前學習強度",
    quz_first_attempt_accuracy:   "首答正確率",
    quz_final_accuracy:           "最終正確率",
    quz_score_delta:              "答題進步率 (MG Rate)",
    quz_cramming_ratio:           "考前7天刷題比",
    stability_cv:                 "學習穩定度 CV",
  };

  const GRADE_LABELS = {
    grade_midterm:  "期中成績",
    grade_final:    "期末成績",
    grade_total:    "學期成績",
    midterm_score:  "期中成績",
    final_score:    "期末成績",
    semester_score: "學期成績",
  };

  const PASS_THRESHOLD_CORR = 60;   // 及格門檻（與 time tab 保持一致）
  const MIN_CORR_PAIRS = 3;         // 篩選後即時計算所需最小樣本數

  // ── 無法計算原因設定（熱力圖診斷顯示用）────────────────────
  const REASON_CONFIG = {
    no_etl: {
      symbol:  "∅",
      label:   "ETL 無此欄位",
      detail:  "ETL 預算值中無此指標，請重跑 ETL 後重整頁面。",
      color:   "rgba(255,90,60,0.18)",
      border:  "1px solid rgba(255,90,60,0.5)",
      txtCls:  "text-danger",
    },
    insufficient: {
      symbol:  "n↓",
      label:   "樣本不足",
      detail:  `有效配對樣本數不足（需 ≥ ${MIN_CORR_PAIRS}）{nHint}，無法計算相關係數。`,
      color:   "rgba(255,193,7,0.15)",
      border:  "1px solid rgba(255,193,7,0.45)",
      txtCls:  "text-warning",
    },
    no_variance: {
      symbol:  "σ=0",
      label:   "數值無變異",
      detail:  "所有人數值完全相同（變異數為 0）{nHint}，Pearson/Spearman 分母為零，無法計算。",
      color:   "rgba(120,130,160,0.12)",
      border:  "1px solid rgba(120,130,160,0.35)",
      txtCls:  "text-muted",
    },
    // BUG-CORR-2 FIX：原本這裡另外定義了 excluded_new_material（symbol「新教材」），
    // 是獨立於 scale_change 的第二個 reason key。但兩者代表的是同一件事──
    // 某指標在特定學期的規模變動過大，暫時排除於全體(all/all/all)計算──
    // 只是 ETL 內部依觸發成因用了兩種字串（既有教材規模驟變 vs 新教材大量
    // 導入），且這兩種 reason 字串在 lagged_pearson／pearson 兩處分別出現過。
    // 拆成兩個 REASON_CONFIG key 會讓 Object.values(REASON_CONFIG) 產生的
    // 圖例重複兩條意思相同的說明、也讓使用者誤以為是兩種不同狀況。
    // 移除獨立的 excluded_new_material 定義，改在下面查表時把它正規化成
    // scale_change 讀同一份設定，兩種 reason 字串共用同一個符號／說明。
    scale_change: {
      symbol:  "Δ規模",
      label:   "本學期規模性變動，暫排除全體計算",
      detail:  "此指標在特定學期的數值規模較歷史顯著變動（無論是既有教材用量驟變、或新教材大量導入），為避免學期間規模差異扭曲全體相關係數，暫排除於全量(all/all/all)計算{nHint}。切換至單一學期或分群可看到該學期實際 r 值。",
      color:   "rgba(80,160,255,0.15)",
      border:  "1px solid rgba(80,160,255,0.45)",
      txtCls:  "text-info",
    },
  };

  // excluded_new_material 與 scale_change 共用同一份 REASON_CONFIG 設定（見上方註解）
  const REASON_ALIAS = { excluded_new_material: "scale_change" };

  let _corrData     = null;

  // ── 篩選狀態 ─────────────────────────────────────────────
  let _allScatterData   = null;   // 全量 scatter_data（篩選的基底）
  // BUG-CORR-2 FIX: _behaviorByMasked/_behaviorByAnon moved to init() local scope —
  // they were module-level state but only used within init() for the cluster join.
  // Keeping them as module-level caused unnecessary memory retention after init completes.
  let _allSemesters         = [];     // 可用學期列表
  let _incompleteSemesters  = [];     // 尚未獲得學末成績的學期（僅用於顯示警告）
  let _filterSemester       = "all";
  let _filterCluster    = "all";
  let _filterPass       = "all";
  let _filterOutlier    = false;
  let _corrType         = "pearson";

  // ── 篩選快取（移至頂部：_scatterRows 在函式定義時即引用，宣告應先於使用點）──
  let _lastFilterKey  = null;
  let _lastFiltered   = null;

  /** 判斷目前篩選狀態是否為「全量」（所有篩選器皆為 all，無排除異常值） */
  function _isUnfiltered() {
    return (
      _filterSemester === "all" &&
      _filterCluster  === "all" &&
      _filterPass     === "all" &&
      !_filterOutlier
    );
  }

  /** segment_pearson 查詢鍵（學期|分群|及格狀況） */
  function _segKey() {
    return `${_filterSemester}|${_filterCluster}|${_filterPass}`;
  }

  /**
   * 是否可使用 segment_pearson 預聚合資料。
   * eduType 已無 UI，永遠為 "all"；排除異常值時 ETL 預聚合不適用。
   */
  function _canUseSeg() {
    return !_filterOutlier && (_filterPass === "all" || _effectivePassThreshold() === PASS_THRESHOLD_CORR);
  }

  /**
   * 讀取目前相關係數矩陣中的 r 值。
   * Ph2b Breaking change：pearson 結構從純 float 改為 {r, p, significant}。
   * 此函式統一解包，確保整個 module 取到的都是 number | null。
   */
  function _pearson(feat, target) {
    // 若目前篩選的是未完成學期，優先讀取 incomplete_pearson（midterm only）
    if (_filterSemester !== "all" && _incompleteSemesters.includes(String(_filterSemester))) {
      const incM = _corrData?.incomplete_pearson?.[String(_filterSemester)] || {};
      const incRaw = incM[feat]?.[target] ?? incM[target]?.[feat] ?? null;
      if (incRaw !== null && typeof incRaw === "object") return incRaw.r ?? null;
      if (incRaw !== null) return incRaw;
    }
    const m = (_corrType === "spearman")
      ? (_corrData?.spearman || _corrData?.pearson || {})
      : (_filterOutlier && _corrData?.pearson_without_outliers
          ? _corrData.pearson_without_outliers      // outlier 模式：讀去除離群後的矩陣
          : (_corrData?.pearson || {}));             // 標準模式
    const raw = m[feat]?.[target] ?? m[target]?.[feat] ?? null;
    // 支援新格式 {r, p, significant} 與舊格式 number 並存
    if (raw !== null && typeof raw === "object") return raw.r ?? null;
    return raw;
  }

  // FILTER-BAR-CSP-FIX（0721）：原本這裡用 document.head.appendChild(<style>)
  // 直接注入無 nonce 的 <style> 標籤，違反本專案稍早已完成的 CSP 合規慣例
  // （unsafe-inline 已於先前版本移除，見 README「GitHub Pages cache fix」）。
  // 改用與本檔 _injectCorrStyle／_injectCorrStaticStyle 一致的
  // adoptedStyleSheets + nonce fallback 寫法，並補上 sentinel 防重複注入。
  // 篩選面板規格同步比照「時間分析」分頁 .ladash-t-filter-panel 模板
  // （邊框＋圓角＋底色＋nowrap+橫向捲動），取代原本無邊框、會換行的陽春 flex-bar。
  const _FILTER_STYLE_ID = "__ladash-corr-filter-style";
  function _injectFilterBarStyle() {
    if (document.getElementById(_FILTER_STYLE_ID)) return;
    const CSS = `.ladash-c-filter-bar{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;border:1px solid rgba(110,130,165,.22);border-radius:10px;background:var(--card-bg2,#1c2030);white-space:nowrap}
    .ladash-c-flex5{display:flex;align-items:center;gap:4px;font-size:.78rem;color:var(--text-dim,#888);flex-shrink:0}
    .ladash-c-sm8-bold-nw{font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap;flex-shrink:0}
    .ladash-c-sm78-nw{font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap}
    /* CHECKBOX-ZERO-SIZE-FIX（0721 穿透式審查發現，既有問題非本輪修改造成）：
       全站 index.html 第803行 input,button,select,textarea{-webkit-appearance:none}
       會移除 checkbox 原生外觀，若未補上替代寬高會直接收合為 0x0（僅能點擊 label
       文字觸發，勾選框本身不可見/不可點）。全站唯二使用 checkbox 的地方——print-panel.js
       的 .print-choice（index.html 第1113-1116行）已針對此問題補過 appearance:checkbox
       +固定寬高的修正；本篩選列的排除異常值 checkbox 當初漏補，這裡比照同一手法修正。 */
    .ladash-c-filter-bar input[type="checkbox"]{-webkit-appearance:checkbox;-moz-appearance:checkbox;appearance:checkbox;width:14px;height:14px;flex:0 0 auto;accent-color:var(--accent,#4f8ef7);cursor:pointer}`;
    const sentinel = document.createElement("meta");
    sentinel.id = _FILTER_STYLE_ID;
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) { /* fallback */ }
    }
    const el = document.createElement("style");
    el.id = _FILTER_STYLE_ID;
    const nonce = _CSP_NONCE;
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /**
   * Ph2b 新增：讀取 p-value（僅 Pearson 模式下有效）。
   */
  function _pearsonP(feat, target) {
    const m = _corrData?.pearson || {};
    const raw = m[feat]?.[target] ?? m[target]?.[feat] ?? null;
    if (raw !== null && typeof raw === "object") return raw.p ?? null;
    return null;
  }

  function _targets() {
    if (_corrData?.targets?.length) return _corrData.targets;
    if (_corrData?.grades?.length)  return _corrData.grades;
    const p = _corrData?.pearson || {};
    const topKeys = Object.keys(p);
    // 如果頂層 key 是 grade 名稱（新格式 target→feat），直接回傳
    const gradeKeys = topKeys.filter(k => k in GRADE_LABELS);
    if (gradeKeys.length) return gradeKeys;
    return ["midterm_score", "final_score", "semester_score"];
  }

  function _features() {
    if (_corrData?.features?.length) return _corrData.features;
    const p = _corrData?.pearson || {};
    const targets = _targets();
    const fromTargetRows = targets.flatMap(target => Object.keys(p[target] || {}));
    if (fromTargetRows.length) return [...new Set(fromTargetRows)];
    return Object.keys(p);
  }

  function _scatterRows(feat, target, rows) {
    const raw = rows ?? _lastFiltered ?? _allScatterData ?? _corrData?.scatter_data ?? [];
    if (Array.isArray(raw)) {
      return raw
        .map(row => ({
          x: row.features?.[feat],
          y: row[target],
          masked_id: row.masked_id,
        }))
        .filter(row => row.x != null && row.y != null && isFinite(row.x) && isFinite(row.y));
    }
    return raw[`${feat}_vs_${target}`] || [];
  }

  function _toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function _semKey(value) {
    return String(value ?? "").trim().replace(/-/g, "");
  }

  function _rowSemesterKey(row) {
    return _semKey(
      row?.semester ??
      row?.semester_key ??
      row?.term ??
      row?.academic_semester ??
      row?.academic_year_semester ??
      row?.year_semester
    );
  }

  function _rowScore(row) {
    const direct = _toNumber(
      row?.semester_score ??
      row?.grade_total ??
      row?.final_score ??
      row?.grade_final ??
      row?.midterm_score ??
      row?.grade_midterm
    );
    if (direct !== null) return direct;

    for (const target of _targets()) {
      const n = _toNumber(row?.[target]);
      if (n !== null) return n;
    }
    return null;
  }

  function _scoreScale(values) {
    const nums = values.filter(v => v !== null && Number.isFinite(v));
    if (!nums.length) return "100";
    const max = Math.max(...nums);
    if (max <= 1.01) return "ratio";
    if (max <= 10.1) return "10";
    return "100";
  }

  function _effectivePassThreshold(rows = _allScatterData) {
    const source = Array.isArray(rows) ? rows : _allScatterData;
    const scores = Array.isArray(source) ? source.map(_rowScore).filter(v => v !== null) : [];
    const scale = _scoreScale(scores);
    if (scale === "ratio") return 0.6;
    if (scale === "10") return 6;
    if (!scores.length || scores.some(v => v >= PASS_THRESHOLD_CORR)) return PASS_THRESHOLD_CORR;

    const sorted = [...scores].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5)));
    return Math.max(1, Math.min(50, sorted[idx]));
  }

  function _formatPassThreshold(threshold = _effectivePassThreshold()) {
    return _scoreScale([threshold]) === "ratio"
      ? `${Math.round(threshold * 100)}%`
      : `${Math.round(threshold * 10) / 10}`;
  }

  function _hasUsableCorrelation(data) {
    const pearson = data?.pearson || {};
    const hasR = Object.values(pearson).some(row => {
      if (row && typeof row === "object") {
        return Object.values(row).some(v => {
          // 相容新格式 {r, p, significant} 與舊格式 float
          const rVal = (v && typeof v === "object") ? v.r : v;
          return Number.isFinite(Number(rVal));
        });
      }
      return Number.isFinite(Number(row));
    });
    const scatter = data?.scatter_data || [];
    const hasScatter = Array.isArray(scatter)
      ? scatter.length > 0
      : Object.keys(scatter).length > 0;
    return hasR && hasScatter;
  }

  /**
   * 回傳 { r: number } 或 { r: null, reason: string, n?: number }
   * reason 值：
   *   "no_etl"       — ETL 預算值本身缺失（全量模式專用，由 _getR 注入）
   *   "insufficient" — 有效配對樣本數不足（< MIN_CORR_PAIRS）
   *   "no_variance"  — 所有人數值相同，變異數為 0
   */
  function _pearsonValue(rows, feat, target) {
    const pairs = rows
      .map(row => ({ x: _toNumber(row.features?.[feat]), y: _toNumber(row[target]) }))
      .filter(p => p.x !== null && p.y !== null);
    if (pairs.length < MIN_CORR_PAIRS) return { r: null, reason: "insufficient", n: pairs.length };
    const meanX = pairs.reduce((sum, p) => sum + p.x, 0) / pairs.length;
    const meanY = pairs.reduce((sum, p) => sum + p.y, 0) / pairs.length;
    let num = 0;
    let denX = 0;
    let denY = 0;
    pairs.forEach(p => {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    });
    const den = Math.sqrt(denX * denY);
    if (!den) return { r: null, reason: "no_variance", n: pairs.length };
    return { r: Math.round((num / den) * 10000) / 10000 };
  }

  // ── Spearman 等級相關係數 ─────────────────────────────────
  function _rankArray(arr) {
    const n = arr.length;
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && indexed[j].v === indexed[i].v) j++;
      const avg = (i + j + 1) / 2;
      for (let k = i; k < j; k++) ranks[indexed[k].i] = avg;
      i = j;
    }
    return ranks;
  }

  function _spearmanValue(rows, feat, target) {
    const pairs = rows
      .map(row => ({ x: _toNumber(row.features?.[feat]), y: _toNumber(row[target]) }))
      .filter(p => p.x !== null && p.y !== null);
    if (pairs.length < MIN_CORR_PAIRS) return { r: null, reason: "insufficient", n: pairs.length };
    const xs = pairs.map(p => p.x);
    const ys = pairs.map(p => p.y);
    const rx = _rankArray(xs), ry = _rankArray(ys);
    const n = rx.length;
    const mX = rx.reduce((s, v) => s + v, 0) / n;
    const mY = ry.reduce((s, v) => s + v, 0) / n;
    let num = 0, dX = 0, dY = 0;
    for (let i = 0; i < n; i++) {
      const dx = rx[i] - mX, dy = ry[i] - mY;
      num += dx * dy; dX += dx * dx; dY += dy * dy;
    }
    const den = Math.sqrt(dX * dY);
    if (!den) return { r: null, reason: "no_variance", n };
    return { r: Math.round(num / den * 10000) / 10000 };
  }

  // ── 初始化 ───────────────────────────────────────────────

  async function init(heatmapId = "corrHeatmap", scatterWrapperId = "scatterSection") {
    BehaviorLoader.setLoading("tab-correlation", true);
    try {
      // 同步載入 correlation + behavior（用於分群 join）
      const [corrRaw, behaviorData] = await Promise.all([
        BehaviorLoader.load.correlation(),
        BehaviorLoader.load.behavior().catch(() => null),
      ]);

      _corrData = corrRaw;
      _renderCorrExclusionNote();

      // 若 ETL 資料不完整（無 scatter 或無欄位）直接提示，不再前端重建
      if (!_hasUsableCorrelation(_corrData)) {
        BehaviorLoader.showError("tab-correlation", "correlation.json 資料不完整，請重跑 ETL 後重新整理頁面。");
        return;
      }

      // 建立 masked_id → behavior student 索引（取得 cluster）
        const bStudents = behaviorData?.students || [];
      const behaviorByAnon   = new Map(bStudents.map(s => [s.anon_id,   s]));
      const behaviorByMasked = new Map(bStudents.map(s => [s.masked_id, s]));

      // 備份全量並 join cluster 欄位
      const raw = _corrData?.scatter_data || [];
      _allScatterData = Array.isArray(raw)
        ? raw.map(row => {
            const behaviorRow = behaviorByAnon.get(row.anon_id) || behaviorByMasked.get(row.masked_id);
            return {
              ...row,
              cluster:  row.cluster  || behaviorRow?.cluster  || "",
              semester: row.semester || row.semester_key || row.term || row.academic_semester
                     || row.academic_year_semester || row.year_semester || behaviorRow?.semester || "",
            };
          })
        : raw;

      // 收集可用學期（從 meta）
      // UI-FIX-4：來源 meta.semesters 為 ETL 輸出的時間升冪排列，下拉選單須由近到遠，故 slice+sort+reverse
      _allSemesters = (Array.isArray(_corrData?.meta?.semesters)
        ? _corrData.meta.semesters
        : (behaviorData?.meta?.semesters || [])).slice().sort().reverse();
      // 未完成學期（已排除於全體相關性計算，供前端標示警告用）
      _incompleteSemesters = Array.isArray(_corrData?.meta?.incomplete_semesters)
        ? _corrData.meta.incomplete_semesters
        : [];

      _filterSemester = "all";
      _filterCluster  = "all";
      _filterPass     = "all";
      _filterOutlier  = false;
      _lastFilterKey  = null;
      _lastFiltered   = null;
      _lagFilteredRows = null;

        ChartRegistry.destroyById("laggedCorrBarChart");
      ChartRegistry.destroyById("laggedScatterMid");
      ChartRegistry.destroyById("laggedScatterFinal");
      const oldCanvas = document.getElementById("laggedCorrBarChart");
      if (oldCanvas) delete oldCanvas.__chartBuilt;

      _renderFilterBar(heatmapId);
      _setFilterControlsFromState();
      _applyFiltersAndRender(heatmapId, scatterWrapperId);
    } catch (err) {
      BehaviorLoader.showError("tab-correlation", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-correlation", false);
    }
  }

  // ── BUGFIX-C（0716 穿透式審查）：全體相關性計算說明卡片內容改為動態讀取
  //    correlation_matrix.json 的 meta.excluded_material_detail，取代先前寫死在
  //    index.html 的「AUD(114-2新增+35件)、VID(114-2新增+30件)」文字。
  //    此為 ETL CHANGELOG_v7.md §v7.10 交接事項：「前端後續可以改成動態讀取
  //    這個欄位組字串，取代 help-modal.js 第524行的寫死文案」，本輪落地實作。
  //    新資料（docs_0716）額外新增 total_learning_minutes 一項（閱讀誠信度
  //    清理方法調整導致的排除，current_delta 為 null，與 AUD/VID 的「新教材
  //    規模變動」是不同性質的排除原因，故分開判斷措辭，但仍在同一份清單內
  //    統一呈現，而非拆成兩張卡片。
  function _renderCorrExclusionNote() {
    const body = document.getElementById("corrInfoBody");
    if (!body) return;

    const CATEGORY_LABELS = { AUD: "AUD", VID: "VID", total_learning_minutes: "總學習時間" };
    const details = Array.isArray(_corrData?.meta?.excluded_material_detail)
      ? _corrData.meta.excluded_material_detail
      : [];

    const introHTML =
      "系統自動偵測各教材類別的跨學期新增量是否出現規模性變動" +
      "（條件：當期增量 &gt; 歷史最大單期增量 × 2 倍，且絕對新增件數 ≥ 10 件），" +
      "或該指標計算方法於本學期調整。觸發條件的類別特徵將從「全體」Pearson 計算中排除，" +
      "以避免新教材大量導入或計算方法變動造成舊學期資料偏低的比較偏差。<br>";

    if (!details.length) {
      body.innerHTML = introHTML + "目前排除類別：<strong>無</strong>。";
      return;
    }

    const items = details.map(d => {
      const label = CATEGORY_LABELS[d.category] || String(d.category ?? "");
      const sem = _formatSemLabel(d.current_semester);
      if (d.current_delta !== null && d.current_delta !== undefined) {
        // AUD/VID 類：新教材規模變動，delta 為新增件數
        return `<strong>${label}</strong>（${sem} 新增 +${d.current_delta} 件）`;
      }
      // total_learning_minutes 類：非新增件數變動，而是計算方法（閱讀誠信度裁切）調整
      return `<strong>${label}</strong>（${sem} 起改採閱讀誠信度裁切後淨值計算，計算方法變動）`;
    });

    body.innerHTML =
      introHTML +
      `目前排除類別：${items.join("、")}。<br>` +
      "各學期<strong>單獨</strong>選擇時不受影響，仍可正常顯示相關係數。";
  }

  // ── 篩選列 ───────────────────────────────────────────────

  function _formatSemLabel(sem) {
    const s = String(sem || "").trim();
    const m = s.match(/^(\d{3})-?([12])$/);
    return m ? `${m[1]}(${m[2]})` : s;
  }

  const CLUSTER_NAMES_CORR = {
    R1: "影音輔導型", R2: "彈性聽覺型", R3: "平均使用型",
    R4: "題庫刷題型", R5: "被動低參與型",
  };

  function _renderFilterBar(insertBeforeId) {
    const anchor = document.getElementById(insertBeforeId);
    if (!anchor) return;

    // 避免重複插入
    const existing = document.getElementById("corrFilterBar");
    if (existing) { existing.remove(); }

    const semOptions = [
      `<option value="all">全部學期（已排除未完成學期）</option>`,
      ..._allSemesters.map(s => {
        const isIncomplete = _incompleteSemesters.includes(String(s));
        const label = isIncomplete
          ? `${_formatSemLabel(s)} ⚠️ 預警用（學末成績未出）`
          : _formatSemLabel(s);
        return `<option value="${s}">${label}</option>`;
      }),
    ].join("");

    const _clCounts = {};
    if (Array.isArray(_allScatterData)) {
      _allScatterData.forEach(r => {
        const c = r.cluster || "";
        if (c) _clCounts[c] = (_clCounts[c] || 0) + 1;
      });
    }
    const clusterOptions = [
      `<option value="all">全部資源使用（${Array.isArray(_allScatterData) ? _allScatterData.length : "—"}）</option>`,
      ...Object.entries(CLUSTER_NAMES_CORR).map(([k, n]) => {
        const cnt = _clCounts[k] || 0;
        const dis = cnt === 0 ? " disabled" : "";
        return `<option value="${k}"${dis}>${k} ${n}${cnt > 0 ? "（" + cnt + "）" : "（無資料）"}</option>`;
      }),
    ].join("");

    const passCutoff = _formatPassThreshold();
    const passOptions = [
      `<option value="all">全部</option>`,
      `<option value="pass">達標（≥ ${passCutoff}）</option>`,
      `<option value="fail">未達標（< ${passCutoff}）</option>`,
    ].join("");

    const hasOutlierData = Object.keys(_corrData?.outlier_thresholds || {}).length > 0;

    _injectFilterBarStyle();

    const bar = document.createElement("div");
    bar.id = "corrFilterBar";
    bar.className = "ladash-c-filter-bar";
    bar.innerHTML = `
      <span class="ladash-c-sm8-bold-nw">篩選條件</span>
      <label class="ladash-c-flex5">學期
        <select id="corrSemFilter"
                class="ladash-c-filter-sel">
          ${semOptions}
        </select>
      </label>
      <label class="ladash-c-flex5">資源使用
        <select id="corrClusterFilter"
                class="ladash-c-filter-sel">
          ${clusterOptions}
        </select>
      </label>
      <label class="ladash-c-flex5">及格狀況
        <select id="corrPassFilter"
                class="ladash-c-filter-sel">
          ${passOptions}
        </select>
      </label>
      ${hasOutlierData ? `
      <label class="ladash-c-flex5 ladash-c-sm78-nw-ptr" for="corrOutlierToggle">
        <input type="checkbox" id="corrOutlierToggle"
               class="ladash-c-mr4-ptr">
        排除異常值
      </label>` : ""}
      <span id="corrFilterCount" class="ladash-c-xs76-dim"></span>
      <span class="ladash-c-ml-auto-flex">
        <span class="ladash-c-xs76-dim">方法</span>
        <button id="btnCorrPearson" data-corr-type="pearson">Pearson <i>r</i></button>
        <button id="btnCorrSpearman" data-corr-type="spearman">Spearman <i>ρ</i></button>
      </span>`;

    anchor.parentNode.insertBefore(bar, anchor);
    _bindFilterBar(bar);
    _updateCorrTypeButtons();
  }

  // ── 文件層級 change 委派（只綁一次，解決 DOM 重組後事件失效）────
  let _filterDelegateAttached = false;
  function _ensureFilterDelegate() {
    if (_filterDelegateAttached) return;
    _filterDelegateAttached = true;
    document.addEventListener("change", e => {
      const id = e.target?.id;
      if (["corrSemFilter", "corrClusterFilter", "corrPassFilter", "corrOutlierToggle"].includes(id)) {
        onFilterChange();   // 無參數：走 DOM 讀取路徑
      }
    });
  }

  function _bindFilterBar(bar) {
    _ensureFilterDelegate();   // 改用文件委派，不再直接綁 select
    bar.querySelectorAll("[data-corr-type]").forEach(btn => {
      btn.addEventListener("click", () => setCorrType(btn.dataset.corrType));
    });
  }

  function _setFilterControlsFromState() {
    const semEl     = document.getElementById("corrSemFilter");
    const clusterEl = document.getElementById("corrClusterFilter");
    const passEl    = document.getElementById("corrPassFilter");
    const outlierEl = document.getElementById("corrOutlierToggle");
    if (semEl)     semEl.value     = _filterSemester;
    if (clusterEl) clusterEl.value = _filterCluster;
    if (passEl)    passEl.value    = _filterPass;
    if (outlierEl) outlierEl.checked = _filterOutlier;
  }

  function _updateCorrTypeButtons() {
    const btnP = document.getElementById("btnCorrPearson");
    const btnS = document.getElementById("btnCorrSpearman");
    if (!btnP || !btnS) return;
    const ip = _corrType === "pearson";
    const ac = "var(--accent,#3498db)";
    // Static layout classes on element; only dynamic state values set here
    btnP.style.setProperty("background", ip ? ac : "transparent");
    btnP.style.setProperty("color", ip ? "#fff" : ac);
    btnP.style.setProperty("font-weight", ip ? "700" : "400");
    btnS.style.setProperty("background", ip ? "transparent" : ac);
    btnS.style.setProperty("color", ip ? ac : "#fff");
    btnS.style.setProperty("font-weight", ip ? "400" : "700");
  }

  function setCorrType(type) {
    _corrType = type;
    _lastFilterKey = null;   // 強制清快取，確保重新過濾
    _updateCorrTypeButtons();
    _applyFiltersAndRender("corrHeatmap", "scatterSection");
  }

  /**
   * 篩選狀態變更入口。
   *   無參數：從 DOM select 讀取最新值（內部 change 事件觸發）。
   *   overrides 物件：{ semester?, cluster?, pass?, outlier? }，
   *     外部 main.js 直接傳入，防止 DOM 值未同步導致篩選無效。
   *   注意：instanceof Event 守衛防止 DOM Event 物件被誤判為 overrides。
   */
  function onFilterChange(overrides) {
    if (overrides && typeof overrides === "object" && !(overrides instanceof Event)) {
      // 外部 main.js 直接傳入覆蓋物件
      if ("semester" in overrides) _filterSemester = overrides.semester ?? "all";
      if ("cluster"  in overrides) _filterCluster  = overrides.cluster  ?? "all";
      if ("pass"     in overrides) _filterPass     = overrides.pass     ?? "all";
      if ("outlier"  in overrides) _filterOutlier  = !!overrides.outlier;
      _setFilterControlsFromState();
    } else {
      // DOM change 事件或無參數呼叫：從 select 讀取最新值
      _filterSemester = document.getElementById("corrSemFilter")?.value     || "all";
      _filterCluster  = document.getElementById("corrClusterFilter")?.value  || "all";
      _filterPass     = document.getElementById("corrPassFilter")?.value     || "all";
      _filterOutlier  = document.getElementById("corrOutlierToggle")?.checked ?? false;
    }
    _lastFilterKey  = null;
    _lastFiltered   = null;
    _applyFiltersAndRender("corrHeatmap", "scatterSection");
  }

  function resetFilters() {
    _filterSemester = "all";
    _filterCluster  = "all";
    _filterPass     = "all";
    _filterOutlier  = false;
    _lastFilterKey  = null;
    _lastFiltered   = null;

    // UI-LAG-RESET FIX(0809)：「清除條件」應讓時間滯後相關性的散佈圖區塊
    // 回到「尚未點擊任何長條」的預設狀態，而非沿用 _autoRefreshLaggedScatter()
    // 既有的「保留目前展開的 feature、僅刷新底層資料」邏輯——那是為一般篩選
    // 微調情境設計的（使用者仍在細看同一指標時，理應保留視圖、更新資料）；
    // 但點擊「清除條件」的心智模型是「全部重來」，即使資料已刷新，殘留一張
    // 散佈圖仍可能被誤讀為「這組篩選下本來就會顯示這張圖」。在呼叫
    // _applyFiltersAndRender() 之前先清空區塊並銷毀圖表實例，
    // _autoRefreshLaggedScatter() 既有「未展開則不處理」的守衛
    // （!section.innerHTML.trim() 時 return）會自然維持清空狀態，
    // 不需要另外修改該函式本身的邏輯。
    ChartRegistry.destroyById("laggedScatterMid");
    ChartRegistry.destroyById("laggedScatterFinal");
    const laggedSection = document.getElementById("laggedScatterSection");
    if (laggedSection) laggedSection.innerHTML = "";

    _setFilterControlsFromState();
    _applyFiltersAndRender("corrHeatmap", "scatterSection");
  }

  // ── 篩選快取：條件未變時不重新過濾 ─────────────────────────
  // （宣告已移至模組頂部狀態區，此處刪除重複宣告）
  function _filteredScatterData() {
    const key = `${_filterSemester}|${_filterCluster}|${_filterPass}|${_filterOutlier}`;
    if (key === _lastFilterKey && _lastFiltered !== null) return _lastFiltered;

    const raw = _allScatterData;
    if (!Array.isArray(raw)) { _lastFilterKey = key; _lastFiltered = raw; return raw; }

    const thresholds = _corrData?.outlier_thresholds || {};
    // PERF-FIX (2026-07-28)：_effectivePassThreshold(raw) 只取決於 raw（整個未篩選
    // 陣列），對每一列而言都是同一個值，但原本寫在 .filter() 逐列回呼內，每列都
    // 重新呼叫一次——對 raw 做一次 O(n) 運算（map+filter+視情況排序）卻執行 n 次，
    // 形同 O(n²)。提到迴圈外算一次即可，_filterPass==="all" 時完全不受影響
    // （沿用原本的短路邏輯，不呼叫）。行為不變，純屬迴圈不變量外提。
    const _passThreshold = _filterPass !== "all" ? _effectivePassThreshold(raw) : null;
    _lastFiltered = raw.filter(row => {
      if (_filterSemester !== "all") {
        const rowSem = _rowSemesterKey(row);
        const selSem = _semKey(_filterSemester);
        if (!rowSem || rowSem !== selSem) return false;
      }
      if (_filterCluster !== "all") {
        if ((row.cluster || "") !== _filterCluster) return false;
      }
      if (_filterPass !== "all") {
        const score = _rowScore(row);
        if (score === null) return false;
        const passing = score >= _passThreshold;
        if (_filterPass === "pass" && !passing) return false;
        if (_filterPass === "fail" && passing) return false;
      }
      if (_filterOutlier && Object.keys(thresholds).length) {
        for (const [feat, bounds] of Object.entries(thresholds)) {
          const val = _toNumber(row.features?.[feat]);
          if (val === null) continue;
          if (val < bounds.iqr_lower || val > bounds.iqr_upper) return false;
        }
      }
      return true;
    });
    _lastFilterKey = key;
    return _lastFiltered;
  }

  function _ensureCardLayout(heatmapId, scatterWrapperId) {
    const heatmapEl = document.getElementById(heatmapId);
    const scatterEl = document.getElementById(scatterWrapperId);
    if (!heatmapEl || !scatterEl) return;
    if (document.getElementById("corrCardGrid")) return;

    const parent = heatmapEl.parentNode;
    const cardCss = [
      "background:var(--card-bg,#fff)",
      "border:1px solid var(--border,#d5dbea)",
      "border-radius:12px",
      "padding:16px",
      "display:flex",
      "flex-direction:column",
      "gap:10px",
      "min-width:0",
    ].join(";");

    const grid = document.createElement("div");
    grid.id = "corrCardGrid";
    grid.className = "ladash-c-corr-card-grid";

    const card1 = document.createElement("div");
    card1.className = "chart-card ladash-c-corr-inner-card";
    card1.innerHTML = `
      <h6 class="ladash-c-card-title-flex">
        資源使用 vs. 成績相關性
        <span class="ladash-c-sm-dim2">
          Pearson / Spearman 相關係數矩陣
        </span>
      </h6>
      <div id="corrInsightsBadgeSlot"></div>
      <div id="${heatmapId}_inner"></div>`;

    const card2 = document.createElement("div");
    card2.className = "chart-card ladash-c-corr-inner-card";
    card2.innerHTML = `
      <h6 class="ladash-c-card-title">
        散佈圖
      </h6>
      <div id="${scatterWrapperId}_inner"></div>`;

    grid.appendChild(card1);
    grid.appendChild(card2);
    parent.insertBefore(grid, heatmapEl);

    const heatmapInner = document.getElementById(`${heatmapId}_inner`);
    const scatterInner = document.getElementById(`${scatterWrapperId}_inner`);
    if (heatmapInner) heatmapInner.appendChild(heatmapEl);
    if (scatterInner) scatterInner.appendChild(scatterEl);

    // CSP-CORR-CSS: inject static CSS classes for correlation module
  const _CORR_STYLE_ID = "__ladash-corr-style";
  (function _injectCorrStyle() {
    if (document.getElementById(_CORR_STYLE_ID)) return;
    const CSS = ".ladash-corr-grad-bar{width:200px;height:16px;border-radius:4px}.ladash-reason-swatch{border-radius:3px;padding:1px 5px;font-size:.8em}.ladash-sig-sup{font-size:.65em;opacity:.9}";
    const sentinel = document.createElement("meta");
    sentinel.id = _CORR_STYLE_ID;
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) { /* fallback */ }
    }
    const el = document.createElement("style");
    el.id = _CORR_STYLE_ID;
    const nonce = _CSP_NONCE;
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = CSS;
    document.head.appendChild(el);
  })();

  // CSP-CORR-STATIC FIX: all static style= extracted to CSS classes
  const _CORR_STATIC_STYLE_ID = "__ladash-corr-static-style";
  (function _injectCorrStaticStyle() {
    if (document.getElementById(_CORR_STATIC_STYLE_ID)) return;
    const CSS = `    .ladash-c-accent3{color:var(--accent3,#f7a44f)}
    .ladash-c-dim-aaa{color:var(--text-dim,#aaa);font-size:.72rem}
    .ladash-c-help{cursor:help}
    .ladash-c-ptr{cursor:pointer}
    .ladash-c-flex5{display:flex;align-items:center;gap:5px}
    .ladash-c-flex6{display:flex;align-items:center;gap:6px}
    .ladash-c-flex8-ptr{display:flex;align-items:center;gap:8px;cursor:pointer}
    .ladash-c-flex8-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
    .ladash-c-grad-labels{display:flex;justify-content:space-between;margin-top:2px;width:200px}
    .ladash-c-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}
    .ladash-c-iflex4{display:inline-flex;align-items:center;gap:4px}
    .ladash-c-xs-dim{font-size:.68rem;color:var(--text-dim,#888)}
    .ladash-c-xxs-dim{font-size:.70rem;color:var(--text-dim,#aaa)}
    .ladash-c-xs72-dim{font-size:.72rem;color:var(--text-dim,#888)}
    .ladash-c-sm-accent3{font-size:.75rem;color:var(--accent3,#f7a44f)}
    .ladash-c-sm-dim{font-size:.75rem;color:var(--text-dim,#888)}
    .ladash-c-sm-dim-lh{font-size:.75rem;color:var(--text-dim,#888);line-height:1.7}
    .ladash-c-sm-dim2{font-size:.75rem;font-weight:400;color:var(--text-dim,#667085)}
    .ladash-c-xs76-dim{font-size:.76rem;color:var(--text-dim,#888)}
    .ladash-c-xs76-bold{font-size:.76rem;font-weight:600;color:var(--text,#172033);margin-bottom:4px}
    .ladash-c-sm78-pad{font-size:.78rem;color:var(--text-dim,#888);padding:8px}
    .ladash-c-sm78-nw{font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap}
    .ladash-c-sm78-nw-ptr{font-size:.78rem;color:var(--text-dim,#888);white-space:nowrap;cursor:pointer}
    .ladash-c-sm78-accent-bold{font-size:.78rem;font-weight:700;color:var(--accent,#3498db)}
    .ladash-c-page-btn{font-size:.8rem;color:var(--text-dim,#888);user-select:none;min-width:20px;text-align:center}
    .ladash-c-sm8-bold-nw{font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap}
    .ladash-c-sm85{font-size:0.85rem}
    .ladash-c-fw6-ccc{font-weight:600;color:var(--text,#ccc)}
    .ladash-c-ml8-accent3{margin-left:8px;font-size:.78em;color:var(--accent3,#f7a44f)}
    .ladash-c-ml8-op75{margin-left:8px;font-size:.78em;opacity:.75}
    .ladash-c-ml-auto-flex{margin-left:auto;display:inline-flex;align-items:center;gap:5px}
    .ladash-c-mr4-ptr{margin-right:4px;cursor:pointer}
    .ladash-c-mt10{margin-top:10px}
    .ladash-c-legend-row{margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
    .ladash-c-mt6-sm-dim{margin-top:6px;font-size:.75rem;color:var(--text-dim,#888)}
    .ladash-c-mt8-tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-size:.75rem;color:var(--text-dim,#888)}
    .ladash-c-card-title{margin:0;font-size:.92rem;font-weight:700;color:var(--text,#172033)}
    .ladash-c-mw90{min-width:90px}
    .ladash-c-op65-xs{opacity:.65;font-size:.75em}
    .ladash-c-op7{opacity:.7}
    .ladash-c-empty-msg{padding:12px;font-size:.82rem;color:var(--text-dim,#888)}
    .ladash-c-warn-box{padding:14px;background:rgba(230,126,34,.08);border:1px solid rgba(230,126,34,.3);border-radius:8px;font-size:.82rem;color:var(--accent3,#a04000)}
    .ladash-c-chart260{position:relative;height:260px}
    .ladash-c-chart320{position:relative;height:320px;width:100%}
    .ladash-c-chart340{position:relative;height:340px;width:100%}
    .ladash-c-grad-bar-wrap{position:relative;width:200px;height:16px;border-radius:4px;overflow:visible}
    .ladash-c-filter-sel{font-size:.8rem;padding:3px 7px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer}
    .ladash-c-mt8-tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;font-size:.75rem;color:var(--text-dim,#999)}`;
    const sentinel = document.createElement("meta");
    sentinel.id = _CORR_STATIC_STYLE_ID;
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
    el.id = _CORR_STATIC_STYLE_ID;
    const nonce = _CSP_NONCE;
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = CSS;
    document.head.appendChild(el);
  })();

  // BUG-CSP-A FIX: 改用 adoptedStyleSheets（CSP 合規），nonce fallback 供不支援環境
    const styleId = "corrCardGridStyle";
    if (!document.getElementById(styleId)) {
      const CSS = "@media(max-width:900px){#corrCardGrid{grid-template-columns:1fr!important}#corrCardGrid>.chart-card{grid-column:auto!important}}";
      const sentinel = document.createElement("meta");
      sentinel.id = styleId;
      if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(CSS);
          document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
          sentinel.setAttribute("data-csp-adopted", "1");
          document.head.appendChild(sentinel);
        } catch (_) {
          const el = document.createElement("style");
          el.id = styleId;
          const nonce = _CSP_NONCE;
          if (nonce) el.setAttribute("nonce", nonce);
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      } else {
        const el = document.createElement("style");
        el.id = styleId;
        const nonce = _CSP_NONCE;
        if (nonce) el.setAttribute("nonce", nonce);
        el.textContent = CSS;
        document.head.appendChild(el);
      }
    }

    // ── Card 3：時間滯後相關性（lagged_pearson）─────────────
    if (!document.getElementById("laggedCorrCard")) {
      const card3 = document.createElement("div");
      card3.id = "laggedCorrCard";
      card3.className = "chart-card";
      card3.className = "chart-card ladash-c-corr-card3";

      // 可收放標題列
      card3.innerHTML = `
        <div class="ladash-c-flex8-ptr" id="laggedCorrToggleRow">
          <h6 class="ladash-c-card-title-flex ladash-c-flex1">
            ⏱ 時間滯後相關性
            <span class="ladash-c-sm-dim2">
              期初行為 × 期中成績 vs 期末行為 × 期末成績預測力比較
            </span>
          </h6>
          <span id="laggedCorrCollapseIcon"
                class="ladash-c-page-btn">▼</span>
        </div>
        <div id="laggedCorrBody">
          <div class="ladash-c-corr-lag-note">
            ⚠ <strong>r 值為全體學生統計（n 見括號），散佈圖依前端篩選條件顯示子集。</strong><br>
            🔵 <strong>期初行為</strong> × 期中成績　　🟠 <strong>期末行為</strong> × 期末成績<br>
            ▲▼ 箭頭代表同指標從期初到期末的 <code>lag_delta</code>（預測力變化量）<br>
            <span class="ladash-c-dim-aaa">⚙ 此版本採整學期特徵（非逐週切分），週次標示僅供參考</span>
          </div>
          <div id="laggedCorrChartWrap" class="ladash-c-chart340">
            <canvas id="laggedCorrBarChart"></canvas>
          </div>
          <div class="ladash-c-mt6-sm-dim">
            點擊長條可查看對應滯後散佈圖 ↓
          </div>
          <div id="laggedScatterSection" class="ladash-c-mt10"></div>
        </div>`;

      // 插入 grid 之後
      const gridEl = document.getElementById("corrCardGrid");
      if (gridEl && gridEl.parentNode) {
        gridEl.parentNode.insertBefore(card3, gridEl.nextSibling);
      } else {
        parent.appendChild(card3);
      }

      // 收放邏輯
      document.getElementById("laggedCorrToggleRow")?.addEventListener("click", () => {
        const body = document.getElementById("laggedCorrBody");
        const icon = document.getElementById("laggedCorrCollapseIcon");
        if (!body) return;
        const open = body.style.display !== "none";
        body.style.setProperty('display', open ? 'none' : ''); // CSP-V5-FIX
        if (icon) icon.textContent = open ? "▶" : "▼";
      });
    }
  }

  function _applyFiltersAndRender(heatmapId, scatterWrapperId) {
    _ensureCardLayout(heatmapId, scatterWrapperId);

    const filtered = _filteredScatterData();
    const count = Array.isArray(filtered) ? filtered.length : "—";
    const countEl = document.getElementById("corrFilterCount");
    if (countEl) {
      const cutoffNote = _filterPass !== "all"
        ? `，cut-off ${_formatPassThreshold(_effectivePassThreshold())}`
        : "";
      countEl.textContent = `共 ${count} 筆${cutoffNote}`;
    }

    // 未完成學期警告 banner
    const bannerElId = "corrIncompleteBanner";
    let bannerEl = document.getElementById(bannerElId);
    const isIncompleteSem = _filterSemester !== "all"
      && _incompleteSemesters.includes(String(_filterSemester));
    if (isIncompleteSem) {
      if (!bannerEl) {
        bannerEl = document.createElement("div");
        bannerEl.id = bannerElId;
        bannerEl.className = "ladash-c-corr-warn-banner";
      }
      const semLabel = _formatSemLabel(_filterSemester);
      bannerEl.innerHTML =
        `⚠️ <strong>${semLabel} 學期</strong>：學末成績尚未公布，此學期已排除於全體相關性計算。` +
        `目前顯示的是<strong>期中成績</strong>相關性，僅供預警參考，不代表最終結果。` +
        ((_corrData?.meta?.incomplete_semesters_note)
          ? `` : ``);
      const anchor = document.getElementById(heatmapId)?.closest(".chart-card");
      if (anchor && !document.getElementById(bannerElId)) anchor.prepend(bannerEl);
    } else if (bannerEl) {
      bannerEl.remove();
    }

    // 全體模式時若有排除學期，顯示提示
    const globalNoteId = "corrGlobalExcludeNote";
    let globalNoteEl = document.getElementById(globalNoteId);
    if (_filterSemester === "all" && _incompleteSemesters.length > 0) {
      if (!globalNoteEl) {
        globalNoteEl = document.createElement("div");
        globalNoteEl.id = globalNoteId;
        globalNoteEl.className = "ladash-c-corr-global-note";
      }
      globalNoteEl.textContent =
        `ℹ️ 全體相關性已排除尚未獲得學末成績的學期：` +
        _incompleteSemesters.map(_formatSemLabel).join("、") +
        `。如需查看，請於上方篩選選擇該學期。`;
      const anchor = document.getElementById(heatmapId)?.closest(".chart-card");
      if (anchor && !document.getElementById(globalNoteId)) anchor.prepend(globalNoteEl);
    } else if (globalNoteEl) {
      globalNoteEl.remove();
    }

    _renderInsightsBadge(heatmapId, filtered);
    _renderHeatmap(heatmapId, filtered);
    _renderScatterSelector(scatterWrapperId, filtered);
    _renderLaggedCorr(filtered);
  }

  // ── Pearson 熱力圖（HTML table + 色彩映射）────────────────
  function _renderHeatmap(containerId, filteredRows) {
    const el = document.getElementById(containerId);
    if (!el || !_corrData) return;

    const features   = _features();
    const grades     = _targets();
    const isSpearman = _corrType === "spearman";
    const corrSym    = isSpearman ? "ρ" : "r";

    // 判斷是否為「全量」模式：篩選狀態全為 all 且無排除異常值
    const isUnfiltered = _isUnfiltered();

    if (!features.length || !grades.length) {
      el.innerHTML = `<p class="text-muted small">相關性資料格式缺少 features / targets。</p>`;
      return;
    }

    /**
     * 取得 r 值：
     *   全量模式 → 優先讀 ETL 預算值（精確且含 p-value）
     *   篩選模式 → 即時重算（_pearsonValue / _spearmanValue）
     */
    // Phase D：segData 僅在未排除異常值時可用（ETL 無 eduType / outlier 維度預聚合）
    const segKey  = _segKey();
    const segData = _canUseSeg() ? (_corrData?.segment_pearson?.[segKey] ?? null) : null;

    /**
     * BUG-CORR-3：排除 Δ規模 觸發學期後，其餘學期並非「無法計算」，
     * 應該還是能合理算出相關性──只是不能把觸發規模變動的那個學期也
     * 一起併入全量計算。這裡在「全量」模式下，對被排除的欄位嘗試用
     * 「扣掉觸發學期後的其餘學期」重新計算一次真實 r 值，取代直接顯示
     * Δ規模 診斷符號。
     *
     * 需要 ETL 在 correlation_matrix.json 的 meta 裡提供
     * `excluded_material_detail`（見交接文件 v3 第4節已設計、尚未套用的
     * compute_material_outlier_cats(return_detail=True) 擴充）：
     *   meta.excluded_material_detail = [
     *     { category, feature_cols: [...], current_semester, ... }, ...
     *   ]
     * 在 ETL 補上這個欄位之前，這裡會直接回傳 null，維持現行「顯示
     * Δ規模」的行為不受影響、不會壞；ETL 補上後前端不需要再改一次，
     * 會自動切換成顯示重算後的真實數值。
     */
    function _recomputeExcludingTrigger(feat, g) {
      const detailList = _corrData?.meta?.excluded_material_detail;
      if (!Array.isArray(detailList) || !Array.isArray(_allScatterData)) return null;
      const entry = detailList.find(d =>
        Array.isArray(d?.feature_cols) && d.feature_cols.includes(feat) && d.current_semester
      );
      if (!entry) return null;
      const excludeSem = String(entry.current_semester);
      const rows = _allScatterData.filter(row => String(row?.semester) !== excludeSem);
      if (!rows.length) return null;
      const result = isSpearman ? _spearmanValue(rows, feat, g) : _pearsonValue(rows, feat, g);
      if (result?.r == null) return null;
      return { r: result.r, recomputed: true, excludedSemester: excludeSem, n: rows.length };
    }

    function _getR(feat, g) {
      if (isUnfiltered) {
        // 全量：讀 ETL 預算值（含 reason，如 excluded_new_material）
        const raw = _corrData?.pearson?.[feat]?.[g] ?? _corrData?.pearson?.[g]?.[feat] ?? null;
        if (raw !== null && typeof raw === "object") {
          const r = raw.r ?? null;
          if (r == null) {
            const reason = raw.reason ?? "no_etl";
            if (reason === "excluded_new_material" || reason === "scale_change") {
              const recomputed = _recomputeExcludingTrigger(feat, g);
              if (recomputed) return recomputed;
            }
            return { r: null, reason, n: raw.n ?? null };
          }
          return { r };
        }
        const r = _pearson(feat, g);
        if (r == null) return { r: null, reason: "no_etl" };
        return { r };
      }
      // Phase D：篩選模式，優先讀 segment_pearson 預聚合
      if (segData?.pearson) {
        const rObj = segData.pearson[g]?.[feat] ?? segData.pearson[feat]?.[g];
        if (rObj != null) {
          const r = typeof rObj === "object" ? (rObj.r ?? null) : rObj;
          if (r == null) return { r: null, reason: "no_etl" };
          return { r };
        }
      }
      // fallback：即時重算（回傳完整診斷物件）
      const rows = Array.isArray(filteredRows) ? filteredRows : (_lastFiltered ?? _allScatterData ?? []);
      return isSpearman
        ? _spearmanValue(rows, feat, g)
        : _pearsonValue(rows, feat, g);
    }

    // 篩選後資料列數（用於 tooltip n=N 顯示）
    const nCount = Array.isArray(filteredRows) ? filteredRows.length
                 : Array.isArray(_allScatterData) ? _allScatterData.length
                 : null;

    const gradeHeaderCells = grades.map(g =>
      `<th class="text-center small fw-normal ladash-c-mw90">
        ${escapeHtml(GRADE_LABELS[g] || g)}
      </th>`
    ).join("");

    const rows = features.map(feat => {
      const cells = grades.map(g => {
        const result = _getR(feat, g);
        const r      = result.r;

        // ── r 值無效：依 reason 顯示診斷符號與 tooltip ──────
        if (r == null) {
          const reason = result?.reason ?? "no_etl";
          const nHint  = (result?.n != null) ? `（有效樣本 ${result.n} 筆）` : "";
          const cfg    = REASON_CONFIG[REASON_ALIAS[reason] ?? reason] ?? REASON_CONFIG.no_etl;
          const detail = cfg.detail.replace("{nHint}", nHint);
          const featLabel  = escapeHtml(FEAT_LABELS[feat] || feat);
          const gradeLabel = escapeHtml(GRADE_LABELS[g] || g);
          const tipText    = `${featLabel} vs ${gradeLabel}：${cfg.label}｜${detail}`;

          return `<td class="text-center small ${cfg.txtCls} ladash-corr-cell ladash-c-help"
                      data-corr-bg="${cfg.color}" data-corr-bd="${cfg.border}"
                      title="${escapeHtml(tipText)}">
                    <span class="ladash-corr-err-sym">${cfg.symbol}</span>
                  </td>`;
        }

        // ── 全量模式下，Δ規模 觸發學期已排除、以其餘學期重算出的真實值 ──
        if (result?.recomputed) {
          const rr         = result.r;
          const bg2        = _rToColor(rr);
          const textColor2 = Math.abs(rr) > 0.55 ? "#fff" : "var(--text,#dde3f5)";
          const featLabel  = escapeHtml(FEAT_LABELS[feat] || feat);
          const gradeLabel = escapeHtml(GRADE_LABELS[g] || g);
          const tip = `${featLabel} vs ${gradeLabel}：${corrSym}=${rr >= 0 ? "+" : ""}${rr.toFixed(3)}`
                    + `（已排除 ${result.excludedSemester}，以其餘學期共 ${result.n} 筆資料重新計算；`
                    + `${result.excludedSemester} 本身仍可切換至單一學期檢視）`;
          return `<td class="text-center small ladash-corr-cell ladash-c-ptr"
                      data-corr-feat="${escapeHtml(feat)}" data-corr-target="${escapeHtml(g)}"
                      data-corr-bg="${bg2}" data-corr-tc="${textColor2}"
                      title="${escapeHtml(tip)}">
                    ${corrSym}${rr >= 0 ? "+" : ""}${rr.toFixed(2)}<sup class="ladash-sig-sup">†</sup>
                  </td>`;
        }

        // ── r 值正常 ─────────────────────────────────────────
        const bg        = _rToColor(r);
        const textColor = Math.abs(r) > 0.55 ? "#fff" : "var(--text,#dde3f5)";

        // 全量時顯示 ETL p-value 顯著性標記；篩選後改顯示 n=N（p 值不可靠）
        let sig = "";
        let tipExtra = "";
        if (isUnfiltered && _corrType === "pearson") {
          const p = _pearsonP(feat, g);
          if (p !== null) {
            sig = p < 0.01 ? "**" : p < 0.05 ? "*" : "";
            tipExtra = p < 1e-6 ? " p<0.000001" : ` p=${p.toFixed(4)}`;
          }
        } else if (!isUnfiltered && nCount !== null) {
          tipExtra = ` n=${nCount}`;
        }

        return `<td class="text-center small ladash-corr-cell ladash-c-ptr"
                    data-corr-feat="${escapeHtml(feat)}" data-corr-target="${escapeHtml(g)}"
                    data-corr-bg="${bg}" data-corr-tc="${textColor}"
                    title="${escapeHtml(FEAT_LABELS[feat] || feat)} vs ${escapeHtml(GRADE_LABELS[g] || g)}: ${corrSym}=${r >= 0 ? "+" : ""}${r.toFixed(3)}${tipExtra}">
                  ${corrSym}${r >= 0 ? "+" : ""}${r.toFixed(2)}${sig ? `<sup class="ladash-sig-sup">${sig}</sup>` : ""}
                </td>`;
      }).join("");
      return `<tr>
        <td class="small text-nowrap pe-2">${escapeHtml(FEAT_LABELS[feat] || feat)}</td>
        ${cells}
      </tr>`;
    }).join("");

    const isPrecomputed = !isUnfiltered && segData?.pearson != null;
    const isLowConf     = isPrecomputed && segData?.low_confidence === true;
    const filteredNote = !isUnfiltered
      ? isPrecomputed
        ? `<span class="ladash-c-ml8-accent3">⚑ 已篩選子集（n=${segData.student_count}）預聚合${isLowConf ? "　⚠️ 樣本數較少，r 值僅供參考" : ""}</span>`
        : `<span class="ladash-c-ml8-accent3">⚑ 已篩選子集（n=${nCount}）即時重算</span>`
      : (!isSpearman ? `<span class="ladash-c-ml8-op75">* p&lt;0.05　** p&lt;0.01</span>` : "");

    el.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-bordered mb-1 ladash-c-sm85">
          <thead>
            <tr>
              <th class="text-muted fw-normal">學習行為指標</th>
              ${gradeHeaderCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="ladash-c-legend-row">
        <span class="text-muted small">點擊儲存格查看散佈圖（${isSpearman ? "Spearman ρ" : "Pearson r"}）</span>
        <div class="ladash-c-flex6">
          <span class="ladash-c-sm-dim">負相關</span>
          <div class="ladash-c-grad-bar-wrap">
            <div id="corrGradBar" class="ladash-corr-grad-bar"></div>
            <div class="ladash-c-grad-labels">
              <span class="ladash-c-xs-dim">−1.0</span>
              <span class="ladash-c-xs-dim">−0.3</span>
              <span class="ladash-c-xs-dim">0</span>
              <span class="ladash-c-xs-dim">+0.3</span>
              <span class="ladash-c-xs-dim">+1.0</span>
            </div>
          </div>
          <span class="ladash-c-sm-dim">正相關</span>
        </div>
        <span class="ladash-c-sm-accent3">|r| ≥ 0.3 值得關注</span>
        ${filteredNote}
      </div>
      <div class="ladash-c-mt8-tags">
        <span class="ladash-c-fw6-ccc">無法顯示原因說明：</span>
        ${Object.values(REASON_CONFIG).map(cfg => `
        <span class="ladash-c-iflex4">
          <span class="ladash-reason-swatch ${cfg.txtCls}" data-rsw-bg="${cfg.color}" data-rsw-bd="${cfg.border}">${cfg.symbol}</span>
          ${cfg.label}
        </span>`).join("")}
        <span class="ladash-c-op7">（滑鼠移至儲存格可查看詳細說明）</span>
        ${Array.isArray(_corrData?.meta?.excluded_material_detail) ? `
        <span class="ladash-c-iflex4">
          <span class="ladash-reason-swatch text-info" data-rsw-bg="rgba(80,160,255,0.15)" data-rsw-bd="1px solid rgba(80,160,255,0.45)">†</span>
          已排除規模性變動學期，以其餘學期重新計算
        </span>` : ""}
      </div>`;
    // CSP-CORR FIX: apply computed colors via DOM API
    el.querySelectorAll(".ladash-corr-cell[data-corr-bg]").forEach(cell => {
      if (cell.dataset.corrBg) cell.style.setProperty("background", cell.dataset.corrBg);
      if (cell.dataset.corrTc) cell.style.setProperty("color", cell.dataset.corrTc);
      if (cell.dataset.corrBd) cell.style.setProperty("border", cell.dataset.corrBd);
    });
    el.querySelectorAll(".ladash-reason-swatch[data-rsw-bg]").forEach(sw => {
      if (sw.dataset.rswBg) sw.style.setProperty("background", sw.dataset.rswBg);
      if (sw.dataset.rswBd) sw.style.setProperty("border", sw.dataset.rswBd);
    });
    // Gradient bar: set via DOM API (static computed values)
    const gradBar = el.querySelector("#corrGradBar");
    if (gradBar) {
      gradBar.style.setProperty("background", `linear-gradient(to right,${_rToColor(-1.0)},${_rToColor(-0.6)},${_rToColor(-0.3)},${_rToColor(0)},${_rToColor(0.3)},${_rToColor(0.6)},${_rToColor(1.0)})`);
    }
    el.querySelectorAll("[data-corr-feat][data-corr-target]").forEach(cell => {
      cell.addEventListener("click", () => showScatter(cell.dataset.corrFeat, cell.dataset.corrTarget));
    });
  }

  /** r → rgba 顏色（正：藍，負：紅，0：白） */
  function _rToColor(r) {
    const abs = Math.min(Math.abs(r || 0), 1);
    const v   = Math.round(abs * 180);
    return r >= 0
      ? `rgba(${70 - v}, ${130 + v}, 220, ${0.15 + abs * 0.75})`
      : `rgba(${200 + v}, 60, 60, ${0.15 + abs * 0.75})`;
  }

  // ── 時間滯後相關性長條圖 ─────────────────────────────────

  // OPT-1: bar chart 的 r 值來自 ETL 預算（不隨篩選變動），只需建立一次。
  // 篩選後僅透過 _lagFilteredRows reference 更新散佈圖用的 rows。
  let _lagFilteredRows = null;   // 最新篩選 rows，供 onClick closure 取用

  /**
   * 渲染 lagged_pearson 分組長條圖（Chart.js bar）。
   * - 藍色：front（期初行為 × 期中成績）
   * - 橙色：back（期末行為 × 期末成績）
   * - lag_delta 以 ▲/▼ 箭頭標示於 bar 頂部（plugin afterDatasetsDraw）
   * - 篩選器只影響下方散佈圖；bar 高度固定使用 ETL 預算 r 值。
   * @param {Array} filteredRows  - 目前篩選後的 scatter_data 列（供散佈圖使用）
   */
  function _renderLaggedCorr(filteredRows) {
    const card = document.getElementById("laggedCorrCard");
    if (!card) return;

    // OPT-1: 每次篩選更新 rows reference，讓 onClick closure 能取到最新資料
    _lagFilteredRows = filteredRows;

    _autoRefreshLaggedScatter(filteredRows);

    const lp = _corrData?.lagged_pearson;
    if (!lp?.results) {
      const wrap = document.getElementById("laggedCorrChartWrap");
      if (wrap) wrap.innerHTML =
        `<div class="ladash-c-empty-msg">
           ℹ️ 本 ETL 版本尚無 <code>lagged_pearson</code> 欄位，請重跑 ETL。
         </div>`;
      return;
    }

    // OPT-1: bar chart 已存在（r 值不變）→ 只更新 rows，不重建
    // BUG-DISPLAY-5 FIX: 只用 DOM 屬性守衛（不用 ChartRegistry.getById，避免 detached instance 誤判）
    if (document.getElementById("laggedCorrBarChart")?.__chartBuilt) return;

    const feats        = _features();
    const results      = lp.results;
    const frontTarget  = lp.front_target  || "midterm_score";
    const backTarget   = lp.back_target   || "final_score";

    // 只保留 results 中有值的 feature，並對齊 _features() 順序
    const activeFeat   = feats.filter(f => results[f]);
    const labels       = activeFeat.map(f => FEAT_LABELS[f] || f);
    const frontData    = activeFeat.map(f => results[f]?.front?.r ?? null);
    const backData     = activeFeat.map(f => results[f]?.back?.r  ?? null);
    const deltas       = activeFeat.map(f => results[f]?.lag_delta ?? null);
    const frontSig     = activeFeat.map(f => results[f]?.front?.significant ?? false);
    const backSig      = activeFeat.map(f => results[f]?.back?.significant  ?? false);

    const canvas = document.getElementById("laggedCorrBarChart");
    if (!canvas) return;

    // lag_delta 箭頭 plugin（繪於 bar 頂，不影響 layout）
    const lagDeltaPlugin = {
      id: "lagDeltaArrows",
      afterDatasetsDraw(chart) {
        const ctx   = chart.ctx;
        const meta0 = chart.getDatasetMeta(0); // front bars
        const meta1 = chart.getDatasetMeta(1); // back bars
        ctx.save();
        ctx.font      = "bold 10px system-ui,sans-serif";
        ctx.textAlign = "center";
        activeFeat.forEach((f, i) => {
          const delta = deltas[i];
          if (delta == null) return;
          // position: above the taller bar
          const bar0 = meta0.data[i];
          const bar1 = meta1.data[i];
          if (!bar0 || !bar1) return;
          const x   = (bar0.x + bar1.x) / 2;
          const topY = Math.min(bar0.y, bar1.y) - 4;
          const sign = delta >= 0 ? "▲" : "▼";
          const absd = Math.abs(delta);
          ctx.fillStyle = absd >= 0.05 ? (delta >= 0 ? "#3498db" : "#e74c3c") : "rgba(150,150,170,0.8)";
          ctx.fillText(`${sign}${absd.toFixed(2)}`, x, topY);
        });
        ctx.restore();
      },
    };

    ChartRegistry.destroyById("laggedCorrBarChart");
    const chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: `🔵 期初行為 × ${GRADE_LABELS[frontTarget] || frontTarget}`,
            data: frontData,
            backgroundColor: frontData.map((_, i) =>
              frontSig[i] ? "rgba(52,152,219,0.80)" : "rgba(52,152,219,0.30)"),
            borderColor:     "rgba(52,152,219,1)",
            borderWidth: 1,
          },
          {
            label: `🟠 期末行為 × ${GRADE_LABELS[backTarget] || backTarget}`,
            data: backData,
            backgroundColor: backData.map((_, i) =>
              backSig[i] ? "rgba(230,126,34,0.80)" : "rgba(230,126,34,0.30)"),
            borderColor:     "rgba(230,126,34,1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: ctx => FEAT_LABELS[activeFeat[ctx[0]?.dataIndex]] || activeFeat[ctx[0]?.dataIndex] || "",
              label: ctx => {
                const i = ctx.dataIndex;
                const isBack = ctx.datasetIndex === 1;
                const r     = ctx.parsed.y;
                const sig   = isBack ? backSig[i] : frontSig[i];
                const n     = isBack ? (results[activeFeat[i]]?.back?.n ?? null)
                                     : (results[activeFeat[i]]?.front?.n ?? null);
                const nStr  = n != null ? ` (n=${n})` : "";
                return ` r = ${r >= 0 ? "+" : ""}${r.toFixed(3)}${nStr}${sig ? " *顯著" : ""}`;
              },
              afterBody: ctx => {
                const i     = ctx[0]?.dataIndex;
                const delta = deltas[i];
                if (delta == null) return [];
                return [`lag_delta = ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}（期末相較期初 ${delta >= 0 ? "↑上升" : "↓下降"}）`];
              },
            },
          },
        },
        onClick: (_, elements) => {
          if (!elements.length) return;
          const i    = elements[0].index;
          const feat = activeFeat[i];
          if (!feat) return;
          // OPT-1: 取最新篩選 rows（不依賴 closure 捕捉的舊值）
          showLaggedScatter(feat, _lagFilteredRows);
        },
        scales: {
          x: {
            ticks: { font: { size: 10 }, maxRotation: 40 },
          },
          y: {
            title: { display: true, text: "Pearson r", font: { size: 11 } },
            min: -1, max: 1,
            grid: { color: "rgba(150,150,180,0.15)" },
          },
        },
      },
      plugins: [lagDeltaPlugin],
    });
    ChartRegistry.register("laggedCorrBarChart", chart);
    // OPT-1: 標記已建立，後續篩選不重建
    const cvs = document.getElementById("laggedCorrBarChart");
    if (cvs) cvs.__chartBuilt = true;

  }

  /**
   * BUG-LAG-5 / BUG-RESET-4 FIX：
   * 若滯後散佈圖已展開（#laggedScatterSection 有內容），篩選/重置後自動重繪。
   * 取得目前展開的 feat，以最新 _lagFilteredRows 重繪。
   * @param {Array} filteredRows - 最新篩選 rows
   */
  function _autoRefreshLaggedScatter(filteredRows) {
    const section = document.getElementById("laggedScatterSection");
    if (!section || !section.innerHTML.trim()) return;  // 未展開，不處理

    // 從標題 span 中取回目前展開的 feat label，反查 feat key
    const titleEl = section.querySelector("[data-lag-feat]");
    const feat = titleEl?.dataset?.lagFeat;
    if (!feat) return;  // 無法識別 feat，靜默放棄

    showLaggedScatter(feat, filteredRows);
  }

  /**
   * 滯後散佈圖：以 scatter_data 全期 feature 值作為 X 軸近似（ETL 無分期行為）。
   * 左圖 = feature × midterm_score，右圖 = feature × final_score。
   * 底色藍色系（淡藍底框），與現有白底散佈圖視覺區隔。
   * @param {string} feat         - 指標 key
   * @param {Array}  filteredRows - 目前篩選後的 scatter_data
   */
  function showLaggedScatter(feat, filteredRows) {
    const section = document.getElementById("laggedScatterSection");
    if (!section || !_corrData) return;

    ChartRegistry.destroyById("laggedScatterMid");
    ChartRegistry.destroyById("laggedScatterFinal");

    const lp      = _corrData?.lagged_pearson;
    const results = lp?.results?.[feat];

    const rows = filteredRows ?? _lastFiltered ?? _allScatterData ?? _corrData.scatter_data ?? [];

    // ── 取兩個散點集合 ────────────────────────────────────
    function _buildPoints(targetCol) {
      return (Array.isArray(rows) ? rows : [])
        .map(row => ({ x: row.features?.[feat], y: row[targetCol], masked: row.masked_id, cluster: row.cluster || "" }))
        .filter(p => p.x != null && p.y != null && isFinite(p.x) && isFinite(p.y));
    }

    const ptsMid   = _buildPoints("midterm_score");
    const ptsFinal = _buildPoints("final_score");
    const isRate   = feat.includes("rate") || feat.includes("ratio") || feat.includes("score");

    const featLabel = FEAT_LABELS[feat] || feat;

    // ── 組裝 header（ETL r 值摘要）────────────────────────
    const frontR = results?.front?.r;
    const backR  = results?.back?.r;
    const delta  = results?.lag_delta;

    const rFmtF = frontR != null ? `r = ${frontR >= 0 ? "+" : ""}${frontR.toFixed(3)}` : "—";
    const rFmtB = backR  != null ? `r = ${backR  >= 0 ? "+" : ""}${backR .toFixed(3)}` : "—";
    const deltaStr = delta != null
      ? `lag_delta = ${delta >= 0 ? "+" : ""}${delta.toFixed(3)} （${Math.abs(delta) >= 0.05 ? "⚡ 顯著變化" : "微小變化"}）`
      : "";

    const nNote = `<span class="ladash-c-xs72-dim">
      散佈圖 n=${ptsMid.length} / ${ptsFinal.length}（依篩選條件）
      ${rows.length < (_allScatterData?.length ?? 0) ? "　⚑ 已篩選子集" : ""}
    </span>`;

    section.innerHTML = `
      <div class="ladash-c-corr-lag-panel">
        <div class="ladash-c-flex8-wrap">
          <span class="ladash-c-sm78-accent-bold"
                data-lag-feat="${escapeHtml(feat)}">
            ⏱ 滯後散佈圖：${escapeHtml(featLabel)}
          </span>
          <span class="ladash-c-corr-lag-etl-badge">
            全體 ETL
          </span>
          ${nNote}
        </div>
        <div class="ladash-c-sm-dim-lh">
          🔵 期初行為 × 期中成績：<strong>${rFmtF}</strong>${results?.front?.significant ? " *" : ""}
          　🟠 期末行為 × 期末成績：<strong>${rFmtB}</strong>${results?.back?.significant ? " *" : ""}
          　<span class="ladash-c-xxs-dim">⚙ 此版本採整學期特徵</span>
          ${deltaStr ? `　<span class="ladash-c-accent3">${deltaStr}</span>` : ""}
        </div>
        <div class="ladash-c-grid2" id="laggedScatterGrid">
          <div>
            <div class="ladash-c-xs76-bold">
              🔵 整學期行為 × 期中成績
            </div>
            <div class="ladash-c-chart260">
              <canvas id="laggedScatterMid"></canvas>
            </div>
          </div>
          <div>
            <div class="ladash-c-xs76-bold">
              🟠 整學期行為 × 期末成績
            </div>
            <div class="ladash-c-chart260">
              <canvas id="laggedScatterFinal"></canvas>
            </div>
          </div>
        </div>
      </div>`;

    // BUG-CSP-B FIX: 改用 adoptedStyleSheets（CSP 合規），nonce fallback 供不支援環境
    if (!document.getElementById("laggedScatterGridStyle")) {
      const CSS2 = "@media(max-width:640px){#laggedScatterGrid{grid-template-columns:1fr!important}}";
      const sentinel2 = document.createElement("meta");
      sentinel2.id = "laggedScatterGridStyle";
      if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
        try {
          const sheet2 = new CSSStyleSheet();
          sheet2.replaceSync(CSS2);
          document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet2];
          sentinel2.setAttribute("data-csp-adopted", "1");
          document.head.appendChild(sentinel2);
        } catch (_) {
          const el2 = document.createElement("style");
          el2.id = "laggedScatterGridStyle";
          const nonce2 = _CSP_NONCE;
          if (nonce2) el2.setAttribute("nonce", nonce2);
          el2.textContent = CSS2;
          document.head.appendChild(el2);
        }
      } else {
        const el2 = document.createElement("style");
        el2.id = "laggedScatterGridStyle";
        const nonce2 = _CSP_NONCE;
        if (nonce2) el2.setAttribute("nonce", nonce2);
        el2.textContent = CSS2;
        document.head.appendChild(el2);
      }
    }

    // ── Cluster 色彩對應 ──────────────────────────────────
    const CLUSTER_COLORS = {
      R1: "rgba(52,152,219,0.65)",  R2: "rgba(46,204,113,0.65)",
      R3: "rgba(231,76,60,0.65)",   R4: "rgba(155,89,182,0.65)",
      R5: "rgba(149,165,166,0.65)",
      S1: "rgba(241,196,15,0.65)",  S2: "rgba(52,73,94,0.65)",
      S3: "rgba(230,126,34,0.65)",  S4: "rgba(26,188,156,0.65)",
      S5: "rgba(192,57,43,0.65)",
    };
    const DEFAULT_CLR = "rgba(100,120,160,0.45)";

    function _makeScatterDatasets(pts, trendColor) {
      // 依 cluster 分組
      const clusterMap = {};
      for (const p of pts) {
        const cl = p.cluster || "—";
        if (!clusterMap[cl]) clusterMap[cl] = [];
        clusterMap[cl].push(p);
      }
      const datasets = Object.entries(clusterMap).map(([cl, cpts]) => ({
        label: cl,
        data:  cpts.map(p => ({ x: p.x, y: p.y, masked: p.masked })),
        backgroundColor: CLUSTER_COLORS[cl] || DEFAULT_CLR,
        pointRadius: 4,
        pointHoverRadius: 6,
      }));
      const reg = _calcRegression(pts.map(p => ({ x: p.x, y: p.y })));
      if (reg) {
        datasets.push({
          label: "趨勢線",
          data: [
            { x: reg.xMin, y: Math.max(0, Math.min(100, reg.yAtMin)) },
            { x: reg.xMax, y: Math.max(0, Math.min(100, reg.yAtMax)) },
          ],
          type: "line",
          borderColor: trendColor,
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: 0,
          fill: false,
          tension: 0,
        });
      }
      return datasets;
    }

    function _drawLagScatter(canvasId, pts, rVal, targetLabel, trendColor) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      if (!pts.length) {
        canvas.parentElement.innerHTML =
          `<div class="ladash-c-sm78-pad">無符合篩選條件的資料點</div>`;
        return;
      }
      const rLabel = rVal != null ? ` (r = ${rVal >= 0 ? "+" : ""}${rVal.toFixed(3)})` : "";
      // OPT-2: destroy 已在 showLaggedScatter 頂部執行，此處不重複
      const chart = new Chart(canvas.getContext("2d"), {
        type: "scatter",
        data: { datasets: _makeScatterDatasets(pts, trendColor) },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              title: { display: true, text: featLabel, font: { size: 10 } },
              ticks: { callback: v => isRate ? `${Math.round(v * 100)}%` : v, font: { size: 9 } },
            },
            y: {
              title: { display: true, text: targetLabel + rLabel, font: { size: 10 } },
              min: 0, max: 100,
              ticks: { font: { size: 9 } },
            },
          },
          plugins: {
            legend: { labels: { font: { size: 10 }, boxWidth: 10 } },
            tooltip: {
              filter: item => item.dataset.type !== "line",
              callbacks: {
                title: ctx => ctx.length ? `學生 ${ctx[0].raw.masked}` : "",
                label: ctx => {
                  const p      = ctx.raw;
                  const xLabel = isRate ? `${(p.x * 100).toFixed(1)}%` : p.x.toFixed(2);
                  return [` ${featLabel}：${xLabel}`, ` ${targetLabel}：${p.y} 分`];
                },
              },
            },
          },
        },
      });
      ChartRegistry.register(canvasId, chart);
    }

    _drawLagScatter("laggedScatterMid",   ptsMid,   frontR, GRADE_LABELS["midterm_score"], "rgba(52,152,219,0.85)");
    _drawLagScatter("laggedScatterFinal", ptsFinal, backR,  GRADE_LABELS["final_score"],   "rgba(230,126,34,0.85)");
  }

  /**
   * Ph2b B6：最高相關指標 Badge + score_delta / cramming 洞察摘要。
   * 插入於熱力圖容器上方；無 correlation_insights 資料時靜默不顯示。
   * 全量模式：讀 ETL 預算值；篩選模式：以 _pearsonValue / _spearmanValue 即時重算。
   */
  function _renderInsightsBadge(insertBeforeId, filteredRows) {
    const anchor = document.getElementById(insertBeforeId);
    if (!anchor) return;

    const existingSlot = document.getElementById("corrInsightsBadgeSlot");
    if (existingSlot) existingSlot.innerHTML = "";
    const existing = document.getElementById("corrInsightsBadge");
    if (existing) existing.remove();

    const ci = _corrData?.correlation_insights;
    if (!ci) return;

    const isUnfiltered = _isUnfiltered();

    const lines = [];

    /**
     * 取 r 值的統一入口：
     *   全量 → ETL 預算值；篩選 → 即時重算。
     */
    function _liveR(feat, target) {
      if (isUnfiltered) {
        return _pearson(feat, target);   // 已是 number | null
      }
      const rows = Array.isArray(filteredRows) ? filteredRows : (_lastFiltered ?? _allScatterData ?? []);
      const result = (_corrType === "spearman")
        ? _spearmanValue(rows, feat, target)
        : _pearsonValue(rows, feat, target);
      return result?.r ?? null;   // 解包診斷物件，統一回傳 number | null
    }

    const nSuffix = (!isUnfiltered && Array.isArray(filteredRows))
      ? ` <span class="ladash-c-op65-xs">n=${filteredRows.length}</span>`
      : "";

    // ── 最高相關指標（依篩選後資料重新搜尋最高 |r|）─────────
    if (isUnfiltered) {
      // 全量：直接用 ETL 欄位
      const hr = ci.highest_r_feature;
      if (hr?.feature && hr?.r != null) {
        const rSign = hr.r >= 0 ? "+" : "";
        lines.push(
          `🏆 <strong>最高相關指標</strong>：${FEAT_LABELS[hr.feature] || hr.feature} × ${GRADE_LABELS[hr.target] || hr.target}　<code>r = ${rSign}${hr.r.toFixed(3)}</code>`
        );
      }
    } else {
      // Phase D：篩選模式，優先讀 segment_pearson 預聚合的 highest_r
      const segKey  = _segKey();
      const segData = _canUseSeg() ? (_corrData?.segment_pearson?.[segKey] ?? null) : null;
      if (segData?.highest_r?.feature) {
        const hr    = segData.highest_r;
        const rSign = hr.r >= 0 ? "+" : "";
        const lowConfWarn = segData.low_confidence
          ? ` <span class="ladash-c-op65-xs">⚠️ 低信心</span>` : "";
        lines.push(
          `🏆 <strong>最高相關指標</strong>：${FEAT_LABELS[hr.feature] || hr.feature} × ${GRADE_LABELS[hr.target] || hr.target}　<code>r = ${rSign}${hr.r.toFixed(3)}</code>${nSuffix}${lowConfWarn}`
        );
      } else {
        // fallback：掃描所有 feat×target 即時取最高 |r|（原有邏輯）
        const rows = Array.isArray(filteredRows) ? filteredRows : (_lastFiltered ?? _allScatterData ?? []);
        let bestFeat = null, bestTarget = null, bestR = null;
        for (const feat of _features()) {
          for (const target of _targets()) {
            const r = _pearsonValue(rows, feat, target)?.r ?? null;
            if (r !== null && (bestR === null || Math.abs(r) > Math.abs(bestR))) {
              bestFeat = feat; bestTarget = target; bestR = r;
            }
          }
        }
        if (bestFeat && bestR !== null) {
          const rSign = bestR >= 0 ? "+" : "";
          lines.push(
            `🏆 <strong>最高相關指標</strong>：${FEAT_LABELS[bestFeat] || bestFeat} × ${GRADE_LABELS[bestTarget] || bestTarget}　<code>r = ${rSign}${bestR.toFixed(3)}</code>${nSuffix}`
          );
        }
      }
    }

    // ── score_delta 相關性 ───────────────────────────────────
    const sdFeat = "quz_score_delta";
    // 嘗試從 correlation_insights 取得目標欄位名稱，fallback 到 final_score / grade_final
    const sdTarget = ci.score_delta_correlation?.target || "final_score";
    const sdR = _liveR(sdFeat, sdTarget)
             ?? _liveR(sdFeat, "grade_final")
             ?? _liveR(sdFeat, "grade_total");
    if (sdR != null) {
      const sign = sdR >= 0 ? "+" : "";
      lines.push(
        `📈 <strong>成績變化量</strong> × 期末成績：<code>r = ${sign}${sdR.toFixed(3)}</code>${nSuffix}`
      );
    } else if (isUnfiltered && ci.score_delta_correlation?.final != null) {
      // 全量 fallback：直接讀 ETL 欄位（feat key 不在 scatter 時）
      const sign = ci.score_delta_correlation.final >= 0 ? "+" : "";
      lines.push(
        `📈 <strong>成績變化量</strong> × 期末成績：<code>r = ${sign}${ci.score_delta_correlation.final.toFixed(3)}</code>`
      );
    }

    // ── cramming_ratio 相關性 ────────────────────────────────
    const crFeat = "quz_cramming_ratio";
    const crTarget = ci.cramming_correlation?.target || "final_score";
    const crR = _liveR(crFeat, crTarget)
             ?? _liveR(crFeat, "grade_final")
             ?? _liveR(crFeat, "grade_total");
    if (crR != null) {
      const sign = crR >= 0 ? "+" : "";
      lines.push(
        `🕐 <strong>考前7天刷題比</strong> × 期末成績：<code>r = ${sign}${crR.toFixed(3)}</code>${nSuffix}`
      );
    } else if (isUnfiltered && ci.cramming_correlation?.final != null) {
      const sign = ci.cramming_correlation.final >= 0 ? "+" : "";
      lines.push(
        `🕐 <strong>考前7天刷題比</strong> × 期末成績：<code>r = ${sign}${ci.cramming_correlation.final.toFixed(3)}</code>`
      );
    }

    if (!lines.length) return;

    const badge = document.createElement("div");
    badge.id = "corrInsightsBadge";
    badge.className = "ladash-c-corr-insights-badge";
    badge.innerHTML = lines.map(l => `<span>${l}</span>`).join("");

    const slot = document.getElementById("corrInsightsBadgeSlot");
    if (slot) {
      slot.innerHTML = "";
      slot.appendChild(badge);
    } else {
      anchor.parentNode.insertBefore(badge, anchor);
    }
  }

  // ── 散佈圖選擇器 ─────────────────────────────────────────

  function _renderScatterSelector(wrapperId, filteredRows) {
    const el = document.getElementById(wrapperId);
    if (!el || !_corrData) return;

    // 以傳入的篩選資料判斷是否有資料可顯示
    const scatterData = filteredRows ?? _lastFiltered ?? _allScatterData ?? _corrData.scatter_data ?? [];
    const hasScatterData = Array.isArray(scatterData)
      ? scatterData.length > 0
      : Object.keys(scatterData).length > 0;

    if (!hasScatterData) {
      const _esc = s => typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const noDataReason = (_filterCluster !== "all")
        ? `資源使用 ${_esc(_filterCluster)} 在本相關性資料集中無對應學生（兩資料集學生母體不同）`
        : (_filterSemester !== "all")
          ? `年度 ${_esc(_filterSemester)} 尚無獨立散佈圖資料（ETL 尚未產出 by_semester）`
          : "散佈圖資料尚未產出，請執行 ETL";
      el.innerHTML = `<div class="ladash-c-warn-box">⚠️ ${noDataReason}</div>`;
      return;
    }

    el.innerHTML = `
      <div id="scatterChartWrap" class="ladash-c-chart320">
        <canvas id="scatterChart"></canvas>
      </div>`;

    if (Array.isArray(scatterData)) {
      const firstFeat   = (_features())[0];
      const firstTarget = (_targets())[0];
      if (firstFeat && firstTarget) showScatter(firstFeat, firstTarget, scatterData);
    } else {
      const firstKey                = Object.keys(scatterData)[0];
      const [featPart, , gradePart] = firstKey.split("_vs_");
      showScatter(featPart, gradePart || "grade_total", null);
    }
  }

  // ── 散佈圖渲染 ───────────────────────────────────────────

  /** 計算 value 在已排序陣列中的百分位（0–100） */
  function _percentile(sortedArr, value) {
    const below = sortedArr.filter(v => v < value).length;
    return Math.round((below / sortedArr.length) * 100);
  }

  /** 最小二乘法線性回歸，回傳 {slope, intercept, xMin, xMax, yAtMin, yAtMax} 或 null */
  function _calcRegression(points) {
    const n = points.length;
    if (n < 30) return null;   // 資料點不足，不畫迴歸線
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const p of points) { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x; }
    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return null;
    const slope     = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const xs        = points.map(p => p.x);
    const xMin      = Math.min(...xs);
    const xMax      = Math.max(...xs);
    return { slope, intercept, xMin, xMax,
             yAtMin: slope * xMin + intercept,
             yAtMax: slope * xMax + intercept };
  }

  function showScatter(feat, gradeCol, rows) {
    if (!_corrData) return;

    const raw = _scatterRows(feat, gradeCol, rows);

    // r label：全量模式用 ETL 預算值；篩選模式以實際散點即時重算，確保與資料點同源
    let r;
    if (_isUnfiltered()) {
      r = _pearson(feat, gradeCol);
    } else {
      const activeRows = Array.isArray(rows) ? rows : (_lastFiltered ?? _allScatterData ?? []);
      const liveResult = (_corrType === "spearman")
        ? _spearmanValue(activeRows, feat, gradeCol)
        : _pearsonValue(activeRows, feat, gradeCol);
      r = liveResult?.r ?? _pearson(feat, gradeCol);   // fallback 至 ETL 值
    }
    const rLabel = r != null ? ` (r = ${r >= 0 ? "+" : ""}${r.toFixed(3)})` : "";

    const points  = raw.map(d => ({ x: d.x, y: d.y, masked: d.masked_id }));
    if (!points.length) return;

    const sortedX = [...points.map(p => p.x)].sort((a, b) => a - b);
    const sortedY = [...points.map(p => p.y)].sort((a, b) => a - b);

    const isRateField = feat.includes("rate") || feat.includes("ratio") || feat.includes("score");

    const canvas = document.getElementById("scatterChart");
    if (!canvas) return;

    const rhoResult = _spearmanValue(
      raw.map(d => ({ features: { [feat]: d.x }, [gradeCol]: d.y })),
      feat, gradeCol
    );
    const rho = rhoResult?.r ?? null;

    const reg = _calcRegression(points);
    const datasets = [{
      label: `${FEAT_LABELS[feat] || feat} vs ${GRADE_LABELS[gradeCol] || gradeCol}${rLabel}`,
      data: points,
      backgroundColor: "rgba(52, 152, 219, 0.55)",
      pointRadius: 5,
      pointHoverRadius: 7,
    }];
    if (reg) {
      datasets.push({
        label: `趨勢線 (y = ${reg.slope >= 0 ? "+" : ""}${reg.slope.toFixed(2)}x + ${reg.intercept.toFixed(1)})`,
        data: [
          { x: reg.xMin, y: Math.max(0, Math.min(100, reg.yAtMin)) },
          { x: reg.xMax, y: Math.max(0, Math.min(100, reg.yAtMax)) },
        ],
        type: "line",
        borderColor: "rgba(231, 76, 60, 0.75)",
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
        tension: 0,
      });
    }

    ChartRegistry.destroyById("scatterChart");
    const chart = new Chart(canvas.getContext("2d"), {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: FEAT_LABELS[feat] || feat, font: { size: 11 } },
            ticks: { callback: v => isRateField ? `${Math.round(v * 100)}%` : v },
          },
          y: {
            title: { display: true, text: GRADE_LABELS[gradeCol] || gradeCol, font: { size: 11 } },
            min: 0, max: 100,
          },
        },
        plugins: {
          legend: { labels: { font: { size: 11 } } },
          tooltip: {
            filter: item => item.datasetIndex === 0,   // 迴歸線不觸發 tooltip
            callbacks: {
              title: ctx => ctx.length ? `學生 ${ctx[0].raw.masked}` : "",
              label: ctx => {
                const p      = ctx.raw;
                const xLabel = isRateField ? `${(p.x * 100).toFixed(1)}%` : p.x.toFixed(2);
                return [
                  ` ${FEAT_LABELS[feat] || feat}：${xLabel}`,
                  ` ${GRADE_LABELS[gradeCol] || gradeCol}：${p.y} 分`,
                ];
              },
              afterLabel: ctx => {
                const p    = ctx.raw;
                const xPct = _percentile(sortedX, p.x);
                const yPct = _percentile(sortedY, p.y);
                return [
                  ` 行為指標：高於 ${xPct}% 同學`,
                  ` 成績：高於 ${yPct}% 同學`,
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const lines = [];
                if (r != null) {
                  const st = Math.abs(r) >= 0.5 ? "強" : Math.abs(r) >= 0.3 ? "中等" : "弱";
                  lines.push(`📈 Pearson r = ${r >= 0 ? "+" : ""}${r.toFixed(3)}  → ${st}${r >= 0 ? "正" : "負"}相關`);
                }
                if (rho != null) {
                  const ss = Math.abs(rho) >= 0.5 ? "強" : Math.abs(rho) >= 0.3 ? "中等" : "弱";
                  lines.push(`📊 Spearman ρ = ${rho >= 0 ? "+" : ""}${rho.toFixed(3)}  → ${ss}${rho >= 0 ? "正" : "負"}相關`);
                }
                if (reg) {
                  lines.push(`📉 趨勢線：斜率 ${reg.slope >= 0 ? "+" : ""}${reg.slope.toFixed(3)}`);
                }
                return lines;
              },
            },
          },
        },
      },
    });
    ChartRegistry.register("scatterChart", chart);
  }

  return { init, showScatter, onFilterChange, resetFilters, setCorrType };
})();
