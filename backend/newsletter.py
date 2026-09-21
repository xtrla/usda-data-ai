"""Confirmed report subscriptions. Secrets stay on the server; GET never confirms."""
import hashlib
import os
import re
import secrets
from datetime import datetime, timezone
import requests
from fastapi import APIRouter, HTTPException, Request
try:
    from email_templates import confirmation_email
except ModuleNotFoundError:
    from backend.email_templates import confirmation_email

CATEGORIES = {'fruits', 'vegetables', 'onions_potatoes', 'nuts'}
MARKETS = {'New York', 'Los Angeles', 'Chicago', 'Philadelphia', 'Miami', 'Boston',
           'Atlanta', 'Baltimore', 'Detroit', 'Columbia', 'Asheville'}

def digest(token):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
        raise HTTPException(400, 'Invalid link')
    return hashlib.sha256(token.encode()).hexdigest()

def preferences(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 48:
        raise HTTPException(400, 'Choose at least one report')
    result = []
    for pair in value:
        if (not isinstance(pair, dict) or not isinstance(pair.get('market'), str)
                or not isinstance(pair.get('category'), str)
                or pair['market'] not in MARKETS or pair['category'] not in CATEGORIES):
            raise HTTPException(400, 'Invalid market or category')
        item = {'market': pair['market'], 'category': pair['category']}
        if item not in result:
            result.append(item)
    return result

def create_router(db):
    router = APIRouter(prefix='/newsletter')

    async def body(request):
        if len(await request.body()) > 16000:
            raise HTTPException(413, 'Request too large')
        try:
            value = await request.json()
        except Exception:
            raise HTTPException(400, 'Invalid request')
        if not isinstance(value, dict):
            raise HTTPException(400, 'Invalid request')
        return value

    def account(token):
        rows = db.table('subscribers').select('id,report_preferences,unsubscribed').eq('manage_token_hash', digest(token)).gt('manage_expires_at', datetime.now(timezone.utc).isoformat()).execute().data
        if not rows:
            deliveries = db.table('newsletter_deliveries').select('subscriber_id').eq('manage_token_hash', digest(token)).gt('manage_expires_at', datetime.now(timezone.utc).isoformat()).limit(1).execute().data
            if deliveries:
                rows = db.table('subscribers').select('id,report_preferences,unsubscribed').eq('id', deliveries[0]['subscriber_id']).execute().data
        if not rows:
            raise HTTPException(410, 'This link has expired. Request a new confirmation from the homepage.')
        return rows[0]

    @router.post('/request')
    async def request_confirmation(request: Request):
        data = await body(request)
        email = data.get('email')
        if not isinstance(email, str) or len(email)>254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email.strip()):
            raise HTTPException(400, 'Enter a valid email')
        email = email.strip().lower()
        selected = preferences(data.get('reports'))
        key = os.getenv('RESEND_API_KEY')
        site = os.getenv('NEWSLETTER_SITE_URL', 'https://www.agra-x.com').rstrip('/')
        if not key:
            raise HTTPException(503, 'Email confirmation is not available yet')
        token = secrets.token_urlsafe(32)
        token_hash = digest(token)
        accepted = db.rpc('newsletter_request', {'p_email':email,'p_preferences':selected,'p_hash':token_hash}).execute().data
        if not accepted:
            raise HTTPException(429, 'Please wait before requesting another confirmation')
        link = site+'/newsletter/#confirm='+token
        message = confirmation_email(selected, link, delivery_enabled=os.getenv('NEWSLETTER_DELIVERY_ENABLED') == '1')
        try:
            response = requests.post('https://api.resend.com/emails',headers={'Authorization':'Bearer '+key,'Idempotency-Key':'confirm/'+token_hash},json={
                'from':os.getenv('NEWSLETTER_FROM','AgraX Reports <reports@agra-x.com>'),
                'to':[email], 'subject':'Confirm your AgraX report preferences',
                'reply_to':'hello@agra-x.com',
                **message},timeout=20)
            response.raise_for_status()
        except requests.RequestException:
            raise HTTPException(503, 'Could not send confirmation. Please try again later.')
        return {'ok':True,'confirmation_required':True}

    @router.post('/confirm')
    async def confirm(request: Request):
        data = await body(request)
        manage = secrets.token_urlsafe(32)
        result = db.rpc('newsletter_confirm',{'p_hash':digest(data.get('token')),'p_manage_hash':digest(manage)}).execute().data
        if not result:
            raise HTTPException(410, 'This confirmation has expired or was already used. Request a new one from the homepage.')
        return {'ok':True,'manage_token':manage}

    @router.post('/preferences/read')
    async def read_preferences(request: Request):
        row = account((await body(request)).get('token'))
        return {'reports':row['report_preferences'],'unsubscribed':row['unsubscribed'],
                'delivery_enabled':os.getenv('NEWSLETTER_DELIVERY_ENABLED') == '1'}

    @router.post('/preferences')
    async def save_preferences(request: Request):
        data = await body(request)
        row = account(data.get('token'))
        db.table('subscribers').update({'report_preferences':preferences(data.get('reports'))}).eq('id',row['id']).execute()
        return {'ok':True}

    @router.post('/unsubscribe')
    async def unsubscribe(request: Request):
        row = account((await body(request)).get('token'))
        db.table('subscribers').update({'unsubscribed':True}).eq('id',row['id']).execute()
        return {'ok':True}

    return router
