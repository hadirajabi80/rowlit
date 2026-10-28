# 18. Answer key and lab setup

> **Language:** English | [فارسی](../../fa/part1/18-exercise-answers.md) | **Previous:** [17. The eight relational dialects compared](17-dialect-comparison.md)
> **Level:** L1 beginner | **Part:** I
> **In one sentence:** how to start the sample `shop` servers on your own machine, connect to them, check the data, and the worked answers to the exercises of every Part I chapter.
> **You will learn:**
> - how to start, stop and reset the Docker servers that hold the `shop` data
> - the address, database and credentials of each server, and a command-line client for each
> - how to check that the data is the one the book expects
> - the answers, grouped by chapter
>
> **Prerequisites:** none for the lab; read the exercise before its answer.
> **Status of this file:** sections I-01 to I-05 are complete. Sections I-06 to I-17 are headings that the packages writing those chapters fill in.

## 1. The idea (beginner)

Part I teaches by example, and the examples use one small database named `shop`. To follow them you need a database to run
the queries on. You do not have to install anything permanent: the Rowlit repository contains a Docker Compose file that
downloads ready-made database servers, creates `shop` in each, and throws everything away when you ask it to. If you only have
SQLite, you can still run most of the book (section 2.1).

Do the exercises before you read the answers. A wrong answer you have reasoned through teaches more than a right answer you
have read.

## 2. The lab

### 2.1 Cheapest option: SQLite

The file `engine/tests/fixtures/shop.sqlite` is the `shop` database for SQLite: snake_case tables `countries`, `customers`,
`orders`, `products`, `order_lines` and a view `customer_orders`. It was built from the same data as the other seeds
(`engine/tests/DbStudio.Providers.Conformance/ShopSchema.cs`). Open it with Rowlit, with the `sqlite3` shell, or with any SQLite
viewer. Work on a copy of the file if you intend to change data. Foreign keys are only enforced if the connection runs
`PRAGMA foreign_keys = ON;`.

The built-in sample database of Rowlit (File, then open the sample database) is a different, larger SQLite database (300 customers,
1500 orders, PascalCase names). The exercises in this book do not use it.

### 2.2 All engines: Docker Compose

You need Docker Desktop (or Docker Engine on Linux) running. From the repository root:

```powershell
docker compose -f engine/tests/docker/compose.yml up -d
docker compose -f engine/tests/docker/compose.yml ps
```

The compose project is named `dbstudio-it` (`name:` at the top of `compose.yml`). With no profile, `up -d` starts these services:
`mssql` (plus the one-shot `mssql-seed`), `oracle`, `postgres`, `redis` (plus `redis-seed`), `mongo` (plus `mongo-seed`), `mysql`,
`mariadb` and `clickhouse`. (The README in `engine/tests/docker/` mentions a shorter list; the compose file is the authority.)
Profiles add the rest:

```powershell
docker compose -f engine/tests/docker/compose.yml --profile cassandra up -d     # Cassandra 5 + seed
docker compose -f engine/tests/docker/compose.yml --profile search up -d        # Elasticsearch + seed
docker compose -f engine/tests/docker/compose.yml --profile kafka up -d         # Kafka + Schema Registry
docker compose -f engine/tests/docker/compose.yml --profile cluster up -d       # Redis cluster
```

You do not need all of them. For Part I chapters 1 to 5 PostgreSQL, SQL Server and MySQL are enough. Start only what you need by naming
services: `docker compose -f engine/tests/docker/compose.yml up -d postgres mssql mssql-seed mysql`.

Wait for the servers. SQL Server reports healthy in about 15 seconds and the seed container then loads `shop`; Oracle takes one to two minutes on its first
start because it creates the database and runs the seed in `/container-entrypoint-initdb.d`. `docker compose ... ps` shows `healthy` when a server is ready.
The first start downloads the images (SQL Server about 1.5 GB, Oracle about 1 GB, from `engine/tests/docker/README.md`).

