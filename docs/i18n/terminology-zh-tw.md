# Terminology（zh-TW）

本表约定简体中文（zh-CN）译文转换为繁体中文（zh-TW）时的术语取捨。简体侧的中英锚点、首次出现与「不要译作」以 [terminology.md](terminology.md) 为准；本表只记录 zh-TW 与 zh-CN 不同的用词，以及 OpenCC 机械转换会转错、需要人工校正的词条。英文术语在 zh-TW 与 zh-CN 同样保留英文，不列入本表。

**通用规则：**
- 「繁體中文」列为 zh-TW 正文的默认用词。若该列为英文，则 zh-TW 正文中保留英文不翻译（与 zh-CN 一致）。
- 首次出现沿用 terminology.md 的「首次出现」列规则，括注内的简体词按本表换算为繁体词。
- 「不要译作」列的禁忌在 zh-TW 同样适用；本表额外标注机械转换陷阱（OpenCC 会转成错误词形的条目）。
- 本表条目同时是批量转换的校正来源：`convert-zh-tw` 将本表作为 zhtw-js 的自定义词典在转换时优先套用，OpenCC `cn→t` 仅负责字符级回退；未列出的简体词按 zhtw-js 默认词形输出。
- 拼音、代码、命令、文件名等不翻译（与 zh-CN 规则一致）。

## 需要替换的词条（zh-CN → zh-TW）

