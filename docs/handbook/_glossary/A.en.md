<!-- Glossary fragment, package A (chapters I-01 to I-05, I-18). Rows: anchor, term, beginner meaning, deeper note, owner. Package H merges this into en/glossary.md. -->

<a id="aggregate"></a>
### aggregate — تابع تجمیعی
A function that turns many rows into one value: `count`, `sum`, `avg`, `min`, `max`. Aggregates skip NULLs (except `count(*)`); with `GROUP BY` they run once per group, with `OVER` they become window functions. *Owner: I-03.* See also: GROUP BY, window function.

<a id="alias"></a>
### alias — نام مستعار
A temporary name given to a column or table inside one statement with `AS`. Required for derived tables and self joins; select-list aliases cannot be used in `WHERE` in standard SQL. *Owner: I-03.*

<a id="anomaly"></a>
### anomaly — ناهنجاری
A failure caused by storing a fact in more than one place: the update anomaly (copies disagree), the insert anomaly (a fact cannot be stored without another), the delete anomaly (deleting one fact destroys another). Normalisation removes them. *Owner: I-05.* See also: normal form.

<a id="apply"></a>
### APPLY — APPLY
SQL Server and Oracle's `CROSS APPLY` / `OUTER APPLY`: a join in which the right side is evaluated for each row of the left side and may refer to its columns. The equivalent of the standard `LATERAL`. *Owner: I-04.* See also: LATERAL.

<a id="attribute"></a>
### attribute — صفت
Formal word for a column of a relation: a named property of the things the table describes. *Owner: I-02.* See also: relation, domain.

<a id="bag"></a>
### bag — چندمجموعه
A collection that may contain duplicates and has no order (a multiset). SQL tables and query results are bags; the formal relational model uses sets. This is why `UNION ALL` and `DISTINCT` exist. *Owner: I-02.*

<a id="candidate-key"></a>
### candidate key — کلید کاندید
A minimal set of columns whose values are unique in every row: remove any column and uniqueness is lost. A table can have several; one becomes the primary key, the others are alternate keys, usually declared `UNIQUE`. *Owner: I-02.* See also: primary key.

<a id="cardinality-relationship"></a>
### cardinality (relationship) — کاردینالیتی ارتباط
How many rows on one side may relate to a row on the other: one-to-one, one-to-many, many-to-many. Shown on ER diagrams by the line ends. Not to be confused with the number of rows in a table, nor with a column's number of distinct values in statistics. *Owner: I-02.* See also: ER diagram, crow's foot.

<a id="cascade"></a>
### cascade — آبشاری
A referential action: when a parent row is deleted (or its key updated), the database applies the change to child rows too (`ON DELETE CASCADE`). Convenient for line items, dangerous for high-level tables. Other actions are `RESTRICT`, `NO ACTION`, `SET NULL`, `SET DEFAULT`. *Owner: I-05.* See also: foreign key.

<a id="check-constraint"></a>
### CHECK — قید CHECK
A constraint that tests a condition on each row, such as `qty > 0`. It passes when the condition is TRUE or UNKNOWN, so combine it with `NOT NULL`. Not supported by Snowflake and not enforced by Cassandra. *Owner: I-05.* See also: constraint.

<a id="client-server"></a>
### client/server — کلاینت/سرور
An arrangement in which the DBMS runs as a separate server program and applications (clients) connect to it over a network. PostgreSQL, SQL Server, Oracle, MySQL, ClickHouse and Cassandra work this way. The opposite is an embedded database. *Owner: I-01.*

<a id="closure"></a>
### closure — خاصیت بستار
The property that every relational operator takes relations and returns a relation, so operators compose without limit. It is why a subquery can appear wherever a table can. Also, in dependency theory, the set of columns determined by a given set. *Owner: I-02.*

<a id="cluster"></a>
### cluster — کلاستر
In PostgreSQL, one server instance together with its data directory, which holds several databases. In Cassandra, the set of nodes that form one distributed database. The word has different meanings in other products. *Owner: I-01.* See also: instance.

<a id="collation"></a>
### collation — ترتیب مرتب‌سازی و مقایسه
The rules for comparing and sorting text: case and accent sensitivity and language ordering. It decides whether `'a' = 'A'` and how names sort. Defaults differ by engine (SQL Server case-insensitive, PostgreSQL locale-based, SQLite binary). *Owner: I-05.*

<a id="composite-key"></a>
### composite key — کلید مرکب
A key made of more than one column, such as `(order_id, product_id)` in `order_lines`. *Owner: I-02.* See also: primary key.

