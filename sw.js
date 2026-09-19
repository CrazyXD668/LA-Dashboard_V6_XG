// ==========================================================
// sw.js - 學習數據分析儀表板 Service Worker
// 策略：
//   - HTML / 未版本化 JS：Network First，避免舊殼卡住新版
//   - 帶 ?v= 的 JS / vendor / icons：Cache First
//   - data/*.json 與 data/*.json.gz：Network First + 離線資料快取
// 更新：2026-06-17 docs4 新版模組與 warning/cross 資料支援
// 更新：2026-07-11 UI-FIX-1/3/4（課程名稱徽章 fallback、XGBoost 特徵中文譯名補齊、
//        學習行為分頁學期篩選器排序統一由近到遠）
// 更新：2026-07-12 BUG-TIME-QUIZ-5（各週題庫作答強度：修正無 segment 週份誤植跨學期
//        合併資料、全班平均次數改為人數加權）、BUG-CORR-1（相關性矩陣補上
//        excluded_new_material 的 REASON_CONFIG，避免誤報「ETL 無此欄位」）、
//        資源使用 vs. 成績相關性標題移除「【】」
// 更新：2026-07-12（第二輪）移除其餘 3 處標題「【】」裝飾符號
//        （⏱ 時間滯後相關性、跨學期趨勢圖標題、LSA 白話解讀副標）
// 更新：2026-07-12（第三輪）BUG-TIME-QUIZ-6（根因修正：renderWeeklyQuiz() 週次
//        fallback 樣板原本會給 avg_attempts 預設值 0，物件展開時蓋不掉「本來就
//        沒有這個 key」的真實資料，導致 BUG-TIME-QUIZ-5 的加權平均/null 判斷
//        永遠跑不到，全部年度整條「全班平均次數」線貼底。移除該預設值後才真正
//        生效）、BUG-CORR-2（excluded_new_material 與 scale_change 本為同一概念，
//        合併為同一份 REASON_CONFIG，避免圖例出現兩條意思相同的說明）
// 更新：2026-07-12（第四輪）BUG-CORR-3：Δ規模 排除觸發學期後，其餘學期改用
//        scatter_data 即時重算真實 r 值（† 角標標示），取代整格直接放棄；
//        目前等待 ETL 補上 meta.excluded_material_detail 即自動生效，
//        欄位補上前維持現行 Δ規模 診斷符號、不影響現有行為。
// 更新：2026-09-15 UI/UX 全面優化：明暗模式、桌面/PWA 響應式控制、圖表可讀性、
//        鍵盤/觸控焦點、按鈕語意、115(1) 8 小時閱讀門檻逐生清單與 checkpoint 流程。
// ==========================================================

const CACHE_PREFIX = 'la-dash-v11-docs-cachefix';
const DATA_CACHE_PREFIX = 'la-dash-v11-docs-cachefix-data';
// Keep this value identical to index.html's ?v= values and
// js/behavior-loader.js DATA_VERSION.  update-dashboard-after-etl.ps1
// updates all three as one deployment transaction.
const BUILD_VERSION = '202609191410';

const CACHE_VERSION = `${CACHE_PREFIX}-${BUILD_VERSION}`;
const DATA_CACHE = `${DATA_CACHE_PREFIX}-${BUILD_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-120.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/vendor/pwacompat.min.js',
  './js/vendor/chart.umd.min.js',
  './js/vendor/chartjs-plugin-annotation.min.js',
  './js/frame-guard.js',
  './js/filter-engine.js?v=202609191410',
  './js/main.js?v=202609191410',
  './js/vendor/d3.min.js',
  './js/chart-registry.js?v=202609191410',
  './js/help-modal.js?v=202609191410',
  './js/behavior-loader.js?v=202609191410',
  './js/tab-behavior-radar.js?v=202609191410',
  './js/tab-behavior-correlation.js?v=202609191410',
  './js/tab-behavior-time.js?v=202609191410',
  './js/tab-behavior-lsa.js?v=202609191410',
  './js/tab-behavior-cross.js?v=202609191410',
  './js/tab-behavior-warning.js?v=202609191410',
  './js/behavior-init.js?v=202609191410',
  './js/at-risk-report.js?v=202609191410',
  './js/print-panel.js?v=202609191410',
  './js/ui-enhancements.js?v=202609191410',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] App shell cache failed:', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(DATA_CACHE_PREFIX))
          .filter((key) => key !== CACHE_VERSION && key !== DATA_CACHE)
          .map((key) => {
            console.debug('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // SEC-FIX-1 (/security-review)：cross-origin 請求直接放行，讓瀏覽器原生處理。
  // 原本的 cacheFirst(request) 路由存在 deadlock：SW 沒有 CORS 憑證無法快取
  // cross-origin 回應；且 CSP connect-src 'self' 會封鎖 SW 內部的 fetch(request)
  // 呼叫，導致 cache miss → fetch 被 CSP 封鎖 → 永遠回傳 503。
  // 本應用程式實際上無任何 cross-origin fetch，故此修正不影響任何現有功能。
  if (url.origin !== self.location.origin) {
    return; // 不呼叫 event.respondWith()，由瀏覽器原生路由處理
  }

  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(networkFirstData(request));
    return;
  }

  if (url.pathname.endsWith('frame-guard.js')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.includes('/js/vendor/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.endsWith('.js')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

function isDataRequest(url) {
  return /\/data\/.+\.(json|json\.gz)$/i.test(url.pathname);
}

function isStaticAsset(url) {
  return /\.(css|png|svg|ico|webmanifest|manifest|woff2?)$/i.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE_VERSION });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    return new Response('離線中，此資源尚未快取', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkFirstData(request) {
  try {
    const response = await fetch(new Request(request, { cache: 'reload' }));
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DATA_CACHE });
    if (cached) {
      console.debug('[SW] Offline: serving cached data:', request.url);
      return cached;
    }

    return new Response(JSON.stringify({
      error: 'offline',
      message: '目前離線且無快取資料，請連線後重新整理',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(new Request(request, { cache: 'reload' }));
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await safePut(cache, request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: CACHE_VERSION });
    if (cached) return cached;
    return new Response('離線中', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function safePut(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      console.warn('[SW] Cache quota exceeded, pruning...');
      await pruneCache(cache);
      try {
        await cache.put(request, response);
      } catch (err) {
        console.warn('[SW] Cache put failed after pruning:', err);
      }
    } else {
      console.warn('[SW] Cache put failed:', e);
    }
  }
}

async function pruneCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= 40) return;
  await Promise.all(keys.slice(0, keys.length - 40).map((key) => cache.delete(key)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'GET_VERSION' && event.ports?.[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION, build: BUILD_VERSION });
  }
});
