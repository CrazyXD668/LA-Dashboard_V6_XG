// ══════════════════════════════════════════════════════════
// 學習分析儀表板 - 主應用邏輯
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// SECURITY HELPERS
// ══════════════════════════════════════════════════════════
/** HTML-escape for innerHTML template literals */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
/** Escape for SVG/HTML attribute values (double-quote context) */
const safeSvgAttr = escapeHtml;

// ══════════════════════════════════════════════════════════
// UTILITIES — 共用防抖動 (debounce) 工具
// ══════════════════════════════════════════════════════════
// 用途：cSearch／cSearchRetake 輸入框，避免每個按鍵都立即觸發完整搜尋＋渲染。
// 回傳函式具備 .cancel()，供「清空搜尋框」時取消尚未執行的舊查詢，避免舊查詢在
// 清空後才延遲觸發、讓已清空的畫面又跳出過期結果。
// 定位：UX 互動調整（避免下拉結果快速輸入時逐鍵閃動），非效能優化——單次搜尋掃描
// 本身已在 1-5ms 級（已決議暫不處理索引結構）。
// 放置於檔案最上方：本函式與常數被 onCRetakeSearch（PANEL C 整合控制器區塊）等
// 位於檔案較前段的程式碼使用，const 宣告必須早於所有使用點，否則會出現
// 「Cannot access before initialization」的暫時死區（TDZ）錯誤。
function debounce(fn, delay) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, delay);
  }
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}
const SEARCH_DEBOUNCE_MS = 150;

// ══════════════════════════════════════════════════════════
// CSP-COMPLIANT SVG UTILITY STYLES
// .ladash-svg-block → replaces SVG style="display:block"
// .ladash-svg-responsive → responsive SVG; height/min-width applied via DOM API post-process
// ══════════════════════════════════════════════════════════
(function _injectSvgUtilStyles() {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.ladash-svg-block{display:block}');
    document.adoptedStyleSheets = [...(document.adoptedStyleSheets || []), sheet];
  } catch (_) {
    // Fallback: nonce-aware <style> injection for older browsers
    const s = document.createElement('style');
    const nonce = document.querySelector('meta[name=csp-nonce]')?.content || '';
    if (nonce) s.setAttribute('nonce', nonce);
    s.textContent = '.ladash-svg-block{display:block}';
    document.head.appendChild(s);
  }
})();

// ══════════════════════════════════════════════════════════
// DATA & STATE
// ══════════════════════════════════════════════════════════
let DATA = null;
let bMode = 'sheet';
let dView   = 'merge';
let dMetric = 'semester_score';
let dType   = 'theory';  // 'theory' | 'practicum'

// 快取最後一次 renderSlope 的資料，供放大/縮小後重繪用
let _lastSlopeRetakers = null;

// Panel D 學期篩選狀態
let dSemMode     = 'range';   // 'range' | 'multi'
let dSemRange    = [0, 0];    // [startIdx, endIdx]（索引對應 DATA.meta.semesters）；init() 的 initDSemFilter() 會重設為 [0, maxIdx]
let dSemSelected = new Set(); // 多選模式：已選學期 value set

// ══════════════════════════════════════════════════════════
// 統一 Chart.js Tooltip 樣式
// ══════════════════════════════════════════════════════════
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(28,32,48,0.97)',
  borderColor: '#353c58',
  borderWidth: 1,
  titleColor: '#dde3f5',
  bodyColor: '#9aa0b8',
  footerColor: '#6b748f',
  padding: 10,
  cornerRadius: 8,
  titleFont: { family: "'Noto Sans TC', sans-serif", size: 12, weight: 'bold' },
  bodyFont:  { family: "'Noto Sans TC', sans-serif", size: 11 },
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  usePointStyle: true,
};
function getTooltipStyle() {
  const light = document.body.classList.contains('light');
  return {
    ...TOOLTIP_STYLE,
    backgroundColor: light ? 'rgba(255,255,255,0.97)' : 'rgba(28,32,48,0.97)',
    borderColor:     light ? '#b0b6d0' : '#353c58',
    titleColor:      light ? '#1a1d2e' : '#dde3f5',
    bodyColor:       light ? '#4a5070' : '#9aa0b8',
  };
}

/**
 * weightedAvg(rows, valFn, weightFn)
 * Compute a student-count-weighted average instead of a simple average of
 * class-level averages.  When all weights are 0 (no data), returns null.
 */
function weightedAvg(rows, valFn, weightFn = c => Number(c.count) || 1) {
  let sumW = 0, sumV = 0;
  for (const r of rows) {
    const v = valFn(r);
    if (v == null) continue;
    const w = weightFn(r);
    sumW += w;
    sumV += v * w;
  }
  return sumW > 0 ? sumV / sumW : null;
}


function cssColor(name, fallback) {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function chartTextColor() {
  return cssColor('--text', document.body.classList.contains('light') ? '#1a1d2e' : '#dde3f5');
}

function chartTextDimColor() {
  return cssColor('--text-dim', document.body.classList.contains('light') ? '#6b748f' : '#9aa0b8');
}

function resolveChartColor(value, fallback = chartTextDimColor()) {
  if (typeof value !== 'string') return value;
  const match = value.trim().match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/);
  if (!match) return value;
  return cssColor(match[1], match[2]?.trim() || fallback);
}

function normalizeChartThemeColors(config) {
  const options = config.options || {};
  if (options.color) options.color = resolveChartColor(options.color, chartTextColor());
  const plugins = options.plugins || {};
  ['legend', 'title', 'subtitle'].forEach(key => {
    const plugin = plugins[key];
    if (!plugin || typeof plugin !== 'object') return;
    if (plugin.color) plugin.color = resolveChartColor(plugin.color);
    if (plugin.labels?.color) plugin.labels.color = resolveChartColor(plugin.labels.color);
  });
  Object.values(options.scales || {}).forEach(scale => {
    if (!scale || typeof scale !== 'object') return;
    if (scale.ticks?.color) scale.ticks.color = resolveChartColor(scale.ticks.color);
    if (scale.title?.color) scale.title.color = resolveChartColor(scale.title.color);
  });
}

const CHART_DEFAULTS = {
  color: chartTextColor(),
  plugins: {
    legend: { labels: { color: chartTextDimColor(), font: { size: 11 } } },
    tooltip: getTooltipStyle(),
  },
  scales: {
    x: {
      ticks: { color: '#6b748f', font: { size: 10 } },
      grid:  { color: '#1c2030', drawTicks: false, tickLength: 0 },
      border: { display: false },
    },
    y: {
      ticks: { color: '#6b748f', font: { size: 10 } },
      grid:  { color: '#242840', drawTicks: false, tickLength: 0 },
      border: { display: false },
    }
  }
};

function smoothScaleEdges(config) {
  const scales = config.options?.scales;
  if (!scales) return;
  Object.values(scales).forEach(scale => {
    if (!scale || typeof scale !== 'object') return;
    scale.grid = { ...(scale.grid || {}), drawTicks: false, tickLength: 0 };
    scale.border = { ...(scale.border || {}), display: false };
  });
}

function refreshChartDefaults() {
  const ts = getTooltipStyle();
  const light = document.body.classList.contains('light');
  CHART_DEFAULTS.color = chartTextColor();
  CHART_DEFAULTS.plugins.tooltip = ts;
  CHART_DEFAULTS.plugins.legend.labels.color = chartTextDimColor();
  CHART_DEFAULTS.scales.x.ticks.color = '#6b748f';
  CHART_DEFAULTS.scales.x.grid.color  = light ? '#e0e4f0' : '#1c2030';
  CHART_DEFAULTS.scales.y.ticks.color = '#6b748f';
  CHART_DEFAULTS.scales.y.grid.color  = light ? '#e8eaf2' : '#242840';
}

const charts = {};
const chartConfigs = {};
let chartResizeFrame = null;
const observedChartWraps = new WeakSet();
const chartResizeObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(scheduleChartResize)
  : null;

function chartUsesCategoryX(config) {
  const xScale = config.options?.scales?.x;
  return !xScale?.type || xScale.type === 'category';
}

function chartDataLength(config) {
  const labels = config.data?.labels;
  if (Array.isArray(labels) && labels.length) return labels.length;
  if (config.type === 'scatter' || !chartUsesCategoryX(config)) return 0;
  const datasets = config.data?.datasets || [];
  return datasets.reduce((max, ds) =>
    Math.max(max, Array.isArray(ds.data) ? ds.data.length : 0), 0);
}

function estimateChartMinWidth(config, viewportWidth) {
  return Math.max(Math.floor(viewportWidth || 0), 280);
}

function availableChartWidth(wrap) {
  const rect = wrap.getBoundingClientRect();
  const docWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  const containerWidth = Math.floor(wrap.clientWidth || rect.width || docWidth || 320);
  const pageLimit = docWidth ? Math.floor(docWidth - Math.max(rect.left, 0) - 12) : containerWidth;
  return Math.max(280, Math.min(containerWidth, pageLimit || containerWidth));
}

function applyAdaptiveChartOptions(config, width) {
  const count = chartDataLength(config);
  if (chartUsesCategoryX(config) && config.options?.scales?.x) {
    const tickBudget = Math.max(3, Math.floor(width / (width < 520 ? 78 : 92)));
    const xScale = config.options.scales.x;
    config.options.scales = { ...config.options.scales };
    config.options.scales.x = {
      ...xScale,
      ticks: {
        ...(xScale.ticks || {}),
        autoSkip: true,
        maxTicksLimit: count ? Math.min(count, tickBudget) : tickBudget,
        minRotation: 0,
        maxRotation: width < 560 ? 45 : 0,
      }
    };
  }

  const legend = config.options?.plugins?.legend;
  if (legend && legend.display !== false) {
    config.options.plugins = { ...(config.options.plugins || {}) };
    config.options.plugins.legend = {
      ...legend,
      position: width < 520 ? 'bottom' : (legend.position || 'top'),
      labels: {
        ...(legend.labels || {}),
        color: (legend.labels?.color) || CHART_DEFAULTS.plugins.legend.labels.color,
        boxWidth: width < 520 ? 9 : (legend.labels?.boxWidth || 12),
        font: {
          ...(legend.labels?.font || {}),
          size: width < 520 ? 9 : (legend.labels?.font?.size || 11),
        }
      }
    };
  }
}

function prepareScrollableChart(canvas, config) {
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap) return;
  let inner = canvas.parentElement?.classList.contains('chart-scroll-inner')
    ? canvas.parentElement
    : null;
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'chart-scroll-inner';
    canvas.parentNode.insertBefore(inner, canvas);
    inner.appendChild(canvas);
  }
  const fitWidth = estimateChartMinWidth(config, availableChartWidth(wrap));
  applyAdaptiveChartOptions(config, fitWidth);
  inner.style.setProperty('width', `${fitWidth}px`);
  inner.style.setProperty('min-width', '0');
  inner.style.setProperty('max-width', '100%');
}

function resizeAllCharts() {
  // PERF-2（穿透式效能審查）：ResizeObserver 在任何 chart-wrap 從
  // display:none 變為可見時都會觸發（例如切換分頁），進而呼叫本函式。
  // 原本會遍歷 charts registry 內「所有曾經建立過的圖表」逐一
  // resize()，包含當下仍隱藏在其他分頁裡的圖表——這些圖表resize
  // 沒有任何使用者可感知的效果，純屬白工。改為先過濾掉
  // canvas.offsetParent === null（被 display:none 祖先隱藏）的項目，
  // 只處理目前實際可見的圖表。
  Object.entries(charts).forEach(([id, chart]) => {
    const canvas = document.getElementById(id);
    const config = chartConfigs[id];
    if (!canvas || !config || canvas.offsetParent === null) return;
    prepareScrollableChart(canvas, config);
    chart.resize();
  });
}

function scheduleChartResize() {
  if (chartResizeFrame) cancelAnimationFrame(chartResizeFrame);
  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = null;
    resizeAllCharts();
  });
}

function observeChartWrap(canvas) {
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap || observedChartWraps.has(wrap) || !chartResizeObserver) return;
  observedChartWraps.add(wrap);
  chartResizeObserver.observe(wrap);
}

// ARCH-NOTE（穿透式效能審查發現，0731）：本檔案的 charts{}/chartConfigs{}
// + mkChart() 是圖表生命週期管理的其中一套機制；另有 chart-registry.js 的
// ChartRegistry（tab-behavior-radar.js／time.js／correlation.js 直接用
// `new Chart(...)` + `ChartRegistry.register()`，完全繞過 mkChart()）。
// 兩套並行的結果：resizeAllCharts()（下方）只遍歷 charts{}，看不到
// ChartRegistry 追蹤的圖表；後者也因此從未套用 prepareScrollableChart()／
// observeChartWrap()（水平捲動包裝寬度計算＋自訂ResizeObserver）。
// 已實測評估此差異的實際影響：estimateChartMinWidth() 目前的實作幾乎等同
// viewportWidth（只有280px下限、並未依資料點數量加寬），故即使補上
// prepareScrollableChart()，計算出的寬度與圖表現況也不會有顯著差異；
//加上Chart.js本身responsive:true已有內建的ResizeObserver與預設
// autoSkip，缺少app自訂處理的圖表實測仍可正常渲染，並非破版等級的問題。
// 結論：此為已知的架構債，記錄於此供未來若要做更大範圍圖表系統整合時
// 參考，暫不在此輪修改，避免為了理論上的一致性而大範圍改動三個已穩定
// 運作的分頁模組、換來不成比例的regression風險。
function mkChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  config.options = { ...(config.options || {}) };
  if (config.options.responsive == null) config.options.responsive = true;
  if (config.options.maintainAspectRatio == null) config.options.maintainAspectRatio = false;
  if (config.options?.plugins?.tooltip &&
      !config.options.plugins.tooltip._custom) {
    config.options.plugins.tooltip = {
      ...getTooltipStyle(),
      ...config.options.plugins.tooltip
    };
  }
  prepareScrollableChart(ctx, config);
  smoothScaleEdges(config);
  normalizeChartThemeColors(config);
  charts[id] = new Chart(ctx, config);
  chartConfigs[id] = config;
  observeChartWrap(ctx);
  requestAnimationFrame(() => {
    charts[id]?.resize();
    attachChartExpandButtons();
  });
  return charts[id];
}

// ══════════════════════════════════════════════════════════
// SVG Tooltip 系統
// ══════════════════════════════════════════════════════════
const svgTip = document.getElementById('svgTooltip') ?? (() => {
  const el = document.createElement('div');
  el.id = 'svgTooltip';
  el.style.setProperty('display', 'none');
  document.body.appendChild(el);
  return el;
})();
let svgTipTimer = null;

function showSvgTip(evt, text) {
  clearTimeout(svgTipTimer);
  svgTip.innerHTML = '';
  text.split('\n').forEach((line, i) => {
    if (i > 0) svgTip.appendChild(document.createElement('br'));
    const boldPattern = /<b>(.*?)<\/b>/g;
    let lastIndex = 0, match;
    const span = document.createElement('span');
    while ((match = boldPattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        span.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
      }
      const b = document.createElement('b');
      b.textContent = match[1];
      span.appendChild(b);
      lastIndex = boldPattern.lastIndex;
    }
    if (lastIndex < line.length) {
      span.appendChild(document.createTextNode(line.slice(lastIndex)));
    }
    svgTip.appendChild(span);
  });
  svgTip.style.setProperty('display', 'block');
  moveSvgTip(evt);
}
function moveSvgTip(evt) {
  const margin = 14;
  const tw = svgTip.offsetWidth, th = svgTip.offsetHeight;
  // 用 visualViewport 取得 PWA 實際可視區域（已扣除 safe area 與鍵盤）
  const vw = (window.visualViewport?.width  ?? window.innerWidth)  - 8;
  const vh = (window.visualViewport?.height ?? window.innerHeight) - 8;
  let x = evt.clientX + margin, y = evt.clientY + margin;
  if (x + tw > vw) x = evt.clientX - tw - margin;  // 超右 → 翻左
  if (y + th > vh) y = evt.clientY - th - margin;  // 超下 → 翻上
  x = Math.max(8, x);  // BUG-1: 左邊界保護
  y = Math.max(8, y);  // BUG-1: 上邊界保護
  svgTip.style.setProperty('left', x + 'px');
  svgTip.style.setProperty('top', y + 'px');
}
function hideSvgTip() {
  svgTipTimer = setTimeout(() => { svgTip.style.setProperty('display', 'none'); }, 80);
}

document.addEventListener('touchstart', e => {
  if (svgTip.style.getPropertyValue('display') === 'none') return;
  if (!e.target.closest('[data-svgtip]')) svgTip.style.setProperty('display', 'none');
}, { passive: true });


function chartTitleActions(titleEl) {
  let actions = titleEl.querySelector('.chart-title-actions');
  if (!actions) {
    actions = document.createElement('span');
    actions.className = 'chart-title-actions';
    titleEl.appendChild(actions);
  }
  return actions;
}

function resizeChartsInCard(card) {
  card.querySelectorAll('canvas[id]').forEach(canvas => {
    const chart = charts[canvas.id];
    if (!chart) return;
    const config = chartConfigs[canvas.id];
    if (config) prepareScrollableChart(canvas, config);
    chart.resize();
  });
  // SVG 類圖表（箱形圖）：容器尺寸改變後重繪，讓 viewBox 基準重算
  if (card.querySelector('#boxplotWrap')) renderD();
  // SVG 坡度圖（首修 → 重修進退步）：放大/縮小後依新寬度重繪
  if (card.querySelector('#slopeChart') && _lastSlopeRetakers != null) {
    renderSlope(_lastSlopeRetakers);
  }
}

function closeExpandedChart() {
  const card = document.querySelector('.chart-card.chart-expanded');
  if (!card) return;
  const btn = card.querySelector('.chart-expand-btn.active');
  card.classList.remove('chart-expanded');
  document.body.classList.remove('chart-expanded-open');
  if (btn) {
    btn.classList.remove('active');
    btn.textContent = '⤢';
    btn.title = '放大圖表';
    btn.setAttribute('aria-label', '放大圖表');
  }
  // 與展開邏輯對稱：等 CSS transition 縮小完成後再 resize
  card.addEventListener('transitionend', function _onClose() {
    card.removeEventListener('transitionend', _onClose);
    resizeChartsInCard(card);
  }, { once: true });
  setTimeout(() => resizeChartsInCard(card), 320);  // fallback
}

function toggleChartExpanded(btn) {
  const card = btn.closest('.chart-card');
  if (!card) return;
  const willOpen = !card.classList.contains('chart-expanded');
  closeExpandedChart();
  if (!willOpen) return;
  card.classList.add('chart-expanded');
  document.body.classList.add('chart-expanded-open');
  btn.classList.add('active');
  btn.textContent = '×';
  btn.title = '縮小圖表';
  btn.setAttribute('aria-label', '縮小圖表');
  // 等 CSS transition 完成後 resize（SVG boxplot 需要正確 clientHeight）
  card.addEventListener('transitionend', function _onExpand() {
    card.removeEventListener('transitionend', _onExpand);
    resizeChartsInCard(card);
  }, { once: true });
  setTimeout(() => resizeChartsInCard(card), 320);  // fallback
}

function attachChartExpandButtons() {
  document.querySelectorAll('.chart-card').forEach(card => {
    const titleEl = card.querySelector('.chart-title');
    if (!titleEl) return;
    const existing = titleEl.querySelector('.chart-expand-btn');
    if (existing) {
      if (!existing.dataset.wired) {
        existing.dataset.wired = '1';
        existing.addEventListener('click', e => {
          e.stopPropagation();
          toggleChartExpanded(existing);
        });
      }
      return;
    }
    const hasChart = card.querySelector('canvas, svg, #heatmapWrap, #boxplotWrap, .slope-wrap');
    if (!hasChart) return;
    const btn = document.createElement('button');
    btn.className = 'chart-expand-btn';
    btn.type = 'button';
    btn.textContent = '⤢';
    btn.title = '放大圖表';
    btn.setAttribute('aria-label', '放大圖表');
    btn.dataset.wired = '1';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleChartExpanded(btn);
    });
    chartTitleActions(titleEl).appendChild(btn);
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeExpandedChart();
});

window.addEventListener('resize', scheduleChartResize);
window.addEventListener('orientationchange', scheduleChartResize);


// ══════════════════════════════════════════════════════════
// SVG Tooltip helpers
// ══════════════════════════════════════════════════════════
function addSvgTooltip(svgEl, selector, contentFn) {
  svgEl.addEventListener('mouseover', e => {
    const target = e.target.closest(selector);
    if (!target) return;
    const html = contentFn(target);
    if (html) showSvgTip(e, html);
  });
  svgEl.addEventListener('mousemove', e => {
    if (svgTip.style.display !== 'none') moveSvgTip(e);
  });
  svgEl.addEventListener('mouseleave', () => {
    clearTimeout(svgTipTimer);
    svgTip.style.setProperty('display', 'none');
  });
  svgEl.addEventListener('mouseout', e => {
    if (!e.target.closest(selector)) hideSvgTip();
  });
  svgEl.addEventListener('touchstart', e => {
    const target = e.changedTouches[0];
    const el = document.elementFromPoint(target.clientX, target.clientY);
    const match = el?.closest(selector);
    if (!match) { svgTip.style.setProperty('display','none'); return; }
    const html = contentFn(match);
    if (html) {
      showSvgTip({ clientX: target.clientX, clientY: target.clientY }, html);
      e.preventDefault();
    }
  }, { passive: false });
}

// ══════════════════════════════════════════════════════════
// LOAD DATA
// ══════════════════════════════════════════════════════════
const CLASS_LETTER_ORDER = ['A','B','C','D','E'];
const CLASS_WORK_ORDER = ['甲','乙','戊','己'];
const CLASS_NIGHT_ORDER = ['丙','丁'];

function cleanSheetName(s) {
  if (!s) return s;
  s = String(s);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFE00-\uFE0F\uFEFF]/g, '');
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  s = s.trim().replace(/[\s\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, '');
  return s;
}

function classCodeText(s) {
  // PERF FIX (/systematic-debugging 穿透式審查七)：原本這裡是 cleanSheetName(s).toUpperCase()...，
  // 但本函式僅有的2個呼叫端 classInfo()／getBaseProgram() 都已先自行 cleanSheetName(sheetName)
  // 取得 raw 才傳進來，等於對同一字串重複執行一次 Unicode NFKC normalize + 3道regex replace，
  // 對每筆班級名稱都平白多做一次相同的字串清理。cleanSheetName 具冪等性，故移除此處重複呼叫
  // 不影響結果，只省去浪費的運算。若未來新增呼叫端，請先自行 cleanSheetName() 再傳入。
  const numMap = { '零':'0','〇':'0','一':'1','ㄧ':'1','二':'2','兩':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9' };
  return s
    .toUpperCase()
    .replace(/[零〇一ㄧ二兩三四五六七八九]/g, ch => numMap[ch] ?? ch)
    .replace(/已/g, '己');
}

// PERF FIX (/systematic-debugging 穿透式審查七)：classInfo() 為純函式——輸出完全
// 由 (sheetName, semester) 決定，不讀寫任何可變外部狀態；全部9個呼叫端
// （L660/703/1017/1175/1875/2678/3573等）皆只讀取回傳物件的 .canonical/.program/.order
// 屬性、從未就地修改，故可安全以複合鍵快取並共用同一個回傳物件參照。
// 全體資料集實際 distinct(sheet_name, semester) 組合數遠小於逐筆記錄數
// （FilterEngine buildIndex 記錄約243個班級-學期-類型組合），但 getAFilteredRecords()／
// compareSheetNames() 等函式會對「每一筆記錄」或「排序比較的每一次呼叫」重新執行一次，
// 而同一組合在資料集中通常被數十位學生的記錄重複引用，故加此快取可省去絕大多數重複的
// Unicode正規化＋多道regex比對運算。快取為模組層級、無上限（key數量天生就很小，
// 不會有記憶體疑慮），比照本檔既有 _flatStudentsCache／_behaviorIndexCache 同類作法。
const _classInfoCache = new Map();
function classInfo(sheetName, semester = '') {
  const cacheKey = `${sheetName}||${semester}`;
  const cached = _classInfoCache.get(cacheKey);
  if (cached) return cached;
  const result = _classInfoCompute(sheetName, semester);
  _classInfoCache.set(cacheKey, result);
  return result;
}

function _classInfoCompute(sheetName, semester = '') {
  const raw = cleanSheetName(sheetName) || '';
  const code = classCodeText(raw);
  if (!raw) return { canonical: raw, program: '2yr_gen', order: 9999 };

  if (/重修生/.test(raw)) {
    return { canonical: '重修生', program: 'retake_student', order: 0 };
  }
  if (/重修|暑期|學分|補修|微免|遠距|R\d/i.test(raw) || /R\d/i.test(code)) {
    // BUG-FIX（跨屆比較熱力圖 問題II，0805）：原本依 code 是否命中 [24]\d
    // 決定 canonical 為「班級代碼」或「原始 raw 文字」，導致同屬重修班的
    // 「暑期學分」「微免補修(410986)」「護22R0遠距」三種原始分頁名稱
    // 各自產生不同 canonical，熱力圖出現 3 個重修班列。重修班本就無固定
    // 班級代碼可言，比照下方「重修生」單列統一寫法，一律回傳固定標籤，
    // 與 PROGRAM_LABELS.retake_class（'重修班'）一致。
    return { canonical: '重修班', program: 'retake_class', order: 5000 };
  }
  if (/學後護|學士後|學後/.test(raw)) {
    return { canonical: '學士後護', program: 'post', order: 0 };
  }

  let m = code.match(/(?:護|N|日)?2([1-9])([A-E])/i);
  if (m) {
    const section = m[2].toUpperCase();
    return {
      canonical: `護2${m[1]}${section}`,
      program: '2yr_gen',
      order: Number(m[1]) * 10 + CLASS_LETTER_ORDER.indexOf(section)
    };
  }

  m = code.match(/(?:護|日|N)?2([1-9])([甲乙丙丁戊己])/);
  if (m) {
    const section = m[2];
    const isNight = CLASS_NIGHT_ORDER.includes(section);
    const orderSet = isNight ? CLASS_NIGHT_ORDER : CLASS_WORK_ORDER;
    return {
      canonical: `護2${m[1]}${section}`,
      program: isNight ? '2yr_night' : '2yr_work',
      order: Number(m[1]) * 10 + orderSet.indexOf(section)
    };
  }

  m = code.match(/(?:護|N)?4([1-9])([A-D])/i);
  if (m) {
    const section = m[2].toUpperCase();
    return {
      canonical: `護4${m[1]}${section}`,
      program: '4yr',
      order: Number(m[1]) * 10 + CLASS_LETTER_ORDER.indexOf(section)
    };
  }

  // BUG-FIX（跨屆比較熱力圖 問題I，0805）：健四二F（國際護理管理學士班，
  // 特殊任務班級，非護理系班級）原始 Excel 分頁名稱於不同學期夾帶不一致
  // 的課程代碼括號後綴（如 100(1) 學期的"(423429)"）或前後空白／不斷行空格，
  // cleanSheetName 只清空白不清括號後綴，導致「健四二F」與「健四二F(423429)」
  // 被當成 2 個不同 canonical，熱力圖出現重複列。此處去除結尾括號後綴／
  // 正課／實驗課字樣（比照本函式上方 2yr/4yr 班級「code 部分比對、忽略結尾
  // 文字」的既有作法），使各學期一律合併為同一 canonical「健四二F」單列。
  //
  // BUG-FIX（護理系統計污染修正，0805第三次）：先前 program 仍落入下方
  // 通用 fallback、依學期尾數猜成 2yr_gen/4yr，導致該班成績在 Panel D
  // 學制篩選＝「全部」時被算進「護理系」的加權平均分／及格率／人數／
  // 學制數／盒鬚圖／人數vs及格率回歸散點等統計聚合（選特定護理系學制
  // 時不受影響，因為 program 比對本就不會命中）。使用者確認：該班成績
  // 僅作為歷史紀錄保留（熱力圖／班級明細表／各班獨立趨勢線仍應顯示），
  // 但不應列入任何「護理系」統計聚合。故獨立給予專屬 program
  // 'non_nursing'，且刻意不加入 PROGRAM_ORDER，使絕大多數以 PROGRAM_ORDER
  // 或 filterProg 比對的統計聚合自然排除它（programOrderIndex() 對不在
  // PROGRAM_ORDER 內的值已有防禦性 fallback＝99，排序上也會自然排到最後）。
  // 仍有4處未經過 PROGRAM_ORDER 比對、需個別加註排除，見各自修改處：
  // renderD() 的 dStats 加權平均迴圈與「學制數」卡片、renderDTrendMerge()
  // 「全部學制」分支、renderCorrelation() 人數vs及格率散點。
  if (/^健[〇零一二兩三四五六七八九ㄧ\d]/.test(raw)) {
    return {
      canonical: raw.replace(/[（(][^）)]*[）)]$/, '').replace(/(正課|實驗課|實驗)$/, ''),
      program: 'non_nursing',
      order: 9500
    };
  }

  const semType = semester ? String(semester).slice(-1) : '';
  return {
    canonical: raw,
    program: semType === '2' ? '4yr' : '2yr_gen',
    order: 9000
  };
}

