"""Leadership previews never turn incomplete assumptions into financial results."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from app.routers import design_workspaces as workspace

class LeadershipDesignTests(unittest.TestCase):
    def setUp(self):
        source = Path(workspace.__file__).resolve().parents[1] / 'design_previews' / 'leadership_projects.json'
        self.data = json.loads(source.read_text())
        self.version = self.data['projects'][0]['analyses'][-1]

    def test_complete_assumptions_use_existing_model_and_explain_profit(self):
        result = workspace._prepare_analysis(self.version)
        o = result['outputs']
        self.assertEqual(o['total_profit'], 41100)
        self.assertEqual(o['total_costs'], o['purchase_total'] + o['rehab_total'] + o['holding_total'] + o['selling_total'])
        self.assertEqual(o['sale_price'] - o['total_costs'], o['total_profit'])
        self.assertNotIn('inputs', result)

    def test_missing_invalid_or_unconfirmed_costs_never_reach_calculator(self):
        versions = []
        for field in ('purchase_price', 'sale_price', 'holding_months', 'selling_pct', 'purchase_extras', 'monthly_costs', 'rehab_items', 'selling_extras', 'financing'):
            v = copy.deepcopy(self.version)
            del v['inputs'][field]
            versions.append(v)
        for value in (None, -1, float('nan'), float('inf'), True):
            v = copy.deepcopy(self.version)
            v['inputs']['purchase_price'] = value
            versions.append(v)
        v = copy.deepcopy(self.version)
        v['missing'] = ['融资成本未核实']
        versions.append(v)
        with patch.object(workspace, 'compute', side_effect=AssertionError('incomplete model must not compute')):
            for v in versions:
                result = workspace._prepare_analysis(v)
                self.assertIsNone(result['outputs'])
                self.assertTrue(result['missing'])

    def test_explicit_zero_is_valid_and_input_is_not_mutated(self):
        version = copy.deepcopy(self.version)
        version['inputs']['selling_pct'] = 0
        version['inputs']['holding_months'] = 0
        before = copy.deepcopy(version)
        self.assertIsNotNone(workspace._prepare_analysis(version)['outputs'])
        self.assertEqual(version, before)

    def test_shared_dataset_keeps_current_models_separate_from_closed_and_leads(self):
        preview = workspace._load_leadership_blueprint('admin')
        active = [p for p in preview['projects'] if p['lifecycle'] == 'active']
        current = [next(v for v in p['analyses'] if v['current']) for p in active]
        complete = [v for v in current if v['outputs'] is not None]
        self.assertEqual((len(active), len(complete)), (4, 3))
        self.assertEqual(sum(v['outputs']['total_profit'] for v in complete), 83100)
        self.assertEqual([v['outputs'] for v in current if v['missing']], [None])
        self.assertEqual(preview['as_of'], '2026-09-24')
        for project in preview['projects']:
            self.assertEqual(sum(v['current'] for v in project['analyses']), 1)
            self.assertEqual(len({d['id'] for d in project['documents']}), len(project['documents']))
        with self.assertRaises(ValueError):
            workspace._load_leadership_blueprint('../admin')

if __name__ == '__main__':
    unittest.main()
