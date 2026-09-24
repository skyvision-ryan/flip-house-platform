"""业务字典：阶段、状态、预算类别、文件类型、字段来源。"""

STRATEGIES = [
    {"value": "flip", "label": "翻新转卖"},
    {"value": "new_build", "label": "新建"},
    {"value": "rental", "label": "持有出租"},
]

STAGES = [
    {"value": "lead", "label": "线索"},
    {"value": "active", "label": "在建"},
    {"value": "portfolio", "label": "已完成"},
]

SUBSTAGES = {
    "lead": [
        {"value": "new_lead", "label": "新线索"},
        {"value": "contacting", "label": "联系卖家"},
        {"value": "appointment", "label": "约看"},
        {"value": "offer_made", "label": "已出价"},
        {"value": "negotiating", "label": "谈判中"},
        {"value": "pending", "label": "待成交"},
    ],
    "active": [
        {"value": "construction", "label": "施工中"},
        {"value": "listing", "label": "挂牌中"},
    ],
    "portfolio": [
        {"value": "sold", "label": "已售出"},
        {"value": "held", "label": "持有"},
    ],
}

STATUSES = [
    {"value": "on_track", "label": "正常", "kind": "success"},
    {"value": "off_track", "label": "落后", "kind": "error"},
    {"value": "at_risk", "label": "有风险", "kind": "warning"},
    {"value": "hot_lead", "label": "热线索", "kind": "info"},
    {"value": "warm_lead", "label": "温线索", "kind": "pending"},
    {"value": "done", "label": "已完成", "kind": "success"},
]

BUDGET_CATEGORIES = [
    "拆除", "结构", "屋顶", "外立面", "门窗", "电", "水", "暖通", "保温与干墙",
    "地板", "厨房", "卫浴", "油漆", "景观", "许可与设计", "持有成本", "成交成本",
    "应急", "材料杂项", "其他",
]

FILE_TYPES = [
    {"value": "purchase_contract", "label": "购房合同", "stage": "买入"},
    {"value": "title_report", "label": "产权报告", "stage": "买入"},
    {"value": "inspection", "label": "检验报告", "stage": "买入"},
    {"value": "closing_statement", "label": "结算单", "stage": "买入"},
    {"value": "permit", "label": "permit（政府已核发的文件）", "stage": "施工"},
    {"value": "contractor_contract", "label": "承包商合同", "stage": "施工"},
    {"value": "invoice", "label": "发票", "stage": "施工"},
    {"value": "change_order", "label": "变更单", "stage": "施工"},
    {"value": "drawing", "label": "图纸", "stage": "施工"},
    {"value": "listing_agreement", "label": "挂牌协议", "stage": "卖出"},
    {"value": "sale_closing", "label": "成交结算单", "stage": "卖出"},
    {"value": "loan_doc", "label": "贷款文件（loan doc）", "stage": "买入"},
    {"value": "seller_disclosure", "label": "卖方披露（seller disclosure）", "stage": "卖出"},
    {"value": "inspection_report", "label": "施工检查结果（inspection）", "stage": "施工"},
    {"value": "insurance", "label": "房屋保险（有到期日）", "stage": "通用"},
    {"value": "measure_note", "label": "量尺记录", "stage": "买入"},
    {"value": "drawing_final", "label": "定稿图纸", "stage": "施工"},
    {"value": "permit_application", "label": "permit 申请回执", "stage": "施工"},
    {"value": "offer", "label": "买家 offer", "stage": "卖出"},
    {"value": "sale_docs", "label": "卖房文件包", "stage": "卖出"},
    {"value": "sale_signed", "label": "签署版卖房文件", "stage": "卖出"},
    {"value": "photo", "label": "现场照片", "stage": "通用"},
    {"value": "report", "label": "报表", "stage": "通用"},
    {"value": "other", "label": "其他", "stage": "通用"},
]

SOURCES = [
    {"value": "manual", "label": "人工"},
    {"value": "public_record", "label": "公共记录"},
    {"value": "lark", "label": "Lark 迁入"},
    {"value": "model", "label": "模型估算"},
    {"value": "ai", "label": "AI 判断"},
    # KAN-71：模拟数据源必须有自己的取值，不能冒充公共记录。
    {"value": "demo", "label": "演示数据"},
    # 历史迁移里来源无法确认的行用这一档，不重新猜一个来源。
    {"value": "unverified", "label": "待核实"},
]

