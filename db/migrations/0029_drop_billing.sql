-- Billing removed (spec/SPEC-billing-removal.md). The previous release no longer reads any of these, so they go.
drop table paddle_events;
drop table subscriptions;
alter table users drop column pro_granted_by;
alter table users drop column pro_granted_at;
