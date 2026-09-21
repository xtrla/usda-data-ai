"""Shared AgraX email presentation. Rendering never sends an email."""
from datetime import date
from html import escape
from urllib.parse import urlencode, urlparse

SITE = 'https://www.agra-x.com'
LABELS = {'fruits':'Fruit','vegetables':'Vegetables','onions_potatoes':'Onions & potatoes','nuts':'Nuts'}

def safe_url(value):
    if urlparse(value).scheme != 'https':
        raise ValueError('Email links must use HTTPS')
    return escape(value, quote=True)

def frame(content, preheader, footer):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgraX market updates</title></head><body style="margin:0;background:#f3f5f1;color:#183b29;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{escape(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f1"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff"><tr><td bgcolor="#173d29" style="padding:25px 28px;background:#173d29"><a href="{SITE}" style="text-decoration:none"><img src="{SITE}/assets/agrax-logo-white-cropped.png" alt="AgraX" width="88" style="display:block;width:88px;height:auto;border:0;color:white;font-size:24px"></a></td></tr><tr><td style="padding:32px 28px">{content}</td></tr><tr><td style="padding:24px 28px;border-top:1px solid #e3e8e1;font-size:12px;line-height:1.7;color:#677369">{footer}<p style="margin:16px 0 0"><a href="mailto:hello@agra-x.com" style="color:#1f5236">hello@agra-x.com</a> · <a href="{SITE}/privacy" style="color:#1f5236">Privacy policy</a></p><p style="margin:12px 0 0">Source: USDA AMS Market News.<br>AgraX is independent and is not affiliated with USDA.</p></td></tr></table></td></tr></table></body></html>'''

def button(label, url):
    return f'<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#1f5236" style="border-radius:5px;background:#1f5236"><a href="{safe_url(url)}" style="display:inline-block;padding:15px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">{escape(label)} &rarr;</a></td></tr></table>'

def report_email(market, category, report_date, *, manage_url=None, test=False):
    label = LABELS[category]
    day = date.fromisoformat(report_date)
    display_date = day.strftime('%B') + f' {day.day}, {day.year}'
    report_url = SITE + '/reports?' + urlencode({'market':market,'category':category,'date':day.isoformat()})
    if not test and not manage_url:
        raise ValueError('Subscriber emails require a working preference management link')
    eyebrow = 'TERMINAL MARKET REPORT' + (' · TEST PREVIEW' if test else '')
    content = f'<p style="margin:0 0 12px;font-size:11px;letter-spacing:1.5px;color:#637468">{eyebrow}</p><h1 style="margin:0;font-size:32px;line-height:1.2;font-weight:bold;color:#173d29">{escape(market)}</h1><p style="margin:8px 0 26px;font-size:25px;line-height:1.3;font-weight:bold;color:#173d29">{escape(label)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 20px;background:#eef3ec;border-left:3px solid #1f5236"><p style="margin:0 0 6px;font-size:11px;letter-spacing:1px;color:#637468">REPORT DATE</p><p style="margin:0;font-size:25px;line-height:1.3;font-weight:bold;color:#173d29">{display_date}</p></td></tr></table><p style="margin:25px 0;font-size:15px;line-height:1.7;color:#47564b">View published wholesale prices by origin, variety, package and size, with market commentary and condition notes.</p>' + button('View full report', report_url) + '<p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#677369">Print or save a PDF from the report page.</p>'
    footer = '<p style="margin:0">This is a design preview using a dated report. Automatic morning delivery is not active.</p>' if test else '<p style="margin:0">You received this because you subscribed to this market and report category.</p>'
    if manage_url:
        footer += f'<p><a href="{safe_url(manage_url)}" style="color:#1f5236">Manage preferences or unsubscribe</a></p>'
    text = f'AgraX\n{market} — {label}\nReport date: {display_date}\nView full report: {report_url}\n'
    text += ('Test preview. Automatic morning delivery is not active.\n' if test else '')
    if manage_url: text += 'Manage preferences or unsubscribe: ' + manage_url + '\n'
    text += 'Contact: hello@agra-x.com\nAgraX is independent and is not affiliated with USDA.'
    return {'subject':f'{market} · {label} · {display_date}' + (' [Preview]' if test else ''),'html':frame(content,f'{market} {label} — report dated {display_date}',footer),'text':text}

def confirmation_email(selected, link):
    items = ''.join(f'<li style="padding:6px 0">{escape(p["market"])} — {escape(LABELS[p["category"]])}</li>' for p in selected)
    content = '<h1 style="margin:0 0 16px;font-size:28px;color:#173d29">Confirm your report choices</h1><p style="font-size:15px;line-height:1.7;color:#47564b">You selected these market reports:</p><ul style="padding-left:20px;font-size:15px;line-height:1.6;color:#47564b">'+items+'</ul><p style="margin:24px 0"></p>'+button('Confirm my choices',link)
    footer = '<p style="margin:0">This link expires in 24 hours. Morning report delivery is not active yet. If you did not request this email, ignore it; your preferences will not change.</p>'
    return {'html':frame(content,'Confirm the markets and reports you want to follow.',footer),'text':'Confirm your AgraX choices: '+link+'\nMorning delivery is not active yet. Link expires in 24 hours. Ignore if not requested.\nContact: hello@agra-x.com'}
