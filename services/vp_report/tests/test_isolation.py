"""服务边界：报告服务不得依附主业务。

这两组测试是"独立服务"这个决定的看门狗。谁哪天图省事从 backend 借一个函数，
或者把业务的 DEMO_MODE / X-Actor 抄进来，这里立刻红。

用 AST 而不是 grep：源码里的注释和文档字符串**本来就会**提到
"不认 DEMO_MODE、不认 X-Actor"——那是在说明边界，不是在违反它。
只看真正被执行的代码。
"""

from __future__ import annotations

import ast
import pathlib
import subprocess
import sys
import textwrap
import unittest

SERVICE_DIR = pathlib.Path(__file__).resolve().parent.parent
APP_DIR = SERVICE_DIR / "app"
REPO_ROOT = SERVICE_DIR.parent.parent

FORBIDDEN_NAMES = {
    "DEMO_MODE": "业务演示开关",
    "SessionLocal": "业务数据库会话",
    "get_actor": "业务鉴权函数",
    "current_user": "业务登录状态",
}
FORBIDDEN_STRINGS = ("X-Actor", "x-actor", "DEMO_MODE")


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """收集所有文档字符串节点的 id，扫描时跳过它们。"""
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                out.add(id(body[0].value))
    return out


class SourceIsolationTest(unittest.TestCase):
    def test_app_code_never_imports_the_business_service(self):
        offenders = []
        for path in sorted(APP_DIR.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                    # level>0 是相对导入（from . import ...），那是本服务自己的模块
                    if node.level == 0 and (mod == "app" or mod.startswith("app.")
                                            or mod == "backend" or mod.startswith("backend.")):
                        offenders.append(f"{path.name}:{node.lineno} from {mod} import ...")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "app" or alias.name.startswith(("app.", "backend")):
                            offenders.append(f"{path.name}:{node.lineno} import {alias.name}")
        self.assertEqual(offenders, [], "报告服务导入了主业务：\n" + "\n".join(offenders))

    def test_app_code_does_not_use_business_auth_concepts(self):
        offenders = []
        for path in sorted(APP_DIR.rglob("*.py")):
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(path))
            skip = _docstring_nodes(tree)
            for node in ast.walk(tree):
                if isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
                    offenders.append(f"{path.name}:{node.lineno} 用到 {node.id}"
                                     f"（{FORBIDDEN_NAMES[node.id]}）")
                elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
                    offenders.append(f"{path.name}:{node.lineno} 用到 .{node.attr}")
                elif isinstance(node, ast.Constant) and isinstance(node.value, str) \
                        and id(node) not in skip:
                    for bad in FORBIDDEN_STRINGS:
                        if bad in node.value:
                            offenders.append(f"{path.name}:{node.lineno} 字符串里出现 {bad}")
        self.assertEqual(offenders, [], "报告服务沾上了业务鉴权：\n" + "\n".join(offenders))

    def test_service_has_its_own_requirements(self):
        req = SERVICE_DIR / "requirements.txt"
        self.assertTrue(req.exists(), "报告服务必须有自己的 requirements.txt")
        text = req.read_text(encoding="utf-8")
        for pkg in ("fastapi", "httpx", "python-multipart"):
            self.assertIn(pkg, text)
        self.assertNotIn("sqlalchemy", text.lower())   # 业务依赖不该出现在这里


class ImportIsolationTest(unittest.TestCase):
    """真正的证明：干净解释器里只放报告服务的路径，也能起来。

    AST 扫描抓不住 importlib 或 sys.path 花招，这条能。
    """

    def test_imports_with_only_the_service_on_the_path(self):
        script = textwrap.dedent(f"""
            import sys, os
            # 只踢掉仓库的**源码**目录（仓库根、backend/），
            # 不能连 venv 的 site-packages 一起踢——那样 fastapi 都没了，
            # 测出来的就不是隔离性而是环境坏了。
            banned = {{os.path.abspath(p) for p in (
                {str(REPO_ROOT)!r}, {str(REPO_ROOT / "backend")!r})}}
            sys.path = [p for p in sys.path if os.path.abspath(p or ".") not in banned]
            sys.path.insert(0, {str(SERVICE_DIR)!r})
            os.environ.pop("DEMO_MODE", None)
            import app.main as m
            assert "services/vp_report" in m.__file__, m.__file__
            assert m.app.title
            import app as pkg
            assert "services/vp_report" in (pkg.__file__ or ""), pkg.__file__
            print("ISOLATED_OK")
        """)
        result = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True, text=True, timeout=120,
            cwd=str(SERVICE_DIR.parent.parent),   # 故意从仓库根目录跑
        )
        self.assertIn("ISOLATED_OK", result.stdout,
                      f"独立导入失败：\nstdout={result.stdout}\nstderr={result.stderr}")


if __name__ == "__main__":
    unittest.main()