# 房产字段：字段名 → 中文标签、类型
PROPERTY_FIELDS = [
    {"key": "property_type", "label": "房产类型", "type": "text"},
    {"key": "style", "label": "建筑风格", "type": "text"},
    {"key": "year_built", "label": "建造年份", "type": "int"},
    {"key": "sqft", "label": "建筑面积（平方英尺）", "type": "int"},
    {"key": "beds", "label": "卧室", "type": "int"},
    {"key": "baths_full", "label": "全卫", "type": "int"},
    {"key": "baths_half", "label": "半卫", "type": "int"},
    {"key": "stories", "label": "层数", "type": "int"},
    {"key": "garage_spaces", "label": "车位", "type": "int"},
    {"key": "basement", "label": "地下室", "type": "text"},
    {"key": "lot_sqft", "label": "地块面积（平方英尺）", "type": "int"},
    {"key": "land_use", "label": "土地用途", "type": "text"},
    {"key": "apn", "label": "地块号（APN）", "type": "text"},
    {"key": "avm_value", "label": "模型估值（美元）", "type": "int"},
    {"key": "list_price", "label": "挂牌价（美元）", "type": "int"},
    {"key": "annual_tax", "label": "年房产税（美元）", "type": "int"},
]

# 交易分析器的行业默认值（人工可改；以后用公司历史项目的实际值替换）
ANALYSIS_DEFAULTS = {
    "holding_months": 6,
    "financing": {"enabled": True, "down_pct": 20, "rate_pct": 7.0, "years": 30},
    "closing_pct": 1.5,          # 买入过户费占买入价
    "inspection": 500,
    "appraisal": 600,
    "selling_pct": 7.0,          # 中介佣金 + 卖方过户
    "insurance_pct_annual": 0.5, # 年保费占售价
    "utilities_by_sqft": [(1500, 250), (2500, 350), (99999, 450)],
    "rehab_tiers": {"light": 25, "medium": 45, "heavy": 75},   # $/sqft
    "rehab_shares": {"厨房": 0.22, "卫浴": 0.16, "地板": 0.10, "油漆": 0.08, "屋顶": 0.08, "电": 0.07,
                     "水": 0.06, "门窗": 0.06, "外立面": 0.05, "拆除": 0.04, "景观": 0.03, "应急": 0.05},
    "target_margin_pct": 20,   # 最高出价按目标利润率（利润 ÷ 总成本）反推
}

# ---------------- 人员、级别与权限 ----------------
# 四级：紫 决策 / 蓝 统筹 / 青 执行 / 灰 外部。颜色跟级别走。
TIERS = {
    "purple": {"label": "决策", "color": "#7A3EE8", "order": 0},
    "blue":   {"label": "统筹", "color": "#0972D3", "order": 1},
    "teal":   {"label": "执行", "color": "#0E8A8A", "order": 2},
    "grey":   {"label": "外部", "color": "#7D8998", "order": 3},
}

# 代号来自负责人手写流程；不写真名。老板、PM、承包商是 9/14 录音里补的。
ROLES = [
    {"code": "老板", "label": "老板", "tier": "purple", "duties": "看全局，一般不动手"},
    {"code": "D", "label": "D", "tier": "purple", "duties": "董事会定价、签 loan doc 和卖房文件；和 J 一起确认每个大节点；和 L 一起管施工"},
    {"code": "J", "label": "J", "tier": "purple", "duties": "Jessie：筛房源、贷款、采购、agent、staging、上市；和 D 一起确认每个大节点"},
    {"code": "负责人", "label": "负责人", "tier": "blue", "duties": "统筹：看全局、盯进度、代人打勾、代 D/J 确认、补风险备注"},
    {"code": "L", "label": "L", "tier": "blue", "duties": "看房、量尺估价、参与定价；和 D 一起管施工"},
    {"code": "PM", "label": "PM", "tier": "blue", "duties": "项目经理：盯施工进度、传现场照片、检查没过时带施工方整改"},
    {"code": "K", "label": "K", "tier": "teal", "duties": "保险、水电瓦斯开关、seller disclosure"},
    {"code": "Z", "label": "Z", "tier": "teal", "duties": "permit 申请与领取、约检查、final"},
    {"code": "S", "label": "S", "tier": "teal", "duties": "卖房文件"},
    {"code": "W", "label": "W", "tier": "teal", "duties": "卖房文件"},
    {"code": "A", "label": "A", "tier": "teal", "duties": "安排园丁剪草"},
    {"code": "设计师", "label": "设计师", "tier": "teal", "duties": "设计方案、设计定稿"},
    {"code": "采购", "label": "采购", "tier": "teal", "duties": "维护采购清单、下单与到货状态；执行本人被分派的任务"},
    {"code": "财务", "label": "财务", "tier": "teal", "duties": "查看金额、维护预算和支出、上传发票；无定价、项目管理或节点确认权"},
    {"code": "Permit/设计", "label": "Permit / 设计", "tier": "teal", "duties": "设计方案与定稿、permit 文件、检查记录；无 D/J 节点确认权"},
    {"code": "园丁", "label": "园丁", "tier": "grey", "duties": "剪草，传剪草后照片"},
    {"code": "承包商", "label": "承包商", "tier": "grey", "duties": "施工方，传现场照片（是否进系统待确认）"},
]
ROLE_BY_CODE = {r["code"]: r for r in ROLES}
PEOPLE = [{"code": r["code"], "label": r["label"], "role": r["duties"]} for r in ROLES]  # 兼容旧前端字段


