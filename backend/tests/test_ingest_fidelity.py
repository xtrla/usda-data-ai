"""Regression checks derived from the September 17 USDA PDF audit.

These are synthetic API-shaped inputs, not a substitute for raw USDA replay.
Database and network dependencies are stubbed; no production writes occur.
"""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

db = Mock()
spec = importlib.util.spec_from_file_location('ingest_fidelity', Path(__file__).parents[1]/'ingest.py')
ingest = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {
    'requests': types.SimpleNamespace(),
    'dotenv': types.SimpleNamespace(load_dotenv=lambda: None),
    'supabase': types.SimpleNamespace(create_client=lambda *args: db),
}):
    spec.loader.exec_module(ingest)

META = ingest._slug(2315, 'NX_FV020', 'New York', 'terminal')

class FidelityTests(unittest.TestCase):
    def row(self, **fields):
        raw = dict(commodity='BASIL', report_date='09/17/2026',
                   low_price='24.00', high_price='30.00', origin='NEW JERSEY')
        raw.update(fields)
        return ingest.build_row(raw, META)

    def test_all_audited_mostly_ranges(self):
        for low, high in [(26,28),(86,87),(102,103),(66,68),(97,98),(107,108),(53,54)]:
            with self.subTest(low=low):
                row=self.row(mostly_low=str(low), mostly_high=str(high))
                self.assertEqual((row['price_mostly_low'],row['price_mostly_high']), (low,high))

    def test_price_suffix_aliases(self):
        row=self.row(mostly_low_price='26.00', mostly_high_price='28.00')
        self.assertEqual((row['price_mostly_low'],row['price_mostly_high']), (26,28))

    def test_embedded_range_survives_invalid_separate_high(self):
        row=self.row(mostly_low='mostly 26.00-28.00', mostly_high='N/A')
        self.assertEqual((row['price_mostly_low'],row['price_mostly_high']), (26,28))

    def test_single_mostly_does_not_invent_high(self):
        row=self.row(mostly_low='19.00')
        self.assertEqual((row['price_mostly_low'],row['price_mostly_high']), (19,None))

    def test_high_only_is_not_dropped(self):
        row=self.row(mostly_high='28.00')
        self.assertEqual((row['price_mostly_low'],row['price_mostly_high']), (None,28))

    def test_composite_grade_is_preserved_and_distinct(self):
        row=self.row(grade='85% U.S. ONE OR BETTER')
        self.assertEqual(row['grade'],'85% U.S. ONE OR BETTER')
        self.assertNotEqual(row['row_hash'],self.row(grade='U.S. ONE')['row_hash'])

    def test_conflict_rejected_before_any_write(self):
        db.reset_mock()
        first=self.row(low_price='10.00')
        second=dict(first, price_low=12.00)
        with self.assertRaisesRegex(ValueError,'Conflicting'):
            ingest.upsert_rows([first,second])
        db.table.assert_not_called()

    def test_identical_repeat_is_safe(self):
        db.reset_mock()
        first=self.row()
        self.assertEqual(ingest.upsert_rows([first,dict(first)]),1)
        self.assertEqual(db.table.return_value.upsert.call_args.args[0],[first])

class CapturedSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=json.loads((Path(__file__).parent/'fixtures/ny-vegetables-2026-09-17.json').read_text(encoding='utf-8'))
        cls.rows=[ingest.build_row(r,META) for r in cls.raw]

    def test_every_source_record_survives_separately(self):
        self.assertEqual(len(self.rows),379)
        self.assertTrue(all(self.rows))
        self.assertEqual(len({r['row_hash'] for r in self.rows}),379)
        self.assertTrue(all(r['price_low'] is not None for r in self.rows))

    def test_all_numeric_source_fields_match_without_normalizer(self):
        fields={'low_price':'price_low','high_price':'price_high',
                'mostly_low_price':'price_mostly_low','mostly_high_price':'price_mostly_high'}
        for raw,row in zip(self.raw,self.rows):
            for source,target in fields.items():
                if raw.get(source) is not None:
                    with self.subTest(commodity=raw['commodity'],field=source):
                        self.assertEqual(float(raw[source]),row[target])

    def test_source_and_descriptors_are_retained(self):
        for raw,row in zip(self.raw,self.rows):
            self.assertEqual(raw,row['source_record'])
            for field in ('properties','appearance','quality','condition','grade','variety','package'):
                expected=raw.get(field)
                expected=None if expected is None or str(expected).strip().lower() in ('n/a','none','') else str(expected).strip()
                self.assertEqual(expected,row[field])
            for field in ('reporter_comment','environment','repack','unit_sales','transportation_mode'):
                value=raw.get(field)
                if value and value!='N/A':
                    self.assertIn(value.strip(),row['notes'])

    def test_pdf_finger_hot_prices(self):
        quotes={r['properties']:(r['price_low'],r['price_high']) for r in self.rows if r['commodity']=='Peppers, Finger Hot'}
        self.assertEqual(quotes,{'Green':(30,30),'Yellow':(35,36),'Red':(48,50)})

    def test_pdf_comment_only_quotes(self):
        quotes={r['commodity']:(r['price_qualifier'],r['price_low'],r['price_high']) for r in self.rows if r['price_qualifier']}
        self.assertEqual(quotes,{'Artichokes':('one lot',50,None),
            'Carrots':('one lot',10,None),'Cucumbers':('a lot',16,18),
            'Tomatoes':('one lot',24,26),'Pumpkins':('one lot',370,None),
            'Cabbage':('few',14,None),'Turnips':('one lot',18,None)})

    def test_colors_and_preparations_do_not_collapse(self):
        for commodity,count in [('Peppers (Bell Type)',14),('Peppers, Habanero',6),('Cauliflower',5),('Greens, Swiss Chard',2)]:
            self.assertEqual(sum(r['commodity']==commodity for r in self.rows),count)

    def test_reporter_comment_is_not_an_unqualified_price(self):
        raw=dict(self.raw[0],low_price=None,high_price=None,reporter_comment='occasional higher 50.00; package 10 lb')
        row=ingest.build_row(raw,META)
        self.assertIsNone(row['price_low'])
        self.assertIn(raw['reporter_comment'],row['notes'])

if __name__ == '__main__':
    unittest.main()
