# Account welcome activation

Implementation is local until deployed and configured. Uses the existing Resend
account, not an AI task or another email service. No newsletter subscription is created.

1. Apply migrations/010_account_welcome.sql in Supabase.
2. Set ACCOUNT_WELCOME_WEBHOOK_SECRET in Railway to a new random secret (at least
   32 bytes). Keep the existing RESEND_API_KEY. Optional WELCOME_FROM overrides
   `AgraX <reports@agra-x.com>`; replies go to hello@agra-x.com.
3. Deploy the backend.
4. In Supabase Database Webhooks, create an INSERT webhook for auth.users:
   POST https://produce-iq-production.up.railway.app/webhooks/account-created
   Headers: Content-Type: application/json and Authorization: Bearer <same secret>.
   Set timeout to 30000 ms. Never put this secret in frontend code.
5. Create one new test account, confirm Resend's delivery status and the inbox,
   and verify account_welcome_deliveries contains status accepted plus provider_id.
   Test Google signup too if enabled. Existing users are not backfilled.

The welcome acknowledges creation; it does not replace Supabase verification.
Repeat events are deduplicated by an atomic database claim. `accepted` means
Resend accepted the request, not guaranteed inbox delivery. Uncertain attempts
and sending entries older than 15 minutes require reconciliation in Resend
before any manual retry. No blind automatic retries. Check Supabase net webhook
logs for failed calls; webhook failure before claiming requires an operator retry.

Reference: https://supabase.com/docs/guides/database/webhooks
