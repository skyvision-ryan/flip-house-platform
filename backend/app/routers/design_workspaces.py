"""Role-scoped design directory; preview access uses the signed-in account only."""

import json
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
    WorkspaceOut(key="david", title="David · 董事", available=False),
    WorkspaceOut(key="admin", title="001 · 集团创始人", available=False),
)
_BY_KEY = {entry.key: entry for entry in _WORKSPACES}
# Public display labels never participate in authorization: stable role codes do.
_ROLE_WORKSPACE = {"J": "jessie", "项目助理": "kody", "采购": "procurement",
                   "Permit/设计": "zoey", "财务": "sabrina", "D": "david"}


def can_view_all(user: models.User) -> bool:
    return user.is_admin or user.role_code in {"D", "J"}


def require_workspace_access(key: str, user: models.User) -> WorkspaceOut:
    """Reuse for later prototype-data routes before loading any protected data."""
    entry = _BY_KEY.get(key)
    if entry is None:
        raise HTTPException(404, "设计工作区不存在")
    if not can_view_all(user) and _ROLE_WORKSPACE.get(user.role_code) != key:
        raise HTTPException(403, "当前账号不能查看这个设计工作区")
    return entry


@router.get("", response_model=WorkspaceDirectory)
def list_workspaces(user: models.User = Depends(require_user)):
    all_access = can_view_all(user)
    items = list(_WORKSPACES) if all_access else [
        entry for entry in _WORKSPACES if entry.key == _ROLE_WORKSPACE.get(user.role_code)
    ]
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


@router.get("/{key}", response_model=WorkspaceDetail)
def get_workspace(key: str, user: models.User = Depends(require_user)):
    entry = require_workspace_access(key, user)
    # Do not load or return any prototype payload before authorization succeeds.
    preview = None
    if entry.available and key in {"procurement", "zoey", "sabrina"}:
        preview = _load_specialist_blueprint(key)
    elif entry.available:
        blueprints = _load_blueprints()
        tasks = blueprints["tasks"]
        if key == "kody":
            tasks = [task for task in tasks if task["person"] == "Kody"]
        preview = {"person": blueprints["people"][key], "designs": blueprints["designs"][key],
                   "houses": blueprints["houses"], "tasks": tasks}
    return WorkspaceDetail(**entry.model_dump(), preview=preview)
