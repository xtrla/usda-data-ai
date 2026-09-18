"""Isolated handler tests. Network and framework boundaries are mocked."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
class Router:
    def __init__(self, **kwargs): self.routes = {}
    def post(self, path):
        def register(fn): self.routes[path] = fn; return fn
        return register
class Request:
    def __init__(self, data): self.data = data
    async def body(self): return json.dumps(self.data).encode()
    async def json(self): return self.data
class DB:
    def __init__(self): self.calls=[]; self.result=True
    def rpc(self,name,params): self.calls.append((name,params));return self
    def execute(self):return types.SimpleNamespace(data=self.result)

spec=importlib.util.spec_from_file_location('newsletter_test_target',Path(__file__).parents[1]/'newsletter.py')
module=importlib.util.module_from_spec(spec)
requests=types.SimpleNamespace(RequestException=RuntimeError,post=None)
with patch.dict(sys.modules,{'fastapi':types.SimpleNamespace(APIRouter=Router,HTTPException=HTTPException,Request=Request),'requests':requests}):
    spec.loader.exec_module(module)

class NewsletterTests(unittest.TestCase):
    def setUp(self):
        self.db=DB();self.routes=module.create_router(self.db).routes
        self.data={'email':'TEST@example.com','reports':[{'market':'New York','category':'vegetables'},{'market':'Chicago','category':'fruits'}]}
    def call(self,path,data):return asyncio.run(self.routes[path](Request(data)))
    def test_pairs_do_not_expand(self):
        self.assertEqual(module.preferences(self.data['reports']),self.data['reports'])
        with self.assertRaises(HTTPException):module.preferences([{'market':[], 'category':'fruits'}])
    def test_request_is_pending_and_token_is_hashed(self):
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-only'}),patch.object(requests,'post',return_value=types.SimpleNamespace(raise_for_status=lambda:None)) as send:
            self.assertTrue(self.call('/request',self.data)['confirmation_required'])
            name,args=self.db.calls[0];self.assertEqual(name,'newsletter_request')
            self.assertEqual(args['p_email'],'test@example.com');self.assertEqual(len(args['p_hash']),64)
            self.assertNotIn(args['p_hash'],send.call_args.kwargs['json']['html'])
            self.assertEqual(send.call_args.kwargs['json']['to'],['test@example.com'])
    def test_cooldown_does_not_send(self):
        self.db.result=False
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-only'}),patch.object(requests,'post') as send:
            with self.assertRaises(HTTPException) as error:self.call('/request',self.data)
            self.assertEqual(error.exception.status_code,429);send.assert_not_called()
    def test_send_failure_is_not_success(self):
        with patch.dict(os.environ,{'RESEND_API_KEY':'test-only'}),patch.object(requests,'post',side_effect=RuntimeError):
            with self.assertRaises(HTTPException) as error:self.call('/request',self.data)
            self.assertEqual(error.exception.status_code,503)
    def test_expired_confirmation(self):
        self.db.result=False
        with self.assertRaises(HTTPException) as error:self.call('/confirm',{'token':'a'*43})
        self.assertEqual(error.exception.status_code,410)
    def test_confirmation_issues_separate_manage_secret(self):
        response=self.call('/confirm',{'token':'a'*43})
        self.assertNotEqual(response['manage_token'],'a'*43)
        self.assertEqual(self.db.calls[0][1]['p_manage_hash'],module.digest(response['manage_token']))
    def test_invalid_link(self):
        with self.assertRaises(HTTPException):self.call('/confirm',{'token':'bad'})

if __name__=='__main__':unittest.main()
