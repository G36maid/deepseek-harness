# extensions/：agent（代理）修改自身執行時期

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

agent 修改自身執行時期：檢查已載入的外掛程式與服務介面、定義並執行模型編寫的動態包（dynamic package）並再次撤下，外加受限 repository Plugin 執行時期。兩個瀏覽器半的包住在這裡而不是 `packages/client/`，因為它們是本子系統雙半包的其中一半；host 聚合把它們排除在外，讓兩個契約面各自保有獨立的編譯 program。設計居所：[工具集 Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

| 包 | 角色 | ctx 鍵 |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.md) | `cordis_inspect`／`cordis_define`／`cordis_run`／`cordis_stop`／`cordis_undefine` 工具：讀取當前行程執行時期，並在一個自有分組 fiber 下管理記憶體中的動態包 | 註冊到 `ctx.tools` |
| [`cordis-host-runner/`](cordis-host-runner/README.md) | 定義登錄檔、host 半的 `node:vm` 沙盒，以及 request-run 往返 | 提供 `ctx.dynamicCordisRunner` |
| [`cordis-client-runner/`](cordis-client-runner/README.md) | 雙半包的瀏覽器半：把定義求值成活的瀏覽器外掛程式，並應答執行請求 | client 面；提供瀏覽器側 `ctx.dynamicCordisRunner` |
| [`ui-cordis/`](ui-cordis/README.md) | 瀏覽器面：操作全部定義的全域性面板，與只讀的 define 卡片 | client 面；註冊 slot |