<a id="connection"></a>
### connection — اتصال
A communication channel between an application and a DBMS, opened with a login and closed when done. On the server it is represented by a session. Opening connections is expensive, so applications usually reuse them. *Owner: I-01.* See also: session, driver.

<a id="constraint"></a>
### constraint — قید
A rule the database enforces on every write: `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, `CHECK`. Named constraints give readable error messages. *Owner: I-05.*

<a id="correlated-subquery"></a>
### correlated subquery — زیرپرس‌وجوی همبسته
A subquery that refers to a column of the outer query, so it conceptually runs once per outer row. Optimizers often rewrite it into a join (decorrelation). *Owner: I-04.* See also: subquery.

<a id="crows-foot"></a>
### crow's foot — نمادگذاری پای کلاغی
The ER diagram notation in which a three-pronged fork means "many", a bar "exactly one" and a circle "zero". *Owner: I-02.* See also: ER diagram.

<a id="cte"></a>
### CTE — عبارت جدولی مشترک
Common table expression: a named subquery defined with `WITH` before the main statement, so the statement reads top to bottom. Whether it is materialised or expanded is an optimizer decision. *Owner: I-04.* See also: recursive CTE.

<a id="data-type"></a>
### data type — نوع داده
The kind of values a column can hold (integer, exact decimal, text, timestamp) and how they are stored and compared. Choosing it is part of physical design. *Owner: I-05.* See also: domain.

<a id="database"></a>
### database — پایگاه داده
An organised, persistent collection of data managed by a DBMS. In some products "database" is also a named container of schemas and tables inside one server. *Owner: I-01.* See also: DBMS.

<a id="dba"></a>
### DBA — مدیر پایگاه داده
Database administrator: the person responsible for installing, securing, backing up, tuning and upgrading the DBMS. *Owner: I-01.*

<a id="dbms"></a>
### DBMS — سامانه مدیریت پایگاه داده
Database management system: the software that stores the data and provides durability, concurrency control, a query language and access control. PostgreSQL, SQL Server and SQLite are DBMSs. *Owner: I-01.* See also: RDBMS.

<a id="dcl"></a>
### DCL — DCL
Data Control Language: statements that manage permissions (`GRANT`, `REVOKE`). *Owner: I-03.*

<a id="ddl"></a>
### DDL — DDL
Data Definition Language: statements that define or change structure (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`). In some engines DDL commits implicitly. *Owner: I-03.*

<a id="default-value"></a>
### DEFAULT — مقدار پیش‌فرض
The value a column receives when an `INSERT` omits it, for example `qty DEFAULT 1`. *Owner: I-05.*

<a id="denormalisation"></a>
### denormalisation — غیرنرمال‌سازی
Adding redundancy to a normalised design on purpose, for historical accuracy, read speed or because the engine has no joins. It needs a stated way to keep the copies consistent. *Owner: I-05.* See also: normal form.

<a id="derived-table"></a>
### derived table — جدول مشتق‌شده
A subquery used in the `FROM` clause as if it were a table; it needs an alias. *Owner: I-04.* See also: CTE.

<a id="distinct"></a>
### DISTINCT — حذف تکراری‌ها
A `SELECT` option that removes duplicate rows from the result. It applies to the whole row. *Owner: I-03.*

<a id="dml"></a>
### DML — DML
Data Manipulation Language: statements that change rows (`INSERT`, `UPDATE`, `DELETE`, `MERGE`). *Owner: I-03.*

<a id="docker-compose"></a>
### Docker Compose — Docker Compose
A tool that starts several containers from one YAML file. Rowlit's repository uses it to start the sample database servers (`engine/tests/docker/compose.yml`, project `dbstudio-it`). *Owner: I-18.*

<a id="domain"></a>
### domain — دامنه
The set of values an attribute may take. In SQL it is approximated by a data type plus constraints; PostgreSQL also has `CREATE DOMAIN`. *Owner: I-02.*

<a id="dql"></a>
### DQL — DQL
Data Query Language: the `SELECT` statement (some authors count it as DML). *Owner: I-03.*

<a id="driver"></a>
### driver — درایور
A library inside the application that speaks a DBMS's wire protocol: it sends SQL, receives rows. JDBC, ODBC, ADO.NET, `psycopg` are drivers or driver standards. *Owner: I-01.* See also: wire protocol.

<a id="embedded-database"></a>
### embedded database — پایگاه داده توکار
A DBMS delivered as a library linked into the application, with the database in a file the process opens directly. SQLite and DuckDB are examples. No server, no network, one process writes at a time. *Owner: I-01.* See also: client/server.

