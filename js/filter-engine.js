/**
 * filter-engine.js  v1.2.0
 * 學習分析儀表板：篩選器核心邏輯模組
 *
 * 職責：純邏輯層，不操作 DOM、不依賴 Chart.js、不依賴全域 DATA
 *   目前實際用途（見main.js三處呼叫點）：
 *   - sheet_name → program 對照（getProgram，供buildIndex/getAvailableClasses內部使用）
 *   - buildIndex()：資料載入後建立班級反查索引（效能最佳化，O(n×m)→O(班級數)）
 *   - checkEmptyResult()：篩選條件是否會產生空資料的判定與提示訊息
 *     （內部依賴isProgramAvailable／getTypeAvailability／getAvailableClasses）
 *   - isRetakerSwitchLocked()：學制選為「重修生」時鎖定重修生開關
 *
 * v1.2.0（0904）前，本模組依規格書v3.1規則一至五完整設計、匯出18個公開
 * 方法；經/systematic-debugging窮舉式審查以reachability graph逐一確認，
 * 規則一（學期→學制反灰）／規則二（學制→課程類型鎖定）／規則四（重置鏈）
 * 對應的main.js UI行為實際上由main.js自己的行內實作驅動
 * （classifyProgram()、disabledMap[suffix]等），與本模組並行、互不呼叫，
 * 故v1.2.0移除10個確認零呼叫的孤兒函式與3個僅供其使用的常數。詳見下方
 * 版本歷程與CHANGELOG docs74。
 *
 * 依賴：無（純 ES module，可直接用 <script src="..."> 載入）
 * 使用方式：FilterEngine.getProgram(sheetName) 等
 *
 * 版本歷程：
 *   v1.0.0  2026-05-13  初版，涵蓋規格書 v3.1 規則一至五
 *   v1.1.0  2026-05-27  BUG-FIX: getProgram() pattern 補齊四技/學士後護各種班名格式，與 main.js classifyProgram 對齊
 *   v1.2.0  2026-09-04  TRIM（/systematic-debugging 窮舉式審查）：移除確認
 *           零呼叫的10個函式（isRetakeStudent、getProgramAvailability、
 *           getDisabledPrograms、allowsPracticum、getClassCount、
 *           getFieldsToReset、applyResetChain、formatSemester、
 *           getSemesterHalf、buildFilterSummary）與3個常數
 *           （PROGRAM_THEORY_CLASSES、FILTER_LEVELS、FILTER_DEFAULTS）。
 *           規則一/二/四對應main.js UI行為由main.js行內實作驅動、非本模組
 *           ——保留的getProgram/isProgramAvailable/getTypeAvailability/
 *           getAvailableClasses/_normalizeSheetName皆為buildIndex／
 *           checkEmptyResult／isRetakerSwitchLocked三個實際呼叫點的直接
 *           或間接依賴，非死碼。
 */