#### Addresses and credentials

These come from `engine/tests/docker/README.md` and `compose.yml`. They are throw-away development credentials for local containers; do not reuse them anywhere else.

| Engine | Host and port | Database / service | User and password | Seed file |
|---|---|---|---|---|
| PostgreSQL 17 | `localhost:15432` | database `shop` | `shop` / `shop` | `seed-postgres.sql` |
| SQL Server 2022 | `localhost,14333` | database `shop` | `sa` / `DbStudio_Dev_2026!` | `seed-mssql.sql` |
| Oracle 23 Free | `localhost:15211` | service `FREEPDB1`, schema `SHOP` | `shop` / `shop`; admin `SYSTEM` / `DbStudioDev2026` | `seed-oracle.sql` |
| MySQL 8.4 | `localhost:13306` | database `shop` | `shop` / `shop` | `seed-mysql.sql` |
| MariaDB 11 | `localhost:13307` | database `shop` | `shop` / `shop` | `seed-mysql.sql` + `seed-mariadb.sql` |
| ClickHouse 24.8 | HTTP `localhost:18123`, native `localhost:19000` | database `shop` | `shop` / `shop` | `seed-clickhouse.sql` |
| Cassandra 5 (profile) | `localhost:19042` | keyspace `shop` | none | `seed-cassandra.cql` |
| Snowflake | your account | `SHOP.PUBLIC` | your own | `seed-snowflake.sql`, run manually in a worksheet |
| Redis Stack 7.4 | `localhost:16379` | | none | `seed-redis.sh` |
| MongoDB 7 | `mongodb://localhost:27018/?directConnection=true` | | none | `seed-mongo.js` |
| Kafka 3.8 (profile) | `localhost:19092` | | none | `seed-kafka.sh` |
| Elasticsearch 8.15 (profile) | `http://localhost:19200` | | none | `seed-elasticsearch.sh` |

The host ports are the left side of the port mappings in `compose.yml`; they are deliberately unusual so that they do not collide with servers you
already run. If a port is busy, set the matching environment variable (for example `PG_PORT`) before `docker compose up`.

#### Connecting

Any client works: Rowlit (New connection, choose the provider, enter the values above; see [Part II chapter 8](../part2/08-connections-sessions-execution.md)), or
a command-line client run *inside* the container so you need to install nothing:

```powershell
docker compose -f engine/tests/docker/compose.yml exec postgres psql -U shop -d shop
docker compose -f engine/tests/docker/compose.yml exec mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "DbStudio_Dev_2026!" -C -d shop
docker compose -f engine/tests/docker/compose.yml exec mysql mysql -ushop -pshop shop
docker compose -f engine/tests/docker/compose.yml exec mariadb mariadb -ushop -pshop shop
docker compose -f engine/tests/docker/compose.yml exec clickhouse clickhouse-client --user shop --password shop --database shop
docker compose -f engine/tests/docker/compose.yml exec oracle sqlplus shop/shop@//localhost:1521/FREEPDB1
docker compose -f engine/tests/docker/compose.yml --profile cassandra exec cassandra cqlsh
```

The `sqlcmd` path is the one the project's own health check uses (`compose.yml`, service `mssql`). The tool names in the other images follow the
upstream images; if one is missing in your image version, use Rowlit or a client on your machine instead (not verified for every image tag).

#### Check the data

Run this in each engine. The five numbers must match; if they do, every example in the book will give the results shown.

```sql
SELECT (SELECT count(*) FROM countries)   AS countries,    -- 3
       (SELECT count(*) FROM customers)   AS customers,    -- 5
       (SELECT count(*) FROM products)    AS products,     -- 4
       (SELECT count(*) FROM orders)      AS orders,       -- 6
       (SELECT count(*) FROM order_lines) AS order_lines;  -- 7
```