<a id="er-diagram"></a>
### ER diagram — نمودار موجودیت-ارتباط
Entity-relationship diagram: a picture of tables (entities) and the foreign-key relationships between them, with cardinality marked at the line ends. *Owner: I-02.* See also: crow's foot.

<a id="expression"></a>
### expression — عبارت
Anything that evaluates to a value: a column, a literal, arithmetic, a function call, `CASE`. *Owner: I-03.*

<a id="fixture"></a>
### fixture — fixture
A fixed, known data set (or the code that creates it) used in tests and examples. The `shop` seeds are the handbook's fixture. *Owner: I-18.* See also: seed.

<a id="foreign-key"></a>
### foreign key — کلید خارجی
Columns in one table whose values must match a key in another table (or be NULL). It links rows and is enforced as referential integrity. *Owner: I-02.* See also: referential integrity.

<a id="frame"></a>
### frame — قاب
The part of a window partition that a window function sees for the current row, such as `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW`. With `ORDER BY` and no frame, the default is `RANGE ... UNBOUNDED PRECEDING AND CURRENT ROW`. *Owner: I-04.* See also: window function.

<a id="function"></a>
### function — تابع
Stored code that returns a value (scalar) or a table and can be used inside a query. Written in the engine's procedural language. *Owner: I-04.* See also: stored procedure.

<a id="functional-dependency"></a>
### functional dependency — وابستگی تابعی
`A → B`: for each value of A there is exactly one value of B. Dependencies are business facts; normal forms are rules about them. *Owner: I-05.*

<a id="group-by"></a>
### GROUP BY — گروه‌بندی
A clause that forms one group per distinct combination of the listed columns so aggregates are computed per group. Every selected column must be grouped or aggregated. *Owner: I-03.*

<a id="having"></a>
### HAVING — HAVING
A clause that filters groups after aggregation, unlike `WHERE`, which filters rows before. *Owner: I-03.*

<a id="identity"></a>
### identity column — ستون هویت
A column that generates its own values from an internal sequence (`GENERATED ... AS IDENTITY`, `IDENTITY(1,1)`, `AUTO_INCREMENT`). *Owner: I-04.* See also: sequence.

<a id="instance"></a>
### instance — نمونه
A running copy of the DBMS software with its processes and memory. One machine can run several. In Oracle and SQL Server, databases live inside an instance. *Owner: I-01.*

<a id="join"></a>
### join — پیوند
An operation that combines rows of two tables that satisfy a condition. Kinds: inner, left/right/full outer, cross, self, natural. In the algebra it is a product followed by a selection. *Owner: I-03.* See also: selection.

<a id="lateral"></a>
### LATERAL — LATERAL
A join in which the right side may refer to columns of the left side ("for each row, run this subquery"). Standard SQL; PostgreSQL, MySQL 8, Oracle and Snowflake have it, SQL Server calls it `APPLY`. *Owner: I-04.* See also: APPLY.

<a id="limit-offset"></a>
### LIMIT / OFFSET / TOP / FETCH — LIMIT/OFFSET
The engine-specific ways to return only the first N rows or skip some: `LIMIT`/`OFFSET`, SQL Server `TOP`, standard `OFFSET ... FETCH`. Always combine with `ORDER BY`. *Owner: I-03.*

<a id="literal"></a>
### literal — مقدار لفظی
A value written directly in a statement: `42`, `'Alice'`, `DATE '2026-01-05'`. *Owner: I-03.*

<a id="materialized-view"></a>
### materialized view — نمای مادی‌شده
A view whose result is stored and must be refreshed. PostgreSQL, Oracle and Snowflake have them; SQL Server's equivalent is an indexed view; MySQL has none. *Owner: I-04.* See also: view.

<a id="merge"></a>
### MERGE — MERGE
A statement that, in one atomic step, inserts, updates or deletes target rows depending on whether they match source rows. SQL Server, Oracle, Snowflake, PostgreSQL 15+. *Owner: I-04.* See also: upsert.

<a id="namespace"></a>
### namespace — فضای نام
A named container that gives its objects unique names and a common owner or permissions. In a database it is a schema (second meaning). *Owner: I-01.* See also: schema.

<a id="natural-key"></a>
### natural key — کلید طبیعی
A key made of real-world data that is already unique, such as an ISBN. Looks convenient, but the real world changes it. *Owner: I-02.* See also: surrogate key.

