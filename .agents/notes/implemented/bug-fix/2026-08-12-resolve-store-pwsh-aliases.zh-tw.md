# Agent Note: 解析 Microsoft Store 的 pwsh 別名

Status: implemented

[English](2026-08-12-resolve-store-pwsh-aliases.md) | [简体中文](2026-08-12-resolve-store-pwsh-aliases.zh.md) | 繁體中文

## 問題

`resolvePwshPath` 聲稱 Store 安裝經 PATH 解析，但它的存在性探測用的是 `existsSync`，會對候選做 stat、從而跟隨重解析點。Store 的 `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` 是 app execution alias，其目標目錄的 ACL 拒絕 stat（EACCES），於是 `existsSync` 看不到它，解析靜默落到 Windows PowerShell 5.1——在這類「唯一的 PowerShell 7 是 Store 安裝」的機器上就用了錯誤的 shell。

## 決策

`candidateExists` 接受「stat 為文件」或「lstat 為連結形態重解析點」的候選，`resolvePwshPath` 改用它。spawn 別名路徑可以工作，因為 CreateProcess 會解析 app execution alias。懸空的連結形態候選同樣被接受，讓損壞的 pwsh 在 spawn 時響亮失敗，而不是靜默降級到 5.1。

## 考慮過的替代方案

**直接探測 WindowsApps 包目錄。** Store 包路徑帶版本且被 ACL 隱藏；硬編碼它只是重複了 PATH 加別名已經擁有的打包知識。

**對 stat 失敗繼續走 5.1 回退。** 否決：它靜默執行了一個並非所裝的 shell，這正是本 note 修復的缺陷。

## 後果

Windows 上 Store 安裝的 PowerShell 7 現在先於 5.1 回退被解析；普通文件候選和非 Windows 平臺行為不變。懸空 symlink 單元測試在全部平臺上釘住 stat/lstat 的分裂行為。
