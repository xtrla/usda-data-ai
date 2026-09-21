"""Send today's successfully imported reports. Default is read-only dry run.

Unknown outcomes stay in the ledger for manual reconciliation, never blind retry.
Accepted means Resend accepted the message, not proof of inbox delivery.
"""
import hashlib
import os
import secrets
from datetime import datetime
from zoneinfo import ZoneInfo

try:
    from email_templates import report_email, SITE
except ModuleNotFoundError:
    from backend.email_templates import report_email, SITE


def pages(query):
    offset = 0
    while True:
        batch = query.range(offset, offset + 499).execute().data
        yield from batch
        if len(batch) < 500:
            return
        offset += 500


def eligible(subscriber, report, today):
    return (subscriber.get('confirmed') is True
            and subscriber.get('unsubscribed') is False
            and report.get('ready') is True and report.get('row_count', 0) > 0
            and report.get('report_date') == today
            and {'market': report['market'], 'category': report['category']}
            in (subscriber.get('report_preferences') or []))


def run(db, *, send=False, key=None, post=None, today=None, test_only=False):
    if send and not key:
        raise ValueError('RESEND_API_KEY is required for sending')
    if send and post is None:
        import requests
        import time
        def post(*args, **kwargs):
            time.sleep(0.6)
            return requests.post(*args, **kwargs)
    today = today or datetime.now(ZoneInfo('America/New_York')).date().isoformat()
    reports = list(pages(db.table('newsletter_reports').select('*').eq('report_date', today).eq('ready', True).order('market').order('category')))
    counts = dict(eligible=0, accepted=0, skipped=0, uncertain=0)
    subscribers = pages(db.table('subscribers').select('id,email,confirmed,unsubscribed,report_preferences').eq('confirmed', True).eq('unsubscribed', False).order('id'))
    for subscriber in subscribers:
        for report in reports:
            if test_only and (subscriber['email'].lower() != 'starmantra12@gmail.com'
                              or report['market'] != 'New York' or report['category'] != 'vegetables'):
                continue
            if not eligible(subscriber, report, today):
                continue
            counts['eligible'] += 1
            if not send:
                continue
            token = secrets.token_urlsafe(32)
            message = report_email(report['market'], report['category'], today,
                                   manage_url=SITE + '/newsletter/#manage=' + token)
            claim = db.rpc('newsletter_claim', {
                'p_subscriber': subscriber['id'], 'p_market': report['market'],
                'p_category': report['category'], 'p_date': today,
                'p_hash': hashlib.sha256(token.encode()).hexdigest(),
            }).execute().data
            if not claim:
                counts['skipped'] += 1
                continue
            # Check preferences again immediately before external delivery.
            fresh = db.table('subscribers').select('confirmed,unsubscribed,report_preferences').eq('id', subscriber['id']).single().execute().data
            if not eligible(fresh, report, today):
                db.table('newsletter_deliveries').update({'status': 'cancelled'}).eq('id', claim).execute()
                counts['skipped'] += 1
                continue
            try:
                response = post('https://api.resend.com/emails', headers={
                    'Authorization': 'Bearer ' + key, 'Idempotency-Key': 'daily/' + claim,
                }, json={
                    'from': os.getenv('NEWSLETTER_FROM', 'AgraX Reports <reports@agra-x.com>'),
                    'to': [subscriber['email']], 'reply_to': 'hello@agra-x.com', **message,
                }, timeout=20)
                response.raise_for_status()
                provider_id = response.json().get('id')
                if not provider_id:
                    raise ValueError('Missing provider acknowledgement')
                db.table('newsletter_deliveries').update({'status': 'accepted', 'provider_id': provider_id}).eq('id', claim).execute()
                counts['accepted'] += 1
            except Exception:
                # Includes a provider success followed by a DB failure. Never resend automatically.
                db.table('newsletter_deliveries').update({'status': 'uncertain'}).eq('id', claim).execute()
                counts['uncertain'] += 1
    return counts


if __name__ == '__main__':
    from supabase import create_client
    test_only = os.getenv('NEWSLETTER_TEST_ONLY') == '1'
    enabled = os.getenv('NEWSLETTER_DELIVERY_ENABLED') == '1' or test_only
    db = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])
    result = run(db, send=enabled, key=os.getenv('RESEND_API_KEY'), test_only=test_only)
    print(('SEND' if enabled else 'DRY RUN'), result)
    if result['uncertain']:
        raise SystemExit('Review uncertain deliveries in Supabase and Resend before retrying.')