def tier_of(code: str) -> str:
    return ROLE_BY_CODE.get(code, {}).get("tier", "grey")


# 动作 → 允许的级别或具体代号。没列的动作默认只有紫、蓝。
PERMISSIONS = {
    "read_money":        ["purple", "blue", "财务"],  # 看买卖价、预算、利润、分析
    "dashboard":         ["purple", "blue", "teal", "grey"],   # 人人能进工作台，看到的小组件按身份定（DASHBOARD_LAYOUTS）
    "workbench_all_projects": ["purple", "blue"],    # 项目关注的全局范围；其余账号只看有效项目成员关系
    "create_project":    ["purple", "blue"],
    "leads":             ["purple", "blue"],        # 线索房独立入口（KAN-50）；显式登记才会经 /api/meta 下发给前端 canDo
    "delete_project":    ["purple", "负责人"],
    "edit_project":      ["purple", "blue"],          # 日期、阶段、风险、备注
    "edit_money":        ["purple", "blue"],          # 买入价、目标售价、成交价
    "budget":            ["purple", "blue", "财务"],
    "procurement":       ["purple", "blue", "J", "采购"],  # 材料清单：J 主责
    "analysis":          ["purple", "blue"],
    "utilities":         ["purple", "blue", "K"],
    "utility_secret":    ["purple", "blue", "K"],   # 看水电瓦斯账户密码
    "manage_users":      ["purple", "blue"],        # 侧栏“用户”入口；真正校验看 is_admin
    "inspections":       ["purple", "blue", "Z", "Permit/设计"],
    "upload_any":        ["purple", "blue"],          # 传任何类型的文件
    "tick_any":          ["purple", "blue"],          # 代任何人打勾
    "confirm_for_others": ["负责人"],                  # 代 D/J 确认大节点
    "assign_tasks":      ["purple", "blue"],          # KAN-75：把任务分派给具体账号、改派、改截止；也能「加入项目并分派」
}

# ---------------- KAN-75：任务实例的执行状态与事件 ----------------
# 执行状态只描述人在做什么；「满足」由证据派生、「过门」由 D/J 确认，三者并列显示，互不替代。
TASK_EXEC_STATUSES = [
    {"value": "not_started", "label": "未开始", "kind": "stopped"},
    {"value": "in_progress", "label": "进行中", "kind": "in-progress"},
    {"value": "waiting", "label": "等待", "kind": "pending"},
    {"value": "pending_review", "label": "待确认", "kind": "pending"},
    {"value": "done", "label": "已完成", "kind": "success"},
]
TASK_EVENT_KINDS = {
    "assigned": "分派", "reassigned": "改派", "unassigned": "取消分派", "rescheduled": "改截止",
    "started": "开始", "waiting": "等待", "resumed": "恢复", "member_added": "加入项目",
    "created": "新建", "submitted": "提交", "returned": "退回", "confirmed": "确认",
}

# 每个功能块由谁负责（块 → 代号列表）。"?" 表示流程里没写，待确认。
OWNER_MAP = {
    "project.header": ["负责人"],
    "overview.steps": [],            # 每项各自负责人
    "overview.status": ["负责人"],
    "overview.risks": ["负责人"],
    "overview.notes": ["负责人"],
    "overview.budget": ["J"],
    "overview.inspections": ["Z"],
    "overview.updates": ["负责人"],
    "analysis": ["D", "L"],
    "data.specs": ["J", "L"],
    "data.owner": ["J"],
    "data.mortgage": ["J"],
    "data.history": ["J"],
    "data.utilities": ["K"],
    "files.upload": ["当前身份"],
    "files.table": ["负责人"],
    "budget.summary": ["负责人"],
    "budget.lines": ["?"],
    "budget.expenses": ["J"],
    "budget.procurement": ["J"],
    "wizard": ["J"],
}

# 文件类型 → 默认上传人（上传表单里的默认值，可改）
FILE_DEFAULT_OWNER = {
    "purchase_contract": "J", "title_report": "J", "inspection": "J", "closing_statement": "K",
    "loan_doc": "D", "insurance": "K",
    "permit": "Z", "inspection_report": "Z", "drawing": "设计师",
    "contractor_contract": "Z", "invoice": "J", "change_order": "Z",
    "listing_agreement": "J", "sale_closing": "S", "seller_disclosure": "K",
    "report": "负责人", "other": "负责人",
    "measure_note": "L", "drawing_final": "设计师", "permit_application": "Z", "offer": "J", "sale_docs": "S", "sale_signed": "D", "photo": "PM",
}

