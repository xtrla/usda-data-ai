import importlib.util
from pathlib import Path
import unittest
from datetime import date, datetime, timezone
spec = importlib.util.spec_from_file_location('health', Path(__file__).parents[1] / 'site_health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
class CoverageTests(unittest.TestCase):
    def test_empty_fails(self):
        self.assertTrue(health.validate_coverage([], date(2026,9,21)))
    def test_friday_valid_on_monday(self):
        self.assertEqual(health.validate_coverage([{'market':'New York','latest_date':'2026-09-18','rows':20}],date(2026,9,21)),[])
    def test_stale_and_future_fail(self):
        for reported in ['2026-09-01','2026-09-22']:
            self.assertTrue(health.validate_coverage([{'market':'New York','latest_date':reported,'rows':20}],date(2026,9,21)))
    def test_malformed_fails(self):
        self.assertTrue(health.validate_coverage([{'market':'New York'}],date(2026,9,21)))
        self.assertTrue(health.validate_coverage([None],date(2026,9,21)))
    def test_missing_market_fails(self):
        rows=[{'market':'New York','latest_date':'2026-09-21','rows':20}]
        self.assertEqual(health.validate_coverage(rows,date(2026,9,21),{'New York','Chicago'}),
                         ['Chicago: missing from terminal coverage'])
    def test_two_weekdays_flags_publication_check(self):
        rows=[{'market':'New York','latest_date':'2026-09-18','rows':20}]
        self.assertTrue(health.validate_coverage(rows,date(2026,9,22)))
    def test_delivery_stuck_and_uncertain(self):
        now=datetime(2026,9,21,19,0,tzinfo=timezone.utc)
        self.assertEqual(health.delivery_problems([{'status':'sending','created_at':'2026-09-21T18:59:00Z'}],now),[])
        self.assertEqual(len(health.delivery_problems([
            {'status':'sending','created_at':'2026-09-21T18:00:00Z'},
            {'status':'uncertain','created_at':'2026-09-21T18:00:00Z'}],now)),2)
if __name__ == '__main__': unittest.main()
