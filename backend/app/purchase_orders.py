"""Typed order aggregate and conservative, local-only text extraction.

An import is always an editable suggestion, never a purchase / receipt fact.
Amounts use Decimal, including reconciliation; unknown is never zero.
"""
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Annotated, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

Money = Annotated[Decimal, Field(ge=0, le=9999999999, decimal_places=2, allow_inf_nan=False)]
Quantity = Annotated[Decimal, Field(gt=0, le=1000000, decimal_places=4, allow_inf_nan=False)]
Count = Annotated[Decimal, Field(ge=0, le=1000000, decimal_places=4, allow_inf_nan=False)]
Short = Annotated[str, Field(max_length=1000)]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OrderLine(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=36)
    material_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=500)
    specification: Short = ""
    brand: Short = ""
    vendor: Short = ""
    model: Short = ""
    color: Short = ""
    unit: str = Field(default="件", max_length=30)
    quantity: Quantity | None = None
    cancelled_quantity: Count = Decimal(0)
    unit_price: Money | None = None
    amount: Money | None = None
    product_url: HttpUrl | None = None
    image_url: HttpUrl | None = None
    expected_on: date | None = None
    needed_on: date | None = None
    location: Short = ""
    selection_note: Short = ""
    delivery_address: Short | None = None
    issue_note: Short = ""
    website_status: Literal["unknown", "not_shipped", "in_transit", "ready_pickup", "delivered", "exception"] = "unknown"
    tracking_url: HttpUrl | None = None


class Allocation(Record):
    line_id: str = Field(min_length=1, max_length=36)
    quantity: Quantity


class Delivery(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=36)
    label: str = Field(min_length=1, max_length=200)
    method: Literal["unknown", "shipping", "pickup", "scheduled"] = "unknown"
    replacement: bool = False
    allocations: list[Allocation] = Field(default_factory=list, max_length=200)
    destination: Literal["project", "company", "custom"] = "project"
    address: Short = ""
    contact: Short = ""
    store: Short = ""
    expected_on: date | None = None
    appointment: Short = ""
    carrier: Short = ""
    tracking_number: Short = ""
    tracking_url: HttpUrl | None = None
    website_status: Literal["unknown", "not_shipped", "in_transit", "ready_pickup", "delivered", "exception"] = "unknown"
    instructions: Short = ""


class ReceiptLine(Allocation):
    damaged_quantity: Count = Decimal(0)


class Receipt(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=36)
    delivery_id: str | None = None
    received_on: date
    location: str = Field(min_length=1, max_length=1000)
    lines: list[ReceiptLine] = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=5000)
    confirmed_by: int = 0
    confirmed_name: str = ""
    recorded_at: str = ""
    void_reason: Short = ""


class Adjustment(Record):
    id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=36)
    line_id: str
    returned_quantity: Count = Decimal(0)
    returned_usable_quantity: Count = Decimal(0)
    refund: Money | None = None
    occurred_on: date
    reason: str = Field(min_length=1, max_length=2000)