# ---------------- 阶段清单 ----------------
# 5 个阶段来自负责人 2026-09-14 重新拆的框架（买 / 贷 / 设计+permit / 施工+采购 / 卖上市）。
# 证据规则：file:<doc_type> | field:<项目字段> | expense:any | project:exists | utilities:on | utilities:off
#           | inspections:any | inspections:final | manual。多条用 | 表示任一满足。
# confirm: 大节点由 D 和 J 各勾一次，两个都勾了才算过（负责人 2026-09-14 定的）。
GATE_CONFIRM = ["D", "J"]

# 哪些活要 permit（按常识定的默认值，每套房可改）
PERMIT_RULE = {
    "need": ["动结构", "加建", "屋顶", "水管", "电线", "瓦斯管", "暖通", "改窗洞"],
    "no_need": ["清理", "搬运", "非结构性拆除", "刷漆", "换地板", "换台面", "换柜子", "换灯具"],
}

# 交付物 kind：file 文件 / photo 照片 / field 填一个数 / record 结构化记录 / confirm 大节点确认 / tick 手动勾
def _f(label, doc_type): return {"kind": "file", "label": label, "doc_type": doc_type}
def _p(label): return {"kind": "photo", "label": label, "doc_type": "photo"}
def _d(label, field): return {"kind": "field", "label": label, "field": field}
def _r(label, record): return {"kind": "record", "label": label, "record": record}
def _c(label, field=None, doc_type=None): return {"kind": "confirm", "label": label, "field": field, "doc_type": doc_type}
def _t(label="做完打勾"): return {"kind": "tick", "label": label}

