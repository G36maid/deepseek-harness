# `@deepseek-ai/dsh-cmdline`

[English](README.md) | 繁體中文

dsh 啟動器交給它所引導應用的那條命令列。啟動器只解析屬於自己的 flag（`--profile`、`--patch`、設定 dump），並把**其後的一切**原樣交給設定樹，因此 flag 家族、`--help` 文字和解析錯誤都由應用自己持有，啟動器不必知道它們。

## 啟動器提供的值

啟動器在任何設定樹條目掛載之前呼叫 `provideCmdline(ctx, host)`，它提供：

- `ctx.cmdlineArgs`：本次呼叫的內層參數。`get()` 就是它的全部介面，返回一份快照：`dsh --profile tui --resume abc` 得到 `['--resume', 'abc']`。
- `ctx.appExit`：一個有邊界的行程退出請求，接到啟動器的關停控制器上。

沒有命令列的嵌入宿主提供空清單；這是誠實的答案，而不是缺失的值。

## 普通提供方與注入設定

任何應用外掛程式都可以注入 `cmdlineArgs`、解析它，再發布一個普通的應用自有服務。`parseCmdline(ctx, program)` 只適配 commander；校驗與發布的服務都歸 program 自己的 action 持有：

```ts ignore
export const name = 'web-startup'
export const inject = ['cmdlineArgs']

export function apply(ctx: Context): void {
  const program = webCommand()
  program.action(() => ctx.provide('webStartup', webValuesFrom(program)))
  parseCmdline(ctx, program)
}
```

它的 Loader 行不攜帶啟動器標記，也沒有特殊類型：

```yaml
- id: web-startup
  name: '@deepseek-ai/dsh-web-app/startup'
```

所有由這些取值設定的行都使用普通服務注入，並在惰性設定中直接訪問該服務：

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  inject: [webStartup]
  config:
    host: !!js ctx.webStartup.host ?? '127.0.0.1'
    port: !!js ctx.webStartup.port ?? 3080
```

`parseCmdline` 在載入時拒絕整棵命令樹中沒有任何命令聲明 action 的 program，把每個命令的退出與輸出都接到啟動器上（commander 只在註冊時把這些設定複製進子命令），再解析不可變參數；解析成功時 commander 執行被呼叫命令的同步 action。action 用 `program.error(...)` 拒絕無效呼叫——必須先拒絕後發布，因為寫在拒絕之前的語句已經執行。遇到 `--help`、`--version`、解析錯誤或這種拒絕時，該配接器輸出 commander 文字並請求退出；提供方什麼也不發布，因此相依性行不會啟用。

### 注入如何排列設定求值

Loader 會把一行的 `!!js` 插值推遲到該行聲明的注入全部啟用之後，再基於該行的外掛程式上下文求值。所以上例可以直接讀取 `ctx.webStartup`：Loader 索取 `webserver` 的設定之前，Cordis 已經填入了這個注入服務。Include 樹會保留巢狀表達式節點，直到各個目標行到達這一時點。提供方替換與活動 patch 重載都會針對當前注入服務重新插值，因此啟動 flag 不會被悄悄重設。

### 共享不可變參數

`get()` 不會消費或修改 argv。多個外掛程式可以解析同一份快照，並分別提供服務。啟動器不會檢查組閤中的命令列所有者；沒有讀取方的 profile 只會忽略自己的應用參數。

樹外外掛程式會帶來自己的一份 commander 副本，因此 commander 的控制流錯誤按結構識別，而不是按類身份識別；按身份判斷會把已經列印出來的 help 重新拋成致命的載入失敗。

## 模型體驗

無。本包在任何工作階段存在之前解析行程自身的命令列。

#### KV Cache 影響

無；本包既不組裝也不傳送提供方請求。

## 已知限制與延期工作

- **啟動器的 flag 必須寫在應用參數之前**：切分按位置進行，啟動器不認識的第一個 token 就是內層參數的起點，因此寫在某個應用 flag 之後的 `--patch` 屬於應用。啟動器的解析器會消耗掉一個 `--`，因此必須以字面量 `--` 存活到應用的參數需要寫成 `-- --`。
- **應用自有服務沒有靜態聲明的提供方**：消費行透過普通注入點名它；缺少提供方的組合包會在結帳時失敗，由待處理條目點名該服務，而不是在載入時失敗。
- **使用者 patch 若整體替換某行的 `config`，會連同其中的表達式一起丟掉**：flag 勝過的是表達式旁寫著的那個值，而不是使用者用字面量替換掉表達式之後的結果；保留表達式才能保留 flag 的優先級。
