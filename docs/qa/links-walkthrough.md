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

## Pass criteria

- Steps 3–5: completion works with no network (the link catalog is loaded once; `crm.` is instant).
- Step 8: nothing is written to any member by a linked console; the only writes are Materialize (to a connection you picked)
  and the link definition itself (Add to link…).
- Step 19: 100k rows materialize in under 30 s on the docker sample servers (WP-B acceptance), with progress.
- Dark and light themes: both dialogs use design tokens only (no hard-coded colours); Esc closes them (not while a job runs);
  the first field has focus; everything is reachable with Tab.
