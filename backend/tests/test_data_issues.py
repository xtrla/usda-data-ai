"""Exercise correction submission without sending email."""
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
    client = types.SimpleNamespace(host='127.0.0.1')
    def __init__(self, data): self.data = data
    async def stream(self): yield json.dumps(self.data).encode()

spec = importlib.util.spec_from_file_location('data_issues_target', Path(__file__).parents[1]/'data_issues.py')
module = importlib.util.module_from_spec(spec)
requests = types.SimpleNamespace(RequestException=RuntimeError, post=None)
with patch.dict(sys.modules, {'fastapi':types.SimpleNamespace(APIRouter=Router, HTTPException=HTTPException, Request=Request), 'requests':requests}):
    spec.loader.exec_module(module)

class IssueTests(unittest.TestCase):
    def setUp(self):
        self.handler = module.create_router().routes['/data-issues']
        self.data = {'description':'The size in this quote looks incorrect.', 'market':'New York', 'report_date':'2026-09-18', 'submission_id':'75944242-51ca-49fa-aed5-1aeaa3a7f150'}
        self.response = types.SimpleNamespace(raise_for_status=lambda:None, json=lambda:{'id':'test-delivery'})
    def call(self, data=None): return asyncio.run(self.handler(Request(self.data if data is None else data)))
    def test_validation_blocks_bad_fields(self):
        for change in [{'email':'bad'}, {'description':'short'}, {'report_date':'2026-02-30'}, {'market':[]}, {'website':'spam'}, {'submission_id':'bad'}]:
            with self.subTest(change=change), self.assertRaises(HTTPException):
                self.call(dict(self.data, **change))
    def test_optional_email_and_fixed_recipient(self):
        with patch.dict(os.environ, {'RESEND_API_KEY':'test-only','DATA_ISSUES_TO':'support@example.com'}), patch.object(requests,'post',return_value=self.response) as send:
            self.assertTrue(self.call()['ok'])
            payload = send.call_args.kwargs['json']
            self.assertEqual(payload['to'], ['support@example.com'])
            self.assertNotIn('reply_to', payload)
            self.assertIn('The size', payload['text'])
    def test_retry_reuses_provider_idempotency_key(self):
        with patch.dict(os.environ, {'RESEND_API_KEY':'test-only'}), patch.object(requests,'post',return_value=self.response) as send:
            self.call(); self.call()
            self.assertEqual(send.call_args_list[0].kwargs['headers']['Idempotency-Key'], send.call_args_list[1].kwargs['headers']['Idempotency-Key'])
    def test_missing_config_and_failed_delivery_never_succeed(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(HTTPException) as error: self.call()
        self.assertEqual(error.exception.status_code,503)
        with patch.dict(os.environ, {'RESEND_API_KEY':'test-only'}), patch.object(requests,'post',side_effect=RuntimeError), self.assertRaises(HTTPException) as error: self.call()
        self.assertEqual(error.exception.status_code,503)
    def test_rate_limit_and_payload_limit(self):
        with patch.dict(os.environ, {'RESEND_API_KEY':'test-only'}), patch.object(requests,'post',return_value=self.response):
            for _ in range(5): self.call()
            with self.assertRaises(HTTPException) as error: self.call()
            self.assertEqual(error.exception.status_code,429)
        with self.assertRaises(HTTPException) as error: self.call({'description':'x'*25000})
        self.assertEqual(error.exception.status_code,413)

if __name__ == '__main__': unittest.main()