function getBaseProgram(sheetName) {
  const raw = cleanSheetName(sheetName) || '';
  const code = classCodeText(raw);

  if (/學後護|學士後|學後/.test(raw)) return 'post';

  let m = code.match(/(?:護|N|日)?2([1-9])([A-E])/i);
  if (m) return '2yr_gen';

  m = code.match(/(?:護|日|N)?2([1-9])([甲乙丙丁戊己])/);
  if (m) {
    const isNight = CLASS_NIGHT_ORDER.includes(m[2]);
    return isNight ? '2yr_night' : '2yr_work';
  }

  m = code.match(/(?:護|N)?4([1-9])([A-D])/i);
  if (m) return '4yr';

  // BUG-FIX（[一-九] Unicode range 誤用修正，0807）：一(4E00)~九(4E5D)依
  // Unicode code point排序僅含一/三/七/九，不含二四五六八（非依語意順序）。
  // 此2行為 code（阿拉伯數字版）比對失敗後的 raw 中文數字備援，實務上
  // dead-in-practice（classCodeText 已將所有中文數字正確轉換，code比對
  // 必定先成功），但仍改用明確列舉 [一二三四五六七八九] 徹底修正，避免
  // 日後邏輯調整使此分支變為必經路徑時，殘留 Unicode range 誤用的地雷。
  if (/(?:護|日|N)?2[1-9]/.test(code) || /二[一二三四五六七八九]/.test(raw)) return '2yr_gen';
  if (/(?:護|日|N)?4[1-9]/.test(code) || /四[一二三四五六七八九]/.test(raw)) return '4yr';

  return 'unknown';
}

function normalizeSheet(s) {
  return classInfo(s).canonical;
}

const PROGRAM_ORDER = ['2yr_gen','2yr_work','2yr_night','4yr','post','retake_class','retake_student'];
// 'non_nursing'（健四二F等非護理系班級）刻意不列入 PROGRAM_ORDER：
// 所有以 PROGRAM_ORDER 或 filterProg 做統計聚合的圖表/卡片會自然排除它，
// 只保留在 canonical 層級（熱力圖／班級明細表／各班獨立趨勢線）作歷史紀錄。
const PROGRAM_LABELS = {
  '2yr_gen':        '二技一般',
  '2yr_work':       '二技在職',
  '2yr_night':      '二技夜間',
  '4yr':            '四技一般',
  'post':           '學士後護',
  'retake_class':   '重修班',
  'retake_student': '重修生',
  'non_nursing':    '非護理系（歷史紀錄）',
};
const PROGRAM_COLORS = {
  '2yr_gen':        '#4f8ef7',
  '2yr_work':       '#64d4a8',
  '2yr_night':      '#f7a44f',
  '4yr':            '#e06c8c',
  'post':           '#be78f0',
  'retake_class':   '#f0c85b',
  'retake_student': '#a0b0c0',
  'non_nursing':    '#7a7a7a',
};

/**
 * normalizeProgramFilter(value)
 * Accepts either an English program key (e.g. '4yr') or its Chinese label
 * (e.g. '四技一般') and always returns the English key, or 'all' for blanks.
 * This handles HTML <option value> set to Chinese text instead of the key.
 */
function normalizeProgramFilter(value) {
  if (!value || value === 'all') return 'all';
  if (PROGRAM_LABELS[value] != null) return value; // already an English key
  // Try reverse-lookup from Chinese label
  const found = Object.entries(PROGRAM_LABELS).find(([, lbl]) => lbl === value);
  return found ? found[0] : value;
}

function programOrderIndex(program) {
  const idx = PROGRAM_ORDER.indexOf(program);
  return idx >= 0 ? idx : 99;
}

function compareSheetNames(a, b) {
  const ia = classInfo(a), ib = classInfo(b);
  const programOrder = programOrderIndex(ia.program) - programOrderIndex(ib.program);
  if (programOrder !== 0) return programOrder;
  if (ia.order !== ib.order) return ia.order - ib.order;
  return ia.canonical.localeCompare(ib.canonical, 'zh-TW', { numeric: true });
}

function compareClassRecords(a, b) {
  return a.semester.localeCompare(b.semester)
    || compareSheetNames(a.sheet_name, b.sheet_name)
    || (a.type || '').localeCompare(b.type || '');
}

function mergeClassSummary(target, source) {
  const weightedFields = ['avg_midterm', 'avg_final', 'avg_semester', 'pass_rate', 'retaker_ratio'];
  const sameSummary = target.count === source.count
    && weightedFields.every(k => target[k] === source[k]);

  if (!sameSummary) {
    const countA = Number(target.count) || 0;
    const countB = Number(source.count) || 0;
    const total = countA + countB;
    weightedFields.forEach(k => {
      if (target[k] == null) target[k] = source[k] ?? null;
      else if (source[k] != null && total > 0) target[k] = +(((target[k] * countA) + (source[k] * countB)) / total).toFixed(2);
    });
    if (Array.isArray(target.score_distribution) && Array.isArray(source.score_distribution)) {
      target.score_distribution = target.score_distribution.map((v, i) => v + (source.score_distribution[i] || 0));
    }
    target.count = total || target.count || source.count;
  }

  Object.keys(source).forEach(k => {
    if (target[k] == null && source[k] != null) target[k] = source[k];
  });
}

function normalizeData() {
  // 驗證必要頂層欄位
  const REQUIRED = ['class_summary', 'students', 'meta'];
  const missing = REQUIRED.filter(k => !DATA || typeof DATA[k] !== 'object' || DATA[k] === null);
  if (missing.length) {
    throw new Error(`data.json 格式不符：缺少必要欄位 [${missing.join(', ')}]。請重新執行 ETL。`);
  }
  if (!Array.isArray(DATA.meta.semesters) || DATA.meta.semesters.length === 0) {
    throw new Error('data.json 格式不符：meta.semesters 必須為非空陣列。請重新執行 ETL。');
  }

  const newCS = {};
  for (const val of Object.values(DATA.class_summary)) {
    const normName = normalizeSheet(val.sheet_name);
    val.sheet_name = normName;
    const normType = val.type || 'all';
    const normKey = `${val.semester}_${normName}_${normType}`;
    if (newCS[normKey]) {
      mergeClassSummary(newCS[normKey], val);
    } else {
      newCS[normKey] = val;
    }
  }
  DATA.class_summary = newCS;

  if (!Array.isArray(DATA.meta.incomplete_grade_semesters)) {
    DATA.meta.incomplete_grade_semesters = inferIncompleteGradeSemestersFromClassSummary(DATA.class_summary);
  }

  if (DATA.students) {
    for (const stu of Object.values(DATA.students)) {
      if (stu.records) {
        stu.records.forEach(r => { r.sheet_name = normalizeSheet(r.sheet_name); });
      }
    }
  }
}

function inferIncompleteGradeSemestersFromClassSummary(classSummary) {
  const bySem = {};
  Object.values(classSummary || {}).forEach(c => {
    if (!c || c.type !== 'theory' || !c.semester) return;
    const sem = String(c.semester);
    if (!bySem[sem]) bySem[sem] = [];
    bySem[sem].push(c);
  });

  return Object.entries(bySem).filter(([, rows]) => {
    if (!rows.length) return false;
    const lowPlaceholderRows = rows.filter(c =>
      Number(c.count || 0) >= 10 &&
      c.pass_rate === 0 &&
      c.fail_rate === 1 &&
      c.avg_final != null && Number(c.avg_final) <= 10 &&
      c.avg_semester != null && Number(c.avg_semester) <= 10
    );
    return lowPlaceholderRows.length / rows.length >= 0.5;
  }).map(([sem]) => sem).sort();
}

function getIncompleteGradeSemesters() {
  return new Set((DATA?.meta?.incomplete_grade_semesters || []).map(String));
}

function getDComparableSemesters() {
  const incomplete = getIncompleteGradeSemesters();
  return (DATA?.meta?.semesters || []).filter(s => !incomplete.has(String(s)));
}

/**
 * PERF-1 FIX（穿透式審查／效能優化）：data.json 是每次進站都會阻斷首屏渲染
 * 的必要資料，實測體積 8.28MB，且原本沒有 .gz 版本（相較之下 behavior.json
 * 早已透過 js/behavior-loader.js 的 _fetchWithGzFallback 提供 .gz，僅因
 * behavior.json 屬「背景延遲載入」而非阻斷渲染，優先序原本較低）。
 * 實測 gzip -9 可將 data.json 由 8.28MB 縮至 264KB（縮減96.8%），對行動網路
 * 下的首次載入時間影響最大，故補上同款 gz-fallback 策略：
 *   1. 優先嘗試 data.json.gz（伺服器可能已設 Content-Encoding:gzip 自動解壓，
 *      或退而用 DecompressionStream 手動解壓）
 *   2. .gz 不存在／解壓失敗 → 100%向下相容，退回原始 data.json（行為與
 *      修正前完全一致，即使部署環境尚未產生 data.json.gz 也不影響運作）
 * .gz 版本由 update-dashboard-after-etl.ps1 於每次複製資料檔後自動（重新）
 * 產生，與 plain json 保持同步，避免手動維護造成新舊不一致。
 */
async function _fetchJsonWithGzFallback(baseUrl) {
  try {
    const res = await fetch(baseUrl + '.gz');
    if (res.ok) {
      const contentEncoding = res.headers.get('Content-Encoding');
      let text;
      if (!contentEncoding && typeof DecompressionStream !== 'undefined') {
        const decompressed = res.body.pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(decompressed).text();
      } else {
        text = await res.text();
      }
      return JSON.parse(text);
    }
  } catch (e) {
    console.warn(`[main] gz fetch/decompress/parse failed for ${baseUrl}.gz，fallback to plain JSON:`, e.message);
  }
  const res2 = await fetch(baseUrl);
  if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
  return res2.json();
}

async function loadData() {
  if (location.protocol === 'file:') {
    document.getElementById('metaInfo').innerHTML =
      `⚠ 請透過本機伺服器開啟（<code>npx serve .</code> 或 VS Code Live Server），` +
      `直接用 file:// 開啟時 fetch() 無法讀取 data/data.json。`;
    return;
  }
  try {
    DATA = await _fetchJsonWithGzFallback('data/data.json');
    normalizeData();
    if (typeof FilterEngine !== 'undefined') FilterEngine.buildIndex(DATA);
    init();
    bindStaticHandlers();
  } catch(e) {
    console.error('[main] 資料載入失敗', e);
    document.getElementById('metaInfo').textContent = '⚠ 資料載入失敗，請重新整理頁面；若持續發生請聯繫系統管理員。';
  }
}

function init() {
  const m = DATA.meta;

  // ── 從 meta 建立全域常數，供全前端統一讀取，避免硬編碼 ──────────
  // 及格線：同步自 ETL 的 FAIL_THRESHOLD（預設 60）
  window.FAIL_THRESHOLD = m.fail_threshold ?? 60;

  // UI 及格率顏色判斷閾值（ETL 可擴充至 meta 輸出；目前以常數定義）
  // >= PASS_COLOR_HIGH → 綠色（優）; >= PASS_COLOR_MID → 橙色（普）; 其餘 → 紅色（警）
  window.PASS_COLOR_HIGH = m.pass_color_high ?? 0.9;
  window.PASS_COLOR_MID  = m.pass_color_mid  ?? 0.7;

  // 疫情 / 108課綱學期範圍
  // curriculum_sem_range[1]=null 代表「持續更新」，上界取 semesters 最後一筆
  const lastSem = m.semesters[m.semesters.length - 1] ?? '9999';
  window.SEM_COVID_START      = (m.covid_sem_range       ?? ['1082','1112'])[0];
  window.SEM_COVID_END        = (m.covid_sem_range       ?? ['1082','1112'])[1];
  window.SEM_CURRICULUM_START = (m.curriculum_sem_range  ?? ['1111', null])[0];
  window.SEM_CURRICULUM_END   = (m.curriculum_sem_range  ?? ['1111', null])[1] ?? lastSem;
  // ── End of global constants ─────────────────────────────────────
  document.getElementById('metaInfo').innerHTML =
    `${escapeHtml(String(m.semesters.length))} 學期 · 更新 ${escapeHtml((m.generated_at ?? '').slice(0,10))}`;

  const sems = m.semesters;
  if (sems.length > 0) {
    const first = sems[0], last = sems[sems.length - 1];
    const fmt = s => `${s.slice(0,3)}(${s.slice(3)})`;
    const rangeText = first === last ? fmt(first) : `${fmt(first)} - ${fmt(last)}`;
    const studentText = Number(m.total_students || 0).toLocaleString();
    document.getElementById('yearRangeBadge').textContent =
      `成績 ${rangeText} · ${studentText}人`;
  }

  // BUGFIX-F（0716 穿透式審查後續）：課程名稱徽章（#subjectInput）先前只能透過
  // BehaviorTabManager 背景預載完成後（需下載 behavior.json，18MB+）才會更新，
  // 使用者常會先看到很久的預設文字。課程名稱在 ETL 讀取 LMS Excel 檔頭時就已
  // 取得（見 01_load_lms_excel.py 的 _extract_course_header()），屬於固定不變
  // 的課程屬性、不需要等整批行為資料算完。
  // 這裡加一條「若 data.json 的 meta 已有 course_name/course_id 就直接使用」的
  // 提早路徑——data.json 是每次進站都會載入的最小必要資料，不受任何分頁延遲
  // 載入影響。目前的 ETL 尚未把這兩個欄位寫進 data.json（詳見交接文件
  // HANDOFF_course_name_early_load.md），此處先做成「有就用、沒有就照舊」的
  // 防禦式寫法：ETL 補上欄位後前端不需要再改一次就會自動切換成快速路徑，
  // 沒補上時完全不影響現有行為（仍由 autoFillSubjectFromBehavior() 於行為
  // 分頁背景預載完成後補上，見 main.js 下方與 behavior-init.js）。
  if (m.course_name) {
    const input = document.getElementById('subjectInput');
    if (input) {
      input.textContent = m.course_name;
      input.dataset.filledEarly = "1";
      updateSubjectDisplay();
    }
  }

  populateFilters();
  initDSemFilter();
  populateCFilterSem();
  restoreFilterMemory();
  _applyDProgramDisabledState();
  renderD();
  requestAnimationFrame(() => {
    attachHelpButtons();
    attachChartExpandButtons();
  });
  // 背景預載行為資料，不阻塞主流程；切換至學習行為分頁時直接使用快取
  setTimeout(() => {
    if (typeof BehaviorTabManager !== 'undefined') {
      BehaviorTabManager.lazyInit(); // lazyInit 內部已有完整 try/catch，無需外層 catch
    }
  }, 0);
}

// ══════════════════════════════════════════════════════════
// FILTERS
// ══════════════════════════════════════════════════════════
function semLabel(s) {
  if (!s) return '';
  const y = String(s).slice(0,3), t = String(s).slice(3);
  return `${y}(${t})`;
}

function sortSemestersDesc(sems) {
  return [...sems].sort((a, b) => Number(b) - Number(a));
}

function sortPrograms(progs) {
  return [...progs].sort((a, b) =>
    programOrderIndex(a) - programOrderIndex(b)
  );
}

function sortSheetNames(names) {
  return [...new Set(names.map(normalizeSheet).filter(Boolean))].sort(compareSheetNames);
}

function populateFilters() {
  const sems = DATA.meta.semesters;
  const semsDesc = sortSemestersDesc(sems);

  const aSem = document.getElementById('aFilterSem');
  aSem.innerHTML = `<option value="all">全學期 All</option>` +
    semsDesc.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(semLabel(s))}</option>`).join('');

  _applyProgramDisabledState('all');
  _applyTypeLockedState('all');
  _rebuildSheetOptions('all', 'all', 'all', 'init');

  const trendSheets = sortSheetNames([...new Set(
    Object.values(DATA.class_summary).map(c => c.sheet_name)
  )]);
  const aTrend = document.getElementById('aTrendSheet');
  aTrend.innerHTML = trendSheets.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

function cloneClassSummary(c) {
  // ETL 重跑前 data.json 仍有 retaker_rate（舊欄位名）；加 fallback 相容兩版本
  const ratio = c.retaker_ratio ?? c.retaker_rate ?? null;
  return {
    ...c,
    retaker_ratio:         ratio,
    score_distribution:    Array.isArray(c.score_distribution)    ? [...c.score_distribution]    : c.score_distribution,
    score_distribution_nr: Array.isArray(c.score_distribution_nr) ? [...c.score_distribution_nr] : c.score_distribution_nr,
  };
}

function aggregateClassSummaries(rows, sem, sheet, type = 'all') {
  if (!rows.length) return null;
  const total = rows.reduce((a, c) => a + (Number(c.count) || 0), 0);
  const first = cloneClassSummary(rows[0]);
  first.semester = sem;
  first.sheet_name = normalizeSheet(sheet);
  first.type = type;
  first.count = total || rows.reduce((a, c) => a + (c.count || 0), 0);

  // 全體欄位加權合併
  ['avg_midterm', 'avg_final', 'avg_semester', 'pass_rate', 'fail_rate', 'retaker_ratio'].forEach(field => {
    const weighted = rows
      .filter(c => c[field] != null)
      .reduce((acc, c) => {
        const w = Number(c.count) || 1;
        acc.sum += c[field] * w;
        acc.weight += w;
        return acc;
      }, { sum: 0, weight: 0 });
    first[field] = weighted.weight ? +(weighted.sum / weighted.weight).toFixed(2) : null;
  });

  // _nr 欄位加權合併（以 count_nr 為權重）
  const total_nr = rows.reduce((a, c) => a + (Number(c.count_nr) || 0), 0);
  first.count_nr = total_nr;
  ['avg_midterm_nr', 'avg_final_nr', 'avg_semester_nr', 'pass_rate_nr', 'fail_rate_nr'].forEach(field => {
    const weighted = rows
      .filter(c => c[field] != null)
      .reduce((acc, c) => {
        const w = Number(c.count_nr) || 1;
        acc.sum += c[field] * w;
        acc.weight += w;
        return acc;
      }, { sum: 0, weight: 0 });
    first[field] = weighted.weight ? +(weighted.sum / weighted.weight).toFixed(2) : null;
  });

  if (rows.some(c => Array.isArray(c.score_distribution))) {
    first.score_distribution = Array(11).fill(0);
    rows.forEach(c => {
      if (!Array.isArray(c.score_distribution)) return;
      c.score_distribution.forEach((v, i) => { first.score_distribution[i] += v || 0; });
    });
  }
  if (rows.some(c => Array.isArray(c.score_distribution_nr))) {
    first.score_distribution_nr = Array(11).fill(0);
    rows.forEach(c => {
      if (!Array.isArray(c.score_distribution_nr)) return;
      c.score_distribution_nr.forEach((v, i) => { first.score_distribution_nr[i] += v || 0; });
    });
  }

  return first;
}

function getClassSummary(sem, sheet, type = 'all', includeRetaker = true, program = 'all') {
  const rows = Object.values(DATA.class_summary).filter(c => {
    if (sem !== 'all' && c.semester !== sem) return false;
    if (sheet !== 'all' && c.sheet_name !== normalizeSheet(sheet)) return false;
    if (type !== 'all' && c.type !== type) return false;
    const prog = classInfo(c.sheet_name, c.semester).program;
    if (!includeRetaker) {
      if (prog === 'retake_class' || prog === 'retake_student') return false;
    }
    if (program !== 'all' && prog !== program) {
      if (includeRetaker && (prog === 'retake_class' || prog === 'retake_student')) {
        if (getBaseProgram(c.sheet_name) !== program) return false;
      } else {
        return false;
      }
    }
    return true;
  });
  if (!rows.length) return null;
  const normSheet = sheet === 'all' ? 'all' : normalizeSheet(sheet);
  const cls = rows.length === 1
    ? cloneClassSummary(rows[0])
    : aggregateClassSummaries(rows, sem, normSheet, type);

  // 若排除重修生，將 ETL 預算的 _nr 欄位覆蓋到主欄位
  // 下游所有讀取 cls.count / cls.avg_semester 等的地方自動得到正確值
  if (!includeRetaker && cls) {
    cls.count              = cls.count_nr              ?? cls.count;
    cls.avg_midterm        = cls.avg_midterm_nr        ?? null;
    cls.avg_final          = cls.avg_final_nr          ?? null;
    cls.avg_semester       = cls.avg_semester_nr       ?? null;
    cls.pass_rate          = cls.pass_rate_nr          ?? null;
    cls.fail_rate          = cls.fail_rate_nr          ?? null;
    cls.score_distribution = cls.score_distribution_nr ?? cls.score_distribution;
    cls.retaker_ratio      = null; // 排除跨屆重修生時，重修生佔比無意義
  }
  return cls;
}

function recordMatchesClass(r, sem, sheet, type = 'all') {
  // ROOT-CAUSE FIX(0808c)：原本 `r.semester === sem` 為嚴格相等比對，
  // sem==='all'（全學期）時恆為 false（沒有任何紀錄的 semester 欄位會
  // 字面等於 'all'），導致 getAFilteredRecords() 在全學期模式下永遠回傳
  // 空陣列——即使實際上有大量橫跨學期的資料存在。getClassSummary() 早已
  // 正確採用「sem!=='all' 才檢查」的萬用字元慣例（見上方 1135 行），此處
  // 補齊相同邏輯，讓「期中→期末迴歸」與「常態分布疊加」圖表在全學期模式
  // 下能正確聚合特定班級跨屆的歷史紀錄，而非誤判為無資料。
  return (sem === 'all' || r.semester === sem) &&
    normalizeSheet(r.sheet_name) === normalizeSheet(sheet) &&
    (type === 'all' || r.type === type);
}

function availableCompareSems(sem, sheet, type = 'all', includeRetaker = true, program = 'all') {
  const sems = DATA.meta.semesters;
  const idx = sems.indexOf(sem);
  if (idx <= 0) return [];
  return sems
    .slice(0, idx)
    .reverse()
    .filter(prevSem => getClassSummary(prevSem, sheet, type, includeRetaker, program));
}

function updateCompareFilter(sem, sheet, type = 'all', includeRetaker = true, program = 'all') {
  const el = document.getElementById('aCompareSem');
  if (!el) return '';
  if (sem === 'all') {
    el.innerHTML = `<option value="auto">全學期模式下不適用</option>`;
    el.value = 'auto';
    return 'auto';
  }
  const candidates = availableCompareSems(sem, sheet, type, includeRetaker, program);
  const prev = el.value || 'auto';
  el.innerHTML = [
    `<option value="auto">自動：上一個有資料</option>`,
    ...candidates.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(semLabel(s))}</option>`)
  ].join('');
  if (prev !== 'auto' && candidates.includes(prev)) el.value = prev;
  else el.value = 'auto';
  return el.value;
}

// ══════════════════════════════════════════════════════════
// PANEL A — 篩選器連動
// ══════════════════════════════════════════════════════════
let _aFilterSnapshot = null;

function onAFilterChange(changedField, skipRender) {
  const sem       = document.getElementById('aFilterSem').value;
  const program   = document.getElementById('aFilterProgram').value;

  _applyProgramDisabledState(sem);
  _applyTypeLockedState(program);

  // Re-read courseType AFTER _applyTypeLockedState, which may have locked the DOM value to 'theory'
  const courseType = document.getElementById('aFilterType').value;

  _aFilterSnapshot = { sem, program, courseType,
    sheet: document.getElementById('aFilterSheet').value };

  const resetFields = _rebuildSheetOptions(sem, program, courseType, changedField);

  if (resetFields.length > 0) {
    _showAResetHint(changedField, resetFields);
  } else {
    _hideAResetHint();
  }

  const emptyCheck = typeof FilterEngine !== 'undefined'
    ? FilterEngine.checkEmptyResult(sem, program, courseType, DATA)
    : { empty: false };

  if (emptyCheck.empty) {
    _showAEmptyHint(emptyCheck.reason);
    document.getElementById('aStats').innerHTML =
      `<div class="empty-state ladash-empty-error">⚠ ${escapeHtml(emptyCheck.reason)}</div>`;
    return;
  }
  _hideAEmptyHint();
  if (!skipRender) renderA();
}

function _applyProgramDisabledState(sem) {
  const sel = document.getElementById('aFilterProgram');
  if (!sel) return;
  const suffix = sem && sem !== 'all' ? String(sem).slice(-1) : null;
  const disabledMap = { '1': ['4yr'], '2': ['2yr_gen','2yr_work','2yr_night','post'] };
  const disabled = suffix ? (disabledMap[suffix] || []) : [];
  const TOOLTIPS = {
    '4yr':       '四技一般僅於下半學期開課',
    '2yr_gen':   '二技僅於上半學期開課',
    '2yr_work':  '二技在職僅於上半學期開課',
    '2yr_night': '二技夜間僅於上半學期開課',
    'post':      '學士後護僅於上半學期開課',
  };
  Array.from(sel.options).forEach(opt => {
    const v = opt.value;
    if (v === 'all') return;
    opt.disabled = disabled.includes(v);
    opt.style.setProperty('color', disabled.includes(v) ? 'var(--text-dim)' : ''); // CSP-V5-FIX
    opt.title = disabled.includes(v) ? (TOOLTIPS[v] || '') : '';
  });
  if (disabled.includes(sel.value)) {
    sel.value = 'all';
  }
}

function _applyTypeLockedState(program) {
  const sel = document.getElementById('aFilterType');
  if (!sel) return;
  const noLab = ['2yr_gen','2yr_work','2yr_night','retake_class'];
  if (noLab.includes(program)) {
    sel.value = 'theory';
    Array.from(sel.options).forEach(opt => {
      opt.disabled = opt.value === 'practicum';
      opt.title    = opt.value === 'practicum' ? '此學制不開設實驗課' : '';
    });
  } else {
    Array.from(sel.options).forEach(opt => { opt.disabled = false; opt.title = ''; });
  }
}

function _rebuildSheetOptions(sem, program, courseType, changedField) {
  const el = document.getElementById('aFilterSheet');
  const prevSheet = el.value;
  const resetFields = [];

  const sheetCountMap = {};
  Object.values(DATA.class_summary).forEach(c => {
    if (sem !== 'all' && c.semester !== sem) return;
    if (courseType !== 'all' && c.type !== courseType) return;
    const prog = classInfo(c.sheet_name, c.semester).program;
    if (program !== 'all' && prog !== program) return;
    const sn = c.sheet_name;
    sheetCountMap[sn] = (sheetCountMap[sn] || 0) + (c.count || 0);
  });

  const sheets = sortSheetNames(Object.keys(sheetCountMap));

  el.innerHTML = `<option value="all">全部班級 All</option>` +
    sheets.map(s => {
      const cnt = sheetCountMap[s];
      const label = cnt ? `${s}（${cnt}人）` : s;
      return `<option value="${escapeHtml(s)}">${escapeHtml(label)}</option>`;
    }).join('');

  if (prevSheet !== 'all' && !sheets.includes(prevSheet)) {
    el.value = 'all';
    if (changedField !== 'class') resetFields.push('班級');
  } else {
    el.value = prevSheet;
  }

  return resetFields;
}

function _showAResetHint(changedField, resetFields) {
  const FIELD_LABELS = { semester:'學期', program:'學制', courseType:'課程類型', class:'班級' };
  const hint = document.getElementById('aResetHint');
  const text = document.getElementById('aResetHintText');
  if (!hint || !text) return;
  text.textContent =
    `已自動調整：${resetFields.join('、')} 已重置（因 ${FIELD_LABELS[changedField] || changedField} 變更）`;
  hint.style.setProperty('display', 'flex');
}

function _hideAResetHint() {
  const hint = document.getElementById('aResetHint');
  if (hint) hint.style.setProperty('display', 'none');
}

function undoAFilterReset() {
  if (!_aFilterSnapshot) return;
  const { sem, program, courseType, sheet } = _aFilterSnapshot;
  document.getElementById('aFilterSem').value     = sem;
  document.getElementById('aFilterProgram').value  = program;
  document.getElementById('aFilterType').value     = courseType;
  // Apply lock/disabled BEFORE rebuilding sheet options so the DOM value is authoritative
  _applyProgramDisabledState(sem);
  _applyTypeLockedState(program);
  // Re-read after lock in case program forced type to 'theory'
  const lockedType = document.getElementById('aFilterType').value;
  _rebuildSheetOptions(sem, program, lockedType, 'class');
  document.getElementById('aFilterSheet').value    = sheet;
  _hideAResetHint();
  _hideAEmptyHint();
  renderA();
}

function resetAFilters() {
  document.getElementById('aFilterSem').value     = 'all';
  document.getElementById('aFilterProgram').value  = 'all';
  document.getElementById('aFilterType').value     = 'all';
  _applyProgramDisabledState('all');
  _applyTypeLockedState('all');
  _rebuildSheetOptions('all','all','all','semester');
  document.getElementById('aFilterSheet').value = 'all';
  _hideAResetHint();
  _hideAEmptyHint();
  if (typeof _retakerState !== 'undefined') {
    _retakerState['A'] = true;
    if (typeof _syncRetakerBtn === 'function') _syncRetakerBtn('A');
  }
  if (typeof _filterCollapsed !== 'undefined' && _filterCollapsed['A']) {
    _filterCollapsed['A'] = false;
    if (typeof _applyFilterCollapse === 'function') _applyFilterCollapse('A');
  }
  renderA();
}

