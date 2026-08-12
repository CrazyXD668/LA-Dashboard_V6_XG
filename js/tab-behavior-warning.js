/**
 * tab-behavior-warning.js
 *
 * Early-warning sub-tab renderer.
 * Primary load path: BehaviorLoader.loadWarningForCurrentTarget().
 * Fallback load path: flat files beside index.html, such as:
 *   cross_analysis.json
 *   warning_1142.json
 *
 * The fallback is intentional for exported/desktop previews where the JSON files
 * are not nested under docs/data/.
 */

const BehaviorWarningTab = (() => {
  let _warningData = null;
  let _semester = null;
  let _activeFilter = "ALL"; // ALL | HIGH | MEDIUM | LOW

  const APPROACH_NAMES = {
    DEEP: "Deep",
    SURFACE: "Surface",
    MODERATE: "Moderate",
  };

  const LEVEL_META = {
    HIGH: { label: "高風險", color: "#e74c3c", bg: "rgba(231,76,60,0.10)" },
    MEDIUM: { label: "中風險", color: "#e67e22", bg: "rgba(230,126,34,0.10)" },
    LOW: { label: "低風險", color: "#2ecc71", bg: "rgba(46,204,113,0.08)" },
  };

  // CSP-1 FIX: 改用 Constructable StyleSheet，移除動態 <style> 注入（不需 unsafe-inline）
  // 瀏覽器不支援時 fallback 至 <link rel="stylesheet"> 引用外部 CSS（需配合 la-dash.css）
  const STYLE_ID = "__behavior-warning-tab-style";
  const STYLE_TEXT = `
    .warning-stat-box{padding:10px 12px;border-radius:6px;background:var(--surface2,#1c2030)}
    .warning-stat-label{font-size:.75rem;font-weight:600;margin-bottom:4px}
    .warning-stat-value{font-size:1.15rem;font-weight:700;color:var(--text,#eee)}
    .warning-stat-sub{font-size:.68rem;color:var(--text-dim,#888);margin-top:2px}
    .warning-filter-btn{padding:4px 12px;border-radius:16px;cursor:pointer;font-size:.78rem;flex-shrink:0;white-space:nowrap}
    .warning-table{width:100%;border-collapse:collapse;font-size:.76rem}
    .warning-table th{text-align:left;padding:6px 8px;border-bottom:2px solid var(--border2,#2a2f45);color:var(--text-dim,#888);font-weight:600;white-space:nowrap}
    .warning-table td{padding:5px 8px;border-bottom:1px solid var(--border2,#2a2f45);white-space:nowrap}
    .warning-level-pill{padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:600}
    .warning-rule-badge{display:inline-block;padding:1px 6px;margin:1px;border-radius:4px;background:rgba(150,150,150,.15);font-size:.68rem;color:var(--text-dim,#888)}
    .warning-rule-badge--disagree{background:rgba(230,126,34,.22);color:#e67e22;font-weight:700;border:1px solid rgba(230,126,34,.55)}
    tr[data-wrow-disagree="true"]{background:rgba(230,126,34,.06)}
    .ladash-fail-text{color:#e74c3c}
    .ladash-outcome-fail{color:#e74c3c;font-weight:600}
    .ladash-outcome-pass{color:#2ecc71}
    .ladash-export-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--accent,#3498db);background:transparent;color:var(--accent,#3498db);cursor:pointer;font-size:.8rem}
    .ladash-val-td{padding:3px 8px;white-space:nowrap}
    .ladash-w-errmsg{color:#c0392b;font-size:.85rem;padding:12px}
    .ladash-w-empty{text-align:center;padding:32px 16px;color:var(--text-dim,#888);font-size:.85rem}
    .ladash-w-empty-icon{font-size:1.6rem;margin-bottom:8px;display:block}
    .ladash-w-val-box{margin-top:12px;padding:10px 12px;border-radius:6px;background:rgba(46,204,113,.06);border:1px solid rgba(46,204,113,.25)}
    .ladash-w-val-hdr{font-size:.75rem;font-weight:600;color:#2ecc71;margin-bottom:6px}
    .ladash-w-val-tbl{width:100%;font-size:.72rem;border-collapse:collapse}
    .ladash-w-th-dim{color:var(--text-dim,#888)}
    .ladash-w-th{padding:3px 8px;text-align:left;font-weight:600;white-space:nowrap}
    .ladash-w-val-note{margin-top:6px;font-size:.72rem;color:var(--text-dim,#888)}
    .ladash-w-summary-txt{font-size:.82rem;line-height:1.7}
    .ladash-w-summary-box{margin-bottom:10px;padding:8px 10px;border-radius:6px;background:rgba(100,160,255,.07);border:1px solid rgba(100,160,255,.15)}
    .ladash-w-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px}
    .ladash-w-stat-sub{font-size:.72rem;color:var(--text-dim,#888)}
    .ladash-w-no-student{font-size:.8rem;color:var(--text-dim,#888);padding:8px}
    .ladash-w-scroll{overflow-x:auto}
    .ladash-w-val-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px}
    .ladash-w-metric-card{padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid var(--border2,#2a2f45)}
    .ladash-w-metric-label{font-size:.68rem;color:var(--text-dim,#888);margin-bottom:3px}
    .ladash-w-metric-value{font-size:1rem;font-weight:700;color:var(--text,#eee)}
    .ladash-w-metric-sub{font-size:.65rem;color:var(--text-dim,#888);margin-top:2px}
    .ladash-w-auc-badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:.68rem;font-weight:600;margin-left:5px;vertical-align:middle}
    .ladash-w-coverage{display:inline-block;padding:1px 8px;border-radius:8px;font-size:.68rem;background:rgba(52,152,219,.15);color:#3498db;margin-left:6px;font-weight:600}
    .ladash-w-val-section{margin-top:10px}
    .ladash-w-val-section-title{font-size:.72rem;font-weight:600;color:var(--text-dim,#888);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
    .ladash-w-precision-pill{display:inline-block;padding:1px 6px;border-radius:8px;font-size:.7rem;font-weight:600;margin-left:4px}
  `;

  function _injectStyleOnce() {
    if (document.getElementById(STYLE_ID)) return;
    // Constructable StyleSheet（Chrome 73+, Firefox 101+, Safari 16.4+）
    if (typeof CSSStyleSheet !== "undefined" && CSSStyleSheet.prototype.replaceSync) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(STYLE_TEXT);
        document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
        // 插入哨兵節點讓 getElementById(STYLE_ID) 可偵測「已注入」
        const sentinel = document.createElement("meta");
        sentinel.id = STYLE_ID;
        sentinel.setAttribute("data-csp-adopted", "1");
        document.head.appendChild(sentinel);
        return;
      } catch (_) { /* fallback */ }
    }
    // Fallback：nonce 注入（nonce 由 HTML CSP meta / server header 提供）
    const el = document.createElement("style");
    el.id = STYLE_ID;
    const nonce = document.querySelector("meta[name=csp-nonce]")?.content || "";
    if (nonce) el.setAttribute("nonce", nonce);
    el.textContent = STYLE_TEXT;
    document.head.appendChild(el);
  }

  function _safeText(value) {
    const text = value == null ? "" : String(value);
    if (typeof escapeHtml === "function") return escapeHtml(text);
    return text.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function _pct(value) {
    return value == null || Number.isNaN(Number(value))
      ? "--"
      : `${(Number(value) * 100).toFixed(1)}%`;
  }

  function _studentRiskLevel(student) {
    return student?.risk_level_final || student?.risk_level || "LOW";
  }

  async function _fetchJson(url) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}v=${Date.now()}`);
    if (!res.ok) throw new Error(`${url} (${res.status})`);
    return res.json();
  }

  async function _fetchFirstJson(urls) {
    let lastError = null;
    for (const url of urls) {
      try {
        return { url, data: await _fetchJson(url) };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("No JSON URL candidates provided.");
  }

  function _jsonCandidates(filename) {
    return [
      `data/${filename}`,
      `../data/${filename}`,
      filename,
    ];
  }

  function _getIncompleteSemester(cross) {
    const meta = cross?.meta || {};
    const list = meta.incomplete_semesters_excluded || meta.incomplete_semesters || [];
    if (!Array.isArray(list) || list.length === 0) return null;
    return [...list].map(String).sort().at(-1);
  }

  /**
   * 從 cross_analysis.json 的 by_semester 鍵值中取出最新學期作為 fallback。
   * 適用於所有學期都已完成（incomplete_semesters_excluded 為空）的情境。
   */
  function _getLatestSemesterFromCross(cross) {
    const bySem = cross?.by_semester;
    if (!bySem || typeof bySem !== "object") return null;
    const sems = Object.keys(bySem).filter(k => /^\d{4}$/.test(k));
    if (sems.length === 0) return null;
    return sems.sort().at(-1);
  }

  /**
   * 嘗試載入指定學期的 warning JSON（優先 validated 版本）。
   * 成功時回傳 { semester, data }，失敗時回傳 null。
   */
  async function _tryLoadWarningSemester(semester) {
    // 優先嘗試 validated 版本
    try {
      const validatedResult = await _fetchFirstJson(_jsonCandidates(`warning_${semester}_validated.json`));
      if (validatedResult?.data) {
        const cal = validatedResult.data?.meta?.validation_summary?.calibration;
        const validationDate = validatedResult.data?.meta?.validation_date;
        if (cal && validationDate) {
          const highErr = cal.HIGH?.calibration_error;
          window._latestWarningValidation = {
            semester,
            date: new Date(validationDate).toLocaleDateString("zh-TW"),
            highErrorPp: highErr != null ? `${highErr >= 0 ? "+" : ""}${(highErr * 100).toFixed(1)}` : "N/A",
          };
        }
        return { semester, data: validatedResult.data };
      }
    } catch (_) {
      // validated 版本不存在，繼續 fallback
    }

    // fallback: 未驗證版本
    try {
      const warningResult = await _fetchFirstJson(_jsonCandidates(`warning_${semester}.json`));
      if (warningResult?.data) {
        return { semester, data: warningResult.data };
      }
    } catch (_) {
      // 該學期的 warning 檔案不存在
    }
    return null;
  }

  async function _loadFromFlatFiles() {
    const crossResult = await _fetchFirstJson(_jsonCandidates("cross_analysis.json"));
    const cross = crossResult.data;

    // 策略 1：從 incomplete_semesters 取得目標學期
    let semester = _getIncompleteSemester(cross);

    // 策略 2：所有學期皆已完成時，從 by_semester 取最新學期
    if (!semester) {
      semester = _getLatestSemesterFromCross(cross);
      if (semester) {
        console.info(`[BehaviorWarningTab] incomplete_semesters 為空，改用 by_semester 最新學期: ${semester}`);
      }
    }

    if (semester) {
      const result = await _tryLoadWarningSemester(semester);
      if (result) return result;
    }

    // 策略 3：上述都失敗，嘗試從 by_semester 的所有學期（由新到舊）逐一探測
    const bySem = cross?.by_semester;
    if (bySem && typeof bySem === "object") {
      const allSems = Object.keys(bySem).filter(k => /^\d{4}$/.test(k)).sort().reverse();
      for (const sem of allSems) {
        if (sem === semester) continue; // 已嘗試過
        const result = await _tryLoadWarningSemester(sem);
        if (result) return result;
      }
    }

    return null;
  }

  async function _loadWarningData() {
    if (typeof BehaviorLoader !== "undefined" && BehaviorLoader.loadWarningForCurrentTarget) {
      try {
        const result = await BehaviorLoader.loadWarningForCurrentTarget();
        if (result?.data) return result;
      } catch (err) {
        console.warn("[BehaviorWarningTab] BehaviorLoader load failed, trying flat-file fallback.", err);
      }
    }
    return _loadFromFlatFiles();
  }

  async function init() {
    _injectStyleOnce();

    let result;
    try {
      result = await _loadWarningData();
    } catch (err) {
      console.error("[BehaviorWarningTab] load error:", err);
      _renderEmpty("warning_*.json 載入失敗，請確認 cross_analysis.json 與對應學期的 warning_<學期>.json 是否和 index.html 位於同一層，或位於 docs/data/。");
      return;
    }

    if (!result) {
      _renderNoTarget();
      return;
    }

    _semester = result.semester;
    _warningData = result.data;

    if (!_warningData || !_warningData.summary) {
      _renderEmpty(`warning_${_semester}.json 結構異常，缺少 summary。`);
      return;
    }

    _activeFilter = "ALL";
    _renderAll();
  }

  function resetFilters() {
    if (!_warningData) return;
    _activeFilter = "ALL";
    _renderAll();
  }

  function reRender() {
    if (_warningData) _renderAll();
  }

  function _renderEmpty(msg) {
    const el = document.getElementById("sub-warning") || document.getElementById("warningContent");
    if (!el) return;
    el.innerHTML = `<p class="ladash-w-errmsg">${_safeText(msg)}</p>`;
  }

  function _toggleMainCards(show) {
    ["warningSummaryBanner", "warningFilterBar", "warningStudentList", "warningExportBtn"].forEach((id) => {
      const el = document.getElementById(id);
      const card = el?.closest(".chart-card");
      if (card) card.style.setProperty("display", show ? "" : "none");
    });
  }

  function _renderNoTarget() {
    _toggleMainCards(false);
    const wrap = document.getElementById("warningContent") || document.getElementById("sub-warning");
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="ladash-w-empty">
        <div class="ladash-w-empty-icon">--</div>
        目前找不到尚未完成期末成績的目標學期，因此不顯示預警資料。
      </div>`;
  }

  function _renderAll() {
    _toggleMainCards(true);
    _renderSummaryBanner();
    _renderFilterBar();
    _renderStudentList();
    _renderExportButton();
  }

  function _renderSummaryBanner() {
    const wrap = document.getElementById("warningSummaryBanner");
    if (!wrap) return;

    const m = _warningData.meta || {};
    const s = _warningData.summary || {};
    const cards = ["HIGH", "MEDIUM", "LOW"].map((level) => {
      const meta = LEVEL_META[level];
      const value = s[level] || { count: 0, historical_fail_rate_ref: null };
      return `
        <div class="warning-stat-box" data-wlevel-color="${meta.color}">
          <div class="warning-stat-label" data-wlevel-color="${meta.color}">${meta.label}</div>
          <div class="warning-stat-value">${Number(value.count || 0)} 人</div>
          <div class="warning-stat-sub">歷史參考不及格率 ${value.historical_fail_rate_ref != null ? _pct(value.historical_fail_rate_ref) : '<span class="warning-muted-note" style="color:var(--text-dim,#888)">未計算/資料不足</span>'}</div>
        </div>`;
    }).join("");

    // CSP-WARN-1 FIX: inject dynamic colors via DOM API after innerHTML
    // (applied below after full innerHTML assignment)

    let validationHtml = "";
    if ("validation_date" in m) {
      const cal  = m.validation_summary?.calibration || {};
      const auc  = m.validation_summary?.auc;
      const nWithActual = m.validation_summary?.n_with_actual ?? 0;
      const date = new Date(m.validation_date).toLocaleDateString("zh-TW");

      // 前端計算各組命中率（precision）與整體 recall
      // precision[level] = 該組 actual FAIL 數 / 該組總人數（含非預警者）
      // recall = (HIGH+MEDIUM 中的 FAIL) / 全體 FAIL
      const students = _warningData.students || [];
      const levelCounts = { HIGH: { fail: 0, total: 0 }, MEDIUM: { fail: 0, total: 0 }, LOW: { fail: 0, total: 0 } };
      let totalFail = 0, warnedFail = 0;
      students.forEach(s => {
        const lvl = _studentRiskLevel(s);
        if (s.actual_outcome === "FAIL") {
          totalFail++;
          if (lvl === "HIGH" || lvl === "MEDIUM") warnedFail++;
        }
        if (levelCounts[lvl]) {
          levelCounts[lvl].total++;
          if (s.actual_outcome === "FAIL") levelCounts[lvl].fail++;
        }
      });
      const recall = totalFail > 0 ? warnedFail / totalFail : null;
      const coveragePct = nWithActual > 0 && (m.total_students ?? 0) > 0
        ? Math.round(nWithActual / m.total_students * 100) : null;

      // AUC 等級標籤
      function _aucLabel(v) {
        if (v == null) return { text: "無法計算", color: "#888" };
        if (v >= 0.80) return { text: "優良", color: "#2ecc71" };
        if (v >= 0.70) return { text: "良好", color: "#3498db" };
        if (v >= 0.60) return { text: "尚可", color: "#e67e22" };
        return { text: "偏低", color: "#e74c3c" };
      }
      const aucInfo = _aucLabel(auc);

      const calRows = ["HIGH", "MEDIUM", "LOW"].map((level) => {
        const row = cal[level] || {};
        const err = row.calibration_error;
        const sign = err != null && err >= 0 ? "+" : "";
        const errPp = err != null ? `${sign}${(err * 100).toFixed(1)}pp` : "--";
        const errColor = err != null && Math.abs(err) > 0.05 ? "#e74c3c" : "#2ecc71";
        const prec = levelCounts[level].total > 0
          ? levelCounts[level].fail / levelCounts[level].total : null;
        const precStr = prec != null ? `${(prec * 100).toFixed(1)}%` : "--";
        const precColor = prec != null && prec >= 0.40 ? "#e74c3c" : "#e67e22";
        const n = row.n ?? levelCounts[level].total;
        return `<tr>
          <td class="ladash-val-td">${level}</td>
          <td class="ladash-val-td">${n > 0 ? n : "--"}</td>
          <td class="ladash-val-td">${_pct(row.predicted_fail_rate)}</td>
          <td class="ladash-val-td">${_pct(row.actual_fail_rate)}</td>
          <td class="ladash-val-td" data-clr="${errColor}">${errPp}</td>
          <td class="ladash-val-td" data-clr="${precColor}">${precStr}</td>
        </tr>`;
      }).join("");

      validationHtml = `
        <div class="ladash-w-val-box">
          <div class="ladash-w-val-hdr">
            ✅ 前瞻性驗證結果（${_safeText(date)}，目標學期 ${_safeText(_semester)}）
            ${coveragePct != null ? `<span class="ladash-w-coverage">覆蓋率 ${coveragePct}%</span>` : ""}
          </div>

          <div class="ladash-w-val-section">
            <div class="ladash-w-val-section-title">分組校準度</div>
            <div class="ladash-w-scroll">
              <table class="ladash-w-val-tbl">
                <thead><tr class="ladash-w-th-dim">
                  <th class="ladash-w-th">風險組</th>
                  <th class="ladash-w-th">人數</th>
                  <th class="ladash-w-th">預測不及格率</th>
                  <th class="ladash-w-th">實際不及格率</th>
                  <th class="ladash-w-th">校準誤差</th>
                  <th class="ladash-w-th">命中率</th>
                </tr></thead>
                <tbody>${calRows}</tbody>
              </table>
            </div>
            <div class="ladash-w-val-note">命中率 = 各組實際不及格人數 / 該組總人數；校準誤差 &gt;5pp 為橘紅色</div>
          </div>

          <div class="ladash-w-val-metrics">
            <div class="ladash-w-metric-card">
              <div class="ladash-w-metric-label">模型區辨力 AUC</div>
              <div class="ladash-w-metric-value" data-auc-clr="${aucInfo.color}">
                ${auc != null ? Number(auc).toFixed(3) : "N/A"}
                <span class="ladash-w-auc-badge" data-auc-badge-clr="${aucInfo.color}">${_safeText(aucInfo.text)}</span>
              </div>
              <div class="ladash-w-metric-sub">依最終風險等級排序（BAS+XGBoost 綜合判定，HIGH→風險最高）</div>
            </div>
            <div class="ladash-w-metric-card">
              <div class="ladash-w-metric-label">整體召回率（Recall）</div>
              <div class="ladash-w-metric-value">${recall != null ? `${(recall * 100).toFixed(1)}%` : "--"}</div>
              <div class="ladash-w-metric-sub">HIGH+MEDIUM 預警涵蓋的不及格學生比例（共 ${totalFail} 位不及格）</div>
            </div>
            <div class="ladash-w-metric-card">
              <div class="ladash-w-metric-label">驗證人數</div>
              <div class="ladash-w-metric-value">${nWithActual}</div>
              <div class="ladash-w-metric-sub">共 ${m.total_students ?? "--"} 位學生，${coveragePct != null ? coveragePct + "%" : "--"} 有期末成績</div>
            </div>
          </div>
        </div>`;
    }

    wrap.innerHTML = `
      <div class="ladash-w-summary-txt">
        <div class="ladash-w-summary-box">
          <strong>預警目標學期：${_safeText(_semester)}</strong> |
          學生數：${_safeText(m.total_students ?? "")} |
          ${_safeText(m.data_cutoff || "")}
        </div>
        <div class="ladash-w-stats-grid">
          ${cards}
        </div>
        <div class="ladash-w-stat-sub">
          主規則：${_safeText(m.primary_rule || "")}
          ${Array.isArray(m.secondary_rules) && m.secondary_rules.length
            ? ` | 輔助規則：${m.secondary_rules.map(r => `<span class="warning-rule-badge">${_safeText(String(r))}</span>`).join(" ")}`
            : ""}
        </div>
        <div class="ladash-w-stat-sub" style="margin-top:3px">
          參考資料：${_safeText(m.reference_data || "")}
          ${m.generated_at ? ` | 預測產生：${_safeText(new Date(m.generated_at).toLocaleString("zh-TW"))}` : ""}
        </div>
        ${validationHtml}
      </div>`;
    // CSP-WARN-1 FIX: apply dynamic colors via DOM API (not inline style)
    wrap.querySelectorAll("[data-wlevel-color]").forEach(el => {
      const color = el.dataset.wlevelColor;
      if (el.classList.contains("warning-stat-box")) el.style.setProperty("border-left", `3px solid ${color}`);
      if (el.classList.contains("warning-stat-label")) el.style.setProperty("color", color);
    });
    // CSP-WARN-5 FIX: errColor validation table td
    wrap.querySelectorAll(".ladash-val-td[data-clr]").forEach(td => {
      if (td.dataset.clr) td.style.setProperty("color", td.dataset.clr);
      td.style.setProperty("font-weight", "600");
    });
    // CSP-WARN-6 FIX: AUC metric value and badge colors via DOM API
    wrap.querySelectorAll("[data-auc-clr]").forEach(el => {
      el.style.setProperty("color", el.dataset.aucClr);
    });
    wrap.querySelectorAll(".ladash-w-auc-badge[data-auc-badge-clr]").forEach(el => {
      const c = el.dataset.aucBadgeClr;
      el.style.setProperty("color", c);
      el.style.setProperty("background", "rgba(150,150,150,.15)"); // neutral bg; color carries meaning
    });
  }

  function _renderFilterBar() {
    const wrap = document.getElementById("warningFilterBar");
    if (!wrap) return;

    const s = _warningData.summary || {};
    const total = ["HIGH", "MEDIUM", "LOW"].reduce((sum, level) => sum + Number(s[level]?.count || 0), 0);
    const options = [
      { key: "ALL", label: `全部 (${total})`, color: "var(--accent,#3498db)" },
      { key: "HIGH", label: `高風險 (${s.HIGH?.count || 0})`, color: LEVEL_META.HIGH.color },
      { key: "MEDIUM", label: `中風險 (${s.MEDIUM?.count || 0})`, color: LEVEL_META.MEDIUM.color },
      { key: "LOW", label: `低風險 (${s.LOW?.count || 0})`, color: LEVEL_META.LOW.color },
    ];

    wrap.innerHTML = options.map((option) => {
      const active = option.key === _activeFilter;
      return `<button type="button" class="warning-filter-btn" data-level="${option.key}"
        data-wf-color="${option.color}" data-wf-active="${active ? "1" : "0"}">
        ${_safeText(option.label)}
      </button>`;
    }).join("");

    // CSP-WARN-2 FIX: apply dynamic colors via DOM API
    wrap.querySelectorAll(".warning-filter-btn").forEach((btn) => {
      const color = btn.dataset.wfColor;
      const active = btn.dataset.wfActive === "1";
      btn.style.setProperty("border", `1px solid ${color}`);
      btn.style.setProperty("background", active ? color : "transparent");
      btn.style.setProperty("color", active ? "#fff" : color);
      btn.addEventListener("click", () => {
        _activeFilter = btn.dataset.level;
        _renderFilterBar();
        _renderStudentList();
      });
    });
  }

  function _renderStudentList() {
    const wrap = document.getElementById("warningStudentList");
    if (!wrap) return;

    let students = _warningData.students || [];
    if (_activeFilter !== "ALL") {
      students = students.filter((student) => _studentRiskLevel(student) === _activeFilter);
    }

    if (students.length === 0) {
      wrap.innerHTML = `<p class="ladash-w-no-student">此篩選條件沒有預警學生。</p>`;
      return;
    }

    const hasValidation = "validation_date" in (_warningData.meta || {});
    const rows = students.map((student) => {
      const combinedLevel = _studentRiskLevel(student);
      const meta = LEVEL_META[combinedLevel] || { label: combinedLevel || "--", color: "#888", bg: "rgba(150,150,150,.12)" };
      const isDisagree = student.model_disagreement === true;
      const pillLabel = isDisagree ? `${meta.label} ⚠待複核` : meta.label;
      const rules = (student.triggered_rules || [])
        .map((rule) => {
          const cls = rule === "W-MODEL-DISAGREE" ? "warning-rule-badge warning-rule-badge--disagree" : "warning-rule-badge";
          return `<span class="${cls}">${_safeText(rule)}</span>`;
        })
        .join("");

      const finalScoreCell = hasValidation
        ? `<td>${student.actual_final_score != null ? Number(student.actual_final_score).toFixed(1) : "--"}</td>`
        : "";
      const outcomeCell = hasValidation
        ? `<td>${_renderOutcome(student.actual_outcome)}</td>`
        : "";

      return `
        <tr data-wrow-color="${meta.color}" data-wrow-disagree="${isDisagree}">
          <td>${_safeText(student.masked_id)}</td>
          <td><span class="warning-level-pill" data-wpill-bg="${meta.bg}" data-wpill-color="${meta.color}">${pillLabel}</span></td>
          <td>${_safeText(student.risk_source || "--")}</td>
          <td>${_safeText(student.r_cluster)}</td>
          <td>${student.s_cluster == null ? '<span class="warning-stat-sub">未分類</span>' : _safeText(student.s_cluster)}</td>
          <td>${_safeText(APPROACH_NAMES[student.learning_approach] || student.learning_approach || "--")}</td>
          <td>${student.midterm_score != null ? Number(student.midterm_score).toFixed(1) : "--"}${student.midterm_status === "FAIL" ? ' <span class="ladash-fail-text">(不及格)</span>' : ""}</td>
          <td>${student.qmi != null ? Number(student.qmi).toFixed(3) : "--"}</td>
          <td>${student.bas_score != null ? student.bas_score.toFixed(4) : "-"}</td>
          <td>${_safeText(student.risk_level_bas || student.risk_level || "--")}</td>
          <td>${student.xgb_probability != null ? _pct(student.xgb_probability) : '<span style="color:var(--text-dim,#888)">模型未產出</span>'}</td>
          <td>${student.risk_level_xgb != null ? _safeText(student.risk_level_xgb) : '<span style="color:var(--text-dim,#888)">模型未產出</span>'}</td>
          <td>${rules}</td>
          ${finalScoreCell}${outcomeCell}
        </tr>`;
    }).join("");

    wrap.innerHTML = `
      <div class="ladash-w-scroll">
        <table class="warning-table">
          <thead>
            <tr>
              <th>學生</th><th>風險</th><th>來源</th><th>R 群</th><th>S 群</th>
              <th>學習取向</th><th>期中</th><th>QMI</th><th>BAS</th><th>BAS風險</th>
              <th>XGB機率</th><th>XGB風險</th><th>觸發規則</th>
              ${hasValidation ? "<th>期末</th><th>結果</th>" : ""}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    // CSP-WARN-3 FIX: apply row border-left and pill colors via DOM API
    wrap.querySelectorAll("tr[data-wrow-color]").forEach(tr => {
      if (tr.dataset.wrowColor) tr.style.setProperty("border-left", `3px solid ${tr.dataset.wrowColor}`);
    });
    wrap.querySelectorAll(".warning-level-pill[data-wpill-bg]").forEach(pill => {
      if (pill.dataset.wpillBg) pill.style.setProperty("background", pill.dataset.wpillBg);
      if (pill.dataset.wpillColor) pill.style.setProperty("color", pill.dataset.wpillColor);
    });
    // CSP-WARN-4 FIX: ladash-fail-text class color (injected via adoptedStyleSheets)
    _injectStyleOnce();
  }

  function _renderOutcome(outcome) {
    if (outcome === "FAIL") return '<span class="ladash-outcome-fail">不及格</span>';
    if (outcome === "PASS") return '<span class="ladash-outcome-pass">及格</span>';
    return "--";
  }

  function _renderExportButton() {
    const wrap = document.getElementById("warningExportBtn");
    if (!wrap) return;

    wrap.innerHTML = `
      <button type="button" id="warningCsvBtn" class="ladash-export-btn">
        匯出目前篩選 CSV
      </button>`;

    document.getElementById("warningCsvBtn")?.addEventListener("click", _exportCsv);
  }

  function _csvCell(value) {
    const text = value == null ? "" : String(value);
    return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function _exportCsv() {
    let students = _warningData.students || [];
    if (_activeFilter !== "ALL") {
      students = students.filter((student) => _studentRiskLevel(student) === _activeFilter);
    }

    const hasValidation = "validation_date" in (_warningData.meta || {});
    const headers = [
      "masked_id", "risk_level", "risk_level_final", "risk_level_bas", "risk_source", "model_disagreement",
      "r_cluster", "s_cluster",
      "learning_approach", "midterm_score", "midterm_status",
      "qmi", "bas_score", "xgb_probability", "risk_level_xgb", "triggered_rules",
      ...(hasValidation ? ["actual_final_score", "actual_outcome"] : []),
    ];

    const lines = [headers.join(",")];
    students.forEach((student) => {
      const row = [
        student.masked_id,
        _studentRiskLevel(student),
        student.risk_level_final ?? "",
        student.risk_level_bas ?? "",
        student.risk_source ?? "",
        student.model_disagreement === true ? "TRUE" : "FALSE",
        student.r_cluster,
        student.s_cluster,
        student.learning_approach,
        student.midterm_score ?? "",
        student.midterm_status ?? "",
        student.qmi ?? "",
        student.bas_score ?? "",
        student.xgb_probability ?? "",
        student.risk_level_xgb ?? "",
        (student.triggered_rules || []).join("; "),
        ...(hasValidation ? [
          student.actual_final_score ?? "",
          student.actual_outcome ?? "",
        ] : []),
      ].map(_csvCell);
      lines.push(row.join(","));
    });

    const csv = `\uFEFF${lines.join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `warning_${_semester}_${_activeFilter}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return { init, resetFilters, reRender };
})();
