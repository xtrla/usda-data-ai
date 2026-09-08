-- AgraX — FDA food recalls, matched to the commodities we publish prices for.
--
-- Sourced from openFDA food enforcement (api.fda.gov/food/enforcement.json).
-- This is the primary FDA record, not a trade-press write-up of it.
--
-- IMPORTANT: FDA states this dataset must not be used to issue public recall
-- alerts, and that it does not update a recall's status after classification.
-- Records here are "as published by FDA on report_date" and nothing more.
-- Always show the FDA link so a reader can check current status themselves.

create table if not exists produce_recalls (
    id                  bigserial primary key,

    recall_number       text        unique not null,   -- FDA's own ID, e.g. F-0123-2026
    commodity           text,                          -- matched to our commodity list, null if unmatched
    classification      text,                          -- Class I / II / III
    status              text,                          -- status AT PUBLICATION, not live
    reason              text,                          -- reason_for_recall
    product_description text,
    recalling_firm      text,
    distribution        text,                          -- distribution_pattern (states)
    voluntary_mandated  text,

    report_date         date,                          -- FDA publication date
    initiation_date     date,                          -- when the firm acted
    fda_url             text,                          -- link to the FDA record

    created_at          timestamptz default now()
);

create index if not exists idx_recalls_commodity   on produce_recalls (commodity);
create index if not exists idx_recalls_report_date on produce_recalls (report_date desc);
create index if not exists idx_recalls_class       on produce_recalls (classification);

-- Match how produce_prices is configured (RLS off) so the ingest can write
-- with the same key. Revisit both together if you move to a service_role key.
alter table produce_recalls disable row level security;
