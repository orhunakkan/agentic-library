-- Test accounts on dev (src/server/test-api/): test_account_at says when the test API made the account, and is null
-- for every other account. Only the test API sets it, and its delete and sweep touch only rows where it is set, so a
-- real account can never be deleted through them, whatever its name. The partial index serves the cap's count and the
-- sweep's search for old ones. Additive only: one nullable column and an index.
alter table users add column test_account_at timestamptz;
create index users_test_account_at on users (test_account_at) where test_account_at is not null;
