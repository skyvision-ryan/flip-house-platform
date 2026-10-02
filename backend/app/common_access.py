"""Task summaries never widen evidence/module access."""
from .dictionaries import STEP_BY_KEY


def activity_allowed(task, actor):
    from .routers.common import allowed
    from .routers.files import MONEY_DOCS
    rule = STEP_BY_KEY.get(task.step_key or "", {}).get("evidence", "")
    if task.step_key == "purchase":
        return allowed(actor, "procurement_read")
    sensitive = {"purchase_price", "target_arv", "sale_price"}
    return allowed(actor, "read_money") or not any(
        part.startswith(("analysis:", "expense:")) or part.removeprefix("field:") in sensitive or
        (part.startswith("file:") and part[5:] in MONEY_DOCS) for part in rule.split("|"))
