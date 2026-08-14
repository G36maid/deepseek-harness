# Agent Note: 能力 seam——Service Definition / Service Provider / Consumer 角色

Status: implemented

[English](2026-06-13-capability-seams.md) | [简体中文](2026-06-13-capability-seams.zh.md) | 繁體中文

## 問題

harness 具有可替換的能力：當前是 bash 執行，未來會有沙盒化／遠端執行器和替代模型提供方。一項能力涉及三個關注點，它們以不同速率、因不同原因變化：*約定*（這項能力是什麼）、*實作*（它如何執行）、*消費端 API*（模型和其他外掛程式面向什麼程式設計）。將三者捆綁在一個包中會耦合這些變化速率——把本機執行器換成沙盒化執行器時，模型看到的工具 schema 也會被攪動，儘管面向模型的約定從未改變。

這與「誰在執行時期提供、誰需要一項能力」是不同的問題，後者 Cordis 已透過服務 + `inject` 解決（提供方註冊 `ctx.shell`；消費端聲明 `inject: ['bash']`，其 fiber 掛起直到服務存在）。該機制是必要的，但不決定包的邊界；本 Agent Note 決定的是包的邊界。

## 決策

一項可替換的能力包含**三個角色**：

1. **Service Definition**——擁有 `ctx.<key>` 的 Cordis `Service` 和詞彙類型，僅相依性約定所需的詞彙（例如 `dsh-shell`：`ShellExecutor`、`ShellRunResult`、`ShellProcess`）。Service Definition 可以是抽象類，也可以是具體的登錄檔服務；絕不是 TypeScript `interface`。
2. **Service Provider**——提供或註冊實作的外掛程式（例如 `dsh-bash-local`：子行程、行程組 kill、spill 文件截斷）。沙盒化和遠端 Service Provider 是依據同一 Service Definition 實作或註冊的兄弟包。
3. **Consumer**——模型和外掛程式程式設計所面向的內容（例如 `dsh-tool-bash`：`bash` schema，後臺控制代碼註冊到通用任務執行時期）。Consumer 注入服務鍵，從不匯入 Service Provider 特有的類型。

角色名使用標題式大小寫：**Service Definition**、**Service Provider** 和 **Consumer**。泛指的 `provider` 和 `consumer` 仍使用小寫。

Service Provider 與 Consumer 由此獨立演進：沙盒化執行器替換 `dsh-bash-local` 時無需觸碰任何工具 schema。

當角色獨立演進時，通常使用不同的包；但當各角色確實屬於同一個關注點時，並非必須拆分：LLM（大型語言模型） seam 將 Service Definition 和 Consumer 合併為 `dsh-llm`（Consumer 是 agent loop（代理循環）本身，而非可替換的 schema 介面），配接器作為 Service Provider 包。不要預防性地拆分——如果一項能力只有一種可設想的 Service Provider 和一個 Consumer，就保持為一個包，直到出現第二個。

## 術語：seam 指三者組合，而非介面

一個 **seam** 是完整的能力——三個角色合在一起：**Service Definition**（擁有 `ctx.<key>` 和詞彙的 Cordis `Service`）、一個或多個 **Service Provider**，以及一個或多個 **Consumer**。`packages/shell` 是規範範例——`dsh-shell` / `dsh-bash-local`+`dsh-bash-sandbox` / `dsh-tool-bash`。一個包可以承擔多個角色，但單個角色本身不是 seam。「seam」一詞嚴格保留給這種完整能力；命名其中一個組成部分時，應使用其角色、類、服務、約定或擴充點。[術語表](../../../../docs/glossary.md#capability-seam)是規範條目。

## 曾考慮的替代方案

- **始終合併各角色**：否決。因為它會重新耦合獨立變化的 Service Definition、Service Provider 和 Consumer。
- **`@cordisjs/plugin-capability`**：這是完全不同的維度。它是一個權限／能力*安全*服務（具名權限加繼承，透過 `ctx.capability.test` 針對工作階段偵測這些權限），是延後的權限／沙盒工作（`tools/pre-execute` deny/ask 門）的候選方案，不是替換實作的機制。混淆這兩個「能力」概念正是本 Agent Note 所指出的陷阱。

## 後果

分離角色會增加包和樣板程式碼（`package.json`、`tsconfig`、README 和注入接線）。換來的是：Service Provider 與 Consumer 獨立發布和版本管理，新後端永遠不會波及面向模型的約定。[AGENTS.md](../../../../AGENTS.md) 和 [architecture.md](../../../../docs/architecture.md) 載有這項規則；bash 三件套是參考範本。本 Agent Note 記錄為什麼獨立變化的角色通常需要拆分，而確實共享的關注點可以保持合併。