| 简体中文 | 繁體中文 | English 錨點 | 備註 |
|---|---|---|---|
| 人工智能 | 人工智慧 | AI | OpenCC 已覆盖；`AI（人工智能）` 首次出现注释放置为 `AI（人工智慧）` |
| 智能体 | 代理 | agent | 台湾惯用「代理／代理人」，不用「智能体」（对岸词）；首次出现写 `agent（代理）` |
| 智能体框架 | 代理框架 | agent harness | 首次出现写 `agent harness（代理框架）` |
| 智能体循环 | 代理循环 | agent loop | 首次出现写 `agent loop（代理循环）` |
| 编程智能体 | 编码代理 | coding agent | 首次出现写 `coding agent（编码代理）` |
| 子代理 | 子代理 | subagent | 同形词，无需替换；台湾惯用 |
| 命令行界面 | 命令列介面 | CLI | 首次出现写 `CLI（命令列介面）` |
| 驱动 | 驅動 | drive (verb) | zhtw-js 误转成「驅動程式」（名词）；动词用法必须为「驅動」；「驱动程序」仍保留 zhtw-js 输出 |
| 帧驱动 | 幀驅動 | frame-driven | 复合词；避免 zhtw-js 转成「幀驅動程式」 |
| 驱动代码 | 驅動程式碼 | driven code | 复合词；避免 zhtw-js 转成「驅動程式程式碼」（程式重复） |
| 热模块替换 | 熱模組替換 | HMR | 首次出现写 `HMR（熱模組替換）` |
| 大语言模型 | 大型語言模型 | LLM | 首次出现写 `LLM（大型語言模型）` |
| 检索增强生成 | 檢索增強生成 | RAG | 首次出现写 `RAG（檢索增強生成）` |
| 资源释放 | 資源釋放 | dispose | 首次出现写 `dispose（資源釋放）` |
| 文档同步门禁 | 文件同步閘門 | doc-sync | 首次出现写 `doc-sync（文件同步閘門）`；「文档」→「文件」 |
| 测试前置数据 | 測試前置資料 | fixture | 首次出现写 `fixture（測試前置資料）` |
| 函数调用 | 函式呼叫 | Function Calling | 首次出现写 `Function Calling（函式呼叫）`；「函数」→「函式」、「调用」→「呼叫」 |
| 元数据清单 | 中繼資料清單 | manifest | 首次出现写 `manifest（中繼資料清單）`；「元数据」→「中繼資料」 |
| 中途引导 | 中途引導 | steering | 首次出现写 `steering（中途引導）` |
| 文本记录 | 文字記錄 | transcript | 首次出现写 `transcript（文字記錄）` |
| 瀑布式事件 | 瀑布式事件 | waterfall | 同形词 |
| 适配器 | 配接器 | adapter | OpenCC 不会自动处理；台湾惯用「配接器」 |
| 适配器约定 | 配接器約定 | adapter contract | 首次出现写 `适配器约定（adapter contract）` |
| 仅追加 | 僅附加 | append-only | 台湾惯用「僅附加」 |
| 后端 | 後端 | backend | 同形词 |
| 绑定器 | 綁定器 | binder | 同形词 |
| 配置 | 設定 | config | 台湾 UI 惯用「設定」；`config key` → `設定鍵` |
| 配置键 | 設定鍵 | config key | 见「配置」 |
| 配置项 | 設定項 | config entry | `Cordis 配置项` → `Cordis 設定項` |
| 可配置提供方目录 | 可設定提供方目錄 | configurable-provider directory | |
| 控制器 | 控制器 | controller | 同形词 |
| 目录 | 目錄 | directory | 同形词（「目录」本身为简体字形） |
| 引擎 | 引擎 | engine | 同形词 |
| 网关 | 閘道 | gateway | OpenCC 已覆盖；台湾惯用「閘道」 |
| 句柄 | 控制代碼 | handle | 台湾惯用「控制代碼／控制碼」，不用「句柄」 |
| 策略 | 策略 | policy | 同形词 |
| 展示转换器 | 展示轉換器 | presenter | 同形词 |
| 解析器 | 解析器 | resolver | 同形词 |
| 存储 | 儲存 | store | 字形转换 |
| 后台任务 | 背景工作 | background job | 台湾惯用「背景工作／背景作業」 |
| 构建目标 | 建置目標 | build target | 「构建」→「建置」 |
| 取消 | 取消 | cancel | 同形词 |
| canary 测试 | canary 測試 | canary test | 字形转换 |
| 能力 | 能力 | capability | 同形词 |
| 能力 seam | 能力 seam | capability seam | 保留英文 |
| 功能 | 功能 | feature | 同形词 |
| 功能选项 | 功能選項 | feature option | 同形词 |
| 检查点 | 檢查點 | checkpoint | 同形词 |
| 分片 | 區塊 | chunk | 台湾惯用「區塊」；分片为对岸 DB 术语 |
| 压缩 | 壓縮 | compaction | 字形转换 |
| 配套工具 | 配套工具 | companion tool | 同形词 |
| 组合包 | 組合包 | composition bundle | 同形词 |
| Cordis 插件配置 | Cordis 外掛程式設定 | Cordis plugin config | 「插件」→「外掛程式」 |
| 消费方 | 消費端 | consumer | 台湾惯用「消費端／取用端」，不用「消费方」 |
| 内容块 | 內容區塊 | content block | |
| 实操手册 | 實作手冊 | Cookbook | 「实操」→「實作」 |
| 上下文 | 上下文 | context | 同形词 |
| 对侧文件 | 對側檔案 | counterpart | 「文件」→「檔案」 |
| 上下文压缩 | 上下文壓縮 | context compaction | 同形词 |
| 约定 | 約定 | contract | 同形词 |
| Cordis 插件 | Cordis 外掛程式 | Cordis plugin | 「插件」→「外掛程式」 |
| 崩溃恢复 | 當機復原 | crash recovery | 「崩溃」→「當機」 |
| 部署根目录 | 部署根目錄 | deploy root | 同形词 |
| 休眠 | 休眠 | dormant | 同形词 |
| 持久性 | 持久性 | durability | 同形词 |
| 功能依赖 | 功能相依性 | feature requirement | 「依赖」→「相依性」 |
| 事件 | 事件 | event | 同形词 |
| 事件日志 | 事件日誌 | event log | 字形转换 |
| 事件流 | 事件串流 | event stream | 台湾惯用「串流」（stream） |
| 事件溯源 | 事件溯源 | event-sourced | 同形词 |
| 摘要 | 摘要 | Executive summary | 同形词 |
| 执行器 | 執行器 | executor | 同形词 |
| 预期输出 | 預期輸出 | expected output | 同形词 |
| 扩展 | 擴充 | extension | 台湾惯用「擴充」，不用「扩展」 |
| 扩展点 | 擴充點 | extension point | 见「扩展」 |
| 快速失败 | 快速失敗 | fail-fast | 同形词 |
| 围栏代码块 | 圍欄程式碼區塊 | fenced code block | 「代码」→「程式碼」 |
| 指纹 | 指紋 | fingerprint | 同形词 |
| 结束原因 | 結束原因 | finish reason | 同形词 |
| 折叠区 | 摺疊區 | fold | 台湾惯用「摺疊」 |
| 前台运行 | 前景執行 | foreground run | 「前台」→「前景」 |
| 新鲜度 | 新鮮度 | freshness | 同形词 |
| 钩子 | 掛鉤 | hook | 台湾惯用「掛鉤」 |
| 实现 | 實作 | implementation | 台湾惯用「實作」，不用「实现」 |
| 推理 | 推論 | inference | 台湾区分：inference → 推論、reasoning → 推理；首次出现写 `推理（inference）` 时换成 `推論（inference）` |
| 信息字符串 | 資訊字串 | info string | 「信息」→「資訊」、「字符串」→「字串」 |
| 注入 | 注入 | injection | 同形词 |
| 集成 | 整合 | integration | 台湾惯用「整合」，不用「集成」 |
| 接口 | 介面 | interface | 台湾惯用「介面」，不用「接口」 |
| 语言切换行 | 語言切換列 | language switcher | 「切换」→「切換」 |
| 合并 | 合併 | merge | 字形转换 |
| 消息 | 訊息 | message | 台湾惯用「訊息」，不用「消息」 |
| 模组 | 模組 | mod | 同形词 |
| 模型提供方 | 模型提供方 | model provider | 同形词 |
| 模型选择 | 模型選擇 | model selection | 同形词 |
| 模块 | 模組 | module | 台湾惯用「模組」 |
| 非升权 | 非升權 | non-escalation | 同形词 |
| NPM 依赖 | NPM 相依性 | npm dependency | 「依赖」→「相依性」 |
| opt-out 比例 | opt-out 比例 | opt-out ratio | 保留英文 |
| 遗留 | 殘留 | orphan | 台湾惯用「殘留」；指英文源已不存在的译文 |
| 孤立分支 | 孤立分支 | orphan branch | 同形词 |
| 配对 | 配對 | pairing | 同形词 |
| 父级子集授权 | 父層子集授權 | parent-subset grants | 「级」→「層」 |
| 对等依赖 | 對等相依性 | peer dependency | 首次出现写 `对等依赖（peer dependency）` 时换成 `對等相依性（peer dependency）` |
| 权限 | 權限 | permission | ⚠️ OpenCC 陷阱：OpenCC s2twp 会转成「許可權」，台湾正确词形是「權限」；必须人工校正 |
| 持久化 | 持久化 | persistence | 同形词 |
| 流水线 | 管線 | pipeline | 台湾惯用「管線」，不用「流水线」 |
| 插件 | 外掛程式 | plugin | 台湾惯用「外掛程式」 |
| 打包 | 打包 | bundle/packaging | 同形词固定：zhtw-js 会误转成「外帶」，技术文件打包为 bundle/packaging 语境，保持原样 |
| 事故复盘 | 事後檢討 | postmortem | 「复盘」为对岸棋类术语；台湾惯用「事後檢討」；首次出现写 `事故复盘（postmortem）` 时换成 `事後檢討（postmortem）` |
| 提示词 | 提示詞 | prompt | 同形词 |
| 提供方 | 提供方 | provider | 同形词（仓库命名角色，保留「提供方」） |
| 提供方无关 | 提供方無關 | provider-neutral | 同形词 |
| 质量门禁 | 品質閘門 | quality gate | 「质量」→「品質」 |
| 门禁 | 閘門 | gate | 台湾惯用「閘門」，不用「门禁」 |
| 完全停稳 | 完全靜止 | quiescence | 台湾惯用「完全靜止」 |
| 推理 | 推理 | reasoning | 与 inference 区分：reasoning → 推理 |
| 思考内容 | 思考內容 | reasoning_content | 同形词 |
| 注册表 | 登錄檔 | registry | 台湾惯用「登錄檔」（Windows 系统）；代码 registry 可保留「註冊表」 |
| 回放 | 重播 | replay | 台湾惯用「重播」 |
| 恢复 | 復原 | resume | 「恢复」→「復原」（恢复会话/任务语境） |
| 运行时 | 執行時期 | runtime | 台湾惯用「執行時期」，不用「运行时」 |
| 与宿主共享文件系统和内核的子进程 | 與宿主共享檔案系統和核心的子行程 | same-world subprocess | 「文件系统」→「檔案系統」、「内核」→「核心」、「进程」→「行程」 |
| 沙箱 | 沙盒 | sandbox | 台湾惯用「沙盒」 |
| 对外服务接口 | 對外服務介面 | serving interface | 「接口」→「介面」 |
| 服务 | 服務 | service | 同形词 |
| 会话 | 工作階段 | session | 台湾惯用「工作階段」；`session event` → `工作階段事件` |
| 会话事件 | 工作階段事件 | session event | 见「会话」 |
| 设置卡片 | 設定卡片 | setup card | 「设置」→「設定」 |
| 伴随文件 | 伴隨檔案 | sidecar file | 「文件」→「檔案」 |
| 伴随记录 | 伴隨記錄 | sidecar record | 同形词 |
| 冒烟测试 | 冒煙測試 | smoke test | 同形词 |
| 快照 | 快照 | snapshot | 同形词 |
| 真源 | 真源 | source of truth | 同形词 |
| 主干 | 主幹 | spine | 同形词 |
| 陈旧 | 過時 | stale | 台湾惯用「過時」 |
| 步骤 | 步驟 | step | 同形词 |
| 结构签名 | 結構簽章 | structural signature | 台湾惯用「簽章」，不用「签名」 |
| 概述 | 概述 | Summary | 同形词 |
| 系统提示词 | 系統提示詞 | system prompt | 同形词 |
| 分类体系 | 分類體系 | taxonomy | 同形词 |
| token 用量 | token 用量 | token usage | 保留英文 |
| 工具 | 工具 | tool | 同形词 |
| 工具调用 | 工具呼叫 | tool call | 「调用」→「呼叫」 |
| 工具结果 | 工具結果 | tool result | 同形词 |
| 工具 schema | 工具 schema | tool schema | 保留英文 |
| 工具包 | 工具包 | toolkit | 同形词 |
| 轮次 | 輪次 | turn | 同形词 |
| 类型检查 | 型別檢查 | typecheck | 「类型」→「型別」 |
| 词汇 | 詞彙 | vocabulary | 同形词 |
| 协议格式 | 協定格式 | wire format | 「协议」→「協定」 |
| 工作流 | 工作流程 | workflow | 台湾惯用「工作流程」 |
| 包装层 | 包裝層 | wrapper | 同形词 |
| 包装脚本 | 包裝指令碼 | wrapper script | 「脚本」→「指令碼」 |
| wheel 包 | wheel 套件 | wheel | 「包」→「套件」 |