On SQL Server the table names are `Countries`, `Customers`, ... (PascalCase) and Oracle's are upper case (`CUSTOMERS`); Oracle also needs `FROM dual` before
version 23 and treats the seed's dates as `DATE`. Table and column names differ by engine as described in [chapter I-17](17-dialect-comparison.md);
the book writes examples in the snake_case names of PostgreSQL, MySQL and SQLite and says when a name differs.

#### Resetting and stopping

The seeds are idempotent. To restore the data after you have changed it, re-run the seed: for PostgreSQL pipe the file into `psql`
(`docker compose ... exec -T postgres psql -U shop -d shop < engine/tests/docker/seed-postgres.sql` in a POSIX shell) or run the file from Rowlit;
SQL Server and Oracle can re-run theirs the same way (`sqlcmd -i`, SQL*Plus). The surest reset is to delete the containers and volumes and start again:

```powershell
docker compose -f engine/tests/docker/compose.yml down -v      # removes containers AND data volumes
docker compose -f engine/tests/docker/compose.yml up -d
```

`down` without `-v` keeps the data. Some seeds only run when the data directory is first created (PostgreSQL's `docker-entrypoint-initdb.d`), which is why a reset
means `down -v`.

#### Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `failed to connect to the docker API` | Docker Desktop is not running. Start it and wait until it reports running. |
| `port is already allocated` | Another program uses the host port. Stop it or change the port with the variable shown in `compose.yml` (`PG_PORT`, `MSSQL_PORT`, ...). |
| Login failed for `sa` | The password contains `!`; quote it in your shell. In PowerShell use double quotes as shown. |
| SQL Server `shop` database does not exist | `mssql-seed` has not finished or failed; run `docker compose ... logs mssql-seed`. |
| Oracle refuses connections for a minute | The first start creates the database; wait for `healthy`. |
| A query result differs from the book | Someone changed the data. Reset (see above). Check `ORDER BY`: without it row order is not guaranteed. |
| Memory pressure | Start only the servers you need (name them in the `up` command). Oracle and SQL Server need the most RAM. |

## 3. Answers

Each answer gives the result you should see. Where an exercise has several correct solutions only one is shown. "Illustrative output" means the rows
were computed from the seed data; the SQLite results were produced by running the statements.

<a id="i-01"></a>
<a id="chapter-1"></a>
### I-01: What a database is

**1. Embedded or server?**
(a) A phone app's contacts database is almost always an embedded database (SQLite). Copying the file while the app is writing can produce a copy that is
internally inconsistent; the safe ways are the SQLite backup API or copying while the app is closed. A second machine cannot use the same file concurrently.
(b) A web shop's database is client/server. Copying the data files of a running server gives torn pages and a copy that will not recover; use the DBMS's backup tool ([chapter I-12](12-backup-replication-ha.md)).
(c) A desktop editor's cache file is embedded (the editor links the library). Same copy caveat as (a).
(d) A cloud data warehouse is a client/server service. There are no files for you to copy; you export or share data through the service.

**2. What a file cannot do.** Four possible answers:
- Two people save at once and one change is lost. *Concurrency* (transactions, locks or versions).
- The machine dies halfway through a save and the file is truncated. *Durability* (write-ahead log).
- Someone types a price `abc` or an order for a customer who does not exist. *Control* (types, constraints, foreign keys).
- A support agent who should see orders can also read everyone's emails. *Control* (privileges).
- Finding one customer's orders reads the whole file every time. *Query language* and the indexes behind it.

**3. Trace a query.** Application (builds the SQL text), driver (sends it over the protocol), protocol layer (authenticates, keeps the session), parser and optimizer
(read the text, choose a plan; here a scan of `customers`), executor (counts the rows), storage engine and buffer cache (supply the pages), data files (hold the pages). The
executor produces the number 5, the protocol layer sends it back, and the driver delivers it to the application as a one-row result. The layer that sends the number to the client
is the protocol layer.

**4. Names.**
(a) PostgreSQL: `sales.invoices` (schema.table); `shop.sales.invoices` is also accepted when `shop` is the database you are connected to.
(b) SQL Server: `Sales.Invoices` or `shop.Sales.Invoices`; the three-part name also works from a connection using another database on the same instance.
(c) Oracle: `sales.invoices` (user.table), if the connected user has been granted access.
(d) MySQL: `sales.invoices` (database.table).
All four names are qualified, so none of them needs `sales` to be selected beforehand. Only PostgreSQL cannot reach a table in a *different database* from the same connection.

**5. Hands on.** `SELECT count(*) FROM customers;` returns 5. `sqlite_version()` returns the version of your SQLite library (for example 3.4x or later). The layer that does not
exist is the network: there is no server process and no wire protocol, because the application and the DBMS are the same process.

<a id="i-02"></a>
<a id="chapter-2"></a>
### I-02: The relational model

**1. Keys.** `order_id` alone is not a key: order 1 has two lines. `product_id` alone is not a key: product 2 appears in orders 1 and 2. `(order_id, product_id)` is unique for every row and
minimal. `(order_id, product_id, qty)` is a superkey but not minimal, because removing `qty` leaves a key, so it is not a candidate key. To allow the Mouse on two lines of the same order, add a
line number: `PRIMARY KEY (order_id, line_no)` and keep `product_id` as an ordinary foreign key column (this is what Rowlit's built-in sample database does).

**2. Three-valued logic.**

| Expression | Result |
|---|---|
| `NULL = NULL` | UNKNOWN |
| `NULL IS NULL` | TRUE |
| `1 <> NULL` | UNKNOWN |
| `NULL OR TRUE` | TRUE |
| `NULL AND FALSE` | FALSE |
| `NOT NULL` | UNKNOWN |
| `(1 = 1) AND (NULL = 2)` | UNKNOWN (TRUE AND UNKNOWN) |

**3. Counting.** `count(*)` 5, `count(email)` 3, `count(country_id)` 4, `count(DISTINCT country_id)` 3. `WHERE country_id <> 1` returns Bob and Chie (2 rows). Missing: Alice and
Dora (correctly, their country is 1) and **Emil**, whose NULL country makes the comparison UNKNOWN.

**4. Algebra.** π<sub>name</sub>(σ<sub>total &gt; 100</sub>(customers ⋈<sub>customers.id = orders.customer_id</sub> orders)).

```sql
SELECT DISTINCT c.name
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.total > 100;           -- Alice, Bob, Dora
```

The expression tree has the join at the bottom, then the selection, then the projection. `orders` (6 rows) is larger than `customers` (5). An optimizer applies the selection first (it
equals σ<sub>total &gt; 100</sub>(orders), which has 3 rows) and then joins; the result is the same and the join is smaller. `DISTINCT` is needed only because a customer with two big orders would appear twice.

**5. Model.** A customer may review many products and a product may be reviewed by many customers: a many-to-many relationship, resolved with a link table like `order_lines`, whose
primary key is the pair of foreign keys (which also enforces "at most once").

```sql
CREATE TABLE reviews (
  customer_id integer NOT NULL REFERENCES customers (id),
  product_id  integer NOT NULL REFERENCES products (id),
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  PRIMARY KEY (customer_id, product_id)
);
```

In crow's foot terms: `CUSTOMERS ||--o{ REVIEWS` and `PRODUCTS ||--o{ REVIEWS`.

**6. Set versus bag.** `UNION` returns 4 rows: NULL, 1, 2, 3. The left query yields `1, 2, 3, 1, NULL` and the right `1, 2, 3`; `UNION` removes the duplicates (the second `1`, and the `1, 2, 3` of the
right side). `UNION ALL` returns 5 + 3 = 8 rows. NULL appears once because it occurs once in the input; duplicate removal treats two NULLs as equal, even though `NULL = NULL` is not TRUE.

<a id="i-03"></a>
<a id="chapter-3"></a>
### I-03: SQL I, reading data

**1. Filter and sort.**

```sql
SELECT name, email FROM customers WHERE email IS NOT NULL ORDER BY name DESC;   -- Dora, Chie, Alice  (3 rows)
SELECT name FROM customers WHERE country_id <> 1 OR country_id IS NULL;         -- Bob, Chie, Emil
```

You need `IS NULL` because `country_id <> 1` is UNKNOWN for Emil. In engines that support it, `country_id IS DISTINCT FROM 1` does both in one predicate.

**2. Joins.**

```sql
INSERT INTO countries VALUES (4, 'Chile');
SELECT co.name, count(c.id) AS customers
FROM countries co LEFT JOIN customers c ON c.country_id = co.id
GROUP BY co.id, co.name ORDER BY co.id;
```

| name | customers |
|---|---|
| Germany | 2 |
| France | 1 |
| Japan | 1 |
| Chile | 0 |

`LEFT JOIN` with `countries` on the left keeps countries that have no customers. `count(c.id)` counts only matched customers; `count(*)` would count the NULL-padded row of Chile as 1.

**3. Grouping.** The average order total is 647.40 / 6 = 107.90.

```sql
SELECT customer_id, sum(total) AS revenue
FROM orders GROUP BY customer_id
HAVING sum(total) > (SELECT avg(total) FROM orders)
ORDER BY customer_id;
```

| customer_id | revenue |
|---|---|
| 1 | 140.00 |
| 2 | 199.00 |
| 4 | 254.25 |

The comparison involves `sum(total)`, an aggregate, so it must be in `HAVING`: `WHERE` is evaluated before grouping and cannot see aggregates. The average is a scalar subquery on the right-hand side.
Chie (54.15) falls below it.

**4. The trap.**

```sql
SELECT p.name, coalesce(sum(l.qty), 0) AS units
FROM products p LEFT JOIN order_lines l ON l.product_id = p.id
GROUP BY p.id, p.name ORDER BY units DESC, p.id;
```

| name | units |
|---|---|
| Keyboard | 3 |
| Mouse | 2 |
| Monitor | 2 |
| Cable | 1 |

A product that was never sold would show 0, thanks to the `LEFT JOIN` and `coalesce`. If you also joined `orders` and summed `o.total`, every order total would be added once per line of that
order (and per product), giving numbers far above the real revenue, the fan-out trap of section 2.6; revenue by product needs `qty * price` from the lines, not the order total.

**5. Anti-join.** Seed data: every product appears in at least one line, so all three forms return **no rows**.

```sql
SELECT p.name FROM products p LEFT JOIN order_lines l ON l.product_id = p.id WHERE l.order_id IS NULL;
SELECT p.name FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.product_id = p.id);
SELECT p.name FROM products p WHERE p.id NOT IN (SELECT product_id FROM order_lines);
```

After `INSERT INTO products VALUES (5, 'Webcam', 59.00)` all three return Webcam. `NOT IN` works here only because `order_lines.product_id` is `NOT NULL`; if the column were nullable and contained one NULL, the
third form would return nothing again.

**6. Outer-join placement.**

```sql
-- condition in ON
SELECT c.name, count(o.id) AS big_orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.total > 100 GROUP BY c.id, c.name ORDER BY c.id;
-- condition in WHERE
SELECT c.name, count(o.id) AS big_orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.total > 100 GROUP BY c.id, c.name ORDER BY c.id;
```

| name | big_orders (ON) |
|---|---|
| Alice | 1 |
| Bob | 1 |
| Chie | 0 |
| Dora | 1 |
| Emil | 0 |

The `WHERE` version returns only Alice, Bob and Dora (1 each): Chie and Emil have no order over 100, their joined row is NULL-padded, `NULL > 100` is UNKNOWN and the row is removed, so the outer join has behaved like an inner join and the zero
counts disappeared.

<a id="i-04"></a>
<a id="chapter-4"></a>
### I-04: SQL II, advanced queries

**1. Subqueries.**

```sql
SELECT name, price FROM products WHERE price > (SELECT avg(price) FROM products);      -- Monitor 199.00 (average 68.41)

SELECT c.name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.total > 100); -- Chie, Emil

SELECT c.name FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.total > 100
WHERE o.id IS NULL;                                                                     -- Chie, Emil
```

Emil appears in both because he has no order at all, so he has no order over 100 either. If the question were "customers who have orders but none over 100", the answer would be Chie only.

**2. Derived table / CTE.**

```sql
WITH per_customer AS (
  SELECT c.id, c.name, count(*) AS orders, sum(o.total) AS revenue
  FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name)
SELECT name, orders, revenue, round(100.0 * revenue / sum(revenue) OVER (), 1) AS pct
FROM per_customer ORDER BY id;
```

| name | orders | revenue | pct |
|---|---|---|---|
| Alice | 2 | 140.00 | 21.6 |
| Bob | 1 | 199.00 | 30.7 |
| Chie | 1 | 54.15 | 8.4 |
| Dora | 2 | 254.25 | 39.3 |

Without the CTE: `SELECT c.name, count(*), sum(o.total), round(100.0 * sum(o.total) / sum(sum(o.total)) OVER (), 1) FROM customers c JOIN orders o … GROUP BY c.id, c.name`. The window function runs
after grouping, so it can sum the group sums. Emil has no orders and is absent because of the inner join; use a `LEFT JOIN` and `coalesce` to include him with 0.

**3. Top-N.**

```sql
SELECT order_id, product_id, line_value
FROM (SELECT l.order_id, l.product_id, l.qty * p.price AS line_value,
             row_number() OVER (PARTITION BY l.order_id ORDER BY l.qty * p.price DESC) AS rn
      FROM order_lines l JOIN products p ON p.id = l.product_id) t
WHERE rn <= 2 ORDER BY order_id, line_value DESC;
```

| order_id | product_id | line_value |
|---|---|---|
| 1 | 1 | 99.80 |
| 1 | 2 | 19.50 |
| 2 | 2 | 19.50 |
| 3 | 3 | 199.00 |
| 4 | 1 | 49.90 |
| 4 | 4 | 5.25 |
| 6 | 3 | 199.00 |

Orders 2, 3 and 6 have only one line. Order 5 has no line and does not appear at all, because the query starts from the lines. To show it with NULLs, start from `orders` with a `LEFT JOIN`.

**4. Days since the previous order** (PostgreSQL; the SQLite result is the same).

```sql
SELECT id, order_date::date AS d,
       coalesce(order_date::date - lag(order_date::date) OVER (ORDER BY order_date, id), 0) AS days_since
FROM orders ORDER BY order_date, id;
```

| id | d | days_since |
|---|---|---|
| 1 | 2026-01-05 | 0 |
| 2 | 2026-02-11 | 37 |
| 3 | 2026-02-12 | 1 |
| 4 | 2026-03-01 | 17 |
| 5 | 2026-03-02 | 1 |
| 6 | 2026-03-03 | 1 |

For the first order `lag` has no previous row and returns NULL, so the subtraction is NULL; `coalesce(…, 0)` replaces it. In SQL Server use `DATEDIFF(day, lag(CAST(OrderDate AS date)) OVER (ORDER BY OrderDate, Id), CAST(OrderDate AS date))`; in Oracle, subtract two `DATE` values.

**5. Recursion.**

```sql
WITH RECURSIVE sub(id, name, depth) AS (
  SELECT id, name, 0 FROM employees WHERE id = 2
  UNION ALL
  SELECT e.id, e.name, s.depth + 1 FROM employees e JOIN sub s ON e.manager_id = s.id)
SELECT * FROM sub WHERE depth > 0 ORDER BY depth, id;
```

| id | name | depth |
|---|---|---|
| 4 | Dmitri | 1 |
| 5 | Eli | 1 |
| 6 | Fay | 2 |

After `UPDATE employees SET manager_id = 6 WHERE id = 1` Ada reports to Fay, who is below Ben who is below Ada: Ben, Dmitri, Fay, Ada, Ben, Dmitri, ... Every step finds new rows (the same ones again), so the recursion never reaches an empty
step. Stop it with a depth guard (`WHERE s.depth < 20`), by carrying the visited path and refusing to revisit (`WHERE s.path NOT LIKE '%' || e.name || '%'`), or with the `CYCLE` clause of PostgreSQL 14+ (`CYCLE id SET is_cycle USING path`). SQL Server stops by itself at 100 levels with an error.

**6. Upsert.** After the first run `stock` holds `(5, 5)`; after the second, `(5, 10)`, because the conflicting row is updated to `qty = stock.qty + excluded.qty`. In MySQL the same
result uses `ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`; in SQL Server, Oracle, Snowflake and PostgreSQL 15+ use the `MERGE` form of section 2.7.

<a id="i-05"></a>
<a id="chapter-5"></a>
### I-05: Data modelling and normalisation

**1. Anomalies.** *Update:* change Alice's email on one of her three rows and the table now holds two emails for her; the responsible dependency is `customer → customer_email` (also `order_id →
customer_email`). *Insert:* you cannot record a new product (say a Webcam at 59.00) until someone orders it, because the key is `(order_id, product)`; the dependency `product → product_price` has a determinant that is only part of the key. *Delete:* deleting order 3
removes the only row that says Bob exists and lives in France; `order_id → customer, customer_email, customer_country`.

**2. Normal forms.** Dependencies: `student → student_city`, `course → course_room`, `(student, course) → grade`. The first violation is **2NF** (`student_city` depends only on part of the key, as does `course_room`). The decomposition:
`students(student PK, student_city)`, `courses(course PK, course_room)`, `enrolments(student FK, course FK, grade, PK (student, course))`. All three are in 3NF (and BCNF).

**3. BCNF.**

```text
teaches(instructor PK, course)
enrolments(student, instructor, PK (student, instructor), FK instructor -> teaches)
```

The rule "a student has only one instructor for a given course" can no longer be enforced with a key: nothing stops a student from enrolling with two instructors who both teach Databases. You would enforce it with a trigger, a
constraint across tables in an engine that supports it (assertions are not implemented by the engines in this book), a unique index on a materialised join, or in the application, or you keep a denormalised
`(student, course)` unique column alongside.

**4. Redundancy.**

```sql
SELECT o.id, o.total, coalesce(sum(l.qty * p.price), 0) AS lines_sum
FROM orders o
LEFT JOIN order_lines l ON l.order_id = o.id
LEFT JOIN products p ON p.id = l.product_id
GROUP BY o.id, o.total
HAVING o.total <> coalesce(sum(l.qty * p.price), 0)
ORDER BY o.id;
```

| id | total | lines_sum |
|---|---|---|
| 1 | 120.50 | 119.30 |
| 4 | 54.15 | 55.15 |
| 5 | 5.25 | 0.00 |
| 6 | 249.00 | 199.00 |

Ways to keep the total consistent: (1) do not store it; compute it in a view (`customer_orders`-style) or generated query: always correct, costs a join and aggregate on every read. (2) Store it and maintain it with a trigger
or in the application whenever lines change: reads are cheap, writes are slower and every code path that changes lines must remember. Rowlit's built-in sample database uses triggers (`TR_OrderLines_Insert`, `TR_OrderLines_Delete`).
A real shop also needs `order_lines.unit_price` because `products.price` changes over time and an old order must keep the price at which it was sold; that is a different fact, not a copy.

**5. Constraints.**

```sql
CREATE TABLE reviews (
  customer_id integer NOT NULL,
  product_id  integer NOT NULL,
  rating      integer NOT NULL,
  review_text text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_reviews PRIMARY KEY (customer_id, product_id),
  CONSTRAINT fk_reviews_customers FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_products  FOREIGN KEY (product_id)  REFERENCES products (id)  ON DELETE RESTRICT,
  CONSTRAINT ck_reviews_rating CHECK (rating BETWEEN 1 AND 5));
```

Customer deleted: `CASCADE`, because a review without its author has no owner (a policy of keeping anonymous reviews would need `customer_id` nullable and `SET NULL`, which conflicts with it being part of the primary key).
Product deleted: `RESTRICT`, because reviews are history; mark the product discontinued instead of deleting it. Both choices are business decisions, not technical ones.

**6. Types.**

| Column | PostgreSQL | SQL Server | Why |
|---|---|---|---|
| Product price | `numeric(10,2)` | `decimal(10,2)` | exact decimal, never float |
| Time an order was placed | `timestamptz` | `datetimeoffset` (or `datetime2` storing UTC) | an instant, comparable across time zones |
| Barcode (13 digits, leading zeros) | `char(13)` or `varchar(13)` with a `CHECK` on digits | `char(13)` | an identifier, not a number: no arithmetic and leading zeros matter |
| Preferred language | `varchar(10)` code such as `fa`, or a foreign key to a `languages` table | `varchar(10)` | a code from a closed list; a lookup table adds validation |
| Discontinued | `boolean NOT NULL DEFAULT false` | `bit NOT NULL DEFAULT 0` | two states; `NOT NULL` avoids a third |

<a id="i-06"></a>
<a id="chapter-6"></a>
### I-06: Storage internals

Answers are added by the package that owns chapter I-06.

<a id="i-07"></a>
<a id="chapter-7"></a>
### I-07: Indexes in depth

Answers are added by the package that owns chapter I-07.

<a id="i-08"></a>
<a id="chapter-8"></a>
### I-08: The query pipeline and the optimizer

Answers are added by the package that owns chapter I-08.

<a id="i-09"></a>
<a id="chapter-9"></a>
### I-09: Transactions, ACID and isolation

Answers are added by the package that owns chapter I-09.

<a id="i-10"></a>
<a id="chapter-10"></a>
### I-10: Concurrency: locks, latches, MVCC

Answers are added by the package that owns chapter I-10.

<a id="i-11"></a>
<a id="chapter-11"></a>
### I-11: WAL, redo/undo, checkpoints, recovery

Answers are added by the package that owns chapter I-11.

<a id="i-12"></a>
<a id="chapter-12"></a>
### I-12: Backup, replication, HA, partitioning

Answers are added by the package that owns chapter I-12.

<a id="i-13"></a>
<a id="chapter-13"></a>
### I-13: Performance tuning methodology

Answers are added by the package that owns chapter I-13.

<a id="i-14"></a>
<a id="chapter-14"></a>
### I-14: Database security

Answers are added by the package that owns chapter I-14.

<a id="i-15"></a>
<a id="chapter-15"></a>
### I-15: OLTP vs OLAP and columnar engines

Answers are added by the package that owns chapter I-15.

<a id="i-16"></a>
<a id="chapter-16"></a>
### I-16: NoSQL families and their internals

Answers are added by the package that owns chapter I-16.

<a id="i-17"></a>
<a id="chapter-17"></a>
### I-17: The eight relational dialects compared

Answers are added by the package that owns chapter I-17.

## Related chapters

- [How to read this handbook](../00-how-to-read.md), section 6: the three ways to run the examples.
- The chapters whose exercises are answered above: [I-01](01-what-is-a-database.md), [I-02](02-relational-model.md), [I-03](03-sql-basics.md),
  [I-04](04-sql-advanced.md), [I-05](05-modelling-and-normalisation.md).
- Part II: [II-04 running Rowlit from source](../part2/04-development-setup.md) uses the same Docker servers, and
  [II-23 testing and QA](../part2/23-testing-and-qa.md) explains how the project's integration tests use them.

## Glossary terms introduced here

[Docker Compose](../glossary.md#docker-compose), [seed](../glossary.md#seed), [fixture](../glossary.md#fixture).
