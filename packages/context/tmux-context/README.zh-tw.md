# @deepseek-ai/dsh-tmux-context

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

選填啟用的持久上下文，記錄本 agent（代理）行程所在的 tmux session、window、pane，以及該 window 的 pane 樹版面配置。在準備模型請求時每輪取樣一次；隨附 Web／無頭組合不包含它。決策記錄見：[tmux-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-27-tmux-location-context.md)。

## 設定

```yaml
- id: tmux-context
  name: '@deepseek-ai/dsh-tmux-context'
  config:
    refreshIntervalMs: 60000 # optional; omit or set to 0 to inject on every changed turn
```

`refreshIntervalMs` 必須是非負安全整數。省略或 `0` 表示只要 tmux 狀態自上次注入以來發生變化就注入。正值會額外抑制距最近一次注入不足該毫秒數的注入。

## 如何讀取 tmux

外掛程式前置註冊一個 `agent/pre-step` 監聽器，僅在每輪的第一個步驟執行。當需要注入時，它透過 `ctx.shell` 執行器服務執行一條只讀命令：

```sh
[ -n "$TMUX_PANE" ] || exit 1
self_tty=$(ps -o tty= -p <pid> | tr -d ' ')
pane_tty=$(tmux display-message -t "$TMUX_PANE" -p '#{pane_tty}') || exit 1
[ "$pane_tty" = "/dev/$self_tty" ] || exit 1
exec tmux display-message -t "$TMUX_PANE" -p '<format>'
```

僅憑 `$TMUX_PANE` 並不足夠：從 tmux shell 啟動的終端機（VS Code 整合終端機、桌面啟動器）會從該祖先進程**繼承** `$TMUX` 與 `$TMUX_PANE`，因此即使行程並不位於那個 pane 中，這些變數依然存在。為此該命令還會把 pane 的 `#{pane_tty}` 與本行程自己的控制終端機（對其 pid 執行 `ps -o tty=`）作比較：真正的 pane 擁有本行程的 tty，而繼承而來的環境指向的是另一個 pane 的 tty。透過 `ctx.shell` 執行會應用部署方的沙盒與策略；外掛程式不擁有任何子行程程式碼。當 `ctx.shell` 缺失、行程不在真實的 tmux pane 內（`$TMUX_PANE` 未設定，或 tty 不匹配 ⇒ 非零退出）或讀取結果格式非法時，本次嘗試為空操作，絕不報錯。由於位置資訊是選填的，執行器的拒絕——`resolve()` 的策略拒絕或 `run()` 的基礎設施故障——會被兜住並記錄為警告，而不會使該輪失敗。

狀態在每個符合條件的輪次拉取——pane 被移動、改名或重新版面配置都會被感知，無需任何 tmux hook 或後臺行程。外掛程式僅在渲染出的 tmux 狀態與上次注入不同時才重新注入，因此位置不變時不會新增任何內容。

## 時序語義

該外掛程式會前置一個 `agent/pre-step` 監聽器。需要注入且下游決策進入擬議步驟時，它會向返回的批次前置新增一條帶來源的 `UserMessage`。AgentLoop 會在 `step/start` 之後記錄該上下文，其來源為 `{ kind: 'plugin', plugin: 'tmux-context' }`。變化抑制與間隔調度會掃描原始持久工作階段事件中該來源的最近一次注入，因此調度可跨壓縮（compaction）與復原的行程存續，無需行程內快取狀態；各工作階段獨立調度。下游在步驟前執行的監聽器拒絕或失敗時，該讀數不會被記錄。

## 模型體驗

### 準備期 tmux 位置

#### 模型看到的內容

在 tmux 狀態發生變化的每一輪，注入一條帶來源標記、含以下三行的上下文訊息。`<window-layout>` 是 tmux 緊湊的 pane 樹描述；pane 與 window 的畫素尺寸有意省略，相鄰 pane 的內容從不採集。

##### 變化輪次讀數

```markdown
tmux location (turn <turn>):
session <session>, window <index> "<name>", pane <index> <pane-id>
window active=<0|1>, pane active=<0|1>, layout <window-layout>
```

#### Token 影響

每條兩行讀數會累積，直到壓縮將其遮蔽。位置未變化以及間隔抑制不會新增內容。

#### KV Cache 影響

僅附加；新增可見內容位於可複用的請求前綴之後，不會使已有 KV Cache 條目失效。

## 已知限制與後續工作

- **僅第一個步驟**——輪次中途移動或縮放的 pane 會在下一輪反映，而非在步驟之間。
- **僅自身位置**——外掛程式從不採集相鄰 pane 的可見文字。
- **只有版面配置，沒有尺寸**——省略 pane/window 畫素尺寸；僅報告版面配置樹與活動標志。
- **製表符分隔欄位**——若 tmux window 名稱包含字面兩字元序列 `\t`，會使讀數分割錯誤並作為非法讀數跳過；常規名稱不受影響。
- **基於 tty 的 pane 判定**——只有當行程的控制終端機與 `$TMUX_PANE` 的 `#{pane_tty}` 一致時，才視為「位於 tmux 中」。這會有意排除從 tmux 祖先進程繼承 `$TMUX`／`$TMUX_PANE` 的終端機（如 VS Code 整合終端機）。`ps -o tty=` 屬於 POSIX；在其或 `#{pane_tty}` 不可用的環境中，該檢查即為空操作。
