"""Receive data corrections through the existing transactional email provider."""
import asyncio
import hashlib
import os
import re
import time
from collections import deque
from datetime import date
from uuid import UUID

import requests
from fastapi import APIRouter, HTTPException, Request


def validate(data):
    if not isinstance(data, dict):
        raise HTTPException(400, 'Invalid report.')
    result = {}
    for key, limit in [('market', 100), ('commodity', 100), ('report_date', 10),
                       ('reference', 1000), ('email', 254), ('description', 4000), ('website', 200)]:
        value = data.get(key, '')
        if not isinstance(value, str) or len(value) > limit:
            raise HTTPException(400, 'Please check the report fields and their lengths.')
        result[key] = value.strip()
    if result['website']:
        raise HTTPException(400, 'Unable to submit this report.')
    if len(result['description']) < 10:
        raise HTTPException(400, 'Please describe the issue in at least 10 characters.')
    if result['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', result['email']):
        raise HTTPException(400, 'Enter a valid email address or leave it blank.')
    if result['report_date']:
        try:
            date.fromisoformat(result['report_date'])
        except ValueError:
            raise HTTPException(400, 'Enter a valid report date.')
    try:
        result['submission_id'] = str(UUID(str(data.get('submission_id', ''))))
    except ValueError:
        raise HTTPException(400, 'Invalid submission. Please reload and try again.')
    return result


def create_router():
    router = APIRouter()
    # Bounded, per-process abuse protection. Never retain message content here.
    attempts = deque(maxlen=1000)

    @router.post('/data-issues')
    async def submit(request: Request):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 24000:
                raise HTTPException(413, 'Report is too large.')
        import json
        try:
            data = validate(json.loads(raw))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, 'Invalid report.')
        now = time.monotonic()
        while attempts and now - attempts[0][0] >= 3600:
            attempts.popleft()
        client = hashlib.sha256((request.client.host if request.client else 'unknown').encode()).hexdigest()
        if len(attempts) >= 60 or sum(1 for stamp, host in attempts if host == client and now-stamp < 60) >= 5:
            raise HTTPException(429, 'Too many reports. Please wait a few minutes and try again.')
        key = os.getenv('RESEND_API_KEY')
        if not key:
            raise HTTPException(503, 'Issue reporting is temporarily unavailable. Your report has not been sent.')
        attempts.append((now, client))
        message = '\n\n'.join(label + ':\n' + (data[field] or 'Not provided') for label, field in [
            ('Market', 'market'), ('Commodity', 'commodity'), ('Report date', 'report_date'),
            ('Page or report reference', 'reference'), ('Reply email', 'email'), ('Issue', 'description')])
        payload = {
            'from': os.getenv('DATA_ISSUES_FROM', os.getenv('NEWSLETTER_FROM', 'AgraX Reports <reports@agra-x.com>')),
            'to': [os.getenv('DATA_ISSUES_TO', 'hello@agra-x.com')],
            'subject': 'AgraX data correction', 'text': message,
        }
        if data['email']:
            payload['reply_to'] = data['email']
        def deliver():
            response = requests.post('https://api.resend.com/emails', headers={
                'Authorization': 'Bearer ' + key,
                'Idempotency-Key': 'data-issue/' + data['submission_id'],
            }, json=payload, timeout=20)
            response.raise_for_status()
            return response.json()
        try:
            delivered = await asyncio.to_thread(deliver)
            if not isinstance(delivered, dict) or not delivered.get('id'):
                raise ValueError('Missing delivery acknowledgement')
        except (requests.RequestException, ValueError):
            raise HTTPException(503, 'We could not confirm delivery. Please try again; your entries are still here.')
        return {'ok': True, 'reference': data['submission_id']}

    return router
