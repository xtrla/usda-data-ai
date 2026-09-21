import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from backend.daily_newsletter import run, eligible, check_backend_key
import base64
import json

TODAY = '2026-09-21'
REPORT = dict(market='New York', category='vegetables', report_date=TODAY, ready=True, row_count=385)
SUB = dict(id='subscriber', email='test@example.com', confirmed=True, unsubscribed=False,
           report_preferences=[dict(market='New York', category='vegetables')])

class Query:
    def __init__(self, db, table): self.db, self.name, self.change, self.one = db, table, None, False
    def select(self, *a): return self
    def eq(self, *a): return self
    def order(self, *a): return self
    def range(self, *a): return self
    def single(self): self.one=True; return self
    def update(self, change): self.change=change; return self
    def execute(self):
        if self.change:
            self.db.status=self.change['status']; return SimpleNamespace(data=[])
        data = [REPORT] if self.name == 'newsletter_reports' else [self.db.fresh if self.one else SUB]
        return SimpleNamespace(data=data[0] if self.one else data)

class DB:
    def __init__(self): self.claimed=False; self.status=None; self.fresh=SUB; self.claims=0
    def table(self, name): return Query(self,name)
    def rpc(self,name,args):
        self.claims+=1
        result=None if self.claimed else 'delivery-id'
        self.claimed=True
        return SimpleNamespace(execute=lambda:SimpleNamespace(data=result))

class DailyTests(unittest.TestCase):
    def test_public_key_is_rejected_without_leaking_it(self):
        key='header.'+base64.urlsafe_b64encode(json.dumps({'role':'anon'}).encode()).decode()+'.secret'
        with self.assertRaises(ValueError) as error: check_backend_key(key)
        self.assertNotIn(key,str(error.exception))
    def test_service_role_key_passes_precheck(self):
        key='header.'+base64.urlsafe_b64encode(json.dumps({'role':'service_role'}).encode()).decode()+'.secret'
        check_backend_key(key)
    def test_test_mode_cannot_send_to_other_recipient(self):
        db=DB(); post=Mock()
        run(db,send=True,key='test',post=post,today=TODAY,test_only=True)
        post.assert_not_called(); self.assertEqual(db.claims,0)
    def test_exact_pairs_only(self):
        self.assertTrue(eligible(SUB,REPORT,TODAY))
        for change in [dict(market='Chicago'),dict(category='fruits'),dict(ready=False),dict(row_count=0),dict(report_date='2026-09-18'),dict(report_date='2026-09-22')]:
            self.assertFalse(eligible(SUB,{**REPORT,**change},TODAY))
        for change in [dict(confirmed=False),dict(unsubscribed=True),dict(report_preferences=[])]:
            self.assertFalse(eligible({**SUB,**change},REPORT,TODAY))
    def test_dry_run_has_no_claim_or_email(self):
        db=DB(); post=Mock()
        self.assertEqual(run(db,post=post,today=TODAY)['eligible'],1)
        self.assertEqual(db.claims,0); post.assert_not_called()
    def test_repeat_does_not_resend(self):
        db=DB(); post=Mock(return_value=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'id':'resend-id'}))
        self.assertEqual(run(db,send=True,key='test',post=post,today=TODAY)['accepted'],1)
        self.assertEqual(run(db,send=True,key='test',post=post,today=TODAY)['skipped'],1)
        self.assertEqual(post.call_count,1)
        self.assertIn('date=2026-09-21',post.call_args.kwargs['json']['html'])
        self.assertIn('#manage=',post.call_args.kwargs['json']['html'])
    def test_uncertain_is_not_retried(self):
        db=DB(); post=Mock(side_effect=TimeoutError)
        self.assertEqual(run(db,send=True,key='test',post=post,today=TODAY)['uncertain'],1)
        self.assertEqual(db.status,'uncertain')
        run(db,send=True,key='test',post=post,today=TODAY)
        self.assertEqual(post.call_count,1)
    def test_unsubscribe_before_send(self):
        db=DB(); db.fresh={**SUB,'unsubscribed':True}; post=Mock()
        run(db,send=True,key='test',post=post,today=TODAY)
        post.assert_not_called(); self.assertEqual(db.status,'cancelled')

if __name__ == '__main__': unittest.main()
