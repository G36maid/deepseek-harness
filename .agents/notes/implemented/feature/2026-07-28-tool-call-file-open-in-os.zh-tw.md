# Agent Note: 在工具呼叫中用系統應用開啟檔案

Status: implemented

[English](2026-07-28-tool-call-file-open-in-os.md) | [简体中文](2026-07-28-tool-call-file-open-in-os.zh.md) | 繁體中文

## 問題

聊天工具行把整行摘要當作點擊目標，點擊後打開右側 details 面板，並帶有整行懸停背景。對檔案系統工具而言，有用的動作是用作業系統默認應用打開所涉文件，而不是在側欄裡查看原始工具載荷。

## 決策

文件工具的路徑摘要（`read`／`write`／`edit` 參數中的 `path` 或 `file_path`）渲染為靜止狀態下即帶底線的連結，並使用 pointer 遊標。點擊路徑會經 `WorkspaceRuntime.openPath` 呼叫 `host.openPath`，相對路徑以工作階段 cwd 為基準解析。帶文件連結的行關閉參數展開（左側圖示不可點）；工具行（含 bash 與 todo 註冊）去掉整行點擊、整行懸停底色，以及點擊打開 details 的手勢。details 面板及其 inject 面仍保留供程序化選擇；工具行不再驅動它們。

`host.openPath` 是特權一元 RPC，僅接受來自回環地址且同源的瀏覽器請求（與 `host.pickDirectory` 相同的載體守衛）。平臺配接器不經 shell 打開：macOS 為 `open`，Windows 為 PowerShell `Invoke-Item`，桌面 Linux 為 `xdg-open`；瀏覽器可渲染的文件會在 macOS 與桌面 Linux 上優先使用指定的預設瀏覽器。儘管 Node 將 WSL 報告為 `linux`，WSL 仍是一種獨立的宿主形態：配接器根據其環境或 Microsoft 核心 release 識別它，用 `wslpath -w` 轉換 Linux 路徑，並將所得 Windows/UNC 路徑交給同一 PowerShell 交接。打開器的平臺資訊和命令執行器可在測試中注入。僅含 URL 的 read 參數（`web_fetch`）不是文件連結。

## 考慮過的替代方案

- 保留整行點擊打開 details，另加文件入口 — 否決；產品要求用文件連結替換整行手勢。
- 在應用內預覽文件 — 否決；要求是作業系統默認應用。
- 將 WSL 當作桌面 Linux — 否決；WSL 行程報告 `linux`，但 Linux 桌面文件關聯並非必有，而其常規使用者桌面和瀏覽器位於 Windows 上。
- 複用 `host.pickDirectory` 的逾時豁免 — 不必要；打開路徑的交接在常規一元截止時間內即可完成。

## 後果

點擊工具行中的檔案路徑會在宿主上打開該路徑。非文件工具行只是不可互動的摘要（行內已有的展開開關仍保留）。遠端或非回環用戶端無法呼叫 `host.openPath`。

## 風險

- 沒有 `xdg-open` 的桌面 Linux 宿主，以及 Windows 互操作（`wslpath` 加 `powershell.exe`）不可用的 WSL 宿主，會使 RPC 失敗；聊天行保持靜默，宿主返回內部錯誤。
- 沒有工作階段 cwd 時相對路徑會原樣轉發，可能在宿主側失敗。
