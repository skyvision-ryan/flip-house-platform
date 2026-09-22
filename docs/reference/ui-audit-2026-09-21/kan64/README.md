# KAN-64 四种开关组合的取色结果

两个讲解开关（评审标注 `reviewTags`、角色色圈 `roleColors`）各自一个 localStorage 键，
四种组合各扫一次，验证「默认态不回归、开会态不超上限、两个开关互不干扰」。

| 文件 | 路由 | reviewTags | roleColors | 非状态色相数 |
|---|---|---|---|---|
| `scan-project-2240-bothoff.json` | 总览 | — | — | **0** |
| `scan-project-2240-reviewonly.json` | 总览 | `on` | — | **1** |
| `scan-project-2240-roleonly.json` | 总览 | — | `on` | **1** |
| `scan-project-2240-bothon.json` | 总览 | `on` | `on` | **2** |
| `scan-budget-2240-bothoff.json` | 预算 | — | — | **0** |
| `scan-budget-2240-roleonly.json` | 预算 | — | `on` | **2** |

预算页单独测，是因为**总览页没有决策级负责人，测不到 tier 紫**。
预算页的 `budget.approve` 归 J（决策紫），`budget.lines` 归 `?`（待确认），
两个总览页覆盖不到的分支都在这一屏上：紫落 8 号桶，`?` 画虚线空圈不上色、不进桶。

采集条件：`http://localhost:5180/projects/1`，身份「负责人」，`innerWidth` 2240。
和 `../after/` 那批不同宽（那批是 1440/375），所以**只在本目录内部横向比**，
不要拿这里的样本数去和 `after/` 对减——换宽度本来就会变。

## 复算

```
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types \
  scripts/ui_color_report.ts docs/reference/ui-audit-2026-09-21/kan64
```

## 重采

`scripts/ui_color_scan.js` 要跑在页面里，而 Vite 不允许 fetch 项目根下的任意文件（403）。
当时的做法是把它临时拷成 `frontend/public/__scan.js` 走同源 fetch，采完即删——
`frontend/public/` 本来不存在，仓库里现在也不该有这个目录。

采完的原始输出是 `{samples:[...]}`，要折成 report 认的 `{colors:[{value,n,eg}]}`：
按 `value` 计数、每个值留第一条 `path` 当 `eg`。

口径（上限 / 实测的差异从哪来）写在 `frontend/src/lib/colorPolicy.ts` 的
`ScanSummary` 注释和 `docs/界面风格与AWS对照.md` 第 3 节，不在这里重复。
