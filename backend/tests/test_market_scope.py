import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class MarketScopeTests(unittest.TestCase):
    def test_database_filters_market_before_loading_and_preserves_quotes(self):
        rows = [dict(market=m, source_report='fruit', commodity_type='fruits',
                     report_date=d, row_hash=m+d)
                for m in ('New York', 'Boston')
                for d in ('2026-09-17', '2026-09-18')]
        class Query:
            def __init__(self): self.market = None
            def select(self, fields): return self
            def gte(self, field, value): return self
            def eq(self, field, value):
                if field == 'market': self.market = value
                return self
        query = Query()
        tree = ast.parse((Path(__file__).parents[1] / 'api.py').read_text())
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                 and n.name in ('_latest_uncached', '_current_uncached')]
        ns = dict(supabase=SimpleNamespace(table=lambda _: query), TABLE='prices',
                  LIST_COLUMNS='*', HTTPException=lambda **kw: RuntimeError(kw),
                  fetch_all=lambda q: [r.copy() for r in rows if not q.market or r['market'] == q.market])
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'api.py', 'exec'), ns)
        full = ns['_current_uncached']('terminal', '2026-09-01')
        scoped = ns['_current_uncached']('terminal', '2026-09-01', 'New York')
        self.assertEqual(query.market, 'New York')
        self.assertEqual(scoped, [r for r in full if r['market'] == 'New York'])
        self.assertEqual(ns['_current_uncached']('terminal', '2026-09-01', 'Unknown'), [])