function _showAEmptyHint(reason) {
  const el = document.getElementById('aEmptyHint');
  if (!el) return;
  el.textContent = `⚠ 查無資料：${reason}`;
  el.style.setProperty('display', 'block');
}

function _hideAEmptyHint() {
  const el = document.getElementById('aEmptyHint');
  if (el) el.style.setProperty('display', 'none');
}

// ══════════════════════════════════════════════════════════
// PANEL A
// ══════════════════════════════════════════════════════════
function renderA() {
  const sheet   = document.getElementById('aFilterSheet').value;
  const sem     = document.getElementById('aFilterSem').value;
  const type    = document.getElementById('aFilterType').value;
  const program = document.getElementById('aFilterProgram').value;
  const inclRetakerA = getIncludeRetaker('A');
  // class_summary 仍用於：score_distribution（直方圖）、retaker_ratio、比較學期功能
  const cls     = getClassSummary(sem, sheet, type, inclRetakerA, program);

  if (!cls) {
    document.getElementById('aStats').innerHTML = '<div class="empty-state">無此班次資料</div>';
    return;
  }

  // getClassSummary 已在 includeRetaker=false 時自動覆蓋 _nr 欄位
  // cls.count/avg_semester/pass_rate/score_distribution 均為正確版本，直接讀取
  const passColor = cls.pass_rate != null && cls.pass_rate >= PASS_COLOR_HIGH ? 'var(--green)'
                  : cls.pass_rate != null && cls.pass_rate >= PASS_COLOR_MID  ? 'var(--accent3)' : 'var(--red)';
  document.getElementById('aStats').innerHTML = `
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${cls.count}</div>
      <div class="lbl">${inclRetakerA ? '名冊人數 Enrolled' : '首修人數 First-Time'}</div>
    </div>
    <div class="stat-card" data-ac="var(--accent2)">
      <div class="val">${cls.avg_semester ?? '–'}</div>
      <div class="lbl">學期平均 Avg Score</div>
    </div>
    <div class="stat-card" data-ac="${passColor}">
      <div class="val">${cls.pass_rate != null ? (cls.pass_rate*100).toFixed(1)+'%' : '–'}</div>
      <div class="lbl">及格率 Pass Rate</div>
    </div>
    <div class="stat-card" data-ac="var(--accent4)">
      <div class="val">${cls.retaker_ratio != null ? (cls.retaker_ratio*100).toFixed(1)+'%' : '–'}</div>
      <div class="lbl">重修生佔比 Retaker Ratio</div>
    </div>
    <div class="stat-card" data-ac="var(--red)" title="本班本學期不及格人數佔比，不及格者下學期須至他班重修">
      <div class="val">${cls.fail_rate != null ? (cls.fail_rate*100).toFixed(1)+'%' : '–'}</div>
      <div class="lbl">不及格率 Fail Rate <span style="font-size:9px;opacity:.7">（≈重修率）</span></div>
    </div>
    <div class="stat-card" data-ac="var(--accent3)">
      <div class="val">${cls.avg_midterm ?? '–'}</div>
      <div class="lbl">期中平均 Midterm Avg</div>
    </div>
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${cls.avg_final ?? '–'}</div>
      <div class="lbl">期末平均 Final Avg</div>
    </div>
  `;
  _applyAccentColors(document.getElementById('aStats'));

  // UI-MERGE-DIST-0811：原 chartDist（成績分佈直方圖）已併入
  // renderNormalOverlay() 產生的 chartNormalOverlay——後者的「實際人數」
  // 長條資料同樣讀自 cls.score_distribution，數值完全一致，僅多疊加一條
  // 理論常態曲線，故不再重複繪製本圖，改由下方 renderNormalOverlay() 統一產出。
  mkChart('chartMidFinal', {
    type: 'bar',
    data: {
      labels: ['期中考 Midterm', '期末考 Final', '學期成績 Semester'],
      datasets: [{
        label: '平均分',
        data: [cls.avg_midterm, cls.avg_final, cls.avg_semester],
        backgroundColor: ['rgba(79,142,247,0.7)', 'rgba(100,212,168,0.7)', 'rgba(247,164,79,0.7)'],
        borderColor: ['#4f8ef7', '#64d4a8', '#f7a44f'],
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, min: 0, max: 100 },
        y: { ...CHART_DEFAULTS.scales.y }
      }
    }
  });

  const aBaseRecs = getAFilteredRecords(sem, sheet, type, program);
  renderNormalOverlay(cls, sem, sheet, type, program, aBaseRecs);
  renderRegression(sem, sheet, type, program, aBaseRecs);
  renderVarianceBar(sem, sheet, program);

  const trendCard = document.getElementById('chartTrend')?.closest('.chart-card');
  if (sheet === 'all') {
    if (trendCard) trendCard.style.setProperty('display', 'none');
  } else {
    if (trendCard) trendCard.style.setProperty('display', '');
    renderTrend();
  }

  updateFilterSummary('A');
}

function renderTrend() {
  if (!DATA) return;
  const sheetName = document.getElementById('aTrendSheet').value;
  const type    = document.getElementById('aFilterType')?.value || 'all';
  const program = document.getElementById('aFilterProgram')?.value || 'all';
  // getClassSummary 已自動覆蓋 _nr 欄位，直接傳入 inclRetaker 即可
  const relevant = DATA.meta.semesters
    .map(sem => getClassSummary(sem, sheetName, type, getIncludeRetaker('A'), program))
    .filter(Boolean);

  if (relevant.length === 0) return;

  const labels = relevant.map(c => semLabel(c.semester));
  mkChart('chartTrend', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '期中 Midterm',
          data: relevant.map(c => c.avg_midterm),
          borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,0.1)',
          tension: 0.3, fill: false, pointRadius: 5, pointHoverRadius: 7,
        },
        {
          label: '期末 Final',
          data: relevant.map(c => c.avg_final),
          borderColor: '#64d4a8', backgroundColor: 'rgba(100,212,168,0.1)',
          tension: 0.3, fill: false, pointRadius: 5, pointHoverRadius: 7,
        },
        {
          label: '學期 Semester',
          data: relevant.map(c => c.avg_semester),
          borderColor: '#f7a44f', backgroundColor: 'rgba(247,164,79,0.1)',
          tension: 0.3, fill: false, pointRadius: 5, pointHoverRadius: 7,
          borderDash: [5,3],
        },
        {
          label: '及格率×100 Pass Rate×100',
          data: relevant.map(c => c.pass_rate != null ? (c.pass_rate*100) : null),
          borderColor: '#e06c8c', backgroundColor: 'rgba(224,108,140,0.05)',
          tension: 0.3, fill: false, pointRadius: 4, pointHoverRadius: 6,
          borderDash: [2,4],
        }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100 }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL B
// ══════════════════════════════════════════════════════════
function setBMode(mode, skipRender) {
  bMode = mode;
  document.getElementById('modeBySheet').classList.toggle('active', mode === 'sheet');
  document.getElementById('modeByStudent').classList.toggle('active', mode === 'student');
  if (!skipRender) renderB();
}

function getRetakerRecords() {
  const type = document.getElementById('bFilterType').value;
  const retakers = [];

  for (const [sid, data] of Object.entries(DATA.students)) {
    // 取該課型的所有記錄（含首修，is_retaker 可為 false）
    const allRecs = data.records.filter(r => r.type === type);
    // 必須含有至少一筆 is_retaker=true 才是重修生
    if (!allRecs.some(r => r.is_retaker)) continue;

    if (bMode === 'sheet') {
      // 依班級分組，每個班級的記錄獨立形成一個配對
      const bySheet = {};
      allRecs.forEach(r => {
        if (!bySheet[r.sheet_name]) bySheet[r.sheet_name] = [];
        bySheet[r.sheet_name].push(r);
      });
      for (const [sh, shRecs] of Object.entries(bySheet).sort(([a], [b]) => compareSheetNames(a, b))) {
        const sorted = [...shRecs].sort(compareClassRecords);
        // 該班至少有一筆重修記錄才加入
        if (sorted.some(r => r.is_retaker)) {
          retakers.push({ sid, masked: data.name_masked, recs: sorted, sheet: sh });
        }
      }
    } else {
      const sorted = [...allRecs].sort(compareClassRecords);
      retakers.push({ sid, masked: data.name_masked, recs: sorted, sheet: '全部' });
    }
  }
  return retakers.sort((a, b) =>
    compareSheetNames(a.sheet, b.sheet) || a.masked.localeCompare(b.masked, 'zh-TW')
  );
}

// ══════════════════════════════════════════════════════════
// PANEL C — 整合控制器
// ══════════════════════════════════════════════════════════
let cCurrentView = 'general';
let cCurrentExam = 'semester_score';
let cCurrentType = 'all';
let cCurrentPass = 'all';

function switchCView(view) {
  cCurrentView = view;

  document.querySelectorAll('#cViewControls .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );

  const isGeneral = view === 'general';
  document.getElementById('cFilterGeneral').style.setProperty('display', isGeneral ? '' : 'none');
  document.getElementById('cFilterRetake').style.setProperty('display', isGeneral ? 'none' : '');
  document.getElementById('cResetBtn').style.setProperty('display', '');
  // BUGFIX-0719: cStats 為「全體學生」專用統計卡列，重修分析已有專屬的 bStats（含「重修概況統計」標題與說明按鈕）
  // 切至重修分析時隱藏 cStats，避免與 bStats 重複顯示相同數據
  document.getElementById('cStats').style.setProperty('display', isGeneral ? '' : 'none');

  if (isGeneral) {
    _resetCGeneralFilters();
    document.getElementById('cPanelGeneral').style.setProperty('display', '');
    document.getElementById('cPanelRetake').style.setProperty('display', 'none');
  } else {
    _resetCRetakeFilters();
    document.getElementById('cPanelRetake').style.setProperty('display', '');
    document.getElementById('cPanelGeneral').style.setProperty('display', 'none');
  }

  renderCView();
}

function _applyCProgramDisabledState(sem) {
  const sel = document.getElementById('cFilterProgram');
  if (!sel || !DATA) return;
  const suffix = sem && sem !== 'all' ? String(sem).slice(-1) : null;
  // 上半學期(1)：4yr 不開課；下半學期(2)：二技/學士後護不開課
  const disabledMap = { '1': ['4yr'], '2': ['2yr_gen','2yr_work','2yr_night','post'] };
  const disabled = suffix ? (disabledMap[suffix] || []) : [];
  const TOOLTIPS = {
    '4yr':       '四技一般僅於下半學期開課',
    '2yr_gen':   '二技僅於上半學期開課',
    '2yr_work':  '二技在職僅於上半學期開課',
    '2yr_night': '二技夜間僅於上半學期開課',
    'post':      '學士後護僅於上半學期開課',
  };
  Array.from(sel.options).forEach(opt => {
    if (opt.value === 'all') return;
    opt.disabled     = disabled.includes(opt.value);
    opt.style.setProperty('color', disabled.includes(opt.value) ? 'var(--text-dim)' : ''); // CSP-V5-FIX
    opt.title        = disabled.includes(opt.value) ? (TOOLTIPS[opt.value] || '') : '';
  });
  if (disabled.includes(sel.value)) sel.value = 'all';
}

function onCGeneralFilterChange(changedField, skipRender) {
  const sem     = document.getElementById('cFilterSem').value;
  const program = document.getElementById('cFilterProgram').value;

  // 學期切換時，同步禁用與該學期不相容的學制選項
  if (changedField === 'semester') {
    _applyCProgramDisabledState(sem);
  }

  const noLab = ['2yr_gen','2yr_work','2yr_night','retake_class'];
  const lockHint = document.getElementById('cTypeLockHint');
  if (noLab.includes(program)) {
    cCurrentType = 'theory';
    ['cTypeAll','cTypeTheory','cTypePrac'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('active', id === 'cTypeTheory');
      if (id === 'cTypePrac') { btn.disabled = true;  btn.style.setProperty('opacity', '0.4'); } // CSP-V7-FIX
      else                   { btn.disabled = false; btn.style.setProperty('opacity', ''); }   // CSP-V7-FIX
    });
    if (lockHint) {
      lockHint.textContent = '此學制不開設實驗課，課程類型已鎖定為正課';
      lockHint.style.setProperty('display', 'block');
    }
  } else {
    ['cTypeAll','cTypeTheory','cTypePrac'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) { btn.disabled = false; btn.style.setProperty('opacity', ''); } // CSP-V7-FIX
    });
    if (lockHint) lockHint.style.setProperty('display', 'none');
  }

  // 學制切換後同步重修生開關狀態（重修生學制須鎖定為包含）
  _syncRetakerBtn('C');

  _hideCEmptyHint();
  if (!skipRender) renderCView();
}

function setCType(type, skipRender) {
  // Guard: programs without lab courses cannot switch to practicum
  if (type === 'practicum') {
    const prog = document.getElementById('cFilterProgram')?.value || 'all';
    const noLab = ['2yr_gen','2yr_work','2yr_night','retake_class'];
    if (noLab.includes(prog)) return;
  }
  cCurrentType = type;
  ['cTypeAll','cTypeTheory','cTypePrac'].forEach(id => {
    const map = { cTypeAll:'all', cTypeTheory:'theory', cTypePrac:'practicum' };
    document.getElementById(id)?.classList.toggle('active', map[id] === type);
  });
  if (!skipRender) renderCView();
}

function setCPass(pass, skipRender) {
  cCurrentPass = pass;
  ['cPassAll','cPassPass','cPassFail'].forEach(id => {
    const map = { cPassAll:'all', cPassPass:'pass', cPassFail:'fail' };
    document.getElementById(id)?.classList.toggle('active', map[id] === pass);
  });
  if (!skipRender) renderCView();
}

function setCExam(metric, skipRender) {
  cCurrentExam = metric;
  ['cExamSem','cExamMid','cExamFin','cExamSemR','cExamMidR','cExamFinR'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  const map = {
    semester_score: ['cExamSem','cExamSemR'],
    midterm:        ['cExamMid','cExamMidR'],
    final:          ['cExamFin','cExamFinR'],
  };
  (map[metric] || []).forEach(id => document.getElementById(id)?.classList.add('active'));
  if (!skipRender) renderCView();
}

function resetCFilters() {
  _retakerState['C'] = true;
  _syncRetakerBtn('C');
  if (cCurrentView === 'retake') {
    _resetCRetakeFilters();
    document.getElementById('cStats').innerHTML = '';
    const hint = document.getElementById('cRetakeSearchHint');
    if (hint) hint.style.setProperty('display', '');
    // BUGFIX-0812: 原本直接清空 bStats 後即結束，未呼叫任何 render 函式，
    // 導致「重修概況統計」4 張卡片被清空後不會重新填入內容，需切換分頁
    // （觸發 switchCView → renderCView）才會重新出現。bStats 內容
    // （getRetakerRecords() 彙總）本不受搜尋學號欄位影響，改為呼叫
    // renderCView() 立即重新渲染，比照 general 分支與 resetAFilters()／
    // resetDFilters() 既有慣例（reset 後一律接著呼叫對應 render 函式）。
    renderCView();
  } else {
    _resetCGeneralFilters();
    renderCView();
  }
}

function _resetCGeneralFilters() {
  const semEl = document.getElementById('cFilterSem');
  if (semEl) semEl.value = 'all';
  const progEl = document.getElementById('cFilterProgram');
  if (progEl) progEl.value = 'all';
  // 重置後清除所有學制的 disabled 狀態（全部學期時無限制）
  _applyCProgramDisabledState('all');
  cCurrentType = 'all';
  cCurrentPass = 'all';
  ['cTypeAll','cTypeTheory','cTypePrac'].forEach((id,i) =>
    document.getElementById(id)?.classList.toggle('active', i===0));
  ['cPassAll','cPassPass','cPassFail'].forEach((id,i) =>
    document.getElementById(id)?.classList.toggle('active', i===0));
  cCurrentExam = 'semester_score';
  ['cExamSem','cExamMid','cExamFin','cExamSemR','cExamMidR','cExamFinR'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('cExamSem')?.classList.add('active');
  document.getElementById('cExamSemR')?.classList.add('active');
  // 同步重修生開關
  _syncRetakerBtn('C');
  const searchEl = document.getElementById('cSearch');
  if (searchEl) searchEl.value = '';
  const searchBox = document.getElementById('searchResults');
  if (searchBox) { searchBox.classList.remove('open'); searchBox.innerHTML = ''; }
  // 清除學生成績輪廓區塊
  const profileWrap = document.getElementById('profileWrap');
  if (profileWrap) { profileWrap.innerHTML = ''; profileWrap.style.setProperty('margin-bottom', ''); } // CSP-V5-FIX
  ['cTypePrac'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.disabled = false; btn.style.setProperty('opacity', ''); } // CSP-V7-FIX
  });
  const lockHint = document.getElementById('cTypeLockHint');
  if (lockHint) lockHint.style.setProperty('display', 'none');
  _hideCEmptyHint();
}

function _resetCRetakeFilters() {
  const inp = document.getElementById('cSearchRetake');
  if (inp) inp.value = '';
  const box = document.getElementById('searchResultsRetake');
  if (box) { box.classList.remove('open'); box.innerHTML = ''; }
  const pw = document.getElementById('profileWrap');
  if (pw) pw.innerHTML = '';
  cCurrentExam = 'semester_score';
  ['cExamSem','cExamMid','cExamFin','cExamSemR','cExamMidR','cExamFinR'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));
  document.getElementById('cExamSem')?.classList.add('active');
  document.getElementById('cExamSemR')?.classList.add('active');
}

function onCRetakeSearch() {
  const q = document.getElementById('cSearchRetake')?.value?.trim() || '';
  const box = document.getElementById('searchResultsRetake');
  const hint = document.getElementById('cRetakeSearchHint');

  if (q.length < 2) {
    _debouncedRetakeSearchRun.cancel(); // 取消尚未執行的舊查詢，避免清空後又延遲跳出結果
    if (box) { box.classList.remove('open'); box.innerHTML = ''; }
    if (hint) hint.style.setProperty('display', '');
    const pw = document.getElementById('profileWrap');
    if (pw && pw.innerHTML.trim().length > 0) {
      pw.innerHTML = '';
      renderCView();
    }
    return;
  }
  // hint 隱藏維持即時：這是「輸入是否已達最短長度」的狀態回饋，非搜尋結果本身，
  // 不應隨防抖延遲（設計決議）。
  if (hint) hint.style.setProperty('display', 'none');

  _debouncedRetakeSearchRun(q);
}

function _retakeSearchRun(q) {
  const box = document.getElementById('searchResultsRetake');
  const results = [];
  const pat = q.replace(/\*/g, '.*').replace(/\?/g, '.');
  let re;
  try { re = new RegExp(pat, 'i'); } catch { re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i'); }

  const retakerPool = _getRetakerStudentsList();
  for (let i = 0; i < retakerPool.length; i++) {
    const s = retakerPool[i];
    if (re.test(s.id) || re.test(s.masked || '')) results.push(s);
  }

  if (!box) return;
  if (!results.length) {
    box.innerHTML = '<div class="no-result">查無重修學生（學號片段不符或無重修記錄）</div>';
    box.classList.add('open');
    return;
  }

  box.innerHTML = results.slice(0, 12).map(r =>
    `<div class="result-item" data-sid="${escapeHtml(r.id)}" data-action="selectRetakeStudent">
       <span class="result-id">${escapeHtml(r.id)}</span>
       <span class="result-name">${escapeHtml(r.masked || '–')}</span>
     </div>`
  ).join('');
  box.classList.add('open');
}
const _debouncedRetakeSearchRun = debounce(_retakeSearchRun, SEARCH_DEBOUNCE_MS);

function selectRetakeStudent(sid) {
  const inp = document.getElementById('cSearchRetake');
  if (inp) inp.value = sid;
  const box = document.getElementById('searchResultsRetake');
  if (box) box.classList.remove('open');
  selectStudent(sid);
  // PERF FIX（同上 searchStudent() 結果點擊處的修正，理由相同）：
  // 選取哪位重修生不影響 cPanelRetake 聚合統計內容，只需同步可見性。
  _syncCProfileVisibility();
}

function _showCEmptyHint(reason) {
  const el = document.getElementById('cEmptyHint');
  if (el) { el.textContent = `⚠ 查無資料：${reason}`; el.style.setProperty('display', 'block'); }
}
function _hideCEmptyHint() {
  const el = document.getElementById('cEmptyHint');
  if (el) el.style.setProperty('display', 'none');
}

// 個案模式（搜尋學號展開 profileWrap）時，隱藏全體/群體總覽（非個案專屬）的統計卡與圖表，
// 簡化版面、避免與個案軌跡混淆；清除搜尋或重設條件後（profileWrap 清空）恢復顯示。
// 顯示→隱藏方向永遠安全（圖表已在可見狀態下渲染過，隱藏不影響其內容）；
// 隱藏→顯示方向重用既有 resizeChartsInCard()（含 canvas resize 與 slopeChart SVG 依新寬度重繪），
// 避免圖表在容器 display:none 期間被重新渲染導致尺寸歸零。
function _syncCProfileVisibility() {
  const pw = document.getElementById('profileWrap');
  const inCase = !!(pw && pw.innerHTML.trim().length > 0);
  if (cCurrentView === 'general') {
    const panel = document.getElementById('cPanelGeneral');
    const wasHidden = panel.style.display === 'none';
    document.getElementById('cStats').style.setProperty('display', inCase ? 'none' : '');
    panel.style.setProperty('display', inCase ? 'none' : '');
    if (wasHidden && !inCase) resizeChartsInCard(panel);
  } else {
    const panel = document.getElementById('cPanelRetake');
    const wasHidden = panel.style.display === 'none';
    panel.style.setProperty('display', inCase ? 'none' : '');
    if (wasHidden && !inCase) resizeChartsInCard(panel);
  }
}

function renderCView() {
  if (!DATA) return;
  if (cCurrentView === 'general') {
    const recs = getCFilteredRecords();
    if (!recs.length) {
      const progVal = document.getElementById('cFilterProgram')?.value || 'all';
      const semVal  = document.getElementById('cFilterSem')?.value     || 'all';
      const progLabel = progVal !== 'all' ? (PROGRAM_LABELS[progVal] || progVal) : '';
      const semStr    = semVal  !== 'all' ? `學期 ${semLabel(semVal)}` : '';
      const hint = [progLabel, semStr].filter(Boolean).join('、') || '目前篩選條件';
      _showCEmptyHint(`${hint} 無符合資料`);
      document.getElementById('cStats').innerHTML = '';
      updateFilterSummary('C');
      _syncCProfileVisibility();
      return;
    }
    _hideCEmptyHint();
    renderCAnomalyAndDist(recs);
    renderCStats(recs);
  } else {
    // BUGFIX-0719: renderCRetakeStats() 已移除 — 其輸出與 renderB() 內的 bStats 完全重複（同一份 getRetakerRecords() 計算結果）
    renderB();
    renderRetakerFirstDist();
  }
  updateFilterSummary('C');
  _syncCProfileVisibility();
}

let _cPanelInited = false;

function initCPanel() {
  if (!DATA) return;
  if (!_cPanelInited) {
    // First entry only: populate dropdowns and set initial defaults
    populateCFilterSem();
    _applyCProgramDisabledState('all');
    _syncRetakerBtn('C');
    setBType('theory', true); // skipRender：此時 cCurrentView 仍為 'general'，#cPanelRetake 隱藏，渲染會被丟棄；實際可見畫面由下方 renderCView() 統一渲染
    _resetCGeneralFilters();
    _restoreCFilterMemory();
    _cPanelInited = true;
  }
  renderCView();
  const pw = document.getElementById('profileWrap');
  if (pw && !pw.querySelector('[data-student-profile]')) pw.innerHTML = '';
}

function populateCFilterSem() {
  const sel = document.getElementById('cFilterSem');
  if (!sel || !DATA) return;
  const sems = [...DATA.meta.semesters].sort((a,b) => Number(b)-Number(a));
  sel.innerHTML = '<option value="all">全部學期 All</option>' +
    sems.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(semLabel(s))}</option>`).join('');
}

function getCFilteredRecords() {
  if (!DATA) return [];
  const semVal  = document.getElementById('cFilterSem')?.value  || 'all';
  const progVal = document.getElementById('cFilterProgram')?.value || 'all';
  const typeVal = cCurrentType;
  const passVal = cCurrentPass;
  const inclRetaker = getIncludeRetaker('C');

  const result = [];
  Object.entries(DATA.students).forEach(([sid, stu]) => {
    stu.records.forEach(r => {
      if (semVal  !== 'all' && String(r.semester) !== String(semVal))  return;
      if (progVal !== 'all' && classInfo(r.sheet_name||'', r.semester).program !== progVal) return;
      if (typeVal !== 'all' && r.type !== typeVal) return;
      if (!inclRetaker && r.is_retaker) return;
      const score = r[cCurrentExam];
      if (passVal === 'pass' && (score == null || score < FAIL_THRESHOLD)) return;
      if (passVal === 'fail' && (score == null || score >= FAIL_THRESHOLD)) return;
      result.push({ ...r, masked: stu.name_masked, sid });
    });
  });
  return result;
}

function renderCAnomalyAndDist(baseRecs) {
  renderAnomalyDensity();

  const recs = (baseRecs || getCFilteredRecords()).filter(r => {
    const s = r[cCurrentExam];
    return s != null && !isNaN(s);
  });

  const buckets = Array(11).fill(0);
  recs.forEach(r => {
    const s = r[cCurrentExam];
    const idx = s >= 100 ? 10 : Math.floor(s / 10);
    buckets[Math.min(idx, 10)]++;
  });

  const labels = ['0-9','10-19','20-29','30-39','40-49','50-59','60-69','70-79','80-89','90-99','100'];

  mkChart('cChartDist', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '人次',
        data: buckets,
        backgroundColor: buckets.map((_,i) => i < 6 ? 'rgba(240,112,112,0.7)' : 'rgba(79,142,247,0.7)'),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderCStats(baseRecs) {
  const recs = (baseRecs || getCFilteredRecords()).filter(r => r[cCurrentExam] != null);
  const scores = recs.map(r => r[cCurrentExam]).filter(s => !isNaN(s));
  if (!scores.length) { document.getElementById('cStats').innerHTML = ''; return; }
  const avg = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1);
  const pass = scores.filter(s=>s>=FAIL_THRESHOLD).length;
  const passRate = ((pass/scores.length)*100).toFixed(1);
  const uniqueStudents = new Set(recs.map(r => r.sid)).size;
  const examLabel = { semester_score:'學期', midterm:'期中', final:'期末' }[cCurrentExam] || '學期';
  const passColor = parseFloat(passRate) >= PASS_COLOR_HIGH*100 ? 'var(--green)' : parseFloat(passRate) >= PASS_COLOR_MID*100 ? 'var(--accent3)' : 'var(--red)';
  document.getElementById('cStats').innerHTML = `
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${uniqueStudents}</div><div class="lbl">有記錄學生數 Active Students</div>
    </div>
    <div class="stat-card" data-ac="var(--accent4)">
      <div class="val">${scores.length}</div><div class="lbl">記錄筆數 Records</div>
    </div>
    <div class="stat-card" data-ac="var(--accent2)">
      <div class="val">${avg}</div><div class="lbl">${examLabel}平均分 Avg</div>
    </div>
    <div class="stat-card" data-ac="${passColor}">
      <div class="val">${passRate}%</div><div class="lbl">及格率 Pass Rate</div>
    </div>
    <div class="stat-card" data-ac="var(--red)" title="不及格人數佔比，不及格者下學期須至他班重修">
      <div class="val">${(100-parseFloat(passRate)).toFixed(1)}%</div>
      <div class="lbl">不及格率 Fail Rate <span style="font-size:9px;opacity:.7">（≈重修率）</span></div>
    </div>
  `;
}

function setBType(type, skipRender) {
  const sel = document.getElementById('bFilterType');
  if (sel) sel.value = type;
  ['bTypeTheory','bTypePracticum'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(type === 'theory' ? 'bTypeTheory' : 'bTypePracticum')?.classList.add('active');
  if (!skipRender) renderB();
}

// ── 重修生専属統計：跨學期趨勢／及格率趨勢（29-1 交接規格書 v0.4） ──
function getRetakerSemesterTrend(examField) {
  const bySem = new Map(DATA.meta.semesters.map(s => [s, []]));
  for (const s of Object.values(DATA.students)) {
    for (const r of s.records) {
      if (r.type === 'theory' && r.is_retaker === true && bySem.has(r.semester)) {
        bySem.get(r.semester).push(r);
      }
    }
  }
  const sems = [...DATA.meta.semesters].sort((a, b) => Number(a) - Number(b));
  return sems.map(sem => {
    const recs = bySem.get(sem) || [];
    const withScore = recs.filter(r => r[examField] != null);
    let sum = 0, passN = 0;
    for (const r of withScore) {
      sum += r[examField];
      if (r[examField] >= 60) passN++;
    }
    const avg = withScore.length ? +(sum / withScore.length).toFixed(2) : null;
    const passRate = withScore.length ? +((passN / withScore.length) * 100).toFixed(1) : null;
    return { semester: sem, count: recs.length, countScored: withScore.length, avg, passRate };
  });
}

function renderRetakerTrend(trend, sems) {
  mkChart('chartRetakerTrend', {
    type: 'line',
    data: {
      labels: sems.map(semLabel),
      datasets: [{
        label: '重修生 均線',
        data: trend.map(t => t.avg),
        borderColor: '#a0b0c0',
        backgroundColor: '#a0b0c020',
        tension: 0.3, fill: false, pointRadius: 5, pointHoverRadius: 7, spanGaps: true,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.raw ?? '無資料'}` },
        },
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: metricLabel(cCurrentExam), color: 'var(--text-dim)' } },
      },
    },
  });
}

