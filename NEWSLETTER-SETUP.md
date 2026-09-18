# Confirmed AgraX report subscriptions

## Implemented locally

- Signup stores specific market/category pairs (for example New York vegetables and Chicago fruit).
- `POST /newsletter/request` validates choices, creates a pending request and sends a Resend confirmation email.
- Existing subscriber choices are not changed until confirmation.
- Confirmation secrets are random, stored only as hashes, expire after 24 hours and are consumed by a database transaction. Confirming a request invalidates other pending requests for that email.
- Confirmation requires a button click (POST). Opening/scanning a link alone does not subscribe anyone.
- Successful confirmation provides a separate private, 30-day management link. Preferences and unsubscribe actions require that secret. Secrets stay in URL fragments, not query strings.
- Request limits: one confirmation per email per minute, at most five per day. Email errors never appear as success.
- Daily report delivery is still explicitly marked as unavailable. This does not generate PDFs or send scheduled market reports.

## Activation order

1. Apply migrations `004_subscriber_report_preferences.sql` and `005_newsletter_confirmation.sql` in Supabase, after the existing `003` migration. Neither new migration has been applied remotely.
2. Railway variables:
   - `RESEND_API_KEY`: the key already added by the owner.
   - `NEWSLETTER_FROM`: `AgraX Reports <reports@agra-x.com>` (also the code default).
   - `NEWSLETTER_SITE_URL`: `https://www.agra-x.com` (also the default).
3. Deploy the backend and frontend in a coordinated release. The email link targets `/newsletter/`, which must be deployed before testing real signup.
4. Test with the authorized recipient `starmantra12@gmail.com`: request choices, receive confirmation, confirm, change choices, unsubscribe, and verify replay of the confirmation fails.
5. Verify database row-level security and service-role-only permissions on the two new database functions in the deployed environment.

## Tests run

`python -m unittest discover -s backend/tests -p test_newsletter.py`

Seven isolated unit tests pass, with framework/network boundaries mocked. They cover pair preservation, malformed input, pending storage, hashed tokens, per-email request rejection, mail failure and confirmation success/expiry. SQL transactions have not been exercised against a real database. FastAPI is not installed in the local bundled Python, so a full backend integration test remains part of activation.

Browser checks confirmed the popup selects exactly New York vegetables plus Chicago fruit, renders all market choices, and produces no console errors. No production emails or database writes were performed this turn.

## Next phase

Implement validated publication records, background PDF creation, and a delivery queue. The sender must check confirmation/unsubscribe status at send time, record successful deliveries, prevent duplicates, and include working management/unsubscribe links in every report email. Refresh private links for outgoing emails and handle bounces/complaints before enabling automated delivery.