# 六段模板（对齐团队定稿 + FLIP_WORKFLOW_FOR_CLAUDE.md）。项 key 全部沿用旧 key，project_steps 里的勾不用迁移。
# workstream：同一段里并行的线，P2 起按它分组展示；gate 可以是 confirm（D+J 双勾）或证据门（confirm 为空，靠证据过）。
STAGE_CHECKLIST = [
    {"key": "s1", "label": "① 预买房", "short": "预买房", "items": [
        {"key": "screen", "title": "筛选房源", "ws": "尽调", "owners": ["J"], "evidence": "field:risks", "deliverable": _d("写风险：死亡记录 / 无证改建 / 违规记录", "risks"), "purpose": "筛房源时把这套房的已知风险写进项目：死亡记录、无证改建、违规记录。", "done_when": "项目的风险字段填了内容就判定满足。"},
        {"key": "view", "title": "看房", "ws": "看房", "owners": ["L"], "evidence": "photo:view", "deliverable": _p("看房照片"), "purpose": "L 去现场看房，把看房照片挂到这一步。", "done_when": "挂到这一步的照片有 1 张，系统就判定满足。"},
        {"key": "analysis", "title": "算账：估价与装修费", "ws": "财务", "owners": ["D", "L"], "evidence": "analysis:any", "deliverable": _r("交易分析", "analyses"), "purpose": "在项目里做一版交易分析，算这套房的估价和装修费。", "done_when": "项目里有至少 1 版交易分析记录就判定满足。"},
        {"key": "price", "title": "董事会定价、谈价", "ws": "财务", "owners": ["D", "L"], "evidence": "field:purchase_price", "deliverable": _d("买入价", "purchase_price"), "purpose": "董事会定价、谈价，把谈定的买入价填到项目上。", "done_when": "项目的买入价填了就判定满足。"},
        {"key": "open_escrow", "title": "Open escrow（决定买）", "ws": "决定", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("购房合同", doc_type="purchase_contract"), "purpose": "决定买这套房、open escrow 的大节点，交付物是购房合同。", "done_when": "D 和 J 各确认一次，两个都确认才算过门；购房合同只作提示，不决定打勾。"},
    ]},
    {"key": "s2", "label": "② 买房与过户", "short": "买房过户", "items": [
        {"key": "loan_insurance", "title": "开始贷款、买保险", "ws": "融资", "owners": ["J", "K"], "evidence": "file:insurance", "deliverable": _f("保险单（填到期日）", "insurance"), "purpose": "启动贷款并给这套房买保险，把带到期日的保险单存进项目。", "done_when": "项目里有一份「房屋保险（有到期日）」类型的文件就判定满足；判定按文件类型在整个项目里匹配，不绑定这一步。"},
        {"key": "loan_doc", "title": "签 loan doc", "ws": "融资", "owners": ["D", "L"], "evidence": "file:loan_doc", "deliverable": _f("签署的贷款文件", "loan_doc"), "purpose": "签 loan doc，把签署的贷款文件存进项目。", "done_when": "项目里有一份「贷款文件（loan doc）」类型的文件就判定满足。"},
        {"key": "home_inspection", "title": "房屋检查", "ws": "检查", "owners": ["J"], "evidence": "file:inspection", "deliverable": _f("检验报告", "inspection"), "purpose": "买入前做房屋检查，把检验报告存进项目。", "done_when": "项目里有一份「检验报告」类型的文件就判定满足；这是买入段的检验报告，不是施工检查结果。"},
        {"key": "measure", "title": "量尺、估价", "ws": "测量设计", "owners": ["L"], "evidence": "file:measure_note", "deliverable": _f("量尺记录", "measure_note"), "purpose": "L 到现场量尺、估价，把量尺记录存进项目。", "done_when": "项目里有一份「量尺记录」类型的文件就判定满足。"},
        {"key": "design", "title": "设计方案", "ws": "测量设计", "owners": ["设计师"], "evidence": "file:drawing", "deliverable": _f("方案图纸", "drawing"), "purpose": "设计师出装修设计方案，把方案图纸存进项目。", "done_when": "项目里有一份「图纸」类型的文件就判定满足；定稿图纸是另一个类型，不算在这一步。"},
        {"key": "close_escrow", "title": "Close escrow（过户）", "ws": "过户", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("买入日期", field="purchase_date", doc_type="closing_statement"), "purpose": "Close escrow、房子过户到手的大节点，交付物是买入日期和结算单。", "done_when": "D 和 J 各确认一次，两个都确认才算过门；买入日期和结算单只作提示，不决定打勾。"},
        {"key": "utilities_on", "title": "开水电瓦斯", "ws": "水电", "owners": ["K"], "evidence": "utilities:on", "deliverable": _r("三家账户都开通", "utilities"), "purpose": "K 把水、电、瓦斯三家账户开起来，记录在项目的水电瓦斯里。", "done_when": "水、电、瓦斯三条记录都在，且状态都是已开通或已关闭时判定满足。"},
    ]},
    {"key": "s3", "label": "③ 装修", "short": "装修", "items": [
        {"key": "design_final", "title": "设计定稿", "ws": "设计", "owners": ["设计师"], "evidence": "file:drawing_final", "deliverable": _f("定稿图纸", "drawing_final"), "purpose": "设计方案定稿，把定稿图纸存进项目。", "done_when": "项目里有一份「定稿图纸」类型的文件就判定满足。"},
        {"key": "permit_apply", "title": "申请 permit", "ws": "permit", "owners": ["Z"], "evidence": "file:permit_application", "deliverable": _f("申请回执", "permit_application"), "purpose": "Z 递交 permit 申请，把申请回执存进项目。", "done_when": "项目里有一份「permit 申请回执」类型的文件就判定满足。"},
        {"key": "prep_work", "title": "先干不用 permit 的活", "ws": "施工", "owners": ["PM"], "evidence": "photo:prep_work", "deliverable": _p("现场照片"), "purpose": "permit 下来之前先做不用 permit 的活，PM 把现场照片挂到这一步。业务规则待确认。", "done_when": "挂到这一步的照片有 1 张，系统就判定满足；这是现场记录，不代表这段工作已经做完。"},
        {"key": "permit_issued", "title": "拿到 permit 文件", "ws": "permit", "owners": ["Z"], "evidence": "file:permit", "deliverable": _f("permit 文件", "permit"), "purpose": "拿到政府核发的 permit 文件，存进项目。", "done_when": "项目里有一份「permit（政府已核发的文件）」类型的文件就判定满足；申请回执是另一个类型，不算在这一步。"},
        {"key": "start", "title": "可以开工", "ws": "施工", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("开工日期", field="construction_start"), "purpose": "确认可以正式开工的大节点，交付物是开工日期。", "done_when": "D 和 J 各确认一次，两个都确认才算过门；开工日期只作提示，不决定打勾。"},
        {"key": "purchase", "title": "分阶段采购", "ws": "采购", "owners": ["J"], "evidence": "procurement:critical", "deliverable": _r("采购清单", "procurement"), "purpose": "J 按波次分阶段采购材料，在项目的采购清单里维护每项状态。", "done_when": "采购清单里「水电检查前需要」这一波至少有 1 项，且这一波全部是已到货或不适用时判定满足；这一波一项都没有时不算满足。"},
        {"key": "progress", "title": "施工进度", "ws": "施工", "owners": ["PM"], "evidence": "photo:progress", "deliverable": _p("进度照片"), "purpose": "PM 盯施工进度，把现场进度照片挂到这一步。", "done_when": "挂到这一步的照片有 1 张，系统就判定满足；这是现场记录，不代表整段施工已经结束。"},
        {"key": "inspections", "title": "阶段性检查", "ws": "检查", "owners": ["Z"], "evidence": "inspections:any", "deliverable": _r("检查记录", "inspections"), "purpose": "Z 约施工阶段检查，把检查记录留在项目里。", "done_when": "项目的检查记录里至少有 1 次结果是通过就判定满足。"},
        {"key": "final", "title": "final（City 验收通过）", "ws": "City Final", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("final 检查通过", field=None), "purpose": "City final 验收通过的大节点。", "done_when": "D 和 J 各确认一次，同时最近一次标为 final 的检查必须是通过；没有 final 检查记录、或最近一次没通过，双确认也不算过门。"},
    ]},
    {"key": "s4", "label": "④ 预上市", "short": "预上市", "items": [
        {"key": "staging", "title": "staging", "ws": "staging", "owners": ["J"], "evidence": "photo:staging", "deliverable": _p("staging 照片"), "purpose": "J 安排 staging，把布置好的照片挂到这一步。", "done_when": "挂到这一步的照片有 1 张，系统就判定满足。"},
        {"key": "agent", "title": "选 listing agent", "ws": "agent", "owners": ["J"], "evidence": "manual", "deliverable": _t(), "purpose": "J 选定 listing agent。", "done_when": "由这一步的负责人打勾，没有自动证据。"},
        {"key": "listing", "title": "上市", "ws": "上市", "owners": ["J"], "evidence": "field:list_date|file:listing_agreement", "gate": True, "deliverable": _d("挂牌日期", "list_date"), "purpose": "房子正式挂牌上市，交付物是挂牌日期。", "done_when": "项目填了挂牌日期，或者项目里有一份「挂牌协议」类型的文件，任一满足就过门；这道门靠证据过，不需要 D 和 J 确认。"},
    ]},
    {"key": "s5", "label": "⑤ 卖房上市", "short": "卖房", "items": [
        {"key": "mow", "title": "园丁剪草", "ws": "园林", "owners": ["A", "园丁"], "evidence": "photo:mow", "deliverable": _p("剪草后照片"), "purpose": "A 安排园丁剪草，剪完把剪草后照片挂到这一步。", "done_when": "挂到这一步的照片有 1 张，系统就判定满足；剪草是持续性工作，一次照片不代表之后不用再剪。"},
        {"key": "offer", "title": "收到 offer", "ws": "offer", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("offer 文件", doc_type="offer"), "purpose": "收到买家 offer 的大节点，交付物是 offer 文件。业务规则待确认。", "done_when": "D 和 J 各确认一次，两个都确认才算过门；offer 文件只作提示，不决定打勾。"},
        {"key": "sale_docs", "title": "卖房文件", "ws": "过户文件", "owners": ["S", "W"], "evidence": "file:sale_docs", "deliverable": _f("卖房文件包", "sale_docs"), "purpose": "S、W 备齐卖房文件包，存进项目。", "done_when": "项目里有一份「卖房文件包」类型的文件就判定满足。"},
        {"key": "disclosure", "title": "seller disclosure", "ws": "过户文件", "owners": ["K"], "evidence": "file:seller_disclosure", "deliverable": _f("披露文件", "seller_disclosure"), "purpose": "K 出 seller disclosure，把披露文件存进项目。", "done_when": "项目里有一份「卖方披露（seller disclosure）」类型的文件就判定满足。"},
        {"key": "sign", "title": "签卖房文件", "ws": "过户文件", "owners": ["D"], "evidence": "file:sale_signed", "deliverable": _f("签署版", "sale_signed"), "purpose": "D 签卖房文件，把签署版存进项目。", "done_when": "项目里有一份「签署版卖房文件」类型的文件就判定满足。"},
        {"key": "closed", "title": "交割完成", "ws": "交割", "owners": GATE_CONFIRM, "evidence": "confirm", "gate": True, "confirm": GATE_CONFIRM, "deliverable": _c("成交日期", field="sale_date", doc_type="sale_closing"), "purpose": "交割完成的大节点，交付物是成交日期和成交结算单。业务规则待确认。", "done_when": "D 和 J 各确认一次，两个都确认才算过门；成交日期和成交结算单只作提示，不决定打勾。"},
    ]},
    {"key": "s6", "label": "⑥ 售出收尾", "short": "收尾", "items": [
        {"key": "services_off", "title": "关水电瓦斯、退保险", "ws": "收尾", "owners": ["K"], "evidence": "utilities:off", "deliverable": _r("三家账户都关闭", "utilities"), "purpose": "卖掉后关掉水、电、瓦斯，退保险。", "done_when": "判定只看水、电、瓦斯三条记录的状态都是已关闭。"},
    ]},
]
# ---------------- KAN-75 块 2：展示分组 ----------------
# 底层六段 s1…s6 与 31 个 step key 不动；界面的位置条按这五组画。买房组内部再分「未购入 / escrow 中」，
# 判据只有两道既有门：open_escrow 没过 = 未购入；open_escrow 过、close_escrow 没过 = escrow 中。
# 阶段变化仍只由门触发；分派、切页签、时间流逝都不改位置。
STAGE_GROUPS = [
    {"key": "buying", "label": "买房", "stages": ["s1", "s2"],
     "subs": [{"key": "pre", "label": "未购入", "stage": "s1"}, {"key": "escrow", "label": "escrow 中", "stage": "s2"}]},
    {"key": "renovation", "label": "装修", "stages": ["s3"], "subs": []},
    {"key": "prelisting", "label": "预上市", "stages": ["s4"], "subs": []},
    {"key": "selling", "label": "卖房上市", "stages": ["s5"], "subs": []},
    {"key": "closeout", "label": "售出收尾", "stages": ["s6"], "subs": []},
]
GROUP_OF_STAGE = {sk: g["key"] for g in STAGE_GROUPS for sk in g["stages"]}
GROUP_BY_KEY = {g["key"]: g for g in STAGE_GROUPS}
SUB_OF_STAGE = {sub["stage"]: sub for g in STAGE_GROUPS for sub in g["subs"]}

