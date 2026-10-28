# 17. The eight relational dialects compared

> **Level:** L2 practitioner | **Part:** I | **Rowlit code cited at:** `08528ae`
>
> **In one sentence:** every relational engine speaks "SQL", but each speaks its own dialect, so the same idea (quote a name, take the first 10 rows, pass a parameter, find the columns of a table) is spelled eight ways.
>
> **You will learn:**
>
> - why dialects exist and which differences are cosmetic, which change meaning and which are real missing features
> - identifier quoting, case folding and name hierarchies for SQL Server, Oracle, PostgreSQL, MySQL/MariaDB, SQLite, ClickHouse, Snowflake and Cassandra
> - literals, comments, NULL handling, row limiting, dates, strings, types and generated keys side by side
> - placeholders, batch separators (`GO`, `/`, `DELIMITER`) and procedural languages
> - where each engine keeps its metadata, how transactions and DDL behave, and how to get a query plan
> - how to translate one real query into all eight engines
>
> **Prerequisites:** [Chapter 3 SQL I](03-sql-basics.md), [Chapter 4 SQL II](04-sql-advanced.md), [Chapter 9 transactions](09-transactions-and-isolation.md)
>
> **Twin:** [فارسی](../../fa/part1/17-dialect-comparison.md) | **Previous:** [16 NoSQL families](16-nosql-families.md) | **Next:** [18 Answer key and lab setup](18-exercise-answers.md)

