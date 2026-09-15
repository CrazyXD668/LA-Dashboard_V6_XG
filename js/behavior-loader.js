/**
 * behavior-loader.js
 * Phase 2 前端非同步資料載入框架
 * 負責：lazy load JSON、masked_id join、快取管理
 *
 * [v3.0 改善]
 *   BUG-1：無界快取 → 改用容量制 LRU Map（MAX_CACHE=4）
 *   BUG-2：cache:'no-store' 與 Cache Busting 語意衝突 → 移除 no-store
 *   BUG-3：clearCache 不通知 Tab 模組 → 補 resetFilters?.() 通知
 *   WARN-1：joinByMaskedId 全量展開複製 → 僅 behavior 非 null 時展開
 *   新增：_fetchWithGzFallback（gzip → DecompressionStream → plain fallback）
 *   新增：_parseJsonSafe（NaN/Infinity 修正，抽為獨立函式）
 *
 * [v3.1 修正]
 *   BUG-LSA-1：clearCache 遺漏 BehaviorLsaTab 通知 → 補加第四個 fn
 *
 * [v3.1.1 注解補充]
 *   WARN-LOADER-1（非 bug）：_fetchWithGzFallback 方案C fallback 繞開 deadlock
 *   的方式有效：外層 _dedupe(key,...) 在 finally 已刪除 inflight，
 *   故方案C 的 fetch 不會導致自我等待。語意上此段直接 fetch 而非呼叫
 *   fetchJSON 是刻意迴避第二層 _dedupe 的設計，維持不變。
 */

