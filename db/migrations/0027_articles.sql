-- Articles: a web article the reader saved is a private book of one chapter (user_books), marked by article_url, the
-- canonical address after redirects that its page was fetched from, and article_words, its length across its pages,
-- for the read time. Deleted as any private book is (Delete, or the account's deletion). Its own quota (20 on Free,
-- 500 on Pro) and duplicate check are in code, under the user-row lock, and use the index. An article is never an
-- audiobook; the check is added not valid and then validated, as no existing row has an article_url. Additive only:
-- two nullable columns, an index and a check.
alter table user_books add column article_url text check (char_length(article_url) between 1 and 2000);
alter table user_books add column article_words integer check (article_words between 0 and 10000000);
create index user_books_article_idx on user_books (user_id, article_url) where article_url is not null;
alter table user_books add constraint user_books_article_not_audio check (article_url is null or format is null) not valid;
alter table user_books validate constraint user_books_article_not_audio;