> **Examples.** Queries use the `shop` seeds of the Docker lab (`engine/tests/docker/seed-*.sql`; SQLite's schema comes from the conformance fixture `engine/tests/DbStudio.Providers.Conformance/ShopSchema.cs`). The Docker engine was not running when this chapter was written, so no output was captured from a server. Where a result is shown it was computed by hand from the seed data and is labelled *computed from the seed*; other outputs are *illustrative*. Snowflake examples are documentation-only.

## 1. The idea (beginner)

SQL is a standard (ISO/IEC 9075) that has grown for decades: the core `SELECT … FROM … WHERE` is the same everywhere, and that is why this book could teach it once in [chapter 3](03-sql-basics.md). But every vendor also had users to serve before the standard caught up, so each engine added its own syntax, and each implemented the standard's rules in its own way. The result is a family of **[dialects](../glossary.md#dialect)**.

Think of languages that share an alphabet. Most words differ only in spelling (`LIMIT 10` or `TOP 10`). Some words look the same but mean something else (in Oracle an empty string is `NULL`; in PostgreSQL it is not). And some concepts have no translation at all (ClickHouse has no multi-statement transaction; SQLite has no users). A good SQL programmer keeps three kinds of difference apart:

1. **Spelling.** Same meaning, different syntax. Mechanical to translate.
2. **Semantics.** Same syntax, different behaviour (case folding, NULL ordering, integer division, implicit conversions). The dangerous kind: the query runs and returns something plausible but different.
3. **Capability.** The engine cannot do it (or does it very differently). You change the design, not the spelling.

This chapter is a reference with a method: a table per topic, the same `shop` examples throughout, and a worked translation at the end. The eight engines are SQL Server, Oracle, PostgreSQL, MySQL (with MariaDB), SQLite, ClickHouse, Snowflake and Cassandra ([CQL](../glossary.md#cql), the Cassandra Query Language, which is SQL-shaped but not relational).

**Where the dialect lives in a tool.** A database client must know these rules, because it has to tokenise your text, split it into statements, quote names it generates, bind parameters and page results. Rowlit encodes them in a few places that this chapter points to: the static class `DialectInfo` (`engine/src/DbStudio.Core/Models/DialectInfo.cs`), one `IdentifierRules` per provider, one parameter binder per provider, and the statement splitters in `ui/src/intel/split/`. Part II [chapter 9](../part2/09-relational-providers.md) describes them as a whole.

## 2. How it works (practitioner)

### 2.1 The eight engines at a glance

| Engine | Version in the lab | Rowlit dialect token | Procedural language | Default port | Data hierarchy |
|---|---|---|---|---|---|
| SQL Server | 2022 | `tsql` | [T-SQL](../glossary.md#t-sql) | 1433 | server → database → schema → object |
| Oracle | 23 Free | `plsql` | [PL/SQL](../glossary.md#pl-sql) | 1521 | database (service) → schema (= user) → object |
| PostgreSQL | 17 | `pgsql` | [PL/pgSQL](../glossary.md#pl-pgsql) (and others) | 5432 | cluster → database → schema → object |
| MySQL / MariaDB | 8.4 / 11 | `mysql` | stored programs (`BEGIN…END`) | 3306 | server → database (= schema) → object |
| SQLite | 3.4x | `sqlite` | none (triggers only) | none (file) | file → schema (`main`, `temp`, attached) → object |
| ClickHouse | 24+ | `clickhouse` | none (SQL user-defined functions) | 8123 HTTP, 8443 HTTPS | server → database → table |
| Snowflake | current | `snowflake` | Snowflake Scripting (and JavaScript, Python, …) | 443 HTTPS | account → database → schema → object |
| Cassandra | 4 / 5 | `cql` | none (user-defined functions) | 9042 | cluster → [keyspace](../glossary.md#keyspace) → table |

The dialect tokens are the values of `enum Dialect { TSql, PlSql, Sqlite, PgSql, MySql, ClickHouse, Snowflake, Cql, DuckDb }` written in lower case on the wire (`engine/src/DbStudio.Core/Models/CoreModels.cs:14`). `DuckDb` ([DuckDB SQL](../glossary.md#duckdb-sql)) is not one of the eight: Rowlit uses it internally as the engine of linked databases (Part II [chapter 16](../part2/16-linked-databases-federation.md)); its parser is PostgreSQL's, which is why `DialectInfo` groups it with PostgreSQL for comments and `$$` strings (`DialectInfo.cs:35-48`). The ports are the defaults in Rowlit's connection forms (SQL Server's placeholder `host,1433`, Oracle `DefaultPort = 1521`, PostgreSQL `5432`, MySQL `3306`, ClickHouse `8123`/`8443`, Cassandra `9042`).

The hierarchy column matters more than it looks. `DialectInfo.HasDatabases` is true for SQL Server, PostgreSQL and Snowflake: a connection can switch between several databases. `DialectInfo.SchemaIsDatabase` is true for Oracle, MySQL/MariaDB, ClickHouse and Cassandra: there is only one level under the server, so Rowlit lists databases (or keyspaces, or Oracle users) where other engines list schemas (`DialectInfo.cs:10-17`). When a server reports no current schema, Rowlit falls back to `dbo` (SQL Server), `public` (PostgreSQL), `main` (SQLite), `default` (ClickHouse), `PUBLIC` (Snowflake) (`DialectInfo.cs:20-33`).

### 2.2 Names: quoting, case folding and the search for objects

A name such as `Order Date` (with a space) or `order` (a reserved word) must be **[quoted](../glossary.md#quoting)**. The characters differ:

| Engine | Quote characters | Doubling rule for the closing character | Also accepted |
|---|---|---|---|
| SQL Server | `[Order Date]` | `]` → `]]` | `"Order Date"` when `QUOTED_IDENTIFIER` is ON (the default) |
| Oracle | `"Order Date"` | `"` → `""` | — |
| PostgreSQL | `"Order Date"` | `"` → `""` | — |
| MySQL / MariaDB | `` `Order Date` `` | backtick → two backticks | `"…"` only with the `ANSI_QUOTES` SQL mode |
| SQLite | `"Order Date"` | `"` → `""` | `` `…` `` and `[…]`, for compatibility with MySQL and SQL Server |
| ClickHouse | `` `Order Date` `` | backtick doubled | `"…"` |
| Snowflake | `"Order Date"` | `"` → `""` | — |
| Cassandra | `"Order Date"` | `"` → `""` | — |

This table is the same data Rowlit uses to quote names it writes: `DialectInfo.IdentifierQuote` returns `[ ]` for SQL Server, backticks for MySQL and ClickHouse, and double quotes for the rest (SQLite accepts backticks but Rowlit writes `"`), and `DialectInfo.QuoteIdentifier` doubles the closing character (`DialectInfo.cs:53-62`). The lexer trait `BacktickIdentifiers` is true for SQLite, MySQL and ClickHouse (`:38-39`).

**Case folding.** What happens to an *unquoted* name? The standard says fold to upper case; engines disagree:

| Engine | Unquoted `Orders` is stored and found as | Quoted `"Orders"` | Rowlit's label (`IdentifierRules.CaseFolding`) |
|---|---|---|---|
| Oracle | `ORDERS` (upper) | exactly `Orders` | `upper` |
| Snowflake | `ORDERS` (upper) | exactly `Orders` | `upper` |
| PostgreSQL | `orders` (lower) | exactly `Orders` | `lower` |
| Cassandra | `orders` (lower) | exactly `Orders` | `lower` |
| SQL Server | as typed; comparison follows the **collation** (default: case-insensitive) | same | `preserve` |
| MySQL / MariaDB | as typed; table names are case-sensitive on Linux and not on Windows/macOS (`lower_case_table_names`) | same | `preserve` |
| SQLite | as typed; ASCII letters compare case-insensitively | same | `preserve` |
| ClickHouse | as typed; **case-sensitive** | same | `preserve` |

The labels come straight from the providers: `new('"', '"', "upper", …)` for Oracle and Snowflake, `"lower"` for PostgreSQL and Cassandra, `"preserve"` for the others (`OracleProvider.cs:65`, `SnowflakeProvider.cs:38`, `PostgreSqlProvider.cs:37`, `CassandraProvider.cs:28`, `SqlServerProvider.cs:19`, `MySqlProvider.cs:23`, `SqliteProvider.cs:51`, `ClickHouseProvider.cs:27`; the record is `CoreModels.cs:113-118`). The consequence is the classic trap:

```sql
-- PostgreSQL
CREATE TABLE "Orders" (id int);   -- stored as Orders, mixed case, forever needs quotes
SELECT * FROM Orders;             -- ERROR: relation "orders" does not exist
SELECT * FROM "Orders";           -- works
```

The same mistake in Oracle looks for `ORDERS` and fails with `ORA-00942: table or view does not exist`. This is also why the lab's tables are named differently per engine: SQL Server keeps PascalCase (`Customers`, `CustomerId`), Oracle and Snowflake use `UPPER_SNAKE` (`CUSTOMERS`, `COUNTRY_ID`) so unquoted names find them, and PostgreSQL, MySQL, SQLite, ClickHouse and Cassandra use `lower_snake` (`ShopSchema.cs:8-9` and `:31-39`). **Rule: do not use quoted mixed-case names unless you must; if you do, quote them every time.**

**Maximum length.** About 63 bytes in PostgreSQL, 64 characters in MySQL, 128 in SQL Server and (since 12.2) Oracle, 255 in Snowflake, 48 in Cassandra for keyspace and table names. These are as-of limits; check your version.

**Qualified names.** The number of dots follows the hierarchy of 2.1:

| Engine | Fully qualified table in the shop | Notes |
|---|---|---|
| SQL Server | `shop.dbo.Orders` | cross-database queries are allowed with three-part names; four parts reach a linked server |
| Oracle | `SHOP.ORDERS` | a schema is a user; other users' tables need `GRANT SELECT` |
| PostgreSQL | `public.orders` | one connection is bound to one database; use `search_path` (below) to omit the schema; cross-database needs `dblink` or a foreign data wrapper |
| MySQL / MariaDB | `shop.orders` | "database" and "schema" are synonyms; cross-database queries are normal |
| SQLite | `main.orders` | `ATTACH DATABASE 'archive.db' AS archive` adds another schema |
| ClickHouse | `shop.orders` | |
| Snowflake | `SHOP.PUBLIC.ORDERS` | `USE DATABASE`, `USE SCHEMA` set defaults |
| Cassandra | `shop.orders` | `USE shop` sets the default keyspace |

PostgreSQL resolves an unqualified name through the **[`search_path`](../glossary.md#search-path)**, a list of schemas, by default `"$user", public`: the first schema that has the object wins. Rowlit's PostgreSQL form has a `searchPath` field for it (`PgConnectionStrings.cs:31`).

### 2.3 Literals, comments and escapes

| | Text | Date and time | Boolean | Binary |
|---|---|---|---|---|
| SQL Server | `N'Zoë'` for Unicode, `'It''s'` | `'2026-01-05T10:00:00'` (ISO 8601 is language-safe; `'20260105'` too) | none: `BIT`, `1`/`0` | `0xDEADBEEF` |
| Oracle | `'It''s'`, `q'[It's]'` | `DATE '2026-01-05'`, `TIMESTAMP '2026-01-05 10:00:00'`, `TO_DATE('…','YYYY-MM-DD')` | `TRUE`/`FALSE` only in 23ai; older: `NUMBER(1)` | `HEXTORAW('DEADBEEF')` |
| PostgreSQL | `'It''s'`, `E'It\'s'`, `$$It's$$`, `$tag$…$tag$` | `DATE '2026-01-05'`, `'2026-01-05 10:00+00'::timestamptz` | `TRUE`, `FALSE` | `'\xDEADBEEF'` |
| MySQL / MariaDB | `'It''s'` and `'It\'s'` (backslash escapes) | `DATE '2026-01-05'`, `'2026-01-05 10:00:00'` | `TRUE`, `FALSE` (= 1, 0) | `X'DEADBEEF'` |
| SQLite | `'It''s'` | no date type: text `'2026-01-05'` plus functions | `TRUE`/`FALSE` since 3.23 (= 1, 0) | `X'DEADBEEF'` |
| ClickHouse | `'It\'s'` and `'It''s'` | `toDate('2026-01-05')`, `toDateTime('2026-01-05 10:00:00')` | `true`, `false` (`Bool`) | `unhex('DEADBEEF')` |
| Snowflake | `'It''s'`, `'It\'s'`, `$$It's$$` | `DATE '2026-01-05'`, `'2026-01-05'::DATE` | `TRUE`, `FALSE` | `X'DEADBEEF'` |
| Cassandra | `'It''s'`, `$$It's$$` | `'2026-01-05'`, `'2026-01-05T10:00:00Z'` strings | `true`, `false` | `0xDEADBEEF` |

The string-escape rules are lexer traits in `DialectInfo`: a backslash escapes the next character inside `'…'` in MySQL, ClickHouse and Snowflake (`BackslashStringEscapes`, line 45); `$$…$$` and `$tag$…$tag$` bodies exist in PostgreSQL, Snowflake, CQL and DuckDB (`DollarQuotedStrings`, line 48). This matters in practice: the text `C:\temp` is a plain string in PostgreSQL but contains an escape in MySQL, and a tool that does not know the difference splits statements in the wrong place.

**Comments.**

| | `-- line` | `/* block */` | Other |
|---|---|---|---|
| SQL Server | yes | yes, **nests** | |
| Oracle | yes | yes | |
| PostgreSQL | yes | yes, **nests** | |
| MySQL / MariaDB | yes, but needs a space after `--` | yes | `# line` |
| SQLite | yes | yes | |
| ClickHouse | yes | yes | `# line` |
| Snowflake | yes | yes | `// line` |
| Cassandra | yes | yes | `// line` |

The traits are `NestedBlockComments` (SQL Server, PostgreSQL, DuckDB), `HashLineComments` (MySQL, ClickHouse) and `SlashLineComments` (CQL, Snowflake) (`DialectInfo.cs:35-51`). Nested block comments let you comment out code that already contains a comment, but in an engine that does not nest, the first `*/` ends the comment early and the rest is parsed as SQL.

### 2.4 NULL, empty strings, sorting and booleans

- **Empty string versus NULL.** In **Oracle** `''` *is* `NULL`: `WHERE name = ''` never matches, `LENGTH('')` is `NULL`, and a `NOT NULL` column rejects `''`. Every other engine here treats them as different values. Rowlit's data editor encodes this: for `plsql` an empty string is considered null (`ui/src/data/sqlgen.ts:68`).
- **Where NULLs sort.** Without an explicit instruction:

| Engine | `ORDER BY x ASC` puts NULLs | `NULLS FIRST` / `NULLS LAST` keyword |
|---|---|---|
| SQL Server | first (NULL is the smallest) | not supported |
| Oracle | last (NULL is the largest) | supported |
| PostgreSQL | last | supported |
| MySQL / MariaDB | first | not supported |
| SQLite | first | supported since 3.30 |
| ClickHouse | last | supported |
| Snowflake | last (configurable by a session parameter) | supported |
| Cassandra | no NULL in keys; `ORDER BY` only on clustering columns | not applicable |

  To get the same order everywhere, sort on an expression: `ORDER BY (x IS NULL), x` puts NULLs last on engines where a boolean sorts false before true, or `ORDER BY CASE WHEN x IS NULL THEN 1 ELSE 0 END, x` on all of them.
- **Concatenating with NULL.** `'a' || NULL` is `NULL` in PostgreSQL, SQLite, Snowflake and ClickHouse, but Oracle's `||` treats NULL as an empty string (`'a' || NULL` is `'a'`). In SQL Server `'a' + NULL` is `NULL` (with the default `CONCAT_NULL_YIELDS_NULL ON`), whereas `CONCAT('a', NULL)` returns `'a'`. In MySQL `||` means logical OR unless `PIPES_AS_CONCAT` is set; use `CONCAT()`.
- **Booleans.** SQL Server has no boolean type, so `WHERE active` is invalid; write `WHERE active = 1`. MySQL's `BOOLEAN` is `TINYINT(1)`. Oracle added a real `BOOLEAN` in 23ai; before that, `NUMBER(1)`. SQLite stores 0 and 1.
- **Integer division.** `7 / 2` is `3` in SQL Server, PostgreSQL and SQLite (integer operands give an integer). Oracle returns `3.5` because its numbers are decimal. MySQL returns `3.5000`, Snowflake a decimal such as `3.500000`, and ClickHouse `3.5` (its `/` is floating point; use `intDiv` for the integer result). Always cast when a ratio matters.

### 2.5 Limiting rows and paging

| Engine | First 10 rows | Rows 21 to 30 |
|---|---|---|
| SQL Server | `SELECT TOP 10 * FROM dbo.Orders ORDER BY Id` | `… ORDER BY Id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` (needs `ORDER BY`) |
| Oracle | `… ORDER BY ID FETCH FIRST 10 ROWS ONLY` (12c+); before: `WHERE ROWNUM <= 10` on a subquery | `… ORDER BY ID OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` |
| PostgreSQL | `… ORDER BY id LIMIT 10` | `… LIMIT 10 OFFSET 20` |
| MySQL / MariaDB | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` (or `LIMIT 20, 10`: offset first!) |
| SQLite | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` |
| ClickHouse | `… LIMIT 10` | `… LIMIT 10 OFFSET 20` (or `LIMIT 20, 10`); also `LIMIT 2 BY customer_id` (top 2 per group) |
| Snowflake | `… LIMIT 10` or `TOP 10` or `FETCH FIRST 10 ROWS ONLY` | `… LIMIT 10 OFFSET 20` |
| Cassandra | `… LIMIT 10` | **no `OFFSET`**; page with the driver's paging state |

Rowlit's data grid generates exactly these forms: T-SQL gets `OFFSET … FETCH NEXT`, falling back to `TOP` before SQL Server 2012; Oracle gets `OFFSET … FETCH`, falling back to a `ROWNUM` wrapper before 12c; every other dialect gets `LIMIT … OFFSET …` (`ui/src/data/sqlgen.ts:466-487`). Remember that `OFFSET` pagination reads and discards all earlier rows, so deep pages get slower; see keyset pagination in [chapter 13](13-performance-tuning.md).

### 2.6 Everyday functions

| Task | SQL Server | Oracle | PostgreSQL | MySQL / MariaDB | SQLite | ClickHouse | Snowflake |
|---|---|---|---|---|---|---|---|
| now | `SYSDATETIME()`, `GETDATE()` | `SYSTIMESTAMP`, `SYSDATE` | `now()` | `NOW()` | `datetime('now')` | `now()` | `CURRENT_TIMESTAMP()` |
| add 7 days | `DATEADD(day, 7, d)` | `d + 7` | `d + interval '7 days'` | `DATE_ADD(d, INTERVAL 7 DAY)` | `date(d, '+7 day')` | `d + INTERVAL 7 DAY` | `DATEADD(day, 7, d)` |
| year of a date | `YEAR(d)` | `EXTRACT(YEAR FROM d)` | `EXTRACT(year FROM d)` | `YEAR(d)` | `strftime('%Y', d)` | `toYear(d)` | `YEAR(d)` |
| start of month | `DATEFROMPARTS(YEAR(d), MONTH(d), 1)` | `TRUNC(d, 'MM')` | `date_trunc('month', d)` | `DATE_FORMAT(d, '%Y-%m-01')` | `date(d, 'start of month')` | `toStartOfMonth(d)` | `DATE_TRUNC('month', d)` |
| join strings | `CONCAT(a, b)` or `a + b` | `a \|\| b` | `a \|\| b` | `CONCAT(a, b)` | `a \|\| b` | `concat(a, b)` | `a \|\| b` |
| length | `LEN(s)` (ignores trailing spaces), `DATALENGTH` | `LENGTH(s)` | `length(s)` | `CHAR_LENGTH(s)` | `length(s)` | `length(s)` (bytes), `lengthUTF8` | `LENGTH(s)` |
| first non-null | `ISNULL(a, b)`, `COALESCE` | `NVL(a, b)`, `COALESCE` | `COALESCE` | `IFNULL`, `COALESCE` | `IFNULL`, `COALESCE` | `ifNull`, `coalesce` | `NVL`, `IFNULL`, `COALESCE` |
| JSON field | `JSON_VALUE(j, '$.tier')` | `JSON_VALUE(j, '$.tier')` | `j ->> 'tier'` | `j ->> '$.tier'` | `j ->> '$.tier'` (3.38+) | `JSONExtractString(j, 'tier')` | `j:tier::string` |

Cassandra has few scalar functions (`now()`, `toTimestamp()`, `uuid()`, `toDate()`, `token()`); its date arithmetic and string functions are limited. `LEN` in SQL Server ignores trailing blanks, a frequent source of "why is it 5 and not 6".

### 2.7 Data types and generated keys

The `shop` seeds define the same columns in each engine. Reading them shows the type map:

| Meaning | SQL Server | Oracle | PostgreSQL | MySQL | SQLite | ClickHouse | Snowflake | Cassandra |
|---|---|---|---|---|---|---|---|---|
| 32-bit integer key | `INT` | `NUMBER(10)` | `integer` | `INT` | `INTEGER` | `UInt32` | `NUMBER(38,0)` | `int` |
| money | `DECIMAL(12,2)` | `NUMBER(12,2)` | `numeric(12,2)` | `DECIMAL(12,2)` | `DECIMAL(12,2)` (numeric affinity) | `Decimal(12, 2)` | `NUMBER(12,2)` | `decimal` |
| text, bounded | `NVARCHAR(100)` | `VARCHAR2(100)` | `varchar(100)` | `VARCHAR(100)` | `TEXT` | `String` | `VARCHAR(100)` | `text` |
| timestamp | `DATETIME2` | `DATE` (has a time part!) | `timestamptz` | `DATETIME` | `DATETIME` (stored as text/number) | `DateTime('UTC')` | `TIMESTAMP_NTZ` | `timestamp` |
| unique id | `UNIQUEIDENTIFIER` | `RAW(16)` | `uuid` | `CHAR(36)` / `BINARY(16)` | `TEXT` | `UUID` | `VARCHAR` | `uuid`, `timeuuid` |
| JSON | `NVARCHAR(MAX)` + `JSON_VALUE` | `JSON` (21c+) / `CLOB` | `jsonb` | `JSON` | `TEXT` + JSON functions | `JSON` / `String` | `VARIANT` | `text` |

Read the `CREATE TABLE` statements of the seeds for the exact definitions: `seed-mssql.sql:30-52`, `seed-postgres.sql:28-53`, `seed-mysql.sql:20-70`, `seed-clickhouse.sql:21-95`, and the table blocks of `seed-oracle.sql` and `seed-snowflake.sql`. Three type traps: **SQLite** uses *dynamic typing with type affinity*, so a `DECIMAL(12,2)` column may store a float or text unless the table is `STRICT` (3.37+); **Oracle `DATE`** carries hours, minutes and seconds; **ClickHouse** distinguishes `Nullable(T)`, which costs space and speed, so columns are non-null by default (`email Nullable(String)` in the seed is deliberate).

**Generated keys.** Automatic ids (an [identity column](../glossary.md#identity-column), MySQL's [auto_increment](../glossary.md#auto-increment), the older PostgreSQL [serial](../glossary.md#serial)) and "give me the id I just created" differ:

| Engine | Declare | Read the new key |
|---|---|---|
| SQL Server | `Id INT IDENTITY(1,1)`; or a `SEQUENCE` | `OUTPUT INSERTED.Id`, `SCOPE_IDENTITY()` |
| Oracle | `ID NUMBER GENERATED BY DEFAULT AS IDENTITY` (12c+); or a `SEQUENCE` and `seq.NEXTVAL` | `INSERT … RETURNING id INTO :out` |
| PostgreSQL | `id integer GENERATED BY DEFAULT AS IDENTITY`; older `serial` | `INSERT … RETURNING id` |
| MySQL | `id INT AUTO_INCREMENT PRIMARY KEY`; MariaDB also has `SEQUENCE` | `SELECT LAST_INSERT_ID()` |
| SQLite | `id INTEGER PRIMARY KEY` (alias of rowid); `AUTOINCREMENT` forbids reuse | `RETURNING id` (3.35+), `last_insert_rowid()` |
| ClickHouse | none; use `generateUUIDv4()` or ids from the application | not available |
| Snowflake | `IDENTITY(1,1)` / `AUTOINCREMENT`; or a `SEQUENCE` | query the sequence or use a returned value |
| Cassandra | none; `uuid()` / `timeuuid` (`now()`) | you generated it |

Rowlit's insert generator writes exactly these follow-ups: `OUTPUT INSERTED … INTO @ins` or `SCOPE_IDENTITY()` for T-SQL, `RETURNING … INTO :out` for Oracle, `RETURNING` for PostgreSQL, `LAST_INSERT_ID()` for MySQL, `RETURNING` or `last_insert_rowid()` for SQLite, and nothing for ClickHouse (`ui/src/data/sqlgen.ts:320-374`).

### 2.8 Parameters and batch separators

**Placeholders** (the syntax for a [bind variable](../glossary.md#bind-variable) in the statement text; see also [chapter 14](14-security.md)):

| Engine | What the server or driver accepts | Rowlit also accepts (it rewrites to the native form) |
|---|---|---|
| SQL Server | `@name`; names declared with `DECLARE` in the same batch are variables, not parameters; `?` is rejected | `@name` only |
| Oracle | `:name`, `:1` | `:name`, `:1` |
| PostgreSQL | `$1`, `$2`, … (positional) | `:name` and `@name`, rewritten to `$k`; `?` is never a placeholder because it is a jsonb operator |
| MySQL / MariaDB | `?` (prepared statement), `@var` is a user variable | `:name`, `@name` (only if a value is given), `?` |
| SQLite | `?`, `?NNN`, `:name`, `@name`, `$name` | all of these; bare `?` is rewritten to named |
| ClickHouse | `{name:Type}` (typed, server side) | `:name`, `@name`, rewritten to `{name:Type}` |
| Snowflake | `?`, `:1`, `:name` (bind variable or Scripting variable) | `:name`, `:1`, `?`; never `$1` (a staged-file column) |
| Cassandra | `?`, `:name` | `?`, `:name` |

The right-hand column is a tool feature, not a server feature. The Rowlit citations: SQL Server (`SqlServerParamBinder.cs:11-16`), Oracle (`OracleParamBinder.cs:10-17`), PostgreSQL (`PgParamBinder.cs:9-16`), MySQL (`MySqlParamBinder.cs:11-17`), SQLite (`SqliteParamBinder.cs:12-19`), ClickHouse (`ChParamBinder.cs:12-26`), Snowflake (`SnowflakeParamBinder.cs:12-18`), Cassandra (`CqlSession.cs:622-627`, where a missing positional or named value is reported).

**Batch separators and statement terminators.** `;` ends a statement in every engine, but some dialects have a *client-side* word that ends a **[batch](../glossary.md#batch-separator)** (a group sent to the server together):

| Engine | Separator | Who understands it | Notes |
|---|---|---|---|
| SQL Server | [`GO`](../glossary.md#go) on a line by itself (`GO 5` repeats five times) | the client tool (SSMS, `sqlcmd`), **not the server** | `CREATE PROCEDURE`, `CREATE VIEW` and others must be alone in a batch; variables do not cross a `GO` |
| Oracle | `/` on a line by itself ends a PL/SQL block | SQL\*Plus and compatible clients | PL/SQL blocks contain `;`, so `;` cannot end them; plain SQL statements are written without a trailing `;` in scripts that use `/` (as the lab's `seed-oracle.sql` does) |
| PostgreSQL | none; `;` | `psql` has `\g` | `$$ … $$` bodies hide inner semicolons |
| MySQL / MariaDB | [`DELIMITER //`](../glossary.md#delimiter) changes the terminator | the `mysql` client, **not the server** | needed around `CREATE PROCEDURE … BEGIN … END` |
| SQLite | `;` | | |
| ClickHouse | `;` | | one statement per HTTP request |
| Snowflake | `;` | | `$$ … $$` and `BEGIN … END;` Scripting blocks |
| Cassandra | `;` | | `BEGIN BATCH … APPLY BATCH` is a *server* construct (one atomic write unit), unrelated to client batches |

A driver sends one command at a time. If you feed a script containing `GO` or `DELIMITER` to a driver, the server sees a syntax error: those words are for the client. A tool such as Rowlit therefore has to do the splitting itself. It does so in the editor layer in TypeScript (`ui/src/intel/split/splitter.ts`): T-SQL batches by `GO [n]` lines, Oracle blocks by `/` lines, MySQL by `DELIMITER` (`split/mysql.ts:4-8`), Snowflake Scripting blocks (`split/snowflake.ts:1-6`) and CQL `BEGIN BATCH … APPLY BATCH` (`split/cql.ts:1-5`). The engine side keeps a second, smaller T-SQL splitter for diagnostics and notes that "the UI owns splitting for execution" (`engine/src/DbStudio.Providers.SqlServer/TSql/BatchSplitter.cs:12`). ClickHouse is the reverse case: the engine splits a batch into statements and sends each as its own HTTP request (`ChSession.cs:19`).

### 2.9 Procedural code

The same small job, "add 19% tax to an amount", written as a stored function. The first five come from the lab seeds:

```sql
-- PostgreSQL (seed-postgres.sql)
CREATE FUNCTION public.fn_tax(amount numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$ SELECT amount * 0.19 $$;

-- SQL Server (seed-mssql.sql)
CREATE FUNCTION dbo.fnTax (@amount DECIMAL(12,2)) RETURNS DECIMAL(12,2) AS
BEGIN
    RETURN @amount * 0.19;
END

-- Oracle (seed-oracle.sql)
CREATE OR REPLACE FUNCTION FN_TAX(p_amount IN NUMBER) RETURN NUMBER IS
BEGIN
  RETURN ROUND(p_amount * 0.19, 2);
END FN_TAX;
/

-- MySQL (seed-mysql.sql)
CREATE FUNCTION fn_tax(amount DECIMAL(12,2)) RETURNS DECIMAL(12,2)
  DETERMINISTIC NO SQL
BEGIN
  RETURN amount * 0.19;
END

-- ClickHouse (seed-clickhouse.sql): a user-defined function is just a lambda
CREATE OR REPLACE FUNCTION tax AS (amount) -> amount * 0.19;
```

Notes on each language:

- **T-SQL** (Transact-SQL): variables are `@name` (`DECLARE @x INT`), blocks are `BEGIN … END`, errors use `TRY … CATCH` and `THROW`, output uses `PRINT`, procedures have `OUTPUT` parameters, and a procedure can return several result sets.
- **PL/SQL**: `DECLARE … BEGIN … EXCEPTION … END;` blocks, **packages** (a specification plus a body that group procedures and functions), `DBMS_OUTPUT.PUT_LINE` for messages, and `REF CURSOR` parameters for returning rows. The lab's `ORDER_API` is a package.
- **PL/pgSQL**: a language you choose per function with `LANGUAGE plpgsql` (others: `sql`, Perl, Python…), bodies written between `$$…$$`, `RAISE NOTICE` for messages, `DO $$ … $$` for anonymous blocks, `CALL` for procedures (since 11).
- **MySQL stored programs**: procedures, functions, triggers and events; a body with several statements needs `DELIMITER` in the `mysql` client; handlers are `DECLARE … HANDLER`.
- **SQLite** has no stored procedures; logic lives in triggers (the lab has `trg_orders_total_check`) and in the host application.
- **ClickHouse** has SQL user-defined functions (above) and external executable functions, but no procedures.
- **Snowflake Scripting** is a SQL-based block language (`DECLARE … BEGIN … END;`); procedures can also be written in JavaScript, Python, Java or Scala. Bodies are usually wrapped in `$$ … $$`.
- **Cassandra** has [user-defined types](../glossary.md#udt) (UDT, like the `address` type of the seed), user-defined functions and aggregates (the seed's `line_total` is Java, enabled by `user_defined_functions_enabled`), and no procedures.

### 2.10 Where the metadata lives

Every engine describes itself in tables or views you can query. The names differ: [`information_schema`](../glossary.md#information-schema) (standard; PostgreSQL, MySQL, Snowflake, SQL Server), the [`sys` catalog views](../glossary.md#sys-catalog-views) (SQL Server), [`pg_catalog`](../glossary.md#pg-catalog) (PostgreSQL), the [`ALL_*` views](../glossary.md#all-views) (Oracle), [`sqlite_master`](../glossary.md#sqlite-master) (SQLite), the [`system.*` tables](../glossary.md#system-tables) (ClickHouse) and [`system_schema`](../glossary.md#system-schema) (Cassandra). These queries list the tables and columns of the `shop` data in each engine:

#### PostgreSQL — `information_schema` and `pg_catalog`

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema IN ('public', 'sales')
ORDER BY table_schema, table_name, ordinal_position;
```

`information_schema` is the standard portable view; `pg_catalog` (`pg_class`, `pg_attribute`, `pg_namespace`, `pg_type`) is the real, richer catalog that psql and Rowlit read.

#### SQL Server — `sys` catalog views

```sql
SELECT s.name AS [schema], t.name AS [table], c.name AS [column], ty.name AS [type]
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types ty ON ty.user_type_id = c.user_type_id
ORDER BY s.name, t.name, c.column_id;
```

#### Oracle — `ALL_*`, `USER_*`, `DBA_*`

```sql
SELECT table_name, column_name, data_type
FROM all_tab_columns
WHERE owner = 'SHOP'
ORDER BY table_name, column_id;
```

`USER_*` views show your own objects, `ALL_*` what you may see, `DBA_*` everything (needs a privilege). `V$` views show the running instance.

#### MySQL / MariaDB — `information_schema`

```sql
SELECT table_name, column_name, column_type
FROM information_schema.columns
WHERE table_schema = 'shop'
ORDER BY table_name, ordinal_position;
```

#### SQLite — `sqlite_master` and `pragma_*`

```sql
SELECT m.name AS "table", p.name AS "column", p.type
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\'
ORDER BY m.name, p.cid;
```

#### ClickHouse — `system.*`

```sql
SELECT `table`, name, type
FROM system.columns
WHERE database = 'shop'
ORDER BY `table`, position;
```

#### Snowflake — `INFORMATION_SCHEMA` and `SHOW`

```sql
SELECT table_name, column_name, data_type
FROM SHOP.INFORMATION_SCHEMA.COLUMNS
WHERE table_schema = 'PUBLIC'
ORDER BY table_name, ordinal_position;
```

`INFORMATION_SCHEMA` needs a running [warehouse](../glossary.md#warehouse) (see [chapter 15](15-oltp-vs-olap-columnar.md)); `SHOW TABLES` / `DESCRIBE TABLE` / `GET_DDL(...)` run in the cloud services layer and need none, which is what Rowlit uses (`SnowflakeCatalogReader.cs:12-13`). Account-wide history is in `SNOWFLAKE.ACCOUNT_USAGE`.

#### Cassandra — `system_schema`

```sql
SELECT table_name, column_name, type, kind
FROM system_schema.columns
WHERE keyspace_name = 'shop';
```

These match the catalog queries in the Rowlit providers: `sys.objects` and `sys.columns` (`SqlServerCatalogQueries.cs`), `pg_class` and `pg_attribute` (`PgCatalogQueries.cs`), `all_tab_cols` and `all_objects` (`OracleCatalogQueries.cs`), `information_schema.TABLES` and `COLUMNS` (`MySqlCatalogQueries.cs`), `sqlite_master` and `pragma_table_xinfo` (`SqliteCatalogReader.cs:184-194`), `system.tables` and `system.columns` (`ChCatalogReader.cs`), `SHOW` commands (`SnowflakeCatalogReader.cs`), and `system_schema.keyspaces` and `system_schema.columns` (`CqlSchema.cs`).

### 2.11 Transactions and DDL

| Engine | Autocommit default | Begin a transaction | DDL inside a transaction | Default isolation |
|---|---|---|---|---|
| SQL Server | on | `BEGIN TRAN` | transactional (rolls back) | READ COMMITTED (locking; snapshot optional) |
| Oracle | **always in a transaction**; commit explicit | implicit; first DML starts one | **implicit commit** before and after DDL | READ COMMITTED |
| PostgreSQL | on | `BEGIN` | transactional (rolls back) | READ COMMITTED |
| MySQL / MariaDB | on | `START TRANSACTION` | **implicit commit** | REPEATABLE READ (InnoDB) |
| SQLite | on | `BEGIN` | transactional | SERIALIZABLE (one writer) |
| ClickHouse | statement-level | **none** | not applicable | not applicable |
| Snowflake | on | `BEGIN` | **DDL commits the open transaction** | READ COMMITTED |
| Cassandra | per statement | **none** (batches, lightweight transactions) | not applicable | not applicable |

The "DDL in a transaction" column is a flag in Rowlit's code: `TransactionalDdl: true` for PostgreSQL, SQL Server and SQLite, `false` for Oracle, MySQL, ClickHouse, Snowflake and Cassandra (`PgDdlScripter.cs:56`, `SqlServerDdlScripter.cs:52`, `SqliteDdlScripter.cs:42`, `OracleDdlScripter.cs:50`, `MySqlDdlScripter.cs:63`, `ChDdlScripter.cs:82`, `SnowflakeDdlScripter.cs:53`, `CqlDdlScripter.cs:62`). It decides whether a failed multi-statement schema change can be rolled back or leaves a half-applied schema.

The session-level facts come from the session classes: Oracle "is always in an implicit transaction" and commits after each batch in auto mode (`OracleSession.cs:41`); MySQL says DDL commits implicitly (`MySqlSession.cs:20`); Snowflake commits the open transaction before DDL (`SnowflakeSession.cs:23-25`); ClickHouse answers `NOT_SUPPORTED` for manual mode (`ChSession.cs:25`, `:32-33`); Cassandra rejects `BEGIN`/`COMMIT`/`ROLLBACK` and points to batches and lightweight transactions (`CqlSession.cs:32-35`). **Savepoints** are `SAVE TRANSACTION name` in T-SQL and `SAVEPOINT name` elsewhere (`sqlgen.ts:405`).

### 2.12 Getting a query plan

| Engine | Estimated plan (nothing runs) | Actual plan (runs the query) |
|---|---|---|
| SQL Server | `SET SHOWPLAN_XML ON` | `SET STATISTICS XML ON` |
| Oracle | `EXPLAIN PLAN FOR …` then `DBMS_XPLAN.DISPLAY` | run, then `DBMS_XPLAN.DISPLAY_CURSOR(…, 'ALLSTATS LAST')` |
| PostgreSQL | `EXPLAIN (FORMAT JSON) …` | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) …` |
| MySQL | `EXPLAIN FORMAT=JSON …` | `EXPLAIN ANALYZE …` (8.0.18+) |
| MariaDB | `EXPLAIN FORMAT=JSON …` | `ANALYZE FORMAT=JSON …` |
| SQLite | `EXPLAIN QUERY PLAN …` | the same (no runtime statistics) |
| ClickHouse | `EXPLAIN json = 1, indexes = 1 …`, `EXPLAIN PIPELINE …` | run, then read `system.query_log` |
| Snowflake | `EXPLAIN USING JSON …` | run, then `GET_QUERY_OPERATOR_STATS('<query id>')` or the Query Profile |
| Cassandra | no `EXPLAIN` | `TRACING ON` |

These are the statements Rowlit's plan readers issue (`SqlServerPlanReader.cs:10-15`, `OraclePlanReader.cs:11-17`, `PgPlanReader.cs:11-17` and the constants at `:21-22`, `MySqlPlanReader.cs:12-18`, `SqlitePlanReader.cs:9-12`, `ChPlanReader.cs:12-18`, `SnowflakePlanReader.cs:11-18`, `CqlSession.cs:37-39`). How to read the plans is the subject of [chapter 8](08-query-processing.md).

### 2.13 Upsert and merge

"Insert this row, or update it if it exists" ([chapter 4](04-sql-advanced.md)) has the most variants:

| Engine | Syntax |
|---|---|
| SQL Server, Oracle, Snowflake | `MERGE INTO target USING source ON … WHEN MATCHED THEN UPDATE … WHEN NOT MATCHED THEN INSERT …` |
| PostgreSQL | `INSERT … ON CONFLICT (id) DO UPDATE SET …` (and `MERGE` from 15) |
| MySQL / MariaDB | `INSERT … ON DUPLICATE KEY UPDATE …`, or `REPLACE INTO` (delete then insert) |
| SQLite | `INSERT … ON CONFLICT (id) DO UPDATE …`, or `INSERT OR REPLACE` |
| ClickHouse | no update semantics: insert a new version into a `ReplacingMergeTree` ([chapter 15](15-oltp-vs-olap-columnar.md)) |
| Cassandra | every `INSERT` is an upsert; `IF NOT EXISTS` makes it conditional |

### 2.14 A worked translation

**The question:** "Who are the top three customers by revenue since 1 January 2026, with their country?" The seed data (identical in all relational engines) gives this answer, computed by hand:

| name | country | revenue |
|---|---|---|
| Dora | Germany | 254.25 |
| Bob | France | 199.00 |
| Alice | Germany | 140.00 |

(Dora: orders 5 and 6, 5.25 + 249.00; Bob: order 3, 199.00; Alice: orders 1 and 2, 120.50 + 19.50. Chie has 54.15 and Emil has no orders.)

#### PostgreSQL

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM public.customers c
JOIN public.orders o ON o.customer_id = c.id
LEFT JOIN public.countries k ON k.id = c.country_id
WHERE o.order_date >= DATE '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

#### SQL Server

Names are PascalCase, there is no `LIMIT` (use `TOP`), and the date literal is the language-safe form:

```sql
SELECT TOP 3 c.Name, k.Name AS Country, SUM(o.Total) AS Revenue
FROM dbo.Customers c
JOIN dbo.Orders o ON o.CustomerId = c.Id
LEFT JOIN dbo.Countries k ON k.Id = c.CountryId
WHERE o.OrderDate >= '20260101'
GROUP BY c.Name, k.Name
ORDER BY Revenue DESC;
```

#### Oracle

Names are upper case (unquoted, so any case works), table aliases take no `AS`, and rows are limited with `FETCH FIRST`:

```sql
SELECT c.NAME, k.NAME AS COUNTRY, SUM(o.TOTAL) AS REVENUE
FROM CUSTOMERS c
JOIN ORDERS o ON o.CUSTOMER_ID = c.ID
LEFT JOIN COUNTRIES k ON k.ID = c.COUNTRY_ID
WHERE o.ORDER_DATE >= DATE '2026-01-01'
GROUP BY c.NAME, k.NAME
ORDER BY REVENUE DESC
FETCH FIRST 3 ROWS ONLY;
```

#### MySQL / MariaDB

Identical to PostgreSQL once the schema is the database:

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM shop.customers c
JOIN shop.orders o ON o.customer_id = c.id
LEFT JOIN shop.countries k ON k.id = c.country_id
WHERE o.order_date >= DATE '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

#### SQLite

There is no `DATE '…'` literal; dates are text in ISO format, which compares correctly:

```sql
SELECT c.name, k.name AS country, SUM(o.total) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
LEFT JOIN countries k ON k.id = c.country_id
WHERE o.order_date >= '2026-01-01'
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

#### ClickHouse

Dates are typed, so convert the literal; the rest is familiar:

```sql
SELECT c.name, k.name AS country, sum(o.total) AS revenue
FROM shop.customers AS c
INNER JOIN shop.orders AS o ON o.customer_id = c.id
LEFT JOIN shop.countries AS k ON k.id = c.country_id
WHERE o.order_date >= toDateTime('2026-01-01 00:00:00', 'UTC')
GROUP BY c.name, k.name
ORDER BY revenue DESC
LIMIT 3;
```

ClickHouse joins prefer the smaller table on the right (see [chapter 15](15-oltp-vs-olap-columnar.md)); here `countries` is the smallest.

#### Snowflake (documentation-only)

Names are upper case; the timestamp column is `TIMESTAMP_NTZ`, and a string literal converts implicitly:

```sql
SELECT c.NAME, k.NAME AS COUNTRY, SUM(o.TOTAL) AS REVENUE
FROM SHOP.PUBLIC.CUSTOMERS c
JOIN SHOP.PUBLIC.ORDERS o ON o.CUSTOMER_ID = c.ID
LEFT JOIN SHOP.PUBLIC.COUNTRIES k ON k.ID = c.COUNTRY_ID
WHERE o.ORDER_DATE >= '2026-01-01'
GROUP BY c.NAME, k.NAME
ORDER BY REVENUE DESC
LIMIT 3;
```

#### Cassandra (CQL)

CQL has no joins and no `GROUP BY` across partitions, so this exact query cannot run. The Cassandra shop is modelled "one table per query" ([chapter 16](16-nosql-families.md)). You can total one customer in a single partition read:

```sql
SELECT sum(total) AS revenue
FROM shop.orders_by_customer
WHERE customer_id = 4;      -- Dora: 254.25
```

Ranking all customers is done in the application (read each customer's total) or in a precomputed summary table you maintain as orders arrive. That is a capability difference, not a spelling difference.

## 3. Deep dive (senior)

**Why a tool needs a lexer per dialect.** Take the text `SELECT 'C:\temp'; SELECT 2;`. In PostgreSQL, the first string is `C:\temp` and there are two statements. In MySQL, `\t` inside the quotes is an escape for a tab, which is harmless here, but `'It\'s'` shows the point: the engine sees one string `It's`, whereas PostgreSQL ends the string at the second quote and then fails. Add `$$` bodies (a function body that contains `;`), nested comments, `#` comments and `DELIMITER`, and splitting a script at semicolons is simply wrong. That is why `DialectInfo` exposes lexer traits (`BacktickIdentifiers`, `HashLineComments`, `BackslashStringEscapes`, `DollarQuotedStrings`, `SlashLineComments`, `NestedBlockComments`) and the tokenizer reads them instead of branching on the engine name: "a new dialect never edits the tokenizer" (`DialectInfo.cs:5-7`).

**Case, collation and comparison.** Three independent settings decide whether `'a' = 'A'`: the identifier folding rule of 2.2 (for names), the **collation** (for text values), and the data type. SQL Server's default collation is case-insensitive and accent-insensitive; PostgreSQL's default is case-sensitive; MySQL's default `utf8mb4` collations are case-insensitive; SQLite compares case-sensitively by default for values (`BINARY`) unless the column declares `COLLATE NOCASE`; Oracle is case-sensitive unless `NLS_COMP`/`NLS_SORT` are set. A `WHERE name = 'alice'` that finds Alice on SQL Server and MySQL finds nothing on PostgreSQL, Oracle or SQLite. Test comparisons, not assumptions.

**Implicit conversion.** When types differ, engines convert by different rules. SQL Server converts according to *data type precedence* (a `VARCHAR` column compared with an `NVARCHAR` parameter is converted up, which can disable an index; see [chapter 13](13-performance-tuning.md)). PostgreSQL is strict: it refuses `integer = text` instead of guessing. MySQL is lenient and converts strings to numbers silently (`'abc' = 0` is true). SQLite compares by storage class. Oracle converts strings to numbers or dates using session settings (`NLS_DATE_FORMAT`), which can make a script work on one machine and fail on another. Prefer explicit `CAST` and typed literals (`DATE '…'`).

**Time zones.** `timestamptz` in PostgreSQL stores an instant (UTC) and converts on display; SQL Server `DATETIME2` has no zone and `DATETIMEOFFSET` does; Oracle has `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE` and `WITH LOCAL TIME ZONE`; MySQL `TIMESTAMP` is UTC-based while `DATETIME` is not; Snowflake has three types (`NTZ`, `LTZ`, `TZ`); ClickHouse stores the zone in the column type (`DateTime('UTC')`). The practical rule is the same everywhere: store instants in UTC with an unambiguous type and convert at the edges.

**Portability strategy.** Three levels are available: write to the common core (fewest surprises, least power), use an abstraction layer that generates SQL per dialect (ORMs, query builders; they hide spelling but not semantics), or write per-dialect SQL behind an interface and test each (what a database IDE does). Whatever you pick, keep a conformance test that runs the same scenarios on every engine: Rowlit does this with a shared suite for the relational providers (Part II [chapter 23](../part2/23-testing-and-qa.md)).

## 4. In each engine

The lexer traits of `DialectInfo` in one table (a tick means the trait is true for the dialect; source: `DialectInfo.cs:35-51`):

| Trait | T-SQL | PL/SQL | PgSQL | MySQL | SQLite | ClickHouse | Snowflake | CQL | DuckDB |
|---|---|---|---|---|---|---|---|---|---|
| nested `/* /* */ */` comments | yes | | yes | | | | | | yes |
| `` `name` `` identifiers | | | | yes | yes | yes | | | |
| `# …` line comments | | | | yes | | yes | | | |
| backslash escapes in `'…'` | | | | yes | | yes | yes | | |
| `$$ … $$` strings | | | yes | | | | yes | yes | yes |
| `// …` line comments | | | | | | | yes | yes | |
| has a database level (`HasDatabases`) | yes | | yes | | | | yes | | |
| schema is a database (`SchemaIsDatabase`) | | yes | | yes | | yes | | yes | |

Everything else in this chapter is held in the per-provider classes cited in each table.

## 5. Exercises

1. **Translate the paging query.** `SELECT TOP 5 OrderDate, Total FROM dbo.Orders ORDER BY Total DESC` is T-SQL. Write it for PostgreSQL, Oracle (12c or later), MySQL and Cassandra. For which one is it impossible, and why?
2. **Spot the dialect.** This statement was written for PostgreSQL and fails on SQL Server: `SELECT name || ' <' || email || '>' AS label FROM customers WHERE order_date > now() - interval '7 days' LIMIT 10`. List every construct that must change, and write the SQL Server version (use `dbo.Customers`, assume a `LastOrder` column).
3. **The quoted table.** In Oracle you ran `CREATE TABLE "Orders" (id NUMBER)`. The next day `SELECT * FROM orders` returns `ORA-00942`. Explain, then show two ways to make queries work. Does the same happen in SQL Server?
4. **Empty strings.** You insert `''` into a nullable `VARCHAR` column in PostgreSQL and in Oracle, then run `WHERE col IS NULL`. What does each return and why? How does this affect a unique index on the column?
5. **Which separator?** A script contains the lines `GO`, `/` and `DELIMITER $$`. Name the engine each belongs to, and say what happens if you send the whole script as one command through a driver.
6. **Find the metadata.** Write the query that lists the *names of all tables in the shop* for SQLite, ClickHouse and Cassandra, and explain how Cassandra's differs in shape from the other two.

## Answers

Answers are collected in [chapter 18](18-exercise-answers.md#chapter-17) and repeated here.

<details>
<summary>Show answers</summary>

1. PostgreSQL: `SELECT order_date, total FROM public.orders ORDER BY total DESC LIMIT 5;` (the lab's PostgreSQL columns are lower-case snake_case). Oracle: `SELECT ORDER_DATE, TOTAL FROM ORDERS ORDER BY TOTAL DESC FETCH FIRST 5 ROWS ONLY;`. MySQL: `SELECT order_date, total FROM orders ORDER BY total DESC LIMIT 5;`. Cassandra cannot do it as written: `ORDER BY` works only on clustering columns inside one partition, and `orders` has partition key `id`, so a "top 5 by total across all orders" needs a different table design (for example a table partitioned by a bucket with `total` as clustering key) or application-side sorting.
2. Changes: `||` becomes `+` or `CONCAT(...)`; `now()` becomes `GETDATE()` or `SYSDATETIME()`; `interval '7 days'` becomes `DATEADD(day, -7, GETDATE())`; `LIMIT 10` becomes `TOP 10`. Result: `SELECT TOP 10 CONCAT(Name, ' <', Email, '>') AS label FROM dbo.Customers WHERE LastOrder > DATEADD(day, -7, GETDATE());` (`CONCAT` also treats a NULL email as an empty string, unlike `+`.)
3. Quoted `"Orders"` is stored mixed-case. An unquoted `orders` folds to `ORDERS`, which does not exist. Fix: always write `"Orders"` (quoted), or recreate the table unquoted as `ORDERS`. In SQL Server, `CREATE TABLE [Orders]` and `SELECT * FROM orders` both work under the default case-insensitive collation, so it does not happen (it can on a case-sensitive collation).
4. PostgreSQL returns no row: `''` is a value, not NULL. Oracle returns the row: `''` is NULL. In a unique index, Oracle allows many `''` values (several NULLs do not conflict in a unique index on a single column), whereas PostgreSQL treats two `''` as duplicates and rejects the second.
5. `GO`: SQL Server (client tools such as SSMS/sqlcmd). `/`: Oracle (SQL\*Plus). `DELIMITER $$`: MySQL/MariaDB (`mysql` client). Sent as one command, each of these tokens is a syntax error, because none of them is a server statement; a tool must split the script itself.
6. SQLite: `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\';`. ClickHouse: `SELECT name FROM system.tables WHERE database = 'shop';`. Cassandra: `SELECT table_name FROM system_schema.tables WHERE keyspace_name = 'shop';`. Cassandra's catalog is itself a set of CQL tables partitioned by keyspace, so the filter is on the partition key (`keyspace_name`), as it must be.

</details>

## Related chapters

- [Chapter 3: SQL I](03-sql-basics.md) and [Chapter 4: SQL II](04-sql-advanced.md): the common core this chapter varies.
- [Chapter 5: Modelling and normalisation](05-modelling-and-normalisation.md): data types, keys and constraints.
- [Chapter 8: Query processing](08-query-processing.md): reading the plans of 2.12.
- [Chapter 9: Transactions and isolation](09-transactions-and-isolation.md): autocommit, savepoints, isolation levels.
- [Chapter 13: Performance tuning](13-performance-tuning.md): implicit conversion and pagination.
- [Chapter 14: Security](14-security.md): placeholders and identifier quoting as injection defences.
- [Chapter 16: NoSQL families](16-nosql-families.md): Cassandra's data model.
- Part II: [chapter 9 relational providers](../part2/09-relational-providers.md) (where Rowlit encodes the rules in this chapter).

## Glossary terms introduced here

[dialect](../glossary.md#dialect), [quoting](../glossary.md#quoting), [case folding](../glossary.md#case-folding), [batch separator](../glossary.md#batch-separator), [GO](../glossary.md#go), [DELIMITER](../glossary.md#delimiter), [bind-variable styles](../glossary.md#bind-variable), [T-SQL](../glossary.md#t-sql), [PL/SQL](../glossary.md#pl-sql), [PL/pgSQL](../glossary.md#pl-pgsql), [CQL](../glossary.md#cql), [DuckDB SQL](../glossary.md#duckdb-sql), [auto_increment](../glossary.md#auto-increment), [serial](../glossary.md#serial), [identity column](../glossary.md#identity-column), [keyspace](../glossary.md#keyspace), [UDT](../glossary.md#udt), [warehouse](../glossary.md#warehouse), [search_path](../glossary.md#search-path), [information_schema](../glossary.md#information-schema), [sys catalog views](../glossary.md#sys-catalog-views), [pg_catalog](../glossary.md#pg-catalog), [ALL_* views](../glossary.md#all-views), [sqlite_master](../glossary.md#sqlite-master), [system.* tables](../glossary.md#system-tables), [system_schema](../glossary.md#system-schema).
