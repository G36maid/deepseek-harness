# Agent Note: 按發布序列區分 npm access:vendored 框架與 native 包公開發布

Status: implemented

[English](2026-08-13-public-vendor-and-native-sequences.md) | 繁體中文

## Problem

[三條發布序列](2026-08-10-npm-release-sequences.md)交付時帶的是 `publishConfig.access: restricted`,因此發到 `@deepseek-ai` scope 的每個包只在組織內可見。五次排練發布都是這樣跑的:`dsh@0.0.1-rc.5`、vendor 的 `*-rc.4`、`landlock-run@0.0.1`。

真正卡住公開消費者的是**受限的相依性**。每個 harness 包都把 vendored 框架聲明成 `peerDependency`,`dsh-sandbox-local` 把 Landlock 入口聲明成 `dependency`。一個公開包若要求一個受限包,組織外的人根本裝不上;所以這兩條序列必須先公開,dsh 族纔可能公開 —— 而在 dsh 族仍受限期間,它們也正是外部消費者唯一需要解析到的兩條。

## Decision

access 是每條發布序列的屬性,不是整個 scope 的屬性:

| 序列 | 成員 | `publishConfig.access` |
|---|---|---|
| vendored 框架 | `vendor/*` 九包 | `public` |
| native | `native/landlock-run/packages/*` 三包 | `public` |
| dsh | `packages/*/*` + `apps/*`(221 個成員) | `restricted` |

`check-workspace-constraints.ts` 按各自序列的等級校驗每個 manifest,這是阻止 scope 漂移的那道閘:新增的 `vendor/*` 包留在 `restricted`、或某個 dsh 成員被改成 `public`,都會讓 workspace 約束失敗。

**沒有任何發布路徑傳 `--access`。** 一個選項無法服務等級互不相同的序列,而且選項會覆蓋真正擁有這個事實的 manifest —— 所以 `publish.ts` 不傳,native 的 workflow 也照舊不傳,由各 packed manifest 決定。

harness 消費端引用 Landlock 入口改用 `workspace:^` 而非 `workspace:*`,於是發布出去的 harness 包接受該入口的 patch 與 minor 版本,而不是釘死一個精確版本。入口對它那兩個平臺包仍保持 `workspace:*` —— 那裡二進位必須與入口版本完全一致。

access 是包的屬性、不是版本的屬性:已經以 restricted 發布的這十二個包(`landlock-run@0.0.1` 與 vendored 的 `*-rc.*`)會在**下一次發布**時變為全網可讀。

## Alternatives considered

**一次性把整個 scope 改成 public。** 暫不採用:那會讓下一次 dsh 發布因為一次 manifest 改動而順帶變成公開,而不是出自一個刻意的發布決定。先公開這兩條相依性序列,是能讓每一步的已發布包都保持可安裝的順序,也是將來決定公開 dsh 時的前置條件。

**全部保持受限,改為授予一個只讀 team。** `npm access grant read-only <org:team> <包>` 是逐包的、沒有 scope 通配,覆蓋全集意味著每個包一次 grant,外加一個為後續新增包長期補齊的對帳任務。它也只能覆蓋組織成員,無法服務一個可安裝的公開產物。

**在發布路徑而不是 manifest 裡指定公開。** 混合 scope 下不可能 —— 一個 `--access` 選項表達不了兩種等級 —— 而且它會覆蓋 workspace 約束正在校驗的那個 manifest。

## Consequences

- **這十二個包從下一次發布起就是公開的,而且不能幹淨地回退。** 回到受限 scope 需要付費套餐加逐包 `npm access set status=private`,且已經被下載或映像檔的內容收不回來。
- **`@deepseek-ai/dsh` 仍然裝不了(組織外)。** 它的 manifest 保持 `restricted`;變化的是它已發布的相依性不再受限,所以將來公開它是一個版本決定,而不再是相依性問題。
- **兩條公開序列交付的內容成為全網可讀,它們的 payload 策略分量因此變重。** `vendor/cordis` 有意發布 `src`,因為其匯出對映聲明瞭 `./src/*`;Landlock 入口按既有約定發布 `src/main.c` 作為審計面。
- **這兩條序列不再需要私有包套餐。** 阻塞過首次 native 發布的 `402 Payment Required` 失敗形態對公開包不會再出現。
- **對公開序列,無憑據的 `npm view` 成為一個可用的檢查手段。** 在所有包都受限的時期,沒有憑據的機器對一個確實存在的包會收到 `E404`,與「版本不存在」無法區分。