# 旧五段 → 新六段（旧 stage key 没有持久化，仅供文档与调试）
LEGACY_STAGE_MAP = {"s1": "s1", "s2": "s2", "s3": "s3", "s4": "s3", "s5": "s5"}
# 派生旧模型：清单当前段 → projects.stage / substage（旧字段只为筛选与状态规则兼容，不再手改）
STAGE_TO_LEGACY = {"s1": ("lead", None), "s2": ("active", "construction"), "s3": ("active", "construction"),
                   "s4": ("active", "listing"), "s5": ("active", "listing"), "s6": ("portfolio", "sold"), "done": ("portfolio", "sold")}

STEP_BY_KEY = {it["key"]: it for st in STAGE_CHECKLIST for it in st["items"]}
ITEM_EVIDENCE = {it["key"]: it["evidence"] for st in STAGE_CHECKLIST for it in st["items"]}

# 采购清单模板（来自「项目采购进度」表；wave=before_rough 必须齐才能过「分阶段采购」证据）
PROCUREMENT_WAVES = [
    {"value": "before_rough", "label": "水电检查前需要"},
    {"value": "long_lead", "label": "定制/选样/配送需时间"},
    {"value": "after_waterproof", "label": "防水后、final 前需要"},
    {"value": "yard", "label": "院子"},
    {"value": "other", "label": "其他"},
]
PROCUREMENT_STATUSES = [
    {"value": "pending_spec", "label": "待选型"},
    {"value": "pending_order", "label": "待下单"},
    {"value": "ordered", "label": "已下单"},
    {"value": "received", "label": "已到货"},
    {"value": "exception", "label": "异常"},
    {"value": "na", "label": "不适用"},
]
PROCUREMENT_TEMPLATE: list[dict] = [
    *[{"wave": "before_rough", "name": n} for n in ("淋浴花洒组件", "独立浴缸及独立浴缸水龙头", "镜前灯（点位）", "入户吊灯（点位）", "餐桌灯（点位）", "岛台灯（点位）")],
    *[{"wave": "long_lead", "name": n} for n in ("洗手台橱柜", "厨房橱柜、厨房Backsplash样式", "入户门、后门", "车库门", "推拉门、窗户", "炉子、排油烟机、洗碗机（36寸款）", "一体式壁炉的壁炉门")],
    *[{"wave": "after_waterproof", "name": n} for n in (
        "地板", "淋浴间瓷砖及淋浴间地面瓷砖", "壁炉门", "室内门", "室内门把手", "入户门锁",
        "炉子、排油烟机、洗碗机", "洗手台镜子", "镜前灯", "洗手台水龙头", "厨房水龙头", "岛台灯",
        "壁炉样式", "入户吊灯", "餐桌灯", "卧室灯", "室外壁灯", "庭院灯",
    )],
    *[{"wave": "yard", "name": n} for n in ("草坪", "植物", "砂石及木屑", "围墙", "围栏")],
    {"wave": "other", "name": "其他"},
]

