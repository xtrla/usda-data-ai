"""Build the homepage's dated fallback using public per-market report reads."""
import concurrent.futures, datetime, json, pathlib, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
MARKETS = ['New York','Chicago','Los Angeles','Philadelphia','Miami','Boston','Atlanta','Baltimore','Detroit','Columbia','Asheville']

def read(market):
    for days in (7, 30):
        try:
            query = urllib.parse.urlencode(dict(market_type='terminal',lookback_days=days,market=market))
            with urllib.request.urlopen('https://produce-iq-production.up.railway.app/reports/current?'+query, timeout=35) as r:
                rows = json.load(r)
            rows = [r for r in rows if r.get('market') == market and r.get('row_hash') and r.get('report_date')]
            if rows:
                dates = {}
                for r in rows:
                    key = (r.get('source_report'), r.get('commodity_type'))
                    dates[key] = max(dates.get(key,''), r['report_date'])
                rows = [r for r in rows if r['report_date'] == dates[(r.get('source_report'),r.get('commodity_type'))]]
                return market, rows
        except Exception as e:
            print(market, days, type(e).__name__, flush=True)
    return market, []

if __name__ == '__main__':
    previous = json.loads((ROOT/'frontend/dashboard/current.json').read_text(encoding='utf-8'))
    rows, markets = [], {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for market, current in pool.map(read, MARKETS):
            ok = bool(current)
            if not current:
                current = [r for r in previous['rows'] if r['market']==market]
            rows.extend(current)
            markets[market] = dict(count=len(current),error=not ok)
            print(market, len(current), max((r['report_date'] for r in current),default='none'), 'fresh' if ok else 'fallback', flush=True)
    result = dict(generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),rows=rows,markets=markets,histories={})
    target = ROOT/'frontend/workspace/snapshot.js'
    target.parent.mkdir(exist_ok=True)
    target.write_text('window.AGX_SNAPSHOT='+json.dumps(result,separators=(',',':'))+';',encoding='utf-8')