const BehaviorLoader = (() => {
  // ── LRU 快取（BUG-1 修正）────────────────────────────────
  const MAX_CACHE = 10;         // 容量需 ≥ 固定 loader key 數（7個）+ 動態 warning key 預留空間
                                 // BUG-LOADER-2 FIX: 原值 4 小於固定 key 數，使用者依序瀏覽
                                 // 5+ 個分頁即觸發淘汰，導致切回先看過的分頁需重新 fetch，
                                 // 與此快取機制設計目的（避免重複 fetch）相違背。
  const _lruCache = new Map();  // 保證插入順序（ES2015+）
  // Must match sw.js BUILD_VERSION and index.html's JS ?v= parameter.
  // A new value makes every JSON request a new URL, so an older Service
  // Worker or browser HTTP cache cannot return a prior ETL result.
  const DATA_VERSION = "202609151026";

  // ── 同時請求去重（避免多個 Tab 並發初始化時重複 fetch）─────
  // 例：sub-warning 與 Tab R 的 lazyInit 可能在同一時刻
  // 都呼叫 loadWarningForCurrentTarget()，若無此機制，
  // 會在 _lruCache 尚未寫入前各自發出一次 fetch。
  const _inflight = new Map();  // key -> Promise

  async function _dedupe(key, fn) {
    if (_inflight.has(key)) return _inflight.get(key);
    const p = (async () => {
      try {
        return await fn();
      } finally {
        _inflight.delete(key);
      }
    })();
    _inflight.set(key, p);
    return p;
  }

  function _withCacheBust(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${DATA_VERSION}`;
  }

  function _lruGet(key) {
    if (!_lruCache.has(key)) return undefined;
    // 存取時移至末尾（標記為最近使用）
    const val = _lruCache.get(key);
    _lruCache.delete(key);
    _lruCache.set(key, val);
    return val;
  }

  function _lruSet(key, val) {
    if (_lruCache.has(key)) _lruCache.delete(key);
    if (_lruCache.size >= MAX_CACHE) {
      // 淘汰最舊（Map 第一個 key）
      const oldest = _lruCache.keys().next().value;
      _lruCache.delete(oldest);
      }
    _lruCache.set(key, val);
  }

  // ── JSON 安全解析（BUG-2 輔助，統一 NaN/Infinity 處理）──
  function _parseJsonSafe(text, url) {
    try {
      return JSON.parse(text);
    } catch (_) {
      const cleaned = text
        .replace(/:\s*(NaN|-?Infinity)(?=\s*[,}])/g, ": null")
        .replace(/([\[,]\s*)(NaN|-?Infinity)(?=\s*[,\]])/g, "$1null");
      try {
        const parsed = JSON.parse(cleaned);
        console.warn(`JSON ${url} contains non-standard NaN/Infinity; converted to null.`);
        return parsed;
      } catch (err) {
        throw new Error(`JSON 解析失敗：${url}（${err.message}）`);
      }
    }
  }

  /**
   * 載入單一 JSON 檔案（BUG-2 修正：移除 cache:'no-store'）
   * 瀏覽器依 Cache Busting query string 判斷是否重取，無需強制 no-store
   */
  async function fetchJSON(key, url) {
    const cached = _lruGet(key);
    if (cached !== undefined) return cached;
    return _dedupe(key, async () => {
      // 二次檢查：dedupe 等待期間可能已被其他呼叫寫入快取
      const cached2 = _lruGet(key);
      if (cached2 !== undefined) return cached2;
      // BUG-2 修正：移除 cache: "no-store"，讓 Cache Busting query string 負責版本控制
      const res = await fetch(_withCacheBust(url));
      if (!res.ok) throw new Error(`載入失敗：${url}（${res.status}）`);
      const text = await res.text();
      const parsed = _parseJsonSafe(text, url);
      _lruSet(key, parsed);
      return parsed;
    });
  }

  /**
   * 優先嘗試 .json.gz，失敗時退至 .json（plain）
   * 方案 A：伺服器送 Content-Encoding:gzip → 瀏覽器自動解壓，直接 res.text()
   * 方案 B：伺服器送裸 .gz（無 Content-Encoding）→ DecompressionStream 手動解壓
   * 方案 C：.gz 不存在或解壓失敗 → 原始 .json fallback
   *         WARN-LOADER-1：此處直接 fetch 而非呼叫 fetchJSON，
   *         是刻意迴避第二層 _dedupe 的設計（外層 _dedupe 在 finally 已釋放）。
   * 注意：Accept-Encoding 屬瀏覽器 forbidden header，無需手動設定
   */
  async function _fetchWithGzFallback(key, baseUrl) {
    const cached = _lruGet(key);
    if (cached !== undefined) return cached;

    return _dedupe(key, async () => {
      const cached2 = _lruGet(key);
      if (cached2 !== undefined) return cached2;

      const gzUrl = _withCacheBust(baseUrl + ".gz");

      try {
        const res = await fetch(gzUrl);
        if (res.ok) {
          const contentEncoding = res.headers.get("Content-Encoding");
          let text;
          if (!contentEncoding && typeof DecompressionStream !== "undefined") {
            // 方案 B：手動解壓（Chrome 80+, Firefox 113+, Safari 16.4+）
            const ds = new DecompressionStream("gzip");
            const decompressed = res.body.pipeThrough(ds);
            text = await new Response(decompressed).text();
          } else {
            text = await res.text();
          }
          const parsed = _parseJsonSafe(text, baseUrl);
          _lruSet(key, parsed);
          return parsed;
        }
      } catch (e) {
        // BUG-LOADER-3 FIX: 原版靜默吞錯誤（catch(_){}），.gz 解壓或解析失敗時
        // 除錯者完全看不到原因，只會在 fallback 也失敗時看到不相關的最終錯誤。
        // 改為留下警告線索，再繼續走方案 C fallback（行為不變，僅補可觀測性）。
        console.warn(`[BehaviorLoader] gz fetch/decompress/parse failed for ${gzUrl}，fallback to plain JSON:`, e.message);
      }

      // 方案 C：最終 fallback → 原始 .json
      console.warn(`[BehaviorLoader] gz fallback to plain JSON: ${baseUrl}`);
      const res2 = await fetch(_withCacheBust(baseUrl));
      if (!res2.ok) throw new Error(`載入失敗：${baseUrl}（${res2.status}）`);
      const text2 = await res2.text();
      const parsed2 = _parseJsonSafe(text2, baseUrl);
      _lruSet(key, parsed2);
      return parsed2;
    });
  }

  // ── 各 JSON 檔的 lazy loader ──────────────────────────────────

  const DATA_ROOT = "data/";   // 相對於 HTML 的 docs/data/ 目錄

  const loaders = {
    // behavior.json 體積最大（5.5MB），優先嘗試 .gz
    behavior:    () => _fetchWithGzFallback("behavior", DATA_ROOT + "behavior.json"),
    radar:       () => fetchJSON("radar",       DATA_ROOT + "radar_chart_data.json"),
    // PERF-1（穿透式效能審查）：correlation_matrix.json（3.6MB）、
    // time_distribution.json（11.5MB，全站最大單一檔案）改用gz-fallback。
    // .gz 由 update-dashboard-after-etl.ps1 部署時自動產生（見該腳本
    // Update-GzipCounterpart），非ETL端輸出；找不到.gz時自動退回純文字版，
    // 兩種情況前端行為完全一致，僅傳輸體積不同。
    correlation: () => _fetchWithGzFallback("correlation", DATA_ROOT + "correlation_matrix.json"),
    quiz:        () => fetchJSON("quiz",        DATA_ROOT + "quiz_behavior.json"),
    time:        () => _fetchWithGzFallback("time",        DATA_ROOT + "time_distribution.json"),
    atRisk:      () => fetchJSON("atRisk",      DATA_ROOT + "at_risk_profile.json"),
    crossAnalysis: () => fetchJSON("crossAnalysis", DATA_ROOT + "cross_analysis.json"),
    warning:     (semester) => fetchJSON(`warning_${semester}`, DATA_ROOT + `warning_${semester}.json`),
    // micro_immuno_reading_shortfall_{semester}.json（見規劃書1.5節）：
    // 基礎醫學臨床應用(一)合併課微免部分8小時教材閱讀門檻清單，比照
    // warning 同一參數化寫法。沒有.gz版本（單一課程資料量遠小於
    // warning_${semester}.json，不需要壓縮）。
    microImmunoReadingShortfall: (semester) => fetchJSON(
      `microImmunoReadingShortfall_${semester}`,
      DATA_ROOT + `micro_immuno_reading_shortfall_${semester}.json`,
    ),
    // checkpoint版（學期中進度快照）：比照上面 microImmunoReadingShortfall
    // 同一參數化寫法。查無檔案是絕大多數學期的正常情況（人工手動觸發，
    // 大部分時候未執行），呼叫端自行 try/catch 靜默處理。
    microImmunoReadingCheckpoint: (semester) => fetchJSON(
      `microImmunoReadingCheckpoint_${semester}`,
      DATA_ROOT + `micro_immuno_reading_checkpoint_${semester}.json`,
    ),
  };

  /**
   * 載入行為資料並建立 masked_id → student record 的索引
   */
  async function loadBehaviorData() {
    const data = await loaders.behavior();
    const students = data.students || [];
    const byMaskedId = new Map(
      students.map(s => [s.masked_id, s])
    );
    return { students, byMaskedId, meta: data.meta || {} };
  }

  /**
   * WARN-1 修正：joinByMaskedId 僅在 behavior 非 null 時展開，避免全量複製
   */
  function joinByMaskedId(sourceList, behaviorMap) {
    return sourceList.map(item => {
      const behavior = behaviorMap.get(item.masked_id) ?? null;
      return behavior ? { ...item, behavior } : item;
    });
  }

  // ── 載入狀態管理 ─────────────────────────────────────────

  // CSP FIX (found on exhaustive re-pass — missed in the prior round
  // because that pass only grepped the functions already touched, not
  // the whole file): `overlay.style.display` mutation is governed by
  // style-src exactly like every other `.style.xxx =` fixed elsewhere
  // in this codebase. Under a strict policy it silently no-ops, so the
  // loading overlay never actually shows or hides. Replaced with
  // classList, matching the `.is-hidden` convention already established
  // in behavior-init.js. Stylesheet needs:
  //   .loading-overlay{display:flex}  .loading-overlay.is-hidden{display:none}
  function setLoading(containerId, show) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle("is-loading", show);
    const overlay = el.querySelector(".loading-overlay");
    if (overlay) overlay.classList.toggle("is-hidden", !show);
  }

  function showError(containerId, msg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    console.error(`[BehaviorLoader.showError:${containerId}]`, msg);
    el.innerHTML = `
      <div class="alert alert-warning py-2 px-3 mt-3" role="alert">
        <small>⚠️ 資料載入失敗，請重新整理頁面；若持續發生請聯繫系統管理員。</small>
      </div>`;
  }

  /**
   * 取得「目前提前預警目標學期」。
   *
   * 設計原則（依規劃：不鎖死特定學期，以「尚未有期末成績的學期」為目標）：
   *   - 來源為 cross_analysis.json 的 meta.incomplete_semesters_excluded，
   *     此清單與 lms_etl.py Step 9 產生 warning_*.json 時使用的
   *     「incomplete_semesters 取最新一筆」邏輯一致。
   *   - 若清單為空（所有學期皆已有期末成績），回傳 null，
   *     代表目前沒有可用的提前預警資料。
   *
   * @returns {Promise<string|null>} 例如 "1142"，或 null
   */
  async function getWarningTargetSemester() {
    try {
      const cross = await loaders.crossAnalysis();
      const list = cross?.meta?.incomplete_semesters_excluded;
      if (!Array.isArray(list) || list.length === 0) return null;
      // BUG-LOADER-4 FIX: 原版用字串 sort()（字典序），僅在學期格式
      // 固定位數時恰好與數值序一致；改用數值排序消除此隱性假設。
      return [...list].sort((a, b) => Number(a) - Number(b)).at(-1);
    } catch (e) {
      console.warn("[BehaviorLoader.getWarningTargetSemester]", e);
      return null;
    }
  }

  /**
   * 載入「目前目標學期」的 warning_*.json。
   * 防線3（選項B）：優先嘗試 warning_{semester}_validated.json，
   * 不存在或失敗時 fallback 至 warning_{semester}.json。
   * 成功載入 validated 版時，設置 window._latestWarningValidation
   * 供 tab-behavior-cross.js 讀取。
   *
   * @returns {Promise<{semester: string, data: object}|null>}
   */
  async function loadWarningForCurrentTarget() {
    const semester = await getWarningTargetSemester();
    if (!semester) return null;

    // 防線3：優先嘗試 validated 版本
    // PATTERN-ANALYSIS FIX (root cause): this branch fetched directly,
    // bypassing both `_lruGet` (no cache check → always hit network even
    // when already cached) and `_dedupe` (concurrent callers — e.g.
    // sub-warning tab + Tab R lazyInit firing near-simultaneously, the
    // exact race this file's own header comment calls out as the reason
    // `_dedupe` exists — each issued their own duplicate fetch). Wrapped
    // to match `fetchJSON` / `_fetchWithGzFallback`'s established
    // cache-then-dedupe shape.
    const validatedKey = `warning_${semester}_validated`;
    const validatedUrl = DATA_ROOT + `warning_${semester}_validated.json`;
    const cachedValidated = _lruGet(validatedKey);
    if (cachedValidated !== undefined) {
      return { semester, data: cachedValidated };
    }
    const validated = await _dedupe(validatedKey, async () => {
      const cached2 = _lruGet(validatedKey);
      if (cached2 !== undefined) return cached2;
      try {
        const res = await fetch(_withCacheBust(validatedUrl));
        if (res.ok) {
          const text = await res.text();
          const data = _parseJsonSafe(text, validatedUrl);
          _lruSet(validatedKey, data);
          return data;
        }
      } catch (_) {
        // validated 版本不存在，繼續 fallback
      }
      return null;
    });

    if (validated) {
        // 設置全域快取供 tab-behavior-cross.js 使用
      const cal = validated?.meta?.validation_summary?.calibration;
      const validationDate = validated?.meta?.validation_date;
      if (cal && validationDate) {
        const highErr = cal.HIGH?.calibration_error;
        window._latestWarningValidation = {
          semester,
          date: new Date(validationDate).toLocaleDateString("zh-TW"),
          highErrorPp: highErr != null ? `${highErr >= 0 ? "+" : ""}${(highErr * 100).toFixed(1)}` : "N/A",
        };
      }
      return { semester, data: validated };
    }

    // fallback：載入一般預測版本
    const data = await loaders.warning(semester);
    return { semester, data };
  }

  // ── 公開 API ─────────────────────────────────────────────
  return {
    load: loaders,
    loadBehaviorData,
    joinByMaskedId,
    setLoading,
    showError,
    getWarningTargetSemester,
    loadWarningForCurrentTarget,
    /**
     * BUG-3 修正：clearCache 同步通知四個 Tab 模組重置內部狀態
     * BUG-LSA-1 修正：補加 BehaviorLsaTab（原版遺漏）
     * @param {boolean} notifyTabs 預設 true，傳 false 可靜默清除
     */
    clearCache: (notifyTabs = true) => {
      _lruCache.clear();
      if (notifyTabs) {
        [
          () => typeof BehaviorRadarTab       !== "undefined" && BehaviorRadarTab.resetFilters?.(),
          () => typeof BehaviorCorrelationTab !== "undefined" && BehaviorCorrelationTab.resetFilters?.(),
          () => typeof BehaviorTimeTab        !== "undefined" && BehaviorTimeTab.resetFilters?.(),
          // BUG-LSA-1 FIX: was missing — LSA tab never received cache-clear notification
          () => typeof BehaviorLsaTab         !== "undefined" && BehaviorLsaTab.resetFilters?.(),
          () => typeof BehaviorCrossTab       !== "undefined" && BehaviorCrossTab.resetFilters?.(),
        ].forEach(fn => { try { fn(); } catch (e) { console.warn("[BehaviorLoader.clearCache]", e); } });
      }
    },
  };
})();
