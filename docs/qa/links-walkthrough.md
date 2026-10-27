# Linked databases walkthrough (plan-links WP-D: federated SQL editor, Materialize, native links)

Goal: write and run one SQL statement across several connections, keep the result as a table, and (the other way) script a
native link on a server. This page covers the DuckDB SQL editor, the Materialize dialog, "Add to link…" and the native link
wizard; the link editor and the query builder have their own sections (WP-C). Run it twice:

1. **Mock**: `npm --prefix ui run dev:mock`, open `http://localhost:5173/?fresh`. Needs the `linked` mock pack to be active
   (`ui/src/mocks/packs/linked.ts`, WP-C): the link **Sales (linked)** over **Shop (SQLite)** (alias `shop`) and **Postgres
   Shop** (alias `crm`). The mock answers the catalog; `/links/{cid}/materialize*` and `/native-script` are answered by the
   engine only (use the live run for those).
2. **Live**: the docker sample servers (`engine/tests/docker/compose.yml`: SQL Server, PostgreSQL, MySQL, …, all with the
   same shop data), a link over them, a real engine (`DBSTUDIO_DATA_DIR` = a temp dir, never your profile).

Shortcuts are written for Windows; on macOS read Ctrl as ⌘.

## A. The federated SQL editor (DuckDB)

| # | Keys | Expected | Command id |
|---|---|---|---|
| 1 | Ctrl+Shift+K, **Sales (linked)** | A console on the link. The status bar says DuckDB; no Tx toggle, no Explain. The editor highlights DuckDB keywords. | `connections.openConsole` |
| 2 | type `select * from ` | Completion offers the aliases (`shop`, `crm`) and the default alias's tables, then the table functions (`range`, `generate_series`, `duckdb_tables`). | — |
| 3 | `shop.` | Completion lists the tables of the member, with their kind. `crm.customers.` lists the columns with their types (BIGINT, VARCHAR …). | — |
| 4 | `select * from shop.orders o join ` | The first suggestions are the foreign-key joins: `customers c ON c.id = o.customer_id`. With a virtual relation across links (e.g. `crm.customers.id` ↔ `shop.orders.customer_id`) the suggestion is written `crm.customers c ON …`. Pick one: the ON clause is filled. | — |
| 5 | `select list_tr` | `list_transform` with its signature `(list ANY[], lambda) → ANY[]` and a doc line. Typing `(` shows the parameter hint. Also `strftime`, `date_trunc`, `string_agg`, `arg_max` … | — |
| 6 | `where total > $min and id = $1` | `$min` and `$1` are highlighted as parameters, not strings or errors. Ctrl+Enter opens the Parameters dialog (name, type, value) before the run. A `$$ … $$` string with a `;` inside is one statement. | `run.statement` |
| 7 | `from shop.orders select * exclude (total) qualify row_number() over (order by id) <= 3` | FROM-first, EXCLUDE and QUALIFY run; the statement is classified as a query (no "destructive" prompt). | `run.statement` |
| 8 | `copy shop.orders to 'x.csv'` | Refused by the read-only guard (READ_ONLY): a linked console only runs queries; file access is switched off in the federation engine. | `run.statement` |
| 9 | Shift+Alt+F | Formatted DuckDB: `QUALIFY` on its own line and broken at AND / OR, `ASOF LEFT JOIN` as one phrase, `GROUP BY ALL`, `$min` and `::` casts untouched. Running it again changes nothing. | `format.document` |
| 10 | Ctrl+J, `xjoin` / `qualify` / `pivot` / `asof` / `lateral` | The snippet picker lists the DuckDB library (98 snippets; Query / DML / DDL / Programmability / DBA) with previews; `\$name` inserts a literal `$name`. | — |
| 11 | `select * from duckdb_tables()` | One row per mounted table (the aliases are the schemas). | `run.statement` |

## B. Add to link…

