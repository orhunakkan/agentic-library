-- Runs once, when compose.yaml's volume is first created: the database the integration tests use, next to agentic_dev.
-- pnpm db:migrate only reads db/migrations/, so nothing here affects it.
create database agentic_test;
