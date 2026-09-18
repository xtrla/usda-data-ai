"""Exercise the actual API selection function without a live database."""
import ast
from pathlib import Path
import types
import unittest
from unittest.mock import Mock

class TerminalSnapshotTests(unittest.TestCase):
    def call(self,rows,kind='terminal'):
        tree=ast.parse((Path(__file__).parents[1]/'api.py').read_text(encoding='utf-8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_latest_uncached')
        ns={'supabase':Mock(),'TABLE':'produce_prices','LIST_COLUMNS':'*','fetch_all':lambda q:rows,
            'HTTPException':lambda **kw:RuntimeError(kw)}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'api.py','exec'),ns)
        return ns['_latest_uncached'](kind,'2026-09-01')

    def test_terminal_uses_complete_latest_publication_not_old_skus(self):
        base=dict(market='New York',source_report='NX_FV020',commodity_type='vegetables')
        rows=[dict(base,report_date='2026-09-16',commodity='Old product'),
              dict(base,report_date='2026-09-17',commodity='Peppers',properties='Red'),
              dict(base,report_date='2026-09-17',commodity='Peppers',properties='Green')]
        self.assertEqual(self.call(rows),rows[1:])

    def test_other_category_keeps_its_own_publication_date(self):
        rows=[dict(market='New York',source_report='NX_FV020',commodity_type='vegetables',report_date='2026-09-17'),
              dict(market='New York',source_report='NX_FV010',commodity_type='fruits',report_date='2026-09-16')]
        self.assertEqual(self.call(rows),rows)