function renderRetakerPassRateTrend(trend, sems) {
  mkChart('chartRetakerPassRate', {
    type: 'line',
    data: {
      labels: sems.map(semLabel),
      datasets: [{
        label: '重修生 及格率',
        data: trend.map(t => t.passRate),
        borderColor: '#a0b0c0',
        backgroundColor: '#a0b0c020',
        tension: 0.3, fill: false, pointRadius: 4, spanGaps: true,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.raw ?? '–'}%` },
        },
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: '及格率 %', color: 'var(--text-dim)' } },
      },
    },
  });
}

function renderB() {
  const retakers = getRetakerRecords();
  const type = document.getElementById('bFilterType').value;

  const allDeltas = retakers.flatMap(r =>
    r.recs.filter(rec => rec.delta != null).map(rec => rec.delta)
  );
  const improved = allDeltas.filter(d => d > 0).length;
  const worsened = allDeltas.filter(d => d < 0).length;
  const avgDelta = allDeltas.length ? (allDeltas.reduce((a,b)=>a+b,0)/allDeltas.length).toFixed(1) : '–';

  document.getElementById('bStats').innerHTML = `
    <div class="stat-card" data-ac="var(--accent4)">
      <div class="val">${retakers.length}</div>
      <div class="lbl">重修學生 Retakers</div>
    </div>
    <div class="stat-card" data-ac="var(--green)">
      <div class="val">${improved}</div>
      <div class="lbl">進步 Improved</div>
      <div class="sub">Δ &gt; 0</div>
    </div>
    <div class="stat-card" data-ac="var(--red)">
      <div class="val">${worsened}</div>
      <div class="lbl">退步 Declined</div>
      <div class="sub">Δ &lt; 0</div>
    </div>
    <div class="stat-card" data-ac="var(--accent3)">
      <div class="val">${avgDelta}</div>
      <div class="lbl">平均 Δ Avg Delta</div>
      <div class="sub">首修 → 重修</div>
    </div>
  `;

  const retakerSems = [...DATA.meta.semesters].sort((a, b) => Number(a) - Number(b));
  const retakerTrend = getRetakerSemesterTrend(cCurrentExam);
  renderRetakerTrend(retakerTrend, retakerSems);
  renderRetakerPassRateTrend(retakerTrend, retakerSems);
  renderSlope(retakers);
  renderDelta(allDeltas);
  renderQuadrant();
  renderDeltaByProgram(retakers);
  renderRetakeCount(type);
  renderFirstVsDelta();
}

function renderSlope(retakers) {
  if (!retakers) return;                          // Bug D fix: null guard
  _lastSlopeRetakers = retakers;
  const svg = document.getElementById('slopeChart');
  const W = Math.max(svg.parentElement.clientWidth - 20, 300);
  const H = 280;
  svg.setAttribute('width', W);

  const isDark = !document.body.classList.contains('light');
  const dimCol   = isDark ? '#6b748f' : '#8a90a8';
  const axisCol  = isDark ? '#2a2f45' : '#c8cce0';
  const gridCol  = isDark ? '#1c2030' : '#e0e4f0';

  if (retakers.length === 0) {
    svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="${dimCol}" font-size="12">無重修資料</text>`; // AUDIT-V5: dimCol is internal computed value, no user input
    return;
  }

  const shown = retakers.slice(0, 30);
  const pad = { l: 60, r: 60, t: 24, b: 24 };
  const innerH = H - pad.t - pad.b;

  const allScores = shown.flatMap(r => r.recs.map(rec => rec.semester_score).filter(s => s != null));
  const minS = Math.max(0, Math.min(...allScores) - 5);
  const maxS = Math.min(100, Math.max(...allScores) + 5);
  const scaleY = s => pad.t + innerH * (1 - (s - minS) / (maxS - minS));

  const x1 = pad.l, x2 = W - pad.r;
  let svgHtml = `
    <line x1="${x1}" y1="${pad.t}" x2="${x1}" y2="${H-pad.b}" stroke="${axisCol}" stroke-width="1"/>
    <line x1="${x2}" y1="${pad.t}" x2="${x2}" y2="${H-pad.b}" stroke="${axisCol}" stroke-width="1"/>
    <text x="${x1}" y="${pad.t-6}" text-anchor="middle" fill="${dimCol}" font-size="10">首修</text>
    <text x="${x2}" y="${pad.t-6}" text-anchor="middle" fill="${dimCol}" font-size="10">重修</text>
  `;

  for (let v = Math.ceil(minS/10)*10; v <= maxS; v+=10) {
    const y = scaleY(v);
    svgHtml += `
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${gridCol}" stroke-width="1"/>
      <text x="${x1-8}" y="${y+4}" text-anchor="end" fill="${dimCol}" font-size="9">${v}</text>
    `;
  }

  shown.forEach(item => {
    const first = item.recs[0].semester_score;
    const last  = item.recs[item.recs.length-1].semester_score;
    if (first == null || last == null) return;
    const delta = last - first;
    const color = delta > 0 ? '#64d4a8' : delta < 0 ? '#f07070' : '#6b748f';
    const y1s = scaleY(first), y2s = scaleY(last);
    const firstSem = item.recs[0].semester, lastSem = item.recs[item.recs.length-1].semester;
    const tipAttr = `data-svgtip="1" data-masked="${safeSvgAttr(item.masked)}" data-first="${first}" data-last="${last}" data-delta="${delta>=0?'+':''}${delta}" data-fsem="${safeSvgAttr(firstSem)}" data-lsem="${safeSvgAttr(lastSem)}"`;

    svgHtml += `
      <line x1="${x1}" y1="${y1s}" x2="${x2}" y2="${y2s}"
        stroke="${color}" stroke-width="1.5" stroke-opacity="0.6"/>
      <circle ${tipAttr} cx="${x1}" cy="${y1s}" r="5" fill="${color}" opacity="0.8" cursor="pointer"/>
      <circle ${tipAttr} cx="${x2}" cy="${y2s}" r="5" fill="${color}" opacity="0.8" cursor="pointer"/>
    `;
  });

  svg.innerHTML = svgHtml;

  addSvgTooltip(svg, '[data-svgtip]', el => {
    const d = el.dataset;
    return `<b>${d.masked}</b>\n首修（${d.fsem}）：${d.first} 分\n重修（${d.lsem}）：${d.last} 分\nΔ：<b>${d.delta} 分</b>`;
  });
}

function renderDelta(allDeltas) {
  if (allDeltas.length === 0) return;
  const bins = {};
  allDeltas.forEach(d => {
    const b = Math.floor(d/10)*10;
    bins[b] = (bins[b]||0)+1;
  });
  const minB = Math.min(...Object.keys(bins).map(Number));
  const maxB = Math.max(...Object.keys(bins).map(Number));
  const labels = [], vals = [], colors = [];
  for (let b = minB; b <= maxB; b+=10) {
    labels.push(b >= 0 ? `+${b}~+${b+9}` : `${b}~${b+9}`);
    const v = bins[b]||0;
    vals.push(v);
    colors.push(b >= 0 ? 'rgba(100,212,168,0.7)' : 'rgba(240,112,112,0.6)');
  }
  mkChart('chartDelta', {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: '人數', data: vals, backgroundColor: colors, borderRadius: 3 }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
      scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true } }
    }
  });
}

