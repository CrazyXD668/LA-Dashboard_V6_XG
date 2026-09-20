# 學習分析儀表板 · Learning Analytics Dashboard V6 XG

<!-- PROJECT SHIELDS -->

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-ready-blue.svg?style=flat-square)](https://web.dev/progressive-web-apps/)
[![CSP](https://img.shields.io/badge/CSP-hardened-brightgreen.svg?style=flat-square)](#安全性架構)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4.0-ff6384.svg?style=flat-square)](https://www.chartjs.org/)
[![D3.js](https://img.shields.io/badge/D3.js-v7.9.0-orange.svg?style=flat-square)](https://d3js.org/)

<!-- PROJECT LOGO -->
<br />

<p align="center">
  <a href="#">
    <img src="icons/icon-192.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">學習分析儀表板 · LA DASH</h3>
  <p align="center">
    以學習行為資料為基礎的互動式分析工具，支援多學期、多學制課程之學習模式視覺化與高風險學生12週預警 (BAS+XGBoost)。
    <br />
    純前端 PWA（HTML + Vanilla JS），可部署至 GitHub Pages，無需後端伺服器。
    <br />
    <br />
    <a href="#"><strong>探索文件 »</strong></a>
    <br />
    <br />
    <a href="#issues">回報 Bug</a>
    ·
    <a href="#issues">提出新功能</a>
  </p>
</p>

---

## 目錄

- [功能概覽](#功能概覽)
- [設計特色](#設計特色)
- [架構總覽](#架構總覽)
- [技術架構](#技術架構)
- [安全性架構](#安全性架構)
- [資料準備](#資料準備)
- [資料範圍與統計排除規則](#資料範圍與統計排除規則)
- [本機執行](#本機執行)
- [部署至 GitHub Pages](#部署至-github-pages)
- [篩選維度](#篩選維度)
- [PWA 安裝](#pwa-安裝)
- [版本控制](#版本控制)
- [授權](#授權)

---

## 功能概覽

### 主面板

| 面板 | ID | 說明 |
|------|----|------|
| 成績總覽 | `panelD` | 跨學期趨勢、各學制成績比較、及格率、熱圖、箱型圖、班級明細表 |
| 單班分析 | `panelA` | 班級成績分布、期中期末、歷年趨勢、常態疊圖、迴歸、變異分析 |
| 學生／重修 | `panelC` | 全體學生分布、異常密度、重修前後斜率圖、象限分析、改善幅度 |
| 行為分析 | `panelL` | 六個子分頁（詳見下表） |
| 高風險報告 | `panelR` | 紅旗警示、處方性建議、PDF 匯出 |
| 列印 | `panelP` | 多圖表選擇列印預覽、另存 PDF |

### 行為分析子分頁（`panelL`）

| 子分頁 | Tab label | 說明 |
|--------|-----------|------|
| 雷達圖 | `L 行為雷達` | 各學制學生學習行為雷達圖比較 |
| 相關性矩陣 | `L 行為關聯` | 學習行為指標間 Pearson 相關熱力圖 + 散點圖 |
| 時序分析 | `L 時間行為` | 週別學習趨勢、考前學習時間、時段分布、24h 熱圖 |
| LSA 序列分析 | `L LSA` | 學習行為序列有向圖（D3.js 力導向）、S-cluster 分組 |
| 跨屆比較 | `L 交叉分析` | 行為群組與成績、行為軌跡、學習策略跨屆比較；另呈現 BAS AUC／XGBoost r 雙模型驗證指標並列比較 |
| 早期預警 | `L 預警` | Option B 14 天後驗證預警系統，BAS（QMI 風險分層）與 XGBoost 雙模型並列（`xgb_probability` / `risk_level_xgb`），顯示 AUC／precision／recall／覆蓋率，逐生明細可匯出 CSV |

### 統一說明系統（Help Modal）

圖表與面板的說明統一由單一元件管理，取代先前分散在多處的獨立實作。桌面版互動由 hover-preview 改為點擊觸發全螢幕說明視窗，提供 ESC／點擊遮罩外部／關閉按鈕三種關閉方式，並支援「白話摘要＋可展開完整說明」雙層顯示，統計公式等技術細節預設收合、按需展開。

---

## 設計特色

- **通過真實使用者驗證**：現行版本已由實際授課教師完成可用性評估；後續 UI/UX 調整方向以訪談與回饋為準，避免單方面臆測使用習慣
- **漸進式揭露**：篩選面板與多張資訊卡預設收合，降低畫面預設資訊密度，依需求展開
- **篩選狀態記憶（隱私優先）**：僅記住檢視偏好（學期、學制、顯示模式等安全子集合），刻意不記住班級／搜尋字串等資料範圍選擇，避免系所共用電腦洩漏前一位使用者的查詢內容
- **無障礙語意基礎**：分頁採正確 `role="tab"`／`aria-*`，篩選滑桿具 `aria-label`
- **行動裝置三段式適配**：600px／700px／900px 中斷點，篩選列於小螢幕自動改為直向堆疊
- **空狀態設計意識**：loading overlay、多種「查無資料」狀態、樣本數不足的分群（如目前 S5）顯示專屬提示文字，而非靜默隱藏或留下空白卡片
- **決策支援導向**：高風險報告同步呈現紅旗名單、處方性建議與 Top Risk Factors；跨屆比較頁另以 BAS AUC／XGBoost r 雙指標並列，方便比較兩套演算法的驗證效度
- **統計範圍純淨度**：前端與後端 ETL 雙層把關，確保特殊班級／合併開班混入之系外學生成績與行為資料不會污染任何跨班級聚合統計或模型訓練資料，詳見〈[資料範圍與統計排除規則](#資料範圍與統計排除規則)〉

---

## 架構總覽

本專案為純前端 PWA（HTML + Vanilla JS），不依賴前端框架。畫面依主面板與行為分析子分頁拆成對應的 JS 模組，第三方函式庫（Chart.js、D3.js 等）皆本地化存放、不經外部 CDN 載入，Service Worker 置於根目錄以確保快取 scope 正確涵蓋全站。

執行所需的資料檔案集中放在 `data/` 目錄，由獨立的後端 ETL 套件產出（見〈[資料準備](#資料準備)〉），內容含學生個資，**不隨本 repo 提供**。

> 為降低內部實作細節被直接掃描利用的風險，此處不列出完整檔案清單與模組間的函式對應；實際開發或除錯請直接查閱原始碼與 `CHANGELOG.md`。

---

## 技術架構

- **前端**：純 HTML + Vanilla JS，無前端框架依賴
- **圖表**：[Chart.js 4.4.0](https://www.chartjs.org/) + chartjs-plugin-annotation 3.0.1（本地化於 `js/vendor/`）
- **有向圖**：[D3.js v7.9.0](https://d3js.org/)（本地化，供 LSA 序列有向圖使用）
- **PWA**：Service Worker（App Shell Cache First + Data Network First）、iOS / Android / 桌機安裝支援
- **資料層**：JSON 資料採延遲載入並搭配 LRU 快取，另備 gzip 壓縮回退版本；多維度篩選邏輯獨立於畫面渲染，不依賴 DOM
- **圖表生命週期**：Chart.js 實例的建立與銷毀集中管理，避免記憶體洩漏
- **離線支援**：斷線時自動回退至最近一次成功快取的資料

---

## 安全性架構

### Content Security Policy（CSP）

**目前 CSP 設定（`index.html` `<meta http-equiv>`，GitHub Pages 靜態部署現況）：**

```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
connect-src 'self';
font-src    'self' data:;
worker-src  'self' blob:;
```

> ⚠️ **現況更正**：`style-src` 目前仍保留 `'unsafe-inline'`（GitHub Pages 無法於伺服器端動態產生 nonce，貿然移除但不提供有效 nonce 會破壞所有動態樣式注入，故暫以此作為務實預設值）。JS 層已完成合規改造、隨時可切換嚴格模式：
>
> | 動態樣式類型 | 合規方式（已完成） |
> |-------------|---------|
> | `<style>` 節點注入（主題、列印、自適應樣式） | `element.textContent = css` + `element.setAttribute('nonce', nonce)`，nonce 讀自 `<meta name="csp-nonce">` |
> | 高頻率狀態切換（display、color、width 等） | `element.style.setProperty('prop', value)` |
> | 複合樣式區塊（多屬性一次套用） | `CSSStyleSheet.replace()` + `document.adoptedStyleSheets` 優先，降級為 nonce `<style>` |
>
> 目前 `index.html` 尚未包含 `<meta name="csp-nonce">`，故 nonce 讀取為空字串、`adoptedStyleSheets` 為實際生效路徑。若改用 Cloudflare Pages 等可注入動態 nonce 的環境，只需：① 由 Worker/`_headers` 產生 nonce 並寫入該 meta 標籤，② 將 `style-src` 改為 `'self' 'nonce-{random}'` 並移除 `'unsafe-inline'`——**無需更動任何 JS**，即可切換為嚴格模式。
>
> ⚠️ Note: Chart.js 透過 JS DOM property 設定樣式，**不受 `style-src` 管控**。本專案以 `normalizeChartThemeColors()` 於繪圖前統一解析 CSS var（`getComputedStyle`），確保圖表色彩正確呈現。

> ⚠️ **GitHub Pages 限制**：`<meta>` CSP 不支援 `frame-ancestors` 指令。本專案以 `js/frame-guard.js`（同步載入，無 `defer`）作為替代方案，在渲染前偵測 iframe 嵌入並強制跳出至頂層視窗，等效於 `X-Frame-Options: SAMEORIGIN`。

### XSS 防護

- 所有動態 HTML 插值皆經統一逸出處理後才寫入頁面
- 不將未逸出的資料傳入 `innerHTML`（清空用途例外）
- 不使用 `eval()`、`document.write()`、`new Function()` 等高風險 API
- 學生識別碼一律經加鹽雜湊處理，原始姓名不會出現在任何前端資料或畫面中

### CSP 合規稽核

本專案已完成多輪 CSP 合規稽核，目前程式碼無 inline style／inline script 違規（合規做法見上方對照表）。

### 建議伺服器安全標頭（CDN 層設定）

| 標頭 | 建議值 |
|------|--------|
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

---

## 資料準備

`data/` 目錄下的 JSON 檔案需由後端 ETL 流程產出，**不隨本 repo 提供**（含個資，請自行管理）。

- 成績與 meta 資料由 `etl.py` 產出；行為與風險資料由 `lms_etl.py` 產出，兩者為各自獨立的 ETL 流程。後端套件另附自己的 `README.md`，說明安裝與執行方式
- ETL 端相依套件已整理為 `requirements.txt`；`.xlsx` 讀取自本輪起以 `python-calamine`（Rust 實作）為主要引擎，單檔讀取實測較 `openpyxl` 快約 5.6 倍，環境中未安裝時會自動降級回 `openpyxl`（正確性不受影響、僅速度較慢）並於執行時提示安裝指令
- `at_risk_profile.json` 須符合 schema version ≥ 3.0（多學期結構）
- 早期預警資料包含 BAS 與 XGBoost 雙模型評分欄位；`lms_etl.py` 預設啟用 XGBoost 訓練，可依需求切換為 BAS-only 模式
- 去識別化前會先過濾因合併開班而混入匯出檔的系外學生資料，避免污染跨班級統計與模型訓練特徵；詳細比對邏輯屬後端套件內部實作，請直接參考其原始碼

---

## 資料範圍與統計排除規則

儀表板的跨班級聚合統計（加權平均、學制別比較、及格率趨勢等）以本系在籍學生為主體。以下兩類資料會被排除於這類聚合統計與模型訓練之外，但**原始紀錄本身不會被刪除或隱藏**，仍可於個別班級明細與歷史紀錄中查閱：

- 已無現行招生的歷史特殊任務班級，成績僅作歷史紀錄保留
- 因共同必修課合併開班而混入 LMS 匯出檔的系外學生行為資料

排除發生在資料前處理階段，前端與後端 ETL 各自把關一次，確保這類資料不會污染跨班級聚合統計或早期預警模型的訓練特徵。實際比對邏輯屬套件內部實作，不在此公開說明；如需稽核請直接查閱原始碼。

---

## 本機執行

###### 環境需求

1. Node.js（用於 `npx serve`）或 Python 3.x（擇一即可）
2. 已備妥 `data/` 目錄下的 JSON 資料檔

###### 啟動步驟

1. Clone 本 repo

```sh
git clone #.git
cd la-dash
```

2. 啟動本機靜態伺服器

```sh
# 方式一：Node.js
npx serve .

# 方式二：Python
python -m http.server 8080
```

3. 瀏覽器開啟 `http://localhost:8080`

> ⚠️ 直接以 `file://` 開啟會因 CORS 限制無法載入 JSON，請務必透過本機伺服器。

---

## 部署至 GitHub Pages

1. 將 `data/` 目錄加入 `.gitignore`，避免個資外洩
2. 於 repo 的 **Settings → Pages** 設定來源分支
3. `frame-ancestors` / `X-Frame-Options` 由 `frame-guard.js` 替代防護（GitHub Pages 不支援自訂 HTTP 標頭）
4. 如需動態 nonce CSP 或完整伺服器層安全標頭，建議改用 [Cloudflare Pages](https://pages.cloudflare.com/)（支援 `_headers` 及 Worker）

---

## 篩選維度

本儀表板支援以下篩選規則：

- **學期** → 自動反灰不適用學制
- **學制**：二技一般、二技在職、二技夜間、四技一般、學士後、重修班、重修生
- **課程類型** → 依學制鎖定可選項目
- **班級** → 動態依前述選項產生清單
- **重修生開關**：可單獨切換是否納入統計
- **篩選狀態記憶**：安全子集合（學期、學制、顯示模式等）記住上次選擇；班級、搜尋字串等資料範圍選擇不記憶，降低共用電腦查詢外洩風險

---

## PWA 安裝

| 平台 | 步驟 |
|------|------|
| iOS Safari | 分享 → 加入主畫面 |
| Android Chrome | 網址列右側「安裝」按鈕 |
| 桌機 Chrome/Edge | 網址列右側安裝圖示 |

---

## 版本控制

本專案使用 Git 進行版本管理。前端可版本化資源共用單一版本戳，作為 `?v=` cache-busting query string；多處各自手動維護版本號曾是重複性快取失效問題的根因，現已改為部署時於單次執行內原子性同步、並自動對全部 JS 檔案做語法驗證，避免人工遺漏。

---

## 授權

本專案為某科大內部教學研究用途，資料集不對外公開。程式碼部分採 MIT 授權，詳見 [LICENSE](LICENSE)。

---

## 鳴謝

- [Chart.js](https://www.chartjs.org)
- [D3.js](https://d3js.org)
- [GitHub Pages](https://pages.github.com)
- [Cloudflare Pages](https://pages.cloudflare.com)
- [PWACompat](https://github.com/GoogleChromeLabs/pwacompat)
- [Img Shields](https://shields.io)
