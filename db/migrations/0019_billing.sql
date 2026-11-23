-- Pro through Paddle (src/server/billing/). A subscriptions row is Paddle's subscription as Folio last heard of it,
-- from a signed webhook or reconcile.ts: whose it is (user_id, from the checkout's custom_data), what it costs
-- (price_id, cadence, founding) and where it stands (status and its dates). An account is Pro while one of its rows is
-- active, trialing or past_due (plans/plan.ts's proSql). Deleting the account cancels the subscription at Paddle first
-- and keeps the row, with user_id (on delete set null) and customer_id null, so the founding count never goes down.
-- event_at is the newest Paddle occurred_at applied: an older event arriving late changes nothing.
create table subscriptions (
  id text primary key check (id ~ '^sub_[a-z0-9]+$'),
  user_id bigint references users (id) on delete set null,
  customer_id text check (customer_id ~ '^ctm_[a-z0-9]+$'),
  price_id text not null check (price_id ~ '^pri_[a-z0-9]+$'),
  cadence text not null check (cadence in ('month', 'year')),
  founding boolean not null,
  -- Paddle's statuses today. One it adds later is refused until a migration widens this check, and the webhook answers
  -- 500 meanwhile, so Paddle keeps retrying (docs/features/billing.md).
  status text not null check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  -- current_billing_period.ends_at: the renewal, or with a scheduled cancel the day Pro ends.
  period_ends_at timestamptz,
  -- A cancel scheduled for the period's end (scheduled_change.effective_at).
  cancel_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  event_at timestamptz not null
);
create index subscriptions_user_idx on subscriptions (user_id);
-- For counting the founding subscriptions on every home page and Pro page view.
create index subscriptions_founding_idx on subscriptions (founding) where founding;

-- Every webhook event applied, by Paddle's event_id, so a delivery Paddle repeats changes nothing. Swept after 90
-- days with the other sweeps; Paddle retries for about two days, so an event is never applied twice.
create table paddle_events (
  event_id text primary key check (char_length(event_id) between 1 and 100),
  event_type text not null check (char_length(event_type) between 1 and 100),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index paddle_events_received_idx on paddle_events (received_at);
