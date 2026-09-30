"""Display metadata is additive: no permission, purchasing fact or legacy-name migration."""
import json
import unittest
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models
from app.dictionaries import PROCUREMENT_TEMPLATE
from app.message_codes import message_metadata
from app.routers import procurement
from tests.test_tasks_assign import _TaskBase

class NativeI18nTests(_TaskBase):
    def setUp(self):
        super().setUp()
        self.app.include_router(procurement.router)

    def test_template_keys_unique_and_repeat_initialization_does_not_overwrite_legacy(self):
        keys = [t['template_key'] for t in PROCUREMENT_TEMPLATE]
        self.assertEqual(len(keys), len(set(keys)))
        with Session(self.engine) as db:
            procurement.ensure_procurement(db, self.pid, select_all=True)
            db.commit()
            rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == self.pid)))
            self.assertEqual([r.template_key for r in rows], keys)
            self.assertTrue(all(r.name == r.template_name_snapshot for r in rows))
            row = rows[0]
            row.template_key = row.template_name_snapshot = None
            row.name, row.note, row.amount, row.received_on = '人工材料', '原始备注', 123.45, '2026-09-01'
            db.commit()
            snapshot = [(r.id, r.name, r.note, r.amount, r.received_on, r.updated_at, r.template_key) for r in rows]
            procurement.ensure_procurement(db, self.pid, select_all=True)
            db.commit()
            self.assertEqual([(r.id, r.name, r.note, r.amount, r.received_on, r.updated_at, r.template_key) for r in rows], snapshot)

    def test_language_header_does_not_write_or_change_authorization(self):
        client = self.login('jessie')
        path = f'/api/projects/{self.pid}/tasks'
        chinese = client.get(path, headers={'Accept-Language': 'zh-CN'})
        english = client.get(path, headers={'Accept-Language': 'en-US'})
        self.assertEqual(chinese.status_code, 200)
        self.assertEqual(chinese.json(), english.json())
        outsider = self.login('a2')
        self.assertEqual(outsider.get(path, headers={'Accept-Language': 'en-US'}).status_code, 403)
        tasks = chinese.json()['tasks']
        self.assertTrue(all(t.get('template_key') and t['template_name_snapshot'] == t['title'] for t in tasks))

class SystemMessagesTests(unittest.TestCase):
    def test_additive_codes_do_not_rewrite_original_and_match_frontend_keys(self):
        from pathlib import Path
        catalogs = Path(__file__).resolve().parents[2] / 'frontend/src/i18n/catalog'
        frontend = {k: v for p in catalogs.glob('*.json') for k, v in json.loads(p.read_text()).items()}
        from app.message_codes import _MESSAGES
        for code, source in _MESSAGES.items():
            self.assertIn(source, frontend[code])
        self.assertEqual(message_metadata('不属于系统词库的员工原文'), {})
        output = message_metadata('文件 888 不属于这个项目')
        self.assertEqual(output['message_code'], 'server.file.does.not.belong.to.this.project')
        self.assertEqual(output['message_params'], {'value1': '888'})

class MessageMaintenanceTests(unittest.TestCase):
    @staticmethod
    def _http_literals(source):
        import ast
        found = []
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.Call):
                continue
            name = node.func.id if isinstance(node.func, ast.Name) else ''
            if name not in {'HTTPException', 'ValueError'}:
                continue
            detail = next((kw.value for kw in node.keywords if kw.arg == 'detail'), None)
            if detail is None and len(node.args) >= (2 if name == 'HTTPException' else 1):
                detail = node.args[1 if name == 'HTTPException' else 0]
            if isinstance(detail, ast.Constant) and isinstance(detail.value, str):
                found.append((node.lineno, detail.value))
            elif isinstance(detail, ast.JoinedStr):
                found.append((node.lineno, ''.join(p.value if isinstance(p, ast.Constant) else 'I18N_PARAM' for p in detail.values)))
        return found

    def test_new_backend_error_literals_have_bundled_message_codes(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1] / 'app'
        missing = []
        for path in root.rglob('*.py'):
            for line, text in self._http_literals(path.read_text()):
                if not message_metadata(text):
                    missing.append(f'{path.relative_to(root)}:{line}: {text}')
        self.assertEqual(missing, [])

    def test_temporary_english_and_chinese_errors_are_both_detected(self):
        for text in ['New uncatalogued error', '新的系统错误']:
            self.assertEqual(self._http_literals(f'raise HTTPException(400, {text!r})'), [(1, text)])
            self.assertEqual(message_metadata(text), {})
        self.assertTrue(message_metadata('项目不存在'))
        self.assertEqual(self._http_literals('# 中文注释\nrole = "采购"'), [])

    def test_runtime_task_rules_and_new_template_provenance_are_in_both_catalogs(self):
        from pathlib import Path
        from app.dictionaries import STAGE_CHECKLIST
        catalogs = Path(__file__).resolve().parents[2] / 'frontend/src/i18n/catalog'
        pairs = {k: v for p in catalogs.glob('*.json') for k, v in json.loads(p.read_text()).items()}
        chinese = {v[0] for v in pairs.values()}
        for stage in STAGE_CHECKLIST:
            for item in stage['items']:
                for field in ('title', 'purpose', 'done_when'):
                    if item.get(field):
                        self.assertTrue(item[field] in chinese or any(item[field] == pair[1] for pair in pairs.values()), f'{item["key"]}.{field}')
                self.assertTrue(f'task.{item["key"]}' in pairs, item['key'])
        for item in PROCUREMENT_TEMPLATE:
            self.assertEqual(pairs[item['template_key']][0], item['name'])

    def test_analysis_provenance_leaves_costs_and_original_notes_intact(self):
        from app.analysis import build_prefill, full_outputs
        inputs = build_prefill(sqft=1200, avm_value=700000, list_price=400000, annual_tax=6000,
                               field_sources={'avm_value': {'source': 'manual', 'note': '员工原文'}})
        self.assertEqual(inputs['sources']['sale_price']['note'], '员工原文')
        self.assertIsNone(inputs['sources']['sale_price']['note_template_snapshot'])
        clean = json.loads(json.dumps(inputs))
        def remove_metadata(value):
            if isinstance(value, dict):
                for key in list(value):
                    if key in {'template_key', 'template_name_snapshot', 'note_template_snapshot', 'name_template'}:
                        del value[key]
                    else:
                        remove_metadata(value[key])
            elif isinstance(value, list):
                for row in value: remove_metadata(row)
        remove_metadata(clean)
        self.assertEqual(full_outputs(inputs), full_outputs(clean))

class ExplicitMessageTests(unittest.TestCase):
    def test_explicit_code_keeps_original_detail_and_checks_parameters(self):
        from app.message_codes import system_error, exception_metadata
        exc = system_error(403, 'server.fileDownloadDenied', actor='采购')
        self.assertEqual(exc.detail, '采购 不能下载这个文件')
        self.assertEqual(exception_metadata(exc), {'message_code':'server.fileDownloadDenied', 'message_params':{'actor':'采购'}})
        with self.assertRaises(TypeError): system_error(403, 'server.fileDownloadDenied', wrong='x')
        with self.assertRaises(KeyError): system_error(400, 'nonexistent')
