# How to read this handbook

> **Language:** English | [فارسی](../fa/00-how-to-read.md)
> **Handbook version:** written for Rowlit 1.6.3 (code read at commit `23c7c50`)
> **In one sentence:** a two-part book, a database textbook followed by a guide to how Rowlit is built, that you can read from the first page as a beginner or enter at the chapter you need as a senior engineer.

This handbook has two goals. The first is to teach databases, from "what is a table" up to write-ahead logs, query
optimizers and replication, using one small data set that you can run on your own machine. The second is to explain,
in detail, how Rowlit (a desktop database client) is built: the .NET engine, the database providers, the React user
interface and the Electron shell. Part I does not depend on Rowlit at all. Part II assumes you know the vocabulary
of Part I and links back to it whenever a Rowlit feature rests on a database idea.

Everything is written twice. The English chapters live in `docs/handbook/en/`, the Persian chapters in
`docs/handbook/fa/`. The Persian version is a rewrite for Persian readers, not a word-for-word translation, but both
versions have the same chapters, the same headings, the same diagrams and the same code.

## 1. The two parts

**Part I, the database textbook (18 chapters).** It starts with files versus databases and the relational model,
teaches SQL in two steps, then goes under the hood: pages and storage, indexes, the optimizer, transactions,
locking and MVCC, logging and recovery, replication, tuning, security, columnar engines, the NoSQL families and a
side-by-side comparison of the eight relational dialects that Rowlit supports.

**Part II, the Rowlit handbook (24 chapters).** It starts with what a database IDE is and a tour of the screens,
then follows one user action at a time through the three processes (Electron main, renderer, .NET engine): connect,
run a query, stream rows into the grid, edit data, design a table, import, export, link databases, and so on. It ends
with security, the desktop shell, testing and the build and release pipeline.

A shared **glossary** (`glossary.md`, in both languages) defines every technical keyword used in either part and the
words that are specific to the Rowlit code base.

## 2. Levels

Every chapter states its primary level in the block at the top, and individual sections can be harder than the
chapter average.

| Level | Reader | What you can expect |
|---|---|---|
| **L1 beginner** | You can use a computer and have written, at most, a spreadsheet formula. | Plain language, one idea at a time, no prerequisites outside the book. |
| **L2 practitioner** | You write SQL or application code that talks to a database. | Why queries behave as they do, how engines differ, how to avoid common mistakes. |
| **L3 senior** | You tune, operate or build database software. | Internals, trade-offs, engine-specific behaviour, failure modes. |

Material that is clearly harder than the rest of its chapter is set apart in a block that starts with
`> **Deep dive (L3)**`, or in a subsection titled "Deep dive: …". You can skip those blocks on a first read; the
text before and after them does not depend on them.

## 3. How a chapter is built

Every chapter follows the same template, so that you always know where to look.

```text
# N. Title
> Level, part, the commit that was read (Part II), a one-sentence summary,
> what you will learn, prerequisites
## 1. The idea (beginner)          two plain paragraphs first, then the concept
## 2. How it works (practitioner)  the mechanism, with diagrams and worked examples
## 3. Deep dive (senior)           internals and trade-offs
## 4. In each engine / Edge cases  Part I: a table per engine; Part II: limits and error codes
## 5. Exercises / How it is tested Part I: 3 to 6 exercises; Part II: the tests that cover the feature
## Related chapters
## Glossary terms introduced here
```

Part I chapters point to `part1/18-exercise-answers.md` for answers. Part II chapters end with a `Files` table that
lists the source files that implement the feature, which doubles as a reading list for the next maintainer.

## 4. Conventions

