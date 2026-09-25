"""Role-scoped design directory; preview access uses the signed-in account only."""

import json
import math

from ..analysis import compute
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import models
from .common import require_user

router = APIRouter(prefix="/api/design-workspaces", tags=["design-workspaces"])


class WorkspaceOut(BaseModel):
    key: str
    title: str
    available: bool


class WorkspaceDirectory(BaseModel):
    items: list[WorkspaceOut]
    can_view_all: bool


class WorkspaceDetail(WorkspaceOut):
    preview: dict | None = None


_WORKSPACES = (
    WorkspaceOut(key="jessie", title="Jessie · 项目统筹", available=True),
    WorkspaceOut(key="kody", title="Kody · 项目助理", available=True),
    WorkspaceOut(key="procurement", title="采购工作区", available=True),
    WorkspaceOut(key="zoey", title="Zoey · Permit / 设计", available=True),
    WorkspaceOut(key="sabrina", title="Sabrina · 财务", available=True),
    WorkspaceOut(key="david", title="David · 董事", available=True),
    WorkspaceOut(key="admin", title="T · 集团创始人", available=True),
)
_BY_KEY = {entry.key: entry for entry in _WORKSPACES}
# Public display labels never participate in authorization: stable role codes do.
_ROLE_WORKSPACE = {"J": "jessie", "项目助理": "kody", "采购": "procurement",
                   "Permit/设计": "zoey", "财务": "sabrina", "D": "david"}


def can_view_all(user: models.User) -> bool:
    return user.is_admin


def visible_workspace_keys(user: models.User) -> set[str]:
    """Design previews only: this hierarchy never grants business-module permissions."""
    if can_view_all(user):
        return set(_BY_KEY)
    if user.role_code == "D":
        return {"david", "jessie", "kody", "procurement", "zoey", "sabrina"}
    if user.role_code == "J":
        return {"jessie", "kody", "procurement", "zoey", "sabrina"}
    own = _ROLE_WORKSPACE.get(user.role_code)
    return {own} if own else set()


def require_workspace_access(key: str, user: models.User) -> WorkspaceOut:
    """Reuse for later prototype-data routes before loading any protected data."""
    entry = _BY_KEY.get(key)
    if entry is None:
        raise HTTPException(404, "设计工作区不存在")
    if key not in visible_workspace_keys(user):
        raise HTTPException(403, "当前账号不能查看这个设计工作区")
    return entry


@router.get("", response_model=WorkspaceDirectory)
def list_workspaces(user: models.User = Depends(require_user)):
    all_access = can_view_all(user)
    allowed_keys = visible_workspace_keys(user)
    items = [entry for entry in _WORKSPACES if entry.key in allowed_keys]
    return WorkspaceDirectory(items=items, can_view_all=all_access)


def _load_blueprints() -> dict:
    with (Path(__file__).resolve().parents[1] / "role_designs.json").open(encoding="utf-8") as source:
        return json.load(source)


def _load_specialist_blueprint(key: str) -> dict:
    # key is from the authorized, fixed directory, never an arbitrary path.
    if key not in {"procurement", "zoey", "sabrina"}:
        raise ValueError("Unknown specialist workspace")
    with (Path(__file__).resolve().parents[1] / "design_previews" / f"{key}.json").open(encoding="utf-8") as source:
        return json.load(source)


def _prepare_analysis(version: dict) -> dict:
    # Reject incomplete assumptions before calling the legacy calculator, which defaults missing values.
    inputs = version.get("inputs")
    inputs = inputs if isinstance(inputs, dict) else {}
    missing = list(version.get("missing", []))
    def valid_number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    for key in ("purchase_price", "sale_price", "holding_months", "selling_pct"):
        if not valid_number(inputs.get(key)):
            missing.append({"purchase_price": "买入价", "sale_price": "预计售价", "holding_months": "持有月数", "selling_pct": "销售费率", "purchase_extras": "购入附加费", "monthly_costs": "每月持有费用", "rehab_items": "装修估算", "selling_extras": "销售附加费"}[key])
    for key in ("purchase_extras", "monthly_costs", "rehab_items", "selling_extras"):
        rows = inputs.get(key)
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not valid_number(row.get("amount")) for row in rows):
            missing.append({"purchase_price": "买入价", "sale_price": "预计售价", "holding_months": "持有月数", "selling_pct": "销售费率", "purchase_extras": "购入附加费", "monthly_costs": "每月持有费用", "rehab_items": "装修估算", "selling_extras": "销售附加费"}[key])
    financing = inputs.get("financing")
    financing = financing if isinstance(financing, dict) else {}
    if not isinstance(financing.get("enabled"), bool):
        missing.append("融资假设")
    elif financing["enabled"]:
        if any(not valid_number(financing.get(key)) for key in ("down_pct", "rate_pct", "years")) or financing.get("down_pct", 101) > 100 or financing.get("years", 0) <= 0:
            missing.append("融资假设")
    result = {key: value for key, value in version.items() if key != "inputs"}
    result["missing"] = list(dict.fromkeys(missing))
    result["outputs"] = None if missing else compute(inputs)
    return result


def _load_leadership_blueprint(key: str) -> dict:
    if key not in {"david", "admin"}:
        raise ValueError("Unknown leadership workspace")
    directory = Path(__file__).resolve().parents[1] / "design_previews"
    with (directory / f"{key}.json").open(encoding="utf-8") as source:
        preview = json.load(source)
    with (directory / "leadership_projects.json").open(encoding="utf-8") as source:
        data = json.load(source)
    for project in data["projects"]:
        project["analyses"] = [_prepare_analysis(version) for version in project["analyses"]]
    return {**preview, **data}


@router.get("/{key}", response_model=WorkspaceDetail)
def get_workspace(key: str, user: models.User = Depends(require_user)):
    entry = require_workspace_access(key, user)
    # Do not load or return any prototype payload before authorization succeeds.
    preview = None
    if entry.available and key in {"david", "admin"}:
        preview = _load_leadership_blueprint(key)
    elif entry.available and key in {"procurement", "zoey", "sabrina"}:
        preview = _load_specialist_blueprint(key)
    elif entry.available:
        blueprints = _load_blueprints()
        tasks = blueprints["tasks"]
        if key == "kody":
            tasks = [task for task in tasks if task["person"] == "Kody"]
        preview = {"person": blueprints["people"][key], "designs": blueprints["designs"][key],
                   "houses": blueprints["houses"], "tasks": tasks}
    return WorkspaceDetail(**entry.model_dump(), preview=preview)
