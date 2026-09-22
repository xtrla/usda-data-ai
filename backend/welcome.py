"""One transactional welcome per account, triggered by a private database webhook."""
import asyncio
import os
import secrets
from uuid import UUID
import requests
from fastapi import APIRouter, HTTPException, Request
try:
    from email_templates import frame, button, SITE
except ModuleNotFoundError:
    from backend.email_templates import frame, button, SITE


def welcome_email():
    content = '<h1 style="font-size:28px;margin:0 0 18px">Welcome to AgraX.</h1><p style="font-size:16px;line-height:1.7">Your account is created. Explore produce prices, save your preferred market, and build your watchlist.</p>'
    content += button('Browse prices', SITE + '/browse')
    content += '<p style="font-size:15px;line-height:1.7;margin-top:28px">Want reports by email? Choose the markets and categories you follow.</p>'
    content += button('Choose your reports', SITE + '/#newsletter-heading')
    footer = 'You received this one-time welcome because an AgraX account was created with this email. Report subscriptions are optional and separate. If this was not you, contact hello@agra-x.com.'
    return dict(subject='Welcome to AgraX', html=frame(content, 'Your markets. Your prices. Welcome to AgraX.', footer),
                text='Welcome to AgraX. Your account is created.\nBrowse prices: '+SITE+'/browse\nChoose optional reports: '+SITE+'/#newsletter-heading\n'+footer)


def deliver_welcome(db, user_id):
    key = os.getenv('RESEND_API_KEY')
    if not key:
        raise HTTPException(503, 'Welcome email is not configured.')
    # Resolve the actual account; never accept a caller-provided recipient.
    user = db.auth.admin.get_user_by_id(user_id).user
    if not user or not user.email:
        return {'status': 'skipped'}
    if not db.rpc('claim_account_welcome', {'p_user_id': user_id}).execute().data:
        return {'status': 'already_claimed'}
    payload = welcome_email()
    payload.update({'from': os.getenv('WELCOME_FROM', 'AgraX <reports@agra-x.com>'),
                    'to': [user.email], 'reply_to': 'hello@agra-x.com'})
    try:
        response = requests.post('https://api.resend.com/emails', json=payload, timeout=20,
            headers={'Authorization': 'Bearer '+key, 'Idempotency-Key': 'account-welcome/'+user_id})
        response.raise_for_status()
        provider_id = response.json()['id']
        if not provider_id:
            raise ValueError('Missing acknowledgement')
    except (requests.RequestException, ValueError, KeyError):
        db.table('account_welcome_deliveries').update({'status': 'uncertain'}).eq('user_id', user_id).execute()
        raise HTTPException(503, 'Welcome delivery needs review.')
    db.table('account_welcome_deliveries').update({'status': 'accepted', 'provider_id': provider_id}).eq('user_id', user_id).execute()
    return {'status': 'accepted'}


def create_router(db):
    router = APIRouter()

    @router.post('/webhooks/account-created')
    async def created(request: Request):
        secret = os.getenv('ACCOUNT_WELCOME_WEBHOOK_SECRET')
        if not secret or not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer '+secret):
            raise HTTPException(401, 'Unauthorized')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 65536:
                raise HTTPException(413, 'Payload too large')
        import json
        try:
            event = json.loads(raw)
            if event['type'] != 'INSERT' or event['schema'] != 'auth' or event['table'] != 'users':
                raise ValueError('Unexpected event')
            user_id = str(UUID(event['record']['id']))
        except (ValueError, KeyError, TypeError):
            raise HTTPException(400, 'Invalid account event')
        return await asyncio.to_thread(deliver_welcome, db, user_id)
    return router