function renderQuadrant() {
  const qCard = document.getElementById('quadrantCard');
  const pairs = [];
  for (const data of Object.values(DATA.students)) {
    if (!data.records.some(r => r.is_retaker)) continue;
    const bySem = {};
    data.records.forEach(r => {
      if (!bySem[r.semester]) bySem[r.semester] = {};
      if (r.type === 'theory') bySem[r.semester].theory = r.semester_score;
      if (r.type === 'practicum') bySem[r.semester].practicum = r.semester_score;
    });
    for (const [sem, scores] of Object.entries(bySem)) {
      if (scores.theory != null && scores.practicum != null) {
        pairs.push({ x: scores.theory, y: scores.practicum, sem, masked: data.name_masked });
      }
    }
  }

  if (pairs.length < 3) { qCard.style.setProperty('display', 'none'); return; }
  qCard.style.setProperty('display', 'block');

  mkChart('chartQuadrant', {
    type: 'scatter',
    data: {
      datasets: [{
        label: '學生',
        data: pairs,
        backgroundColor: pairs.map(p =>
          p.x>=60&&p.y>=60 ? 'rgba(100,212,168,0.6)' :
          p.x<60&&p.y>=60  ? 'rgba(247,164,79,0.6)' :
          p.x>=60&&p.y<60  ? 'rgba(247,164,79,0.6)' :
          'rgba(240,112,112,0.6)'),
        pointRadius: 6,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.raw.masked}  正課:${ctx.raw.x} 實驗:${ctx.raw.y}`
          }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, min: 0, max: 100,
          title: { display: true, text: '正課成績 Theory', color: '#6b748f' } },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: '實驗成績 Practicum', color: '#6b748f' } }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL C — 學生搜尋
// ══════════════════════════════════════════════════════════
// （共用防抖動工具 debounce()／SEARCH_DEBOUNCE_MS 已搬至檔案最上方 UTILITIES 區塊，
//  避免 const 在檔案中「先使用、後宣告」造成的暫時死區 ReferenceError——
//  onCRetakeSearch() 位於本節之前的區塊，若常數宣告在此處會太晚。）

// 個案搜尋（一般/重修）快取：Object.entries(DATA.students) 對 10,233 筆學生的字典模式物件
// 重建成本很高（實測每次呼叫約 6-9ms），且搜尋輸入框每次鍵入都會呼叫一次；
// 全體學生清單與重修生子集皆於首次搜尋時惰性建置一次並快取，DATA 於單一頁面工作階段
// 內只在初次載入時賦值一次（列印功能雖會暫時替換 DATA，但同步執行且不觸發搜尋，
// 不影響快取正確性）。
let _flatStudentsCache = null;
function _getFlatStudents() {
  if (!_flatStudentsCache) {
    _flatStudentsCache = Object.entries(DATA.students).map(([sid, data]) => ({ sid, data }));
  }
  return _flatStudentsCache;
}

let _retakerStudentsCache = null;
function _getRetakerStudentsList() {
  if (!_retakerStudentsCache) {
    _retakerStudentsCache = _getFlatStudents()
      .filter(({ data }) => data.records.some(r => r.is_retaker))
      .map(({ sid, data }) => ({ id: sid, masked: data.name_masked }));
  }
  return _retakerStudentsCache;
}

function searchStudent() {
  const q = document.getElementById('cSearch').value.trim();
  const box = document.getElementById('searchResults');

  if (q.length < 2) {
    _debouncedSearchStudentRun.cancel(); // 取消尚未執行的舊查詢，避免清空後又延遲跳出結果
    box.classList.remove('open');
    const pw = document.getElementById('profileWrap');
    if (pw && pw.innerHTML.trim().length > 0) {
      pw.innerHTML = '';
      pw.style.setProperty('margin-bottom', '');
      renderCView();
    }
    return;
  }

  _debouncedSearchStudentRun(q);
}

function _searchStudentRun(q) {
  const box = document.getElementById('searchResults');
  const results = [];
  const flatStudents = _getFlatStudents();
  for (let i = 0; i < flatStudents.length; i++) {
    const { sid, data } = flatStudents[i];
    const masked = data.name_masked;
    if (sid.includes(q) || masked.includes(q)) {
      const rCount = data.records.length;
      const hasExc = data.records.some(r => r.exceptions.length > 0);
      const isRet  = data.records.some(r => r.is_retaker);
      results.push({ sid, masked, rCount, hasExc, isRet });
      if (results.length >= 10) break;
    }
  }

  if (results.length === 0) {
    box.innerHTML = '<div class="search-item text-muted">無符合結果</div>';
  } else {
    box.innerHTML = results.map(r => `
      <div class="search-item" data-sid="${escapeHtml(r.sid)}">
        <span>${escapeHtml(r.masked)}</span>
        <span class="s-info">
          ${r.rCount} 筆記錄
          ${r.isRet ? '· <span class="ladash-accent4">重修</span>' : ''}
          ${r.hasExc ? '· <span class="ladash-yellow">⚑</span>' : ''}
        </span>
      </div>
    `).join('');
    box.querySelectorAll('.search-item[data-sid]').forEach(el => {
      // PERF FIX (/systematic-debugging 穿透式審查六)：選取學生只會讓
      // profileWrap 由空轉為非空，進入「個案模式」；_syncCProfileVisibility()
      // 隨即會把 cPanelGeneral/cStats 設為 display:none（見該函式定義處
      // 註解）。選取哪位學生不影響全體篩選聚合結果（getCFilteredRecords()
      // 僅讀取篩選下拉選單狀態），故原本的 renderCView() 會先做一次完整的
      // O(n) 全量重算＋兩張圖表重繪＋統計卡重建，結果卻在同一輪立刻被隱藏，
      // 純屬白工。改為只呼叫實際需要的 _syncCProfileVisibility()，比照本檔
      // resetCFilters() 既有同類用法（L1632）。
      el.addEventListener('click', () => { selectStudent(el.dataset.sid); _syncCProfileVisibility(); });
    });
  }
  box.classList.add('open');
}
const _debouncedSearchStudentRun = debounce(_searchStudentRun, SEARCH_DEBOUNCE_MS);

function selectStudent(sid) {
  document.getElementById('searchResults').classList.remove('open');
  // BUG-1 FIX (V12): guard against sid not in DATA.students (race between search index and data load)
  const _stu = DATA.students?.[sid];
  if (!_stu) return;
  document.getElementById('cSearch').value = _stu.name_masked;
  renderProfile(sid);
}

function renderProfile(sid) {
  const data = DATA.students[sid];
  const wrap = document.getElementById('profileWrap');

  if (!data) { wrap.innerHTML = '<div class="empty-state">找不到學生資料</div>'; wrap.style.setProperty('margin-bottom', '14px'); return; } // CSP-V5-FIX
  wrap.style.setProperty('margin-bottom', '14px'); // CSP-V5-FIX

  const isRetaker = data.records.some(r => r.is_retaker);
  const allExc    = data.records.flatMap(r => r.exceptions);
  const excCounts = { red:0, yellow:0, blue:0, gray:0 };
  allExc.forEach(e => excCounts[e.color] = (excCounts[e.color]||0)+1);

  let html = `
    <div data-student-profile class="ladash-student-profile-hdr">
      <div class="ladash-student-name">${escapeHtml(data.name_masked)}</div>
      ${isRetaker ? '<span class="tag tag-red">重修生 Retaker</span>' : ''}
      ${excCounts.red    ? `<span class="tag tag-red">🔴 ${excCounts.red} 重大違規</span>` : ''}
      ${excCounts.yellow ? `<span class="tag tag-yellow">🟡 ${excCounts.yellow} 態度異常</span>` : ''}
      ${excCounts.blue   ? `<span class="tag tag-blue">🔵 ${excCounts.blue} 行政缺漏</span>` : ''}
    </div>
  `;

  html += '<div class="timeline">';
  const sorted = [...data.records].sort(compareClassRecords);
  sorted.forEach(r => {
    const typeLabel = r.type === 'theory' ? 'Theory' : r.type === 'practicum' ? 'Practicum' : 'Summer';
    const scoreColor = (s) => s == null ? '' : s >= FAIL_THRESHOLD ? 'pass' : 'fail';

    html += `
      <div class="tl-item">
        <div class="tl-dot ${escapeHtml(r.type)}"></div>
        <div class="tl-header">
          <span class="tl-sem">${escapeHtml(semLabel(r.semester))}</span>
          <span class="tl-sheet">${escapeHtml(r.sheet_name)}</span>
          <span class="tl-type-badge tl-type-${escapeHtml(r.type)}">${typeLabel}</span>
          ${r.is_retaker && r.delta != null
            ? `<span class="tl-delta ${r.delta>=0?'pos':'neg'}">Δ ${r.delta>=0?'+':''}${r.delta}</span>`
            : ''}
        </div>
        <div class="tl-scores">
          ${r.midterm != null ? `<div class="tl-score"><span class="s-lbl">期中 Mid</span><span class="s-val ${scoreColor(r.midterm)}">${r.midterm}</span></div>` : ''}
          ${r.final   != null ? `<div class="tl-score"><span class="s-lbl">期末 Final</span><span class="s-val ${scoreColor(r.final)}">${r.final}</span></div>` : ''}
          ${r.semester_score != null ? `<div class="tl-score"><span class="s-lbl">學期 Sem</span><span class="s-val ${scoreColor(r.semester_score)}">${r.semester_score}</span></div>` : ''}
          ${r.adjusted != null ? `<div class="tl-score"><span class="s-lbl">調整 Adj</span><span class="s-val ladash-accent3">${r.adjusted}</span></div>` : ''}
          ${r.reading_pct != null ? `<div class="tl-score"><span class="s-lbl">閱讀% Read</span><span class="s-val">${r.reading_pct}%</span></div>` : ''}
        </div>
        ${r.exceptions.length ? `<div class="tl-tags">${r.exceptions.map(e =>
          `<span class="tag tag-${escapeHtml(e.color)}">${escapeHtml(e.tag)}</span>`).join('')}</div>` : ''}
        ${r.type === 'theory' ? `
          <button type="button" class="tl-behavior-btn"
                  data-action="toggleBehaviorClassPanel"
                  data-anon="${escapeHtml(data.anon_id)}"
                  data-sem="${escapeHtml(r.semester)}">
            🔍 學習行為分型
          </button>
          <div class="tl-behavior-panel is-hidden"></div>
        ` : ''}
      </div>
    `;
  });
  html += '</div>';

  html += `
    <div class="chart-card ladash-mt14">
      <div class="chart-title" data-ac="var(--accent)">
        <div class="dot"></div>成績軌跡 Score Trajectory
      </div>
      <div class="chart-wrap ladash-h180">
        <canvas id="chartProfile"></canvas>
      </div>
    </div>
  `;

  wrap.innerHTML = html;
  _applyAccentColors();

  const theory    = sorted.filter(r => r.type === 'theory');
  const practicum = sorted.filter(r => r.type === 'practicum');

  // x 軸以「學期+班別」為唯一鍵，theory 與 practicum 共用同一時間軸，
  // 避免同學期同班出現重複 label。
  const labelKey = r => semLabel(r.semester) + ' ' + r.sheet_name;
  const allLabels = [...new Map(sorted.map(r => [labelKey(r), labelKey(r)])).values()];

  const datasets = [];
  if (theory.length > 0) {
    const theoryMap = new Map(theory.map(r => [labelKey(r), r.semester_score]));
    datasets.push({
      label: '正課 Theory',
      data: allLabels.map(lbl => theoryMap.has(lbl) ? theoryMap.get(lbl) : null),
      borderColor: '#4f8ef7', pointRadius: 5, tension: 0.3, fill: false,
      spanGaps: false,
    });
  }
  if (practicum.length > 0) {
    const practicumMap = new Map(practicum.map(r => [labelKey(r), r.semester_score]));
    datasets.push({
      label: '實驗 Practicum',
      data: allLabels.map(lbl => practicumMap.has(lbl) ? practicumMap.get(lbl) : null),
      borderColor: '#64d4a8', pointRadius: 5, tension: 0.3, fill: false,
      spanGaps: false,
    });
  }

  // 單點時在 labels 前後各補一個空字串 label，使 category scale 將資料點置中
  const displayLabels = allLabels.length === 1
    ? ['', allLabels[0], '']
    : allLabels;
  const displayDatasets = allLabels.length === 1
    ? datasets.map(ds => ({
        ...ds,
        data: [null, ds.data[0], null],
      }))
    : datasets;

  mkChart('chartProfile', {
    type: 'line',
    data: { labels: displayLabels, datasets: displayDatasets },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        x: {
          type: 'category',
          ticks: { color: '#6b748f', font: { size: 9 } },
          grid: { color: CHART_DEFAULTS.scales.x.grid.color }, // Bug C fix: theme-aware
          offset: true,
        },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100 }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL C 個案卡：學習行為分型查詢（31號規格書 v1.1，方案A：時間軸inline展開）
// ══════════════════════════════════════════════════════════
// R1-R5 / S1-S5 中文標籤：沿用ETL既有分群定義；比照 tab-behavior-*.js 既有做法
// （各檔各自維護一份同名對照表，無跨模組 import 慣例），本檔比照辦理。
const BC_R_LABELS = { R1: '影音輔導型', R2: '彈性聽覺型', R3: '平均使用型', R4: '題庫刷題型', R5: '被動低參與型' };
const BC_S_LABELS = { S1: '穩定高效', S2: '規律中效', S3: '波動中效', S4: '低頻低效', S5: '高風險' };
// 軌跡分型／學習方法三型中文標籤：統一比照「行為預測分析」分頁既有已上線的
// 「分析框架說明」卡片用詞（js/tab-behavior-cross.js 的 TRAJ_NAMES／APPROACH_NAMES，
// 同一套 SS/FS/SF/FF、DEEP/SURFACE/MODERATE 分型，來源同一份 cross_analysis.json）。
// 31號規格書 §5.4 原建議另一套草案用詞，為避免同一分型在系統內出現兩種不同稱呼，
// 改採此既有、已上線之版本，不再另外命名。
const BC_TRAJ_LABELS = { SS: '穩定及格', FS: '自救成功', SF: '成績滑落', FF: '持續不及格' };
const BC_APPROACH_LABELS = { DEEP: '深層學習', SURFACE: '表層學習', MODERATE: '中間型' };

// 百分比格式：比照 tab-behavior-cross.js::_pct() 既有一位小數慣例（無跨模組 import，本檔自成一份）
function _bcPct(x) {
  const n = Number(x);
  return (x == null || isNaN(n)) ? '—' : (n * 100).toFixed(1) + '%';
}

// anon_id+semester 複合鍵索引（31號規格書 §4.2）。模組層級變數快取一次，
// 比照本檔既有 _flatStudentsCache 作法，避免每次開個案卡都重建 2900+ 筆的 Map。
// 陷阱提醒（§2.5）：不可用 BehaviorLoader.loadBehaviorData() 的 byMaskedId
// （同一 masked_id 若有多學期記錄，Map 只留最後一筆），改對原始陣列自建複合鍵。
let _behaviorIndexCache = null;
function buildBehaviorIndex(behaviorData) {
  if (_behaviorIndexCache) return _behaviorIndexCache;
  const idx = new Map();
  (behaviorData.students || []).forEach(s => idx.set(`${s.anon_id}||${s.semester}`, s));
  _behaviorIndexCache = idx;
  return idx;
}

/**
 * 31號規格書 §4 狀態判定邏輯 + §5.4 內容樣板。逐筆（per class record）判定。
 * NOT_APPLICABLE（非theory）由呼叫端（timeline模板）已用按鈕可見性排除，不在此處理。
 * NO_DATA／INSUFFICIENT_DATA 採「顯示提示訊息」而非隱藏按鈕（§6 允許兩種UI處理擇一，
 * 前者不需在 renderProfile() 同步階段預先載入 behavior.json 才能決定按鈕是否顯示，
 * 沿用本功能整體的惰性載入設計，實作更單純）。
 * @returns {Promise<string>} innerHTML，所有動態值皆經 escapeHtml()
 */
async function buildBehaviorClassificationHtml(anonId, sem) {
  const [behaviorData, corrData, crossData] = await Promise.all([
    BehaviorLoader.load.behavior(),
    BehaviorLoader.load.correlation(),
    BehaviorLoader.load.crossAnalysis(),
  ]);

  // §4-2.1：學期白名單檢查
  const whitelist = behaviorData.meta?.semesters || [];
  if (!whitelist.includes(sem)) {
    return `<div class="bc-nodata">無相關學習資料評估</div>`;
  }

  // §4-2.2：查 behavior.json 對應列（複合鍵索引，避開 byMaskedId 覆蓋陷阱）
  const key = `${anonId}||${sem}`;
  const behRec = buildBehaviorIndex(behaviorData).get(key);
  if (!behRec) {
    return `<div class="bc-nodata">無相關學習資料評估</div>`;
  }

  // §4-2.3：判斷該學期是否仍在進行中
  const incompleteList = crossData.meta?.incomplete_semesters_excluded || [];
  const lsaTypeMap = corrData.lsa_transition?.lsa_type_map || {};
  let rCluster, sCluster, learningApproach, trajectory, status;

  if (incompleteList.includes(sem)) {
    const targetSem = await BehaviorLoader.getWarningTargetSemester();
    let matched = null;
    if (targetSem === sem) {
      const warningResult = await BehaviorLoader.loadWarningForCurrentTarget();
      if (warningResult && warningResult.semester === sem) {
        const list = warningResult.data?.students || [];
        // masked_id 於 behavior.json 與 warning_*.json 為同一組值（§2.5），
        // 用剛查到的 behRec.masked_id 比對，等效於規格書「DATA.students[sid].name_masked」。
        matched = list.find(s => s.masked_id === behRec.masked_id) || null;
      }
    }
    if (matched) {
      status = 'IN_PROGRESS';
      rCluster = matched.r_cluster ?? null;
      sCluster = matched.s_cluster ?? null;
      learningApproach = matched.learning_approach ?? null;
      trajectory = null; // 尚無期末成績，本就無法判定
    } else {
      status = 'INSUFFICIENT_DATA';
    }
  } else {
    status = 'COMPLETE';
    rCluster = behRec.cluster ?? null;
    sCluster = lsaTypeMap[key] ?? null;
    const cls = crossData.student_classification?.[key] || {};
    trajectory = cls.trajectory ?? null;
    learningApproach = cls.learning_approach ?? null;
  }

  if (status === 'INSUFFICIENT_DATA') {
    return `<div class="bc-nodata">目前資料尚不足以判斷學習行為分型</div>`;
  }

  // BUGFIX-A 追蹤（docs38）：使用者以無痕瀏覽器／新裝置測試後排除快取問題，
  // 且回報為普遍現象（非特定學生學期）。關鍵線索：①②的次要說明文字
  // （本分群歷史不及格率…）同樣來自 crossData.by_r_cluster/overall，
  // 若這兩者能正常顯示，代表 cross_analysis.json 本身確實有成功載入
  // （並非 fetch 失敗——fetch 失敗會被上層 catch 攔截，整面板顯示「載入
  // 失敗」，而非①②正常＋③④空白的樣式）。因此最可能的成因是：實際部署
  // 中的 cross_analysis.json 版本落後於 2026-07-29 schema 1.3（該版才新增
  // student_classification 欄位），即該欄位在整份 JSON 中「結構性缺席」，
  // 而非本函式邏輯或個別學生鍵值有誤。以下明確區分「整份欄位缺席」
  // （scFieldMissing＝真：系統性問題，需重新部署資料）與「欄位存在但查
  // 無此筆記錄」（scFieldMissing＝假：個案，如92314020/1112該筆無期中期
  // 末成績的真實邊界案例），兩者訊息與樣式不同，避免混淆。
  const scFieldMissing = !crossData.student_classification
    || typeof crossData.student_classification !== 'object';

  const byR = crossData.by_r_cluster || {};
  const byS = crossData.by_s_cluster || {};
  const overall = crossData.overall || {};

  const rCard = rCluster
    ? _bcCard('①', '資源使用R分群',
        `<span class="bc-card-key">${escapeHtml(rCluster)}</span><span class="bc-card-name">${escapeHtml(BC_R_LABELS[rCluster] || '')}</span>`,
        `本分群歷史不及格率 ${_bcPct(byR[rCluster]?.fail_rate_final)}（全體 ${_bcPct(overall.fail_rate_final)}）`)
    : _bcCard('①', '資源使用R分群', '', '', '目前資料不足以判定');

  const sCard = sCluster
    ? _bcCard('②', '行為序列S分群',
        `<span class="bc-card-key">${escapeHtml(sCluster)}</span><span class="bc-card-name">${escapeHtml(BC_S_LABELS[sCluster] || '')}</span>`,
        `本分群歷史不及格率 ${_bcPct(byS[sCluster]?.fail_rate_final)}（全體 ${_bcPct(overall.fail_rate_final)}）`)
    : _bcCard('②', '行為序列S分群', '', '', '序列樣本不足，未分類');

  let trajCard;
  if (status === 'IN_PROGRESS') {
    trajCard = _bcCard('③', '期中→期末軌跡分型', '', '', '本學期進行中，需等期末成績公布後才能判定');
  } else if (trajectory) {
    const t = overall.trajectory || {};
    trajCard = _bcCard('③', '期中→期末軌跡分型',
      `<span class="bc-card-key">${escapeHtml(trajectory)}</span><span class="bc-card-name">${escapeHtml(BC_TRAJ_LABELS[trajectory] || '')}</span>`,
      `全體學生軌跡分布：SS ${_bcPct(t.SS)} ／ FS ${_bcPct(t.FS)} ／ SF ${_bcPct(t.SF)} ／ FF ${_bcPct(t.FF)}`);
  } else if (scFieldMissing) {
    trajCard = _bcCard('③', '期中→期末軌跡分型', '', '', '⚠ 資料版本落後：cross_analysis.json 缺少「學生分型」欄位，需重新部署最新版資料（非本筆記錄異常）', true);
  } else {
    // 個案：欄位存在，但查無此筆記錄對應鍵（如成績缺考等真實邊界情況）
    trajCard = _bcCard('③', '期中→期末軌跡分型', '', '', '目前資料不足以判定（僅此筆記錄缺對應分類資料，非系統性問題）');
  }

  let approachCard;
  if (learningApproach) {
    const a = overall.approach || {};
    approachCard = _bcCard('④', '學習方法歸類',
      `<span class="bc-card-key">${escapeHtml(learningApproach)}</span><span class="bc-card-name">${escapeHtml(BC_APPROACH_LABELS[learningApproach] || '')}</span>`,
      `全體學生三型分布：DEEP ${_bcPct(a.DEEP)} ／ SURFACE ${_bcPct(a.SURFACE)} ／ MODERATE ${_bcPct(a.MODERATE)}`);
  } else if (scFieldMissing) {
    approachCard = _bcCard('④', '學習方法歸類', '', '', '⚠ 資料版本落後：cross_analysis.json 缺少「學生分型」欄位，需重新部署最新版資料（非本筆記錄異常）', true);
  } else {
    approachCard = _bcCard('④', '學習方法歸類', '', '', '目前資料不足以判定（僅此筆記錄缺對應分類資料，非系統性問題）');
  }

  const note = status === 'IN_PROGRESS'
    ? `<div class="bc-note">本學期進行中，僅供參考；軌跡分型需等期末成績公布後才能判定</div>`
    : '';

  return `<div class="bc-panel-body">${note}<div class="bc-card-grid">${rCard}${sCard}${trajCard}${approachCard}</div></div>`;
}

/**
 * 卡片橫排樣板（31號規格書 Panel C 改版）：比照
 * tab-behavior-radar.js::renderClusterSummary() 的 .behavior-cluster-card
 * 視覺語彙（見該檔 CSP-2 FIX 段落），改為 index.html 靜態 CSS class
 * （非動態注入），因本卡片內容為固定4欄、非可變長度清單，不需要
 * 該檔案那套逐卡計算寬度的 JS。
 * @param {string} idx 圈碼數字，如 '①'
 * @param {string} label 分類標籤，如 '資源使用R分群'
 * @param {string} mainHtml 主要數值 HTML（已含 escapeHtml 處理過的動態值）
 * @param {string} subHtml 次要說明文字（已含 escapeHtml 處理過的動態值），可為空字串
 * @param {string} [emptyMsg] 無資料時顯示的說明文字；傳入時忽略 mainHtml/subHtml
 * @param {boolean} [isWarn] true 時套用 .bc-card-warn 樣式（結構性/系統性問題，
 *   如整份 cross_analysis.json 缺少某欄位——需與個案性的「僅此筆無資料」視覺區隔，
 *   讓使用者一眼能判斷是否為需回報/需重新部署資料的系統性狀況）
 */
function _bcCard(idx, label, mainHtml, subHtml, emptyMsg, isWarn) {
  if (emptyMsg) {
    return `<div class="bc-card bc-card-empty${isWarn ? ' bc-card-warn' : ''}">
        <div class="bc-card-head"><span class="bc-card-idx">${idx}</span><span class="bc-card-cat">${label}</span></div>
        <div class="bc-card-val bc-card-msg">${emptyMsg}</div>
      </div>`;
  }
  return `<div class="bc-card">
      <div class="bc-card-head"><span class="bc-card-idx">${idx}</span><span class="bc-card-cat">${label}</span></div>
      <div class="bc-card-val">${mainHtml}</div>
      ${subHtml ? `<div class="bc-card-sub">${subHtml}</div>` : ''}
    </div>`;
}

/**
 * 方案A（31號規格書 §5.1）：時間軸逐筆記錄按鈕，惰性展開/收合分型面板。
 * data-action 委派呼叫，profileWrap 每次重繪皆為新DOM節點，天然免重綁定（§5.0第1點）。
 */
async function toggleBehaviorClassPanel(anonId, sem, btnEl) {
  const panel = btnEl.nextElementSibling; // 模板中緊接在按鈕後的 .tl-behavior-panel
  if (!panel) return;
  if (panel.classList.contains('is-hidden')) {
    if (panel.dataset.rendered !== '1') {
      panel.innerHTML = '載入中…';
      panel.classList.remove('is-hidden');
      try {
        panel.innerHTML = await buildBehaviorClassificationHtml(anonId, sem);
        panel.dataset.rendered = '1'; // 惰性：同一面板只渲染一次，之後純toggle
      } catch (e) {
        console.error('[toggleBehaviorClassPanel]', e);
        panel.innerHTML = '<div class="bc-nodata">載入失敗，請重新整理頁面後再試</div>';
      }
    } else {
      panel.classList.remove('is-hidden');
    }
  } else {
    panel.classList.add('is-hidden');
  }
}

// ══════════════════════════════════════════════════════════
// PANEL A — 新增圖表
// ══════════════════════════════════════════════════════════
function getAFilteredRecords(sem, sheet, type, program) {
  const inclRetaker = getIncludeRetaker('A');
  const result = [];
  Object.values(DATA.students).forEach(s => s.records.forEach(r => {
    if (!inclRetaker && r.is_retaker) return;
    if (program !== 'all' && classInfo(r.sheet_name || '', r.semester).program !== program) return;
    if (recordMatchesClass(r, sem, sheet, type)) result.push({ ...r, masked: s.name_masked });
  }));
  return result;
}

function renderNormalOverlay(cls, sem, sheet, type = 'all', program = 'all', baseRecs) {
  if (!cls) return;
  const dist = cls.score_distribution;
  const n = cls.count || 1;
  const mu = cls.avg_semester || 70;
  const recs = baseRecs || getAFilteredRecords(sem, sheet, type, program);
  const scores = recs.filter(r => r.semester_score != null).map(r => r.semester_score);
  const sd = scores.length > 1
    ? Math.sqrt(scores.reduce((a,v)=>a+(v-mu)**2,0)/(scores.length-1))
    : 10;

  const labels = ['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  const normal = labels.map((_,i) => {
    const x = i===10 ? 100 : i*10+5;
    return +(n * 10 * (1/(sd*Math.sqrt(2*Math.PI))) * Math.exp(-0.5*((x-mu)/sd)**2)).toFixed(2);
  });

  mkChart('chartNormalOverlay', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '實際人數', data: dist,
          backgroundColor: dist.map((_,i)=>i>=6?'rgba(100,212,168,0.55)':'rgba(240,112,112,0.45)'),
          borderColor: dist.map((_,i)=>i>=6?'#64d4a8':'#f07070'), borderWidth:1, borderRadius:3, order:2 },
        { label: '理論常態', data: normal, type:'line',
          borderColor:'rgba(200,200,220,0.7)', backgroundColor:'transparent',
          pointRadius:0, borderWidth:2, borderDash:[4,3], tension:0.4, order:1 }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins,
        legend:{ labels:{ color:'var(--text-dim)', font:{size:10} } } },
      scales: { ...CHART_DEFAULTS.scales, y:{ ...CHART_DEFAULTS.scales.y, beginAtZero:true } }
    }
  });
}

// UI-CARD-VISIBILITY FIX(0810)：圖表因篩選模式結構性不適用或資料不足而
// 無法有意義呈現時，整卡隱藏而非顯示容易被誤讀的空佔位內容——
// aRegressionCard（迴歸圖，UI-REGRESSION-HIDE FIX(0809)）與 aVarianceCard
// （Δ vs Previous Semester，UI-EMPTY-STATE FIX(0808c)）皆採此模式，原本
// 各自重複 `card.style.setProperty('display', ...)` 共5處，抽出共用函式。
function setChartCardVisible(card, visible) {
  if (card) card.style.setProperty('display', visible ? '' : 'none');
}

function renderRegression(sem, sheet, type = 'all', program = 'all', baseRecs) {
  const card = document.getElementById('aRegressionCard');
  const recs = baseRecs || getAFilteredRecords(sem, sheet, type, program);
  const pts = recs
    .filter(r => r.midterm != null && r.final != null)
    .map(r => ({ x: r.midterm, y: r.final, m: r.masked }));
  if (pts.length < 3) {
    // 資料不足時整卡隱藏而非顯示「無相對應數據載入」佔位文字：實務使用發現
    // 太多篩選組合（尤其「全部班級」這類寬篩選）都會落入此狀態，頻繁出現的
    // 空佔位卡片反而沒有實質資訊、觀感雜亂，比照 aVarianceCard 既有慣例。
    document.getElementById('aRsqLabel').textContent = '';
    setChartCardVisible(card, false);
    return;
  }
  setChartCardVisible(card, true);

  const n=pts.length, sx=pts.reduce((a,p)=>a+p.x,0), sy=pts.reduce((a,p)=>a+p.y,0);
  const sxy=pts.reduce((a,p)=>a+p.x*p.y,0), sxx=pts.reduce((a,p)=>a+p.x*p.x,0);
  const denom = n*sxx - sx*sx;
  if (denom === 0) {
    document.getElementById('aRsqLabel').textContent = `${n}筆真實紀錄，R² = 無法計算（期中成績無差異）`;
    mkChart('chartRegression', {
      type:'scatter', data:{ datasets:[{ label:'學生', data:pts,
        backgroundColor:'rgba(79,142,247,0.5)', pointRadius:4, pointHoverRadius:6 }]},
      options:{ ...CHART_DEFAULTS, plugins:{ ...CHART_DEFAULTS.plugins, legend:{display:false},
        tooltip:{ ...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{ label:ctx=>`${ctx.raw.m}  期中:${ctx.raw.x} 期末:${ctx.raw.y}` }}},
        scales:{ x:{...CHART_DEFAULTS.scales.x,min:0,max:100}, y:{...CHART_DEFAULTS.scales.y,min:0,max:100} }
      }});
    return;
  }
  const slope=(n*sxy-sx*sy)/denom;
  const intc=(sy-slope*sx)/n;
  const ybar=sy/n;
  const sstot=pts.reduce((a,p)=>a+(p.y-ybar)**2,0);
  const ssres=pts.reduce((a,p)=>a+(p.y-(slope*p.x+intc))**2,0);
  const r2=sstot===0 ? 1 : Math.max(0,1-ssres/sstot);

  document.getElementById('aRsqLabel').textContent=`${n}筆真實紀錄，R² = ${r2.toFixed(3)}`;

  const xs=[0,100];
  const line=xs.map(x=>+( slope*x+intc ).toFixed(1));

  mkChart('chartRegression', {
    type:'scatter',
    data:{ datasets:[
      { label:'學生', data:pts,
        backgroundColor:'rgba(79,142,247,0.5)', pointRadius:4, pointHoverRadius:6, order:2 },
      { label:'迴歸線', data:xs.map((x,i)=>({x,y:line[i]})), type:'line',
        borderColor:'#f7a44f', backgroundColor:'transparent',
        pointRadius:0, borderWidth:2, tension:0, order:1 }
    ]},
    options:{ ...CHART_DEFAULTS,
      plugins:{ ...CHART_DEFAULTS.plugins,
        tooltip:{ ...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{ label:ctx=>ctx.dataset.label==='學生'
            ? `${ctx.raw.m}  期中:${ctx.raw.x} 期末:${ctx.raw.y}`
            : `迴歸線` } } },
      scales:{
        x:{ ...CHART_DEFAULTS.scales.x, min:0, max:100, title:{display:true,text:'期中考',color:'var(--text-dim)'} },
        y:{ ...CHART_DEFAULTS.scales.y, min:0, max:100, title:{display:true,text:'期末考',color:'var(--text-dim)'} }
      }
    }
  });
}

function renderVarianceBar(sem, sheet, program = 'all') {
  const type = document.getElementById('aFilterType')?.value || 'all';
  const inclRetaker = getIncludeRetaker('A');
  const card = document.getElementById('aVarianceCard');
  const selectedCompare = updateCompareFilter(sem, sheet, type, inclRetaker, program);

  // UI-EMPTY-STATE FIX(0808c)：全學期模式下沒有單一明確的「前一學期」可
  // 比較（updateCompareFilter() 也早已把比較基準下拉選單標示為「全學期
  // 模式下不適用」），這是結構性不適用，並非資料或篩選問題。原本仍會往下
  // 嘗試繪製「無可比較資料」佔位長條圖，但該圖 y 軸刻度/格線皆隱藏、只剩
  // 一根高度為 0 的柱子，視覺上與空白無異，讓人誤以為故障。改為直接隱藏
  // 整張卡片，比留下一個看起來壞掉的空圖更清楚誠實。
  if (sem === 'all') {
    setChartCardVisible(card, false);
    return;
  }

  const candidates = availableCompareSems(sem, sheet, type, inclRetaker, program);
  const prevSem = selectedCompare !== 'auto' ? selectedCompare : candidates[0];
  // getClassSummary 已自動覆蓋 _nr 欄位，inclRetaker=false 時 cls.avg_semester 即為排除重修生版本
  const cur = getClassSummary(sem, sheet, type, inclRetaker, program);
  const prev = prevSem ? getClassSummary(prevSem, sheet, type, inclRetaker, program) : null;

  if (!cur || !prev) {
    // 同樣屬於「這個具體篩選組合下無法比較」（例如選到資料集裡最早的
    // 學期，本就不存在更早的同班資料）——結構性無法比較，非暫時無資料，
    // 比照上方全學期模式，直接隱藏整張卡片。
    setChartCardVisible(card, false);
    return;
  }
  setChartCardVisible(card, true);

  const metrics = ['avg_midterm','avg_final','avg_semester','pass_rate'];
  const mLabels = ['期中均分','期末均分','學期均分','及格率×100'];
  const deltas  = metrics.map((m,i)=>{
    const c = cur[m]??0, p = prev[m]??0;
    return i===3 ? +((c-p)*100).toFixed(1) : +(c-p).toFixed(1);
  });
  const typeLabel = type === 'all' ? '全部課別' : (type === 'practicum' ? '實驗課' : '正課');

  mkChart('chartVariance',{
    type:'bar',
    data:{ labels:mLabels, datasets:[{
      label:`vs ${semLabel(prevSem)}`,
      data:deltas,
      backgroundColor:deltas.map(d=>d>=0?'rgba(100,212,168,0.65)':'rgba(240,112,112,0.55)'),
      borderColor:deltas.map(d=>d>=0?'#64d4a8':'#f07070'),
      borderWidth:1, borderRadius:4
    }]},
    options:{ ...CHART_DEFAULTS,
      plugins:{ ...CHART_DEFAULTS.plugins, legend:{display:false},
        subtitle:{display:true,text:`${semLabel(sem)} ${normalizeSheet(sheet)}（${typeLabel}） vs ${semLabel(prevSem)}`,color:'var(--text-dim)',font:{size:10}},
        tooltip:{...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{label:ctx=>{
            const i = ctx.dataIndex;
            const metric = metrics[i];
            const curVal = metric === 'pass_rate' && cur[metric] != null ? (cur[metric]*100).toFixed(1) : cur[metric];
            const prevVal = metric === 'pass_rate' && prev[metric] != null ? (prev[metric]*100).toFixed(1) : prev[metric];
            return `${prevVal ?? '–'} → ${curVal ?? '–'}，Δ ${ctx.raw>=0?'+':''}${ctx.raw}`;
          }}} },
      scales:{
        x:{ ...CHART_DEFAULTS.scales.x },
        y:{ ...CHART_DEFAULTS.scales.y,
          title:{display:true,text:'相對比較基準變化量',color:'var(--text-dim)'} }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL C — 新增圖表
// ══════════════════════════════════════════════════════════
function renderAnomalyDensity() {
  const sems = DATA.meta.semesters;
  const colorMap = { red:'重大違規', yellow:'學習態度異常', blue:'行政缺漏', gray:'特殊身份' };

  const countMap = {};
  Object.keys(colorMap).forEach(c => { countMap[c] = {}; });
  Object.values(DATA.students).forEach(s => {
    s.records.forEach(r => {
      r.exceptions.forEach(e => {
        if (countMap[e.color]) {
          countMap[e.color][r.semester] = (countMap[e.color][r.semester] || 0) + 1;
        }
      });
    });
  });

  const datasets = Object.entries(colorMap).map(([color, label]) => {
    const borderCol = {red:'#f07070',yellow:'#f0c85b',blue:'#5b8af0',gray:'#6b748f'}[color];
    return {
      label,
      data: sems.map(sem => countMap[color][sem] || 0),
      borderColor: borderCol,
      backgroundColor: borderCol+'33',
      fill: true, tension:0.3, pointRadius:4, spanGaps:true
    };
  });

  mkChart('chartAnomalyDensity',{
    type:'line',
    data:{ labels:sems.map(semLabel), datasets },
    options:{ ...CHART_DEFAULTS,
      plugins:{ ...CHART_DEFAULTS.plugins,
        legend:{labels:{color:'var(--text-dim)',font:{size:10}}},
        tooltip:{...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{label:ctx=>`${ctx.dataset.label}：${ctx.raw} 人次`}} },
      scales:{ x:{...CHART_DEFAULTS.scales.x}, y:{...CHART_DEFAULTS.scales.y,beginAtZero:true,
        title:{display:true,text:'異常人次',color:'var(--text-dim)'}} }
    }
  });
}

function renderRetakerFirstDist() {
  const bins = Array(11).fill(0);
  Object.values(DATA.students).forEach(s=>{
    if (!s.records.some(r=>r.is_retaker)) return; // 非重修生跳過
    // 取首修記錄（is_retaker=false）中最早那筆
    const firstRec = [...s.records.filter(r=>!r.is_retaker)]
      .sort(compareClassRecords)[0];
    const first = firstRec?.semester_score;
    if (first==null) return;
    const b = Math.min(Math.floor(first/10), 10);
    bins[b]++;
  });
  const labels=['0–9','10–19','20–29','30–39','40–49','50–59','60–69','70–79','80–89','90–99','100'];
  mkChart('chartRetakerFirstDist',{
    type:'bar',
    data:{ labels, datasets:[{
      label:'重修生人數', data:bins,
      backgroundColor:bins.map((_,i)=>i>=6?'rgba(224,108,140,0.5)':'rgba(240,112,112,0.65)'),
      borderColor:bins.map((_,i)=>i>=6?'#e06c8c':'#f07070'),
      borderWidth:1, borderRadius:3
    }]},
    options:{ ...CHART_DEFAULTS,
      plugins:{...CHART_DEFAULTS.plugins,legend:{display:false},
        tooltip:{...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{label:ctx=>`${ctx.raw} 位重修生首修分數在此區間`}}},
      scales:{...CHART_DEFAULTS.scales, y:{...CHART_DEFAULTS.scales.y,beginAtZero:true}}
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL B — 新增圖表
// ══════════════════════════════════════════════════════════
function renderDeltaByProgram(retakers) {
  const progDeltas = {};
  retakers.forEach(item => {
    item.recs.filter(r => r.delta != null).forEach(r => {
      const p = classifyProgram(r.sheet_name, r.semester);
      if (!progDeltas[p]) progDeltas[p] = [];
      progDeltas[p].push(r.delta);
    });
  });
  const progs = PROGRAM_ORDER.filter(p=>progDeltas[p]?.length);
  const avgs  = progs.map(p=>+(progDeltas[p].reduce((a,v)=>a+v,0)/progDeltas[p].length).toFixed(1));

  mkChart('chartDeltaByProgram',{
    type:'bar',
    data:{ labels:progs.map(p=>PROGRAM_LABELS[p]), datasets:[{
      label:'平均成績變化量 Δ',
      data:avgs,
      backgroundColor:avgs.map(v=>v>=0?'rgba(100,212,168,0.65)':'rgba(240,112,112,0.55)'),
      borderColor:avgs.map(v=>v>=0?'#64d4a8':'#f07070'),
      borderWidth:1, borderRadius:4
    }]},
    options:{ ...CHART_DEFAULTS,
      plugins:{...CHART_DEFAULTS.plugins,legend:{display:false},
        tooltip:{...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{label:ctx=>`平均 Δ：${ctx.raw>=0?'+':''}${ctx.raw} 分（${progDeltas[progs[ctx.dataIndex]]?.length}人）`}}},
      scales:{ x:{...CHART_DEFAULTS.scales.x},
        y:{...CHART_DEFAULTS.scales.y, title:{display:true,text:'平均 Δ（分）',color:'var(--text-dim)'}} }
    }
  });
}

function renderRetakeCount(type) {
  const countDist = {};
  Object.values(DATA.students).forEach(s=>{
    const recs = s.records.filter(r=>r.is_retaker && r.type===type);
    if (!recs.length) return;
    const bySheet = {};
    recs.forEach(r=>{ bySheet[r.sheet_name]=(bySheet[r.sheet_name]||0)+1; });
    Object.values(bySheet).forEach(cnt=>{ countDist[cnt]=(countDist[cnt]||0)+1; });
  });
  const maxC = Math.max(...Object.keys(countDist).map(Number), 1);
  const labels=[], data=[];
  for(let i=1;i<=maxC;i++){
    labels.push(`重修第${i}次`);
    data.push(countDist[i]||0);
  }
  mkChart('chartRetakeCount',{
    type:'bar',
    data:{ labels, datasets:[{
      label:'學生人數', data,
      backgroundColor:data.map((_,i)=>i===0?'rgba(79,142,247,0.5)':'rgba(247,164,79,0.65)'),
      borderColor:data.map((_,i)=>i===0?'#4f8ef7':'#f7a44f'),
      borderWidth:1, borderRadius:4
    }]},
    options:{ ...CHART_DEFAULTS,
      plugins:{...CHART_DEFAULTS.plugins,legend:{display:false}},
      scales:{...CHART_DEFAULTS.scales,y:{...CHART_DEFAULTS.scales.y,beginAtZero:true}}
    }
  });
}

function renderFirstVsDelta() {
  const type = document.getElementById('bFilterType').value;
  const pts=[];
  Object.values(DATA.students).forEach(s=>{
    const firstRec=[...s.records.filter(r=>!r.is_retaker&&r.type===type)].sort(compareClassRecords)[0];
    const retakeRecs=[...s.records.filter(r=>r.is_retaker&&r.type===type)].sort(compareClassRecords);
    if(!retakeRecs.length) return;
    const first=firstRec?.semester_score;
    retakeRecs.forEach(r=>{ if(r.delta!=null&&first!=null) pts.push({x:first,y:r.delta,m:s.name_masked}); });
  });
  mkChart('chartFirstVsDelta',{
    type:'scatter',
    data:{ datasets:[{
      label:'重修生',
      data:pts,
      backgroundColor:pts.map(p=>p.y>=0?'rgba(100,212,168,0.6)':'rgba(240,112,112,0.55)'),
      pointRadius:5, pointHoverRadius:7
    }]},
    options:{ ...CHART_DEFAULTS,
      plugins:{...CHART_DEFAULTS.plugins,legend:{display:false},
        tooltip:{...CHART_DEFAULTS.plugins.tooltip,
          callbacks:{label:ctx=>`${ctx.raw.m}  首修:${ctx.raw.x}  Δ:${ctx.raw.y>=0?'+':''}${ctx.raw.y}`}}},
      scales:{
        x:{...CHART_DEFAULTS.scales.x,min:0,max:100,title:{display:true,text:'首修學期成績',color:'var(--text-dim)'}},
        y:{...CHART_DEFAULTS.scales.y,title:{display:true,text:'重修成績變化量 Δ',color:'var(--text-dim)'}}
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
// PANEL D — 新增圖表
// ══════════════════════════════════════════════════════════
function renderHeatmap(filtered) {
  const wrap = document.getElementById('heatmapWrap');
  const sems  = getDSemList();

  function mergeWeightedAvg(a, aw, b, bw) {
    if (a == null) return b ?? null;
    if (b == null) return a;
    const wa = aw || 1, wb = bw || 1;
    return +(((a * wa) + (b * wb)) / (wa + wb)).toFixed(2);
  }

  const cellMap = new Map();
  filtered.forEach(c => {
    const cls = normalizeSheet(c.sheet_name);
    if (!cls) return;
    const key = `${c.semester}__${cls}`;
    const rec = { ...c, sheet_name: cls };
    const prev = cellMap.get(key);
    if (!prev) {
      cellMap.set(key, rec);
      return;
    }

    const prevCount = Number(prev.count) || 0;
    const nextCount = Number(rec.count) || 0;
    ['avg_midterm', 'avg_final', 'avg_semester'].forEach(field => {
      prev[field] = mergeWeightedAvg(prev[field], prevCount, rec[field], nextCount);
    });
    prev.pass_rate = mergeWeightedAvg(prev.pass_rate, prevCount, rec.pass_rate, nextCount);
    prev.count = prevCount + nextCount || prev.count || rec.count;
  });

  const heatRows = [...cellMap.values()];
  const classes = sortSheetNames([...new Set(heatRows.map(c=>c.sheet_name))]);
  if (!classes.length) { wrap.innerHTML='<div class="empty-state">無資料</div>'; return; }

  const isDark = !document.body.classList.contains('light');
  const cellW=56, cellH=32, labelW=90, headerH=30;
  const W=labelW+sems.length*cellW, H=headerH+classes.length*cellH;

  const vals=heatRows.map(c=>c.avg_semester).filter(v=>v!=null);
  const minV=vals.length ? Math.min(...vals) : 0, maxV=vals.length ? Math.max(...vals) : 100;
  const lerp=(v,mn,mx)=>mx===mn?0.5:(v-mn)/(mx-mn);

  function scoreColor(v) {
    if(v==null) return isDark?'#1c2030':'#e0e4f0';
    const t=lerp(v,minV,maxV);
    const r=Math.round(220*(1-t)+40*t), g=Math.round(80*(1-t)+200*t), b=Math.round(80*(1-t)+100*t);
    return `rgb(${r},${g},${b})`;
  }
  const textCol=isDark?'#dde3f5':'#1a1d2e';
  const dimCol='#6b748f';
  const bgCol=isDark?'#13161f':'#ffffff';

  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" class="ladash-svg-block">`;
  svg+=`<rect width="${W}" height="${H}" fill="${bgCol}" rx="8"/>`;
  sems.forEach((s,i)=>{
    svg+=`<text x="${labelW+i*cellW+cellW/2}" y="${headerH-8}" text-anchor="middle" fill="${dimCol}" font-size="9" font-family="monospace">${safeSvgAttr(semLabel(s))}</text>`;
  });
  classes.forEach((cls,ri)=>{
    const y=headerH+ri*cellH;
    svg+=`<text x="${labelW-6}" y="${y+cellH/2+4}" text-anchor="end" fill="${textCol}" font-size="10" font-family="sans-serif">${safeSvgAttr(cls)}</text>`;
    sems.forEach((sem,ci)=>{
      const rec=cellMap.get(`${sem}__${cls}`);
      const v=rec?.avg_semester;
      const fill=scoreColor(v);
      const lum=v!=null?lerp(v,minV,maxV):0.5;
      const txtFill=lum>0.5?'#0a0c14':'#f0f4ff';
      const tipData = v!=null
        ? `data-svgtip="1" data-cls="${safeSvgAttr(cls)}" data-sem="${safeSvgAttr(sem)}" data-avg="${v.toFixed(1)}" data-pass="${rec.pass_rate!=null?(rec.pass_rate*100).toFixed(1)+'%':'–'}" data-n="${rec.count}"`
        : `data-svgtip="1" data-cls="${safeSvgAttr(cls)}" data-sem="${safeSvgAttr(sem)}" data-avg="無資料"`;
      svg+=`<rect ${tipData} x="${labelW+ci*cellW+1}" y="${y+1}" width="${cellW-2}" height="${cellH-2}" fill="${fill}" rx="3" cursor="crosshair"/>`;
      if(v!=null) svg+=`<text pointer-events="none" x="${labelW+ci*cellW+cellW/2}" y="${y+cellH/2+4}" text-anchor="middle" fill="${txtFill}" font-size="10" font-weight="600" font-family="monospace">${v.toFixed(1)}</text>`;
    });
  });
  svg+=`</svg>`;
  wrap.innerHTML=svg;

  const svgEl = wrap.querySelector('svg');
  addSvgTooltip(svgEl, '[data-svgtip]', el => {
    const avg = el.dataset.avg;
    if (avg === '無資料') return `<b>${el.dataset.cls}</b>\n${semLabel(el.dataset.sem)}\n無資料`;
    return `<b>${el.dataset.cls}</b>\n${semLabel(el.dataset.sem)}\n學期均分：<b>${avg}</b>\n及格率：${el.dataset.pass}\n人數：${el.dataset.n}`;
  });
}

function renderBoxPlot(allClasses, filterProg) {
  const wrap=document.getElementById('boxplotWrap');
  const programs = filterProg === 'all'
    ? PROGRAM_ORDER
    : PROGRAM_ORDER.filter(p => p === filterProg);

  const progScores={};
  programs.forEach(p=>progScores[p]=[]);
  allClasses.forEach(c => {
    if (!programs.includes(c.program)) return;
    if (c.avg_semester == null) return;
    progScores[c.program].push(c.avg_semester);
  });

  const isDark=!document.body.classList.contains('light');
  // 讀取容器實際高度（展開後會變大）；fallback 240
  // 縮小狀態時先清除 SVG 殘留的 height style，讓容器回到 CSS 預設高度再量測
  const existingSvg = wrap.querySelector('svg');
  if (existingSvg) existingSvg.style.setProperty('height', '');
  const isExpanded = wrap.closest('.chart-card')?.classList.contains('chart-expanded');
  const containerH = isExpanded
    ? (wrap.clientHeight > 60 ? wrap.clientHeight : 240)
    : 240;  // 縮小狀態固定回 240，不依賴 clientHeight
  const W=Math.max(300,programs.length*90+60), H=containerH;
  const pad={l:40,r:10,t:10,b:50}, innerH=H-pad.t-pad.b, innerW=W-pad.l-pad.r;
  const scaleY=v=>pad.t+innerH*(1-(v/100));
  const textCol=isDark?'#9aa0b8':'#4a5070';
  const bgCol=isDark?'#13161f':'#ffffff';
  const gridCol=isDark?'#242840':'#e0e4f0';

  // viewBox + width:100% 讓 SVG 隨容器縮放；min-width 防止過窄
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" class="ladash-svg-block ladash-svg-responsive" data-minw="${W}">`;
  svg+=`<rect width="${W}" height="${H}" fill="${bgCol}" rx="8"/>`;

  [0,25,50,FAIL_THRESHOLD,75,100].forEach(v=>{
    const y=scaleY(v);
    svg+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="${gridCol}" stroke-width="${v===FAIL_THRESHOLD?1.5:0.5}" stroke-dasharray="${v===FAIL_THRESHOLD?'4 3':''}"/>`;
    svg+=`<text x="${pad.l-4}" y="${y+4}" text-anchor="end" fill="${textCol}" font-size="9" font-family="monospace">${v}</text>`;
  });

  programs.forEach((p,i)=>{
    const scores=progScores[p].sort((a,b)=>a-b);
    if(scores.length<4) return;
    const x=pad.l+(i+0.5)*(innerW/programs.length);
    const bw=Math.min(30,(innerW/programs.length)*0.5);
    const q1=scores[Math.floor(scores.length*0.25)];
    const med=scores[Math.floor(scores.length*0.5)];
    const q3=scores[Math.floor(scores.length*0.75)];
    const iqr=q3-q1;
    const lo=Math.max(scores[0],q1-1.5*iqr);
    const hi=Math.min(scores[scores.length-1],q3+1.5*iqr);
    const col=PROGRAM_COLORS[p];
    const outliers=scores.filter(v=>v<lo||v>hi);
    const avg=+(scores.reduce((a,v)=>a+v,0)/scores.length).toFixed(1);

    const tipAttr=`data-svgtip="1" data-prog="${PROGRAM_LABELS[p]}" data-n="${scores.length}" data-med="${med.toFixed(1)}" data-q1="${q1.toFixed(1)}" data-q3="${q3.toFixed(1)}" data-lo="${lo.toFixed(1)}" data-hi="${hi.toFixed(1)}" data-avg="${avg}" data-out="${outliers.length}"`;

    svg+=`<line x1="${x}" y1="${scaleY(lo)}" x2="${x}" y2="${scaleY(q1)}" stroke="${col}" stroke-width="1.5"/>`;
    svg+=`<line x1="${x}" y1="${scaleY(q3)}" x2="${x}" y2="${scaleY(hi)}" stroke="${col}" stroke-width="1.5"/>`;
    svg+=`<line x1="${x-bw/3}" y1="${scaleY(lo)}" x2="${x+bw/3}" y2="${scaleY(lo)}" stroke="${col}" stroke-width="1.5"/>`;
    svg+=`<line x1="${x-bw/3}" y1="${scaleY(hi)}" x2="${x+bw/3}" y2="${scaleY(hi)}" stroke="${col}" stroke-width="1.5"/>`;
    svg+=`<rect ${tipAttr} x="${x-bw/2}" y="${scaleY(q3)}" width="${bw}" height="${scaleY(q1)-scaleY(q3)}" fill="${col}33" stroke="${col}" stroke-width="1.5" rx="2" cursor="crosshair"/>`;
    svg+=`<line x1="${x-bw/2}" y1="${scaleY(med)}" x2="${x+bw/2}" y2="${scaleY(med)}" stroke="${col}" stroke-width="2.5"/>`;
    outliers.forEach(v=>{
      svg+=`<circle ${tipAttr} cx="${x}" cy="${scaleY(v)}" r="4" fill="${col}" opacity="0.5" cursor="crosshair"/>`;
    });
    svg+=`<text x="${x}" y="${H-pad.b+14}" text-anchor="middle" fill="${textCol}" font-size="9" font-family="sans-serif">${PROGRAM_LABELS[p].slice(0,4)}</text>`;
    svg+=`<text x="${x}" y="${H-pad.b+24}" text-anchor="middle" fill="${textCol}" font-size="8" font-family="monospace" opacity="0.7">n=${scores.length}</text>`;
  });
  svg+=`</svg>`;
  wrap.innerHTML=svg;

  const svgEl=wrap.querySelector('svg');
  if (svgEl?.dataset.minw) svgEl.style.setProperty('min-width', svgEl.dataset.minw + 'px');
  svgEl?.style.setProperty('height', '100%');
  addSvgTooltip(svgEl,'[data-svgtip]', el=>{
    const d=el.dataset;
    return `<b>${d.prog}</b>（n=${d.n}）\n中位數：<b>${d.med}</b>\nQ1：${d.q1}　Q3：${d.q3}\nIQR：${(d.q3-d.q1).toFixed(1)}\n最小值：${d.lo}　最大值：${d.hi}\n平均值：${d.avg}\n離群值：${d.out} 個`;
  });
}

// 指定學制時「顯示全體回歸線」切換狀態（預設隱藏）
let _corrShowAllReg = false;

function renderCorrelation(filtered) {
  // BUG-FIX（護理系統計污染修正，0805第三次）：filtered 於 Panel D
  // 學制篩選＝「全部」時含 program==='non_nursing'（健四二F，4-10人/
  // 學期的歷史紀錄班級）。此圖為「人數 vs 及格率」護理系規模分析散點，
  // 混入非護理系小班級的點位會誤導判讀，且該 program 未定義於
  // PROGRAM_COLORS 專用聚合色階（僅有中性灰用於明細表徽章），排除之。
  const pts = filtered.filter(c => c.count && c.pass_rate != null && c.program !== 'non_nursing').map(c => ({
    x: c.count, y: +(c.pass_rate * 100).toFixed(1),
    prog: c.program, sem: c.semester, cls: c.sheet_name
  }));

  // ── 大環境變數：動態點形 / 顏色 ──
  // Chart.js v4 scatter：pointStyle/backgroundColor/borderColor 均支援
  // scriptable function (ctx => ...) 確保逐點正確讀取
  const ptBgColors     = pts.map(p => PROGRAM_COLORS[p.prog] + '80'); // ~0.5 透明度
  const ptBorderColors = pts.map(p => PROGRAM_COLORS[p.prog] + 'cc'); // ~0.8 透明度
  const ptStyleFn = ctx => {
    const raw = ctx.raw ?? ctx.dataset.data[ctx.dataIndex];
    if (!raw?.sem) return 'circle';
    switch (getSemPeriod(raw.sem)) {
      case 'covid':      return 'rect';
      case 'overlap':    return 'rectRot';
      case 'curriculum': return 'triangle';
      default:           return 'circle';
    }
  };

  const regData = DATA?.meta?.count_passrate_regression;  // schema 3.0: 巢狀結構
  const optData = DATA?.meta?.optimal_enrollment;         // schema 3.0: 各學制建議人數

  // 讀取目前學制篩選狀態：'all' = 未指定學制，否則為特定學制代碼
  const filterProg = normalizeProgramFilter(
    document.getElementById('dFilterProgram')?.value ?? 'all'
  );
  const isAllProg  = filterProg === 'all';

  // 全體合併回歸線（橘色虛線）
  // 全部學制時：重置切換狀態並顯示；指定學制時：依 _corrShowAllReg 決定
  const regAll = regData?.all;
  if (isAllProg) _corrShowAllReg = false;  // 切回全部學制時重置
  const hasRegAll = isAllProg
    ? (regAll?.available === true)
    : (_corrShowAllReg && regAll?.available === true);

  const rDatasetAll = hasRegAll ? [{
    label: `全體回歸線  r=${regAll.r}  y=${regAll.slope}x${+regAll.intercept >= 0 ? '+' : ''}${(+regAll.intercept).toFixed(2)}`,
    data:        regAll?.line ?? [],
    type:        'line',
    borderColor: 'rgba(247,164,79,0.85)',
    borderWidth: 2,
    borderDash:  [5, 4],
    pointRadius: 0,
    fill:        false,
    tension:     0,
    _progKey:    'all',
  }] : [];

  // 各學制回歸線（依 PROGRAM_COLORS，細實線）
  // 全部學制時隱藏（避免雜亂）；指定學制時只顯示對應學制的回歸線
  const programs = [...new Set(pts.map(p => p.prog))];
  const rDatasetByProg = isAllProg ? [] : programs.flatMap(prog => {
    const reg = regData?.[prog];
    if (!reg?.available) return [];
    const col   = PROGRAM_COLORS[prog] ?? 'rgba(180,180,180,0.7)';
    const label = reg.label ?? PROGRAM_LABELS[prog] ?? prog;
    return [{
      label:       `${label}  r=${reg.r}`,
      data:        reg.line,
      type:        'line',
      borderColor: col,
      borderWidth: 1.5,
      borderDash:  [3, 3],
      pointRadius: 0,
      fill:        false,
      tension:     0,
      _progKey:    prog,  // 供 tooltip 識別
    }];
  });

  const hasAnyReg = hasRegAll || rDatasetByProg.length > 0;

  mkChart('chartCorrelation', {
    type: 'scatter',
    data: {
      datasets: [
        {
          label:            '班次',
          data:             pts,
          backgroundColor:  ptBgColors,
          borderColor:      ptBorderColors,
          borderWidth:      1.5,
          pointStyle:       ptStyleFn,
          pointRadius:      6,
          pointHoverRadius: 8,
          usePointStyle:    true,
        },
        ...rDatasetAll,
        ...rDatasetByProg,
      ]
    },
    options: { ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins,
        legend: {
          display:  hasAnyReg,
          position: 'bottom',
          labels:   { color: 'var(--text,#dde3f5)', font: { size: 11 } },
        },
        subtitle: {
          display: true,
          text: '符號說明：● 常規 ｜ ■ 疫情 ｜ ◆ 重疊 ｜ ▲ 108課綱',
          color: 'var(--text-dim)',
          font: { size: 10 },
          padding: { bottom: 6 },
        },
        tooltip: { ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => {
              // 散佈點：顯示班級資訊
              if (ctx.dataset.type !== 'line') {
                const period = getSemPeriod(ctx.raw.sem);
                const tag = period === 'overlap'    ? ' [疫情/108課綱]'
                          : period === 'covid'      ? ' [疫情期間]'
                          : period === 'curriculum' ? ' [108課綱]'
                          : '';
                return `${ctx.raw.cls} ${semLabel(ctx.raw.sem)}${tag}  人數:${ctx.raw.x} 及格率:${ctx.raw.y}%`;
              }
              // 回歸線：顯示建議人數資訊（方案 2）
              const progKey = ctx.dataset._progKey;
              const opt = optData?.[progKey];
              if (!opt?.available) return null;
              const rangeNote = opt.in_range ? '' : `（觀測範圍外，夾緊至 ${opt.optimal_count_clamped} 人）`;
              return [
                `建議人數：${opt.optimal_count_clamped} 人${rangeNote}`,
                `預期及格率：${opt.optimal_passrate}%`,
                `觀測範圍：${opt.x_min}–${opt.x_max} 人（${opt.n} 筆）`,
              ];
            },
            title: ctx => {
              // 回歸線才顯示學制名稱；散佈點不顯示 title
              const ds = ctx[0]?.dataset;
              if (!ds || ds.type !== 'line') return '';
              const progKey = ds._progKey;
              const opt = optData?.[progKey];
              return opt?.label ?? ds.label ?? '';
            },
          }
        },
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, title: { display: true, text: '班級人數',  color: 'var(--text-dim)' } },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100, title: { display: true, text: '及格率 %', color: 'var(--text-dim)' } },
      },
    },
  });

  // 按鈕插入在 mkChart 之後，鎖定 .chart-wrap；每次強制重建，避免事件監聽殘留舊閉包
  document.getElementById('corrToggleAllRegBtn')?.remove();
  if (!isAllProg && regAll?.available === true) {
    const canvas = document.getElementById('chartCorrelation');
    const anchor = canvas?.closest('.chart-wrap') ?? canvas?.parentNode;
    if (anchor) {
      const btnContainer = document.createElement('div');
      btnContainer.id = 'corrToggleAllRegBtn';
      btnContainer.className = 'ladash-text-right ladash-mb6';
      const btn = document.createElement('button');
      btn.textContent = _corrShowAllReg ? '▶ 顯示全體回歸線' : '▷ 隱藏全體回歸線';
      btn.className = 'ladash-corr-regbtn';
      btn.style.setProperty('background', _corrShowAllReg ? 'rgba(247,164,79,0.18)' : 'transparent');
      btn.style.setProperty('color', _corrShowAllReg ? 'rgba(247,164,79,1)' : 'var(--text-dim,#9aa0b8)');
      btn.addEventListener('click', () => { _corrShowAllReg = !_corrShowAllReg; renderD(); });
      btnContainer.appendChild(btn);
      anchor.insertBefore(btnContainer, anchor.firstChild);
    }
  }

  // 方案 1：圖表下方摘要表格
  _renderEnrollmentSummary(programs, optData);
}

/**
 * 顯示當前篩選有資料的學制 + 全體合併（all）。
 * available=false 的學制也顯示，說明原因。
 */
function _renderEnrollmentSummary(programs, optData) {
  const el = document.getElementById('enrollmentSummary');
  if (!el || !optData) return;

  // 顯示順序：全體合併優先，其餘依 PROGRAM_ORDER
  const keys = ['all', ...programs].filter((k, i, arr) => arr.indexOf(k) === i);

  const reasonText = {
    no_maximum:        '人數分布呈 U 型，無最大值',
    insufficient_data: '資料點不足（< 3 筆）',
    singular_matrix:   '資料共線，無法計算',
    linear:            '回歸退化為線性，無最大值',
  };

  // 依 PROGRAM_ORDER 排序，確保表格顯示順序一致
  const SUMMARY_ORDER = ['all', ...PROGRAM_ORDER];
  const sortedKeys = SUMMARY_ORDER.filter(k => keys.includes(k));
  // 補上 PROGRAM_ORDER 未涵蓋的 key（如未來新學制）
  keys.forEach(k => { if (!sortedKeys.includes(k)) sortedKeys.push(k); });

  const rows = sortedKeys.map(key => {
    const opt = optData[key];
    if (!opt) return '';
    const label = escapeHtml(opt.label ?? key);
    const color = key === 'all'
      ? 'rgba(247,164,79,0.9)'
      : (PROGRAM_COLORS[key] ?? 'var(--text-dim)');

    if (opt.available) {
      const clamped  = opt.in_range ? '' :
        `<span class="ladash-dim-xs"> →夾緊至 ${opt.optimal_count_clamped} 人</span>`;
      const inRange  = opt.in_range
        ? '<span class="ladash-color-success">✓</span>'
        : '<span class="ladash-color-warn">⚠</span>';
      return `<tr>
        <td><span class="ladash-color-dot" data-bg="${color}"></span>${label}</td>
        <td class="ladash-td-c">${opt.optimal_count_clamped} 人${clamped}</td>
        <td class="ladash-td-c">${opt.optimal_passrate}%</td>
        <td class="ladash-td-c">${opt.n} 筆</td>
        <td class="ladash-td-c">${opt.x_min}–${opt.x_max}</td>
        <td class="ladash-td-c">${inRange}</td>
      </tr>`;
    } else {
      const reason = reasonText[opt.reason] ?? escapeHtml(opt.reason ?? '–');
      return `<tr class="ladash-tr-dim">
        <td><span class="ladash-color-dot" data-bg="${color}"></span>${label}</td>
        <td colspan="4" class="ladash-td-note">⚠ ${reason}</td>
        <td class="ladash-td-c">${opt.n ?? '–'} 筆</td>
      </tr>`;
    }
  }).join('');

  el.innerHTML = rows
    ? `<table class="enrollment-summary-table">
        <thead><tr>
          <th>學制</th>
          <th>建議人數</th>
          <th>預期及格率</th>
          <th>資料點</th>
          <th>觀測範圍</th>
          <th>在範圍內</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : '';
  el.querySelectorAll('[data-bg]').forEach(function(span) {
    if (span.dataset.bg) span.style.setProperty('background', span.dataset.bg);
  });
}

// ══════════════════════════════════════════════════════════
// TAB SWITCH
// ══════════════════════════════════════════════════════════
function switchTab(tab) {
  closeExpandedChart();
  const TAB_ORDER = ['D','A','C','L','R','P'];
  document.querySelectorAll('.tab').forEach((t, i) => {
    const isActive = TAB_ORDER[i] === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel' + tab);
  if (panel) panel.classList.add('active');
  if (tab === 'A') renderA();
  if (tab === 'C') { initCPanel(); }
  if (tab === 'D') renderD();
  if (tab === 'L') {
    // BUG-MAIN-1 FIX: guard against behavior-init.js load failure
    if (typeof BehaviorTabManager !== 'undefined') BehaviorTabManager.lazyInit();
    requestAnimationFrame(() => {
      ['radarChart','weeklyQuizChart','preExamChart','timeSlotChart','hourlyLineChart','scatterChart'].forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const inst = Chart.getChart(canvas);
        if (inst) { inst.resize(); inst.update('none'); }
      });
    });
  }
  // BUG-MAIN-1 FIX: guard against at-risk-report.js load failure
  if (tab === 'R') {
    if (typeof AtRiskReportManager !== 'undefined') AtRiskReportManager.lazyInit();
  }
  if (tab === 'P' && window.PrintPanel) window.PrintPanel.renderPanel();
  requestAnimationFrame(() => {
    attachHelpButtons();
    attachChartExpandButtons();
  });
}

// ══════════════════════════════════════════════════════════
// 深/淺色模式切換
// ══════════════════════════════════════════════════════════
function updateSubjectDisplay() {
  const subj = document.getElementById('subjectInput')?.textContent?.trim();
  const badge = document.getElementById('yearRangeBadge');
  if (badge && subj) {
    badge.title = '科目：' + subj;
  }
}

async function autoFillSubjectFromBehavior() {
  const input = document.getElementById('subjectInput');
  if (!input) return;

  // BUGFIX-F（0716 穿透式審查後續）：init() 若已從 data.json 的
  // meta.course_name 提早填好（見 main.js init() 內同編號註記），這裡就不用
  // 再等 behavior.json（18MB+）載入完成後重覆設定一次。
  if (input.dataset.filledEarly === "1") { updateSubjectDisplay(); return; }

  let courseName = null;

  if (!courseName && window.BEHAVIOR_SUMMARY?.course_name) {
    courseName = window.BEHAVIOR_SUMMARY.course_name;
  }
  if (!courseName && typeof BehaviorRadarTab !== 'undefined' && BehaviorRadarTab._meta?.course_name) {
    courseName = BehaviorRadarTab._meta.course_name;
  }
  // BUG-MAIN-2 FIX: use BehaviorLoader LRU cache (+ .gz fallback) instead of
  // bypassing it with a raw fetch, which caused behavior.json (5.5 MB) to be
  // downloaded a second time on every lazyInit call.
  if (!courseName && typeof BehaviorLoader !== 'undefined') {
    try {
      const data = await BehaviorLoader.load.behavior();
      courseName = data?.meta?.course_name ?? null;
    } catch (_) { }
  }

  // UI-FIX-1（0716 更新）：舊版 ETL 曾經 behavior.json / at_risk_profile.json
  // 的 meta.course_name 恆為空字串（v7.8 之前），此處加上預設文字避免徽章
  // 永久空白；與 print-panel.js getSubjectLabel() 的 fallback 文字保持一致。
  // v7.8 起 behavior.json 已能正確帶出真實課程名稱，但仍得等該分頁背景預載
  // 完成才看得到——這正是本輪 BUGFIX-F 要提早解決的體感延遲，故仍保留這條
  // 路徑作為 data.json 尚未補上 course_name 欄位前的相容 fallback。
  input.textContent = courseName || '微生物免疫學成績與學習行為儀表板';
  updateSubjectDisplay();
}

function toggleMetaInfo() {
  const header = document.querySelector('header');
  const btn = document.getElementById('metaToggle');
  const open = header?.classList.toggle('meta-open');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  const themeMeta = document.getElementById('themeColorMeta');
  if (themeMeta) themeMeta.setAttribute('content', isLight ? '#f2f6f4' : '#0e1724');
  localStorage.setItem('la-theme', isLight ? 'light' : 'dark');
  refreshChartDefaults();
  if (!DATA) return;
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    const tabs = [...document.querySelectorAll('.tab')];
    const tabId = ['D','A','C','L','R','P'][tabs.indexOf(activeTab)];
    if (tabId === 'A') { renderA(); renderTrend(); }
    if (tabId === 'C') renderCView();
    if (tabId === 'D') renderD();
    if (tabId === 'L' && typeof BehaviorTabManager !== 'undefined' &&
        typeof BehaviorTabManager.reRenderActive === 'function') {
      BehaviorTabManager.reRenderActive();
    }
    if (tabId === 'P' && window.PrintPanel) window.PrintPanel.renderPanel();
    if (tabId === 'R' && typeof AtRiskReportManager !== 'undefined' && AtRiskReportManager.reRenderRadar) {
      AtRiskReportManager.reRenderRadar();
    }
    requestAnimationFrame(() => {
      attachHelpButtons();
      attachChartExpandButtons();
    });
  }
}

// 初始化主題
(function() {
  const saved = localStorage.getItem('la-theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    const themeMeta = document.getElementById('themeColorMeta');
    if (themeMeta) themeMeta.setAttribute('content', '#f2f6f4');
  }
  refreshChartDefaults();
})();

// ══════════════════════════════════════════════════════════
// 學制分類器
// ══════════════════════════════════════════════════════════
function classifyProgram(sheetName, semester) {
  return classInfo(sheetName, semester).program;
}

// ══════════════════════════════════════════════════════════
// PANEL D — 跨屆比較
// ══════════════════════════════════════════════════════════
function setDView(v, skipRender) {
  dView = v;
  document.getElementById('dViewMerge').classList.toggle('active', v === 'merge');
  document.getElementById('dViewClass').classList.toggle('active', v === 'class');
  if (!skipRender) renderD();
}

function setDType(t, skipRender) {
  dType = t;
  document.getElementById('dTypeTheory').classList.toggle('active', t === 'theory');
  document.getElementById('dTypePracticum').classList.toggle('active', t === 'practicum');
  const noMidFin = t === 'practicum';
  ['dMetricMid', 'dMetricFin'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = noMidFin;
      btn.style.setProperty('opacity', noMidFin ? '0.35' : '1');    // CSP-V7-FIX
      btn.style.setProperty('cursor',  noMidFin ? 'not-allowed' : 'pointer'); // CSP-V7-FIX
      btn.title = noMidFin ? '實驗課不支援期中／期末成績' : '';
    }
  });
  if (noMidFin && dMetric !== 'semester_score') {
    setDMetric('semester_score', skipRender);
    return;
  }
  if (!skipRender) renderD();
}

function setDMetric(m, skipRender) {
  dMetric = m;
  ['semester_score','midterm','final'].forEach(k => {
    const map = { semester_score:'dMetricSem', midterm:'dMetricMid', final:'dMetricFin' };
    document.getElementById(map[k]).classList.toggle('active', k === m);
  });
  if (!skipRender) renderD();
}

function metricLabel(m) {
  return { semester_score:'學期成績', midterm:'期中考', final:'期末考' }[m] || m;
}

function metricField(m) {
  return { semester_score:'avg_semester', midterm:'avg_midterm', final:'avg_final' }[m] || m;
}

// UI-RESET-D FIX(0808)：跨屆比較分頁「清除條件」按鈕（dResetBtn）。
// 比照 resetAFilters()／resetCFilters() 慣例：直接重置各篩選 DOM/狀態變數為
// 預設值後呼叫 renderD()，不做 undo 快照（Panel A 才有的 aResetHint/復原
// 屬於該分頁既有的加強功能，其餘分頁的清除條件按鈕均無此設計，維持一致）。
function resetDFilters() {
  // 學期雙模選擇器：清空多選膠囊、切回預設「範圍」模式、重建為全範圍
  dSemSelected.clear();
  setDSemMode('range', true);
  initDSemFilter();
  _syncCapsuleStyles();
  _updateMultiCount();

  // 其餘篩選條件重置為預設值
  document.getElementById('dFilterProgram').value = 'all';
  setDType('theory', true);
  setDView('merge', true);
  setDMetric('semester_score', true);

  if (typeof _retakerState !== 'undefined') {
    _retakerState['D'] = true;
    if (typeof _syncRetakerBtn === 'function') _syncRetakerBtn('D');
  }
  if (typeof _filterCollapsed !== 'undefined' && _filterCollapsed['D']) {
    _filterCollapsed['D'] = false;
    if (typeof _applyFilterCollapse === 'function') _applyFilterCollapse('D');
  }

  renderD();
}

// ══════════════════════════════════════════════════════════
// PHASE 6 — 全域 UX
// ══════════════════════════════════════════════════════════
const _retakerState = { A: true, D: true, C: true };

function toggleRetakerSwitch(panel) {
  const progEl = document.getElementById(
    panel === 'A' ? 'aFilterProgram' :
    panel === 'D' ? 'dFilterProgram' : 'cFilterProgram'
  );
  const prog = normalizeProgramFilter(progEl?.value || 'all');

  if (typeof FilterEngine !== 'undefined' && FilterEngine.isRetakerSwitchLocked(prog)) {
    return;
  }

  _retakerState[panel] = !_retakerState[panel];
  _syncRetakerBtn(panel);

  if (panel === 'A') renderA();
  else if (panel === 'D') renderD();
  else if (panel === 'C') renderCView();
}

function _syncRetakerBtn(panel) {
  const btn = document.getElementById(`${panel.toLowerCase()}RetakerSwitch`);
  if (!btn) return;
  const included = _retakerState[panel];
  btn.className = 'retaker-switch' + (included ? ' active' : '');
  const label = included ? '含跨屆重修生' : '排除跨屆重修生';
  const labelEl = btn.querySelector('.retaker-label');
  if (labelEl) labelEl.textContent = label;
  else btn.textContent = label;

  const progEl = document.getElementById(
    panel === 'A' ? 'aFilterProgram' :
    panel === 'D' ? 'dFilterProgram' : 'cFilterProgram'
  );
  const prog = normalizeProgramFilter(progEl?.value || 'all');
  const locked = typeof FilterEngine !== 'undefined'
    ? FilterEngine.isRetakerSwitchLocked(prog)
    : false;
  if (locked) {
    _retakerState[panel] = true;
    btn.classList.add('locked');
    btn.title = '學制選為「重修生」時，必須包含跨屆重修生';
  } else {
    btn.classList.remove('locked');
    btn.title = '切換是否納入來自前幾屆不及格、跨班重修的學生資料';
  }
}

function getIncludeRetaker(panel) {
  return _retakerState[panel] !== false;
}

// ── 篩選器收合/展開 ───────────────────────────────────────
const _filterCollapsed = { A: false, D: false, C: false };

function toggleFilterCollapse(panel) {
  _filterCollapsed[panel] = !_filterCollapsed[panel];
  _applyFilterCollapse(panel);
}

function _applyFilterCollapse(panel) {
  const collapsed = _filterCollapsed[panel];
  const collapseBar = document.getElementById(`${panel.toLowerCase()}CollapseBar`);
  const summaryEl   = document.getElementById(`${panel.toLowerCase()}CollapseSummary`);

  const panelEl = document.getElementById(`panel${panel}`);
  if (!panelEl) return;

  const filterBars = panelEl.querySelectorAll('.filter-bar');
  filterBars.forEach(bar => {
    bar.classList.toggle('collapsed', collapsed);
  });

  if (collapseBar) {
    collapseBar.style.setProperty('display', collapsed ? 'flex' : 'none');
    const icon = collapseBar.querySelector('.collapse-icon');
    if (icon) icon.textContent = collapsed ? '▶' : '▼';
  }

  if (summaryEl && collapsed) {
    summaryEl.textContent = _buildPanelSummary(panel);
  }

  if (panel === 'D') {
    document.getElementById('dProgramBarWrap')?.classList.toggle('is-hidden', collapsed);
    document.getElementById('dModeHint')?.classList.toggle('is-hidden', collapsed);
  }
}

function _buildPanelSummary(panel) {
  const parts = [];
  if (panel === 'A' || panel === 'D') {
    const semEl  = panel === 'A' ? document.getElementById('aFilterSem') : null;
    const progEl = document.getElementById(panel === 'A' ? 'aFilterProgram' : 'dFilterProgram');
    const typeEl = panel === 'A' ? document.getElementById('aFilterType') : null;
    if (semEl?.value  && semEl.value  !== 'all') parts.push(semLabel(semEl.value));
    if (progEl?.value && progEl.value !== 'all') parts.push(PROGRAM_LABELS[progEl.value] || progEl.value);
    if (typeEl?.value && typeEl.value !== 'all') parts.push(typeEl.value === 'theory' ? '正課' : '實驗課');
    if (panel === 'D' && dSemMode === 'range') {
      const sems = getDComparableSemesters();
      if (sems.length) parts.unshift(`${semLabel(sems[dSemRange[0]])}–${semLabel(sems[dSemRange[1]])}`);
    }
  } else if (panel === 'C') {
    const semEl  = document.getElementById('cFilterSem');
    const progEl = document.getElementById('cFilterProgram');
    if (semEl?.value  && semEl.value  !== 'all') parts.push(semLabel(semEl.value));
    if (progEl?.value && progEl.value !== 'all') parts.push(PROGRAM_LABELS[progEl.value] || progEl.value);
    if (cCurrentType !== 'all') parts.push(cCurrentType === 'theory' ? '正課' : '實驗課');
    if (cCurrentPass !== 'all') parts.push(cCurrentPass === 'pass' ? '及格' : '不及格');
  }
  if (!getIncludeRetaker(panel)) parts.push('排除重修生');
  return parts.length ? parts.join(' · ') : '全部條件';
}

function updateFilterSummary(panel) {
  if (!_filterCollapsed[panel]) return;
  const summaryEl = document.getElementById(`${panel.toLowerCase()}CollapseSummary`);
  if (summaryEl) summaryEl.textContent = _buildPanelSummary(panel);
}

// ══════════════════════════════════════════════════════════
// PANEL D — 學期雙模選擇器
// ══════════════════════════════════════════════════════════
function initDSemFilter() {
  if (!DATA) return;
  const sems = getDComparableSemesters();
  const maxIdx = sems.length - 1;
  if (maxIdx < 0) {
    dSemRange = [0, 0];
    dSemSelected.clear();
    document.getElementById('dSemStart').max = 0;
    document.getElementById('dSemEnd').max = 0;
    document.getElementById('dSemStart').value = 0;
    document.getElementById('dSemEnd').value = 0;
    document.getElementById('dSemMultiWrap').innerHTML = '';
    _updateDSemRangeLabel();
    return;
  }

  document.getElementById('dSemStart').max = maxIdx;
  document.getElementById('dSemEnd').max   = maxIdx;
  document.getElementById('dSemStart').value = 0;
  document.getElementById('dSemEnd').value   = maxIdx;
  dSemRange = [0, maxIdx];

  const wrap = document.getElementById('dSemMultiWrap');
  wrap.innerHTML = sems.map(s => `
    <button class="sem-capsule ladash-sem-cap-btn" data-sem="${escapeHtml(s)}"
            data-action="toggleDSemCapsule">
      ${escapeHtml(semLabel(s))}
    </button>`).join('');

  _updateDSemRangeLabel();
}

function setDSemMode(mode, skipRender) {
  dSemMode = mode;
  document.getElementById('dSemModeRange').classList.toggle('active', mode === 'range');
  document.getElementById('dSemModeMulti').classList.toggle('active', mode === 'multi');
  document.getElementById('dSemRangeWrap').style.setProperty('display', mode === 'range' ? 'flex' : 'none');
  document.getElementById('dSemMultiWrap').style.setProperty('display', mode === 'multi' ? 'flex' : 'none');
  document.getElementById('dSemMultiCount').style.setProperty('display', mode === 'multi' ? 'inline' : 'none');

  // UI-COMPACT-D FIX(0808b)：清除條件按鈕跟著目前可見的容器搬移，讓它隨該
  // 容器既有的 flex-wrap 排列在同一行的剩餘空間，避免獨立於 filter-pair 外層
  // 而在 PWA 窄螢幕（flex-direction:column）下獨佔一整列。注意：initDSemFilter()
  // 只在 mode==='range' 時的呼叫路徑才會執行（見該函式），故不會有按鈕被
  // dSemMultiWrap.innerHTML 重建清空的風險。
  const dResetBtn = document.getElementById('dResetBtn');
  if (dResetBtn) {
    const dResetTarget = document.getElementById(mode === 'multi' ? 'dSemMultiWrap' : 'dSemRangeWrap');
    dResetTarget.appendChild(dResetBtn);
  }

  if (mode === 'multi' && dSemSelected.size === 0 && DATA) {
    const sems = getDComparableSemesters();
    sems.slice(-3).forEach(s => dSemSelected.add(s));
    _syncCapsuleStyles();
  }

  const hint = document.getElementById('dModeHint');
  if (mode === 'multi') {
    hint.innerHTML = '📊 <strong class="text-accent">多選模式</strong> — 點選學期膠囊（最多 5 個）進行並排長條圖比較。';
  } else {
    hint.innerHTML = '📈 <strong class="text-accent">範圍模式</strong> — 顯示連續趨勢折線；超過 6 個學制時自動合併為總平均。';
  }

  document.getElementById('dProgramBarWrap').style.setProperty('display', mode === 'multi' ? 'block' : 'none');
  document.getElementById('dPassRateWrap').style.setProperty('display', mode === 'range' ? 'block' : 'none');

  if (!skipRender) renderD();
}

function onDSemRangeChange(event) {
  let start = parseInt(document.getElementById('dSemStart').value, 10);
  let end   = parseInt(document.getElementById('dSemEnd').value, 10);
  if (start > end) {
    const src = event?.target?.id;
    if (src === 'dSemStart') { start = end; document.getElementById('dSemStart').value = start; }
    else { end = start; document.getElementById('dSemEnd').value = end; }
  }
  dSemRange = [start, end];
  _updateDSemRangeLabel();
  renderD();
}

function toggleDSemCapsule(btn) {
  const sem = btn.dataset.sem;
  if (dSemSelected.has(sem)) {
    dSemSelected.delete(sem);
  } else {
    if (dSemSelected.size >= 5) {
      const first = dSemSelected.values().next().value;
      dSemSelected.delete(first);
    }
    dSemSelected.add(sem);
  }
  _syncCapsuleStyles();
  _updateMultiCount();
  renderD();
}

function getDSemList() {
  if (!DATA) return [];
  const sems = getDComparableSemesters();
  if (dSemMode === 'range') {
    return sems.slice(dSemRange[0], dSemRange[1] + 1);
  }
  return sems.filter(s => dSemSelected.has(s));
}

function _updateDSemRangeLabel() {
  if (!DATA) return;
  const sems = getDComparableSemesters();
  const [si, ei] = dSemRange;
  if (!sems.length) {
    document.getElementById('dSemRangeLabel').textContent = '無可比較學期';
    document.getElementById('dSemRangeCount').textContent = '0 個學期';
    return;
  }
  const count = ei - si + 1;
  document.getElementById('dSemRangeLabel').textContent =
    `${semLabel(sems[si])} – ${semLabel(sems[ei])}`;
  document.getElementById('dSemRangeCount').textContent = `${count} 個學期`;

  if (dView === 'class' && count > 12) {
    document.getElementById('dSemRangeCount').innerHTML =
      `${count} 個學期 <span class="ladash-accent3">⚠ 各班獨立模式下線條可能過多</span>`;
  }
}

function _syncCapsuleStyles() {
  document.querySelectorAll('#dSemMultiWrap .sem-capsule').forEach(btn => {
    const active = dSemSelected.has(btn.dataset.sem);
    btn.style.setProperty('background',   active ? 'var(--accent)'  : 'var(--surface2)');
    btn.style.setProperty('color',        active ? '#fff'            : 'var(--text-dim)');
    btn.style.setProperty('border-color', active ? 'var(--accent)'  : 'var(--border2)');
    btn.style.setProperty('font-weight',  active ? '700'            : '400');
    });
}

function _updateMultiCount() {
  document.getElementById('dSemMultiCount').textContent =
    `已選 ${dSemSelected.size} / 5 個學期`;
}

// ══════════════════════════════════════════════════════════
// 大環境變數 Helper（Panel D）
// 疫情/108課綱範圍由 DATA.meta.covid_sem_range / curriculum_sem_range 動態決定
// ══════════════════════════════════════════════════════════

/**
 * 判斷單一學期代碼屬於哪個大環境期間
 * @param {string} sem  學期代碼，如 '1082'
 * @returns {'normal'|'covid'|'curriculum'|'overlap'}
 */
function getSemPeriod(sem) {
  const isCovid      = sem >= SEM_COVID_START && sem <= SEM_COVID_END;
  const isCurriculum = sem >= SEM_CURRICULUM_START && sem <= SEM_CURRICULUM_END;
  if (isCovid && isCurriculum) return 'overlap';
  if (isCovid)                 return 'covid';
  if (isCurriculum)            return 'curriculum';
  return 'normal';
}

/**
 * 根據當前 sems 陣列動態計算 annotation box 設定
 * 若該區間完全不在 sems 內，對應 annotation 自動省略（回傳空物件）
 * @param {string[]} sems  當前 X 軸學期代碼陣列（原始值，非 label）
 * @returns {object}  chartjs-plugin-annotation annotations 物件
 */
function getEnvAnnotations(sems) {
  // 學期代碼為純數字字串（如 '1082'），JS 詞典序 === 數值升序，字串比較安全
  function boxRange(fromCode, toCode) {
    // 全掃描：不假設 sems 嚴格升序（多選模式可為任意子集）
    let startIdx = -1, endIdx = -1;
    for (let i = 0; i < sems.length; i++) {
      if (sems[i] >= fromCode && sems[i] <= toCode) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    }
    if (startIdx === -1) return null;
    return { xMin: startIdx - 0.5, xMax: endIdx + 0.5 };
  }

  // annotation label.color 不支援 CSS var()，需在 render 時取得實際 hex 值
  const labelColor = chartTextDimColor(); // 深色:#9aa0b8 / 淺色:#6b748f
  const annotations = {};

  const covidRange = boxRange(SEM_COVID_START, SEM_COVID_END);
  if (covidRange) {
    annotations.covidBox = {
      type: 'box',
      drawTime: 'beforeDatasetsDraw',
      xMin: covidRange.xMin,
      xMax: covidRange.xMax,
      backgroundColor: 'rgba(240,112,112,0.12)',  // 加深：深色模式可見
      borderWidth: 0,
      label: {
        display: true,
        content: '疫情期間',
        position: { x: 'center', y: 'end' },      // 移至底部
        yAdjust: -8,                                // 向上微移，避免被 X 軸截切
        color: labelColor,                          // 實際 hex，支援深淺色
        font: { size: 9 },
        backgroundColor: 'transparent',
        padding: 2,
      }
    };
  }

  const curriculumRange = boxRange(SEM_CURRICULUM_START, SEM_CURRICULUM_END);
  if (curriculumRange) {
    annotations.curriculumBox = {
      type: 'box',
      drawTime: 'beforeDatasetsDraw',
      xMin: curriculumRange.xMin,
      xMax: curriculumRange.xMax,
      backgroundColor: 'rgba(79,142,247,0.10)',    // 加深：深色模式可見
      borderWidth: 0,
      label: {
        display: true,
        content: '108課綱',
        position: { x: 'center', y: 'end' },       // 移至底部
        yAdjust: -8,                                 // 向上微移，避免被 X 軸截切
        color: labelColor,                           // 實際 hex，支援深淺色
        font: { size: 9 },
        backgroundColor: 'transparent',
        padding: 2,
      }
    };
  }

  return annotations;
}

// CSP-FIX: CSS custom property injection via DOM API (not style-src governed).
// Call after any innerHTML assignment containing [data-ac] elements.
function _applyAccentColors(root) {
  (root || document).querySelectorAll('[data-ac]').forEach(function(el) {
    el.style.setProperty('--accent-color', el.dataset.ac);
  });
}

// BUGFIX-Q3（0725，依使用者要求後續處理）：
// 「重修生」是學生個人層級標記（is_retaker），並非獨立班級；Panel D（跨屆比較）
// 以「班級」為彙總單位，選了這個選項在資料模型上本來就不可能比對到任何列
// （見 renderD() 內 filtered.length === 0 分支）。與其讓使用者選了才看到提示，
// 不如直接在下拉選單把這個選項反灰、不可選，並用 title 說明原因。
// 僅套用於 Panel D 的 #dFilterProgram；Panel A（#aFilterProgram）／Panel C
// （#cFilterProgram）目前各自已有「查無資料」訊息（_showAEmptyHint／
// _showCEmptyHint），是否也一併反灰待使用者確認後再處理，此處不動。
function _applyDProgramDisabledState() {
  const sel = document.getElementById('dFilterProgram');
  if (!sel) return;
  const opt = Array.from(sel.options).find(o => o.value === 'retake_student');
  if (!opt) return;
  opt.disabled = true;
  opt.style.setProperty('color', 'var(--text-dim)'); // CSP-V5-FIX：走 style API 而非 inline style 字串
  opt.title = '「重修生」是學生個人層級標記（隨班附讀於原班級），跨屆比較以班級彙總，無法呈現此類別的統計';
  // 防禦：若先前（本次修正前）已被存到 FilterMemory / 由其他流程設成 retake_student，重置為 all
  if (sel.value === 'retake_student') {
    sel.value = 'all';
  }
}

function renderD() {
  if (!DATA) return;

  const filterProg = normalizeProgramFilter(
    document.getElementById('dFilterProgram').value
  );
  const sems = getDSemList();

  if (sems.length === 0) {
    document.getElementById('dStats').innerHTML =
      '<div class="empty-state ladash-empty-dim">請至少選擇一個學期</div>';
    return;
  }

  const semsSet = new Set(sems);
  const allClasses = Object.values(DATA.class_summary).map(c => ({
    ...c,
    program: classifyProgram(c.sheet_name, c.semester)
  })).filter(c => {
    if (!semsSet.has(c.semester)) return false;
    if (!getIncludeRetaker('D') &&
        (c.program === 'retake_class' || c.program === 'retake_student')) return false;
    if (dType === 'practicum') return c.type === 'practicum';
    return c.type === 'theory';
  });

  const filtered = filterProg === 'all'
    ? allClasses
    : allClasses.filter(c => {
        if (c.program === filterProg) return true;
        if (getIncludeRetaker('D') && (c.program === 'retake_class' || c.program === 'retake_student')) {
          return getBaseProgram(c.sheet_name) === filterProg;
        }
        return false;
      });

  // BUGFIX-Q2（0725 學制數卡片穿透式審查）：
  // filtered 為空時（最常見於選「重修生」），不要讓後面的卡片/圖表用 0、– 把畫面
  // 填滿、看起來像壞掉。比照本函式上方「未選學期」與 Panel A 對
  // FilterEngine.checkEmptyResult() 空結果的既有訊息樣式，明確顯示原因並中止渲染。
  if (filtered.length === 0) {
    const progLabel = filterProg !== 'all' ? (PROGRAM_LABELS[filterProg] || filterProg) : '';
    const msg = filterProg === 'retake_student'
      ? '「重修生」是學生個人層級的標記（隨班附讀於原班級，例如護22A內的個別重修生），並非獨立班級，因此跨屆比較（依班級彙總）目前無法呈現此類別的統計數字。'
      : `${progLabel ? progLabel + '：' : ''}所選條件組合在目前學期範圍內查無班級資料。`;
    document.getElementById('dStats').innerHTML =
      `<div class="empty-state ladash-empty-error">⚠ ${escapeHtml(msg)}</div>`;
    return;
  }

  const inclRetakerD = getIncludeRetaker('D');
  // filtered 的 class_summary row 已含 _nr 欄位
  // inclRetakerD=false 時讀 count_nr/avg_semester_nr 等；true 時讀 count/avg_semester 等
  const _cntField  = inclRetakerD ? 'count'        : 'count_nr';
  const _avgField  = inclRetakerD ? 'avg_semester'  : 'avg_semester_nr';
  const _passField = inclRetakerD ? 'pass_rate'     : 'pass_rate_nr';
  const _midField  = inclRetakerD ? 'avg_midterm'   : 'avg_midterm_nr';
  const _finField  = inclRetakerD ? 'avg_final'     : 'avg_final_nr';

  // 加權平均（以 count/_nr 為權重）
  let _wScore=0,_wScoreW=0, _wPass=0,_wPassW=0, _wFail=0,_wFailW=0, _wRetake=0,_wRetakeW=0, _wMid=0,_wMidW=0, _wFin=0,_wFinW=0;
  let totalStudents = 0;
  const _failField = inclRetakerD ? 'fail_rate' : 'fail_rate_nr';
  filtered.forEach(c => {
    // BUG-FIX（護理系統計污染修正，0805第三次）：filterProg==='all' 時
    // filtered===allClasses，含 program==='non_nursing'（健四二F等歷史
    // 紀錄班級）。該班不屬護理系，此處為「護理系」加權統計卡片（總人數／
    // 均分／及格率等），故排除；選特定護理系學制時 c.program 本就不會
    // 等於 'non_nursing'，此判斷不影響該情境。
    if (c.program === 'non_nursing') return;
    const cnt = Number(c[_cntField]) || 0;
    totalStudents += cnt;
    if (c[_avgField]  != null) { _wScore  += c[_avgField]  * cnt; _wScoreW  += cnt; }
    if (c[_passField] != null) { _wPass   += c[_passField] * cnt; _wPassW   += cnt; }
    // fail_rate_nr 不在舊 data.json，fallback 用 1-pass_rate_nr
    const failVal = c[_failField] ?? (c[_passField] != null ? 1 - c[_passField] : null);
    if (failVal    != null) { _wFail   += failVal   * cnt; _wFailW   += cnt; }
    if (inclRetakerD && c.retaker_ratio != null) { _wRetake += c.retaker_ratio * cnt; _wRetakeW += cnt; }
    if (c[_midField]  != null) { _wMid    += c[_midField]  * cnt; _wMidW    += cnt; }
    if (c[_finField]  != null) { _wFin    += c[_finField]  * cnt; _wFinW    += cnt; }
  });

  const avgScore   = _wScoreW  > 0 ? (_wScore  / _wScoreW).toFixed(2)        : null;
  const avgPass    = _wPassW   > 0 ? (_wPass   / _wPassW)                     : null;
  const avgFail    = _wFailW   > 0 ? (_wFail   / _wFailW)                     : null;
  const avgRetake  = _wRetakeW > 0 ? (_wRetake / _wRetakeW)                   : null;
  const avgMidterm = _wMidW    > 0 ? (_wMid    / _wMidW).toFixed(2)           : null;
  const avgFinal   = _wFinW    > 0 ? (_wFin    / _wFinW).toFixed(2)           : null;
  // BUGFIX-Q1（0725 學制數卡片穿透式審查）：
  // filterProg !== 'all' 時，filtered 陣列裡的每一列（含透過 getBaseProgram
  // 併入的跨屆重修班列）依篩選邏輯本就同屬使用者選定的單一學制，
  // 不應該用列上原始的 c.program（可能是 'retake_class'）去重計數，
  // 否則會把「同一學制底下的重修班」誤算成第二個學制。
  // 只有 filterProg === 'all' 時才需要對照全部列的真實 program 分佈。
  // BUG-FIX（護理系統計污染修正，0805第三次）：'non_nursing' 排除，
  // 否則「全部」檢視下健四二F會被當成第5個「學制」納入計數卡片。
  const programs = filterProg === 'all'
    ? [...new Set(filtered.map(c => c.program))].filter(p => p !== 'non_nursing')
    : (filtered.length > 0 ? [filterProg] : []);

  document.getElementById('dStats').innerHTML = `
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${totalStudents.toLocaleString()}</div>
      <div class="lbl">${inclRetakerD ? '選課人次 Enrollments' : '首修人次 First-Time'}</div>
    </div>
    <div class="stat-card" data-ac="var(--accent2)">
      <div class="val">${avgScore ?? '–'}</div>
      <div class="lbl">學期均分 Avg Score</div>
    </div>
    <div class="stat-card" data-ac="${avgPass != null && avgPass >= PASS_COLOR_HIGH ? 'var(--green)' : avgPass != null && avgPass >= PASS_COLOR_MID ? 'var(--accent3)' : 'var(--red)'}">
      <div class="val">${avgPass != null ? (avgPass * 100).toFixed(1) + '%' : '–'}</div>
      <div class="lbl">及格率 Pass Rate</div>
    </div>
    <div class="stat-card" data-ac="var(--accent4)">
      <div class="val">${avgRetake != null ? (avgRetake * 100).toFixed(1) + '%' : '–'}</div>
      <div class="lbl">重修生佔比 Retaker Ratio</div>
    </div>
    <div class="stat-card" data-ac="var(--red)" title="不及格人數佔比，不及格者下學期須至他班重修">
      <div class="val">${avgFail != null ? (avgFail * 100).toFixed(1) + '%' : '–'}</div>
      <div class="lbl">不及格率 Fail Rate <span style="font-size:9px;opacity:.7">（≈重修率）</span></div>
    </div>
    <div class="stat-card" data-ac="var(--accent3)">
      <div class="val">${avgMidterm ?? '–'}</div>
      <div class="lbl">期中均分 Midterm Avg</div>
    </div>
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${avgFinal ?? '–'}</div>
      <div class="lbl">期末均分 Final Avg</div>
    </div>
    <div class="stat-card" data-ac="var(--accent4)">
      <div class="val">${sems.length}</div>
      <div class="lbl">學期數 Semesters</div>
    </div>
    <div class="stat-card" data-ac="var(--accent)">
      <div class="val">${programs.length}</div>
      <div class="lbl">學制數 Programs</div>
    </div>
  `;
  _applyAccentColors(document.getElementById('dStats'));

  document.getElementById('dChartTitle').textContent =
    (filterProg === 'all' ? '全部學制' : PROGRAM_LABELS[filterProg]) +
    ' ' + (dType === 'practicum' ? '實驗課' : '正課') +
    ' — ' + metricLabel(dMetric) + ' 跨學期趨勢';

  // 若排除重修生，將各 class_summary row 的 _nr 欄位覆蓋到主欄位
  // 讓折線圖/熱圖等所有圖表自動讀到正確版本，無須各圖表個別處理
  function applyNrOverride(rows) {
    if (inclRetakerD) return rows;
    return rows.map(c => {
      if (c.count_nr == null) return c;
      return {
        ...c,
        count:              c.count_nr,
        avg_semester:       c.avg_semester_nr       ?? null,
        pass_rate:          c.pass_rate_nr          ?? null,
        fail_rate:          c.fail_rate_nr          ?? null,
        avg_midterm:        c.avg_midterm_nr        ?? null,
        avg_final:          c.avg_final_nr          ?? null,
        score_distribution: c.score_distribution_nr ?? c.score_distribution,
        retaker_ratio:      null,
      };
    });
  }

  const chartFiltered = applyNrOverride(filtered);
  const chartAll      = applyNrOverride(allClasses);

  if (dView === 'merge') {
    renderDTrendMerge(chartFiltered, sems, chartAll);
  } else {
    renderDTrendClass(chartFiltered, sems, chartAll);
  }

  if (dSemMode === 'multi') {
    renderDProgramBar(chartAll, sems, filterProg);
    renderDPassRateBar(chartAll, sems, filterProg);
  } else {
    renderDPassRateLine(chartAll, sems, filterProg);
  }

  const tableCard = document.getElementById('dClassTable');
  if (dView === 'class') {
    tableCard.style.setProperty('display', 'block');
    renderDTable(chartFiltered);
  } else {
    tableCard.style.setProperty('display', 'none');
  }

  renderHeatmap(chartFiltered);
  renderBoxPlot(chartAll, filterProg);
  renderCorrelation(chartFiltered);

  updateFilterSummary('D');
}

function renderDTrendMerge(filtered, sems, allClasses) {
  const filterProg = normalizeProgramFilter(
    document.getElementById('dFilterProgram').value
  );

  let datasets;
  if (filterProg === 'all') {
    // BUG-FIX（護理系統計污染修正，0805第三次）：allClasses 含
    // program==='non_nursing'（健四二F），排除，否則跨學制趨勢比較圖
    // 會多出一條「非護理系」線，且該線僅4-10人/學期，波動極大易誤讀。
    const programs = sortPrograms(
      [...new Set(allClasses.map(c => c.program))].filter(p => PROGRAM_ORDER.includes(p))
    );
    datasets = programs.map(prog => {
      const data = sems.map(sem => {
        const cls = allClasses.filter(c => c.semester === sem && c.program === prog);
        if (!cls.length) return null;
        const field = metricField(dMetric);
        const w = weightedAvg(cls, c => c[field]);
        return w != null ? +w.toFixed(2) : null;
      });
      return {
        label: PROGRAM_LABELS[prog],
        data,
        borderColor: PROGRAM_COLORS[prog],
        backgroundColor: PROGRAM_COLORS[prog] + '20',
        tension: 0.3,
        fill: false,
        pointRadius: 5,
        pointHoverRadius: 7,
        spanGaps: true,
      };
    });
  } else {
    const data = sems.map(sem => {
      const cls = filtered.filter(c => c.semester === sem);
      if (!cls.length) return null;
      const field = metricField(dMetric);
      const w = weightedAvg(cls, c => c[field]);
      return w != null ? +w.toFixed(2) : null;
    });
    datasets = [{
      label: PROGRAM_LABELS[filterProg] + ' 均線',
      data,
      borderColor: PROGRAM_COLORS[filterProg] || '#4f8ef7',
      backgroundColor: (PROGRAM_COLORS[filterProg] || '#4f8ef7') + '20',
      tension: 0.3,
      fill: false,
      pointRadius: 5,
      pointHoverRadius: 7,
      spanGaps: true,
    }];
  }

  mkChart('chartCohortTrend', {
    type: 'line',
    data: { labels: sems.map(semLabel), datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.dataset.label}：${ctx.raw ?? '無資料'}`
          }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: metricLabel(dMetric), color: 'var(--text-dim)' } }
      }
    }
  });
}

function renderDTrendClass(filtered, sems, allClasses) {
  const classes = sortSheetNames([...new Set(filtered.map(c => c.sheet_name))]);
  const MAX_LINES = 18;

  if (classes.length > MAX_LINES) {
    document.getElementById('dModeHint').innerHTML =
      `⚠️ 各班獨立模式：班級數（${classes.length}）超過上限（${MAX_LINES}），` +
      `已自動切換為 <strong class="text-accent">合併總平均</strong>。請縮小學期範圍或指定學制。`;
    renderDTrendMerge(filtered, sems, allClasses);
    return;
  }

  const datasets = classes.map(cls => {
    const prog = filtered.find(c => c.sheet_name === cls)?.program || '2yr_gen';
    const data = sems.map(sem => {
      const rec = filtered.find(c => c.semester === sem && c.sheet_name === cls);
      return rec ? (rec[metricField(dMetric)] ?? null) : null;
    });
    return {
      label: cls,
      data,
      borderColor: PROGRAM_COLORS[prog],
      backgroundColor: PROGRAM_COLORS[prog] + '15',
      tension: 0.3,
      fill: false,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 1.5,
      spanGaps: true,
    };
  });

  mkChart('chartCohortTrend', {
    type: 'line',
    data: { labels: sems.map(semLabel), datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        legend: { labels: { color: 'var(--text-dim)', font: { size: 9 }, boxWidth: 12 } }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: metricLabel(dMetric), color: 'var(--text-dim)' } }
      }
    }
  });
}

function renderDProgramBar(allClasses, sems, filterProg) {
  const programs = PROGRAM_ORDER;
  const datasets = programs.map(prog => {
    const data = sems.map(sem => {
      const cls = allClasses.filter(c => c.semester === sem && c.program === prog);
      if (!cls.length) return null;
      const field = metricField(dMetric);
      const w = weightedAvg(cls, c => c[field]);
      return w != null ? +w.toFixed(1) : null;
    });

    const isHighlighted = filterProg === 'all' || prog === filterProg;
    const alpha = isHighlighted ? 'bb' : '33';
    const borderW = isHighlighted ? (filterProg !== 'all' && prog === filterProg ? 2 : 1) : 1;

    return {
      label: PROGRAM_LABELS[prog],
      data,
      backgroundColor: PROGRAM_COLORS[prog] + alpha,
      borderColor: PROGRAM_COLORS[prog] + (isHighlighted ? '' : '66'),
      borderWidth: borderW,
      borderRadius: 3,
    };
  });

  const subtitle = `各學期學制比較｜指標：${metricLabel(dMetric)}` +
    (filterProg !== 'all' ? `｜高亮：${PROGRAM_LABELS[filterProg]}` : '');

  mkChart('chartProgramBar', {
    type: 'bar',
    data: { labels: sems.map(semLabel), datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        legend: { labels: { color: 'var(--text-dim)', font: { size: 9 }, boxWidth: 10 } },
        subtitle: { display: true, text: subtitle, color: 'var(--text-dim)', font: { size: 10 }, padding: { bottom: 4 } }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100 }
      }
    }
  });
}

// UI-OPT-0811：抽出 renderDPassRateLine／renderDPassRateBar 共用的「各學制
// 逐學期加權及格率」計算邏輯（原本兩函式內容逐字重複），單一真實來源，
// 未來若加權公式調整只需修改一處。兩函式仍各自保留自己的 programs 篩選
// 規則（趨勢折線納入 PROGRAM_ORDER 全部；長條比較僅納入實際有資料的學制），
// 因為這是兩者唯一有意義的差異、並非重複程式碼。
function _programPassRateSeries(allClasses, sems, prog) {
  return sems.map(sem => {
    const cls = allClasses.filter(c => c.semester === sem && c.program === prog);
    if (!cls.length) return null;
    const w = weightedAvg(cls, c => c.pass_rate);
    return w != null ? +(w * 100).toFixed(1) : null;
  });
}

function renderDPassRateLine(allClasses, sems, filterProg) {
  const programs = filterProg === 'all'
    ? PROGRAM_ORDER
    : PROGRAM_ORDER.filter(p => p === filterProg);
  const datasets = programs.map(prog => ({
    label: PROGRAM_LABELS[prog],
    data: _programPassRateSeries(allClasses, sems, prog),
    borderColor: PROGRAM_COLORS[prog],
    backgroundColor: PROGRAM_COLORS[prog] + '20',
    tension: 0.3, fill: false, pointRadius: 4, spanGaps: true,
  }));

  mkChart('chartPassRateRange', {
    type: 'line',
    data: { labels: sems.map(semLabel), datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        legend: { labels: { color: 'var(--text-dim)', font: { size: 9 }, boxWidth: 10 } },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.raw ?? '–'}%` }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: '及格率 %', color: 'var(--text-dim)' } }
      }
    }
  });
}

