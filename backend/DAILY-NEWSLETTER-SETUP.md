# Daily report delivery

Implementation is gated off until configuration and database migration are complete.
No additional paid service is required: existing GitHub Actions, Supabase and Resend.

## Activate in order

1. Apply `migrations/009_daily_newsletters.sql` in Supabase. It adds two private
   tables and an atomic claim function; it does not change subscriber choices.
2. Deploy the code, including the API that recognizes delivery management tokens.
3. Add `RESEND_API_KEY` to GitHub Actions secrets. Existing Supabase secrets remain.
4. Run Daily Data Update (it sets `NEWSLETTER_PREPARE_ENABLED=1`). This prepares
   successfully imported reports without sending. Manually run Daily report
   newsletters with `mode=dry_run`, then `mode=test` to send only New York
   vegetables to the owner's confirmed starmantra12@gmail.com subscription.
5. After the test passes, set Actions variable `NEWSLETTER_DELIVERY_ENABLED=1`.
   Subsequent completed imports trigger delivery of individually ready reports. Do this only when ready to send
   to all confirmed subscribers. Set the same variable in Railway so signup
   confirmation and management pages accurately describe delivery availability.

## Behavior and checks

- Only reports dated today in America/New_York are eligible. No historical backlog,
  missing-day substitutions or next-day catch-up. A report published after the last
  scheduled import will not be mailed by this first version.
- One email per selected market/category/date. Existing import schedules trigger
  checks through the day; this is publication-driven, not a guaranteed 7am digest.
- Unconfirmed, unsubscribed and nonmatching subscribers are excluded, with another
  preference check immediately before sending.
- `newsletter_deliveries` records sending, accepted, uncertain or cancelled.
  Accepted means the provider accepted the message. Check Resend for delivery,
  bounces and complaints; these are not yet synchronized back into this table.
- Unique database claims prevent duplicate jobs from sending the same report.
  An uncertain send is not automatically retried. Review Resend using the
  `daily/<delivery id>` idempotency key before any manual reconciliation.
  Never delete a claim just to retry: a message may already have been accepted.
- Management links use random tokens, stored as hashes, valid for one year;
  earlier links remain valid when newer daily emails are sent. GET never unsubscribes.
- `python backend/daily_newsletter.py` without the enabling variable is a read-only
  candidate count; it does not claim deliveries or send emails.
- GitHub marks sending errors as failed runs. Enable GitHub workflow failure
  notifications for the repository owner. A failed report is not marked ready;
  failures in shipping points or another market do not suppress ready reports.

## Before enabling

Run tests and a dry run after a successful import. Inspect recipient preferences
and readiness records, send an authorized test, open its dated report and use its
management link to verify unsubscribe. Do not enable customer delivery until these
production checks pass. No live test or activation is implied by local unit tests.

## Roll back

Set the GitHub repository variable `NEWSLETTER_DELIVERY_ENABLED=0` to stop scheduled
sends; set Railway's flag to 0 to update signup messaging. Preserve the delivery log.
