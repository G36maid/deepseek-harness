# Agent Note: code-runtime seam 擁有可移植識別符號排除集

Status: implemented

[English](2026-07-31-code-runtime-portable-identifier-seam.md) | [简体中文](2026-07-31-code-runtime-portable-identifier-seam.zh.md) | 繁體中文

## Problem

code-runtime seam 承諾：在一個後端上有效的綁定命名空間清單，在每個後端上都有效，因此 Code Mode 消費端可以把同一組綁定交給任何已註冊的執行時期，而不必知道它的語言。首個後端 `dsh-code-runtime-worker-thread` 私自擁有了執行這項承諾一部分的識別符號規則：一個允許 JS 專有 `$` 的 `IDENTIFIER` 正則、一個只含 ECMAScript 關鍵字的 `RESERVED_WORDS` 集合，以及一個含三個 JS `Error` 槽位的 `RESERVED_ERROR_PROPERTIES` 集合。這些規則描述的是 worker 自身的語言，而非 seam 的可移植性約定。

一個針對不同語言（CPython）編寫的第二後端，要麼重新聲明自己的規則——讓 `lambda` 透過 worker 卻在 Python 上失敗，或讓 `$tools` 透過 worker 卻在每個非 JS 後端上失敗——要麼匯入 worker 的規則，從而反轉相依性，使一個 Service Provider 伸手進入另一個兄弟 Service Provider。二者都無法讓可移植承諾成真：它只對呼叫方恰好測試過的那個後端成立。

## Decision

Service Definition 包（`@deepseek-ai/dsh-code-runtime`）以四個具名常數匯出可移植識別符號排除約定，每個 Service Provider 匯入它們而非重新聲明：

- `PORTABLE_RESERVED_WORDS`——ECMAScript 與 Python 保留字的聯集。任何命名空間 global 或 error-class 名稱匹配其中之一，都在所有後端上被拒絕，因此 `lambda` 即便是合法的 JS 參數名也被拒絕。新增一門語言即擴寬此聯集，這是對現有綁定名稱的一次有意的破壞性複審。
- `RESERVED_BINDING_GLOBALS`——某個後端在程序命名空間中擁有的 global：`console`（worker 的日誌捕獲）、`__dsh_main__`/`__builtins__`/`__name__`（Python bootstrap 的包裝器與預置模組 global），以及 `__debug__`（不是 seed 的槽位，而是 CPython 編譯期常數，賦值會被拒，故以該名注入的 global 不可達——同一種可移植性分裂，只是機制不同）。在所有後端上被拒絕，使命名空間清單無法選到一個在某後端能用、在另一後端衝突的名稱。
- `RESERVED_ERROR_MEMBERS`——每個後端都拒絕的 error-member 名稱：JS `Error` 槽位（`name`、`message`、`stack`）與 Python 例外協議成員（`args`、`with_traceback`、`add_note`）。
- `DUNDER_MEMBER`——dunder 形式正則（`__x__`，非空中綴），作為 error member 被整體拒絕，因為其中若干是受約束的 CPython 描述符，其確切集合是解釋器版本細節。

Service Definition 同時把可移植識別符號子集收窄為 `[A-Za-z_][A-Za-z0-9_]*`（記錄在 `CodeBindingNamespace.global` 與 `CodeBindingErrorClass` 上），去掉 JS 專有的 `$`。worker 直接以這些常數的匯出名稱消費它們——binding-global 與 error-class 名稱用 `PORTABLE_RESERVED_WORDS`、後端擁有槽位用 `RESERVED_BINDING_GLOBALS`、error member 用 `RESERVED_ERROR_MEMBERS` 加 `DUNDER_MEMBER`——不再本機起別名；其 `IDENTIFIER` 正則去掉 `$`。

儘管 worker 是唯一已交付的後端，這些常數仍置於 Service Definition：要點正是該約定與語言無關，且由高於任何單一語言的層級擁有。違反它的 Service Provider 纔是 bug，而共享集合正是複審者查看「可移植」含義的地方。

## Scope

本決策只交付 Service Definition 擴充與 worker 對它的採用。`py-types` 渲染器與 Code Mode 的語言分發歸[語言分發 note](../feature/2026-07-31-code-mode-language-dispatch.md) 所有；Python 後端尚不存在。Service Definition README 因此保留僅描述 worker 的措辭：連結到一個不存在的 `dsh-code-runtime-python` README 會破壞死鏈 gate。

`RESERVED_BINDING_GLOBALS` 先於後端本身編碼了 Python bootstrap 的具體設計：它恰好 seed `__builtins__`/`__name__`，並把程序包裝在 `__dsh_main__` 之下。任何 seed 額外模組 global（`__doc__`、`__loader__`、`__spec__`、`__file__`、`__package__` 等）的 Python 後端必須在同一改動中擴寬此集合，正如新增一門語言即擴寬 `PORTABLE_RESERVED_WORDS`——bootstrap 會 seed 卻不在集合中的名稱，正是本約定要防止的可移植性分裂。

## Alternatives considered

**每個後端聲明自己的排除集。** 拒絕：這讓可移植承諾變成逐後端成立。呼叫方在 worker 上測過的綁定清單可能被 Python 拒絕，而這正是 seam 存在要防止的分裂。

**Python 後端匯入 worker 的常數。** 拒絕：這反轉相依性——seam 的 Service Provider 會為一個二者都不擁有的約定伸手進入兄弟實作。約定屬於二者之上，即 seam。

**在可移植識別符號子集中保留 `$`。** 拒絕：`$` 是 JS 專有拼寫。允許它會讓 `$tools` 透過 worker 卻在每個非 JS 後端上失敗，為純粹表面的好處破壞可移植性。

## Consequences

獲得：一個地方——Service Definition 包——定義什麼是可移植綁定名稱，每個後端透過匯入執行同一約定。在一個後端上有效的命名空間清單在所有後端上都有效，這是可驗證的，而非取決於呼叫方測試了哪個後端的巧合。

代價：現有使用含 `$` global 的 worker 呼叫方現在會在識別符號校驗時失敗。在預發布立場下這是對基礎設計的一次糾正，而非需要 shim 的相容性破壞。worker 的 Service Definition misuse 測試新增了 `$tools`、Python 例外成員（`args`）、dunder（`__dict__`）與一個 Python 擁有的 global（`__dsh_main__`）等用例，從 worker 側證明共享集合被執行。
