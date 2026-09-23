"""示例数据：8 个项目覆盖全部阶段，含备注、风险、业主、支出、文件、交易分析、多来源冲突。
运行：删除 data/app.db 后启动后端自动执行，或 python -m app.seed
"""

import json
import random
from datetime import date, timedelta

from sqlalchemy.orm import Session

from . import models
from .analysis import build_prefill, full_outputs
from .db import SessionLocal, UPLOAD_DIR, init_db
from .dictionaries import FILE_DEFAULT_OWNER
from .providers.mock import BUILTIN, MockProvider
from .routers.common import set_field_with_source

# 1×1 灰色 PNG，占位照片
TINY_PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636060f8cf0000020100010bd0de590000000049454e44ae426082")
TINY_PDF = (b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")

VENDORS = {
    "拆除": "KC Demo LLC", "结构": "Foundation Masters", "屋顶": "Apex Roofing", "外立面": "Heartland Siding",
    "门窗": "Window World KC", "电": "Bright Electric", "水": "Flow Plumbing", "暖通": "Comfort Air",
    "保温与干墙": "Drywall KC", "地板": "Floor & Decor", "厨房": "Home Depot", "卫浴": "Tile Pros",
    "油漆": "ProPaint", "景观": "GreenScape", "许可与设计": "Platte County", "持有成本": "Evergy",
    "成交成本": "Title Co.", "应急": "杂项", "材料杂项": "Lowe's", "其他": "杂项",
}

T = date.today()

from .dictionaries import FILE_TYPES, STAGE_CHECKLIST  # noqa: E402
FILE_LABEL = {t["value"]: t["label"] for t in FILE_TYPES}
STEP_TITLE = {it["key"]: it["title"] for st in STAGE_CHECKLIST for it in st["items"]}


def d(days: int) -> str:
    return (T + timedelta(days=days)).isoformat()


# ---------------- 基础构造 ----------------

def _create_property(db: Session, provider: MockProvider, label: str) -> tuple[models.Property, dict]:
    r = provider.lookup(label)
    prop = models.Property(address_std=r.address.label, street=r.address.street, city=r.address.city,
                           state=r.address.state, zip=r.address.zip, lat=r.address.lat, lng=r.address.lng, apn=r.apn)
    db.add(prop)
    db.flush()
    for f in r.fields:
        set_field_with_source(db, prop, f.field, f.value, f.source, f.confidence, f.note, make_primary=True)
    if r.owner:
        db.add(models.Owner(property_id=prop.id, **r.owner))
    for m in r.mortgages:
        db.add(models.Mortgage(property_id=prop.id, **m))
    for s in r.sales_history:
        db.add(models.SalesHistory(property_id=prop.id, **s))
    db.flush()
    return prop, {"avm": r.valuation.avm_value, "tax": r.valuation.annual_tax, "list": r.valuation.list_price}


def _owner_contact(prop: models.Property, phone: str, email: str) -> None:
    if prop.owner:
        prop.owner.phone = phone
        prop.owner.email = email


def _conflict(db: Session, prop: models.Property, field: str, lark_value: str, note: str) -> None:
    """制造一个 Lark 来源的不同值（非主值），展示多来源冲突。"""
    set_field_with_source(db, prop, field, lark_value, "lark", 0.6, note, make_primary=False)


def _budget(db: Session, pid: int, lines: dict[str, float]) -> None:
    for cat, amt in lines.items():
        db.add(models.BudgetLine(project_id=pid, category=cat, planned_amount=amt))


def _expenses(db: Session, pid: int, rnd: random.Random, spent: dict[str, float], start: str, end: str) -> None:
    """把每类支出拆成 2–4 笔，日期分布在 start–end 之间。"""
    s = date.fromisoformat(start)
    e = min(date.fromisoformat(end), T)
    span = max(1, (e - s).days)
    for cat, amt in spent.items():
        parts = rnd.choice([2, 3, 3, 4])
        remain = amt
        for k in range(parts):
            part = round(remain / (parts - k), 2) if k < parts - 1 else round(remain, 2)
            remain -= part
            day = s + timedelta(days=int(span * (k + rnd.random()) / parts))
            note = "变更单：现场增项" if (cat == "结构" and k == parts - 1) else None
            db.add(models.Expense(project_id=pid, category=cat, amount=part, vendor=VENDORS.get(cat, "杂项"),
                                  date=day.isoformat(), note=note))


def _file(db: Session, pid: int, name: str, doc_type: str, stage: str, doc_date: str,
          counterparty: str | None = None, amount: float | None = None, source: str = "lark", mime: str = "application/pdf",
          uploaded_by: str | None = None, expires_at: str | None = None, step_key: str | None = None):
    folder = UPLOAD_DIR / str(pid)
    folder.mkdir(parents=True, exist_ok=True)
    who = uploaded_by or FILE_DEFAULT_OWNER.get(doc_type, "负责人")
    rec = models.ProjectFile(project_id=pid, filename=name, stored_path="", mime=mime, doc_type=doc_type, stage=stage,
                             doc_date=doc_date, counterparty=counterparty, amount=amount, source=source, uploaded_by=who,
                             expires_at=expires_at, step_key=step_key)
    db.add(rec)
    db.flush()
    path = folder / f"{rec.id}_{name}"
    body = TINY_PNG if mime.startswith("image/") else TINY_PDF
    path.write_bytes(body)
    rec.stored_path = str(path)
    rec.size = len(body)
    db.add(models.ProjectUpdate(project_id=pid, actor=who, kind="file", text=f"上传了{FILE_LABEL.get(doc_type, '文件')}：{name}",
                                created_at=f"{doc_date}T09:{rnd_minute(name):02d}:00"))


def rnd_minute(seed_text: str) -> int:
    return sum(ord(c) for c in seed_text) % 60


def _step(db: Session, pid: int, key: str, who: str, days_ago: int, note: str | None = None) -> None:
    """手动打勾的清单项 + 一条更新记录。"""
    when = f"{d(-days_ago)}T10:{rnd_minute(key + str(pid)):02d}:00"
    base = key.split(":")[0]
    db.add(models.ProjectStep(project_id=pid, key=key, done=True, done_by=who, done_at=when, note=note))
    verb = "确认了" if ":" in key else "完成了"
    db.add(models.ProjectUpdate(project_id=pid, actor=who, kind="step", text=f"{verb}“{STEP_TITLE[base]}”" + (f"：{note}" if note else ""), created_at=when))


def _photo(db: Session, pid: int, step_key: str, label: str, days_ago: int, who: str, n: int = 1) -> None:
    """挂在某一步上的现场照片（占位图），有它这一步自动打勾。"""
    for i in range(n):
        _file(db, pid, f"{label}_{i + 1}.png", "photo", "通用", d(-days_ago), mime="image/png", uploaded_by=who, step_key=step_key, source="upload")


def _gate(db: Session, pid: int, key: str, days_ago: int) -> None:
    """大节点：D 和 J 各确认一次（J 晚半天）。"""
    _step(db, pid, f"{key}:D", "D", days_ago)
    _step(db, pid, f"{key}:J", "J", days_ago)


def _utilities(db: Session, pid: int, status: str, who_name: str, days_ago: int, blocker_gas: str | None = None) -> None:
    """水、电、瓦斯三家账户。"""
    rows = [("water", "KC Water", "W-" + str(pid) + "4471"), ("electric", "Evergy", "E-" + str(pid) + "20955"), ("gas", "Spire", "G-" + str(pid) + "7830")]
    when = f"{d(-days_ago)}T11:{rnd_minute(str(pid)):02d}:00"
    for kind, company, acct in rows:
        st = status
        blocker = None
        if kind == "gas" and blocker_gas:
            st = "pending"; blocker = blocker_gas
        db.add(models.UtilityAccount(project_id=pid, kind=kind, company=company, account_no=acct, login="flipco@example.com",
                                     password="••••", opened_under=who_name, status=st, blocker=blocker, updated_by="K", updated_at=when))
    db.add(models.ProjectUpdate(project_id=pid, actor="K", kind="utility", text=f"填了水电瓦斯账户（用 {who_name} 的名字开的）" + (f"，瓦斯卡在：{blocker_gas}" if blocker_gas else ""), created_at=when))


def _inspection(db: Session, pid: int, name: str, days_ago: int, result: str, is_final: bool = False, fixer: str | None = None, note: str | None = None) -> None:
    when = f"{d(-days_ago)}T14:{rnd_minute(name + str(pid)):02d}:00"
    db.add(models.Inspection(project_id=pid, name=name, date=d(-days_ago), result=result, is_final=is_final, fixer=fixer, note=note, recorded_by="Z", created_at=when))
    label = {"scheduled": "已约", "passed": "通过", "failed": "没过，整改中"}[result]
    db.add(models.ProjectUpdate(project_id=pid, actor="Z", kind="inspection", text=f"记了一次检查：{name} · {label}" + ("（final）" if is_final else ""), created_at=when))


def _analysis(db: Session, pr: models.Project, prop: models.Property, val: dict, name: str, *, tier: str,
              purchase: float | None, sale: float | None, months: int | None = None, overrides: dict | None = None,
              current: bool = True, note: str | None = None) -> None:
    inputs = build_prefill(sqft=prop.sqft, avm_value=val["avm"], list_price=val["list"], annual_tax=val["tax"],
                           purchase_price=purchase, target_arv=sale, tier=tier)
    if months:
        inputs["holding_months"] = months
    if overrides:
        inputs.update(overrides)
    if note:
        inputs["note"] = note
    db.add(models.DealAnalysis(project_id=pr.id, name=name, inputs_json=json.dumps(inputs, ensure_ascii=False),
                               outputs_json=json.dumps(full_outputs(inputs), ensure_ascii=False), is_current=current))


def _buy_files(db, pid, buy_day: int, seller: str, price: float, inspector="Midwest Home Inspection"):
    _file(db, pid, f"购房合同_{d(buy_day-20)}.pdf", "purchase_contract", "买入", d(buy_day - 20), seller, price)
    _file(db, pid, f"检验报告_{inspector}.pdf", "inspection", "买入", d(buy_day - 14), inspector)
    _file(db, pid, f"产权报告_{d(buy_day-7)}.pdf", "title_report", "买入", d(buy_day - 7), "Title Co.")
    _file(db, pid, f"结算单_{d(buy_day)}.pdf", "closing_statement", "买入", d(buy_day), "Title Co.", round(price * 1.02, -2))


# ---------------- 主流程 ----------------

def seed(db: Session) -> None:
    provider = MockProvider()
    rnd = random.Random(20260908)
    L = [b.label for b in BUILTIN]

    # ===== 1. 在建 · 正常 · NW Fisk Ave =====
    p1, v1 = _create_property(db, provider, L[0])
    _owner_contact(p1, "(816) 555-0142", "tshort@example.com")
    pr1 = models.Project(property_id=p1.id, name="NW Fisk Ave 翻新", strategy="flip", stage="active", substage="construction",
                         purchase_price=185000, target_arv=325000,
                         purchase_date=d(-75), construction_start=d(-60), construction_end=d(45),
                         risks="屋顶两处渗水点，已在预算中计入整体更换。\n后院有一棵老橡树靡邻界线，砍伐需邻居同意。",
                         notes="1974 年错层住宅，原业主自住 12 年，内部保养一般但结构完好。定位：改开放式厨房 + 主卧套间，面向首次购房家庭。目标 45 天内完工挂牌。")
    db.add(pr1); db.flush()
    _budget(db, pr1.id, {"拆除": 6000, "屋顶": 14000, "厨房": 22000, "卫浴": 16000, "地板": 9000, "油漆": 6500,
                         "电": 7000, "水": 5500, "门窗": 8000, "景观": 3500, "许可与设计": 1800, "应急": 8000, "持有成本": 6000})
    _expenses(db, pr1.id, rnd, {"拆除": 5800, "屋顶": 13500, "厨房": 9800, "电": 3200, "水": 2100, "门窗": 4100,
                                "许可与设计": 1800, "持有成本": 2400}, d(-60), d(0))
    _buy_files(db, pr1.id, -75, "卖方 Short, Travis A", 185000)
    _file(db, pr1.id, "屋顶承包合同_Apex.pdf", "contractor_contract", "施工", d(-55), "Apex Roofing", 14000)
    _file(db, pr1.id, "屋顶发票_Apex_1.pdf", "invoice", "施工", d(-30), "Apex Roofing", 13500)
    _file(db, pr1.id, "厨房橱柜报价_HomeDepot.pdf", "invoice", "施工", d(-12), "Home Depot", 9800)
    _file(db, pr1.id, "房屋保险单_StateFarm.pdf", "insurance", "通用", d(-58), "State Farm", expires_at=d(12))
    _file(db, pr1.id, "贷款文件_签署版.pdf", "loan_doc", "买入", d(-72), "Heartland Bank", uploaded_by="D")
    _file(db, pr1.id, "设计方案_v2.pdf", "drawing", "施工", d(-64), uploaded_by="设计师")
    _file(db, pr1.id, "框架检查_通过.pdf", "inspection_report", "施工", d(-20), "Platte County", uploaded_by="Z")
    _file(db, pr1.id, "施工许可证_KCMO.pdf", "permit", "施工", d(-52), "KC Building Dept", uploaded_by="Z")
    _file(db, pr1.id, "permit申请回执_KCMO.pdf", "permit_application", "施工", d(-61), "KC Building Dept", uploaded_by="Z")
    _file(db, pr1.id, "量尺记录_1720sqft.pdf", "measure_note", "买入", d(-68), uploaded_by="L")
    _file(db, pr1.id, "设计定稿_v2.pdf", "drawing_final", "施工", d(-62), uploaded_by="设计师")
    _photo(db, pr1.id, "view", "看房", 100, "L", 3)
    _photo(db, pr1.id, "prep_work", "清理拆除", 60, "PM", 2)
    _photo(db, pr1.id, "progress", "进度", 10, "PM", 4)
    _file(db, pr1.id, "厨房总包合同_HomeDepot.pdf", "contractor_contract", "施工", d(-40), "Home Depot", 22000)
    _file(db, pr1.id, "变更单_屋顶加固.pdf", "change_order", "施工", d(-26), "Apex Roofing", 1500)
    for row in (("view", "L", 100), ("measure", "L", 68), ("design_final", "设计师", 62, "定稿 v2：开放式厨房，保留壁炉"), ("permit_apply", "Z", 61),
                ("prep_work", "PM", 60, "清理和拆旧橱柜三天完成"), ("progress", "PM", 10, "屋顶完工，厨房水电走线中"), ("agent", "J", 8)):
        _step(db, pr1.id, *row)
    _gate(db, pr1.id, "open_escrow", 92)
    _gate(db, pr1.id, "close_escrow", 75)
    _gate(db, pr1.id, "start", 50)
    _utilities(db, pr1.id, "on", "David", 60)
    _inspection(db, pr1.id, "框架检查", 20, "passed")
    _inspection(db, pr1.id, "屋顶检查", 14, "passed")
    _inspection(db, pr1.id, "水电粗装检查", -5, "scheduled", note="师傅说下周走完线约")
    _analysis(db, pr1, p1, v1, "买前分析", tier="medium", purchase=185000, sale=325000, months=5, current=True)

    # ===== 2. 在建 · 落后 · Parkville =====
    p2, v2 = _create_property(db, provider, L[1])
    _owner_contact(p2, "(816) 555-0198", "d.robertson@example.com")
    _conflict(db, p2, "sqft", str((p2.sqft or 2000) + 180), "Lark 表里录的是含车库面积")
    pr2 = models.Project(property_id=p2.id, name="Parkville 57th Terr", strategy="flip", stage="active", substage="construction",
                         purchase_price=210000, target_arv=340000,
                         purchase_date=d(-160), construction_start=d(-140), construction_end=d(-12), list_date=None,
                         risks="暖通承包商延期两周。\n县许可证复检未通过一次（管道走向），已整改待复检。",
                         notes="两层住宅，学区好。原计划 4 个月完工，暖通与许可证问题导致落后。挂牌目标改为下月初。")
    db.add(pr2); db.flush()
    _budget(db, pr2.id, {"拆除": 5000, "暖通": 12000, "厨房": 18000, "卫浴": 14000, "地板": 8000, "油漆": 6000,
                         "保温与干墙": 7000, "许可与设计": 2500, "外立面": 4000, "应急": 7000, "持有成本": 9000})
    _expenses(db, pr2.id, rnd, {"拆除": 5200, "暖通": 11800, "厨房": 16500, "卫浴": 12000, "地板": 7600, "油漆": 5400,
                                "保温与干墙": 6900, "许可与设计": 2500, "外立面": 3900, "持有成本": 8100}, d(-140), d(0))
    _buy_files(db, pr2.id, -160, "卖方 Robertson", 210000)
    _file(db, pr2.id, "施工许可证_Platte.pdf", "permit", "施工", d(-130), "Platte County")
    _file(db, pr2.id, "暖通合同_ComfortAir.pdf", "contractor_contract", "施工", d(-120), "Comfort Air", 12000)
    _file(db, pr2.id, "变更单_暖通管道改线.pdf", "change_order", "施工", d(-40), "Comfort Air", 1800)
    _file(db, pr2.id, "许可证复检通知.pdf", "permit", "施工", d(-18), "Platte County")
    _file(db, pr2.id, "设计方案_终稿.pdf", "drawing", "施工", d(-140), uploaded_by="设计师")
    for k, who, ago in (("view", "L", 175), ("measure", "L", 150), ("design_final", "设计师", 140), ("permit_apply", "Z", 138), ("agent", "J", 30)):
        _step(db, pr2.id, k, who, ago)
    _gate(db, pr2.id, "open_escrow", 168)
    _gate(db, pr2.id, "close_escrow", 160)
    _gate(db, pr2.id, "start", 140)
    _file(db, pr2.id, "permit申请回执_Platte.pdf", "permit_application", "施工", d(-138), "Platte County", uploaded_by="Z")
    _photo(db, pr2.id, "progress", "进度", 25, "PM", 2)
    _utilities(db, pr2.id, "on", "Jessie", 145)
    _inspection(db, pr2.id, "框架检查", 90, "passed")
    _inspection(db, pr2.id, "水电检查（管道走向）", 18, "failed", fixer="PM + Comfort Air", note="管道走向与图不符，改线后复检")
    _inspection(db, pr2.id, "水电复检", -3, "scheduled")
    _analysis(db, pr2, p2, v2, "买前分析", tier="medium", purchase=210000, sale=340000, months=4, current=True)

    # ===== 3. 在建 · 有风险（超支）· NE 43rd =====
    p3, v3 = _create_property(db, provider, L[2])
    _owner_contact(p3, "(816) 555-0131", None)
    pr3 = models.Project(property_id=p3.id, name="NE 43rd St", strategy="flip", stage="active", substage="construction",
                         purchase_price=142000, target_arv=255000,
                         purchase_date=d(-100), construction_start=d(-80), construction_end=d(20),
                         risks="地基西侧沉降，工程量比检验报告估计多一倍；已超预算。\n若再有增项，考虑降低厨房档次保住利润。",
                         notes="单层砖房，买入价低是因为地基问题。结构类支出已超预算 1.9 万，其余类别基本在控。")
    db.add(pr3); db.flush()
    _budget(db, pr3.id, {"拆除": 4500, "结构": 12000, "厨房": 15000, "卫浴": 11000, "地板": 7000, "油漆": 5000,
                         "电": 6000, "应急": 6000, "持有成本": 5000})
    _expenses(db, pr3.id, rnd, {"拆除": 4700, "结构": 31000, "厨房": 14200, "卫浴": 9800, "电": 6400, "地板": 6900,
                                "持有成本": 4200}, d(-80), d(0))
    _buy_files(db, pr3.id, -100, "卖方 Nguyen", 142000, inspector="Foundation Masters")
    _file(db, pr3.id, "地基工程合同_FoundationMasters.pdf", "contractor_contract", "施工", d(-70), "Foundation Masters", 28000)
    _file(db, pr3.id, "地基发票_1.pdf", "invoice", "施工", d(-45), "Foundation Masters", 18000)
    _file(db, pr3.id, "地基发票_2.pdf", "invoice", "施工", d(-15), "Foundation Masters", 13000)
    _file(db, pr3.id, "变更单_地基西侧加桩.pdf", "change_order", "施工", d(-30), "Foundation Masters", 12000)
    _file(db, pr3.id, "设计方案_v1.pdf", "drawing", "施工", d(-85), uploaded_by="设计师")
    _file(db, pr3.id, "地基检查_通过.pdf", "inspection_report", "施工", d(-25), "KC Building Dept", uploaded_by="Z")
    for k, who, ago in (("view", "L", 115), ("measure", "L", 90), ("design_final", "设计师", 84), ("permit_apply", "Z", 82)):
        _step(db, pr3.id, k, who, ago)
    _gate(db, pr3.id, "open_escrow", 108)
    _gate(db, pr3.id, "close_escrow", 100)
    _gate(db, pr3.id, "start", 80)
    _utilities(db, pr3.id, "on", "David", 88, blocker_gas="Spire 要房主到场验表，约了下周")
    _inspection(db, pr3.id, "地基检查", 25, "passed")
    _analysis(db, pr3, p3, v3, "买前分析", tier="medium", purchase=142000, sale=255000, months=4, current=True)

    # ===== 4. 线索 · 热 · 待成交 · The Bat House =====
    p4, v4 = _create_property(db, provider, L[3])
    _owner_contact(p4, "(816) 555-0177", "travis.short@example.com")
    pr4 = models.Project(property_id=p4.id, name="The Bat House", strategy="flip", stage="lead", substage="pending",
                         lead_heat="hot_lead", target_arv=298000,
                         risks="地基状况一般，需专业检验后再定最终出价。\n阁楼有蝙蝠痕迹，需清理与封堵（约 $2,500）。",
                         notes="业主已接受口头报价 $172,000，等检验结果。挂牌价 $189,000，业主高净值权益、急售。")
    db.add(pr4); db.flush()
    _file(db, pr4.id, "报价单_172k.pdf", "other", "通用", d(-3), "业主 Short", 172000, source="upload")
    _file(db, pr4.id, "初步检验预约确认.pdf", "inspection", "买入", d(-1), "Midwest Home Inspection", source="upload")
    _analysis(db, pr4, p4, v4, "分析 1：中装", tier="medium", purchase=172000, sale=298000, months=5, current=False)
    _analysis(db, pr4, p4, v4, "分析 2：轻装保利润", tier="light", purchase=172000, sale=285000, months=4, current=True)

    # ===== 5. 线索 · 温 · 联系卖家 · Shawnee =====
    p5, v5 = _create_property(db, provider, L[4])
    pr5 = models.Project(property_id=p5.id, name="Shawnee W 64th St", strategy="flip", stage="lead", substage="contacting",
                         lead_heat="warm_lead",
                         notes="邮件营销回复的线索，业主外州持有、房屋空置。已留言两次未回。")
    db.add(pr5); db.flush()
    _analysis(db, pr5, p5, v5, "粗算", tier="medium", purchase=None, sale=None, current=True)

    # ===== 6. 已完成 · N Walnut =====
    p6, v6 = _create_property(db, provider, L[5])
    _conflict(db, p6, "beds", "4", "Lark 记录含地下室卧室；公共记录按地上计")
    pr6 = models.Project(property_id=p6.id, name="N Walnut St 已售", strategy="flip", stage="portfolio", substage="sold",
                         purchase_price=128000, target_arv=235000, sale_price=241000,
                         purchase_date=d(-300), construction_start=d(-280), construction_end=d(-170), list_date=d(-160), sale_date=d(-118),
                         notes="公司 2026 年第一套完工项目。实际成交高于目标 $6,000，工期 110 天，挂牌 42 天成交。厨房与卫浴投入最见效。",
                         risks="无遗留风险。")
    db.add(pr6); db.flush()
    _budget(db, pr6.id, {"拆除": 4000, "厨房": 16000, "卫浴": 12000, "地板": 7500, "油漆": 5500, "屋顶": 9000,
                         "电": 4500, "景观": 3000, "持有成本": 7000, "成交成本": 14000})
    _expenses(db, pr6.id, rnd, {"拆除": 3900, "厨房": 15600, "卫浴": 12300, "地板": 7100, "油漆": 5200, "屋顶": 9400,
                                "电": 4300, "景观": 2800, "持有成本": 6600, "成交成本": 14460}, d(-280), d(-118))
    _buy_files(db, pr6.id, -300, "卖方 Garcia", 128000)
    _file(db, pr6.id, "施工许可证.pdf", "permit", "施工", d(-275), "Clay County")
    _file(db, pr6.id, "屋顶发票_Apex.pdf", "invoice", "施工", d(-230), "Apex Roofing", 9400)
    _file(db, pr6.id, "挂牌协议_KW.pdf", "listing_agreement", "卖出", d(-160), "Keller Williams")
    _file(db, pr6.id, "成交结算单.pdf", "sale_closing", "卖出", d(-118), "Title Co.", 241000)
    _file(db, pr6.id, "项目利润报表.docx", "report", "通用", d(-110), mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    _file(db, pr6.id, "贷款文件.pdf", "loan_doc", "买入", d(-300), uploaded_by="D")
    _file(db, pr6.id, "房屋保险单.pdf", "insurance", "通用", d(-305), "State Farm", uploaded_by="K", expires_at=d(60))
    _file(db, pr6.id, "设计方案.pdf", "drawing", "施工", d(-290), uploaded_by="设计师")
    _file(db, pr6.id, "终检_通过.pdf", "inspection_report", "施工", d(-170), "Clay County", uploaded_by="Z")
    _file(db, pr6.id, "卖方披露.pdf", "seller_disclosure", "卖出", d(-150), uploaded_by="K")
    _file(db, pr6.id, "量尺记录.pdf", "measure_note", "买入", d(-300), uploaded_by="L")
    _file(db, pr6.id, "设计定稿.pdf", "drawing_final", "施工", d(-285), uploaded_by="设计师")
    _file(db, pr6.id, "permit申请回执.pdf", "permit_application", "施工", d(-283), "Clay County", uploaded_by="Z")
    _file(db, pr6.id, "买家offer_241k.pdf", "offer", "卖出", d(-150), "买家 Miller", 241000, uploaded_by="J")
    _file(db, pr6.id, "卖房文件包.pdf", "sale_docs", "卖出", d(-140), "Title Co.", uploaded_by="S")
    _file(db, pr6.id, "签署版卖房文件.pdf", "sale_signed", "卖出", d(-120), "Title Co.", uploaded_by="D")
    _photo(db, pr6.id, "view", "看房", 330, "L", 2)
    _photo(db, pr6.id, "progress", "进度", 220, "PM", 3)
    _photo(db, pr6.id, "staging", "staging", 165, "J", 3)
    _photo(db, pr6.id, "mow", "剪草后", 158, "园丁", 1)
    for k, who, ago in (("view", "L", 330), ("measure", "L", 300), ("design_final", "设计师", 285), ("permit_apply", "Z", 283), ("prep_work", "PM", 282),
                        ("progress", "PM", 200), ("agent", "J", 200), ("staging", "J", 165), ("mow", "A", 158), ("sign", "D", 120)):
        _step(db, pr6.id, k, who, ago)
    for g, ago in (("open_escrow", 322), ("close_escrow", 300), ("start", 280), ("final", 170), ("offer", 150), ("closed", 118)):
        _gate(db, pr6.id, g, ago)
    _utilities(db, pr6.id, "off", "David", 115)
    _inspection(db, pr6.id, "框架检查", 240, "passed")
    _inspection(db, pr6.id, "水电检查", 205, "passed")
    _inspection(db, pr6.id, "final 检查", 170, "passed", is_final=True)
    _analysis(db, pr6, p6, v6, "买前分析", tier="medium", purchase=128000, sale=235000, months=5, current=False)
    _analysis(db, pr6, p6, v6, "复盘：实际值", tier="medium", purchase=128000, sale=241000, months=6, current=True,
              overrides={"rehab_items": [{"category": c, "label": c, "amount": a, "note": "实际支出"} for c, a in
                         {"拆除": 3900, "厨房": 15600, "卫浴": 12300, "地板": 7100, "油漆": 5200, "屋顶": 9400, "电": 4300, "景观": 2800}.items()]},
              note="用实际支出与成交价复盘，与“买前分析”对照看估算误差")

    # ===== 7. 已完成 · LA Alvarado（第二套完工，加州）=====
    p7, v7 = _create_property(db, provider, L[6])
    pr7 = models.Project(property_id=p7.id, name="Alvarado Terrace 已售", strategy="flip", stage="portfolio", substage="sold",
                         purchase_price=760000, target_arv=1150000, sale_price=1120000,
                         purchase_date=d(-420), construction_start=d(-400), construction_end=d(-250), list_date=d(-240), sale_date=d(-195),
                         notes="洛杉矶西班牙复兴风格。保留拱门与瓦顶，重做厨房与两间卫浴，加装中央空调。成交略低于目标，利率上行期挂牌 45 天。",
                         risks="无。")
    db.add(pr7); db.flush()
    _budget(db, pr7.id, {"拆除": 12000, "厨房": 55000, "卫浴": 38000, "地板": 22000, "油漆": 14000, "暖通": 24000,
                         "电": 16000, "水": 12000, "外立面": 18000, "景观": 9000, "许可与设计": 8500, "持有成本": 42000, "成交成本": 62000})
    _expenses(db, pr7.id, rnd, {"拆除": 11800, "厨房": 58900, "卫浴": 36500, "地板": 21200, "油漆": 13600, "暖通": 26400,
                                "电": 15200, "水": 12900, "外立面": 17400, "景观": 8200, "许可与设计": 8500, "持有成本": 44800, "成交成本": 61600}, d(-400), d(-195))
    _buy_files(db, pr7.id, -420, "卖方 Lopez Family Trust", 760000, inspector="LA Home Inspectors")
    _file(db, pr7.id, "施工许可证_LADBS.pdf", "permit", "施工", d(-395), "LADBS")
    _file(db, pr7.id, "暖通合同.pdf", "contractor_contract", "施工", d(-380), "Pacific HVAC", 24000)
    _file(db, pr7.id, "厨房总包合同.pdf", "contractor_contract", "施工", d(-370), "Westside Builders", 55000)
    _file(db, pr7.id, "变更单_厨房岛台加大.pdf", "change_order", "施工", d(-300), "Westside Builders", 3900)
    _file(db, pr7.id, "挂牌协议_Compass.pdf", "listing_agreement", "卖出", d(-240), "Compass")
    _file(db, pr7.id, "成交结算单.pdf", "sale_closing", "卖出", d(-195), "Escrow Co.", 1120000)
    _file(db, pr7.id, "项目利润报表.docx", "report", "通用", d(-190), mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    _file(db, pr7.id, "贷款文件.pdf", "loan_doc", "买入", d(-425), uploaded_by="D")
    _file(db, pr7.id, "房屋保险单.pdf", "insurance", "通用", d(-428), "Farmers", uploaded_by="K", expires_at=d(-63))
    _file(db, pr7.id, "设计方案_终稿.pdf", "drawing", "施工", d(-410), uploaded_by="设计师")
    _file(db, pr7.id, "卖方披露.pdf", "seller_disclosure", "卖出", d(-230), uploaded_by="K")
    _file(db, pr7.id, "量尺记录.pdf", "measure_note", "买入", d(-418), uploaded_by="L")
    _file(db, pr7.id, "设计定稿.pdf", "drawing_final", "施工", d(-405), uploaded_by="设计师")
    _file(db, pr7.id, "permit申请回执_LADBS.pdf", "permit_application", "施工", d(-404), "LADBS", uploaded_by="Z")
    _file(db, pr7.id, "买家offer_1.12M.pdf", "offer", "卖出", d(-215), "买家 Patel", 1120000, uploaded_by="J")
    _file(db, pr7.id, "卖房文件包.pdf", "sale_docs", "卖出", d(-210), "Escrow Co.", uploaded_by="W")
    _file(db, pr7.id, "签署版卖房文件.pdf", "sale_signed", "卖出", d(-200), "Escrow Co.", uploaded_by="D")
    _photo(db, pr7.id, "view", "看房", 450, "L", 2)
    _photo(db, pr7.id, "prep_work", "清理拆除", 402, "PM", 2)
    _photo(db, pr7.id, "progress", "进度", 320, "PM", 5)
    _photo(db, pr7.id, "staging", "staging", 245, "J", 4)
    _photo(db, pr7.id, "mow", "剪草后", 238, "园丁", 1)
    for k, who, ago in (("view", "L", 450), ("measure", "L", 418), ("design_final", "设计师", 405), ("permit_apply", "Z", 404), ("prep_work", "PM", 402),
                        ("progress", "PM", 300), ("agent", "J", 280), ("staging", "J", 245), ("mow", "A", 238), ("sign", "D", 200)):
        _step(db, pr7.id, k, who, ago)
    _utilities(db, pr7.id, "off", "David", 195)
    _inspection(db, pr7.id, "final 检查", 250, "passed", is_final=True)
    for g, ago in (("open_escrow", 440), ("close_escrow", 420), ("start", 400), ("final", 250), ("offer", 215), ("closed", 195)):
        _gate(db, pr7.id, g, ago)
    _analysis(db, pr7, p7, v7, "买前分析", tier="heavy", purchase=760000, sale=1150000, months=6, current=False)
    _analysis(db, pr7, p7, v7, "复盘：实际值", tier="heavy", purchase=760000, sale=1120000, months=7, current=True, note="实际成交 1,120,000")

    # ===== 8. 线索 · 已出价 · LA Mariposa =====
    p8, v8 = _create_property(db, provider, L[7])
    _owner_contact(p8, "(213) 555-0166", "kim.family@example.com")
    pr8 = models.Project(property_id=p8.id, name="S Mariposa Ave", strategy="flip", stage="lead", substage="offer_made",
                         lead_heat="hot_lead", target_arv=1080000,
                         notes="已书面出价 $735,000，业主还价 $760,000。周边近 6 个月成交多为地中海/西班牙风格，翻新后单价可到 $700/sqft。",
                         risks="1920 年代老房，电路多为布线老化，需全屋换线。")
    db.add(pr8); db.flush()
    _file(db, pr8.id, "书面出价_735k.pdf", "other", "通用", d(-5), "业主 Kim", 735000, source="upload")
    _file(db, pr8.id, "业主还价_760k.pdf", "other", "通用", d(-2), "业主 Kim", 760000, source="upload")
    _analysis(db, pr8, p8, v8, "出价 735k", tier="heavy", purchase=735000, sale=1080000, months=6, current=True)
    _analysis(db, pr8, p8, v8, "若接受还价 760k", tier="heavy", purchase=760000, sale=1080000, months=6, current=False)

    # ===== 9. 在建 · 挂牌中 · N Holmes（全流程走到第五段，数据最全）=====
    p9, v9 = _create_property(db, provider, L[8])
    _owner_contact(p9, "(816) 555-0142", "anderson.j@example.com")
    _conflict(db, p9, "year_built", "1961", "Lark 表按评估报告写的")
    pr9 = models.Project(property_id=p9.id, name="N Holmes St", strategy="flip", stage="active", substage="listing",
                         purchase_price=168000, target_arv=289000,
                         purchase_date=d(-150), construction_start=d(-128), construction_end=d(-22), list_date=d(-9),
                         risks="无遗留施工风险。挂牌后两周内若无 offer，考虑降价 $5,000。",
                         notes="三卧两卫牧场式。厨房全新、主卫扩建、全屋地板。final 一次通过。staging 用了 Modern Farmhouse 风格，agent 说看房反馈好。")
    db.add(pr9); db.flush()
    _budget(db, pr9.id, {"拆除": 5000, "厨房": 19000, "卫浴": 15000, "地板": 8500, "油漆": 6000, "屋顶": 7000, "电": 6500, "水": 5000,
                         "门窗": 6000, "景观": 3500, "许可与设计": 2200, "应急": 6000, "持有成本": 7500})
    _expenses(db, pr9.id, rnd, {"拆除": 4900, "厨房": 19800, "卫浴": 14600, "地板": 8300, "油漆": 5900, "屋顶": 7100, "电": 6200, "水": 5100,
                                "门窗": 6100, "景观": 3400, "许可与设计": 2200, "应急": 1800, "持有成本": 7200}, d(-128), d(-15))
    _buy_files(db, pr9.id, -150, "卖方 Anderson", 168000)
    _file(db, pr9.id, "贷款文件_签署版.pdf", "loan_doc", "买入", d(-160), "Heartland Bank", uploaded_by="D")
    _file(db, pr9.id, "房屋保险单_Allstate.pdf", "insurance", "通用", d(-158), "Allstate", uploaded_by="K", expires_at=d(207))
    _file(db, pr9.id, "设计方案_终稿.pdf", "drawing", "施工", d(-140), uploaded_by="设计师")
    _file(db, pr9.id, "施工许可证_Clay.pdf", "permit", "施工", d(-132), "Clay County", uploaded_by="Z")
    _file(db, pr9.id, "总包合同_Westside.pdf", "contractor_contract", "施工", d(-127), "Westside Builders", 62000)
    _file(db, pr9.id, "厨房发票_HomeDepot.pdf", "invoice", "施工", d(-70), "Home Depot", 19800)
    _file(db, pr9.id, "变更单_主卫扩建.pdf", "change_order", "施工", d(-60), "Westside Builders", 3200)
    _file(db, pr9.id, "框架检查_通过.pdf", "inspection_report", "施工", d(-95), "Clay County", uploaded_by="Z")
    _file(db, pr9.id, "final_通过.pdf", "inspection_report", "施工", d(-22), "Clay County", uploaded_by="Z")
    _file(db, pr9.id, "挂牌协议_KW.pdf", "listing_agreement", "卖出", d(-9), "Keller Williams", uploaded_by="J")
    _file(db, pr9.id, "量尺记录_1640sqft.pdf", "measure_note", "买入", d(-148), uploaded_by="L")
    _file(db, pr9.id, "设计定稿.pdf", "drawing_final", "施工", d(-140), uploaded_by="设计师")
    _file(db, pr9.id, "permit申请回执_Clay.pdf", "permit_application", "施工", d(-138), "Clay County", uploaded_by="Z")
    _photo(db, pr9.id, "view", "看房", 172, "L", 3)
    _photo(db, pr9.id, "prep_work", "清理拆除", 136, "PM", 2)
    _photo(db, pr9.id, "progress", "进度", 60, "PM", 6)
    _photo(db, pr9.id, "staging", "staging", 14, "J", 5)
    _photo(db, pr9.id, "mow", "剪草后", 5, "园丁", 1)
    for row in (("view", "L", 172), ("measure", "L", 148, "量尺 1,640 sqft，估装修 $95k"), ("design_final", "设计师", 140), ("permit_apply", "Z", 138),
                ("prep_work", "PM", 136), ("progress", "PM", 30, "全部完工，等 final"), ("agent", "J", 40), ("staging", "J", 14, "Modern Farmhouse"), ("mow", "A", 5)):
        _step(db, pr9.id, *row)
    for g, ago in (("open_escrow", 165), ("close_escrow", 150), ("start", 128), ("final", 22)):
        _gate(db, pr9.id, g, ago)
    _utilities(db, pr9.id, "on", "Jessie", 149)
    _inspection(db, pr9.id, "框架检查", 95, "passed")
    _inspection(db, pr9.id, "水电检查", 66, "passed")
    _inspection(db, pr9.id, "保温检查", 50, "passed")
    _inspection(db, pr9.id, "final 检查", 22, "passed", is_final=True, note="一次通过")
    _analysis(db, pr9, p9, v9, "买前分析", tier="medium", purchase=168000, sale=289000, months=5, current=False)
    _analysis(db, pr9, p9, v9, "挂牌前复核", tier="medium", purchase=168000, sale=289000, months=6, current=True, note="按实际支出复核，利润率仍在目标内")

    # ===== 10. 在建 · 等 permit · Pasadena Ave（第三段，设计定稿了、permit 递了还没下来）=====
    p10, v10 = _create_property(db, provider, L[9])
    _owner_contact(p10, "(323) 555-0119", None)
    pr10 = models.Project(property_id=p10.id, name="Pasadena Ave", strategy="flip", stage="active", substage="construction",
                          purchase_price=690000, target_arv=1020000,
                          purchase_date=d(-33), construction_start=None, construction_end=d(150),
                          risks="LADBS 审批排队，已等 24 天。加建阳台部分可能要补交结构计算。",
                          notes="1925 年西班牙式。设计定稿：保留拱门与瓦顶，厨房打通，主卧加阳台。permit 递交后先做清理和非结构拆除。")
    db.add(pr10); db.flush()
    _budget(db, pr10.id, {"拆除": 11000, "结构": 18000, "厨房": 52000, "卫浴": 36000, "地板": 20000, "油漆": 13000, "暖通": 22000,
                          "电": 15000, "水": 11000, "外立面": 16000, "景观": 8000, "许可与设计": 9500, "应急": 20000, "持有成本": 38000})
    _expenses(db, pr10.id, rnd, {"拆除": 6200, "许可与设计": 9500, "持有成本": 6100}, d(-30), d(-2))
    _buy_files(db, pr10.id, -33, "卖方 Thompson Trust", 690000, inspector="LA Home Inspectors")
    _file(db, pr10.id, "贷款文件_签署版.pdf", "loan_doc", "买入", d(-40), "First Republic", uploaded_by="D")
    _file(db, pr10.id, "房屋保险单_Farmers.pdf", "insurance", "通用", d(-38), "Farmers", uploaded_by="K", expires_at=d(327))
    _file(db, pr10.id, "设计方案_定稿.pdf", "drawing", "施工", d(-27), uploaded_by="设计师")
    _file(db, pr10.id, "permit申请回执_LADBS.pdf", "permit_application", "施工", d(-24), "LADBS", uploaded_by="Z")
    _file(db, pr10.id, "量尺记录_2140sqft.pdf", "measure_note", "买入", d(-31), uploaded_by="L")
    _file(db, pr10.id, "设计定稿.pdf", "drawing_final", "施工", d(-27), uploaded_by="设计师")
    _photo(db, pr10.id, "view", "看房", 60, "L", 4)
    _photo(db, pr10.id, "prep_work", "清理拆除", 12, "PM", 3)
    _file(db, pr10.id, "拆除合同_LA_Demo.pdf", "contractor_contract", "施工", d(-20), "LA Demo Co.", 11000)
    for row in (("view", "L", 60), ("measure", "L", 31, "2,140 sqft"), ("design_final", "设计师", 27, "保留拱门瓦顶，厨房打通"), ("permit_apply", "Z", 24, "LADBS 在线递交，含结构图"),
                ("prep_work", "PM", 12, "清理完，非结构墙已拆")):
        _step(db, pr10.id, *row)
    for g, ago in (("open_escrow", 55), ("close_escrow", 33)):
        _gate(db, pr10.id, g, ago)
    _utilities(db, pr10.id, "on", "David", 31)
    _analysis(db, pr10, p10, v10, "买前分析", tier="heavy", purchase=690000, sale=1020000, months=7, current=True)

    # 在建项目灌入采购清单：关键波次部分已齐，方便演示「水电检查前」证据
    from .routers.procurement import ensure_procurement
    for pr in (pr6, pr7):
        for r in ensure_procurement(db, pr.id):
            r.status = "received"
            r.updated_by = "J"
    for pr in (pr1, pr2, pr3, pr9, pr10):
        rows = ensure_procurement(db, pr.id)
        for r in rows:
            if r.wave == "before_rough":
                # 只有 NE 43rd（pr3）留一项“已下单”演示“材料没齐”，其余在建都到货
                r.status = "ordered" if (pr.id == pr3.id and r.name.startswith("岛台灯")) else "received"
            elif r.wave == "long_lead":
                r.status = rnd.choice(["pending_spec", "pending_order", "ordered", "exception"])
            elif r.wave == "after_waterproof":
                r.status = rnd.choice(["pending_spec", "pending_order", "pending_order"])
            else:
                r.status = "pending_spec"
            r.updated_by = "J"

    db.commit()
    # KAN-75：每套示例房的普通任务实例。未分派——示例里没有账号，分派要用真实登录账号做。
    from .routers.tasks import ensure_tasks
    for pr in (pr1, pr2, pr3, pr4, pr5, pr6, pr7, pr8, pr9, pr10):
        ensure_tasks(db, pr.id)


if __name__ == "__main__":
    init_db()
    with SessionLocal() as db:
        seed(db)
    print("seeded")
