---
name: db-migration
description: Migrate an app's existing database (its own Postgres, Supabase, MySQL, SQLite, Mongo, …) onto a PLN (or PL)-provisioned Postgres database — schema and, by default, its existing data too, as one migration (skip the data half only if the member asks to start empty). Use whenever the member asks to migrate/move/switch their database to PLN's (or PL's) managed one, or whenever you notice during a deploy that the app talks to a non-PLN/PL database and the member wants to stop maintaining it themselves. Ends by handing off to the normal deploy flow's "Apps that want a provisioned database" step — this skill never provisions anything or talks to the deploy endpoints itself.
---

# Migrate an app's database to PLN Postgres

This skill turns an app that manages its own database into one that runs on a
PLN-provisioned Postgres (RDS) database. It only touches files inside `app/` —
provisioning the database, generating credentials, injecting them at runtime,
and running the deploy itself are handled entirely by the existing deploy flow
(see "Apps that want a provisioned database" in the **deploy-to-labs** skill).
Your job here is purely the application-side work: figure out what the app
currently does, carry over what can be carried over, rewrite what can't, and
tell the member plainly about anything that has to be handled another way.

**Never provision or guess credentials yourself.** You never create a database,
generate a username/password, or write a connection string by hand — that only
ever comes from the injected env vars after a real deploy with `database` set.

## Step 1 — Detect what the app currently uses

Look for the database/BaaS client and any existing migrations:

```bash
# Client / ORM / driver signatures
grep -rniE "@supabase/supabase-js|firebase-admin|firebase/(app|firestore)|mongoose|mongodb|prisma|knex|sequelize|typeorm|sqlite3|better-sqlite3|mysql2?\b|\bpg\b" \
  app --include='*.js' --include='*.ts' --include='*.tsx' --include='*.json' -l

# Env vars it reads for its DB/BaaS connection
grep -rniE "DATABASE_URL|SUPABASE_URL|SUPABASE_(ANON|SERVICE_ROLE)_KEY|MONGODB_URI|FIREBASE_|DB_HOST|DB_(USER|PASS)" \
  app --include='*.js' --include='*.ts' --include='*.env*'

# Existing migrations / schema
find app -type d \( -name migrations -o -name migrate -o -path '*/supabase/migrations' -o -path '*/prisma/migrations' \) 2>/dev/null
find app -iname 'schema.prisma' -o -iname 'schema.sql' 2>/dev/null
```

Identify: (a) which database engine the data actually lives in (Postgres, MySQL,
SQLite, MongoDB, Firestore — a BaaS built on Postgres, like Supabase, still
counts as Postgres underneath), (b) which client/ORM the app's code uses to talk
to it, and (c) whether real migration files exist or the schema only exists
ad-hoc (created by hand through a dashboard, or implicitly by an ORM's
`sync()`/`push`).

## Step 2 — Classify what's portable vs. provider-specific

**Portable to Postgres (carry it over):**
- Already Postgres underneath (a self-hosted Postgres, or a BaaS like Supabase
  that is Postgres+PostgREST) — the schema/DDL is already Postgres SQL or very
  close to it.
- Prisma / Knex / Sequelize / TypeORM migrations targeting any SQL database —
  translate the DDL, keep the migration structure.
- MySQL or SQLite schemas — translatable with the type-mapping notes in Step 3.

**NOT portable (report it, don't silently drop it):**
- Supabase Auth, Storage, or Realtime — these are managed services with no
  equivalent in a plain Postgres database. The app's own login should already
  go through PLN member context (see the **pln-member-context** skill) rather
  than a BaaS auth provider; file storage needs an external object store the
  member sets up separately; Realtime subscriptions have no PLN equivalent.
- Firebase/Firestore, DynamoDB, or any other non-relational document/KV store —
  the *data* can usually be reshaped into relational tables, but this is a real
  redesign, not a mechanical conversion; say so explicitly rather than
  attempting a lossy auto-conversion.
- Row Level Security (RLS) policies that key off a BaaS's own auth functions
  (e.g. Postgres RLS policies calling `auth.uid()`/`auth.role()` in Supabase) —
  these reference a function that won't exist on plain Postgres. If the app's
  authorization is actually enforced in the application layer (common: the app
  connects with a privileged service-role-style credential and does its own
  checks), RLS was acting only as a lock on a public data API the app no longer
  has — safe to drop and note in the report. If RLS was the *only* enforcement
  for some table, flag it: the app needs equivalent checks written in its own
  code before the data is reachable from a plain database connection.

## Step 3 — Reuse and adapt migrations into Postgres SQL

Write the result to `app/db/migrations/`, one `NNN_description.sql` file per
existing migration, kept in original order:

- **Source is already Postgres SQL** (self-hosted Postgres, or Supabase-style
  `supabase/migrations/*.sql`): copy the files over near-verbatim. Strip
  statements that only make sense in the source platform — `ALTER TABLE ...
  ENABLE ROW LEVEL SECURITY` / `CREATE POLICY ...` referencing `auth.*`
  functions (see Step 2), and any BaaS-managed schemas (`auth.*`,
  `storage.*`, `realtime.*`) which don't exist and aren't needed on plain
  Postgres. List every stripped statement in the report (Step 6) — never
  delete something silently.
- **Source is Prisma/Knex/Sequelize/TypeORM**: convert each migration's DDL
  into a numbered plain-SQL file. Keep column types, defaults, and constraints
  as close to the original as the target engine allows.
- **Source is MySQL**: common type conversions — `AUTO_INCREMENT` →
  `GENERATED ALWAYS AS IDENTITY` (or `SERIAL`), `TINYINT(1)` → `BOOLEAN`,
  `DATETIME`/`TIMESTAMP` → `TIMESTAMPTZ`, `ENUM(...)` → a Postgres `CREATE
  TYPE ... AS ENUM` or a `CHECK` constraint, `JSON` → `JSONB`, backtick
  identifiers → double quotes.
- **Source is SQLite**: SQLite's dynamic typing means every column is
  effectively untyped — infer the intended type from how the app uses the
  column (numeric vs. text vs. boolean vs. timestamp) rather than copying
  SQLite's declared type verbatim; `INTEGER PRIMARY KEY` → `GENERATED ALWAYS
  AS IDENTITY`/`SERIAL`.
- **No migrations exist at all** (schema was only ever created ad-hoc): infer
  the schema from the ORM's model definitions if there are any; failing that,
  from the client/BaaS's query calls in the app's code (table and column names,
  inferred types from how values are used). Say plainly in the report that the
  schema was reconstructed, not copied from a source of truth, and ask the
  member to sanity-check it before relying on it in production.

## Step 4 — Postgres extensions

Scan the generated SQL for functions that require an extension, and prepend a
`app/db/migrations/0000_extensions.sql` (runs before everything else) with
`CREATE EXTENSION IF NOT EXISTS "<name>";` for each one found:

| SQL uses… | Needs extension |
|---|---|
| `gen_random_uuid()` | `pgcrypto` |
| `uuid_generate_v4()` | `uuid-ossp` |
| case-insensitive text columns (`citext`) | `citext` |
| vector/embedding columns | `vector` (pgvector) |

The PLN database user can create/read/write in its own database but is **not a
superuser** — extension creation usually still works for these common ones on
managed Postgres, but if a deploy's migration run fails on `CREATE EXTENSION`,
say so plainly in the report as something PL Infra needs to enable, rather than
retrying blindly or assuming the migration SQL itself is wrong.

## Step 5 — Rewire the app's data-access code

Replace the BaaS/ORM client with a plain Postgres client reading the injected
connection env vars — but keep the app's *existing internal interface* so
business logic and routes don't need to change. If the app already has some
kind of data-access abstraction (a `Store`/`Repository`/`DAO` class or
module), add a new Postgres-backed implementation of that same interface
instead of rewriting every call site; if it doesn't, introduce a thin one now
so the database engine is swappable behind it.

- Use the injected env vars (`DATABASE_URL`, or the individual `DB_*`
  vars) exactly as documented in the deploy skill's "Apps that want a
  provisioned database" section — **including the mandatory SSL setup for your
  stack**, which is documented there in detail. Don't duplicate that guidance
  here; go read it before writing the connection code.
- Remove the old BaaS SDK dependency and its env vars (`SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, etc.) once nothing references them — leaving a
  dead dependency around invites someone reintroducing the old path by
  accident.
- Preserve query semantics, not just table shapes: a BaaS query-builder call
  like `.from('table').select('*').eq('col', value)` becomes a parameterized
  SQL query (`SELECT * FROM table WHERE col = $1`, `[value]`) — never
  string-interpolate user-supplied values into SQL.

## Step 6 — Wire a migration + data-copy runner into the app's own startup

**There is no platform-level migration step.** Provisioning a database only
injects connection env vars into the app's runtime — nothing on the PLN side
ever runs SQL against it, and there's no exec/init-container hook to run
anything else against it either. The app itself must apply its own schema
**and copy its own data — one migration, done together, by default** — once,
before it starts serving traffic.

Before writing anything, tell the member plainly what's about to happen:
this migration carries over both the **schema and the existing data**
automatically — the data half doesn't need a separate approval, just say
it's happening up front like any other part of the plan. Cover, in plain
language:

- It runs **once**, from inside the app's own container, the first time it
  boots with both the old database's credentials and the new
  `DATABASE_URL` present together.
- It is a **snapshot copy, not live sync** — any row written to the old
  database after the copy starts is not carried over. If the app takes live
  writes, mention the short cutover window (pausing writes, or accepting a
  follow-up top-up copy of just the newest rows may be needed).
- It **never deletes or modifies the old database** — that stays exactly as
  it is, as the fallback, until the member confirms the new one is good.
- **If the member would rather start the new database empty** (a throwaway
  dev/demo app, or they say so explicitly), skip the data half below and
  build the schema-only runner — that's the one case where data copy doesn't
  run.

Add a small runner (a project's own script, not a new heavy dependency) that
does both, in order:

### 6a. Schema, always

1. Connects using the same env vars and SSL setup as the app itself.
2. Ensures a tracking table exists, e.g.:
   ```sql
   CREATE TABLE IF NOT EXISTS _pln_migrations (
     filename TEXT PRIMARY KEY,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```
3. Reads `app/db/migrations/*.sql` in filename order, runs each one not
   already recorded in `_pln_migrations`, and records it after it succeeds —
   this makes redeploys idempotent (a second deploy with no new migration files
   does nothing).
4. Fails loudly (non-zero exit) if a migration errors, rather than starting the
   app against a half-migrated schema.

### 6b. Data, by default (skip only if the member asked to start empty)

Runs immediately after 6a succeeds, against the **same** two connections: the
old database (its existing client/driver and credentials — do not remove
these from the app yet, see Step 8) as the source, and the new
`DATABASE_URL` as the destination.

1. Track progress per table, not just once, so a killed/OOM'd container can
   resume instead of restarting the whole copy:
   ```sql
   CREATE TABLE IF NOT EXISTS _pln_data_copy (
     table_name TEXT PRIMARY KEY,
     rows_copied BIGINT NOT NULL DEFAULT 0,
     completed_at TIMESTAMPTZ
   );
   ```
2. Compute table order from the foreign keys in the migrations written in
   Step 3 (parents before children) — copying a child table before its parent
   trips every FK constraint. Skip any table already marked `completed_at`.
3. For each remaining table, stream rows in batches (e.g. 500–1000 rows per
   round-trip via keyset pagination on the primary key — never
   `SELECT *` a whole table into memory) and `INSERT ... ON CONFLICT (<pk>)
   DO NOTHING` into the destination. The `ON CONFLICT DO NOTHING` makes a
   half-finished table safe to re-run, on top of the per-table tracking.
   **Batch deliberately** — the runtime container has a **384Mi memory
   limit** (see `AGENTS.md`'s resource limits), so loading a large table
   whole risks an OOM kill mid-copy.
4. Coerce types per row the same way Step 3 mapped them in DDL (e.g. a MySQL
   `TINYINT(1)` source value becomes a Postgres `boolean`, MySQL/SQLite
   date strings become `timestamptz`) — don't just pass values through
   untyped and hope the driver guesses right.
5. After a table finishes, compare source vs. destination row counts; only
   write `completed_at` (and move on) if they match — a mismatch means it
   stays unmarked so the **next boot retries it** rather than silently calling
   an incomplete copy done.
6. For any column backed by a Postgres sequence/identity (carried over from
   an `AUTO_INCREMENT`/`SERIAL` source), reset the sequence after copying so
   the app's next insert doesn't collide with a copied row:
   ```sql
   SELECT setval(pg_get_serial_sequence('<table>', '<col>'),
                  COALESCE((SELECT MAX(<col>) FROM <table>), 1));
   ```
7. Log structured, greppable progress to stdout as it goes, e.g.
   `[db-migration] table=orders copied=4213/4213 status=complete` — this is
   how you (the agent) verify the copy after deploying, via the **app-logs**
   skill's runtime logs, since nothing in this runner's output is visible
   until then.

Wire the whole thing (6a then, unless skipped, 6b) to run **before** the main
process starts — as the first command in the Dockerfile's `CMD`/entrypoint
(e.g. `CMD ["sh", "-c", "node db/migrate.js && npm start"]`), not as a
separate deploy step, since none exists. Make sure it only runs migrations
(and the data copy) and exits — it must not itself bind to `$PORT` or the
platform's health check will never see the real app come up. If the data set
is large enough that the copy could meaningfully delay startup, say so to the
member plainly rather than silently shipping a slow first boot.

## Step 7 — Write the report

Produce `db-migration-report.md` in the working directory (not uploaded
anywhere — it's for you and the member to read) summarizing, in plain language:

- What was detected (source database/BaaS, ORM, existing migrations found).
- What was carried over automatically (migration count, extensions detected).
- Anything stripped or altered from the original migrations, and why (Step 2/3).
- Anything **not portable** (Step 2's second list) with a one-line explanation
  of what the member loses and what to do instead (e.g. "Supabase Storage isn't
  available — if the app needs file uploads, it'll need an external object
  store; ask if this matters before deploying").
- Whether the schema was reconstructed rather than copied from real migrations
  (Step 3's last bullet), if applicable.
- **The data copy** (on by default — Step 6b): the per-table `copied=X/Y`
  lines pulled from the runtime logs after the first deploy (Step 8), any
  table that didn't reach `status=complete`, and a reminder that anything
  written to the old database after the copy started was not carried over.
  If the member asked to start empty instead, say that plainly here too.

Summarize this for the member in plain, non-technical language — don't dump the
raw file on them unless they ask to see it.

## Step 8 — Hand off to the normal deploy flow

Once the code and migrations are ready:

1. Confirm locally that the app still starts and passes its own smoke checks
   with the runner wired in (you won't have a real `DATABASE_URL` to test
   against locally unless the member has one — at minimum, confirm the
   runner script has no syntax errors and the app still starts without it when
   no database is configured, if that was true before).
2. Follow the **deploy-to-labs** skill's "Apps that want a provisioned
   database" section: add `database: {"enabled":true,"type":"postgres"}` to
   the deploy/draft call and save it to `pln-app.config.json`, exactly as if
   the member had asked for a database for the first time.
3. Unless the member asked to start empty, **keep the old database's
   secret(s) registered** on this deploy — the 6b runner needs them one more
   time. Only drop them from `requiredEnvVars` on a *later* draft/deploy,
   once Step 7's report confirms every table reached `status=complete`.
4. If the member asked to start empty and the app no longer needs any of its
   old BaaS secrets, drop them from `requiredEnvVars` now (or deploy
   directly if no secrets remain at all).
5. The runner from Step 6 applies the schema — and, by default, copies the
   data — automatically the moment the newly-deployed container boots with its
   injected `DATABASE_URL` — there is nothing further to trigger by hand.
6. Unless the member asked to start empty, pull the app's **runtime logs**
   (the **app-logs** skill) after this deploy, read back the
   `[db-migration]` lines, and fold the real per-table results into
   `db-migration-report.md` (Step 7) before telling the member the
   migration is done — don't declare success from the plan alone.

## Rules

- Never invent or guess a connection string, username, or password — those
  only exist after a real deploy with `database` enabled, injected into the
  app's own runtime, for either database.
- Never silently drop a provider-specific feature — always land it in the
  report (Step 7), even if the member never asked about it.
- Don't attempt this migration on a database the member hasn't confirmed they
  want to move — this skill is for when they've explicitly asked, or you've
  proposed it and they've agreed (same approval bar as any other destructive-
  feeling change to their app).
- Data copy runs **by default** alongside the schema migration — don't treat
  it as a separate ask requiring its own approval. Just tell the member
  plainly, before deploying, that it's happening and what that means (Step
  6). Skip it only when the member explicitly says to start empty.
- Keep the old database's connection details intact until the member confirms
  the new one works — don't delete the app's ability to fall back, and don't
  remove them from the app's secrets while the default data copy hasn't yet
  been confirmed complete (Step 8).
- Never truncate, delete from, or write back to the **old** database from the
  copy runner — it is read-only source material, full stop.
