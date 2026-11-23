-- Plans (src/shared/plans/, src/server/plans/plan.ts): every account is on Free or Pro. An admin is always Pro; a
-- member is Pro while pro_granted_at is set, which an admin does from the Users page or scripts/db/users.ts. The plan
-- itself is never stored: proSql in plan.ts works it out from these columns on every request, so it can't drift.
-- pro_granted_by is the admin who gave it, kept as null when that admin's account is deleted, so the grant stays.
alter table users add column pro_granted_at timestamptz;
alter table users add column pro_granted_by bigint references users (id) on delete set null;

-- The starter book (0017_starter_book.sql) doesn't count toward either plan's book limit, so its row is marked. The
-- previous release inserts without the column and gets false, which only means a starter book it gives counts until
-- the next release reads it. Additive only: one column with a default.
alter table user_books add column starter boolean not null default false;

-- Marks the starter books already given. giveStarterBook inserts the copy and sets users.starter_book_at in one
-- transaction, and now() is that transaction's start time, so the book's created_at equals starter_book_at exactly; an
-- import is always a later transaction. An account that had removed the catalogue edition has starter_book_at and no
-- such book, so nothing matches. The previous release never reads the column, so this touches nothing it uses.
update user_books b set starter = true
from users u
where b.user_id = u.id and b.created_at = u.starter_book_at;