| # | Keys | Expected | Command id |
|---|---|---|---|
| 12 | Explorer → a table of **Postgres Shop** → right-click | **Add to link…** is in the menu (and not on a link's own tables, on routines, on Redis/Mongo/Kafka nodes). Same entry in the Objects tab's menu. | `links.addTable` |
| 13 | Choose **Sales (linked)**, *Add* | Toast "Added public.invoices to Sales (linked)" with *Open query builder*; the link now has the table (member `crm` if the connection and schema were already a member, else a new member with a slug alias, `postgres_shop`). A second time: "… is already in …", nothing saved. | `links.addTable` |
| 14 | *New link…* → *Continue* | The link editor opens with that member and table already in it (needs `links.new` to read `members`, see WP-D.md). | `links.addTable` |
| 15 | Ctrl+Shift+P, "Add to link" | With a table selected in the explorer the entry is enabled; otherwise it is hidden/disabled. | `links.addTable` |

## C. Materialize

| # | Keys | Expected | Command id |
|---|---|---|---|
| 16 | In the link console, cursor in `select c.name, sum(o.total) from crm.customers c join shop.orders o on … group by all`, Ctrl+Shift+P → "Materialize result to a table…" | The dialog shows the query, the target pickers (connection › database › schema; only writable, non-link connections), the mode (*Create table* / *Replace table* / *Append rows*) and a proposed name (`customers_materialized`). If the SQL has `$name`, the Parameters dialog comes first. | `links.materialize` |
| 17 | Pick **Postgres Shop**, schema `public` | After a short moment the *Table that will be created* box shows the DDL the engine would run (types mapped to PostgreSQL) and any warnings. | — |
| 18 | Name an existing table | In *Create* mode: "A table named … already exists …" and the button is disabled. *Replace*: a checkbox "The existing table … is dropped first" must be ticked. *Append*: the columns appended are listed; the datalist offers the schema's tables. | — |
| 19 | *Materialize* | Progress bar and "N rows written of M"; *Cancel job* stops it (rows already written stay). At the end: "N rows written to public.customers_materialized in 2.4 s" and **Open table**. | `links.materialize` |
| 20 | *Open table* | The table opens on the target connection (an Objects/data tab); the explorer has refreshed the schema. Reopening the dialog later preselects the same target. | — |
| 21 | Break the link (stop a member server), run again | The job ends with the engine's error (SOURCE_UNAVAILABLE …); *Try again* re-sends the same request. | — |
| 22 | Select a read-only connection as target (mock: none listed) | Read-only connections never appear as targets; with no writable connection the dialog says so. | — |

## D. Native links

| # | Keys | Expected | Command id |
|---|---|---|---|
| 23 | Explorer → the link → right-click → **Create native link…** (or Ctrl+Shift+P) | Wizard with Link (when there are several), *Member database*, *From server*, *Kind*, *Name*. The target list has SQL Server, PostgreSQL, Oracle, MySQL/MariaDB and ClickHouse connections, never the member's own server. | `links.nativeLink` |
| 24 | Member `crm` (PostgreSQL), from **Prod SQL** (SQL Server) | Script for a linked server (`sp_addlinkedserver`, `sp_addlinkedsrvlogin`) with `<password>`; the placeholders are highlighted and listed ("Replace before running"), notes list prerequisites (drivers, privileges). | — |
| 25 | From PostgreSQL to MySQL | Kind *Foreign data wrapper*: `CREATE EXTENSION mysql_fdw`, `CREATE SERVER`, `CREATE USER MAPPING`, `IMPORT FOREIGN SCHEMA`. Changing *Kind* or *Name* rewrites the script. | — |
| 26 | *Copy script* / *Open in console* | The script is copied, or a console titled "Native link: crm" opens on the target connection with the text; nothing is executed. Real secrets never appear (only the placeholders). | — |
| 27 | A pair the engine cannot script | The engine's message is shown in the script area; *Open in console* is disabled. | — |

## E. Live run over the docker servers (QA round)

Link `QA All` with every table of SQL Server (`ms`, dbo), PostgreSQL (`pg`), MySQL (`my`), Oracle (`ora`, SHOP), ClickHouse (`ch`)
and MongoDB (`mg`, db shop). Engine on a throw-away `DBSTUDIO_DATA_DIR`. Shop data: 5 customers, 6 orders, order 1 total 120.50.

| # | Run | Expected |
|---|---|---|
| 28 | `select o.id, o.total from pg.orders o where o.id = 1` | One row, total **120.50** (the scale of the source column is kept: not 120.5); the message says `pg.orders: 1 rows from PostgreSQL`, i.e. the predicate was pushed down. |
| 29 | `select c.Name, count(distinct o.id), sum(l.qty*p.price) from ms.Customers c join pg.orders o on o.customer_id=c.Id join pg.order_lines l on l.order_id=o.id join my.products p on p.id=l.product_id group by c.Name order by 1` | Alice 2 / 138.80, Bob 1 / 199.00, Chie 1 / 55.15, Dora 1 / 199.00 (SQL Server × PostgreSQL × MySQL). |
| 30 | `select * from ms.Orders o join ora.ORDERS a on a.ID=o.Id join ch.orders c on c.id=o.Id` | 6 rows, same totals on all three servers. |
| 31 | `select count(*) from mg.orders` and `select count(*) from mg.sessions` (empty collection) | 2000, then 0 (an empty collection still has `_id`). |
| 32 | `select count(*) from ch.orders_since` (a parametrised view) | "ch.orders_since has no columns the link can read …" (not "table does not exist"). |
| 33 | Link option `maxRowsPerSource` = 3, `select count(*) from mg.orders` | 3 and the warning "only the first 3 rows were read"; Refresh sources and raise the cap to get the real count. |
| 34 | Run `select count(*) from mg.orders a, mg.orders b, mg.orders c, mg.orders d`, Cancel after 2 s | Cancelled within a few hundred ms, the session is usable again, nothing else was changed. |
| 35 | Query builder: pg.orders + ms.Customers (auto-joined), Name + total, filter *matches regex* `^A` on Name, Run | `regexp_matches(Customers.Name, $fp1, 'i')` in the SQL panel, only Alice's orders; Edit SQL (Advanced) → Back to builder keeps the regex condition. |
| 36 | Materialize the join of step 29 to PostgreSQL / SQL Server / MySQL / MariaDB / Oracle / ClickHouse as `qa_mat_x`: Create, Create again (refused), Append (type the name in lower case also on Oracle), Replace | Six rows each time; decimals keep their scale (numeric(38,2), not (38,10)); the table is dropped afterwards. |
| 37 | Native link, target PostgreSQL, member `ms` (SQL Server, tables `Customers`, `Orders`) | `LIMIT TO ("Customers", "Orders")` and examples `ms."Customers"` (quoted: PostgreSQL folds unquoted names); password only as `<password>`. |

## F. Whole-database links (scopes)

A member now has a scope: **Tables** (explicit list), **Whole schema** (the former "mount all tables"), **Whole database**
(every schema of one database) or **Whole connection** (every database). Wide members are read lazily: the catalog holds only
the default schema's tables; other schemas load when a query, the builder or IntelliSense names them. Names in SQL:

| Scope | SQL Server / PostgreSQL / Snowflake | Oracle, SQLite (main + attached) | MySQL / MariaDB / ClickHouse / MongoDB / Cassandra | Elasticsearch |
|---|---|---|---|---|
| Whole database | `alias.schema.table`, default schema also `alias.table` | `alias.schema.table` | = Whole schema (`alias.table`; Mongo: every collection) | every index (`alias.index`) |
| Whole connection | `alias.database.schema.table`, default database `alias.schema.table`, default schema `alias.table` | = Whole database | `alias.database.table` | every index |

The engine table of a nested name is one quoted name (`crm."sales.orders"`); both spellings work in a console. A table written
`crm.sales.orders` in FROM without an alias gets the alias `orders`, so `orders.amount` works as on the source. Version 1 links
open unchanged (allTables becomes Whole schema). Files members have no scope.

| # | Keys | Expected | Command id |
|---|---|---|---|
| 38 | Explorer → **Prod SQL** → database `shop` → right-click → **Link database…** | Dialog: pick a link (adds a member `prod_sql`, scope Whole database) or *New link…* (editor opens with it). Again on the same link: "already covered", how to query it, nothing saved. On a schema node: **Link schema…** (scope Whole schema; on MySQL-like servers the schema node gives Whole database). MongoDB database node: Link database…. | `links.linkDatabase` / `links.linkSchema` |
| 39 | Link editor → a member → *Mount* selector | Tables / Whole schema / Whole database / Whole connection. Whole database shows only the database picker and "Query as alias.schema.table…"; Whole connection shows no pickers; only Tables / Whole schema show the table list. Files members have no selector. Saving writes `scope` + `allTables`, version 2. | `links.edit` |
| 40 | Link `Wide` = `ms` Whole connection on SQL Server + `pg` Whole database `shop` on PostgreSQL; console: `select c.name, count(distinct o.id) from ms.shop.dbo.Customers c join pg.public.orders o on o.customer_id = c.id group by 1 order by 1` | Alice 2, Bob 1, Chie 1, Dora 1. Messages `ms.Customers: 5 rows…` (default database + schema → two-part engine name) and `pg.orders: 6 rows…`. | `run.statement` |
| 41 | `select o.id from pg.sales.orders o where o.total > 100` (a non-default schema) | Only that schema is read (catalog unchanged until then); the plan shows `pg.sales.orders` with `"total" > 100` and the projection pushed. | `links.plan` |
| 42 | `select orders.total from pg.sales.orders` and `select crm.dbo.customers.id from crm.dbo.customers` | Both run (implicit alias `orders`; the default schema spelled out). A schema that does not exist: DuckDB's "does not exist" error naming it. | — |
| 43 | Builder → table list of a wide member | Default tables first, then databases → schemas → tables loaded on expand (spinner, error + Retry); *Search in alias…* reads matching containers; at most 500 rows per container. Adding `sales.orders` puts a card `orders`; the SQL panel writes `pg.sales.orders AS orders`. Edit SQL (Advanced) → Back to builder keeps the card. | `links.builder` |
| 44 | Console: `select * from pg.` / `pg.sales.` / `ms.Staging.` / `ms.Staging.dbo.` + Ctrl+Space; `from pg.sales.orders o where o.` | Schemas (and default tables); that schema's tables; Staging's schemas; its tables ("Loading…" first, then the list); the columns of orders. | — |
| 45 | Native link, target PostgreSQL, member `pg` (Whole database) / `ms` (Whole connection) | One `IMPORT FOREIGN SCHEMA` per remote schema into `pg_<schema>`; for SQL Server one tds_fdw server per database (`ms_<db>`), at most 25 schemas spelled out. Target SQL Server: no `@catalog` for a whole connection, and the note "reaches every database and schema…". MySQL FEDERATED: note that it maps one table at a time (default database only). | `links.nativeLink` |
| 46 | `delete from pg.sales.orders` | READ_ONLY, as for any link statement. | — |

Limits: a schema or table whose own name contains a dot is not supported in the multi-part spellings (use the engine spelling
`alias."schema.table"`); renames (`as`) apply to the default schema's tables only; IntelliSense shows nested tables' columns
only after a qualifier; native scripts list at most 25 schemas.

## Pass criteria

- Steps 3–5: completion works with no network (the link catalog is loaded once; `crm.` is instant).
- Step 8: nothing is written to any member by a linked console; the only writes are Materialize (to a connection you picked)
  and the link definition itself (Add to link…).
- Step 19: 100k rows materialize in under 30 s on the docker sample servers (WP-B acceptance), with progress.
- Dark and light themes: both dialogs use design tokens only (no hard-coded colours); Esc closes them (not while a job runs);
  the first field has focus; everything is reachable with Tab.