**Keywords.** A technical term is defined where it is first used in a chapter, in a clause or a sentence, and it
links to the glossary the first time it appears: [index](glossary.md#index) is an example. The glossary anchor is
always the lower-case English term with hyphens (`#b-plus-tree`), in both languages.

**Code.** Code blocks are fenced with the language (`sql`, `csharp`, `ts`, `bash`, `powershell`, `mermaid`). Part II
excerpts start with a comment that holds the file path and line range, for example
`// engine/src/DbStudio.Core/Services/EngineModules.cs:22-49`. The line numbers are valid at the commit recorded in
the chapter front block. When the code and an older planning document disagree, the chapters say so and follow the
code.

**Diagrams.** All diagrams are Mermaid, so GitHub renders them. Each has a bold caption such as
"Figure 3.1" that the text refers to. In the Persian chapters the labels inside diagrams are kept in English on
purpose, because Mermaid has no right-to-left support; the caption and the explanation around them are Persian.

**SQL examples.** SQL in Part I is complete and runnable. Where syntax differs between engines the example is
repeated under a heading with the engine name (`#### PostgreSQL`, `#### SQL Server`). Results are shown as small
tables. Where a result is not captured from a live server, it is labelled "illustrative output": it was computed
from the seed data and is what the query returns, but the formatting of a real client will differ slightly (for
example `120.50` versus `120.5`).

**Version claims.** An engine claim names the version it holds for ("PostgreSQL 17 does …"), and when the author could
not verify a detail the text says so. The versions the handbook targets are the same ones Rowlit's tests use:
PostgreSQL 17, SQL Server 2022, Oracle 23 Free, MySQL 8.4, MariaDB 11, SQLite 3.4x and later, ClickHouse 24.8,
Cassandra 5, Snowflake (current), Redis Stack 7.4, MongoDB 7, Kafka 3.8, Elasticsearch 8.15.

**Style.** No marketing language, no exclamation marks, short sentences, active voice.

## 5. The `shop` running example

Almost every Part I example uses the same tiny online-shop database, called `shop`. It is small on purpose: five
customers, six orders, four products. You can hold all of it in your head, which makes it possible to check a
result by hand. It has these tables:

| Table | Meaning | Rows |
|---|---|---|
| `countries` | where customers live | 3 (Germany, France, Japan) |
| `customers` | people who buy | 5 (Alice, Bob, Chie, Dora, Emil) |
| `products` | things for sale | 4 (Keyboard, Mouse, Monitor, Cable) |
| `orders` | one row per purchase | 6 |
| `order_lines` | which products belong to which order | 7 |
| `sales.invoices` | invoices (PostgreSQL and SQL Server only, in a second schema) | 2 |

The same data exists for every engine the project tests against, so a chapter can show you how one query looks in
PostgreSQL, SQL Server, Oracle, MySQL, SQLite and the rest. [Chapter I-02](part1/02-relational-model.md) draws the
model; [chapter I-18](part1/18-exercise-answers.md) shows how to start the servers and connect.

The data files that define `shop` are in the repository under `engine/tests/docker/` (`seed-postgres.sql`,
`seed-mssql.sql`, `seed-oracle.sql`, `seed-mysql.sql`, `seed-mariadb.sql`, `seed-clickhouse.sql`,
`seed-cassandra.cql`, `seed-snowflake.sql`, and so on) and `engine/tests/fixtures/shop.sqlite` for SQLite.
Rowlit's own built-in sample database (File, then open the sample database) is a different, larger SQLite database
with 300 customers and 1500 orders; the handbook always says which one it means.

## 6. Running the examples

You have three ways to follow along, from cheapest to most complete.

1. **SQLite, no installation.** Open `engine/tests/fixtures/shop.sqlite` in Rowlit, in the `sqlite3` command-line
   tool, or in any SQLite viewer. Most Part I queries run unchanged, except the ones that show a feature SQLite
   does not have.
2. **Docker, all engines.** `docker compose -f engine/tests/docker/compose.yml up -d` starts SQL Server, Oracle and
   PostgreSQL, MySQL, MariaDB, ClickHouse, Redis and MongoDB with the default command; compose profiles add Kafka,
   Cassandra, Elasticsearch and a Redis cluster. [Chapter I-18](part1/18-exercise-answers.md) lists every address and
   credential.
3. **Read only.** Every example shows its result, so you can read the book without running anything.

## 7. Map of Part I

| # | Chapter | Level | What it teaches |
|---|---|---|---|
| I-01 | [What a database is](part1/01-what-is-a-database.md) | L1 | Files versus a DBMS, client/server, embedded databases, who does what. |
| I-02 | [The relational model](part1/02-relational-model.md) | L1 | Relations, keys, NULL, relational algebra, the `shop` model. |
| I-03 | [SQL I: reading data](part1/03-sql-basics.md) | L1 | SELECT, joins, grouping, set operations, basic DML and DDL. |
| I-04 | [SQL II: advanced queries](part1/04-sql-advanced.md) | L2 | Subqueries, CTEs, window functions, pivoting, MERGE, JSON. |
| I-05 | [Data modelling and normalisation](part1/05-modelling-and-normalisation.md) | L2 | ER modelling, normal forms, constraints, data types. |
| I-06 | [Storage internals](part1/06-storage-internals.md) | L3 | Pages, heaps, clustered tables, large values, the buffer pool. |
| I-07 | [Indexes in depth](part1/07-indexes.md) | L3 | B-trees, hash, GIN/GiST/BRIN, covering and partial indexes, statistics. |
| I-08 | [The query pipeline and the optimizer](part1/08-query-processing.md) | L3 | Parsing, cost-based planning, join algorithms, reading EXPLAIN. |
| I-09 | [Transactions, ACID and isolation](part1/09-transactions-and-isolation.md) | L2-L3 | ACID, anomalies, isolation levels, savepoints. |
| I-10 | [Concurrency: locks, latches, MVCC](part1/10-concurrency-locking-mvcc.md) | L3 | Lock modes, deadlocks, MVCC in each engine. |
| I-11 | [WAL, redo/undo, checkpoints, recovery](part1/11-logging-and-recovery.md) | L3 | Write-ahead logging and crash recovery. |
| I-12 | [Backup, replication, HA, partitioning](part1/12-backup-replication-ha.md) | L2-L3 | Backups, PITR, replicas, sharding, CAP. |
| I-13 | [Performance tuning methodology](part1/13-performance-tuning.md) | L2-L3 | Measure first, anti-patterns, pagination, pooling. |
| I-14 | [Database security](part1/14-security.md) | L2 | Authentication, privileges, TLS, SQL injection, auditing. |
| I-15 | [OLTP, OLAP and columnar engines](part1/15-oltp-vs-olap-columnar.md) | L2-L3 | Row versus column storage, MergeTree, Snowflake. |
| I-16 | [NoSQL families and their internals](part1/16-nosql-families.md) | L2-L3 | Redis, MongoDB, Cassandra, Elasticsearch, Kafka. |
| I-17 | [The eight relational dialects compared](part1/17-dialect-comparison.md) | L2 | Quoting, literals, LIMIT, parameters, catalogs, EXPLAIN. |
| I-18 | [Answer key and lab setup](part1/18-exercise-answers.md) | L1 | Starting the servers, connecting, all answers. |

## 8. Map of Part II

| # | Chapter | Level |
|---|---|---|
| II-01 | [What a database IDE is and what Rowlit is](part2/01-what-is-a-database-ide.md) | L1 |
| II-02 | [A tour of the app](part2/02-tour-of-the-app.md) | L1 |
| II-03 | [Big-picture architecture](part2/03-big-picture-architecture.md) | L1-L3 |
| II-04 | [Running it from source](part2/04-development-setup.md) | L1 |
| II-05 | [The engine host: startup, REST API, errors](part2/05-engine-host-and-api.md) | L2-L3 |
| II-06 | [The WebSocket event protocol](part2/06-websocket-protocol.md) | L2-L3 |
| II-07 | [Engine modules, DI and keyed features](part2/07-engine-modules-and-di.md) | L3 |
| II-08 | [Connections, sessions and executing SQL](part2/08-connections-sessions-execution.md) | L2-L3 |
| II-09 | [Relational providers one by one](part2/09-relational-providers.md) | L3 |
| II-10 | [Catalog, metadata cache and the explorer](part2/10-catalog-and-metadata.md) | L2-L3 |
| II-11 | [IntelliSense](part2/11-intellisense.md) | L3 |
| II-12 | [The editor, formatter and snippets](part2/12-editor-and-formatter.md) | L2-L3 |
| II-13 | [The results grid and data editing](part2/13-results-grid-and-data-editing.md) | L2-L3 |
| II-14 | [Designers, DDL and object editing](part2/14-designers-and-ddl.md) | L2-L3 |
| II-15 | [Import, export, plans and ER diagrams](part2/15-import-export-plans-er.md) | L2 |
| II-16 | [Linked databases and federation](part2/16-linked-databases-federation.md) | L3 |
| II-17 | [Sources I: Redis and MongoDB](part2/17-sources-redis-mongo.md) | L2-L3 |
| II-18 | [Sources II: Kafka and Elasticsearch](part2/18-sources-kafka-elasticsearch.md) | L2-L3 |
| II-19 | [Security model and secrets](part2/19-security-and-secrets.md) | L2-L3 |
| II-20 | [UI architecture: React, Zustand, commands, platform](part2/20-ui-architecture.md) | L2-L3 |
| II-21 | [Logs and activity, resources and memory](part2/21-logs-activity-resources.md) | L2-L3 |
| II-22 | [The Electron shell](part2/22-desktop-shell.md) | L2-L3 |
| II-23 | [Testing and QA](part2/23-testing-and-qa.md) | L2 |
| II-24 | [Build, CI, release and contributing](part2/24-build-ci-release-contributing.md) | L2 |

## 9. Reading paths

- **Complete beginner.** I-01, I-02, I-03, I-05, then II-01 and II-02 to see the ideas in a tool. Return to I-04 when
  you meet subqueries or window functions.
- **Application developer.** I-03 and I-04 as a refresher, then I-07, I-08, I-09, I-13 and I-14. These five explain
  most of what goes wrong in production.
- **DBA or data engineer.** I-06 to I-12 in order, then I-15, I-16, I-17.
- **I only want to understand Rowlit.** II-01, II-02 and II-03 first, then jump to the feature you care about. Each
  Part II chapter lists the Part I chapters it builds on.
- **I want to contribute code.** II-03, II-04, II-07, II-23, II-24, then the chapter for the area you will touch.

## 10. A note on the code

Rowlit was called DbStudio until version 1.2.0. Many internal identifiers still contain `DbStudio` on purpose (the
assemblies `DbStudio.*`, the `dbstudio://` URL scheme, the `window.dbstudio` bridge, `DBSTUDIO_*` environment
variables). The handbook calls the product Rowlit and the identifiers by their real names.

## Related chapters

- [Chapter I-01: what a database is](part1/01-what-is-a-database.md), the first chapter of the book.
- [Chapter I-18: answer key and lab setup](part1/18-exercise-answers.md), where to start the example servers.
- [Chapter II-01: what a database IDE is](part2/01-what-is-a-database-ide.md), the first chapter of Part II.
- [Glossary](glossary.md).