# 水电瓦斯三家：每套房各一条
UTILITY_KINDS = [
    {"value": "water", "label": "水"},
    {"value": "electric", "label": "电"},
    {"value": "gas", "label": "瓦斯"},
]
UTILITY_STATUSES = [
    {"value": "not_started", "label": "还没办"},
    {"value": "pending", "label": "办了在等"},
    {"value": "on", "label": "已开通"},
    {"value": "off", "label": "已关闭"},
]
INSPECTION_RESULTS = [
    {"value": "scheduled", "label": "已约"},
    {"value": "passed", "label": "通过"},
    {"value": "failed", "label": "没过，整改中"},
]

# 青灰身份看不到的：项目上的金额字段；带金额的文件类型（下载也不给）
MONEY_FIELDS = {"purchase_price", "target_arv", "sale_price"}
MONEY_DOCS = {"purchase_contract", "closing_statement", "loan_doc", "invoice", "offer", "sale_docs", "sale_signed", "sale_closing"}

# ---------------- 工作台：每个身份的默认小组件与顺序 ----------------
# 老板、负责人最全；蓝的 L、PM 去掉钱类；青只有待办 + 和职位相关的一两个；灰只有待办。
# 小组件 id 见前端 Dashboard.tsx 的 WIDGETS；新加的：boss 老板总览、gates 待我确认的门、mytodo 我的待办、
# procurement 采购异常、site 施工现场、utilities 水电瓦斯与保险、permits permit 与检查、design 设计交付、saledocs 卖出文件
_MONEY_WIDGETS = ["money", "capital", "stages", "funnel", "weekly", "retro", "vendors"]
DASHBOARD_LAYOUTS = {
    "老板":  ["boss", "attention", "gates", "turns", "updates", "upcoming", *_MONEY_WIDGETS, "procurement", "site", "saledocs", "recent", "list"],
    "D":     ["gates", "attention", "turns", "site", "saledocs", "updates", "upcoming", *_MONEY_WIDGETS, "recent", "list"],
    "J":     ["gates", "attention", "procurement", "turns", "saledocs", "updates", "upcoming", *_MONEY_WIDGETS, "recent", "list"],
    "负责人": ["gates", "attention", "turns", "updates", "upcoming", "procurement", "site", "utilities", "permits", "design", "saledocs", *_MONEY_WIDGETS, "recent", "list"],
    "L":     ["mytodo", "attention", "turns", "site", "updates", "upcoming", *_MONEY_WIDGETS, "recent", "list"],
    "PM":    ["mytodo", "attention", "site", "permits", "procurement", "turns", "updates", "upcoming", "recent", "list"],
    "K":     ["mytodo", "utilities", "attention", "saledocs", "upcoming", "updates", "recent", "list"],
    "Z":     ["mytodo", "permits", "site", "attention", "upcoming", "updates", "recent", "list"],
    "S":     ["mytodo", "saledocs", "recent", "list"],
    "W":     ["mytodo", "saledocs", "recent", "list"],
    "A":     ["mytodo", "recent", "list"],
    "设计师": ["mytodo", "design", "recent", "list"],
    "采购":   ["mytodo", "procurement", "recent", "list"],
    "财务":   ["mytodo", "money", "recent", "list"],
    "Permit/设计": ["mytodo", "permits", "design", "recent", "list"],
    "园丁":  ["mytodo"],
    "承包商": ["mytodo"],
}
# 每个小组件谁能加：出现在谁的默认布局里谁就能加；老板和负责人什么都能加
WIDGET_ACCESS: dict[str, list[str]] = {}
for _role, _ids in DASHBOARD_LAYOUTS.items():
    for _w in _ids:
        WIDGET_ACCESS.setdefault(_w, [])
        if _role not in WIDGET_ACCESS[_w]:
            WIDGET_ACCESS[_w].append(_role)


