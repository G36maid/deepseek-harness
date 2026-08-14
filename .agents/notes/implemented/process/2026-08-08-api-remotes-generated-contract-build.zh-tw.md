# Agent Note: API Remotes 生成約定的有序建置

Status: implemented

[English](2026-08-08-api-remotes-generated-contract-build.md) | 繁體中文

## 問題

Host 的 `@Remote` 方法需要先由 Typert 生成 `/remote` 聲明和執行時期貢獻，Client 的 `api-remotes/src/client/index.ts` 才能透過型別檢查並打包這些貢獻。若根建置先把 Host 與 Client 兩張 Project Reference 圖一起交給 tsc，Client 會在生成產物存在之前編譯；若增加獨立 contracts 預處理，又會讓 generator 脫離正常 Host 圖重複編譯，並允許過時產物掩蓋錯誤相依性。

該順序相依性不能改變倉庫的普通 package 規則。正常 package 只屬於一個 TypeScript face：Host package 登記在 `tsconfig.host.json`，Client package 登記在 `tsconfig.client.json`。一個 Client plugin 同時具有 Node loader 入口與 browser 入口，只是打包產物形態，不是拆分 TypeScript project 的理由。

## 決策

根建置先完成 Host tsc 和 Host tsdown，由 Host tsdown 執行 Typert 並生成 Remote Client 約定；隨後完成 Client tsc、Client tsdown 和 Web 建置：

~~~text
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
Vite Web build
~~~

`build:lib:host` 負責前兩步，`build:lib:client` 負責中間兩步，`build:web` 最後執行。`typecheck` 也必須先執行完整 Host lib 階段，因為 Client tsc 需要 Host tsdown 生成的聲明；它不需要執行 Client tsdown 或 Web build。

每個 tsc 階段都是唯一的 TypeScript 編譯器路徑，負責向 `lib/types` 發射 JavaScript、聲明和增量狀態。tsdown 只讀取這些 JavaScript 並生成發布 bundle，不讀取原始碼，也不生成聲明。

## 唯一的 package 特例

`api/remotes` 是唯一同時擁有 Host 與 Client composite project 的 package。Host project 包含 Agent/Session lookup 策略、Host 外掛程式入口和 invariant；Client project 只包含需要等待生成約定的 `src/client/index.ts`：

~~~text
packages/api/remotes/
├─ tsconfig.json
├─ tsconfig.host.json
├─ tsconfig.client.json
└─ src/
   ├─ index.ts
   ├─ agent-lookup.ts
   ├─ invariant.ts
   └─ client/
      └─ index.ts
~~~

包根 `tsconfig.json` 是隻引用兩個具體 project 的 solution，不進入任何 aggregate 或直接消費端的相依性圖。根 Host aggregate 與 `host/apiproxy` 引用 `api/remotes/tsconfig.host.json`；根 Client aggregate 與 `client/ui-goal` 引用 `api/remotes/tsconfig.client.json`。`ui-goal` 本身仍是普通的單一 Client project。workspace constraints 閘門遍歷可達的 Project Reference 圖；凡已聲明 face 的 project 引用了拆分包的 solution 根或另一側 leaf，閘門都會拒絕，而只有 `tsconfig.json` 的目標仍可由任一 face 引用。

兩個 project 使用互不重疊的 `files` 和不同的 `.tsbuildinfo`，因此可以共享 `lib/types` 而不重複發射任何原始碼。若未來需要兩側共用一份實作，應把實作移入中立 package，不能把同一原始碼同時交給兩個 emitting project。

這個例外由生成約定的真實先後關係決定，不是可供普通 package 選擇的範本。新增 package 仍只能登記進一個 aggregate；只有修改本決策並證明存在另一條不可消除的生成相依性，才能增加例外。

## Typert 與 tsdown

Host tsdown 在普通根設定中啟用 `typertPlugin({ mode: 'workspace', faces: ['host'] })`。generator 只以 `tsconfig.host.json` 為 program 種子，生成 `typert.host.*` 以及 Host 約定投影出的 `typert.remote-client.*`；Client tsdown 不啟動 Typert，也不分析 Client aggregate。

TypeScript compiler face 與 Typert 執行時期產物 face 是兩層概念。普通 `dshClient` package 即使只有一個 compiler project，也可以按公開 subpath 同時貢獻 Host 與 Client 執行時期模型；aggregate 顯式引用 `tsconfig.host.json` 或 `tsconfig.client.json` 時，analyzer 才把該 project 限定到對應 face。因此 `api-remotes` 的 Host 分析不會順帶註冊其 Client 入口，普通雙入口 package 的 Host 模型也不會丟失。

Host 與 Client 兩次 tsdown 都接收 `vendor/*`、`packages/*/*` 和 `apps/cli` 這組完整 workspace。根設定不掃描 `lib/types/client/index.js`，不維護 package 分類表，也不使用 tsdown filter；包內設定根據 `DSH_BUILD_FACE` 返回本階段入口。

普通 Client plugin 在 Host pass 返回空設定，在 Client pass 同時生成 Node loader 入口與 browser bundle。`api-remotes` 的 `clientBundle(..., { hostPhase: true })` 是唯一階段例外：Host pass 生成其 Host 入口，Client pass 只生成 browser bundle。未指定 `DSH_BUILD_FACE` 的 package-local tsdown 仍同時返回該 package 的正常入口，供本機單包開發使用。

## 考慮過的替代方案

**保留獨立 contracts 預處理。** 這會在正常 Host Project Reference 圖之外額外編譯 generator，並讓殘留生成物掩蓋 Client 過早進入 Host 圖的問題。

**一次執行根 `tsc -b tsconfig.json` 後再執行 tsdown。** Client tsc 在 Host tsdown 之前發生，無法從乾淨工作樹獲得 `/remote` 聲明。

**拆分所有包含 `src/client/index.ts` 的 package。** Node 與 browser 雙入口是普通 Client plugin 的打包約定，不形成編譯順序相依性；普遍拆分只會增加 references 和增量狀態的維護成本。

**掃描 Client 編譯產物或維護兩份 workspace 清單。** 產物掃描會讓 package 是否參與建置取決於殘留文件，手工清單和 package 名過濾則會隨目錄調整產生漂移。完整 workspace 加包內 face 選擇已經提供確定行為。

**在 Client pass 再執行 Typert。** Remote Client 是 Host 約定的投影，沒有獨立 Client 反射源；第二個 Typert program 只會重複工作並增加兩側聲明混入同一分析的風險。

## 後果

乾淨建置成為順序正確性的權威驗證：沒有任何既存 `/remote` 產物時，Host tsc 必須先成功，Host tsdown 必須生成約定，隨後 Client tsc、Client tsdown 與 Web build 必須成功。任何階段都不得把產物寫進 `src`。

[TypeScript 建置設定 Note](2026-06-17-ts-build-config.md)確定的 tsc-first 職責保持不變，但其單次全圖 tsc 後再打包的命令形態由本文的有序階段取代。[雙 aggregate solution Note](2026-07-22-tsconfig-solution-root-two-aggregates.md)確定的普通 package 單 aggregate 規則保持不變，本文只為 `api/remotes` 建立一個顯式例外。

Client 的獨立建置不再是乾淨工作樹上的自足入口；倉庫命令、CI 和發布流程必須先執行 Host lib 階段。普通 package 的開發者無需理解或複製該例外，仍按所屬執行環境選擇一個 aggregate。
