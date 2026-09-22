"""交易分析器的公式与预填。全部确定性计算，不含任何 AI 判断。

inputs 结构：
  purchase_price: float
  purchase_extras: [{label, amount}]
  holding_months: int
  monthly_costs: [{label, amount}]
  financing: {enabled, down_pct, rate_pct, years}
  rehab_items: [{category, label, amount, note}]
  selling_pct: float
  selling_extras: [{label, amount}]
  sale_price: float
  target_margin_pct: float
  sources: {field: {source, fetched_at, confidence, note}}
"""

from datetime import datetime
from typing import Any

from .dictionaries import ANALYSIS_DEFAULTS as D


def _num(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _sum(rows: list[dict] | None) -> float:
    return sum(_num(r.get("amount")) for r in (rows or []))


def monthly_payment(principal: float, rate_pct: float, years: float) -> float:
    if principal <= 0 or years <= 0:
        return 0.0
    n = int(round(years * 12))
    r = rate_pct / 100 / 12
    if r == 0:
        return principal / n
    return principal * r / (1 - (1 + r) ** -n)


def amortize(loan: float, rate_pct: float, years: float, months: float) -> tuple[float, float]:
    """持有 months 个月内付掉的利息与本金（按等额本息摊还）。"""
    if loan <= 0 or years <= 0 or months <= 0:
        return 0.0, 0.0
    n = int(round(years * 12))
    m = min(int(round(months)), n)
    r = rate_pct / 100 / 12
    pay = monthly_payment(loan, rate_pct, years)
    if r == 0:
        return 0.0, pay * m
    balance = loan * (1 + r) ** m - pay * (((1 + r) ** m - 1) / r)
    principal = loan - balance
    return pay * m - principal, principal


def compute(inputs: dict, price_override: float | None = None) -> dict:
    price = _num(inputs.get("purchase_price")) if price_override is None else price_override
    extras = _sum(inputs.get("purchase_extras"))
    fin = inputs.get("financing") or {}
    enabled = bool(fin.get("enabled", True))
    down_pct = _num(fin.get("down_pct"), 20)
    rate = _num(fin.get("rate_pct"), 7.0)
    years = _num(fin.get("years"), 30)
    loan = price * (1 - down_pct / 100) if enabled else 0.0
    down = price - loan
    payment = monthly_payment(loan, rate, years) if enabled else 0.0

    months = _num(inputs.get("holding_months"), 6)
    monthly = _sum(inputs.get("monthly_costs"))
    interest_total, principal_paid = amortize(loan, rate, years, months) if enabled else (0.0, 0.0)
    holding_total = months * monthly + interest_total   # 本金不是成本，只有利息是
    loan_balance_at_sale = loan - principal_paid

    rehab_total = _sum(inputs.get("rehab_items"))
    sale = _num(inputs.get("sale_price"))
    selling_pct = _num(inputs.get("selling_pct"), 0)
    selling_total = sale * selling_pct / 100 + _sum(inputs.get("selling_extras"))

    total_costs = price + extras + rehab_total + holding_total + selling_total
    profit = sale - total_costs
    cash_invested = down + extras + rehab_total + holding_total + principal_paid   # 已还本金是垫出去的现金
    cash_returned = sale - selling_total - loan_balance_at_sale                    # 卖出还完贷款后拿回的现金

    return {
        "purchase_total": round(price + extras, 2),
        "purchase_extras_total": round(extras, 2),
        "loan_amount": round(loan, 2),
        "down_payment": round(down, 2),
        "monthly_payment": round(payment, 2),
        "monthly_costs_total": round(monthly, 2),
        "interest_total": round(interest_total, 2),
        "principal_paid": round(principal_paid, 2),
        "loan_balance_at_sale": round(loan_balance_at_sale, 2),
        "cash_returned": round(cash_returned, 2),
        "holding_total": round(holding_total, 2),
        "rehab_total": round(rehab_total, 2),
        "selling_total": round(selling_total, 2),
        "total_costs": round(total_costs, 2),
        "total_profit": round(profit, 2),
        "profit_margin_pct": round(profit / total_costs * 100, 2) if total_costs else None,
        "cash_invested": round(cash_invested, 2),
        "roi_pct": round(profit / cash_invested * 100, 2) if cash_invested else None,
        "equity_multiple": round(cash_returned / cash_invested, 2) if cash_invested else None,
        "sale_price": round(sale, 2),
    }


def mao_for_target_margin(inputs: dict, target_margin_pct: float) -> float:
    """使利润率（利润 ÷ 总成本）等于目标值的最高买入价。利润率随买入价单调下降，用二分法。"""
    sale = _num(inputs.get("sale_price"))
    if sale <= 0:
        return 0.0
    lo, hi = 0.0, sale
    if (compute(inputs, price_override=lo).get("profit_margin_pct") or -1e9) < target_margin_pct:
        return 0.0
    for _ in range(60):
        mid = (lo + hi) / 2
        m = compute(inputs, price_override=mid).get("profit_margin_pct")
        if m is not None and m >= target_margin_pct:
            lo = mid
        else:
            hi = mid
    return round(lo, -2)


def full_outputs(inputs: dict) -> dict:
    out = compute(inputs)
    target = _num(inputs.get("target_margin_pct"), D["target_margin_pct"])
    out["target_margin_pct"] = target
    out["mao"] = mao_for_target_margin(inputs, target)
    out["mao_rule70"] = round(0.7 * _num(inputs.get("sale_price")) - out["rehab_total"], -2)
    return out


# ---------------- 预填 ----------------

def _src(source: str, note: str | None = None, confidence: float | None = None) -> dict:
    return {"source": source, "fetched_at": datetime.now().isoformat(timespec="seconds"), "confidence": confidence, "note": note}


def build_prefill(*, sqft: int | None, avm_value: float | None, list_price: float | None, annual_tax: float | None,
                  purchase_price: float | None = None, target_arv: float | None = None, tier: str = "medium",
                  field_sources: dict[str, dict] | None = None) -> dict:
    """用已知数据 + 行业默认值拼出一份完整 inputs，并逐字段标来源。

    KAN-71：`field_sources` 是房产字段的**真实**来源（{field: {source, confidence, note}}），由调用方从
    PropertyFieldSource 的主值行读来。以前这里把挂牌价写死成 public_record/0.9、估值写死成 model/0.75——
    数据来自模拟源时这两个标签就是假的。现在有真实来源就继承，没有才落到保守值。
    """
    sources: dict[str, dict] = {}
    fs = field_sources or {}

    def inherit(field: str, fallback_note: str) -> dict:
        got = fs.get(field)
        if got:
            return _src(got.get("source") or "unverified", got.get("note") or fallback_note, got.get("confidence"))
        return _src("unverified", fallback_note)

    sale = target_arv if target_arv else (avm_value or 0)
    sources["sale_price"] = _src("manual", "来自项目的目标售价") if target_arv else inherit("avm_value", "自动估值，建议核对可比房")

    # 以前没有挂牌价时会按售价七折**凭空造一个买入价**并标成 manual（人工）——伪装成人填的。
    # 现在没有就是 0，来源标「待核实」，让人自己填。
    price = purchase_price if purchase_price else (list_price or 0)
    if purchase_price:
        sources["purchase_price"] = _src("manual", "来自项目的买入价")
    elif list_price:
        sources["purchase_price"] = inherit("list_price", "当前挂牌价")
    else:
        sources["purchase_price"] = _src("unverified", "没有买入价也没有挂牌价，请填写")

    closing = round(price * D["closing_pct"] / 100, 0)
    purchase_extras = [
        {"label": "检验", "amount": D["inspection"]},
        {"label": "评估", "amount": D["appraisal"]},
        {"label": "过户费", "amount": closing},
    ]
    sources["purchase_extras"] = _src("manual", f"行业默认：检验 {D['inspection']}、评估 {D['appraisal']}、过户 {D['closing_pct']}%")

    tax_m = round((annual_tax or 0) / 12, 0)
    ins_m = round(sale * D["insurance_pct_annual"] / 100 / 12, 0) if sale else 0
    util = next(v for cap, v in D["utilities_by_sqft"] if (sqft or 0) <= cap)
    monthly_costs = [
        {"label": "房产税", "amount": tax_m},
        {"label": "保险", "amount": ins_m},
        {"label": "水电", "amount": util},
    ]
    sources["monthly_costs.房产税"] = inherit("annual_tax", "年税 ÷ 12") if annual_tax else _src("unverified", "无税务记录")
    sources["monthly_costs.保险"] = _src("manual", f"行业默认：售价 × {D['insurance_pct_annual']}% ÷ 12")
    sources["monthly_costs.水电"] = _src("manual", "行业默认：按面积档")

    rate = D["rehab_tiers"].get(tier, D["rehab_tiers"]["medium"])
    rehab_budget = (sqft or 0) * rate
    rehab_items = [{"category": cat, "label": cat, "amount": round(rehab_budget * share, -2), "note": None}
                   for cat, share in D["rehab_shares"].items()]
    tier_cn = {"light": "轻装", "medium": "中装", "heavy": "重装"}[tier]
    sources["rehab_items"] = _src("manual", f"行业默认：{tier_cn} ${rate}/sqft × {sqft or 0} sqft，按常见比例拆分；接入公司历史数据后替换")

    inputs = {
        "purchase_price": price,
        "purchase_extras": purchase_extras,
        "holding_months": D["holding_months"],
        "monthly_costs": monthly_costs,
        "financing": dict(D["financing"]),
        "rehab_items": rehab_items,
        "rehab_tier": tier,
        "selling_pct": D["selling_pct"],
        "selling_extras": [],
        "sale_price": sale,
        "target_margin_pct": D["target_margin_pct"],
        "sources": sources,
    }
    sources["holding_months"] = _src("manual", "行业默认 6 个月；接入公司历史工期后替换")
    sources["financing"] = _src("manual", "行业默认：首付 20%，7.0%，30 年；利率以后接美联储 FRED 公开数据")
    sources["selling_pct"] = _src("manual", f"行业默认：{D['selling_pct']}%（佣金 + 卖方过户）")
    return inputs