<a id="normal-form"></a>
### normal form — شکل نرمال
A rule about a table's design that rules out certain anomalies: 1NF (atomic values), 2NF (no partial dependency on the key), 3NF (no dependency between non-key columns), BCNF (every determinant is a candidate key), 4NF (no independent multi-valued dependencies). *Owner: I-05.* See also: anomaly, functional dependency.

<a id="normalisation"></a>
### normalisation — نرمال‌سازی
Splitting tables until each stores facts about one kind of thing and each fact is stored once. *Owner: I-05.*

<a id="null"></a>
### NULL — مقدار تهی
The marker for "no value here" (unknown or not applicable). Not zero or an empty string (except in Oracle, where `''` is NULL). Comparisons with NULL are UNKNOWN. *Owner: I-02.* See also: three-valued logic.

<a id="order-by"></a>
### ORDER BY — مرتب‌سازی
The only way to obtain a defined row order. Can use aliases; each key is `ASC` or `DESC`; NULL placement differs by engine. *Owner: I-03.*

<a id="package"></a>
### package — پکیج
Oracle: a named bundle of procedures, functions and variables, with a public specification and a private body (`ORDER_API` in the Oracle `shop` seed). Not to be confused with a work package. *Owner: I-04.*

<a id="pivot"></a>
### PIVOT — محوری‌سازی
Turning row values into columns. Portable form: conditional aggregation (`sum(CASE WHEN ... END)`); SQL Server, Oracle and Snowflake also have a `PIVOT` operator. *Owner: I-04.*

<a id="precision-scale"></a>
### precision / scale — دقت و مقیاس
For exact decimals: precision is the total number of significant digits, scale the digits after the decimal point. `numeric(12,2)` holds up to 9,999,999,999.99. *Owner: I-05.*

<a id="predicate"></a>
### predicate — گزاره
A condition that is TRUE, FALSE or UNKNOWN for a row, such as `total > 100`. `WHERE` keeps rows where it is TRUE. *Owner: I-03.*

<a id="primary-key"></a>
### primary key — کلید اصلی
The candidate key chosen as the table's identifier. Unique, never NULL, at most one per table; the DBMS indexes it. *Owner: I-02.*

<a id="projection"></a>
### projection — تصویر
The algebra operation (π) that keeps only some columns; in SQL, the column list of `SELECT`. *Owner: I-02.*

<a id="query"></a>
### query — پرس‌وجو
A request for data (or, loosely, for any operation) sent to the DBMS as a statement. *Owner: I-01.*

<a id="rdbms"></a>
### RDBMS — سامانه مدیریت پایگاه داده رابطه‌ای
Relational DBMS: a DBMS that stores data in related tables and is queried with SQL. *Owner: I-01.* See also: DBMS.

<a id="recursive-cte"></a>
### recursive CTE — CTE بازگشتی
A CTE that refers to itself: an anchor member produces starting rows, a recursive member produces the next rows from the previous ones, until a step returns nothing. Used for trees and series. Cycles in the data make it run forever without a guard. *Owner: I-04.*

<a id="referential-integrity"></a>
### referential integrity — تمامیت ارجاعی
The rule that every foreign key value matches an existing key (or is NULL). Enforced by the engine once the foreign key is declared (except in engines such as Snowflake, where foreign keys are informational only). *Owner: I-02.*

<a id="relation"></a>
### relation — رابطه
The formal word for a table: a set of tuples that share the same attributes. *Owner: I-02.* See also: tuple, attribute.

<a id="relational-algebra"></a>
### relational algebra — جبر رابطه‌ای
The set of operations on relations (selection, projection, rename, product, union, difference, join, division) that optimizers use internally to represent and rewrite queries. *Owner: I-02.*

<a id="result-set"></a>
### result set — مجموعه نتیجه
The table of rows a query returns to the client. *Owner: I-01.*

<a id="schema"></a>
### schema — اسکیما
Two meanings. (1) Structure: the definition of tables, columns and types. (2) Namespace: a named container of objects inside a database (`sales.invoices`). In Oracle a schema is a user; in MySQL "schema" means database. *Owner: I-01.* See also: namespace.

<a id="seed"></a>
### seed — seed
A script that creates and fills a database with known data. The handbook's `shop` seeds are in `engine/tests/docker/`. *Owner: I-18.* See also: fixture.

<a id="selection"></a>
### selection — گزینش
The algebra operation (σ) that keeps the rows satisfying a condition; in SQL, `WHERE`. Not the SQL `SELECT` keyword. *Owner: I-02.*