function renderDPassRateBar(allClasses, sems, filterProg) {
  const programs = filterProg === 'all'
    ? PROGRAM_ORDER.filter(p => allClasses.some(c => c.program === p))
    : PROGRAM_ORDER.filter(p => p === filterProg);

  const datasets = programs.map(prog => ({
    label: PROGRAM_LABELS[prog],
    data: _programPassRateSeries(allClasses, sems, prog),
    backgroundColor: PROGRAM_COLORS[prog] + 'bb',
    borderColor: PROGRAM_COLORS[prog],
    borderWidth: 1, borderRadius: 3,
  }));

  mkChart('chartPassRate', {
    type: 'bar',
    data: { labels: sems.map(semLabel), datasets },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        annotation: { annotations: getEnvAnnotations(sems) },
        legend: { labels: { color: 'var(--text-dim)', font: { size: 9 }, boxWidth: 10 } },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => `${ctx.dataset.label}：${ctx.raw ?? '–'}%` }
        },
        subtitle: {
          display: true,
          text: `${sems.length} 個學期並排及格率比較`,
          color: 'var(--text-dim)', font: { size: 10 }, padding: { bottom: 4 }
        }
      },
      scales: {
        x: { ...CHART_DEFAULTS.scales.x },
        y: { ...CHART_DEFAULTS.scales.y, min: 0, max: 100,
          title: { display: true, text: '及格率 %', color: 'var(--text-dim)' } }
      }
    }
  });
}

