import unittest
from backend.email_templates import report_email
class ReportEmailTests(unittest.TestCase):
    def test_report_date_and_link_agree(self):
        mail=report_email('New York','vegetables','2026-09-17',test=True)
        self.assertIn('September 17, 2026',mail['html'])
        self.assertIn('date=2026-09-17',mail['html'])
        self.assertNotIn('price lines',mail['html'])
        self.assertNotIn('commodities',mail['html'])
    def test_subscriber_requires_management_link(self):
        with self.assertRaises(ValueError): report_email('New York','vegetables','2026-09-17')
    def test_unsafe_link_rejected(self):
        with self.assertRaises(ValueError): report_email('New York','vegetables','2026-09-17',manage_url='javascript:alert(1)')
    def test_values_escaped(self):
        mail=report_email('<script>','vegetables','2026-09-17',test=True)
        self.assertNotIn('<script>',mail['html'])
if __name__=='__main__': unittest.main()