class OrderDocument(Record):
    title: Short = ""  # Optional buyer-facing name; vendor + order number remain the identity.
    vendor: str = Field(min_length=1, max_length=200)
    order_number: str = Field(min_length=1, max_length=200)
    seller: Short = ""
    purchasing_entity: Short = ""
    buyer_user_id: int | None = None
    ordered_on: date | None = None
    order_url: HttpUrl | None = None
    voucher_url: HttpUrl | None = None
    currency: Literal["USD"] = "USD"
    tax: Money | None = None
    shipping: Money | None = None
    discount: Money | None = None
    total: Money | None = None
    refunded: Money | None = None
    delivery_address: Short = ""
    reconciliation_note: Short = ""
    follow_up: str = Field(default="", max_length=5000)
    follow_up_on: date | None = None
    checked_on: date | None = None
    note: str = Field(default="", max_length=10000)
    lines: list[OrderLine] = Field(min_length=1, max_length=200)
    deliveries: list[Delivery] = Field(default_factory=list, max_length=200)
    receipts: list[Receipt] = Field(default_factory=list, max_length=1000)
    adjustments: list[Adjustment] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def consistent(self):
        for records in (self.lines, self.deliveries, self.receipts, self.adjustments):
            if len({r.id for r in records}) != len(records):
                raise ValueError("记录标识重复")
        lines = {r.id: r for r in self.lines}
        deliveries = {r.id: r for r in self.deliveries}
        allocated = defaultdict(Decimal)
        for delivery in self.deliveries:
            if len({a.line_id for a in delivery.allocations}) != len(delivery.allocations):
                raise ValueError("同一批次的商品请合并数量")
            for a in delivery.allocations:
                if a.line_id not in lines or lines[a.line_id].quantity is None:
                    raise ValueError("分配配送前请核对商品及订购数量")
                if not delivery.replacement:
                    allocated[a.line_id] += a.quantity
            if self.ordered_on and delivery.expected_on and delivery.expected_on < self.ordered_on:
                raise ValueError("预计到货不能早于下单日期")
        received = defaultdict(Decimal)
        good = defaultdict(Decimal)
        gross = defaultdict(Decimal)
        for receipt in self.receipts:
            if receipt.delivery_id is not None and receipt.delivery_id not in deliveries:
                raise ValueError("收货对应批次不存在")
            if receipt.void_reason:
                continue
            if self.ordered_on and receipt.received_on < self.ordered_on:
                raise ValueError("实际收货不能早于下单日期")
            if receipt.received_on > datetime.now(ZoneInfo("America/Los_Angeles")).date():
                raise ValueError("实际收货不能填写未来日期")
            if len({a.line_id for a in receipt.lines}) != len(receipt.lines):
                raise ValueError("本次收货商品重复")
            allocations = {a.line_id: a.quantity for a in deliveries[receipt.delivery_id].allocations} if receipt.delivery_id else {}
            for a in receipt.lines:
                if a.line_id not in lines or lines[a.line_id].quantity is None or (receipt.delivery_id and a.line_id not in allocations) or a.damaged_quantity > a.quantity:
                    raise ValueError("收货商品或破损数量不正确")
                received[(receipt.delivery_id, a.line_id)] += a.quantity
                if receipt.delivery_id and received[(receipt.delivery_id, a.line_id)] > allocations[a.line_id]:
                    raise ValueError("累计收货超过本批次分配数量")
                if receipt.delivery_id is None:
                    returned_before = sum((r.returned_usable_quantity for r in self.adjustments if r.line_id == a.line_id and r.occurred_on <= receipt.received_on), Decimal(0))
                    available = lines[a.line_id].quantity - lines[a.line_id].cancelled_quantity - good[a.line_id] + returned_before
                    if a.quantity > available:
                        raise ValueError("本次收货超过尚需补齐数量，请核对商品、破损或退货记录")
                gross[a.line_id] += a.quantity
                good[a.line_id] += a.quantity - a.damaged_quantity
        returned = defaultdict(Decimal)
        returned_good = defaultdict(Decimal)
        for adjustment in self.adjustments:
            if adjustment.line_id not in lines or adjustment.returned_usable_quantity > adjustment.returned_quantity:
                raise ValueError("退货商品或完好退货数量不正确")
            if adjustment.occurred_on > datetime.now(ZoneInfo("America/Los_Angeles")).date():
                raise ValueError("实际退货退款不能填写未来日期")
            returned[adjustment.line_id] += adjustment.returned_quantity
            returned_good[adjustment.line_id] += adjustment.returned_usable_quantity
        for line in self.lines:
            if self.ordered_on and line.expected_on and line.expected_on < self.ordered_on:
                raise ValueError("预计到货不能早于下单日期")
            if returned[line.id] > gross[line.id] or returned_good[line.id] > good[line.id]:
                raise ValueError("退货数量超过已收货数量")
            if returned[line.id] - returned_good[line.id] > gross[line.id] - good[line.id]:
                raise ValueError("破损退货数量超过已登记破损数量")
            if line.quantity is None:
                if line.cancelled_quantity:
                    raise ValueError("取消前请核对订购数量")
                continue
            if line.cancelled_quantity > line.quantity or allocated[line.id] > line.quantity:
                raise ValueError("取消或配送分配数量超过订购数量")
            if good[line.id] - returned_good[line.id] > line.quantity - line.cancelled_quantity:
                raise ValueError("完好实收超过有效订购数量，请核对补发或取消")
        legacy_refund = sum((a.refund or Decimal(0) for a in self.adjustments), Decimal(0))
        if self.refunded is not None and self.refunded < legacy_refund:
            raise ValueError("累计退款不能少于已有退款记录")
        if self.total is not None and (self.refunded if self.refunded is not None else legacy_refund) > self.total:
            raise ValueError("累计退款不能超过订单实付")
        return self