<a id="sequence"></a>
### sequence — سکوئنس
A database object that hands out unique increasing numbers (`CREATE SEQUENCE`). *Owner: I-04.* See also: identity column.

<a id="session"></a>
### session — نشست
The server-side state of one connection: user, current database, open transaction, temporary tables, settings. *Owner: I-01.*

<a id="set-operation"></a>
### set operation — عملگر مجموعه‌ای
`UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT` (Oracle `MINUS`): combine the results of two queries with the same columns. *Owner: I-03.*

<a id="sql"></a>
### SQL — SQL
Structured Query Language: the declarative language of relational databases. You say what result you want, and the DBMS decides how to compute it. *Owner: I-01.*

<a id="stored-procedure"></a>
### stored procedure — رویه ذخیره‌شده
Code stored in the database and run with `CALL` or `EXEC`; may change data, return result sets and OUT parameters. *Owner: I-04.* See also: function.

<a id="subquery"></a>
### subquery — زیرپرس‌وجو
A `SELECT` inside another statement, in parentheses: scalar (one value), `IN` (one column), `EXISTS`, or a derived table. *Owner: I-04.*

<a id="surrogate-key"></a>
### surrogate key — کلید جانشین
A system-generated identifier with no business meaning, such as an identity integer or a UUID. Stable and small. *Owner: I-02.* See also: natural key.

<a id="synonym"></a>
### synonym — مترادف
An alias for another database object (SQL Server, Oracle). *Owner: I-04.*

<a id="system-catalog"></a>
### system catalog — فهرست سیستمی
The tables and views in which the DBMS stores definitions of its own objects (`information_schema`, `pg_catalog`, `sys.*`). Tools such as Rowlit read it to show the object tree. *Owner: I-01.*

<a id="table-variable"></a>
### table variable — متغیر جدولی
SQL Server: a variable of table type (`DECLARE @t TABLE (...)`) scoped to a batch. *Owner: I-04.* See also: temporary table.

<a id="tcl"></a>
### TCL — TCL
Transaction Control Language: `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`. *Owner: I-03.*

<a id="temp-table"></a>
### temporary table — جدول موقت
A table visible only to the session (or transaction) that created it and dropped automatically afterwards. *Owner: I-04.*

<a id="three-valued-logic"></a>
### three-valued logic — منطق سه‌مقداری
SQL's logic with TRUE, FALSE and UNKNOWN. Any comparison with NULL is UNKNOWN; `WHERE` keeps only TRUE. *Owner: I-02.* See also: NULL.

<a id="time-zone"></a>
### time zone — منطقه زمانی
The offset rules used to display or interpret a timestamp. Store instants in UTC or in a type that normalises to UTC. *Owner: I-05.*

<a id="trigger"></a>
### trigger — تریگر
Code that runs automatically before or after an `INSERT`, `UPDATE` or `DELETE` on a table. *Owner: I-04.*

<a id="tuple"></a>
### tuple — چندتایی
Formal word for a row of a relation. *Owner: I-02.*

<a id="unique-constraint"></a>
### UNIQUE — قید یکتایی
A constraint that forbids two rows with the same values in the listed columns. How it treats NULLs differs by engine. *Owner: I-05.*

<a id="upsert"></a>
### upsert — upsert
"Insert, or update if it exists", done atomically: `ON CONFLICT` (PostgreSQL, SQLite), `ON DUPLICATE KEY UPDATE` (MySQL), `MERGE`. *Owner: I-04.* See also: MERGE.

<a id="uuid"></a>
### UUID / GUID — UUID
A 128-bit identifier that can be generated anywhere without coordination. Random values scatter inserts in indexes; time-ordered variants fix that. *Owner: I-05.*

<a id="view"></a>
### view — نما
A stored `SELECT` that is queried like a table and holds no data of its own. *Owner: I-04.* See also: materialized view.

<a id="window-function"></a>
### window function — تابع پنجره‌ای
A function with `OVER (...)` that computes a value per row from a window of related rows without collapsing them (ranking, running totals, `LAG`). *Owner: I-04.* See also: frame, window partition.

<a id="window-partition"></a>
### window partition — بخش‌بندی پنجره
The `PARTITION BY` part of a window: the independent groups the calculation restarts in. Not the same as table partitioning. *Owner: I-04.*

<a id="wire-protocol"></a>
### wire protocol — پروتکل شبکه‌ای
The byte-level network language a DBMS speaks (PostgreSQL frontend/backend protocol, SQL Server TDS, MySQL protocol, Oracle TNS, CQL native protocol). Drivers implement it. *Owner: I-01.*
