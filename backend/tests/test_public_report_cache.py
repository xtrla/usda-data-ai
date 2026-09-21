"""Public response caching must never apply to private data or errors."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


class PublicCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_cache_scope(self):
        tree = ast.parse((Path(__file__).parents[1] / 'api.py').read_text())
        fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)
                  and n.name == 'cache_public_reports')
        fn.decorator_list = []
        ns = {'Request': object}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'api.py', 'exec'), ns)
        for path, method, status, cache in [
            ('/reports/current', 'GET', 200, True),
            ('/reports/latest', 'GET', 200, True),
            ('/reports/current', 'GET', 500, False),
            ('/reports/current', 'POST', 200, False),
            ('/newsletter', 'GET', 200, False),
        ]:
            response = SimpleNamespace(status_code=status, headers={})
            async def next_call(request):
                return response
            request = SimpleNamespace(method=method, url=SimpleNamespace(path=path))
            await ns['cache_public_reports'](request, next_call)
            self.assertEqual('Cache-Control' in response.headers, cache)
