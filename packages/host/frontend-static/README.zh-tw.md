# `@deepseek-ai/dsh-host-frontend-static`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Web 殼的 SPA dist 伺服器：一個函式外掛程式（設定為 `{distIndex}`），佔據 [webserver](../webserver/README.md) 的唯一回退席位，並按殼層鎖定的語義服務已建置的前端目錄——越出 dist 根目錄的遍歷返回 403，任何未命中項都以 HTTP 200 回退到 `index.html`（SPA 路由），未知擴充名按 `application/octet-stream` 提供，GET／HEAD 之外的方法在沒有匹配的具名路由時返回 405。每個 index 回應都會經過 webserver 已註冊的 index 轉接器（`applyIndexTaps`），啟動 manifest（中繼資料清單）就是經這條路徑送達頁面的。`distIndex` 是組合應用的組裝事實：[`dsh-web-app`](../../bundle/web-app/README.md) 透過前端包的 exports 解析它並掛載本外掛程式；部署絕不硬編碼它。

回退席位只有單一所有者（第二次佔據會拋錯），並受 effect 作用域約束：dispose（資源釋放）外掛程式的 fiber 會釋放席位，此後無人佔據的 webserver 回答 404。

## 模型體驗

無。該包只服務瀏覽器資產；其中沒有任何內容會進入模型請求。

#### KV Cache 影響

無；該包既不組裝也不傳送提供方請求。

## 已知限制與延期工作

- **初始 MIME 表很精簡**：它覆蓋 Vite 輸出的資產集合及實際交付的 PWA manifest；其他擴充名在相應資產類別實際發布前都會回退到 `application/octet-stream`。
