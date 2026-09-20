# Data correction form

The About the data form posts JSON to `POST /data-issues`. The frontend uses the existing `AGRAX_API_BASE`; both frontend and backend changes must be deployed before public submissions work.

Uses the existing `RESEND_API_KEY` and verified `NEWSLETTER_FROM` sender. Optional `DATA_ISSUES_FROM` overrides the sender; `DATA_ISSUES_TO` overrides the existing support destination (starmantra12@gmail.com). No database migration is required. Confirm sender availability in the deployment environment; missing configuration or rejected delivery returns an error, never success.

Only a provider acknowledgement produces success. Reports arrive as plain-text email; the optional user email is Reply-To, never the recipient. The form retains entries on errors and reuses its submission UUID when retrying an unchanged report, enabling provider idempotency. A changed report uses a new UUID. No email is sent back to submitters automatically.

Abuse controls: bounded request size, field validation, honeypot, five attempts per client connection address per minute and 60 attempts per process per hour. Limits are in-memory and reset on restart; proxy addresses may be shared. For scaled deployments, use a shared edge rate limiter. Message contents are not logged by the handler.

Tests: `PYTHONDONTWRITEBYTECODE=1 python3 backend/tests/test_data_issues.py`. Provider calls are mocked; no test emails are sent.
