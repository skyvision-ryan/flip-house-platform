"""阶段清单：按负责人拆的 5 个阶段算“到哪一步、轮到谁”。
自动证据读时算，手动打的勾存在 project_steps。
大节点要 D 和 J 各勾一次：存成 key "open_escrow:D" / "open_escrow:J"，两个都在才算过。
有自动证据的项只认证据，不能靠手工勾冒充完成；final 必须持续绑定最近一次 final 检查结果。
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .dictionaries import FILE_TYPES, MONEY_FIELDS, STAGE_CHECKLIST, STAGE_TO_LEGACY, UTILITY_KINDS

UTILITY_LABEL = {u["value"]: u["label"] for u in UTILITY_KINDS}

FIELD_LABEL = {"purchase_price": "买入价", "purchase_date": "买入日期", "construction_start": "开工日期",
               "list_date": "挂牌日期", "sale_date": "成交日期", "risks": "风险"}
FILE_LABEL = {t["value"]: t["label"] for t in FILE_TYPES}

# 关键波次：已下单 / 已到货 / 不适用 才算齐
_PROC_OK = {"received", "na"}   # 到货或不适用才算齐；已下单不算


def _fmt(v) -> str:
    """金额去掉 .0 加千分位；日期原样。"""
    if isinstance(v, (int, float)):
        return f"${v:,.0f}"
    return str(v)


def _final_inspection_ok(p: models.Project) -> tuple[bool, str | None]:
    """最近一次标 final 的检查必须是 passed；否则 final 门不能算过。"""
    finals = sorted([i for i in p.inspections if i.is_final], key=lambda i: (i.date or "", i.id))
    if not finals:
        return False, None
    last = finals[-1]
    if last.result == "passed":
        return True, f"final 检查通过：{last.name}" + (f"（{last.date}）" if last.date else "")
    return False, f"最近一次 final 检查未通过：{last.name}（{last.result}）"


def _evidence(rule: str, p: models.Project, hide_money: bool = False) -> tuple[bool, str | None]:
    """返回 (是否有证据, 证据说明)。规则可用 | 表示任一满足。"""
    for alt in rule.split("|"):
        kind, _, arg = alt.partition(":")
        if kind == "field":
            v = getattr(p, arg, None)
            if v not in (None, ""):
                if hide_money and arg in MONEY_FIELDS:
                    return True, f"已填{FIELD_LABEL.get(arg, arg)}"
                return True, f"已填{FIELD_LABEL.get(arg, arg)}：{_fmt(v)}"
        elif kind == "file":
            hit = [f for f in p.files if f.doc_type == arg]
            if hit:
                f = sorted(hit, key=lambda x: x.uploaded_at)[-1]
                who = f"（{f.uploaded_by} 传的）" if f.uploaded_by else ""
                return True, f"已上传{FILE_LABEL.get(arg, arg)}：{f.filename}{who}"
        elif kind == "photo":
            hit = [f for f in p.files if f.step_key == arg and (f.mime or "").startswith("image/")]
            if hit:
                f = sorted(hit, key=lambda x: x.uploaded_at)[-1]
                return True, f"已传 {len(hit)} 张照片" + (f"（{f.uploaded_by} 传的）" if f.uploaded_by else "")
        elif kind == "confirm":
            return False, None
        elif kind == "analysis":
            if p.analyses:
                return True, f"已做 {len(p.analyses)} 版交易分析"
        elif kind == "expense":
            # 保留解析能力，但清单不再用 expense:any 冒充采购完成
            if p.expenses:
                return True, f"已有 {len(p.expenses)} 笔支出"
        elif kind == "procurement":
            items = list(getattr(p, "procurement_items", []) or [])
            if arg == "critical":
                crit = [i for i in items if i.wave == "before_rough"]
                if not crit:
                    return False, None
                pending = [i for i in crit if i.status not in _PROC_OK]
                if not pending:
                    return True, f"水电检查前材料已齐（{len(crit)} 项）"
                return False, None
        elif kind == "utilities":
            by = {u.kind: u for u in p.utilities}
            accept = {"on", "off"} if arg == "on" else {"off"}
            hit = [k["value"] for k in UTILITY_KINDS if by.get(k["value"]) and by[k["value"]].status in accept]
            if len(hit) == len(UTILITY_KINDS):
                who = {by[k].updated_by for k in hit if by[k].updated_by}
                return True, f"水电瓦斯三家都{'已开通' if arg == 'on' else '已关闭'}" + (f"（{'、'.join(sorted(who))} 填的）" if who else "")
        elif kind == "inspections":
            if arg == "any":
                passed = [i for i in p.inspections if i.result == "passed"]
                if passed:
                    return True, f"已通过 {len(passed)} 次检查：{'、'.join(i.name for i in passed)}"
            elif arg == "final":
                ok, why = _final_inspection_ok(p)
                if ok:
                    return True, why
    return False, None


def _hint(it: dict, p: models.Project, hide_money: bool = False) -> str | None:
    """大节点的交付物（日期 / 文件）有没有到位，只作提示，不决定打勾。"""
    dv = it.get("deliverable") or {}
    if dv.get("kind") != "confirm":
        return None
    parts = []
    if it["key"] == "final":
        ok, why = _final_inspection_ok(p)
        parts.append(why if why else "还没有通过的 final 检查")
    if dv.get("field"):
        v = getattr(p, dv["field"], None)
        parts.append((f"已填{FIELD_LABEL.get(dv['field'], dv['field'])}" if hide_money and dv['field'] in MONEY_FIELDS else f"已填{FIELD_LABEL.get(dv['field'], dv['field'])} {_fmt(v)}") if v else f"还没填{FIELD_LABEL.get(dv['field'], dv['field'])}")
    if dv.get("doc_type"):
        hit = [f for f in p.files if f.doc_type == dv["doc_type"]]
        parts.append(f"已传{FILE_LABEL.get(dv['doc_type'])}" if hit else f"还没传{FILE_LABEL.get(dv['doc_type'])}")
    return "，".join(parts) or None


def compute_steps(db: Session, p: models.Project, hide_money: bool = False) -> dict:
    manual = {s.key: s for s in db.scalars(select(models.ProjectStep).where(models.ProjectStep.project_id == p.id)).all()}
    stages = []
    for st in STAGE_CHECKLIST:
        items = []
        for it in st["items"]:
            ok, why = _evidence(it["evidence"], p, hide_money)
            confirm = it.get("confirm") or []
            if confirm:
                recs = {c: manual.get(f"{it['key']}:{c}") for c in confirm}
                confirmed = [c for c, r in recs.items() if r and r.done]
                manual_done = len(confirmed) == len(confirm)
                last = max((r for r in recs.values() if r and r.done), key=lambda r: r.done_at or "", default=None)
                m = last
                done = manual_done
                how: str | None = "manual" if manual_done else None
                evidence = why
                # final：确认后若复检失败，持续不算过门
                if it["key"] == "final":
                    final_ok, final_why = _final_inspection_ok(p)
                    if manual_done and not final_ok:
                        done = False
                        how = None
                        evidence = final_why or "final 检查未通过，确认无效"
                    elif final_ok:
                        evidence = final_why
            elif it["evidence"] == "manual":
                m = manual.get(it["key"])
                confirmed = []
                manual_done = bool(m and m.done)
                done = manual_done
                how = "manual" if manual_done else None
                evidence = why
            else:
                # 有自动证据的项：只认证据，忽略历史误勾
                # 有自动证据的项：证据优先；没证据但紫蓝手工确认过的，算“手工确认（无证据）”，不清空历史
                confirmed = []
                m = manual.get(it["key"])
                override = bool(m and m.done) and not ok
                done = ok or override
                how = "auto" if ok else ("manual_override" if override else None)
                evidence = why if ok else (f"{m.done_by} 手工确认，没有交付证据" if override else None)
            items.append({
                "key": it["key"], "title": it["title"], "owners": it["owners"], "gate": bool(it.get("gate")),
                "ws": it.get("ws"), "purpose": it.get("purpose"), "done_when": it.get("done_when"),
                "deliverable": it.get("deliverable"), "evidence_hint": _hint(it, p, hide_money),
                "confirm": confirm, "confirmed": confirmed,
                "done": done, "how": how,
                "evidence": evidence, "can_auto": it["evidence"] != "manual",
                "done_by": (m.done_by if m else None), "done_at": (m.done_at if m else None), "note": (m.note if m else None),
            })
        undone = [i for i in items if not i["done"]]
        gates = [i for i in items if i["gate"]]
        all_gates_done = all(g["done"] for g in gates) if gates else (not undone)
        # 步卡上显示的门：第一道没过的；都过了就是最后一道
        shown = next((g for g in gates if not g["done"]), gates[-1] if gates else None)
        stages.append({"key": st["key"], "label": st["label"], "short": st.get("short", st["label"]), "desc": st.get("desc"), "items": items,
                       "done_count": len(items) - len(undone), "total": len(items),
                       "gates": [{"key": g["key"], "title": g["title"], "done": g["done"], "confirmed": g["confirmed"], "at": g["done_at"] if g["done"] else None} for g in gates],
                       "gate_title": shown["title"] if shown else None, "gate_done": all_gates_done,
                       "gate_confirmed": (shown["confirmed"] if shown else []),
                       "gate_at": (shown["done_at"] if shown and shown["done"] else None)})

    idx = next((i for i, s in enumerate(stages) if not s["gate_done"]), len(stages) - 1)
    cur = stages[idx]
    undone_here = [i for i in cur["items"] if not i["done"]]
    earlier = [{"key": i["key"], "title": i["title"], "owners": i["owners"], "stage": s["label"]}
               for s in stages[:idx] for i in s["items"] if not i["done"]]
    if not undone_here and idx == len(stages) - 1 and not earlier:
        current = {"key": "done", "label": "全部完成", "index": idx + 1}
        next_up: list[dict] = []
    else:
        current = {"key": cur["key"], "label": cur["label"], "index": idx + 1}
        next_up = [{"key": i["key"], "title": i["title"], "owners": i["owners"], "gate": i["gate"]} for i in undone_here[:3]]
    progress = [{"key": s["key"], "label": s["label"], "short": s["short"], "done": s["done_count"], "total": s["total"],
                 "gate_title": s["gate_title"], "gate_done": s["gate_done"], "gate_confirmed": s["gate_confirmed"], "gate_at": s["gate_at"], "gates": s["gates"]} for s in stages]
    return {"stages": stages, "current_stage": current, "next_up": next_up, "earlier_undone": earlier, "stage_progress": progress}


def derive_legacy_stage(steps: dict, p: models.Project) -> tuple[str, str | None]:
    """清单当前段 → 旧的 stage / substage。线索段保留人工填的子阶段（联系卖家 / 约看 / 已出价…）。"""
    key = steps["current_stage"]["key"]
    stage, sub = STAGE_TO_LEGACY.get(key, ("lead", None))
    if stage == "lead":
        sub = p.substage if p.stage == "lead" and p.substage else "new_lead"
    return stage, sub


def sync_legacy_stage(db: Session, p: models.Project, steps: dict) -> bool:
    """把派生的 stage / substage 写回 projects（只为旧筛选与状态规则）。有变化返回 True，调用方决定是否 commit。"""
    stage, sub = derive_legacy_stage(steps, p)
    if p.stage != stage or p.substage != sub:
        p.stage, p.substage = stage, sub
        return True
    return False
