/**
 * tab-behavior-time.js  —  v2.1
 * 時間分析 Tab
 *
 * 新增功能：
 *   - renderStudyHeatmap()        學習規律熱力圖（SVG，7×24）
 *   - renderHourlyLine()          24小時學習趨勢折線（Chart.js，含分群疊加）
 *   - renderAIInsightBadge()      AI 智慧洞察文字框
 *
 * 保留原有功能：
 *   - renderWeeklyQuiz()          各週題庫作答強度
 *   - renderPreExamIntensity()    平時及考前學習強度（考前分型圓環）
 *   - renderTimeSlotDonut()       學習時段分布（四段圓環，保留）
 *
 * 資料來源：time_distribution.json v2.1
 *   新欄位：class_heatmap_matrix、class_avg_hourly_distribution、cohort_hourly
 *           students[i].heatmap_matrix、students[i].hourly_distribution
 *
 * 依賴：Chart.js、behavior-loader.js
 */

const BehaviorTimeTab = (() => {

  // ── 常數定義 ────────────────────────────────────────────────

  const PASS_THRESHOLD = 60;

  const SLOT_LABELS = {
    MORNING:    "上午 06-12",
    AFTERNOON:  "下午 12-18",
    EVENING:    "傍晚 18-23",
    LATE_NIGHT: "深夜 23-06",
  };

  const SLOT_COLORS = [
    "rgba(241, 196, 15,  0.80)",
    "rgba(52,  152, 219, 0.80)",
    "rgba(155, 89,  182, 0.80)",
    "rgba(44,  62,  80,  0.75)",
  ];

  const SLOT_TIPS = {
    MORNING:    "早晨學習，記憶力佳、專注度高",
    AFTERNOON:  "午後學習，效率穩定",
    EVENING:    "傍晚學習，適合複習整理",
    LATE_NIGHT: "深夜學習可能影響睡眠品質，建議調整",
  };

  const CLUSTER_NAMES = {
    R1: "影音輔導型",
    R2: "彈性聽覺型",
    R3: "平均使用型",
    R4: "題庫刷題型",
    R5: "被動低參與型",
  };

  // UI key (R1–R5) 與 ETL JSON key 一致（ETL 已輸出 R1–R5）

  const PREP_TYPES = [
    { key: "low_invest",  label: "學習低投入型", color: "rgba(158, 158, 158, 0.85)" },
    { key: "crammer",     label: "高度衝刺型",   color: "rgba(255, 82,  82,  0.85)" },
    { key: "consistent",  label: "規律分散型",   color: "rgba(76,  175, 80,  0.85)" },
    { key: "early",       label: "提早完成型",   color: "rgba(33,  150, 243, 0.85)" },
  ];

  const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
  const HOUR_LABELS    = Array.from({ length: 24 }, (_, i) => `${i}:00`);

  // 24小時折線圖顏色
  const COHORT_COLORS = {
    class: { border: "rgba(52,  152, 219, 0.9)", bg: "rgba(52, 152, 219, 0.12)" },
    top25: { border: "rgba(46,  204, 113, 0.9)", bg: "rgba(46, 204, 113, 0.12)" },
    pass:  { border: "rgba(241, 196, 15,  0.9)", bg: "rgba(241,196, 15,  0.10)" },
    fail:  { border: "rgba(231, 76,  60,  0.8)", bg: "rgba(231, 76,  60,  0.08)" },
  };

  // ── 狀態 ────────────────────────────────────────────────────
  let _quizData     = null;
  let _timeData     = null;
  // WARN-TIME-1 FIX: removed _charts={} - ChartRegistry is the single source of truth for instances
  let _filterSemester = "all";
  let _filterCluster  = "all";
  let _filterPass     = "all";
  let _allSemesters   = [];

  // ── 工具函式 ─────────────────────────────────────────────────

  function _avg(values) {
    const nums = values.filter(v => v != null && isFinite(v));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }

  function _num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function _normalizeSem(value) {
    return String(value || "").replace(/-/g, "");
  }

  function _formatSemLabel(sem) {
    const s = String(sem || "").trim();
    const m = s.match(/^(\d{3})-?([12])$/);
    return m ? `${m[1]}(${m[2]})` : s;
  }

  function _isPassing(row) {
    const score = _num(row.final_score ?? row.semester_score);
    return Number.isFinite(score) && score >= PASS_THRESHOLD;
  }

  function _weekAvgAttempts(w) {
    if (w.avg_attempts != null) return _num(w.avg_attempts);
    // BUG-TIME-QUIZ-5 FIX: 兩組皆無資料時應回傳 null（代表本週無資料），
    // 不可經 _num(null)→0 併入平均，否則會把「無資料」誤畫成「作答次數為 0」的假驟降。
    // 兩組皆有已知人數時，改採人數加權平均，避免以人數懸殊的及格/不及格組做等權重平均而失真。
    const pAvg = w.pass_group_avg_attempts, fAvg = w.fail_group_avg_attempts;
    const pN = w.pass_group_active_students, fN = w.fail_group_active_students;
    if (pAvg != null && fAvg != null && pN > 0 && fN > 0) {
      return (pAvg * pN + fAvg * fN) / (pN + fN);
    }
    const parts = [pAvg, fAvg].filter(v => v != null);
    return parts.length ? _avg(parts.map(_num)) : null;
  }

  function _weekActiveStudents(w) {
    return _num(w.active_students ?? w.total_students ??
      ((w.pass_group_active_students || 0) + (w.fail_group_active_students || 0)));
  }

  function _availableSemesters() {
    const fromMeta = [
      ...(_timeData?.meta?.semesters  || []),
      ...(_quizData?.meta?.semesters  || []),
    ];
    const fromRows = (_timeData?.students || []).map(s => s.semester).filter(Boolean);
    return [...new Set([...fromMeta, ...fromRows])].sort((a, b) => String(b).localeCompare(String(a)));
  }

  // ── 熱力圖色彩函式（模組層級）────────────────────────
  // 深藍(少) → 藍 → 橙(多)
  function _heatColor(val, maxVal) {
    if (!val || val <= 0) return "rgba(40,46,68,0.6)";
    const t = Math.min(val / maxVal, 1);
    const r = Math.round(26  + t * (230 - 26));
    const g = Math.round(32  + t * (126 - 32));
    const b = Math.round(54  + (1 - t) * (219 - 54));
    return `rgb(${r},${g},${b})`;
  }

  // ── 初始化 & 篩選 ────────────────────────────────────────────

  async function init() {
    BehaviorLoader.setLoading("tab-time", true);
    try {
      [_quizData, _timeData] = await Promise.all([
        BehaviorLoader.load.quiz(),
        BehaviorLoader.load.time(),
      ]);
      _allSemesters = _availableSemesters();
      // 明確兩步驟賦值，避免 _filterRows 拋出時 _rowCache.filtered 保持 null 的競態
      const allRows = _studentRows(false);
      const filteredRows = _filterRows(allRows);
      _rowCache = { all: allRows, filtered: filteredRows };
      _renderFilterBar();
      _renderAll();
    } catch (err) {
      _rowCache = null;  // 確保失敗時快取不含部分資料
      BehaviorLoader.showError("tab-time", err.message);
    } finally {
      BehaviorLoader.setLoading("tab-time", false);
    }
  }

  function _renderFilterBar() {

    // 改為在專屬容器 #timeFilterBarAnchor 中插入，若不存在則在 #tab-time 最前面插入
    let anchor = document.getElementById("timeFilterBarAnchor");
    if (!anchor) {
      const tabEl = document.getElementById("tab-time");
      if (!tabEl) return;
      anchor = document.createElement("div");
      anchor.id = "timeFilterBarAnchor";
      tabEl.insertBefore(anchor, tabEl.firstChild);
    }
    const semOptions = [
      `<option value="all">全部年度</option>`,
      ..._allSemesters.map(s => `<option value="${s}"${s === _filterSemester ? " selected" : ""}>${_formatSemLabel(s)}</option>`),
    ].join("");
    const clusterOptions = [
      `<option value="all">全部資源使用</option>`,
      ...Object.entries(CLUSTER_NAMES).map(([k, v]) => `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${v}</option>`),
    ].join("");
    const passOptions = [
      `<option value="all">全部</option>`,
      `<option value="pass"${_filterPass === "pass" ? " selected" : ""}>及格</option>`,
      `<option value="fail"${_filterPass === "fail" ? " selected" : ""}>不及格</option>`,
    ].join("");
    anchor.innerHTML = `
      <div class="ladash-t-filter-panel">
        <span class="ladash-t-filter-lbl">篩選條件</span>
        <label class="ladash-t-filter-grp">學期
          <select id="timeSemFilter" class="ladash-t-filter-sel" data-mw="90px">${semOptions}</select>
        </label>
        <label class="ladash-t-filter-grp">資源使用
          <select id="timeClusterFilter" class="ladash-t-filter-sel" data-mw="110px">${clusterOptions}</select>
        </label>
        <label class="ladash-t-filter-grp">及格
          <select id="timePassFilter" class="ladash-t-filter-sel" data-mw="80px">${passOptions}</select>
        </label>
        <span id="timeFilterCount" class="ladash-t-dim-xs"></span>
      </div>`;
    _bindFilterSelects(anchor);
  }

  function _bindFilterSelects(root) {
    [
      "timeSemFilter", "timeClusterFilter", "timePassFilter",
      "preExamSemFilter", "preExamClusterFilter", "preExamPassFilter",
      "tsDonutSemFilter", "tsDonutClusterFilter", "tsDonutPassFilter",
    ].forEach(id => {
      const el = root.querySelector(`#${id}`);
      if (el) el.addEventListener("change", () => onFilterChange(id));
    });
  }

  function onFilterChange(sourceId) {
    // 以觸發來源的 id 判斷變更的是哪個維度，取其值更新全域狀態，
    // 再同步所有其他同維度的 select，確保頂部列與圖表內三組篩選器永遠一致。
    if (sourceId) {
      const el = document.getElementById(sourceId);
      if (el) {
        const sid = sourceId.toLowerCase();
        if      (sid.includes("sem"))     _filterSemester = el.value;
        else if (sid.includes("cluster")) _filterCluster  = el.value;
        else if (sid.includes("pass"))    _filterPass     = el.value;
      }
    } else {
      // 無 sourceId（直接呼叫）：從頂部列讀取
      _filterSemester = document.getElementById("timeSemFilter")?.value     || "all";
      _filterCluster  = document.getElementById("timeClusterFilter")?.value || "all";
      _filterPass     = document.getElementById("timePassFilter")?.value    || "all";
    }

    // 同步所有同維度 select（頂部列 + 兩組圖表內）
    const semIds     = ["timeSemFilter",     "preExamSemFilter",     "tsDonutSemFilter"];
    const clusterIds = ["timeClusterFilter", "preExamClusterFilter", "tsDonutClusterFilter"];
    const passIds    = ["timePassFilter",    "preExamPassFilter",    "tsDonutPassFilter"];
    semIds    .forEach(id => { const el = document.getElementById(id); if (el) el.value = _filterSemester; });
    clusterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = _filterCluster;  });
    passIds   .forEach(id => { const el = document.getElementById(id); if (el) el.value = _filterPass;     });

    _renderAll();
  }

  // ── 資料列處理 ──────────────────────────────────────────────
  // time_distribution.json v2.1 已含 edu_type / cluster / semester / final_score，
  // 直接以 timeData.students 為主，不再 join window.DATA

  function _studentRows(applyFilters = true) {
    const timeStudents = _timeData?.students || [];
    const rows = timeStudents.map(s => {
      // time_distribution.json v2.1 的 student 物件為扁平結構（07_export_json.py），
      // 所有 time_profile 欄位直接輸出於 s 頂層（不存在 s.time_profile 包層）。
      const tp = s;
      return {
        anon_id:             s.anon_id,
        masked_id:           s.masked_id,
        semester:            s.semester  || "",
        cluster:             s.cluster   || "",
        edu_type:            s.edu_type  || "",
        final_score:         s.final_score    ?? null,
        semester_score:      s.semester_score ?? null,
        totalMinutes:        _num(s.total_learning_minutes ?? (s.features || {}).total_learning_minutes),
        preMidterm:          _num(tp.pre_midterm_7d_minutes),
        preFinal:            _num(tp.pre_final_7d_minutes),
        midRegular:          _num(tp.midterm_regular_minutes),
        finalRegular:        _num(tp.final_regular_minutes),
        midPeriod:           _num(tp.midterm_period_minutes),
        finalPeriod:         _num(tp.final_period_minutes),
        activeWeeks:         _num(tp.active_weeks),
        timeSlotDistribution: tp.time_slot_distribution || {},
        heatmapRaw:          s.heatmap_matrix?.raw        || {},
        hourlyRaw:           s.hourly_distribution?.raw   || [],
        late_night_ratio:    _num(tp.late_night_ratio),
      };
    });
    return applyFilters ? _filterRows(rows) : rows;
  }

  function _filterRows(rows) {
    return rows.filter(row => {
      // ROOT-CAUSE FIX(0815，/systematic-debugging 第四輪窮舉式稽核，預防性
      // 修復)：原本 `row.semester &&` 短路判斷，若某筆記錄的 semester 缺失
      // （_studentRows() 已將其正規化為空字串 ""，而非 undefined/null），
      // 會使整個條件式短路為 false，讓該筆記錄「跳過學期篩選」、在任何
      // 特定學期篩選下都照樣顯示——與 cluster/pass 篩選「缺值就不符合」
      // 的一致行為相反。經查目前真實 time_distribution.json 全部 2,911
      // 筆記錄 semester 皆無缺失，此路徑目前不會觸發；_normalizeSem("")
      // 回傳 ""，不等於任何真實學期字串，故移除該短路判斷後行為安全
      // （semester 缺失時正確視為「不符合特定學期篩選」而排除，與其他
      // 欄位篩選邏輯一致），純屬預防性修復，避免未來若 ETL 產出缺
      // semester 的記錄時，靜默污染每個特定學期的檢視畫面。
      if (_filterSemester !== "all" &&
          _normalizeSem(row.semester) !== _normalizeSem(_filterSemester)) return false;
      if (_filterCluster !== "all" && row.cluster !== _filterCluster) return false;
      if (_filterPass !== "all") {
        const hasScore = row.final_score != null || row.semester_score != null;
        if (!hasScore) return false;
        const pass = _isPassing(row);
        if (_filterPass === "pass" && !pass) return false;
        if (_filterPass === "fail" && pass) return false;
      }
      return true;
    });
  }

  // ── 列資料快取（每次 _renderAll 重置，各 render* 共用）──────
  let _rowCache = null;   // { all: rows[], filtered: rows[] }

  function _getRowCache() {
    if (!_rowCache) {
      const all = _studentRows(false);
      _rowCache = { all, filtered: _filterRows(all) };
    }
    return _rowCache;
  }

  function _filteredStudentRows() {
    return _getRowCache().filtered;
  }

  function _renderAll() {

    // 每次篩選變更時強制從 all rows 重新計算 filtered
    if (_rowCache) {
      _rowCache.filtered = _filterRows(_rowCache.all);
    } else {
      _getRowCache();
    }
    const rows    = _filteredStudentRows();
    const countEl = document.getElementById("timeFilterCount");
    if (countEl) countEl.textContent = `共 ${rows.length.toLocaleString()} 筆`;

    // ── 原有圖表 ──
    renderWeeklyQuiz("weeklyQuizChart");
    renderPreExamIntensity("preExamChart");
    renderTimeSlotDonut("timeSlotChart");

    // ── 新增圖表（rAF 避免篩選切換時卡頓）──
    requestAnimationFrame(() => {
      renderAIInsightBadge("aiInsightBadge");
      renderStudyHeatmap("studyHeatmapWrap");
      renderHourlyLine("hourlyLineChart");
    });
  }

  function reRender() {
    if (!_rowCache || !_timeData) return;
    _renderAll();
  }

  // ────────────────────────────────────────────────────────────
  // 原有圖表（完整保留）
  // ────────────────────────────────────────────────────────────

  // BUGFIX-B2（0716 穿透式審查）：1121/1122/1131 為「16+2週」學制特例
  // （期中考第8週、期末考第16週；17、18週為自學週），其餘學期為
  // 「期中考第9週、期末考第18週」。共用於 renderWeeklyQuiz() 的週次
  // fallback 判斷，以及下面 examLinePlugin 的紅色參考線繪製位置。
  const SIXTEEN_PLUS_TWO_SEMS = new Set(["1121", "1122", "1131"]);
  function _examWeeksForCurrentFilter() {
    if (SIXTEEN_PLUS_TWO_SEMS.has(_filterSemester)) {
      return { weeks: [8, 16], labels: { 8: "期中考", 16: "期末考" } };
    }
    return { weeks: [9, 18], labels: { 9: "期中考", 18: "期末考" } };
  }

  const examLinePlugin = {
    id: "examVerticalLines",
    afterDraw(chart) {
      const { ctx, scales, data } = chart;
      const xScale = scales.x;
      if (!xScale) return;
      const { weeks: examWeeks, labels: examLabels } = _examWeeksForCurrentFilter();
      data.labels.forEach((label, i) => {
        const weekNum = parseInt(label.replace("W", ""), 10);
        if (!examWeeks.includes(weekNum)) return;
        const x = xScale.getPixelForValue(i);
        const top = chart.chartArea.top;
        const bottom = chart.chartArea.bottom;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.85)";
        ctx.lineWidth = 2;
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.fillStyle = "rgba(220, 38, 38, 0.90)";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(examLabels[weekNum], x, top - 4);
        ctx.restore();
      });
    },
  };

  function _segmentKey() {
    const sem = _filterSemester === "all" ? "all" : _normalizeSem(_filterSemester);
    return `${sem}|${_filterCluster}|${_filterPass}`;
  }

  function _weeksForFilter() {
    // BUG-TIME-QUIZ-2/3 FIX:
    // by_semester[sem].weeks 只有 avg_attempts，缺 pass/fail 分組欄位且無 segments。
    // 一律從頂層 weeks 出發，以 segment key 合併後重建 pass_group / fail_group 欄位。
    //
    // BUG-TIME-QUIZ-4 FIX:
    // cluster 維度原本被 hardcode 為 "all"，導致切換分群時 segment key 不變，圖形相同。
    // 修正：key 中加入 _filterCluster；若 quiz segments 無此 cluster 維度，
    // 則 fallback 至 sem|all|pass 的舊 key，確保有 cluster 資料時正確顯示，
    // 無 cluster 資料時行為與舊版一致（降級而非顯示錯誤資料）。
    const baseWeeks = _quizData?.weeks || [];
    const sem     = _filterSemester === "all" ? "all" : _normalizeSem(_filterSemester);
    const cluster = _filterCluster;  // ETL 輸出 R1–R5，直接使用

    // 精確 key（含 cluster）
    const key  = `${sem}|${cluster}|${_filterPass}`;
    const pKey = `${sem}|${cluster}|pass`;
    const fKey = `${sem}|${cluster}|fail`;
    // fallback key（cluster=all，與舊版相同）
    const fallbackKey  = `${sem}|all|${_filterPass}`;
    const fallbackPKey = `${sem}|all|pass`;
    const fallbackFKey = `${sem}|all|fail`;

    return baseWeeks.map(w => {
      const segs = w.segments || {};

      // 優先用含 cluster 的精確 key；若無則 fallback 至 all
      const seg  = segs[key]  ?? segs[fallbackKey];
      // BUG-TIME-QUIZ-5 FIX: 頂層 w 代表「全部學期合併」統計。
      // 當篩選為特定學期（sem !== "all"）且該週剛好無 segment 資料時（如 1142 的 W15/W17），
      // 絕不可 fallback 至頂層 w ── 那是跨學期混合值，並非該學期資料，
      // 曾導致該週被誤植入其他學期的作答次數/人數/及格率（與過去修過的跨學期 anon_id 污染同一類問題）。
      // 僅在篩選本身就是「全部年度」時，頂層 w 才是正確代表；否則該週應視為無資料。
      const base = seg
        ? { ...w, ...seg }
        : (sem === "all" ? w : { week: w.week, title: w.title, is_exam_week: w.is_exam_week, exam_type: w.exam_type });

      let passGroupAvg = null;
      let failGroupAvg = null;
      let passGroupN   = null;
      let failGroupN   = null;
      if (_filterPass === "all") {
        const pg = segs[pKey] ?? segs[fallbackPKey];
        const fg = segs[fKey] ?? segs[fallbackFKey];
        passGroupAvg = pg?.avg_attempts ?? null;
        failGroupAvg = fg?.avg_attempts ?? null;
        passGroupN   = pg?.active_students ?? null;
        failGroupN   = fg?.active_students ?? null;
      } else if (_filterPass === "pass") {
        passGroupAvg = base.avg_attempts ?? null;
      } else {
        failGroupAvg = base.avg_attempts ?? null;
      }
      return {
        ...base,
        pass_group_avg_attempts: passGroupAvg,
        fail_group_avg_attempts: failGroupAvg,
        pass_group_active_students: passGroupN,
        fail_group_active_students: failGroupN,
      };
    });
  }

  function renderWeeklyQuiz(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_quizData) return;

    // BUG-TIME-QUIZ-4 FIX: 偵測 quiz segments 的 cluster 維度狀態，顯示正確提示
    // 區分兩種情況：
    //   A. all|{cluster}|all 不存在 → ETL 從未輸出 cluster 維度（舊版資料）→「資料未細分」
    //   B. all|{cluster}|all 存在，但 sem|{cluster}|all 不存在 → 該學期此分群人數不足（MIN_SAMPLES 過濾）→「人數不足」
    const clusterHintId = `${canvasId}_clusterHint`;
    let hintEl = document.getElementById(clusterHintId);
    if (_filterCluster !== "all") {
      const sem = _filterSemester === "all" ? "all" : _normalizeSem(_filterSemester);
      const semClusterKey  = `${sem}|${_filterCluster}|all`;
      const allClusterKey  = `all|${_filterCluster}|all`;
      const weeks_         = _quizData?.weeks || [];
      const hasAllSeg      = weeks_.some(w => allClusterKey  in (w.segments || {}));
      const hasSemSeg      = weeks_.some(w => semClusterKey  in (w.segments || {}));

      let hintMsg = null;
      if (!hasAllSeg) {
        // 情況 A：cluster 維度完全不存在（舊版 ETL，尚未細分）
        hintMsg = `⚠ 題庫作答資料尚未按資源使用細分，目前顯示為全體合併結果（${_filterCluster} 篩選中）`;
      } else if (!hasSemSeg && _filterSemester !== "all") {
        // 情況 B：全局有此資源使用資料，但選定學期的此類人數不足，無法獨立分析
        hintMsg = `ℹ 本學期 ${_filterCluster} 資源使用類人數不足，無法單獨顯示，目前以全學期合併資料替代`;
      }

      if (hintMsg) {
        if (!hintEl) {
          hintEl = document.createElement("div");
          hintEl.id = clusterHintId;
          hintEl.className = "ladash-c-time-cluster-hint";
          // BUG-PWA-OVERFLOW-3 FIX: 同 BUG-PWA-OVERFLOW-2，canvas.parentNode
          // 為固定 height:240px 的 .chart-wrap，插入 canvas 前會與 canvas
          // 搶佔同一段固定高度、擠壓圖表。改插在 wrap 外層（卡片內）。
          const wrap = canvas.parentNode;
          (wrap?.parentNode || wrap)?.insertBefore(hintEl, wrap);
        }
        hintEl.textContent = hintMsg;
      } else if (hintEl) {
        hintEl.remove();
        hintEl = null;
      }
    } else if (hintEl) {
      hintEl.remove();
    }

    const rawWeeks = _weeksForFilter();
    const weekMap = new Map(rawWeeks.map(w => [Number(w.week), w]));

    // BUGFIX-B2（0716 穿透式審查）：1121/1122/1131 為「16+2週」學制特例
    // （期中考第8週、期末考第16週；17、18週為自學週），與其餘學期慣用的
    // 「期中考第9週、期末考第18週」不同（依 ETL_fixed_v7_14_1 修正結論）。
    // 原本不分學期一律寫死 i===9/i===18 判斷考試週，對這三個學期會誤判：
    // 真正的期中/期末考週（8/16）被當成一般練習週顯示 active_students:0，
    // 而真正沒有考試的週（9/18）反而被標成考試週、bar 被隱藏，輸出錯誤分析圖。
    // 「全部年度」（_filterSemester==="all"）維持原本 9/18 判斷不變——那是
    // 跨學期彙總後 ETL 自行決定的參考週次，不屬於本次修正範圍。
    // （SIXTEEN_PLUS_TWO_SEMS 定義於模組頂層，與 examLinePlugin 共用同一份判斷）
    const { weeks: _examWeeks } = _examWeeksForCurrentFilter();
    const [midWeek, finalWeek] = _examWeeks;

    const weeks = [];
    for (let i = 1; i <= 18; i++) {
      // BUG-TIME-QUIZ-6 FIX: 這裡原本給 avg_attempts 一個預設值 0。
      // 但 _weeksForFilter() 回傳的物件在「全部年度」篩選、或特定學期缺
      // segment 時，本來就不會有 avg_attempts 這個欄位（不是「值為
      // undefined」，是整個 key 都不存在）。物件展開 {...a, ...b} 只有
      // b 「真的有」某個 key 時才會覆蓋 a 的值──b 沒有這個 key，a 的
      // 值就會原封不動留著。這裡的 0 因此永遠蓋不掉，讓
      // _weekAvgAttempts() 裡 `w.avg_attempts != null` 提早為真直接
      // 回傳 0，我們在該函式內做的人數加權平均／null 判斷完全跑不到，
      // 導致「全部年度」整條線貼底、特定學期缺 segment 的週次也顯示
      // 假的 0 而非斷點。拿掉這個預設值，讓沒有資料的週次維持
      // undefined，才能真正落到 _weekAvgAttempts() 的判斷邏輯。
      const fallback = i === midWeek || i === finalWeek
        ? { week: i, title: `第${i}週 ${i === midWeek ? "期中考" : "期末考"}`, is_exam_week: true, exam_type: i === midWeek ? "midterm" : "final", active_students: 0, overall_pass_rate: 0 }
        : { week: i, title: `第${i}週 練習題庫`, active_students: 0, overall_pass_rate: 0 };
      const merged = { ...fallback, ...(weekMap.get(i) || {}) };
      // BUGFIX-B2 續：weekMap.get(i) 若命中「頂層彙總週次」（sem 有篩選但該學期
      // 剛好無 segment 時的降級路徑，見 _weeksForFilter() 內 BUG-TIME-QUIZ-5 FIX
      // 附近的 base 分支），會帶著彙總版自己的 is_exam_week（可能是 null，如
      // 1121 的第 8/16 週在彙總表本身也不是考試週）明確蓋掉上面 fallback 剛設
      // 好的 true——物件展開只要來源「有這個 key」就會覆蓋，即使值是 null。
      // 因此 is_exam_week／exam_type／title 一律以本學期正確的 midWeek/finalWeek
      // 判斷為準，最後強制覆蓋回去，不受 weekMap 合併結果影響；其餘欄位
      // （出席人數、作答次數、及格率）仍照常採用合併後的真實資料。
      merged.is_exam_week = (i === midWeek || i === finalWeek);
      merged.exam_type = i === midWeek ? "midterm" : (i === finalWeek ? "final" : null);
      if (i === midWeek) merged.title = `第${i}週 期中考`;
      else if (i === finalWeek) merged.title = `第${i}週 期末考`;
      weeks.push(merged);
    }

    const labels = weeks.map(w => `W${w.week}`);

    // 考試週 bar 為 null（不顯示柱狀）
    // BUG-TIME-QUIZ-1 FIX: 欄位缺失時保留 null，避免 _num(null)→0
    const passAttempts = weeks.map(w =>
      w.is_exam_week ? null
        : (w.pass_group_avg_attempts != null ? _num(w.pass_group_avg_attempts) : null));
    const failAttempts = weeks.map(w =>
      w.is_exam_week ? null
        : (w.fail_group_avg_attempts != null ? _num(w.fail_group_avg_attempts) : null));
    const weekPassRate = weeks.map(w =>
      w.is_exam_week ? null
        : (w.overall_pass_rate != null ? +(_num(w.overall_pass_rate) * 100).toFixed(1) : null));

    // 全班平均折線（輔助）
    const avgAttempts  = weeks.map(w => w.is_exam_week ? null : _weekAvgAttempts(w));
    const validAttempts = avgAttempts.filter(v => v != null);
    const semAvg = validAttempts.reduce((a, b) => a + b, 0) / (validAttempts.length || 1);
    const maxStudents = Math.max(...weeks.map(w => _weekActiveStudents(w)).filter(v => v != null), 1);

    ChartRegistry.destroyById(canvasId);
    const _chart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      plugins: [examLinePlugin],
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "及格組平均作答次數",
            data: passAttempts,
            backgroundColor: "rgba(39,174,96,0.55)",
            yAxisID: "yAttempts",
            order: 2,
            barPercentage: 0.45,
            categoryPercentage: 0.8,
          },
          {
            type: "bar",
            label: "不及格組平均作答次數",
            data: failAttempts,
            backgroundColor: "rgba(231,76,60,0.55)",
            yAxisID: "yAttempts",
            order: 2,
            barPercentage: 0.45,
            categoryPercentage: 0.8,
          },
          {
            type: "line",
            label: "週及格率 (%)",
            data: weekPassRate,
            borderColor: "rgba(52,152,219,0.9)",
            backgroundColor: "rgba(52,152,219,0.08)",
            fill: false,
            tension: 0.35,
            yAxisID: "yPassRate",
            order: 1,
            pointRadius: 3,
            spanGaps: true,
          },
          {
            type: "line",
            label: "全班平均次數",
            data: avgAttempts,
            borderColor: "rgba(127,140,141,0.70)",
            backgroundColor: "transparent",
            borderDash: [4, 3],
            tension: 0.2,
            yAxisID: "yAttempts",
            order: 1,
            pointRadius: 2,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { font: { size: 10 } } },
          yAttempts: { position: "left",  title: { display: true, text: "次數", font: { size: 10 } }, min: 0 },
          yPassRate: { position: "right", title: { display: true, text: "週及格率 (%)", font: { size: 10 } }, min: 0, max: 100, grid: { drawOnChartArea: false } },
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 22, boxHeight: 10, padding: 12 } },
          tooltip: {
            callbacks: {
              title: ctx => {
                if (!ctx.length) return "";
                const w = weeks[ctx[0].dataIndex];
                const examTag = w.is_exam_week
                  ? (w.exam_type === "final" ? " 期末考週" : " 期中考週")
                  : (w.is_pre_exam ? " 考前週" : "");
                return `第 ${w.week} 週${examTag}`;
              },
              // label 回傳 undefined，統一由 afterBody 輸出，避免各 dataset 重複行
              label: () => undefined,
              afterBody: items => {
                if (!items.length) return [];
                const w = weeks[items[0].dataIndex];
                if (w.is_exam_week) return [];
                const passVal = w.pass_group_avg_attempts != null
                  ? `${_num(w.pass_group_avg_attempts).toFixed(1)} 次` : "—";
                const failVal = w.fail_group_avg_attempts != null
                  ? `${_num(w.fail_group_avg_attempts).toFixed(1)} 次` : "—";
                const rateVal = w.overall_pass_rate != null
                  ? `${(_num(w.overall_pass_rate) * 100).toFixed(1)}%` : "—";
                // BUG-TIME-QUIZ-5 FIX: 全班平均可能為 null（本週無資料），需先判斷避免算出 NaN
                const wAvg = _weekAvgAttempts(w);
                let diffStr;
                if (wAvg == null) {
                  diffStr = "本週無作答資料";
                } else {
                  const diff = wAvg - semAvg;
                  diffStr = diff >= 0
                    ? `高於均值 +${diff.toFixed(1)} 次`
                    : `低於均值 ${diff.toFixed(1)} 次`;
                }
                return [
                  `及格組: ${passVal}`,
                  `不及格組: ${failVal}`,
                  `週及格率: ${rateVal}`,
                  diffStr,
                ];
              },
              footer: ctx => {
                if (!ctx.length) return [];
                const total = _weekActiveStudents(weeks[ctx[0].dataIndex]);
                if (!total) return [];
                return [`作答人數佔峰值 ${Math.round((total / maxStudents) * 100)}%`];
              },
            },
          },
        },
      },
    });
    ChartRegistry.register(canvasId, _chart);
  }

  function _periodValues(row, exam) {
    const pre            = exam === "midterm" ? row.preMidterm : row.preFinal;
    const explicitRegular = exam === "midterm" ? row.midRegular : row.finalRegular;
    const explicitPeriod  = exam === "midterm" ? row.midPeriod  : row.finalPeriod;
    const period = explicitPeriod > 0 ? explicitPeriod : Math.max(row.totalMinutes, pre);
    const regular = explicitRegular > 0 ? explicitRegular : Math.max(period - pre, 0);
    return { pre, regular, period: Math.max(period, pre + regular, 0) };
  }

  function _prepType(row, exam, p15 = 0) {
    const { pre, period } = _periodValues(row, exam);
    if (period <= 0 || period < p15) return "low_invest";
    const preRatio = pre / period;
    if (preRatio >= 0.30) return "crammer";
    if (preRatio >= 0.10) return "consistent";
    return "early";
  }

  function _calcP15(exam) {
    // Phase D：優先讀 ETL 預聚合 segment_stats
    const segKey   = _segmentKey();
    const p15Field = exam === "midterm" ? "p15_midterm" : "p15_final";
    const segStats = _timeData?.segment_stats;
    if (segStats) {
      // 完整 key 命中
      if (segStats[segKey]?.[p15Field] != null) return segStats[segKey][p15Field];
      // 全量 fallback
      if (segStats["all|all|all"]?.[p15Field] != null) return segStats["all|all|all"][p15Field];
    }
    // fallback：原始即時排序計算
    const all = _getRowCache().all;
    const periods = all.map(r => _periodValues(r, exam).period).filter(v => v > 0).sort((a, b) => a - b);
    if (!periods.length) return 0;
    const idx = Math.floor(periods.length * 0.15);
    return periods[Math.min(idx, periods.length - 1)];
  }

  function renderPreExamIntensity(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;
    const rows = _filteredStudentRows();
    const p15Mid   = _calcP15("midterm");
    const p15Final = _calcP15("final");
    const midCounts   = PREP_TYPES.map(t => rows.filter(r => _prepType(r, "midterm", p15Mid)   === t.key).length);
    const finalCounts = PREP_TYPES.map(t => rows.filter(r => _prepType(r, "final",   p15Final)  === t.key).length);
    const allCounts   = [...midCounts, ...finalCounts];
    _renderPreExamSummary(canvas, rows, allCounts, p15Mid, p15Final);
    ChartRegistry.destroyById(canvasId);
    const _chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: PREP_TYPES.map(t => t.label),
        datasets: [
          { label: "期中考", data: midCounts,   backgroundColor: PREP_TYPES.map(t => t.color),                         borderWidth: 2, hoverOffset: 8 },
          { label: "期末考", data: finalCounts, backgroundColor: PREP_TYPES.map(t => t.color.replace("0.85", "0.45")), borderWidth: 2, hoverOffset: 8 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "50%",
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 }, padding: 12, boxWidth: 22, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              title: ctx => `${ctx[0].dataset.label}・${ctx[0].label}`,
              label: ctx => {
                const total = rows.length || 1;
                const count = ctx.raw || 0;
                return ` ${count} 人（${(count / total * 100).toFixed(1)}%）`;
              },
            },
          },
        },
      },
    });
    ChartRegistry.register(canvasId, _chart);
  }

  // CSP-TIME-1 FIX: selectStyle/selectStyle2 改用 CSS class，移除 innerHTML inline style
  const _SELECT_STYLE_ID = "__ladash-select-filter-style";
  function _injectSelectFilterStyle() {
    if (document.getElementById(_SELECT_STYLE_ID)) return;
    const CSS = `.ladash-select-filter{font-size:.76rem;padding:2px 4px;border-radius:6px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer;max-width:105px}
    .ladash-t-filter-row{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:center;gap:8px;margin-bottom:12px;padding:4px 0}
    .ladash-t-filter-lbl{font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78);white-space:nowrap}
    .ladash-t-filter-grp{display:flex;align-items:center;gap:4px;font-size:.78rem;color:var(--text-dim,#888);flex-shrink:0}
    .ladash-t-filter-sel{font-size:.78rem;padding:2px 4px;border-radius:7px;border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);color:var(--text-mid,#9aa0b8);cursor:pointer}
    .ladash-t-dim-xs{font-size:.76rem;color:var(--text-dim,#888)}
    .ladash-t-stat-card{border:1px solid rgba(110,130,165,.18);border-radius:8px;padding:7px 9px;background:var(--card-bg2,#1a1f2e)}
    .ladash-t-stat-lbl{font-size:.72rem;color:var(--text-dim,#888);line-height:1.2}
    .ladash-t-stat-val{font-weight:700;color:var(--text-mid,#4f5f78);margin-top:3px}
    .ladash-t-bold-ns{font-weight:700;flex-shrink:0}
    .ladash-t-flex-ns{display:flex;align-items:center;gap:3px;flex-shrink:0}
    .ladash-t-grid-auto{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:10px}
    .ladash-t-note-xs{margin-top:5px;font-size:.73rem;color:var(--text-dim,#999)}
    .ladash-t-chart-sub{font-weight:400;color:var(--text-dim,#888)}
    .ladash-t-pre{color:var(--text-mid,#9aa0b8);white-space:pre-line}
    .ladash-t-dot{cursor:default;transition:opacity .15s}
    .ladash-t-scroll{overflow-x:auto}
    .ladash-t-filter-panel{display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:center;gap:8px;margin-bottom:12px;padding:8px 12px;border:1px solid rgba(110,130,165,.22);border-radius:10px;background:var(--card-bg2,#1c2030);white-space:nowrap}`;
    const sentinel = document.createElement("meta");
    sentinel.id = _SELECT_STYLE_ID;
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
    el.id = _SELECT_STYLE_ID;
    const nonce = document.querySelector("meta[name=csp-nonce]")?.content || "";
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function _renderPreExamSummary(canvas, rows, counts, p15Mid, p15Final) {
    const card = canvas.closest(".chart-card") || canvas.parentElement;
    if (!card) return;
    let el = card.querySelector(".pre-exam-summary");
    if (!el) {
      el = document.createElement("div");
      el.className = "pre-exam-summary";
      card.appendChild(el);
    }
    const total    = rows.length || 1;
    const midLow   = counts[0] || 0, midCram  = counts[1] || 0;
    const finalLow = counts[4] || 0, finalCram = counts[5] || 0;
    const cardHtml = [
      ["分析人數",          `${rows.length.toLocaleString()} 人`],
      ["期中 學習低投入型",  `${midLow}  人（${(midLow  / total * 100).toFixed(1)}%）`],
      ["期中 高度衝刺型",    `${midCram} 人（${(midCram / total * 100).toFixed(1)}%）`],
      ["期末 學習低投入型",  `${finalLow}  人（${(finalLow  / total * 100).toFixed(1)}%）`],
      ["期末 高度衝刺型",    `${finalCram} 人（${(finalCram / total * 100).toFixed(1)}%）`],
    ].map(([label, value]) => `
      <div class="ladash-t-stat-card">
        <div class="ladash-t-stat-lbl">${label}</div>
        <div class="ladash-t-stat-val">${value}</div>
      </div>`).join("");
    _injectSelectFilterStyle(); // CSP-TIME-1: inject once
    const semOptions2     = [
      `<option value="all"${_filterSemester === "all" ? " selected" : ""}>全部年度</option>`,
      ..._allSemesters.map(s => `<option value="${s}"${_normalizeSem(s) === _normalizeSem(_filterSemester) ? " selected" : ""}>${_formatSemLabel(s)}</option>`),
    ].join("");
    const clusterOptions2 = [
      `<option value="all"${_filterCluster === "all" ? " selected" : ""}>全部資源使用</option>`,
      ...Object.entries(CLUSTER_NAMES).map(([k, v]) => `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${v}</option>`),
    ].join("");
    const passOptions2    = [
      `<option value="all"${_filterPass === "all" ? " selected" : ""}>全部</option>`,
      `<option value="pass"${_filterPass === "pass" ? " selected" : ""}>及格</option>`,
      `<option value="fail"${_filterPass === "fail" ? " selected" : ""}>不及格</option>`,
    ].join("");
    const filterBadge  =
      `<div class="ladash-c-filter-bar ladash-t-filterbadge">` +
      `<span class="ladash-t-bold-ns">篩選條件</span>` +
      `<label class="ladash-t-flex-ns">📅 <select id="preExamSemFilter" class="ladash-select-filter">${semOptions2}</select></label>` +
      `<label class="ladash-t-flex-ns">👥 <select id="preExamClusterFilter" class="ladash-select-filter">${clusterOptions2}</select></label>` +
      `<label class="ladash-t-flex-ns">✅ <select id="preExamPassFilter" class="ladash-select-filter">${passOptions2}</select></label>` +
      `</div>`;
    el.innerHTML =
      filterBadge +
      `<div class="ladash-t-grid-auto">${cardHtml}</div>` +
      '<div class="ladash-t-note-xs">' +
        '外圈 = 期末考；內圈 = 期中考。若資料未含考試分段時數，以總閱讀時數與考前7天時數估算，重跑 ETL 可取得精準值。' +
      '</div>';
    // 必須在 innerHTML 寫入後才呼叫，確保 DOM 已存在再附加事件監聽
    _bindFilterSelects(card);

    // TASK-B：分型定義全文已改為「?」按鈕（attachHelpButtons() 依 #preExamChart
    // 自動掛載）點擊開啟的說明彈窗，內容見 help-modal.js 的 HELP_CONTENT.preExamChart。
    // 此處僅需將隨篩選條件變動的 P15 門檻數值，就地更新進同一個物件參照，
    // 讓使用者點開「?」時看到的門檻永遠是目前篩選結果的數值。
    const p15Section = HELP_CONTENT?.preExamChart?.sections?.find(
      s => s.type === 'metric' && s.name === '本次 P15 門檻'
    );
    if (p15Section) {
      p15Section.note = `期中 ${Math.round(p15Mid)} 分鐘、期末 ${Math.round(p15Final)} 分鐘（依目前篩選條件動態計算）。`;
    }
  }

  function renderTimeSlotDonut(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;
    const rows   = _filteredStudentRows();
    const slots  = Object.keys(SLOT_LABELS);
    const values = slots.map(slot => _avg(rows.map(row => _num(row.timeSlotDistribution?.[slot]))) * 100);
    const totalDaily = _avg(rows.map(row => row.totalMinutes / Math.max(row.activeWeeks || 1, 1)));
    const card = canvas.closest(".chart-card") || canvas.parentElement;
    if (card) {
      let badgeEl = card.querySelector(".time-slot-filter-badge");
      if (!badgeEl) {
        badgeEl = document.createElement("div");
        badgeEl.className = "time-slot-filter-badge";
        // BUG-PWA-OVERFLOW-2 FIX: 原本插入 canvas.parentElement（.behavior-time-slot-wrap，
        // 固定 height:280px）內、canvas 之前，會與 canvas 搶佔同一段固定高度，
        // 導致 Chart.js 仍配置滿版 280px 給 canvas，環圈下方圖例被擠出 wrap／卡片
        // 邊界外（PWA 窄螢幕尤其明顯）。改插在 wrap 外層（卡片內、wrap 之前），
        // 讓卡片高度隨徽章內容自動撐開，不與固定高度的圖表容器互搶空間。
        const wrap = canvas.parentElement;
        (wrap?.parentElement || card).insertBefore(badgeEl, wrap);
      }
      // 與全域篩選雙向同步的 <select> 篩選列
      const semOptions     = [
        `<option value="all"${_filterSemester === "all" ? " selected" : ""}>全部年度</option>`,
        ..._allSemesters.map(s => `<option value="${s}"${_normalizeSem(s) === _normalizeSem(_filterSemester) ? " selected" : ""}>${_formatSemLabel(s)}</option>`),
      ].join("");
      const clusterOptions = [
        `<option value="all"${_filterCluster === "all" ? " selected" : ""}>全部資源使用</option>`,
        ...Object.entries(CLUSTER_NAMES).map(([k, v]) => `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${v}</option>`),
      ].join("");
      const passOptions    = [
        `<option value="all"${_filterPass === "all" ? " selected" : ""}>全部</option>`,
        `<option value="pass"${_filterPass === "pass" ? " selected" : ""}>及格</option>`,
        `<option value="fail"${_filterPass === "fail" ? " selected" : ""}>不及格</option>`,
      ].join("");
      _injectSelectFilterStyle(); // CSP-TIME-1: inject once
      badgeEl.innerHTML =
        `<div class="ladash-c-filter-bar ladash-t-filterbadge">` +
        `<span class="ladash-t-bold-ns">篩選條件</span>` +
        `<label class="ladash-t-flex-ns">📅 <select id="tsDonutSemFilter" class="ladash-select-filter">${semOptions}</select></label>` +
        `<label class="ladash-t-flex-ns">👥 <select id="tsDonutClusterFilter" class="ladash-select-filter">${clusterOptions}</select></label>` +
        `<label class="ladash-t-flex-ns">✅ <select id="tsDonutPassFilter" class="ladash-select-filter">${passOptions}</select></label>` +
        `</div>`;
      _bindFilterSelects(card);
    }
    ChartRegistry.destroyById(canvasId);
    const _chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: slots.map(s => SLOT_LABELS[s]),
        datasets: [{ data: values, backgroundColor: SLOT_COLORS, borderWidth: 2, hoverOffset: 8 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: "bottom", align: "center", labels: { boxWidth: 26, boxHeight: 10, font: { size: 12, weight: "600" }, padding: 12 } },
          tooltip: {
            callbacks: {
              label:      ctx => ` 佔比：${ctx.raw.toFixed(1)}%`,
              afterLabel: ctx => {
                if (!totalDaily) return "";
                const ratio = values[ctx.dataIndex] / 100 || 0;
                return ` 每週約 ${Math.round(ratio * totalDaily)} 分鐘`;
              },
              footer: ctx => ctx.length ? [SLOT_TIPS[slots[ctx[0].dataIndex]] || ""] : [],
            },
          },
        },
      },
    });
    ChartRegistry.register(canvasId, _chart);
  }

  // ────────────────────────────────────────────────────────────
  // 新增功能一：AI 智慧洞察 Badge
  // ────────────────────────────────────────────────────────────

  /**
   * renderAIInsightBadge(containerId)
   * 插入 id="aiInsightBadge" 的容器（由 index.html 新增）
   * 觸發條件（優先序：最嚴重的優先顯示）：
   *   1. 深夜比例 > 40% 且成績低於及格線（60分）→ 警告
   *   2. 深夜比例 > 40% 且成績及格，或成績資料尚缺 → 提示
   *   3. 深夜比例 <= 40%                   → 正向鼓勵
   */
  function renderAIInsightBadge(containerId) {
    const el = document.getElementById(containerId);
    if (!el || !_timeData) return;

    const rows = _filteredStudentRows();
    if (!rows.length) { el.innerHTML = ""; return; }

    // Phase D：優先讀 ETL 預聚合 segment_stats
    let avgLateNight, avgScore;
    const segKey  = _segmentKey();
    const segData = _timeData?.segment_stats?.[segKey];
    if (segData) {
      avgLateNight = segData.late_night_ratio_mean ?? 0;
      avgScore     = segData.avg_score ?? null;
    } else {
      // fallback：即時計算
      avgLateNight = _avg(rows.map(r => r.late_night_ratio));
      const scoredRows  = rows.filter(r => r.final_score != null || r.semester_score != null);
      const scoreValues = scoredRows.map(r => _num(r.final_score ?? r.semester_score));
      avgScore = scoreValues.length
        ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
        : null;
    }
    const lateNightPct = (avgLateNight * 100).toFixed(1);

    let icon, color, borderColor, title, message;

    if (avgLateNight > 0.4 && avgScore !== null && avgScore < PASS_THRESHOLD) {
      icon = "⚠️"; color = "rgba(231,76,60,0.12)"; borderColor = "rgba(231,76,60,0.45)";
      title = "深夜學習比例偏高，且成績低於及格線";
      message = `目前篩選群組深夜（23:00-06:00）學習比例達 ${lateNightPct}%，平均成績 ${avgScore.toFixed(1)} 分。
研究顯示（Fouh et al., 2014），集中於深夜且臨近截止日期的學習行為與較低學業表現顯著相關。
建議教師關注此群學生的學習節奏，並評估是否提前介入輔導。`;
    } else if (avgLateNight > 0.4 && avgScore !== null) {
      icon = "💡"; color = "rgba(241,196,15,0.10)"; borderColor = "rgba(241,196,15,0.40)";
      title = "觀察到較高的深夜學習比例";
      message = `目前篩選群組深夜學習比例為 ${lateNightPct}%。
雖然成績尚在及格範圍，深夜學習長期可能影響睡眠與記憶鞏固效果。
建議將部分深夜學習段落移至午後或傍晚，有助於提升學習吸收率。`;
    } else if (avgLateNight > 0.4) {
      icon = "💡"; color = "rgba(241,196,15,0.10)"; borderColor = "rgba(241,196,15,0.40)";
      title = "觀察到較高的深夜學習比例";
      message = `目前篩選群組深夜學習比例為 ${lateNightPct}%（此群組尚無可比對的成績資料）。
深夜學習長期可能影響睡眠與記憶鞏固效果。
建議將部分深夜學習段落移至午後或傍晚，有助於提升學習吸收率。`;
    } else {
      icon = "✅"; color = "rgba(46,204,113,0.08)"; borderColor = "rgba(46,204,113,0.35)";
      title = "學習時段分布健康";
      message = `目前篩選群組深夜學習比例為 ${lateNightPct}%，時間管理整體良好。
研究指出（Tabuenca et al., 2015），規律分散的學習節奏是自我調節學習能力的核心指標，
與長期學習成效正相關。`;
    }

    // UNIFY-C：改為與相關性分析 corrInfoToggleBtn 一致的摺疊格式、預設關閉，
    // 收合狀態下仍保留圖示／標題／色彩（維持一眼可辨識風險等級），
    // 展開後才顯示完整說明文字。重繪時沿用使用者上次的展開/收合狀態。
    const prevBody = el.querySelector('#timeAiInsightBody');
    const wasOpen = prevBody ? prevBody.style.display !== 'none' : false;

    el.innerHTML = `
      <div style="border-radius:5px;overflow:hidden" data-bg="${color}" data-border="${borderColor}">
        <button type="button" id="timeAiInsightToggleBtn"
          style="width:100%;text-align:left;padding:7px 10px;background:none;border:none;cursor:pointer;
                 font-size:0.78rem;color:var(--text-dim,#888);display:flex;align-items:center;gap:6px">
          <span id="timeAiInsightIcon" style="font-size:10px;color:var(--accent,#4f8ef7)">${wasOpen ? '▼' : '▶'}</span>
          ${icon} <strong style="color:var(--text,#dde3f5)">AI 洞察</strong>
          <span class="ladash-t-chart-sub">${title}</span>
          <span style="font-size:10px;opacity:0.6;margin-left:auto">點擊展開</span>
        </button>
        <div id="timeAiInsightBody" class="ladash-t-pre" style="display:${wasOpen ? 'block' : 'none'};padding:0 10px 10px 10px">${message}</div>
      </div>`;
    el.querySelectorAll("[data-bg]").forEach(function(d) {
      if (d.dataset.bg) d.style.setProperty("background", d.dataset.bg);
      if (d.dataset.border) d.style.setProperty("border-color", d.dataset.border);
    });
    // 摺疊開關由 help-modal.js 內統一的 delegated click listener 處理
    // （比照 corrInfoToggleBtn）。
  }

  // ────────────────────────────────────────────────────────────
  // 新增功能二：學習規律熱力圖（SVG，7×24）
  // ────────────────────────────────────────────────────────────

  /**
   * renderStudyHeatmap(containerId)
   * 使用 SVG 繪製 7×24 熱力圖（優先使用 ETL 預聚合的 class_heatmap_matrix）
   * 篩選器啟用時，從 students[] 即時加總 heatmap_raw（前端唯一運算點）
   * hover tooltip 顯示：星期、時段、累計分鐘 / 正規化比例
   */
  function renderStudyHeatmap(containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap || !_timeData) return;

    // 決定資料來源
    let heatmapData = {};
    const isAllFilter = (_filterSemester === "all" && _filterCluster === "all" && _filterPass === "all");

    if (isAllFilter && _timeData.class_heatmap_matrix?.raw) {
      // 無篩選：直接用 ETL 預聚合（最快）
      heatmapData = _timeData.class_heatmap_matrix.raw;
    } else {
      // Phase D：有篩選時，優先讀 segment_stats 預聚合
      const segKey  = _segmentKey();
      const segData = _timeData?.segment_stats?.[segKey];
      if (segData?.heatmap_raw) {
        heatmapData = segData.heatmap_raw;
      } else {
        // fallback：從 students[] 加總
        const rows = _filteredStudentRows();
        rows.forEach(r => {
          Object.entries(r.heatmapRaw || {}).forEach(([key, val]) => {
            heatmapData[key] = (heatmapData[key] || 0) + val;
          });
        });
      }
    }

    // 計算最大值（正規化色階）
    const vals = Object.values(heatmapData).filter(v => v > 0);
    const maxVal = vals.length ? Math.max(...vals) : 1;

    // SVG 尺寸參數
    const cellW = 22, cellH = 18;
    const labelW = 22, labelH = 20;
    const lgH = 20; // 圖例區高度（內嵌於 SVG）
    const svgW = labelW + 24 * cellW;
    const svgH = labelH + 7 * cellH + lgH;

    // 建構 SVG

    let svgParts = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" data-svg-minw="${svgW}">`,
    ];

    // 小時標籤（X 軸）
    for (let h = 0; h < 24; h++) {
      if (h % 3 === 0) {
        const x = labelW + h * cellW + cellW / 2;
        svgParts.push(`<text x="${x}" y="${labelH - 4}" text-anchor="middle" font-size="9" fill="#6b748f">${h}:00</text>`);
      }
    }

    // 星期標籤（Y 軸）＋ 格子
    WEEKDAY_LABELS.forEach((wd, wdIdx) => {
      const y = labelH + wdIdx * cellH;
      svgParts.push(`<text x="${labelW - 3}" y="${y + cellH / 2 + 4}" text-anchor="end" font-size="10" fill="#9aa0b8">${wd}</text>`);

      for (let h = 0; h < 24; h++) {
        const key = `${wdIdx}_${h}`;
        const val = heatmapData[key] || 0;
        const color = _heatColor(val, maxVal);
        const x = labelW + h * cellW;
        const mins = val > 0 ? `${Math.round(val)} 分鐘` : "無資料";
        // tip 用 JSON.stringify 確保換行符正確編碼為 \n（不含原始換行）
        const tipText = `星期${wd} ${h}:00–${h + 1}:00 | 累計學習：${mins}`;

        svgParts.push(
          `<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3"` +
          ` fill="${color}" opacity="0.9"` +
          ` data-tip="${tipText.replace(/"/g, "&quot;")}"` +
          ` class="ladash-t-dot"` +
          `/>`
        );
      }
    });

    // 圖例（右下角，內嵌於 SVG）
    const lgX = svgW - 100, lgY = svgH - lgH + 4;
    svgParts.push(`<text x="${lgX}" y="${lgY + 10}" font-size="9" fill="#6b748f">少</text>`);
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const r = Math.round(26  + t * (230 - 26));
      const g = Math.round(32  + t * (126 - 32));
      const b = Math.round(54  + (1 - t) * (219 - 54));
      svgParts.push(`<rect x="${lgX + 18 + i * 9}" y="${lgY}" width="8" height="10" rx="2" fill="rgb(${r},${g},${b})"/>`);
    }
    svgParts.push(`<text x="${lgX + 92}" y="${lgY + 10}" font-size="9" fill="#6b748f">多</text>`);

    svgParts.push("</svg>");

    wrap.innerHTML = `
      <div class="heatmap-scroll ladash-t-scroll">
        ${svgParts.join("")}
      </div>`;
    // CSP-TIME-2 FIX: SVG min-width set via DOM API (not inline style)
    const svgEl = wrap.querySelector("svg[data-svg-minw]");
    if (svgEl) {
      svgEl.style.setProperty("min-width", (svgEl.dataset.svgMinw || "300") + "px");
      svgEl.style.setProperty("font-family", "sans-serif");
      svgEl.style.setProperty("display", "block");
    }

    if (!wrap.dataset.heatmapBound) {
      wrap.dataset.heatmapBound = "1";
      wrap.addEventListener("mouseover", e => {
        const tip = e.target.dataset?.tip;
        if (tip && typeof showSvgTip === "function") showSvgTip(e, tip);
      });
      wrap.addEventListener("mouseleave", () => {
        if (typeof hideSvgTip === "function") hideSvgTip();
      });
    }
  }

  // ────────────────────────────────────────────────────────────
  // 新增功能三：24小時學習趨勢折線圖（含分群疊加）
  // ────────────────────────────────────────────────────────────

  /**
   * renderHourlyLine(canvasId)
   * X 軸：24 小時；Y 軸：正規化學習活躍度（0~1）
   * 預設顯示：全班平均
   * 可疊加：前25%高分群、及格群、不及格群
   * 篩選器有效時：從 students[] 即時加總；無篩選時使用 ETL 預聚合
   */

  function renderHourlyLine(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !_timeData) return;

    const isAllFilter = (_filterSemester === "all" && _filterCluster === "all" && _filterPass === "all");
    const cohort = _timeData.cohort_hourly || {};

    // 全班（含篩選）
    let classNorm;
    if (isAllFilter && _timeData.class_avg_hourly_distribution?.normalized) {
      classNorm = _timeData.class_avg_hourly_distribution.normalized;
    } else {
      // Phase D：有篩選時，優先讀 segment_stats 預聚合
      const segKey  = _segmentKey();
      const segData = _timeData?.segment_stats?.[segKey];
      if (segData?.hourly_raw?.length) {
        const raw   = segData.hourly_raw;
        const total = raw.reduce((a, b) => a + b, 0);
        classNorm = total > 0 ? raw.map(v => v / total) : Array(24).fill(0);
      } else {
        // fallback：從 students[] 即時加總
        const rows = _filteredStudentRows();
        const acc  = Array(24).fill(0);
        rows.forEach(r => (r.hourlyRaw || []).forEach((v, h) => { acc[h] += v; }));
        const total = acc.reduce((a, b) => a + b, 0);
        classNorm = total > 0 ? acc.map(v => v / total) : Array(24).fill(0);
      }
    }

    // 分群（只在無篩選時使用 ETL 預聚合；有篩選時暫不疊加，避免與篩選邏輯衝突）
    const datasets = [
      {
        label: "全班平均",
        data:  classNorm,
        borderColor: COHORT_COLORS.class.border,
        backgroundColor: COHORT_COLORS.class.bg,
        fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2,
      },
    ];

    if (isAllFilter) {
      if (cohort.top25?.normalized?.length) {
        datasets.push({
          label: "前25%高分群",
          data:  cohort.top25.normalized,
          borderColor: COHORT_COLORS.top25.border,
          backgroundColor: "transparent",
          fill: false, tension: 0.4, pointRadius: 2, borderWidth: 2, borderDash: [5, 3],
        });
      }
      if (cohort.pass?.normalized?.length) {
        datasets.push({
          label: "及格群",
          data:  cohort.pass.normalized,
          borderColor: COHORT_COLORS.pass.border,
          backgroundColor: "transparent",
          fill: false, tension: 0.4, pointRadius: 2, borderWidth: 1.5, borderDash: [3, 3],
        });
      }
      if (cohort.fail?.normalized?.length) {
        datasets.push({
          label: "不及格群",
          data:  cohort.fail.normalized,
          borderColor: COHORT_COLORS.fail.border,
          backgroundColor: "transparent",
          fill: false, tension: 0.4, pointRadius: 2, borderWidth: 1.5, borderDash: [2, 4],
        });
      }
    }

    ChartRegistry.destroyById(canvasId);
    const _chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: HOUR_LABELS, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            ticks: { font: { size: 10 }, maxTicksLimit: 12 },
            title: { display: true, text: "時段（小時）", font: { size: 10 }, color: "#6b748f" },
          },
          y: {
            min: 0,
            ticks: {
              font: { size: 10 },
              callback: v => `${(v * 100).toFixed(1)}%`,
            },
            title: { display: true, text: "學習活躍度（正規化）", font: { size: 10 }, color: "#6b748f" },
          },
        },
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 22, boxHeight: 8, padding: 12 } },
          tooltip: {
            callbacks: {
              title: ctx => ctx.length ? ctx[0].label : "",
              label: ctx => ` ${ctx.dataset.label}：${(ctx.raw * 100).toFixed(2)}%`,
            },
          },
        },
      },
    });
    ChartRegistry.register(canvasId, _chart);
  }

  // ── 公開 API ─────────────────────────────────────────────────
  function resetFilters() {
    _filterSemester = "all";
    _filterCluster  = "all";
    _filterPass     = "all";
    // Sync all filter selects back to "all"
    const semIds     = ["timeSemFilter",     "preExamSemFilter",     "tsDonutSemFilter"];
    const clusterIds = ["timeClusterFilter", "preExamClusterFilter", "tsDonutClusterFilter"];
    const passIds    = ["timePassFilter",    "preExamPassFilter",    "tsDonutPassFilter"];
    semIds    .forEach(id => { const el = document.getElementById(id); if (el) el.value = "all"; });
    clusterIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = "all"; });
    passIds   .forEach(id => { const el = document.getElementById(id); if (el) el.value = "all"; });
    _renderAll();
  }

  return {
    init,
    onFilterChange,
    resetFilters,
    renderWeeklyQuiz,
    renderPreExamIntensity,
    renderTimeSlotDonut,
    renderAIInsightBadge,
    renderStudyHeatmap,
    renderHourlyLine,
    reRender,
  };
})();