## 需要替换的词条（机械转换陷阱：OpenCC s2twp 会转错，必须人工校正）

| 简体中文 | 繁體中文 | English 錨點 | 備註 |
|---|---|---|---|
| 登录档 | 登錄檔 | registry（登录档为 registry 语境，非 login） | OpenCC 实际输出：登入檔 |
| 本地化 | 在地化 | localization | zhtw-js 会把「文本」跨词界转成「文字」（中文本地化→中文字地化）；本条以最长匹配优先于该内部词条，并采用台湾惯用语 |
| 表达式 | 運算式 | expression | OpenCC 实际输出：表示式 |
| 并发 | 並行 | concurrency | OpenCC 实际输出：併發 |
| 并行 | 平行 | parallelism | OpenCC 实际输出：並行 |
| 并行 | 平行 | parallel | OpenCC 实际输出：並行 |
| 布局 | 版面配置 | layout | OpenCC 实际输出：佈局 |
| 参数 | 參數 | parameter（同形） | OpenCC 实际输出：引數 |
| 常量 | 常數 | constant | OpenCC 实际输出：常量 |
| 超时 | 逾時 | timeout | OpenCC 实际输出：超時 |
| 触发器 | 觸發程序 | trigger | OpenCC 实际输出：觸發器 |
| 弹窗 | 彈出視窗 | popup | OpenCC 实际输出：彈窗 |
| 断点 | 中斷點 | breakpoint | OpenCC 实际输出：斷點 |
| 负载均衡 | 負載平衡 | load balancing | OpenCC 实际输出：負載均衡 |
| 高可用 | 高可用性 | high availability | OpenCC 实际输出：高可用 |
| 构建 | 建置 | build | OpenCC 实际输出：構建 |
| 归档 | 封存 | archive | OpenCC 实际输出：歸檔 |
| 滚动 | 捲動 | scroll | OpenCC 实际输出：滾動 |
| 恢复 | 復原 | restore | OpenCC 实际输出：恢復 |
| 回调 | 回呼 | callback | OpenCC 实际输出：回撥 |
| 回归 | 回歸 | regression（同形） | OpenCC 实际输出：迴歸 |
| 会话 | 工作階段 | session | OpenCC 实际输出：會話 |
| 进程 | 行程 | process | OpenCC 实际输出：程序 |
| 可伸缩 | 可擴充 | scalable | OpenCC 实际输出：可伸縮 |
| 快捷键 | 快速鍵 | shortcut | OpenCC 实际输出：快捷鍵 |
| 扩展 | 擴充 | extension | OpenCC 实际输出：擴充套件 |
| 垃圾回收 | 記憶體回收 | garbage collection | OpenCC 实际输出：垃圾回收 |
| 垃圾回收器 | 記憶體回收器 | garbage collector | OpenCC 实际输出：垃圾回收器 |
| 连接池 | 連線集區 | connection pool | OpenCC 实际输出：連線池 |
| 令牌 | 權杖 | token（资安语境） | OpenCC 实际输出：令牌 |
| 命名空间 | 命名空間 | namespace（同形） | OpenCC 实际输出：名稱空間 |
| 模板 | 樣板 | template | OpenCC 实际输出：模板 |
| 配置 | 設定 | configuration | OpenCC 实际输出：配置 |
| 权限 | 權限 | permission | OpenCC 实际输出：許可權 |
| 认证 | 驗證 | authentication | OpenCC 实际输出：認證 |
| 事务 | 交易 | transaction | OpenCC 实际输出：事務 |
| 事务日志 | 交易日誌 | transaction log | OpenCC 实际输出：事務日誌 |
| 守护进程 | 常駐程式 | daemon | OpenCC 实际输出：守護程序 |
| 套接字 | Socket | socket（保留英文） | OpenCC 实际输出：套接字 |
| 退出 | 結束 | exit | OpenCC 实际输出：退出 |
| 拖拽 | 拖曳 | drag | OpenCC 实际输出：拖拽 |
| 协议 | 協定 | protocol | OpenCC 实际输出：協議 |
| 支持 | 支援 | support | 台湾惯用「支援」；「支持」台湾指支持某观点 |
| 默认 | 預設 | default | 台湾惯用「預設」 |
| 演示 | 示範 | demo | 台湾惯用「示範」或「Demo」 |
| 教程 | 教學 | tutorial | 台湾惯用「教學」；档名与链接目标不转换 |
| 渲染 | 算繪 | render | OpenCC 实际输出：渲染 |
| 异常 | 例外 | exception | OpenCC 实际输出：異常 |
| 元数据 | 中繼資料 | metadata | OpenCC 实际输出：後設資料 |
| 云计算 | 雲端運算 | cloud computing | OpenCC 实际输出：雲端計算 |
| 占位符 | 預留位置 | placeholder | OpenCC 实际输出：佔位符 |
| 栈帧 | 堆疊框架 | stack frame | OpenCC 实际输出：棧幀 |
| 重启 | 重新啟動 | restart | OpenCC 实际输出：重啟 |
| 注释 | 註解 | comment | OpenCC 实际输出：註釋 |