def order_label(doc: OrderDocument) -> str:
    """Title when the buyer gave one; otherwise merchant and order number."""
    return doc.title.strip() or f"{doc.vendor} {doc.order_number}"


def order_summary(doc: OrderDocument) -> dict:
    received, damaged, returned, returned_good = (defaultdict(Decimal) for _ in range(4))
    for r in doc.receipts:
        if not r.void_reason:
            for a in r.lines:
                received[a.line_id] += a.quantity
                damaged[a.line_id] += a.damaged_quantity
    for a in doc.adjustments:
        returned[a.line_id] += a.returned_quantity
        returned_good[a.line_id] += a.returned_usable_quantity
    rows, amounts = [], []
    missing = []
    if not doc.ordered_on: missing.append("下单日期")

    for line in doc.lines:
        amount = line.amount
        if amount is None and line.quantity is not None and line.unit_price is not None:
            amount = (line.quantity * line.unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        amounts.append(amount)
        usable = received[line.id] - damaged[line.id] - returned_good[line.id]
        remaining = None if line.quantity is None else max(Decimal(0), line.quantity - line.cancelled_quantity - usable)
        rows.append({"id": line.id, "material_id": line.material_id, "name": line.name,
                     "quantity": line.quantity, "received": received[line.id], "damaged": damaged[line.id],
                     "returned": returned[line.id], "usable": usable, "remaining": remaining, "amount": amount})
        if line.quantity is None: missing.append(f"{line.name}：数量")
        if amount is None: missing.append(f"{line.name}：金额")
        if line.material_id is None: missing.append(f"{line.name}：采购表关联")
    subtotal = sum(amounts, Decimal(0)) if all(a is not None for a in amounts) else None
    for field, label in (("total", "订单实付"),):
        if getattr(doc, field) is None: missing.append(label)
    calculated = None
    if subtotal is not None and all(v is not None for v in (doc.tax, doc.shipping, doc.discount)):
        calculated = subtotal + doc.tax + doc.shipping - doc.discount
    difference = None if calculated is None or doc.total is None else doc.total - calculated
    refund_values = [a.refund for a in doc.adjustments if a.refund is not None]
    return {"lines": rows, "subtotal": subtotal, "calculated_total": calculated, "difference": difference,
            "refund": doc.refunded if doc.refunded is not None else sum(refund_values, Decimal(0)), "missing": missing,
            "complete": all(r["remaining"] == 0 for r in rows),
            "attention": bool(doc.follow_up or difference or any(d.website_status == "exception" for d in doc.deliveries) or any(l.issue_note or l.website_status == "exception" for l in doc.lines))}


def vendor_key(value: str) -> str:
    key = re.sub(r"[^\w]", "", value.casefold())
    return {"thehomedepot": "homedepot", "homedepotcom": "homedepot", "amazoncom": "amazon", "wayfaircom": "wayfair"}.get(key, key)


def parse_order_text(source: str) -> dict:
    """Only extract labelled values. Unrecognised text remains visible verbatim.

    No URL fetches, no LLM, and no inferred shipping / receipt transitions.
    Suggested item blocks require an explicit quantity marker to avoid ads.
    """
    lines = [s.strip() for s in source.splitlines() if s.strip()]
    draft: dict = {"vendor": "", "order_number": "", "lines": []}
    evidence = []
    patterns = {
        "vendor": r"^(?:vendor|retailer|商家)\s*[:：]\s*(.+)$",
        "order_number": r"^(?:order\s*(?:number|no\.?|#)|订单号)\s*[:：#]?\s*([\w-]+)$",
        "ordered_on": r"^(?:order date|ordered on|下单日期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})$",
        "total": r"^(?:order total|grand total|订单总额|total)\s*[:：]?\s*\$?([\d,]+\.\d{2})$",
        "tax": r"^(?:sales tax|tax|税费)\s*[:：]?\s*\$?([\d,]+\.\d{2})$",
        "shipping": r"^(?:shipping|shipping cost|运费)\s*[:：]?\s*\$?([\d,]+\.\d{2})$",
        "discount": r"^(?:discount|折扣)\s*[:：]?\s*-?\$?([\d,]+\.\d{2})$",
    }
    used = set()
    for index, line in enumerate(lines):
        for field, pattern in patterns.items():
            match = re.match(pattern, line, re.I)
            if match and field not in used:
                value = match.group(1)
                if field in ("total", "tax", "shipping", "discount"): value = value.replace(",", "")
                if field == "ordered_on":
                    try: date.fromisoformat(value)
                    except ValueError: continue
                draft[field] = value
                used.add(field); evidence.append({"field": field, "text": line})
        if not draft["vendor"]:
            for pattern, name in ((r"\bhome\s*depot\b", "Home Depot"), (r"\bamazon(?:\.com)?\b", "Amazon"), (r"\bwayfair(?:\.com)?\b", "Wayfair")):
                if re.search(pattern, line, re.I):
                    draft["vendor"] = name; evidence.append({"field": "vendor", "text": line}); break
        qty = re.match(r"^(?:qty|quantity|数量)\s*[:：]?\s*(\d+(?:\.\d+)?)$", line, re.I)
        if qty and index:
            name = re.sub(r"^(?:item|product|商品)\s*[:：]\s*", "", lines[index - 1], flags=re.I)
            if len(name) > 500 or re.match(r"^(?:\$|total|tax|order|shipping|qty|数量)", name, re.I): continue
            row = {"id": str(uuid4()), "name": name, "quantity": qty.group(1)}
            for following in lines[index + 1:index + 4]:
                match = re.match(r"^(unit price|单价|item total|商品小计)\s*[:：]?\s*\$?([\d,]+\.\d{2})$", following, re.I)
                if match: row["unit_price" if match.group(1).lower() in ("unit price", "单价") else "amount"] = match.group(2).replace(",", "")
                elif re.match(r"^(?:qty|quantity|数量)\b", following, re.I): break
            draft["lines"].append(row)
            evidence.append({"field": f"lines.{len(draft['lines']) - 1}", "text": f"{lines[index - 1]}\n{line}"})
    warnings = ["识别结果只是草稿，请对照原文逐项核对；未识别的图片、链接、规格、地址和日期需补充。",
                "网站或邮件中的送达信息不会写入实际收货。"]
    if not draft["lines"]: warnings.append("未找到可可靠识别的商品块，请在下方添加商品；原文已完整保留。")
    if re.search(r"\b(shipped|delivered|cancelled|canceled|refund)\b|已发货|已送达|退款|取消", source, re.I):
        warnings.append("这可能是订单更新邮件。请先选择已有订单核对，勿重复建单；配送和收货需单独登记。")
    return {"draft": draft, "evidence": evidence, "warnings": warnings}