function renderDTable(filtered) {
  const tbody = document.getElementById('dDetailBody');
  if (!tbody) return;
  const rows = [...filtered].sort((a, b) =>
    a.semester.localeCompare(b.semester) || compareSheetNames(a.sheet_name, b.sheet_name)
  );
  tbody.innerHTML = rows.map((c, i) => `
    <tr data-row-bg="${i%2?'surface2':'surface'}" class="ladash-tr-alt">
      <td class="ladash-td-std">${escapeHtml(semLabel(c.semester))}</td>
      <td class="ladash-td-std ladash-fw6">${escapeHtml(c.sheet_name)}</td>
      <td class="ladash-td-std">
        <span class="program-badge prog-${escapeHtml(c.program.replace(/_/g,'-'))}">${escapeHtml(PROGRAM_LABELS[c.program] ?? c.program)}</span>
      </td>
      <td class="ladash-td-std ladash-td-r">${c.count}</td>
      <td class="ladash-td-std ladash-td-r ladash-mono">${c.avg_midterm ?? '–'}</td>
      <td class="ladash-td-std ladash-td-r ladash-mono">${c.avg_final ?? '–'}</td>
      <td class="ladash-td-std ladash-td-r ladash-mono">${c.avg_semester ?? '–'}</td>
      <td class="ladash-td-std ladash-td-r" data-td-clr="${c.pass_rate>=0.8?'var(--green)':c.pass_rate>=0.6?'var(--accent3)':'var(--red)'}">${c.pass_rate!=null?(c.pass_rate*100).toFixed(1)+'%':'–'}</td>
    </tr>
  `).join('');
  // BUG-1 FIX (V13): querySelectorAll calls were outside the function due to misplaced closing brace
  tbody.querySelectorAll('[data-row-bg]').forEach(function(tr) {
    tr.style.setProperty('background', tr.dataset.rowBg === 'surface2' ? 'var(--surface2)' : 'var(--surface)');
  });
  tbody.querySelectorAll('[data-td-clr]').forEach(function(td) {
    if (td.dataset.tdClr) td.style.setProperty('color', td.dataset.tdClr);
  });
}

