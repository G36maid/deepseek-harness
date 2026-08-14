# Agent Note: 全新瀏覽器打開的設定語言由瀏覽器決定

Status: implemented

[English](2026-07-31-browser-derived-initial-locale.md) | [简体中文](2026-07-31-browser-derived-initial-locale.zh.md) | 繁體中文

## Problem

設定裡的語言行在每一次首訪時都以中文開場：`LocaleRuntime` 從 localStorage 讀取 `dsh.locale`，讀不到就直接回落到 `zh`。瀏覽器本已聲明其使用者閱讀哪些語言——`navigator.languages` 就是這份聲明——而應用對此視而不見，於是英文讀者迎面撞上一個中文產品，還得先找到一行中文標籤的設定項才能脫身。回落值當時同時承擔兩份職責：既是無法解析出 locale 時的最後兜底，也是所有從未做過選擇的使用者拿到的答案。

## Decision

**暫定 locale 先經瀏覽器、再經 `FALLBACK_LOCALE` 解析；顯式 Host 偏好會即時替換它。** `packages/client/locale/src/client/index.ts` 中的 `resolveInitialLocale()` 在服務構造時執行，並表達瀏覽器／回落順序。隨後，非阻塞 settings 生命週期會應用 `$DSH_HOME/settings.yaml` 中選填的 `locale.preference`；若該值缺失，則繼續使用由瀏覽器派生的值。

**瀏覽器匹配按主子標籤進行，且遍歷有序清單。** `detectBrowserLocale()` 遍歷 `[...(navigator.languages ?? []), navigator.language]`，返回主子標籤命中已提供 locale 的首個條目，因此 `zh-Hans-CN` 與 `zh-TW` 同歸 `zh`、`en-GB` 歸 `en`；而只請求本應用不提供的語言（`fr`、`de`）的瀏覽器則什麼都匹配不到，交由 `FALLBACK_LOCALE` 接管。`navigator.language` 排在清單之後，並兜住那些 Navigator 上沒有 `languages` 的宿主——DOM 庫把它標注為必然存在，所以這份容忍帶一條窄口徑 lint 例外，與 `localStorage` 守衛表達的環境邊界不信任同源。

**判定瀏覽器用的是 `window` 而非 `navigator`。** Node ≥ 21 暴露全域性 `navigator` 並報告機器自身語言（CI runner 上是 `en-US`），因此以 `navigator` 把關會讓 node 啟動用戶端樹時解析成 `en`，而非文件約定的回落值。以 `window` 把關可使所有非瀏覽器執行都停留在 `FALLBACK_LOCALE`。

**顯式選擇具有持久性。** `setLocale` 透過 Host settings API 寫入，因此選過語言的使用者可在共享同一 DSH home 的不同瀏覽器 origin 與系統語言之間保留原選擇。沒有任何程式碼把探測到的 locale 寫回：探測在每次啟動時重新推導，對「使用者是否做過選擇」這一問題始終不可見。

**瀏覽器 e2e 車道固定瀏覽器語言。** 斷言中文文案的場景（`access-confirmation`、`models-settings`、`onboarding-deepseek-config`、`settings-chrome`）以 `apps/web/tests/support.ts` 的 `locale: ZH_BROWSER_LOCALE` 打開頁面；`newEnglishPage` 聲明 `en-US`。`settings-chrome.e2e.ts` 使用沒有顯式 locale 的全新 Host home，斷言其英文瀏覽器會生成英文 settings 介面：這是本功能在組裝後應用中的證據。

## Alternatives considered

- **`Intl.DateTimeFormat().resolvedOptions().locale` 或單讀 `navigator.language`**：兩者都把使用者的有序偏好清單塌縮成一個標籤，於是 `['de', 'en', 'zh']` 的讀者拿到的是 zh 而非 en。清單恰恰是瀏覽器這份聲明裡最值得讀的部分。
- **首次啟動即持久化探測結果**：那會把探測變成一次性事件，讓一次過時的首訪凌駕於此後改變的瀏覽器語言之上，也摧毀了整個解析順序所相依性的區分——儲存值將不再意味著「使用者選了它」。
- **完整的 BCP 47 協商（`Intl.LocaleMatcher` 式尋找、地區與文字權重）**：在只提供兩個語言互異的 locale 時，主子標籤匹配就是正確答案的全部；協商層只會帶來無行為支撐、也無從測試的表面積。
- **為默認 locale 增加一個 Cordis 設定鍵**：此處部署之間並無差異——回落值是產品對「完全沒有訊號」給出的答案，不是旋鈕。倉庫策略把 `Config` 欄位留給有當前消費端、且隨部署變化的選擇。
- **讓 e2e 車道的中文場景繼續釘儲存項（`dsh.locale=zh`）**：那會讓套件保持綠色，卻抹掉瀏覽器推導路徑在組裝後應用中唯一的執行處；改釘瀏覽器語言才能端到端地演練新的解析過程。

## Consequences

- 來自英文瀏覽器的首訪落在英文介面，而語言行依然呈現同樣兩個以自身語言自述的選項，兩個方向的脫身通道都未改變。
- `FALLBACK_LOCALE` 收窄回它真正的職責——字典回落與無訊號時的答案——不再兼職充當「使用者尚未選擇」。
- 在 jsdom 下構造 `LocaleRuntime` 的測試現在相依性環境的 `navigator`：斷言本機化文案的用例以一行套件級 `usePinnedBrowserLanguages('zh-CN')`（dsh-client-test-runtime）聲明其瀏覽器，今後任何斷言預設值的用例同樣如此。本包自己的用例直接給全域性打樁，因為它們需要該 helper 刻意不表達的形狀（`languages` 缺失、清單與 `language` 解耦、完全沒有 `window`）。
- 探測的代價是每次服務構造遍歷一次陣列，且不會隱式寫入 settings；外掛程式啟用後，顯式 Host 偏好可能引發一次即時收斂。