def widget_allowed(actor: str, widget: str) -> bool:
    if actor in ("老板", "负责人"):
        return True
    return actor in WIDGET_ACCESS.get(widget, [])


KEY_FIELDS_FOR_COMPLETENESS = [
    "year_built", "sqft", "beds", "baths_full", "lot_sqft", "apn",
]


def meta() -> dict:
    from .settings import DEMO_MODE
    return {
        "demo_mode": DEMO_MODE,
        "strategies": STRATEGIES,
        "stages": STAGES,
        "substages": SUBSTAGES,
        "statuses": STATUSES,
        "budget_categories": BUDGET_CATEGORIES,
        "file_types": FILE_TYPES,
        "sources": SOURCES,
        "property_fields": PROPERTY_FIELDS,
        "people": PEOPLE,
        "roles": ROLES,
        "tiers": TIERS,
        "permissions": PERMISSIONS,
        "owner_map": OWNER_MAP,
        "file_default_owner": FILE_DEFAULT_OWNER,
        "stage_checklist": STAGE_CHECKLIST,
        "stage_groups": STAGE_GROUPS,
        "stage_to_legacy": STAGE_TO_LEGACY,
        "permit_rule": PERMIT_RULE,
        "dashboard_layouts": DASHBOARD_LAYOUTS,
        "widget_access": WIDGET_ACCESS,
        "utility_kinds": UTILITY_KINDS,
        "utility_statuses": UTILITY_STATUSES,
        "inspection_results": INSPECTION_RESULTS,
        "procurement_waves": PROCUREMENT_WAVES,
        "procurement_statuses": PROCUREMENT_STATUSES,
        "analysis_defaults": {k: v for k, v in ANALYSIS_DEFAULTS.items() if k != "utilities_by_sqft"},
        "task_exec_statuses": TASK_EXEC_STATUSES,
        "task_event_kinds": TASK_EVENT_KINDS,
    }
