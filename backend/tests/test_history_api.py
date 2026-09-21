"""Execute the actual history endpoint without external service credentials."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock

class HTTPError(Exception):
    def __init__(self,status_code,detail):
        self.status_code=status_code
        self.detail=detail

class HistoryAPITests(unittest.TestCase):
    def setUp(self):
        tree=ast.parse((Path(__file__).parents[1]/'api.py').read_text())
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_history')
        fn.decorator_list=[]
        self.db=Mock()
        ns=dict(supabase=self.db,log=Mock(),HTTPException=HTTPError)
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'api.py','exec'),ns)
        self.call=ns['get_history']

    def test_resolves_identity_on_server_without_lossy_filters(self):
        result={'found':True,'series_key':'exact','start_date':'2026-09-20','observations':[]}
        self.db.rpc.return_value.execute.return_value.data=result
        self.assertEqual(self.call('quote-hash',30),result)
        self.db.rpc.assert_called_once_with('read_price_history',{'p_row_hash':'quote-hash','p_days':30})
        self.db.table.assert_not_called()

    def test_no_fallback_when_archive_unavailable(self):
        self.db.rpc.side_effect=RuntimeError('secret connection detail')
        with self.assertRaises(HTTPError) as e:self.call('hash')
        self.assertEqual(e.exception.status_code,503)
        self.assertNotIn('secret',e.exception.detail)
        self.db.table.assert_not_called()

    def test_unknown_quote_is_404(self):
        self.db.rpc.return_value.execute.return_value.data={'found':False,'observations':[]}
        with self.assertRaises(HTTPError) as e:self.call('missing')
        self.assertEqual(e.exception.status_code,404)

    def test_invalid_periods_do_not_query_database(self):
        for days in (0,-1,367):
            with self.assertRaises(HTTPError) as e:self.call('hash',days)
            self.assertEqual(e.exception.status_code,422)
        self.db.rpc.assert_not_called()