const FilterEngine = (() => {

  // ════════════════════════════════════════════════════════
  // § 0  常數定義
  // ════════════════════════════════════════════════════════

  /**
   * 學制代碼 → 中文顯示名稱
   * 排序即規格書定義的顯示順序
   */
  const PROGRAM_LABELS = {
    '2yr_gen':         '二技一般',
    '2yr_work':        '二技在職',
    '2yr_night':       '二技夜間',
    '4yr':             '四技一般',
    'post':            '學士後護',
    'retake_class':    '重修班',
    'retake_student':  '重修生',
  };

  /** 學制顯示順序（規格書§二） */
  const PROGRAM_ORDER = Object.keys(PROGRAM_LABELS);

  /**
   * sheet_name → program 對照表
   * 規則：精確比對優先（去除前後空格、全形→半形 A-Z 統一處理）
   * 維護原則：新 sheet_name 出現時，在此表追加即可
   *
   * 確認日期：2026-05-13（依使用者逐一確認）
   */
  const SHEET_PROGRAM_MAP = {
    // ── 二技一般 ──────────────────────────────────────────
    '護21A':   '2yr_gen',
    '護21B':   '2yr_gen',
    '護21C':   '2yr_gen',
    '護21D':   '2yr_gen',
    '護21E':   '2yr_gen',
    '護二一A': '2yr_gen',
    '護二一B': '2yr_gen',
    '護二一C': '2yr_gen',
    '護二一D': '2yr_gen',
    '護二一E': '2yr_gen',
    // ── 二技夜間 ──────────────────────────────────────────
    '護21丙':   '2yr_night',
    '護21丁':   '2yr_night',
    '護二一丙': '2yr_night',
    '護二一丁': '2yr_night',
    // ── 二技在職 ──────────────────────────────────────────
    '護21甲':   '2yr_work',
    '護21乙':   '2yr_work',
    // BUG-FIX（/systematic-debugging 穿透式審查，0805）：護21戊／護21己
    // 原本誤植於「二技一般」區塊、值為 2yr_gen，與 main.js 的
    // CLASS_WORK_ORDER=['甲','乙','戊','己']、本檔§ PROGRAM_THEORY_CLASSES.
    // 2yr_work（下方已含'護二一戊','護二一己'）、以及 ETL _classify_program()
    // 的 _CLASS_WORK_SET=set("甲乙戊己") 三方權威來源互相矛盾。經比對確認
    // 戊己應歸屬二技「在職」，非二技「一般」，實際影響 113(1)/114(1) 真實
    // 在學班級的分類。
    '護21戊':  '2yr_work',
    '護21己':  '2yr_work',
    '日21甲':   '2yr_work',
    '日21乙':   '2yr_work',
    '日二一甲': '2yr_work',
    '日二一乙': '2yr_work',
    // ── 四技一般 ──────────────────────────────────────────
    // BUG-FIX（0805）：原本另列「護四一A 正課」等4組帶中間空格的重複
    // key（註記「歷史資料帶空格變體」）；_normalizeSheetName() 已改為
    // 清除全字串空白（見上方），輸入到此已不含空格，故不需要重複列舉。
    '護四一A正課':   '4yr',
    '護四一A實驗':   '4yr',
    '護四一B正課':   '4yr',
    '護四一B實驗':   '4yr',
    '護四一C正課':   '4yr',
    '護四一C實驗':   '4yr',
    '護四一D正課':   '4yr',
    '護四一D實驗':   '4yr',
    // ── 學士後護 ──────────────────────────────────────────
    '學後護41正課': 'post',
    '學後護41實驗': 'post',
    // ── 重修班 ────────────────────────────────────────────
    '暑期學分':          'retake_class',
    '微免補修(410986)':  'retake_class',
    '護二二R0遠距':      'retake_class',
  };

  /**
   * 課程類型 value → 顯示標籤
   */
  const TYPE_LABELS = {
    'theory':    '正課',
    'practicum': '實驗課',
  };

  /**
   * 規則一：學期後綴 → 不允許的學制清單
   * 上半學期 (1) 不允許 4yr；下半學期 (2) 不允許二技三學制 + 學士後護
   */
  const SEM_DISABLED_PROGRAMS = {
    '1': ['4yr'],
    '2': ['2yr_gen', '2yr_work', '2yr_night', 'post'],
  };

  /**
   * 規則二：學制 → 允許的課程類型
   * undefined 代表兩種都可選
   */
  const PROGRAM_ALLOWED_TYPES = {
    '2yr_gen':        ['theory'],
    '2yr_work':       ['theory'],
    '2yr_night':      ['theory'],
    '4yr':            ['theory', 'practicum'],
    'post':           ['theory', 'practicum'],
    'retake_class':   ['theory'],
    'retake_student': ['theory', 'practicum'],  // 依個人
  };

  // ════════════════════════════════════════════════════════
  // § 1  Sheet Name 正規化 & Program 推導
  // ════════════════════════════════════════════════════════

  /**
   * BUG-FIX（/systematic-debugging 穿透式審查，0805）：原本只 trim() 頭尾空白，
   * 字串「中間」出現空白／不斷行空格／零寬字元等（如「護四一C 正課」）完全不會
   * 被清除，只能靠 SHEET_PROGRAM_MAP 逐一列舉「帶空格變體」死記；任何未列舉到
   * 的新變體查表落空後，若又不幸插在 pattern fallback 命中的關鍵字元之間，會
   * 直接回傳 null（該班級整個從篩選器消失）。模糊測試對 285 筆真實班級 × 6種
   * 空白/不可見字元 × 逐字元插入位置，共驗出 324 處不穩定案例，均屬此因。
   * 比照 main.js cleanSheetName() 的作法：NFKC 正規化＋全字串空白/不可見字元
   * 一律移除（非僅頭尾 trim），一次徹底解決，不必窮舉空格變體。
   * NFKC 正規化本身已含全形→半形字母轉換（Ａ→A），故移除下方原本重複的
   * 全形字母 regex（比照 classCodeText() 移除重複 cleanSheetName 呼叫的
   * PERF FIX 先例）。
   */
  function _normalizeSheetName(raw) {
    if (!raw) return '';
    raw = String(raw);
    if (raw.normalize) raw = raw.normalize('NFKC');
    return raw
      .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFE00-\uFE0F\uFEFF]/g, '')
      // [BUG-FIX 穿透式審查 0914] 補上 main.js::cleanSheetName() 有、
      // 這裡原本缺漏的「破折號變體→標準連字號」正規化步驟。上方註解
      // 明講「regex 直接複製 main.js 對應判斷式，確保兩處永遠同步」，
      // 但這一步當時沒複製過來，導致兩份「永遠同步」的正規化函式其實
      // 悄悄分岔。用全部31個真實歷史成績檔驗證：目前沒有任何 sheet_name
      // 含此類破折號變體字元，此修正對既有真實資料零風險，純粹補回
      // 兩者本該同步的部分。
      .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
      .replace(/[\s\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, '');
  }

  /**
   * 從 sheet_name 推導 program code
   * 未知的 sheet_name 回傳 null（由呼叫方決定 fallback）
   * @param {string} sheetName
   * @returns {string|null}  program code 或 null
   */
  function getProgram(sheetName) {
    const normalized = _normalizeSheetName(sheetName);
    // 1. 精確比對（最高優先）
    if (SHEET_PROGRAM_MAP[normalized] !== undefined) {
      return SHEET_PROGRAM_MAP[normalized];
    }
    // 2. 去掉末尾「空格+正課/實驗課」再比對（處理「護四一A 正課」等帶空格變體）
    const stripped = normalized.replace(/\s*(正課|實驗課?|實驗)$/, '').trim();
    if (SHEET_PROGRAM_MAP[stripped] !== undefined) {
      return SHEET_PROGRAM_MAP[stripped];
    }
    // 3. Comprehensive pattern match（與 main.js classifyProgram 對齊，v1.1.0）
    // 重修相關優先
    if (/重修生/.test(stripped)) return 'retake_student';
    if (/重修|暑期|學分|補修|微免|遠距/i.test(stripped) || /R\d/i.test(stripped)) return 'retake_class';
    // 學士後護
    if (/學後護|學士後|學後/.test(stripped)) return 'post';
    // ROOT-CAUSE FIX(0815，/systematic-debugging 第四輪窮舉式稽核，預防性
    // 修復)：main.js classInfo() 對「健四二F」等非護理系特殊任務班級獨立
    // 給予 program='non_nursing'（見 main.js 約625行處的完整說明），本檔
    // 案頭註解 v1.1.0 明確記載「與 main.js classifyProgram 對齊」，但當時
    // 只補了四技/學士後護格式，漏了 0805 才新增的 non_nursing 分類，導致
    // 本函式將健四二F誤判為 null（呼叫方 fallback 成 'unknown'），而非
    // main.js 的 'non_nursing'。經查目前唯一消費者
    // checkEmptyResult()→getAvailableClasses() 對此分歧無實際影響（詳見
    // CHANGELOG 稽核記錄），純屬架構一致性的預防性修復，避免未來新增
    // 消費者時繼承此分歧、在未察覺的情況下產生不一致結果。regex 直接
    // 複製 main.js 對應判斷式，確保兩處永遠同步。
    if (/^健[〇零一二兩三四五六七八九ㄧ\d]/.test(stripped)) return 'non_nursing';
    // 二技系列（護21X / 護二一X / 日21X 等各種書寫）
    // BUG-FIX（0805）：戊己原本併入 2yr_gen 判斷式（[戊己A-Ea-e]），與
    // PROGRAM_THEORY_CLASSES.2yr_work、main.js CLASS_WORK_ORDER、ETL
    // _CLASS_WORK_SET 三方權威來源矛盾，改為併入 2yr_work（同甲乙）。
    // BUG-FIX（[一-九] Unicode range 誤用修正，0807）：一(4E00)~九(4E5D)
    // 依Unicode code point排序僅含一/三/七/九，不含二四五六八。此檔無
    // 阿拉伯數字轉換步驟，中文數字班級名稱（護二一X等）全靠這幾行比對，
    // 屬真正會被執行到的路徑（非main.js那種備援死路徑）——過去未出包
    // 純粹因為真實班級第二個數字恆為「一」（護二一/護四一，剛好落在
    // range內），改用明確列舉 [一二三四五六七八九] 徹底修正，避免日後
    // 若出現「護二二X」「護四二X」等命名被誤判。
    if (/(?:護|日|N)?2[1-9][甲乙戊己]/.test(stripped)) return '2yr_work';
    if (/(?:護|日|N)?2[1-9][丙丁]/.test(stripped)) return '2yr_night';
    if (/(?:護|日|N)?2[1-9][A-Ea-e]/.test(stripped)) return '2yr_gen';
    if (/(?:護|日|N)?二[一二三四五六七八九][甲乙戊己]/.test(stripped)) return '2yr_work';
    if (/(?:護|日|N)?二[一二三四五六七八九][丙丁]/.test(stripped)) return '2yr_night';
    if (/(?:護|日|N)?二[一二三四五六七八九][A-Ea-e]/.test(stripped)) return '2yr_gen';
    // 四技一般（護4xX / 護四xX）
    if (/(?:護|日|N)?4[1-9][A-Da-d]/.test(stripped)) return '4yr';
    if (/(?:護|日|N)?四[一二三四五六七八九][A-Da-d甲乙丙丁]/.test(stripped)) return '4yr';
    if (/^護四[一二三四五六七八九]/.test(stripped)) return '4yr';
    // 廣義 fallback
    if (/^(護|日)?\d*二一/.test(stripped)) return '2yr_gen';
    return null;
  }

  // ════════════════════════════════════════════════════════
  // § 2  規則一：學期 → 學制可用性
  // ════════════════════════════════════════════════════════

  /**
   * 指定學制在指定學期是否可用
   */
  function isProgramAvailable(semester, program) {
    if (!semester || semester === 'all') return true;
    const suffix = String(semester).slice(-1);
    const disabled = SEM_DISABLED_PROGRAMS[suffix] || [];
    return !disabled.includes(program);
  }

  // ════════════════════════════════════════════════════════
  // § 3  規則二：學制 → 課程類型可用性
  // ════════════════════════════════════════════════════════

  /**
   * 指定學制下，可選的課程類型
   * @param {string} program  'all' | '2yr_gen' | ...
   * @returns {{ theory: boolean, practicum: boolean }}
   */
  function getTypeAvailability(program) {
    if (!program || program === 'all') {
      return { theory: true, practicum: true };
    }
    const allowed = PROGRAM_ALLOWED_TYPES[program] || ['theory', 'practicum'];
    return {
      theory:    allowed.includes('theory'),
      practicum: allowed.includes('practicum'),
    };
  }

  // ════════════════════════════════════════════════════════
  // § 4  規則三：學期 + 學制 + 課程類型 → 班級清單
  // ════════════════════════════════════════════════════════

  // ── 反查索引（BUG-1 修正：O(n×m) → O(班級數)）──────────
  let _classIndex = null;  // Map<key, {sheetName, program, type, semester, count, isRetaker}>

  /**
   * 建立班級反查索引（一次性 O(n×m)，DATA 載入後呼叫一次即可）
   * 呼叫方：index.html loadData() 完成後執行 FilterEngine.buildIndex(DATA)
   * @param {object} data  全域 DATA 物件
   */
  function buildIndex(data) {
    if (!data?.class_summary) { _classIndex = new Map(); return; }
    const tmp = new Map();
    Object.values(data.class_summary).forEach(c => {
      const sn = _normalizeSheetName(c.sheet_name || '');
      if (!sn) return;
      const baseProgram = getProgram(sn);
      const sem = String(c.semester || '');
      const type = c.type || 'theory';
      const key = `${sem}|${sn}|${type}`;
      tmp.set(key, {
        sheetName: sn,
        program: baseProgram || 'unknown',
        type: type,
        semester: sem,
        count: Number(c.count || 0),
        isRetaker: baseProgram === 'retake_class' || baseProgram === 'retake_student'
      });
    });
    _classIndex = tmp;
    console.debug(`[FilterEngine] buildIndex 完成：${_classIndex.size} 個班級-學期-類型組合`);
  }

  /**
   * 從全量記錄中，依三個條件過濾出可用班級清單
   * BUG-1 修正：有索引時使用 _classIndex（O(班級數)）；無索引時 fallback 至原始全量掃描
   *
   * @param {string}   semester      'all' | '1141' 等
   * @param {string}   program       'all' | '2yr_gen' | ...
   * @param {string}   courseType    'all' | 'theory' | 'practicum'
   * @param {object}   data          全域 DATA 物件（傳入避免直接存取全域）
   * @param {boolean}  includeRetaker  是否包含重修生（規則五）
   * @returns {Array<{sheetName: string, program: string, count: number, type: string}>}
   */
  function getAvailableClasses(semester, program, courseType, data, includeRetaker = true) {
    // 規則一：學期合法性
    if (program && program !== 'all' && !isProgramAvailable(semester, program)) return [];
    // 規則二：課程類型合法性
    if (program && program !== 'all' && courseType && courseType !== 'all') {
      if (!getTypeAvailability(program)[courseType]) return [];
    }

    const _sort = arr => arr.sort((a, b) => {
      const pa = PROGRAM_ORDER.indexOf(a.program);
      const pb = PROGRAM_ORDER.indexOf(b.program);
      if (pa !== pb) return pa - pb;
      return a.sheetName.localeCompare(b.sheetName, 'zh-TW');
    });

    // ── 有索引：O(班級數) 快速路徑 ────────────────────────
    if (_classIndex) {
      const result = [];
      for (const [, entry] of _classIndex) {
        if (!includeRetaker && entry.isRetaker) continue;
        if (semester && semester !== 'all' && entry.semester !== semester) continue;
        if (!isProgramAvailable(semester, entry.program)) continue;
        if (program && program !== 'all' && entry.program !== program) continue;
        if (courseType && courseType !== 'all' && entry.type !== courseType) continue;
        if (!getTypeAvailability(entry.program)[entry.type]) continue;
        result.push(entry);
      }
      return _sort(result);
    }

    // ── 無索引：原始掃描 fallback ─────────────────────
    if (!data?.class_summary) return [];
    const classMap = new Map();
    Object.values(data.class_summary).forEach(c => {
      const sn = _normalizeSheetName(c.sheet_name || '');
      if (!sn) return;
      const baseProgram = getProgram(sn);
      const type = c.type || 'theory';
      const sem = String(c.semester || '');
      const isRetaker = baseProgram === 'retake_class' || baseProgram === 'retake_student';

      if (!includeRetaker && isRetaker) return;
      if (semester && semester !== 'all' && sem !== semester) return;
      if (!isProgramAvailable(semester, baseProgram)) return;
      if (program && program !== 'all' && baseProgram !== program) return;
      if (courseType && courseType !== 'all' && type !== courseType) return;
      if (!getTypeAvailability(baseProgram)[type]) return;

      const key = `${sn}|${type}`;
      if (!classMap.has(key)) classMap.set(key, { sheetName: sn, program: baseProgram, type: type, count: 0 });
      classMap.get(key).count += Number(c.count || 0);
    });
    return _sort([...classMap.values()]);
  }

  // ════════════════════════════════════════════════════════
  // § 6  規則五：重修生全域開關
  // ════════════════════════════════════════════════════════

  /**
   * 判斷重修生開關是否應強制鎖定為「包含」
   * 當學制選為「重修生」時強制鎖定
   * @param {string} program
   * @returns {boolean}  true = 鎖定（強制包含，不可切換）
   */
  function isRetakerSwitchLocked(program) {
    return program === 'retake_student';
  }

  // ════════════════════════════════════════════════════════
  // § 7  防空值檢查
  // ════════════════════════════════════════════════════════

  /**
   * 檢查目前篩選條件是否會產生空資料
   * @param {string} semester
   * @param {string} program
   * @param {string} courseType
   * @param {object} data
   * @param {boolean} includeRetaker
   * @returns {{ empty: boolean, reason: string|null }}
   */
  function checkEmptyResult(semester, program, courseType, data, includeRetaker = true) {
    // 規則一：學期 vs 學制衝突
    if (program && program !== 'all' && semester && semester !== 'all') {
      if (!isProgramAvailable(semester, program)) {
        const semSuffix = String(semester).slice(-1);
        const semLabel = semSuffix === '1' ? '上半學期' : '下半學期';
        return {
          empty: true,
          reason: `${PROGRAM_LABELS[program] || program} 不於${semLabel}開課`,
        };
      }
    }
    // 規則二：學制 vs 課程類型衝突
    if (program && program !== 'all' && courseType && courseType !== 'all') {
      const avail = getTypeAvailability(program);
      if (!avail[courseType]) {
        const typeLabel = TYPE_LABELS[courseType] || courseType;
        return {
          empty: true,
          reason: `${PROGRAM_LABELS[program] || program} 不開設${typeLabel}`,
        };
      }
    }
    // 實際資料量檢查（若提供 data）
    if (data) {
      const classes = getAvailableClasses(semester, program, courseType, data, includeRetaker);
      if (classes.length === 0) {
        return { empty: true, reason: '此條件組合查無資料' };
      }
    }
    return { empty: false, reason: null };
  }

  // ════════════════════════════════════════════════════════
  // § 8  公開 API
  // ════════════════════════════════════════════════════════
  // TRIM（/systematic-debugging 窮舉式審查，0904／docs74）：本模組原依
  // 規格書v3.1規則一至五設計、匯出18個公開方法，但main.js實際上僅呼叫
  // buildIndex／checkEmptyResult／isRetakerSwitchLocked三者（皆有
  // typeof-guard），其餘規則一至四對應的main.js UI行為（學期→學制反灰、
  // 學制→課程類型鎖定、重置鏈）另有main.js自己的行內實作
  // （classifyProgram()、disabledMap[suffix]等），與本模組並行、互不
  // 呼叫。以完整reachability graph（自3個實際呼叫點逆向追蹤）逐一確認
  // 零呼叫後，移除以下10個孤兒函式與3個僅供其使用的常數：
  // isRetakeStudent、getProgramAvailability、getDisabledPrograms、
  // allowsPracticum、getClassCount、getFieldsToReset、applyResetChain、
  // formatSemester、getSemesterHalf、buildFilterSummary、
  // PROGRAM_THEORY_CLASSES、FILTER_LEVELS、FILTER_DEFAULTS。
  // 保留者：getProgram／isProgramAvailable／getTypeAvailability／
  // getAvailableClasses／_normalizeSheetName皆為上述3個實際呼叫點的
  // 直接或間接依賴，非死碼。詳見CHANGELOG docs74。

  return {
    // 常數（唯讀）
    PROGRAM_LABELS,
    PROGRAM_ORDER,
    TYPE_LABELS,

    // § 1  Program 推導
    getProgram,
    normalizeSheetName: _normalizeSheetName,

    // § 2  規則一
    isProgramAvailable,

    // § 3  規則二
    getTypeAvailability,

    // § 4  規則三
    buildIndex,          // BUG-1：資料載入後呼叫一次以建立索引
    getAvailableClasses,

    // § 6  規則五
    isRetakerSwitchLocked,

    // § 7  防空值
    checkEmptyResult,
  };

})();
