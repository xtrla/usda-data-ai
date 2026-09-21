"""Read-only launch checks. Never imports ingest or writes production data."""
import json
import os
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo
from datetime import date, datetime, timedelta, timezone
from urllib.request import Request, urlopen

SITE = os.getenv('AGRAX_SITE_URL', 'https://www.agra-x.com').rstrip('/')
API = os.getenv('AGRAX_API_URL', 'https://produce-iq-production.up.railway.app').rstrip('/')
MARKETS = {'Asheville','Atlanta','Baltimore','Boston','Chicago','Columbia',
           'Detroit','Los Angeles','Miami','New York','Philadelphia'}

def request(url, headers=None):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={'User-Agent':'AgraX-HealthCheck/1.0', **(headers or {})}), timeout=20) as response:
                return response.read().decode('utf-8')
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)

def validate_coverage(rows, today, expected=None):
    if not isinstance(rows, list) or not rows:
        return ['Terminal coverage is empty or invalid']
    errors = []
    # Investigate publication delays; never assert USDA published when we don't know.
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            errors.append('Malformed terminal coverage record')
            continue
        market = row.get('market', 'unknown')
        seen.add(market)
        try:
            reported = date.fromisoformat(row['latest_date'])
            if reported > today:
                errors.append(f'{market}: future report date {reported}')
            days = 0
            cursor = reported
            while cursor < today:
                cursor += timedelta(days=1)
                days += cursor.weekday() < 5
            if days >= 2:
                errors.append(f'{market}: latest report {reported}, {days} weekdays old; check USDA publication and ingestion')
            if int(row.get('rows', 0)) <= 0:
                errors.append(f'{market}: no report rows')
        except (KeyError, TypeError, ValueError):
            errors.append(f'{market}: malformed coverage record')
    for market in sorted((expected or set()) - seen):
        errors.append(f'{market}: missing from terminal coverage')
    return errors

def delivery_problems(rows, now):
    uncertain = sum(row.get('status') == 'uncertain' for row in rows)
    stuck = 0
    for row in rows:
        if row.get('status') == 'sending':
            created = datetime.fromisoformat(row['created_at'].replace('Z', '+00:00'))
            stuck += now - created > timedelta(minutes=15)
    errors = []
    if uncertain:
        errors.append(f'Newsletter: {uncertain} uncertain delivery attempts need reconciliation in Resend')
    if stuck:
        errors.append(f'Newsletter: {stuck} delivery attempts have been pending over 15 minutes')
    return errors

def run():
    failures = []
    for path, marker in [('/', '<h1'),('/browse', 'Browse'),('/about', 'source'),('/privacy','Privacy'),('/reports','report'),('/robots.txt','Sitemap:'),('/sitemap.xml','<urlset')]:
        try:
            body = request(SITE + path)
            if marker.lower() not in body.lower():
                raise ValueError('Expected page content missing')
            print(f'OK {path}')
        except Exception as error:
            failures.append(f'{path}: {type(error).__name__}')
    try:
        if json.loads(request(API + '/')).get('status') != 'ok':
            failures.append('API health status is not ok')
    except Exception as error:
        failures.append(f'API health: {type(error).__name__}')
    try:
        rows = json.loads(request(API + '/reports/coverage?lookback_days=14'))
        failures.extend(validate_coverage(rows, datetime.now(ZoneInfo('America/New_York')).date(), MARKETS))
        print(f'Terminal coverage: {len(rows)} markets')
    except Exception as error:
        failures.append(f'Terminal coverage: {type(error).__name__}')
    if os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SERVICE_KEY'):
        try:
            key = os.environ['SUPABASE_SERVICE_KEY']
            offset = 0
            deliveries = []
            while True:
                batch = json.loads(request(os.environ['SUPABASE_URL'].rstrip('/') +
                    '/rest/v1/newsletter_deliveries?select=status,created_at&status=in.(sending,uncertain)&order=id&limit=500&offset=' + str(offset),
                    {'apikey':key,'Authorization':'Bearer '+key}))
                deliveries.extend(batch)
                if len(batch) < 500: break
                offset += 500
            failures.extend(delivery_problems(deliveries, datetime.now(timezone.utc)))
        except Exception as error:
            failures.append(f'Newsletter delivery log check: {type(error).__name__}')
    for failure in failures:
        print('FAIL ' + failure)
    output = os.getenv('AGRAX_HEALTH_OUTPUT')
    if output:
        Path(output).write_text(json.dumps({'checked_at':datetime.now(timezone.utc).isoformat(),
                                          'failures':sorted(failures)}, indent=2), encoding='utf-8')
    print('Health checks failed' if failures else 'Public page/API/freshness checks passed')
    return 1 if failures else 0

if __name__ == '__main__':
    sys.exit(run())