// ══════════════════════════════════════════════════════════
// PWA：Service Worker 註冊 & 更新提示
// ══════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      });
      reg.update().catch(() => {});

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });

      if (reg.waiting) {
        showUpdateBanner(reg.waiting);
      }

    } catch (err) {
      console.warn('[SW] 註冊失敗：', err);
    }
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  // [FIX] iOS standalone PWA 從背景恢復時不會重新觸發 'load' 事件，
  // reg.update() 若只在 load 執行一次，之後恢復 app 永遠不會再檢查新版 SW，
  // 造成「已部署新版但打開 App 仍是舊版」。改為 visibility 恢復 / bfcache 還原時
  // 也主動觸發一次 update() 檢查。
  const _recheckUpdate = () => {
    navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.update().catch(() => {}))
      .catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _recheckUpdate();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) _recheckUpdate();
  });
}

function showUpdateBanner(worker) {
  const existing = document.querySelector('.sw-update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.className = 'sw-update-banner';

  const msg = document.createElement('span');
  msg.textContent = '🔄 有新版本可用';

  const btn = document.createElement('button');
  btn.textContent = '立即更新';
  btn.addEventListener('click', () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
    banner.remove();
  });

  const close = document.createElement('button');
  close.textContent = '×';
  close.className = 'ladash-banner-close';
  close.addEventListener('click', () => banner.remove());

  banner.append(msg, btn, close);
  document.body.appendChild(banner);
}

// ══════════════════════════════════════════════════════════
// PWA：iOS 安裝引導 Banner
// ══════════════════════════════════════════════════════════
function showIOSInstallBanner() {
  const lastShown = localStorage.getItem('pwa-banner-shown');
  if (lastShown && Date.now() - parseInt(lastShown, 10) < 7 * 24 * 60 * 60 * 1000) return;

  const isInstalled = window.navigator.standalone === true;
  if (isInstalled) return;

  const banner = document.createElement('div');
  banner.className = 'pwa-install-banner';

  const icon = document.createElement('img');
  icon.src = './icons/icon-180.png';
  icon.alt = 'LA DASH';

  const textWrap = document.createElement('div');
  textWrap.className = 'banner-text';

  const title = document.createElement('strong');
  title.textContent = '安裝到主畫面';

  const desc = document.createElement('span');
  desc.textContent = '點擊底部「分享」按鈕，選擇「加入主畫面」';

  textWrap.append(title, desc);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'banner-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', '關閉安裝提示');
  closeBtn.addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwa-banner-shown', Date.now());
  });

  banner.append(icon, textWrap, closeBtn);
  document.body.appendChild(banner);

  setTimeout(() => {
    if (banner.parentNode) {
      banner.style.setProperty('transition', 'opacity 0.5s'); // CSP-V7-FIX
      banner.style.setProperty('opacity',    '0');            // CSP-V7-FIX
      setTimeout(() => banner.remove(), 500);
    }
  }, 8000);
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);
const isStandalone = window.navigator.standalone === true;

if (isIOS && isSafari && !isStandalone) {
  setTimeout(showIOSInstallBanner, 3000);
}

// ══════════════════════════════════════════════════════════
// PRINT DATA HELPERS — consumed by print-panel.js via window.*
// (UI/rendering for the print panel itself lives entirely in
// print-panel.js; these are the only pieces it still borrows
// from main.js, since they need direct access to DATA/render*.)
// ══════════════════════════════════════════════════════════
function printYears() {
  if (!DATA?.meta?.semesters?.length) return [];
  return [...new Set(DATA.meta.semesters.map(s => String(s).slice(0, 3)))].sort((a,b) => b-a);
}

function getPrintYearRange() {
  const years = printYears();
  const start = document.getElementById('printYearStart')?.value || years[0] || '';
  const end = document.getElementById('printYearEnd')?.value || years[years.length - 1] || '';
  return { start, end };
}

function getPrintSemesters() {
  const { start, end } = getPrintYearRange();
  return sortSemestersDesc((DATA?.meta?.semesters || []).filter(s => {
    const year = String(s).slice(0, 3);
    return (!start || year >= start) && (!end || year <= end);
  }));
}

// 以下三個函數由外部 PrintPanel 模組呼叫，非 main.js 內部使用
function withPrintablePanelsVisible(task) {
  const panels = [...document.querySelectorAll('.panel')].filter(p => p.id !== 'panelP' && p.id !== 'panelR');
  const originals = panels.map(p => ({
    el: p,
    display: p.style.display,
    visibility: p.style.visibility,
    position: p.style.position,
    left: p.style.left,
    top: p.style.top,
    width: p.style.width,
    pointerEvents: p.style.pointerEvents,
  }));
  panels.forEach(p => {
    p.style.setProperty('display',        'block');
    p.style.setProperty('visibility',     'hidden');
    p.style.setProperty('position',       'absolute');
    p.style.setProperty('left',           '-10000px');
    p.style.setProperty('top',            '0');
    p.style.setProperty('width',          '1200px');
    p.style.setProperty('pointer-events', 'none');
  });
  // BUG-BI-2 CSP FIX: 子面板改用 is-hidden class 控制顯示/隱藏，
  // 避免 inline style 在 restore 時被寫回 display:none，
  // 導致 switchSub() 的 class-based 切換失效。
  const subPanes = [...document.querySelectorAll('.behavior-sub-pane')];
  const subPaneOriginals = subPanes.map(p => ({ el: p, wasHidden: p.classList.contains('is-hidden') }));
  subPanes.forEach(p => { p.classList.remove('is-hidden'); p.style.removeProperty('display'); });
  try {
    return task();
  } finally {
    originals.forEach(({ el, display, visibility, position, left, top, width, pointerEvents }) => {
      el.style.setProperty('display',        display        ?? '');
      el.style.setProperty('visibility',     visibility     ?? '');
      el.style.setProperty('position',       position       ?? '');
      el.style.setProperty('left',           left           ?? '');
      el.style.setProperty('top',            top            ?? '');
      el.style.setProperty('width',          width          ?? '');
      el.style.setProperty('pointer-events', pointerEvents  ?? '');
    });
    subPaneOriginals.forEach(({ el, wasHidden }) => { el.classList.toggle('is-hidden', wasHidden); });
  }
}

function clonePrintDataForSemesters(sems) {
  const semSet = new Set(sems);
  const classSummary = Object.fromEntries(
    Object.entries(DATA.class_summary || {}).filter(([, c]) => semSet.has(c.semester))
  );
  const students = Object.fromEntries(
    Object.entries(DATA.students || {}).map(([sid, student]) => [
      sid,
      { ...student, records: (student.records || []).filter(r => semSet.has(r.semester)) }
    ]).filter(([, student]) => student.records.length)
  );
  return {
    ...DATA,
    meta: { ...DATA.meta, semesters: sems },
    class_summary: classSummary,
    students,
  };
}

function withPrintDataRange(task) {
  if (!DATA) return task();
  const sems = getPrintSemesters();
  if (!sems.length) return task();
  const originalData = DATA;
  const controls = ['aFilterSem', 'aFilterProgram', 'aFilterSheet', 'aTrendSheet', 'aCompareSem'].map(id => {
    const el = document.getElementById(id);
    return { el, value: el?.value };
  });
  DATA = clonePrintDataForSemesters(sems);
  const aSem = document.getElementById('aFilterSem');
  if (aSem && !sems.includes(aSem.value)) aSem.value = sems[0];
  try {
    return task();
  } finally {
    DATA = originalData;
    controls.forEach(({ el, value }) => {
      if (el && value != null) el.value = value;
    });
  }
}

function renderPrintCharts() {
  if (!DATA) return;
  renderD();
  renderA();
  // renderB 已包含 renderSlope/renderDelta/renderQuadrant/renderDeltaByProgram/renderRetakeCount/renderFirstVsDelta
  renderB();
  // renderCAnomalyAndDist 繪製 chartAnomalyDensity + cChartDist
  renderCAnomalyAndDist();
  renderRetakerFirstDist();
  // 強制所有已登記圖表 resize，確保 hidden panel 內的 canvas 有正確尺寸
  Object.values(charts).forEach(chart => {
    try { chart.resize(); chart.update('none'); } catch(e) {}
  });
  // 補足由外部模組（behavior tabs / ChartRegistry）管理、未在 charts{} map 中的圖表
  // 優先使用 ChartRegistry.list() 涵蓋所有已登記實例
  const registryIds = (typeof ChartRegistry !== 'undefined') ? ChartRegistry.list() : [];
  const behaviorIds = ['radarChart', 'weeklyQuizChart', 'preExamChart', 'timeSlotChart', 'scatterChart', 'hourlyLineChart'];
  const externalIds = [...new Set([...registryIds, ...behaviorIds])].filter(id => !charts[id]);
  externalIds.forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const instance = typeof Chart !== 'undefined' && Chart.getChart(canvas);
    if (instance) { try { instance.resize(); instance.update('none'); } catch(e) {} }
  });
}

// ══════════════════════════════════════════════════════════
// 篩選條件記憶（僅限安全子集合，見 UIUX 規劃書附錄 D）
// ══════════════════════════════════════════════════════════
const FilterMemory = (() => {
  const PREFIX = 'la-filter-';
  function save(key, value) {
    try { localStorage.setItem(PREFIX + key, value); } catch (e) {}
  }
  function load(key) {
    try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; }
  }
  return { save, load };
})();

// 明確排除清單（絕不透過 FilterMemory 存取，僅供程式碼審閱對照，
// 不影響邏輯——這兩個欄位的 change/input 監聽本就不會呼叫 FilterMemory.save）：
//   aFilterSheet, aTrendSheet, cSearch, cSearchRetake

// Panel A／Panel D 還原（於 init() 內、renderD() 之前呼叫）
// 效能備註（穿透式審查四）：以下所有還原呼叫皆傳入 skipRender=true。此函式在每次
// 網頁載入時都會執行（loadData()→restoreFilterMemory()→renderD()），若使用者曾存過
// 篩選記憶，過去每個還原的 setter 都會各自無條件渲染一次，最多可達 6 次
// （aRestored 分支 1 次 + setDSemMode/setDType/setDView/setDMetric 最多 4 次 +
// dType==='practicum' 修正分支 1 次），但這些中間渲染全部會被本函式呼叫結束後
// 緊接的 renderD()（loadData 內）或使用者之後切到 Panel A 時 switchTab('A') 保證的
// renderA() 蓋掉，100% 是丟棄不用的運算。此處只還原狀態變數與下拉選單/按鈕視覺
// 樣式，最終畫面內容不變。
// SEC-FIX-2 (/security-review)：FilterMemory.load() 讀回 localStorage 的值，
// 須先通過 allowlist 才能傳入 setter 函式。localStorage 屬用戶可控空間，
// 攻擊者（或惡意瀏覽器擴充功能）可在不觸發 CSP 的前提下寫入任意值；
// 雖然現有 setter 不直接插入 innerHTML，但非預期字串仍可污染模組狀態變數
// （bMode/dView/cCurrentExam 等），造成篩選邏輯靜默失效或顯示異常。
const FILTER_MEMORY_ALLOWLIST = {
  setBMode:    new Set(['sheet', 'student']),
  setBType:    new Set(['theory', 'practicum']),
  setCType:    new Set(['all', 'theory', 'practicum']),
  setCPass:    new Set(['all', 'pass', 'fail']),
  setCExam:    new Set(['semester_score', 'midterm', 'final']),
  setDSemMode: new Set(['range', 'multi']),
  setDType:    new Set(['all', 'theory', 'practicum']),
  setDView:    new Set(['merge', 'class']),
  setDMetric:  new Set(['semester_score', 'midterm', 'final']),
};

function restoreFilterMemory() {
  let aRestored = false, dRestored = false;
  const restore = (id, applyFn) => {
    const v = FilterMemory.load(id);
    // SEC-FIX-2：allowlist 過濾——僅允許已知合法值通過，其餘靜默忽略。
    // el.value 賦值（aFilterSem/aFilterProgram/cFilterSem 等下拉選單）由
    // <select> 元素本身自動丟棄無效 option 值，不在此處額外過濾。
    if (v !== null) {
      if (FILTER_MEMORY_ALLOWLIST[id] && !FILTER_MEMORY_ALLOWLIST[id].has(v)) return false;
      applyFn(v); return true;
    }
    return false;
  };

  if (restore('aFilterSem',     v => { const el = document.getElementById('aFilterSem');     if (el) el.value = v; })) aRestored = true;
  if (restore('aFilterProgram', v => { const el = document.getElementById('aFilterProgram'); if (el) el.value = v; })) aRestored = true;
  if (restore('aFilterType',    v => { const el = document.getElementById('aFilterType');    if (el) el.value = v; })) aRestored = true;
  // 僅在確實有還原到值時，才比照使用者手動切換學期的既有邏輯重新驗證
  // 學制/課別互斥鎖定（避免還原出「不可能存在」的組合）；首次使用（無記錄）
  // 完全不觸發此段，行為與異動前逐字相同。
  if (aRestored) onAFilterChange('semester', true);

  if (restore('dFilterProgram', v => { const el = document.getElementById('dFilterProgram'); if (el) el.value = v; })) dRestored = true;
  if (restore('setDSemMode', v => setDSemMode(v, true))) dRestored = true;
  if (restore('setDType',    v => setDType(v, true)))   dRestored = true;
  if (restore('setDView',    v => setDView(v, true)))   dRestored = true;
  if (restore('setDMetric',  v => setDMetric(v, true))) dRestored = true;
  if (dRestored) {
    // 實驗課無期中／期末成績，還原組合若衝突則回退為學期成績（比照 setDType 既有互斥邏輯）
    if (dType === 'practicum' && dMetric !== 'semester_score') setDMetric('semester_score', true);
    _syncRetakerBtn('D');
  }
}

// Panel C（含重補修生子區塊）還原（於 initCPanel() 首次進入、_resetCGeneralFilters() 之後呼叫）
// 效能備註（穿透式審查四）：以下所有 restore() 呼叫皆傳入 skipRender=true——還原當下
// initCPanel() 尚未執行到自己結尾的 renderCView()，此處任何中間渲染都會被該最終呼叫
// 覆蓋（若還原到 retake 相關值，甚至是渲染進當下必為隱藏狀態的 #cPanelRetake），
// 100% 是丟棄不用的運算。只還原狀態變數與按鈕/下拉選單的視覺樣式，渲染统一交給
// initCPanel() 結尾那一次 renderCView() 負責，最終畫面內容不變。
function _restoreCFilterMemory() {
  let cRestored = false;
  const restore = (id, applyFn) => {
    const v = FilterMemory.load(id);
    if (v !== null) { applyFn(v); return true; }
    return false;
  };

  if (restore('cFilterSem',     v => { const el = document.getElementById('cFilterSem');     if (el) el.value = v; })) cRestored = true;
  if (restore('cFilterProgram', v => { const el = document.getElementById('cFilterProgram'); if (el) el.value = v; })) cRestored = true;
  // 僅在確實有還原到值時，才比照使用者手動切換學期的既有邏輯重新驗證
  // （含學制/課別鎖定提示、重修生開關同步），首次使用（無記錄）行為不變。
  if (cRestored) onCGeneralFilterChange('semester', true);

  restore('setBMode', v => setBMode(v, true));
  restore('setBType', v => setBType(v, true));
  restore('setCType', v => setCType(v, true));
  restore('setCPass', v => setCPass(v, true));
  restore('setCExam', v => setCExam(v, true));
}

// ══════════════════════════════════════════════════════════
// data-action 事件委派系統
// 取代靜態 HTML 中所有 onclick 屬性
// ══════════════════════════════════════════════════════════
function initDataActionDelegation() {
  // Actions that toggle a popover/panel open and must stop propagation,
  // otherwise the same click immediately bubbles to the global "close" listener.
  const STOP_PROPAGATION_ACTIONS = new Set([
    'toggleBStatsHelp', 'toggleRRadarInfo', 'toggleWarningHelp', 'toggleRTemporalInfo',
    'closePopover', 'closePanelOpen', 'hidePanel',
  ]);
  const PERSISTABLE_ACTIONS = new Set([
    'setDSemMode','setDType','setDView','setDMetric',
    'setCType','setCExam','setCPass','setBMode','setBType',
  ]);

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');

    // Always close open search results on any outside click (consolidated here)
    if (!e.target.closest('.search-wrap')) {
      document.getElementById('searchResults')?.classList.remove('open');
    }

    if (!el) return;

    const action = el.dataset.action;
    const arg    = el.dataset.arg ?? null;

    // Only stop propagation for toggle/close actions to prevent the global
    // chart-popover close listener from immediately undoing the open state.
    if (STOP_PROPAGATION_ACTIONS.has(action)) e.stopPropagation();

    const actionMap = {
      // Header
      toggleMetaInfo:       () => toggleMetaInfo(),
      toggleTheme:          () => toggleTheme(),
      // Tabs
      switchTab:            () => switchTab(arg),
      // Filter collapse
      toggleFilterCollapse: () => toggleFilterCollapse(arg),
      // Retaker switch
      toggleRetakerSwitch:  () => toggleRetakerSwitch(arg),
      // Panel A
      resetAFilters:        () => resetAFilters(),
      undoAFilterReset:     () => undoAFilterReset(),
      // Panel C
      resetCFilters:        () => resetCFilters(),
      switchCView:          () => switchCView(arg),
      setCType:             () => setCType(arg),
      setCExam:             () => setCExam(arg),
      setCPass:             () => setCPass(arg),
      // Panel B
      setBMode:             () => setBMode(arg),
      setBType:             () => setBType(arg),
      // Panel D
      resetDFilters:        () => resetDFilters(),
      setDSemMode:          () => setDSemMode(arg),
      setDType:             () => setDType(arg),
      setDView:             () => setDView(arg),
      setDMetric:           () => setDMetric(arg),
      toggleDSemCapsule:    () => toggleDSemCapsule(el),
      // Behavior
      resetBehaviorFilters: () => resetBehaviorFilters(),
      behaviorSwitchSub:    () => {
        if (typeof BehaviorTabManager !== 'undefined')
          BehaviorTabManager.switchSub(el.dataset.sub);
      },
      // bStats help — function exposed on window by help-modal.js (defer)
      toggleBStatsHelp: () => {
        if (typeof window.toggleBStatsHelp === 'function') window.toggleBStatsHelp(e);
      },
      // Radar info — same
      toggleRRadarInfo: () => {
        if (typeof window.toggleRRadarInfo === 'function') window.toggleRRadarInfo(e);
      },
      // Warning help — exposed by help-modal.js
      toggleWarningHelp: () => {
        if (typeof window.toggleWarningHelp === 'function') window.toggleWarningHelp(e);
      },
      // Temporal chart info（UI-HELP-GAP-0811：新增，比照上方三個 toggle*Help/Info）
      toggleRTemporalInfo: () => {
        if (typeof window.toggleRTemporalInfo === 'function') window.toggleRTemporalInfo(e);
      },
      // At-risk report
      atRiskFilterRadar: () => {
        if (typeof AtRiskReportManager !== 'undefined')
          AtRiskReportManager.filterRadar(null);
      },
      atRiskFilterRadarCard: () => {
        if (typeof AtRiskReportManager !== 'undefined')
          AtRiskReportManager.filterRadar(el.dataset.filter);
      },
      atRiskSwitchSemester: () => {
        if (typeof AtRiskReportManager !== 'undefined')
          AtRiskReportManager.switchSemester(el.dataset.sem);
      },
      exportAtRiskPDF: () => {
        if (typeof window.exportAtRiskPDF === 'function') window.exportAtRiskPDF();
      },
      // Print
      doPrintPreview:   () => { if (window.PrintPanel) window.PrintPanel.doPreview(); },
      doPrint:          () => { if (window.PrintPanel) window.PrintPanel.doPrint(); },
      // 以下三個由外部 PrintPanel 模組攔截處理；加 noop 避免 console.warn
      closePrintPreview: () => {},
      printSelectAll:    () => {},
      printClearAll:     () => {},
      // Panel C retake search result selection
      selectRetakeStudent: () => selectRetakeStudent(el.dataset.sid),
      // Panel C 個案卡：學習行為分型查詢（31號規格書 §5.1，方案A）
      toggleBehaviorClassPanel: () => toggleBehaviorClassPanel(el.dataset.anon, el.dataset.sem, el),
      // Panel / popover close
      hidePanel: () => {
        const panel = document.getElementById(el.dataset.target);
        if (panel) panel.style.setProperty('display', 'none');
      },
      closePanelOpen: () => {
        document.getElementById(el.dataset.target)?.classList.remove('open');
      },
      closePopover: () => el.closest('.chart-popover')?.classList.remove('open'),
    };

    if (actionMap[action]) {
      actionMap[action]();
      if (PERSISTABLE_ACTIONS.has(action) && arg != null) {
        FilterMemory.save(action, arg);
      }
    } else {
      console.warn('[data-action] unknown action:', action);
    }
  });
}

// ══════════════════════════════════════════════════════════
// 靜態元素事件綁定（DOMContentLoaded 後由 loadData() 呼叫）
// ══════════════════════════════════════════════════════════
function bindStaticHandlers() {
  const byId = id => document.getElementById(id);

  // onchange
  byId('aFilterSem')      ?.addEventListener('change', () => {
    FilterMemory.save('aFilterSem', byId('aFilterSem').value);
    onAFilterChange('semester');
  });
  byId('aFilterProgram')  ?.addEventListener('change', () => {
    FilterMemory.save('aFilterProgram', byId('aFilterProgram').value);
    onAFilterChange('program');
  });
  byId('aFilterType')     ?.addEventListener('change', () => {
    FilterMemory.save('aFilterType', byId('aFilterType').value);
    onAFilterChange('courseType');
  });
  byId('aFilterSheet')    ?.addEventListener('change', () => onAFilterChange('class'));
  byId('aTrendSheet')     ?.addEventListener('change', () => renderTrend());
  byId('aCompareSem')     ?.addEventListener('change', () =>
    renderVarianceBar(byId('aFilterSem').value, byId('aFilterSheet').value, byId('aFilterProgram').value));
  byId('cFilterSem')      ?.addEventListener('change', () => {
    FilterMemory.save('cFilterSem', byId('cFilterSem').value);
    onCGeneralFilterChange('semester');
  });
  byId('cFilterProgram')  ?.addEventListener('change', () => {
    FilterMemory.save('cFilterProgram', byId('cFilterProgram').value);
    onCGeneralFilterChange('program');
  });
  byId('dFilterProgram')  ?.addEventListener('change', () => {
    FilterMemory.save('dFilterProgram', byId('dFilterProgram').value);
    _syncRetakerBtn('D'); renderD();
  });

  // oninput
  byId('cSearch')         ?.addEventListener('input', () => searchStudent());
  byId('cSearchRetake')   ?.addEventListener('input', () => onCRetakeSearch());
  byId('dSemStart')       ?.addEventListener('input', e => onDSemRangeChange(e));
  byId('dSemEnd')         ?.addEventListener('input', e => onDSemRangeChange(e));
}

// ── BOOT ──
document.addEventListener('DOMContentLoaded', () => {
  initDataActionDelegation();
  loadData();
});
