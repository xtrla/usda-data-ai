import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import sys
from backend.tests.test_data_issues import HTTPException, Router, Request
with patch.dict(sys.modules, {
    'fastapi': SimpleNamespace(HTTPException=HTTPException, APIRouter=Router, Request=Request),
    'requests': SimpleNamespace(post=None, RequestException=RuntimeError),
}):
    from backend.welcome import deliver_welcome, welcome_email

class WelcomeTests(unittest.TestCase):
    def setUp(self):
        self.db = Mock()
        self.db.auth.admin.get_user_by_id.return_value.user = SimpleNamespace(email='owner@example.com')
        self.db.rpc.return_value.execute.return_value.data = True

    @patch.dict(os.environ, {'RESEND_API_KEY': 'test'})
    @patch('backend.welcome.requests.post')
    def test_sends_to_actual_account_with_branding(self, send):
        send.return_value.json.return_value = {'id': 'provider-id'}
        self.assertEqual(deliver_welcome(self.db, 'account')['status'], 'accepted')
        payload = send.call_args.kwargs['json']
        self.assertEqual(payload['to'], ['owner@example.com'])
        self.assertIn('Choose your reports', payload['html'])
        self.assertIn('agrax-logo-white-cropped.png', payload['html'])
        self.assertEqual(payload['reply_to'], 'hello@agra-x.com')

    @patch.dict(os.environ, {'RESEND_API_KEY': 'test'})
    @patch('backend.welcome.requests.post')
    def test_duplicate_event_does_not_send(self, send):
        self.db.rpc.return_value.execute.return_value.data = False
        self.assertEqual(deliver_welcome(self.db, 'account')['status'], 'already_claimed')
        send.assert_not_called()

    @patch.dict(os.environ, {'RESEND_API_KEY': 'test'})
    @patch('backend.welcome.requests.post')
    def test_missing_acknowledgement_is_not_success(self, send):
        send.return_value.json.return_value = {}
        with self.assertRaises(HTTPException): deliver_welcome(self.db, 'account')
        self.db.table.return_value.update.assert_called_with({'status': 'uncertain'})

    @patch.dict(os.environ, {}, clear=True)
    def test_unconfigured_sender_does_not_claim(self):
        with self.assertRaises(HTTPException): deliver_welcome(self.db, 'account')
        self.db.rpc.assert_not_called()
