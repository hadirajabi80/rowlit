# Glossary fragment, package B (I-06, I-07, I-08)

Temporary file for package H to merge into `en/glossary.md` and `fa/glossary.md` (plan §5, §6). Rows are alphabetical by
English term; the anchor ids are identical in both languages. Every row: anchor, heading `term — Persian`, a beginner
meaning, a deeper note, the owner chapter and "see also". Terms these chapters only link to are owned elsewhere and are
not repeated here: `checkpoint`, `lsn` (I-11), `vacuum` (I-10), `sargable`, `query-store` (I-13).

## English rows

<a id="access-path"></a>
### access path — مسیر دسترسی
The way a plan reads one table: a full scan, an index seek, an index-only scan, a bitmap scan or a fetch by row address. The optimizer costs each candidate path and picks one per table. *Owner: I-08.* See also: table scan, index seek.

<a id="actual-plan"></a>
### actual plan — طرح واقعی
A plan captured while the statement really runs, with real row counts, times and I/O per operator. Compare its actual rows with the estimated rows to find wrong estimates; it executes the statement, so wrap DML in a rolled-back transaction. *Owner: I-08.* See also: estimated plan, EXPLAIN.

<a id="anti-join"></a>
### anti-join — پادپیوند
A join that keeps the rows of one input that have **no** match in the other (`NOT EXISTS`, `NOT IN`, `LEFT JOIN … IS NULL`). Optimizers implement it with the same algorithms as joins, stopping at the first match. *Owner: I-08.* See also: semi-join.

<a id="b-plus-tree"></a>
### B+tree — درخت B+ (B+tree)
The tree structure behind almost every relational index: separator keys in internal pages, all keys (and row pointers or rows) in linked leaf pages. Shallow (3–4 levels for millions of rows) and good for both seeks and range scans. *Owner: I-07.* See also: B-tree, leaf node, fan-out.

<a id="b-tree"></a>
### B-tree — درخت B (B-tree)
A balanced search tree of pages (Bayer and McCreight, 1970) where every leaf is at the same depth. In database speech "B-tree index" nearly always means the B+tree variant; SQLite's index trees are classic B-trees with keys in interior pages. *Owner: I-07.* See also: B+tree.

<a id="bind-peeking"></a>
### bind peeking — نگاه به مقدار bind (bind peeking)
Oracle's version of parameter sniffing: on a hard parse the optimizer looks at the current bind values and plans for them. Adaptive cursor sharing (11g) adds child cursors when the plan is bad for other values. *Owner: I-08.* See also: parameter sniffing.

<a id="binder"></a>
### binder / analyser — پیونددهنده / تحلیل‌گر
The pipeline stage after the parser that resolves names against the catalog, derives types, checks permissions and expands `*`. SQL Server calls it the algebrizer; "column does not exist" errors come from here. *Owner: I-08.* See also: parser, rewriter.

<a id="bitmap-heap-scan"></a>
### bitmap heap scan — پویش بیت‌نگاشتی هیپ (bitmap heap scan)
PostgreSQL access path that first collects matching row pointers from one or more indexes into an in-memory bitmap ordered by page, then visits each heap page once in file order. A lossy bitmap (one bit per page) needs a recheck of the condition. *Owner: I-07.* See also: bitmap index.

<a id="bitmap-index"></a>
### bitmap index — نمایهٔ بیت‌نگاشت (bitmap index)
An index that stores one compressed bit string per distinct value, one bit per row (Oracle). Very fast for combining low-cardinality predicates in warehouses; unsuitable for concurrent OLTP writes because one entry covers many rows. *Owner: I-07.* See also: bitmap heap scan.

<a id="block"></a>
### block — بلوک
Oracle's (and PostgreSQL's internal) name for a page: the fixed-size unit of storage and I/O, 8 KB by default. *Owner: I-06.* See also: page.

<a id="bloom-filter"></a>
### Bloom filter — فیلتر بلوم (Bloom filter)
A compact bit array that answers "definitely not present" or "maybe present" for a value. Used as skip indexes (ClickHouse), PostgreSQL's `bloom` extension, and run-time join filters pushed into scans. *Owner: I-07.* See also: skip index, hash join.

<a id="brin"></a>
### BRIN — نمایهٔ بازهٔ بلوکی (BRIN)
PostgreSQL's block range index: a tiny summary (min/max by default) per range of heap pages (128 by default). Effective only when the physical row order follows the column, such as append-only timestamps. *Owner: I-07.* See also: zone map.

<a id="buffer-pool"></a>
### buffer pool — استخر بافر (buffer pool)
The shared memory area where an engine caches data and index pages (`shared_buffers`, buffer cache, InnoDB buffer pool). A page found there is a logical read; otherwise it is a physical read from storage. *Owner: I-06.* See also: dirty page, clock sweep, logical read.

<a id="build-side"></a>
### build side — سمت ساخت (build side)
The input of a hash join that is read first into an in-memory hash table, normally the smaller one. If it does not fit in memory the join spills in batches. *Owner: I-08.* See also: probe side, hash join.

<a id="bushy-tree"></a>
### bushy tree — درخت انبوه (bushy tree)
A join tree in which both inputs of a join may themselves be joins. It enlarges the search space but can be better for star schemas and parallel hash joins. *Owner: I-08.* See also: left-deep tree, join order.

<a id="cardinality-estimate"></a>
### cardinality estimate — تخمین کاردینالیتی
The optimizer's guess of how many rows an operator returns, computed from statistics and selectivity formulas. Every cost depends on it, and errors multiply up the plan tree. *Owner: I-08.* See also: selectivity, statistics.

<a id="cardinality-statistics"></a>
### cardinality (statistics) — کاردینالیتی (در آمار)
In optimizer language, the number of distinct values in a column, or the number of rows an operator returns. Not the same as relationship cardinality in data modelling (I-02). *Owner: I-07.* See also: selectivity, density.

<a id="clock-sweep"></a>
### clock sweep — جاروب ساعتی (clock sweep)
PostgreSQL's buffer replacement algorithm: a hand circles the buffers, decrements usage counts and evicts the first buffer whose count is zero. It approximates LRU cheaply; big scans use a small ring buffer instead. *Owner: I-06.* See also: buffer pool.

<a id="clustered-index"></a>
### clustered index — نمایهٔ خوشه‌ای (clustered index)
A B+tree whose leaf level **is** the table, sorted by the index key (SQL Server, InnoDB). Secondary indexes then point to rows by clustering key, not by physical address. *Owner: I-06.* See also: heap, index-organised table, key lookup.

<a id="clustering-factor"></a>
### clustering factor — ضریب خوشه‌بندی (clustering factor)
Oracle index statistic: how many table-block changes a full scan of the index in key order would cause. Close to the number of blocks means good physical order and cheap range scans; close to the number of rows means random access. *Owner: I-07.* See also: statistics.

<a id="columnstore"></a>
### columnstore — ستون‌انبار (columnstore)
An index or table stored column by column in compressed segments with min/max metadata (SQL Server columnstore, Oracle In-Memory). Enables segment elimination and batch-mode execution for analytics. *Owner: I-07.* See also: vectorised execution, column store (I-15).

<a id="composite-index"></a>
### composite index — نمایهٔ ترکیبی (composite index)
An index on several columns, sorted by the first, then the second within equal first values, and so on. Column order decides which queries it can seek: equality columns first, then one range or sort column. *Owner: I-07.* See also: leftmost prefix, ESR rule.

<a id="cost-based-optimizer"></a>
### cost-based optimizer — بهینه‌ساز هزینه‌محور (cost-based optimizer)
An optimizer that estimates the cost of alternative plans from statistics and chooses the cheapest, as opposed to a rule-based optimizer with fixed preferences. All engines in this book are cost-based. *Owner: I-08.* See also: cost model, optimizer.

<a id="cost-model"></a>
### cost model — مدل هزینه (cost model)
The formulas that turn estimated page reads and per-row CPU work into a cost number, such as PostgreSQL's `seq_page_cost`, `random_page_cost` and `cpu_tuple_cost`. Costs compare plans of one query, not different queries. *Owner: I-08.* See also: cardinality estimate.

<a id="covering-index"></a>
### covering index — نمایهٔ پوشا (covering index)
An index that contains every column a query needs, so the table is never read. Built by adding key columns or `INCLUDE` columns. *Owner: I-07.* See also: INCLUDE columns, index-only scan, key lookup.

<a id="ctid"></a>
### ctid — ctid
PostgreSQL's physical row address: (block number, line pointer). It changes when a row is updated or the table is rewritten, so it must never be used as an identity. *Owner: I-06.* See also: RID, rowid.

<a id="density"></a>
### density — چگالی (density)
SQL Server statistics term: 1 / number of distinct values, the average selectivity of an equality on that column or column prefix. Used when the actual value is unknown. *Owner: I-07.* See also: selectivity, histogram.

<a id="dirty-page"></a>
### dirty page — صفحهٔ کثیف (dirty page)
A page modified in the buffer pool but not yet written to the data file. It is flushed later by background writers or checkpoints, always after its log records are durable. *Owner: I-06.* See also: buffer pool, checkpoint, WAL.

<a id="double-buffering"></a>
### double buffering — بافرگذاری دوگانه (double buffering)
The same page cached twice, in the database's buffer pool and in the operating-system page cache. PostgreSQL relies on it; engines using direct I/O avoid it. *Owner: I-06.* See also: buffer pool.

<a id="esr-rule"></a>
### ESR rule — قاعدهٔ ESR
MongoDB's guidance for compound index field order: Equality fields, then Sort fields, then Range fields. The same rule applies to B-tree composite indexes in relational engines. *Owner: I-07.* See also: composite index.

<a id="estimated-plan"></a>
### estimated plan — طرح تخمینی (estimated plan)
The plan the optimizer would use, with its estimates, produced without running the statement (`EXPLAIN`, `SHOWPLAN_XML`, `EXPLAIN PLAN`). Safe for any statement but cannot show wrong estimates. *Owner: I-08.* See also: actual plan.

<a id="explain"></a>
### EXPLAIN — EXPLAIN
The command family that shows a query plan: `EXPLAIN [ANALYZE]` (PostgreSQL, MySQL), `SET SHOWPLAN_XML`/`STATISTICS XML` (SQL Server), `EXPLAIN PLAN` + `DBMS_XPLAN` (Oracle), `EXPLAIN QUERY PLAN` (SQLite), `EXPLAIN PLAN/PIPELINE` (ClickHouse), `EXPLAIN USING` (Snowflake). Cassandra has none. *Owner: I-08.* See also: estimated plan, actual plan.

<a id="expression-index"></a>
### expression index — نمایهٔ عبارتی (expression index)
An index on the result of an expression such as `lower(name)` (Oracle: function-based index; MySQL: functional key part). A query can use it only with the identical expression; the function must be deterministic. *Owner: I-07.* See also: SARGable.

<a id="extent"></a>
### extent — اکستنت (extent)
A run of consecutive pages allocated together: 8 pages (64 KB) in SQL Server, 1 MB in InnoDB, tablespace-dependent in Oracle. *Owner: I-06.* See also: page, tablespace.

<a id="fan-out"></a>
### fan-out — ضریب انشعاب (fan-out)
The number of child pointers an internal B+tree page holds, typically hundreds. High fan-out keeps trees shallow: height grows with log base fan-out of the row count. *Owner: I-07.* See also: index height.

<a id="fill-factor"></a>
### fill factor — ضریب پرشدگی (fill factor)
The percentage of a page filled when it is built or rebuilt, leaving the rest for later inserts and updates (Oracle: PCTFREE, the percentage kept free). Lower values mean fewer splits and more HOT updates but more pages to read. *Owner: I-06.* See also: PCTFREE, page split.

<a id="filtered-index"></a>
### filtered index — نمایهٔ فیلترشده (filtered index)
SQL Server's partial index: `CREATE INDEX … WHERE <simple predicate>`. Cannot be used by a parameterised predicate whose value is unknown at compile time. *Owner: I-07.* See also: partial index.

<a id="forwarded-record"></a>
### forwarded record — رکورد ارجاعی (forwarded record)
A row in a SQL Server heap that moved to another page because it grew, leaving a forwarding stub at its old RID. Reads through the stub cost an extra page read; rebuilding the heap removes them. *Owner: I-06.* See also: row chaining.

<a id="fragmentation"></a>
### fragmentation — چندپارگی (fragmentation)
Logical fragmentation: index pages whose key order differs from their file order. Internal fragmentation: pages emptier than needed. On SSDs page density matters more than order. *Owner: I-07.* See also: index bloat, rebuild / reorganize.

<a id="free-space-map"></a>
### free space map — نقشهٔ فضای آزاد (free space map)
A structure that records roughly how much free space each page has, so inserts find room without reading pages (PostgreSQL `_fsm` fork, SQL Server PFS pages). *Owner: I-06.* See also: fill factor.

<a id="full-text-index"></a>
### full-text index — نمایهٔ تمام‌متن (full-text index)
An inverted index over words produced by an analyzer, answering word and phrase queries (`tsvector` + GIN, SQL Server full-text, MySQL `FULLTEXT`, Oracle Text, SQLite FTS5). *Owner: I-07.* See also: inverted index, GIN.

<a id="generic-plan"></a>
### generic plan — طرح عمومی (generic plan)
A PostgreSQL plan for a prepared statement built without parameter values, reused for every execution; custom plans are built per execution with the values. `plan_cache_mode` chooses. *Owner: I-08.* See also: prepared statement, parameter sniffing.

<a id="gin"></a>
### GIN — نمایهٔ معکوس عمومی (GIN)
PostgreSQL's generalized inverted index: one entry per element (array member, JSON key, word, trigram) pointing to every row that contains it. Ideal for `@>`, `?`, full-text and `pg_trgm`; writes are expensive. *Owner: I-07.* See also: inverted index.

<a id="gist"></a>
### GiST — درخت جست‌وجوی عمومی (GiST)
PostgreSQL's generalized search tree: a balanced tree of bounding predicates for geometry, ranges, nearest-neighbour search and exclusion constraints. *Owner: I-07.* See also: SP-GiST.

<a id="hash-index"></a>
### hash index — نمایهٔ هش (hash index)
An index that places entries in buckets by a hash of the key; it answers equality only, with no order or ranges (PostgreSQL `USING hash`, MEMORY engine, SQL Server memory-optimized tables). *Owner: I-07.* See also: hash join.

<a id="hash-join"></a>
### hash join — پیوند هش (hash join)
Join algorithm that builds a hash table from one input and probes it with each row of the other. Linear cost for large unsorted inputs, equality only, needs memory and may spill. *Owner: I-08.* See also: build side, probe side.

<a id="heap"></a>
### heap — هیپ (heap)
A table stored without any key order: rows go wherever there is free space and are found by physical address. PostgreSQL tables and Oracle tables by default are heaps. *Owner: I-06.* See also: clustered index, RID.

<a id="hint"></a>
### hint — راهنمای بهینه‌ساز (hint)
An instruction in the query that overrides one optimizer decision (join method, index, order, parallelism). It freezes today's choice; plan guides and baselines attach hints without changing query text. *Owner: I-08.* See also: plan cache.

<a id="hot-update"></a>
### HOT update — به‌روزرسانی HOT
PostgreSQL heap-only tuple update: when no indexed column changes and the page has room, the new row version stays on the same page and no index entry is added. Free space from a lower fill factor makes it possible. *Owner: I-06.* See also: fill factor.

<a id="include-columns"></a>
### INCLUDE columns — ستون‌های INCLUDE
Non-key columns stored only in an index's leaf entries (`INCLUDE (total)`; SQL Server, PostgreSQL 11+). They make the index covering without widening internal pages or affecting uniqueness. *Owner: I-07.* See also: covering index.

<a id="index"></a>
### index — نمایه (index)
A separate sorted (or hashed) structure that maps key values to row locations, so queries read a few pages instead of the whole table. Costs space and write work. *Owner: I-07.* See also: B+tree, covering index.

<a id="index-bloat"></a>
### index bloat — آماس نمایه (index bloat)
An index larger than its live entries need, because of half-empty pages and dead entries after updates and deletes. PostgreSQL 13+ deduplication and 14+ bottom-up deletion reduce it; `REINDEX CONCURRENTLY` removes it. *Owner: I-07.* See also: fragmentation.

<a id="index-condition-pushdown"></a>
### index condition pushdown — فروراندن شرط به نمایه (index condition pushdown)
MySQL/InnoDB optimisation that checks conditions on index columns inside the index before fetching the row (`Extra: Using index condition`). It reduces row lookups when a later key column cannot narrow the seek. *Owner: I-07.* See also: residual predicate.

<a id="index-height"></a>
### index height — ارتفاع نمایه (index height)
The number of levels from the root to the leaves of a B+tree; every point lookup reads one page per level. Three or four levels cover tens of millions to billions of keys. *Owner: I-07.* See also: fan-out.

<a id="index-only-scan"></a>
### index-only scan — پویش فقط‌نمایه (index-only scan)
A plan step that answers a query from the index alone. In PostgreSQL it still checks the visibility map and visits heap pages that are not all-visible (`Heap Fetches`). *Owner: I-07.* See also: covering index, visibility map.

<a id="index-organised-table"></a>
### index-organised table — جدول سازمان‌یافته با نمایه (IOT)
Oracle's clustered table (`ORGANIZATION INDEX`): the rows live in the primary-key B-tree. Secondary indexes use logical rowids. *Owner: I-06.* See also: clustered index.

<a id="index-rebuild"></a>
### rebuild / reorganize — بازسازی / سازمان‌دهی مجدد
Index maintenance: a rebuild creates the index again (dense pages, fresh statistics in SQL Server), a reorganize compacts and reorders leaf pages in place (SQL Server, always online). PostgreSQL uses `REINDEX [CONCURRENTLY]`. *Owner: I-07.* See also: fragmentation.

<a id="index-scan"></a>
### index scan — پویش نمایه (index scan)
Reading all or a large part of an index in key order. In PostgreSQL's plan vocabulary `Index Scan` also names a seek with row fetches; SQL Server's `Index Scan` is a full index read. *Owner: I-08.* See also: index seek.

<a id="index-seek"></a>
### index seek — جست‌وجوی نمایه (index seek)
Descending a B+tree from the root to the first qualifying key, then reading forward while keys qualify. The access path for selective SARGable predicates. *Owner: I-08.* See also: seek predicate.

<a id="interesting-order"></a>
### interesting order — ترتیب سودمند (interesting order)
A sort order of an intermediate result that a later operator can use (merge join, `ORDER BY`, `GROUP BY`). Dynamic-programming optimizers keep plans that deliver one even if they are not the cheapest so far. *Owner: I-08.* See also: merge join.

<a id="internal-node"></a>
### internal node — گرهٔ داخلی (internal node)
A non-leaf B+tree page holding separator keys and child pointers; the root is the top internal node. *Owner: I-07.* See also: leaf node.

<a id="inverted-index"></a>
### inverted index — نمایهٔ معکوس (inverted index)
A map from each term or element to the list of rows or documents that contain it; the basis of full-text search, GIN and Elasticsearch. *Owner: I-07 (also used in I-16).* See also: full-text index, GIN.

<a id="join-order"></a>
### join order — ترتیب پیوند (join order)
The sequence in which a plan joins its tables. The search space grows factorially; engines use dynamic programming (PostgreSQL up to 12 relations), Cascades search (SQL Server) or greedy search (MySQL). *Owner: I-08.* See also: left-deep tree.

<a id="key-lookup"></a>
### key lookup — جست‌وجوی کلید (key lookup)
SQL Server operator that fetches the rest of a row from the clustered index after a nonclustered index seek, once per row. Many executions of it are a sign that a covering index is missing. *Owner: I-07.* See also: RID lookup, covering index.

<a id="leaf-node"></a>
### leaf node — گرهٔ برگ (leaf node)
The bottom level of a B+tree: every key in order with its row pointer (or the row, in a clustered index), linked to its neighbours for range scans. *Owner: I-07.* See also: internal node.

<a id="left-deep-tree"></a>
### left-deep tree — درخت چپ‌عمیق (left-deep tree)
A join tree in which every join's inner input is a base table. Pipelines well with nested loops and keeps the search small. *Owner: I-08.* See also: bushy tree.

<a id="leftmost-prefix"></a>
### leftmost prefix — قاعدهٔ پیشوند چپ (leftmost prefix)
A composite B-tree index can be searched only on a leading run of its columns; `(a, b)` serves `a = ?` and `a = ? AND b = ?`, not `b = ?` alone (except by skip scan). *Owner: I-07.* See also: composite index, skip scan.

<a id="line-pointer"></a>
### line pointer — اشاره‌گر سطر (line pointer)
PostgreSQL's 4-byte slot entry in a page header area that points to a tuple's offset; the second part of a `ctid`. *Owner: I-06.* See also: slotted page, ctid.

<a id="lob"></a>
### LOB — شیء بزرگ (LOB)
Large object: a value too big for in-row storage (`varchar(max)`, `BLOB`, `CLOB`), stored in separate pages or segments with a pointer in the row. *Owner: I-06.* See also: off-row, TOAST.

<a id="logical-plan"></a>
### logical plan — طرح منطقی (logical plan)
A query expressed as relational operators (scan, filter, join, aggregate) without choosing algorithms or order. The optimizer turns it into a physical plan. *Owner: I-08.* See also: physical plan.

<a id="logical-read"></a>
### logical read / physical read — خواندن منطقی / خواندن فیزیکی
A logical read finds the page in the buffer pool; a physical read fetches it from storage. Plans and I/O statistics report both (`shared hit` / `read`, `logical reads` / `physical reads`). *Owner: I-06.* See also: buffer pool.

<a id="memory-grant"></a>
### memory grant — سهمیهٔ حافظه (memory grant)
SQL Server's working memory reserved for a query's sorts and hashes before it runs, sized from estimates. Too small causes spills; too large makes other queries wait. *Owner: I-08.* See also: spill.

<a id="merge-join"></a>
### merge join — پیوند ادغامی (merge join)
Join algorithm that walks two inputs sorted on the join key in step. Cheap when both inputs are already ordered; otherwise it needs sorts. *Owner: I-08.* See also: interesting order.

<a id="most-common-values"></a>
### most common values (MCV) — پرتکرارترین مقدارها (MCV)
Statistics listing the most frequent values of a column with their frequencies (`pg_stats.most_common_vals`, Oracle frequency histograms). They give exact estimates for skewed values. *Owner: I-07.* See also: histogram.

<a id="nested-loop-join"></a>
### nested loop join — پیوند حلقهٔ تودرتو (nested loop join)
Join algorithm that probes the inner input once per outer row, ideally through an index seek. Best for small outer inputs; SQLite's only join algorithm. *Owner: I-08.* See also: hash join, merge join.

<a id="off-row"></a>
### off-row — بیرون از سطر (off-row)
Storage of a large column value outside the row's page, with only a pointer in the row (TOAST, LOB, row-overflow, off-page columns, overflow pages). *Owner: I-06.* See also: TOAST, LOB.

<a id="operator"></a>
### operator — عملگر (operator)
One node of a physical plan (scan, seek, join, sort, aggregate, exchange). Each reports estimated and, in an actual plan, real rows and time. *Owner: I-08.* See also: physical plan.

<a id="optimizer"></a>
### optimizer — بهینه‌ساز (optimizer)
The engine component that chooses how to execute a declarative query: access paths, join order and algorithms, from statistics and a cost model. *Owner: I-08.* See also: cost-based optimizer.

<a id="overflow-page"></a>
### overflow page — صفحهٔ سرریز (overflow page)
SQLite page holding the tail of a record too large for its B-tree page, chained from the cell. *Owner: I-06.* See also: off-row.

<a id="page"></a>
### page — صفحه (page)
The fixed-size block (8 KB in PostgreSQL and SQL Server, 16 KB in InnoDB, 4 KB in SQLite by default) that an engine reads, writes, caches and logs as a unit. *Owner: I-06.* See also: block, slotted page.

<a id="page-split"></a>
### page split — شکافتن صفحه (page split)
When a B+tree page is full, the engine moves about half of its entries to a new page and adds a separator to the parent; a root split grows the tree. Random keys cause frequent splits and half-empty pages. *Owner: I-07.* See also: fill factor.

<a id="parameter-sniffing"></a>
### parameter sniffing — parameter sniffing (بو کشیدن پارامتر)
SQL Server compiles a parameterised plan for the values of its first execution and reuses it for every value. Harmful when data is skewed; fixed with `RECOMPILE`, `OPTIMIZE FOR`, plan forcing or PSP optimization. *Owner: I-08.* See also: bind peeking, generic plan.

<a id="parse-tree"></a>
### parse tree — درخت تجزیه (parse tree)
The tree the parser builds from the tokens of a statement, before names are resolved. *Owner: I-08.* See also: parser.

<a id="parser"></a>
### parser — تجزیه‌گر (parser)
The first pipeline stage: tokenises the SQL text and checks its grammar, producing a parse tree; syntax errors come from here. *Owner: I-08.* See also: binder.

<a id="partial-index"></a>
### partial index — نمایهٔ جزئی (partial index)
An index on only the rows matching a `WHERE` clause (PostgreSQL, SQLite). Usable only when the query's predicate implies the index predicate. *Owner: I-07.* See also: filtered index.

<a id="pctfree"></a>
### PCTFREE — PCTFREE
Oracle's per-block free-space reserve (default 10%), the inverse of a fill factor; room for rows to grow without migrating. *Owner: I-06.* See also: fill factor, row chaining.

<a id="physical-plan"></a>
### physical plan — طرح فیزیکی (physical plan)
The executable tree of operators with concrete algorithms, access paths and order, chosen by the optimizer. This is what `EXPLAIN` shows. *Owner: I-08.* See also: logical plan.

<a id="pipeline-breaker"></a>
### pipeline breaker — شکنندهٔ خط لوله (pipeline breaker)
An operator that must consume its whole input before producing output (sort, hash build, hash aggregate). Where memory is needed and spills happen. *Owner: I-08.* See also: Volcano model, spill.

<a id="plan-cache"></a>
### plan cache — حافظهٔ نهان طرح (plan cache)
A store of compiled plans reused by later executions of the same statement (SQL Server instance-wide, Oracle shared cursor cache, PostgreSQL per session for prepared statements). *Owner: I-08.* See also: prepared statement.

<a id="predicate-push-down"></a>
### predicate push-down — فروراندن گزاره (predicate push-down)
Applying a filter as early as possible: below joins, into views and scans, or to a remote source, so fewer rows flow up the plan. Rowlit's federation uses it per source (II-16). *Owner: I-08.* See also: projection pruning, push-down (II-16).

<a id="prepared-statement"></a>
### prepared statement — دستور آماده (prepared statement)
A statement parsed and planned once with parameters and executed many times with different values. Saves compile time and prevents SQL injection. *Owner: I-08.* See also: plan cache, generic plan.

<a id="probe-side"></a>
### probe side — سمت کاوش (probe side)
The input of a hash join streamed row by row against the hash table of the build side. *Owner: I-08.* See also: build side.

<a id="projection-pruning"></a>
### projection pruning — هرس ستون‌ها (projection pruning)
Reading and carrying only the columns a query uses. In column stores it is the main saving; in federation it reduces data fetched from sources. *Owner: I-08.* See also: predicate push-down.

<a id="random-io"></a>
### random I/O — ورودی/خروجی تصادفی (random I/O)
Reads of pages at scattered positions, each a separate request; much more expensive per page than sequential I/O, especially on hard disks. *Owner: I-06.* See also: sequential scan.

<a id="residual-predicate"></a>
### residual predicate — گزارهٔ باقی‌مانده (residual predicate)
A condition checked after a row or index entry is read, which only discards rows (PostgreSQL `Filter`, SQL Server `Predicate`, Oracle `filter`). *Owner: I-07.* See also: seek predicate.

<a id="reverse-key-index"></a>
### reverse key index — نمایهٔ کلید معکوس (reverse key index)
Oracle index that stores key bytes reversed, spreading sequential inserts over many leaves to avoid a hot right-most block; it cannot serve range scans. *Owner: I-07.* See also: page split.

<a id="rewriter"></a>
### rewriter — بازنویس (rewriter)
Pipeline stage that applies always-valid transformations: view expansion, rules, row-level security, constant folding. *Owner: I-08.* See also: binder, optimizer.

<a id="rid"></a>
### RID — RID
Row identifier in a SQL Server heap: file : page : slot (8 bytes). Nonclustered indexes on a heap point to rows by RID. *Owner: I-06.* See also: RID lookup, ctid.

<a id="rid-lookup"></a>
### RID lookup — جست‌وجوی RID (RID lookup)
SQL Server operator that fetches a heap row by its RID after a nonclustered index seek. *Owner: I-07.* See also: key lookup.

<a id="row-chaining"></a>
### row migration / chaining — مهاجرت سطر / زنجیره‌شدن سطر
Oracle: migration moves a grown row to another block leaving a pointer; chaining splits a row larger than a block over several blocks. Both cost extra reads. *Owner: I-06.* See also: forwarded record, PCTFREE.

<a id="row-overflow"></a>
### row-overflow — سرریز سطر (row-overflow)
SQL Server allocation unit for variable-length values that push a row past 8,060 bytes; the row keeps a 24-byte pointer. *Owner: I-06.* See also: LOB.

<a id="rowid"></a>
### rowid / ROWID — rowid / ROWID
SQLite: the 64-bit integer key of every rowid table (aliased by `INTEGER PRIMARY KEY`). Oracle: the physical address of a row (object, file, block, row). *Owner: I-06.* See also: RID, ctid.

<a id="sai"></a>
### SAI — نمایهٔ پیوست به ذخیره‌سازی (SAI)
Cassandra 5's storage-attached index, built per SSTable and memtable, supporting equality and range queries on non-key columns much more cheaply than legacy secondary indexes. *Owner: I-07.* See also: secondary index.

<a id="secondary-index"></a>
### secondary index — نمایهٔ ثانویه (secondary index)
Any index other than the one that orders the table itself. In Cassandra, a node-local index on a non-key column that requires a query to every node. *Owner: I-07.* See also: SAI, clustered index.

<a id="seek-predicate"></a>
### seek predicate — گزارهٔ جست‌وجو (seek predicate)
A condition that limits which part of an index is read (SQL Server `Seek Predicates`, Oracle `access`, PostgreSQL `Index Cond` on leading columns). *Owner: I-07.* See also: residual predicate.

<a id="selectivity"></a>
### selectivity — گزینندگی (selectivity)
The fraction of rows a predicate keeps; "highly selective" means a small fraction. The optimizer multiplies it by row counts to estimate cardinalities. *Owner: I-07.* See also: cardinality estimate.

<a id="semi-join"></a>
### semi-join — نیم‌پیوند (semi-join)
A join that returns each row of one input at most once if a match exists (`EXISTS`, `IN`). Subquery unnesting turns such subqueries into semi-joins. *Owner: I-08.* See also: anti-join.

<a id="sequential-scan"></a>
### sequential scan — پویش ترتیبی (sequential scan)
Reading all pages of a table in file order; cheap per page thanks to read-ahead and large requests. *Owner: I-06.* See also: table scan, random I/O.

<a id="skip-index"></a>
### skip index — نمایهٔ پرش (skip index)
ClickHouse data skipping index (`minmax`, `set`, `bloom_filter`, `tokenbf_v1`, `ngrambf_v1`): a summary per block of granules that lets reads skip blocks that cannot match. *Owner: I-07.* See also: sparse index, zone map.

<a id="skip-scan"></a>
### skip scan — پویش پرشی (skip scan)
Using a composite index without its leading column by seeking once per distinct leading value (Oracle, MySQL 8.0.13+, SQLite after `ANALYZE`, PostgreSQL 18). *Owner: I-07.* See also: leftmost prefix.

<a id="slotted-page"></a>
### slotted page — صفحهٔ شکاف‌دار (slotted page)
Page layout with a header, a slot array pointing to rows, free space, and rows packed from the other end; rows can move inside the page without changing their address. *Owner: I-06.* See also: line pointer.

<a id="sp-gist"></a>
### SP-GiST — SP-GiST
PostgreSQL's space-partitioned GiST: unbalanced partitioning trees (quadtrees, k-d trees, radix tries) for points, IP ranges and text prefixes. *Owner: I-07.* See also: GiST.

<a id="sparse-index"></a>
### sparse index — نمایهٔ تُنُک (sparse index)
An index with one entry per block of rows rather than per row, such as ClickHouse's primary index (one mark per 8,192-row granule). Tiny, but requires data sorted by the key. *Owner: I-07.* See also: skip index.

<a id="spill"></a>
### spill — سرریز به دیسک (spill)
Writing a sort, hash table or aggregate to disk because it exceeded its memory budget; often ten times slower. Usually caused by underestimated rows. *Owner: I-08.* See also: memory grant, pipeline breaker.

<a id="statistics"></a>
### statistics — آمار (statistics)
Summaries the optimizer keeps about tables and columns: row and page counts, nulls, distinct values, most common values, histograms, correlation. Refreshed by `ANALYZE`, auto-stats or `DBMS_STATS`. *Owner: I-07.* See also: histogram, cardinality estimate.

<a id="histogram"></a>
### histogram — هیستوگرام (histogram)
Statistics that cut a column's sorted values into buckets (equi-depth in PostgreSQL, up to 200 steps in SQL Server, several kinds in Oracle) to estimate ranges and non-common values. *Owner: I-07.* See also: statistics, most common values.

<a id="table-scan"></a>
### table scan — پویش جدول (table scan)
An access path that reads every row of a table (PostgreSQL `Seq Scan`, SQL Server `Table Scan` / `Clustered Index Scan`, Oracle `TABLE ACCESS FULL`, MySQL `type: ALL`). Right for large fractions and small tables. *Owner: I-08.* See also: sequential scan.

<a id="tablespace"></a>
### tablespace — فضای جدول (tablespace)
A named group of data files where objects are placed (Oracle, PostgreSQL, InnoDB; SQL Server filegroups). *Owner: I-06.* See also: extent.

<a id="toast"></a>
### TOAST — TOAST
PostgreSQL's off-row storage: values in rows wider than about 2 KB are compressed and/or moved in chunks to a side table, leaving an 18-byte pointer. *Owner: I-06.* See also: off-row, LOB.

<a id="unique-index"></a>
### unique index — نمایهٔ یکتا (unique index)
An index that rejects duplicate keys; it enforces `PRIMARY KEY` and `UNIQUE` constraints. NULL handling differs per engine. *Owner: I-07.* See also: index.

<a id="uniquifier"></a>
### uniquifier — یکتاساز (uniquifier)
A hidden 4-byte value SQL Server adds to duplicate keys of a non-unique clustered index so every row has a unique locator. *Owner: I-06.* See also: clustered index.

<a id="vectorised-execution"></a>
### vectorised execution — اجرای برداری (vectorised execution)
Executing operators on batches of column values instead of one row at a time, so tight loops use CPU caches and SIMD (ClickHouse, DuckDB, Snowflake, SQL Server batch mode). *Owner: I-08 (also I-15).* See also: Volcano model.

<a id="visibility-map"></a>
### visibility map — نقشهٔ مرئی‌بودن (visibility map)
PostgreSQL per-table bitmap (`_vm` fork) marking pages whose rows are all visible (and all frozen). Index-only scans skip heap visits for those pages; VACUUM sets the bits. *Owner: I-07.* See also: index-only scan, VACUUM.

<a id="volcano-model"></a>
### Volcano model — مدل Volcano (iterator model)
Execution model in which each operator implements `open`/`next`/`close` and pulls one row at a time from its children (Graefe, 1994). Simple and pipelined; per-row overhead is its cost. *Owner: I-08.* See also: vectorised execution.

<a id="without-rowid"></a>
### WITHOUT ROWID — WITHOUT ROWID
SQLite table option that stores the table clustered on its declared primary key instead of a hidden rowid, saving a separate index for non-integer keys. *Owner: I-06.* See also: rowid, clustered index.

<a id="zone-map"></a>
### zone map — نقشهٔ ناحیه (zone map)
Min/max (and sometimes other) summaries per block of rows used to skip blocks: PostgreSQL BRIN, ClickHouse minmax indexes, Snowflake micro-partition metadata, DuckDB row groups. *Owner: I-07.* See also: BRIN, skip index.

## ردیف‌های فارسی

<a id="access-path"></a>
### access path — مسیر دسترسی
روشی که طرح اجرا یک جدول را می‌خواند: پویش کامل، جست‌وجوی نمایه، پویش فقط‌نمایه، پویش بیت‌نگاشتی یا واکشی با نشانی سطر. بهینه‌ساز هزینهٔ هر مسیر را می‌سنجد و برای هر جدول یکی را برمی‌گزیند. *مالک: I-08.* نیز ببینید: table scan، index seek.

<a id="actual-plan"></a>
### actual plan — طرح واقعی
طرحی که هنگام اجرای واقعی دستور گرفته می‌شود و برای هر عملگر تعداد سطر، زمان و ورودی/خروجی واقعی را نشان می‌دهد. سطرهای واقعی را با تخمینی مقایسه کنید؛ چون دستور اجرا می‌شود، DML را در تراکنشی بگذارید که rollback شود. *مالک: I-08.* نیز ببینید: estimated plan، EXPLAIN.

<a id="anti-join"></a>
### anti-join — پادپیوند
پیوندی که سطرهایی از یک ورودی را نگه می‌دارد که در ورودی دیگر **هیچ** تطابقی ندارند (`NOT EXISTS`، `NOT IN`). با همان الگوریتم‌های پیوند و با توقف در نخستین تطابق پیاده می‌شود. *مالک: I-08.* نیز ببینید: semi-join.

<a id="b-plus-tree"></a>
### B+tree — درخت B+ (B+tree)
ساختار درختی تقریباً همهٔ نمایه‌های رابطه‌ای: کلیدهای جداکننده در صفحه‌های داخلی، همهٔ کلیدها (و اشاره‌گر سطر یا خود سطر) در صفحه‌های برگِ به‌هم‌پیوسته. کم‌عمق است (3 تا 4 سطح برای میلیون‌ها سطر) و برای seek و پویش بازه‌ای هر دو مناسب است. *مالک: I-07.* نیز ببینید: B-tree، leaf node، fan-out.

<a id="b-tree"></a>
### B-tree — درخت B (B-tree)
درخت جست‌وجوی متوازن از صفحه‌ها (Bayer و McCreight، 1970) که همهٔ برگ‌هایش هم‌عمق‌اند. در زبان پایگاه داده «نمایهٔ B-tree» تقریباً همیشه یعنی گونهٔ B+tree؛ درخت‌های نمایهٔ SQLite B-tree کلاسیک‌اند. *مالک: I-07.* نیز ببینید: B+tree.

<a id="bind-peeking"></a>
### bind peeking — نگاه به مقدار bind (bind peeking)
نسخهٔ Oracle از parameter sniffing: در hard parse بهینه‌ساز به مقدارهای bind فعلی نگاه می‌کند و برای آن‌ها طرح می‌سازد. adaptive cursor sharing (11g) برای مقدارهای دیگر cursor فرزند می‌سازد. *مالک: I-08.* نیز ببینید: parameter sniffing.

<a id="binder"></a>
### binder / analyser — پیونددهنده / تحلیل‌گر
مرحلهٔ پس از تجزیه‌گر که نام‌ها را در کاتالوگ پیدا می‌کند، نوع‌ها را تعیین می‌کند، دسترسی را بررسی و `*` را باز می‌کند. SQL Server آن را algebrizer می‌نامد؛ خطای «ستون وجود ندارد» از این‌جا می‌آید. *مالک: I-08.* نیز ببینید: parser، rewriter.

<a id="bitmap-heap-scan"></a>
### bitmap heap scan — پویش بیت‌نگاشتی هیپ (bitmap heap scan)
مسیر دسترسی PostgreSQL که ابتدا اشاره‌گرهای سطرهای منطبق را از یک یا چند نمایه در بیت‌نگاشتی مرتب بر اساس صفحه جمع می‌کند، سپس هر صفحهٔ هیپ را یک بار و به ترتیب فایل می‌خواند. بیت‌نگاشت lossy بازبینی شرط لازم دارد. *مالک: I-07.* نیز ببینید: bitmap index.

<a id="bitmap-index"></a>
### bitmap index — نمایهٔ بیت‌نگاشت (bitmap index)
نمایه‌ای که برای هر مقدار متمایز یک رشتهٔ بیتی فشرده با یک بیت برای هر سطر نگه می‌دارد (Oracle). برای ترکیب گزاره‌های کم‌تنوع در انبار داده بسیار سریع است؛ برای نوشتن هم‌زمان OLTP نامناسب، چون یک مدخل سطرهای زیادی را می‌پوشاند. *مالک: I-07.* نیز ببینید: bitmap heap scan.

<a id="block"></a>
### block — بلوک
نام Oracle (و نام درونی PostgreSQL) برای صفحه: واحد ثابت ذخیره‌سازی و ورودی/خروجی، به‌طور پیش‌فرض 8 KB. *مالک: I-06.* نیز ببینید: page.

<a id="bloom-filter"></a>
### Bloom filter — فیلتر بلوم (Bloom filter)
آرایهٔ بیتی فشرده‌ای که برای یک مقدار پاسخ می‌دهد «قطعاً نیست» یا «شاید هست». در نمایه‌های پرش ClickHouse، افزونهٔ `bloom` در PostgreSQL و فیلترهای زمان اجرای پیوند به کار می‌رود. *مالک: I-07.* نیز ببینید: skip index، hash join.

<a id="brin"></a>
### BRIN — نمایهٔ بازهٔ بلوکی (BRIN)
نمایهٔ بازهٔ بلوکی PostgreSQL: خلاصه‌ای بسیار کوچک (به‌طور پیش‌فرض کمینه/بیشینه) برای هر بازه از صفحه‌های هیپ (پیش‌فرض 128). فقط وقتی مؤثر است که ترتیب فیزیکی سطرها از ستون پیروی کند، مثل زمان‌های فقط‌افزودنی. *مالک: I-07.* نیز ببینید: zone map.

<a id="buffer-pool"></a>
### buffer pool — استخر بافر (buffer pool)
ناحیهٔ حافظهٔ مشترکی که موتور صفحه‌های داده و نمایه را در آن نگه می‌دارد (`shared_buffers`، buffer cache، buffer pool در InnoDB). صفحه‌ای که آن‌جا پیدا شود خواندن منطقی است؛ وگرنه خواندن فیزیکی از حافظهٔ ماندگار. *مالک: I-06.* نیز ببینید: dirty page، clock sweep، logical read.

<a id="build-side"></a>
### build side — سمت ساخت (build side)
ورودی hash join که ابتدا در یک جدول هش درون حافظه خوانده می‌شود؛ معمولاً ورودی کوچک‌تر. اگر در حافظه جا نشود، پیوند به‌صورت دسته‌ای سرریز می‌کند. *مالک: I-08.* نیز ببینید: probe side، hash join.

<a id="bushy-tree"></a>
### bushy tree — درخت انبوه (bushy tree)
درخت پیوندی که هر دو ورودی یک پیوند می‌توانند خودشان پیوند باشند. فضای جست‌وجو را بزرگ می‌کند ولی برای star schema و hash join موازی می‌تواند بهتر باشد. *مالک: I-08.* نیز ببینید: left-deep tree، join order.

<a id="cardinality-estimate"></a>
### cardinality estimate — تخمین کاردینالیتی
حدس بهینه‌ساز از تعداد سطرهای خروجی یک عملگر، بر پایهٔ آمار و فرمول‌های گزینندگی. همهٔ هزینه‌ها به آن وابسته‌اند و خطاهایش در درخت طرح ضرب می‌شوند. *مالک: I-08.* نیز ببینید: selectivity، statistics.

<a id="cardinality-statistics"></a>
### cardinality (statistics) — کاردینالیتی (در آمار)
در زبان بهینه‌ساز، تعداد مقدارهای متمایز یک ستون یا تعداد سطرهای خروجی یک عملگر. با کاردینالیتی رابطه در مدل‌سازی داده (I-02) یکی نیست. *مالک: I-07.* نیز ببینید: selectivity، density.

<a id="clock-sweep"></a>
### clock sweep — جاروب ساعتی (clock sweep)
الگوریتم جایگزینی بافر در PostgreSQL: عقربه‌ای دور بافرها می‌چرخد، شمارندهٔ استفاده را کم می‌کند و نخستین بافر با شمارندهٔ صفر را بیرون می‌راند. تقریب ارزانی از LRU است؛ پویش‌های بزرگ از ring buffer کوچکی استفاده می‌کنند. *مالک: I-06.* نیز ببینید: buffer pool.

<a id="clustered-index"></a>
### clustered index — نمایهٔ خوشه‌ای (clustered index)
B+treeای که سطح برگش **خود** جدول است، مرتب بر اساس کلید نمایه (SQL Server، InnoDB). نمایه‌های ثانویه با کلید خوشه‌بندی به سطر اشاره می‌کنند، نه با نشانی فیزیکی. *مالک: I-06.* نیز ببینید: heap، index-organised table، key lookup.

<a id="clustering-factor"></a>
### clustering factor — ضریب خوشه‌بندی (clustering factor)
آمار نمایه در Oracle: پویش کامل نمایه به ترتیب کلید چند بار بلوک جدول را عوض می‌کند. نزدیک به تعداد بلوک‌ها یعنی ترتیب فیزیکی خوب و پویش بازه‌ای ارزان؛ نزدیک به تعداد سطرها یعنی دسترسی تصادفی. *مالک: I-07.* نیز ببینید: statistics.

<a id="columnstore"></a>
### columnstore — ستون‌انبار (columnstore)
نمایه یا جدولی که ستون‌به‌ستون در قطعه‌های فشرده با فرادادهٔ کمینه/بیشینه ذخیره می‌شود (columnstore در SQL Server، In-Memory در Oracle). حذف قطعه (segment elimination) و اجرای batch mode را برای تحلیل ممکن می‌کند. *مالک: I-07.* نیز ببینید: vectorised execution، column store (I-15).

<a id="composite-index"></a>
### composite index — نمایهٔ ترکیبی (composite index)
نمایه روی چند ستون، مرتب بر اساس ستون اول، سپس دوم در میان مقدارهای برابرِ اول و الی آخر. ترتیب ستون‌ها تعیین می‌کند کدام پرس‌وجوها seek می‌شوند: اول ستون‌های برابری، بعد یک ستون بازه یا مرتب‌سازی. *مالک: I-07.* نیز ببینید: leftmost prefix، ESR rule.

<a id="cost-based-optimizer"></a>
### cost-based optimizer — بهینه‌ساز هزینه‌محور (cost-based optimizer)
بهینه‌سازی که هزینهٔ طرح‌های جایگزین را از روی آمار تخمین می‌زند و ارزان‌ترین را برمی‌گزیند، در برابر بهینه‌ساز قاعده‌محور با ترجیح‌های ثابت. همهٔ موتورهای این کتاب هزینه‌محورند. *مالک: I-08.* نیز ببینید: cost model، optimizer.

<a id="cost-model"></a>
### cost model — مدل هزینه (cost model)
فرمول‌هایی که خواندن‌های تخمینی صفحه و کار CPU برای هر سطر را به یک عدد هزینه تبدیل می‌کنند، مثل `seq_page_cost`، `random_page_cost` و `cpu_tuple_cost` در PostgreSQL. هزینه‌ها فقط طرح‌های یک پرس‌وجو را مقایسه می‌کنند. *مالک: I-08.* نیز ببینید: cardinality estimate.

<a id="covering-index"></a>
### covering index — نمایهٔ پوشا (covering index)
نمایه‌ای که همهٔ ستون‌های لازم یک پرس‌وجو را دارد، پس جدول هرگز خوانده نمی‌شود. با افزودن ستون کلید یا ستون `INCLUDE` ساخته می‌شود. *مالک: I-07.* نیز ببینید: INCLUDE columns، index-only scan، key lookup.

<a id="ctid"></a>
### ctid — ctid
نشانی فیزیکی سطر در PostgreSQL: (شمارهٔ بلوک، اشاره‌گر سطر). با به‌روزرسانی سطر یا بازنویسی جدول عوض می‌شود، پس هرگز نباید شناسه به حساب بیاید. *مالک: I-06.* نیز ببینید: RID، rowid.

<a id="density"></a>
### density — چگالی (density)
اصطلاح آماری SQL Server: یک تقسیم بر تعداد مقدارهای متمایز؛ گزینندگی میانگین یک برابری روی آن ستون یا پیشوند ستون‌ها. وقتی مقدار واقعی معلوم نیست به کار می‌رود. *مالک: I-07.* نیز ببینید: selectivity، histogram.

<a id="dirty-page"></a>
### dirty page — صفحهٔ کثیف (dirty page)
صفحه‌ای که در استخر بافر تغییر کرده ولی هنوز در فایل داده نوشته نشده است. بعداً نویسنده‌های پس‌زمینه یا checkpoint آن را می‌نویسند، همیشه پس از ماندگار شدن رکوردهای لاگش. *مالک: I-06.* نیز ببینید: buffer pool، checkpoint، WAL.

<a id="double-buffering"></a>
### double buffering — بافرگذاری دوگانه (double buffering)
نگه‌داری یک صفحه در دو جا: استخر بافر پایگاه داده و حافظهٔ نهان صفحهٔ سیستم‌عامل. PostgreSQL به آن تکیه دارد؛ موتورهایی که direct I/O دارند از آن پرهیز می‌کنند. *مالک: I-06.* نیز ببینید: buffer pool.

<a id="esr-rule"></a>
### ESR rule — قاعدهٔ ESR
راهنمای MongoDB برای ترتیب فیلدهای نمایهٔ ترکیبی: اول فیلدهای برابری (Equality)، بعد مرتب‌سازی (Sort)، بعد بازه (Range). همین قاعده برای نمایه‌های ترکیبی B-tree در موتورهای رابطه‌ای هم درست است. *مالک: I-07.* نیز ببینید: composite index.

<a id="estimated-plan"></a>
### estimated plan — طرح تخمینی (estimated plan)
طرحی که بهینه‌ساز به کار می‌برد، همراه با تخمین‌هایش، بدون اجرای دستور (`EXPLAIN`، `SHOWPLAN_XML`، `EXPLAIN PLAN`). برای هر دستوری بی‌خطر است ولی تخمین‌های غلط را نشان نمی‌دهد. *مالک: I-08.* نیز ببینید: actual plan.

<a id="explain"></a>
### EXPLAIN — EXPLAIN
خانوادهٔ فرمان‌هایی که طرح پرس‌وجو را نشان می‌دهند: `EXPLAIN [ANALYZE]` (PostgreSQL، MySQL)، `SET SHOWPLAN_XML`/`STATISTICS XML` (SQL Server)، `EXPLAIN PLAN` و `DBMS_XPLAN` (Oracle)، `EXPLAIN QUERY PLAN` (SQLite)، `EXPLAIN PLAN/PIPELINE` (ClickHouse)، `EXPLAIN USING` (Snowflake). Cassandra چنین فرمانی ندارد. *مالک: I-08.* نیز ببینید: estimated plan، actual plan.

<a id="expression-index"></a>
### expression index — نمایهٔ عبارتی (expression index)
نمایه روی نتیجهٔ یک عبارت مثل `lower(name)` (در Oracle: نمایهٔ تابع‌محور؛ در MySQL: functional key part). پرس‌وجو فقط با همان عبارت می‌تواند از آن استفاده کند و تابع باید قطعی (deterministic) باشد. *مالک: I-07.* نیز ببینید: SARGable.

<a id="extent"></a>
### extent — اکستنت (extent)
دنباله‌ای از صفحه‌های پشت‌سرهم که با هم تخصیص می‌یابند: 8 صفحه (64 KB) در SQL Server، 1 MB در InnoDB، وابسته به tablespace در Oracle. *مالک: I-06.* نیز ببینید: page، tablespace.

<a id="fan-out"></a>
### fan-out — ضریب انشعاب (fan-out)
تعداد اشاره‌گرهای فرزند در یک صفحهٔ داخلی B+tree، معمولاً چند صد. ضریب انشعاب بالا درخت را کم‌عمق نگه می‌دارد. *مالک: I-07.* نیز ببینید: index height.

<a id="fill-factor"></a>
### fill factor — ضریب پرشدگی (fill factor)
درصدی از صفحه که هنگام ساخت یا بازسازی پر می‌شود و بقیه برای درج و به‌روزرسانی بعدی می‌ماند (در Oracle: PCTFREE، درصد فضای آزاد). مقدار کمتر یعنی شکافتن کمتر و HOT بیشتر، ولی صفحه‌های بیشتر برای خواندن. *مالک: I-06.* نیز ببینید: PCTFREE، page split.

<a id="filtered-index"></a>
### filtered index — نمایهٔ فیلترشده (filtered index)
نمایهٔ جزئی در SQL Server: `CREATE INDEX … WHERE <گزارهٔ ساده>`. گزارهٔ پارامتری که مقدارش هنگام کامپایل معلوم نیست نمی‌تواند از آن استفاده کند. *مالک: I-07.* نیز ببینید: partial index.

<a id="forwarded-record"></a>
### forwarded record — رکورد ارجاعی (forwarded record)
سطری در هیپ SQL Server که چون بزرگ شده به صفحهٔ دیگری رفته و در RID قبلی یک ارجاع گذاشته است. خواندن از راه ارجاع یک صفحهٔ اضافه هزینه دارد؛ بازسازی هیپ آن را حذف می‌کند. *مالک: I-06.* نیز ببینید: row chaining.

<a id="fragmentation"></a>
### fragmentation — چندپارگی (fragmentation)
چندپارگی منطقی: صفحه‌های نمایه‌ای که ترتیب کلیدشان با ترتیب فایل فرق دارد. چندپارگی درونی: صفحه‌هایی خالی‌تر از لازم. روی SSD چگالی صفحه از ترتیب مهم‌تر است. *مالک: I-07.* نیز ببینید: index bloat، rebuild / reorganize.

<a id="free-space-map"></a>
### free space map — نقشهٔ فضای آزاد (free space map)
ساختاری که تقریباً ثبت می‌کند هر صفحه چقدر فضای آزاد دارد تا درج بدون خواندن صفحه‌ها جا پیدا کند (fork `_fsm` در PostgreSQL، صفحه‌های PFS در SQL Server). *مالک: I-06.* نیز ببینید: fill factor.

<a id="full-text-index"></a>
### full-text index — نمایهٔ تمام‌متن (full-text index)
نمایهٔ معکوس روی واژه‌هایی که یک analyzer تولید می‌کند و به پرس‌وجوهای واژه و عبارت پاسخ می‌دهد (`tsvector` با GIN، full-text در SQL Server، `FULLTEXT` در MySQL، Oracle Text، FTS5 در SQLite). *مالک: I-07.* نیز ببینید: inverted index، GIN.

<a id="generic-plan"></a>
### generic plan — طرح عمومی (generic plan)
طرحی در PostgreSQL برای دستور آماده که بدون مقدار پارامترها ساخته و برای همهٔ اجراها به کار می‌رود؛ طرح سفارشی در هر اجرا با مقدارها ساخته می‌شود. `plan_cache_mode` انتخاب می‌کند. *مالک: I-08.* نیز ببینید: prepared statement، parameter sniffing.

<a id="gin"></a>
### GIN — نمایهٔ معکوس عمومی (GIN)
نمایهٔ معکوس عمومی PostgreSQL: یک مدخل برای هر عنصر (عضو آرایه، کلید JSON، واژه، trigram) که به همهٔ سطرهای دارای آن اشاره می‌کند. برای `@>`، `?`، جست‌وجوی تمام‌متن و `pg_trgm` عالی است؛ نوشتن گران است. *مالک: I-07.* نیز ببینید: inverted index.

<a id="gist"></a>
### GiST — درخت جست‌وجوی عمومی (GiST)
درخت جست‌وجوی عمومی PostgreSQL: درخت متوازنی از گزاره‌های محدودکننده برای هندسه، بازه‌ها، جست‌وجوی نزدیک‌ترین همسایه و exclusion constraint. *مالک: I-07.* نیز ببینید: SP-GiST.

<a id="hash-index"></a>
### hash index — نمایهٔ هش (hash index)
نمایه‌ای که مدخل‌ها را با هش کلید در سطل‌ها می‌گذارد؛ فقط به برابری پاسخ می‌دهد و ترتیب و بازه ندارد (`USING hash` در PostgreSQL، موتور MEMORY، جدول‌های memory-optimized در SQL Server). *مالک: I-07.* نیز ببینید: hash join.

<a id="hash-join"></a>
### hash join — پیوند هش (hash join)
الگوریتم پیوندی که از یک ورودی جدول هش می‌سازد و هر سطر ورودی دیگر را در آن جست‌وجو می‌کند. برای ورودی‌های بزرگ نامرتب هزینهٔ خطی دارد، فقط برابری را پشتیبانی می‌کند، حافظه می‌خواهد و ممکن است سرریز کند. *مالک: I-08.* نیز ببینید: build side، probe side.

<a id="heap"></a>
### heap — هیپ (heap)
جدولی بدون ترتیب کلید: سطرها هر جا فضای آزاد باشد می‌نشینند و با نشانی فیزیکی پیدا می‌شوند. جدول‌های PostgreSQL و جدول‌های پیش‌فرض Oracle هیپ‌اند. *مالک: I-06.* نیز ببینید: clustered index، RID.

<a id="hint"></a>
### hint — راهنمای بهینه‌ساز (hint)
دستوری درون پرس‌وجو که یک تصمیم بهینه‌ساز (روش پیوند، نمایه، ترتیب، موازی‌سازی) را لغو می‌کند. انتخاب امروز را منجمد می‌کند؛ plan guide و baseline راهنما را بدون تغییر متن پرس‌وجو می‌چسبانند. *مالک: I-08.* نیز ببینید: plan cache.

<a id="hot-update"></a>
### HOT update — به‌روزرسانی HOT
به‌روزرسانی heap-only tuple در PostgreSQL: وقتی هیچ ستون نمایه‌شده‌ای عوض نشود و صفحه جا داشته باشد، نسخهٔ جدید سطر در همان صفحه می‌ماند و مدخل نمایهٔ تازه‌ای افزوده نمی‌شود. فضای آزاد ناشی از ضریب پرشدگی کمتر آن را ممکن می‌کند. *مالک: I-06.* نیز ببینید: fill factor.

<a id="include-columns"></a>
### INCLUDE columns — ستون‌های INCLUDE
ستون‌های غیرکلیدی که فقط در مدخل‌های برگ نمایه ذخیره می‌شوند (`INCLUDE (total)`؛ SQL Server و PostgreSQL 11 به بعد). نمایه را پوشا می‌کنند بی‌آنکه صفحه‌های داخلی پهن شوند یا یکتایی تغییر کند. *مالک: I-07.* نیز ببینید: covering index.

<a id="index"></a>
### index — نمایه (index)
ساختاری جداگانه و مرتب (یا هش‌شده) که مقدار کلید را به محل سطرها نگاشت می‌کند تا پرس‌وجو به‌جای کل جدول چند صفحه بخواند. فضا و کار نوشتن هزینه دارد. *مالک: I-07.* نیز ببینید: B+tree، covering index.

<a id="index-bloat"></a>
### index bloat — آماس نمایه (index bloat)
نمایه‌ای بزرگ‌تر از نیاز مدخل‌های زنده‌اش، به خاطر صفحه‌های نیمه‌خالی و مدخل‌های مرده پس از به‌روزرسانی و حذف. deduplication در PostgreSQL 13 و bottom-up deletion در 14 آن را کم می‌کنند و `REINDEX CONCURRENTLY` حذفش می‌کند. *مالک: I-07.* نیز ببینید: fragmentation.

<a id="index-condition-pushdown"></a>
### index condition pushdown — فروراندن شرط به نمایه (index condition pushdown)
بهینه‌سازی MySQL/InnoDB که شرط‌های روی ستون‌های نمایه را پیش از واکشی سطر، درون نمایه بررسی می‌کند (`Extra: Using index condition`). وقتی ستون بعدی کلید نمی‌تواند seek را تنگ کند، تعداد واکشی سطر را کم می‌کند. *مالک: I-07.* نیز ببینید: residual predicate.

<a id="index-height"></a>
### index height — ارتفاع نمایه (index height)
تعداد سطح‌ها از ریشه تا برگ در B+tree؛ هر جست‌وجوی نقطه‌ای در هر سطح یک صفحه می‌خواند. سه یا چهار سطح ده‌ها میلیون تا میلیاردها کلید را پوشش می‌دهد. *مالک: I-07.* نیز ببینید: fan-out.

<a id="index-only-scan"></a>
### index-only scan — پویش فقط‌نمایه (index-only scan)
گامی از طرح که فقط از روی نمایه به پرس‌وجو پاسخ می‌دهد. در PostgreSQL همچنان نقشهٔ مرئی‌بودن را بررسی می‌کند و صفحه‌های هیپی را که all-visible نیستند می‌خواند (`Heap Fetches`). *مالک: I-07.* نیز ببینید: covering index، visibility map.

<a id="index-organised-table"></a>
### index-organised table — جدول سازمان‌یافته با نمایه (IOT)
جدول خوشه‌ای Oracle (`ORGANIZATION INDEX`): سطرها در B-tree کلید اصلی زندگی می‌کنند. نمایه‌های ثانویه از rowid منطقی استفاده می‌کنند. *مالک: I-06.* نیز ببینید: clustered index.

<a id="index-rebuild"></a>
### rebuild / reorganize — بازسازی / سازمان‌دهی مجدد
نگه‌داری نمایه: بازسازی نمایه را از نو می‌سازد (صفحه‌های چگال و در SQL Server آمار تازه)، سازمان‌دهی مجدد صفحه‌های برگ را در جا فشرده و مرتب می‌کند (SQL Server، همیشه آنلاین). PostgreSQL از `REINDEX [CONCURRENTLY]` استفاده می‌کند. *مالک: I-07.* نیز ببینید: fragmentation.

<a id="index-scan"></a>
### index scan — پویش نمایه (index scan)
خواندن همه یا بخش بزرگی از یک نمایه به ترتیب کلید. در واژگان طرح PostgreSQL، `Index Scan` نام seek همراه با واکشی سطر هم هست؛ `Index Scan` در SQL Server خواندن کامل نمایه است. *مالک: I-08.* نیز ببینید: index seek.

<a id="index-seek"></a>
### index seek — جست‌وجوی نمایه (index seek)
پایین رفتن در B+tree از ریشه تا نخستین کلید واجد شرط و سپس خواندن رو به جلو تا وقتی کلیدها شرط را دارند. مسیر دسترسی گزاره‌های گزینندهٔ SARGable. *مالک: I-08.* نیز ببینید: seek predicate.

<a id="interesting-order"></a>
### interesting order — ترتیب سودمند (interesting order)
ترتیبی از نتیجهٔ میانی که عملگر بعدی می‌تواند از آن بهره ببرد (merge join، `ORDER BY`، `GROUP BY`). بهینه‌سازهای برنامه‌ریزی پویا طرح‌هایی را که چنین ترتیبی می‌دهند نگه می‌دارند، حتی اگر تا آن لحظه ارزان‌ترین نباشند. *مالک: I-08.* نیز ببینید: merge join.

<a id="internal-node"></a>
### internal node — گرهٔ داخلی (internal node)
صفحهٔ غیربرگ B+tree با کلیدهای جداکننده و اشاره‌گرهای فرزند؛ ریشه بالاترین گرهٔ داخلی است. *مالک: I-07.* نیز ببینید: leaf node.

<a id="inverted-index"></a>
### inverted index — نمایهٔ معکوس (inverted index)
نگاشتی از هر واژه یا عنصر به فهرست سطرها یا سندهایی که آن را دارند؛ پایهٔ جست‌وجوی تمام‌متن، GIN و Elasticsearch. *مالک: I-07 (در I-16 هم به کار می‌رود).* نیز ببینید: full-text index، GIN.

<a id="join-order"></a>
### join order — ترتیب پیوند (join order)
ترتیبی که طرح جدول‌هایش را پیوند می‌دهد. فضای جست‌وجو فاکتوریلی رشد می‌کند؛ موتورها از برنامه‌ریزی پویا (PostgreSQL تا 12 رابطه)، جست‌وجوی Cascades (SQL Server) یا جست‌وجوی حریصانه (MySQL) استفاده می‌کنند. *مالک: I-08.* نیز ببینید: left-deep tree.

<a id="key-lookup"></a>
### key lookup — جست‌وجوی کلید (key lookup)
عملگر SQL Server که پس از seek در نمایهٔ غیرخوشه‌ای، بقیهٔ سطر را از نمایهٔ خوشه‌ای می‌آورد؛ یک بار برای هر سطر. اجرای پرشمار آن نشانهٔ نبود نمایهٔ پوشا است. *مالک: I-07.* نیز ببینید: RID lookup، covering index.

<a id="leaf-node"></a>
### leaf node — گرهٔ برگ (leaf node)
پایین‌ترین سطح B+tree: همهٔ کلیدها به ترتیب، هر کدام با اشاره‌گر سطر (یا خود سطر در نمایهٔ خوشه‌ای)، پیوسته به همسایه‌ها برای پویش بازه‌ای. *مالک: I-07.* نیز ببینید: internal node.

<a id="left-deep-tree"></a>
### left-deep tree — درخت چپ‌عمیق (left-deep tree)
درخت پیوندی که ورودی درونی هر پیوند یک جدول پایه است. با nested loop خوب خط لوله می‌شود و جست‌وجو را کوچک نگه می‌دارد. *مالک: I-08.* نیز ببینید: bushy tree.

<a id="leftmost-prefix"></a>
### leftmost prefix — قاعدهٔ پیشوند چپ (leftmost prefix)
نمایهٔ ترکیبی B-tree فقط روی دنباله‌ای از ستون‌های ابتدایی‌اش قابل جست‌وجو است؛ `(a, b)` به `a = ?` و `a = ? AND b = ?` پاسخ می‌دهد، نه به `b = ?` تنها (مگر با skip scan). *مالک: I-07.* نیز ببینید: composite index، skip scan.

<a id="line-pointer"></a>
### line pointer — اشاره‌گر سطر (line pointer)
مدخل 4 بایتی شکاف در صفحهٔ PostgreSQL که به محل یک tuple اشاره می‌کند؛ بخش دوم `ctid`. *مالک: I-06.* نیز ببینید: slotted page، ctid.

<a id="lob"></a>
### LOB — شیء بزرگ (LOB)
مقداری بزرگ‌تر از آن‌که درون سطر جا شود (`varchar(max)`، `BLOB`، `CLOB`) که در صفحه‌ها یا segmentهای جداگانه با اشاره‌گری در سطر ذخیره می‌شود. *مالک: I-06.* نیز ببینید: off-row، TOAST.

<a id="logical-plan"></a>
### logical plan — طرح منطقی (logical plan)
پرس‌وجو بیان‌شده با عملگرهای رابطه‌ای (پویش، فیلتر، پیوند، تجمیع) بدون انتخاب الگوریتم یا ترتیب. بهینه‌ساز آن را به طرح فیزیکی تبدیل می‌کند. *مالک: I-08.* نیز ببینید: physical plan.

<a id="logical-read"></a>
### logical read / physical read — خواندن منطقی / خواندن فیزیکی
خواندن منطقی صفحه را در استخر بافر پیدا می‌کند؛ خواندن فیزیکی آن را از حافظهٔ ماندگار می‌آورد. طرح‌ها و آمار ورودی/خروجی هر دو را گزارش می‌دهند (`shared hit` / `read`، `logical reads` / `physical reads`). *مالک: I-06.* نیز ببینید: buffer pool.

<a id="memory-grant"></a>
### memory grant — سهمیهٔ حافظه (memory grant)
حافظهٔ کاری که SQL Server پیش از اجرای پرس‌وجو برای مرتب‌سازی‌ها و هش‌هایش کنار می‌گذارد و اندازه‌اش از تخمین‌ها می‌آید. کم باشد سرریز می‌کند، زیاد باشد پرس‌وجوهای دیگر منتظر می‌مانند. *مالک: I-08.* نیز ببینید: spill.

<a id="merge-join"></a>
### merge join — پیوند ادغامی (merge join)
الگوریتم پیوندی که دو ورودی مرتب بر اساس کلید پیوند را هم‌گام پیش می‌برد. وقتی هر دو ورودی از قبل مرتب‌اند ارزان است؛ وگرنه مرتب‌سازی لازم دارد. *مالک: I-08.* نیز ببینید: interesting order.

<a id="most-common-values"></a>
### most common values (MCV) — پرتکرارترین مقدارها (MCV)
آماری که پرتکرارترین مقدارهای یک ستون را با فراوانی‌شان فهرست می‌کند (`pg_stats.most_common_vals`، frequency histogram در Oracle). برای مقدارهای نامتوازن تخمین دقیق می‌دهد. *مالک: I-07.* نیز ببینید: histogram.

<a id="nested-loop-join"></a>
### nested loop join — پیوند حلقهٔ تودرتو (nested loop join)
الگوریتم پیوندی که به ازای هر سطر بیرونی یک بار ورودی درونی را می‌کاود، در بهترین حالت با seek در نمایه. برای ورودی بیرونی کوچک بهترین است؛ تنها الگوریتم پیوند SQLite. *مالک: I-08.* نیز ببینید: hash join، merge join.

<a id="off-row"></a>
### off-row — بیرون از سطر (off-row)
ذخیرهٔ مقدار بزرگ یک ستون بیرون از صفحهٔ سطر، با فقط یک اشاره‌گر در سطر (TOAST، LOB، row-overflow، ستون‌های off-page، صفحه‌های سرریز). *مالک: I-06.* نیز ببینید: TOAST، LOB.

<a id="operator"></a>
### operator — عملگر (operator)
یک گره از طرح فیزیکی (پویش، seek، پیوند، مرتب‌سازی، تجمیع، exchange). هر کدام سطرهای تخمینی و در طرح واقعی سطرها و زمان واقعی را گزارش می‌دهد. *مالک: I-08.* نیز ببینید: physical plan.

<a id="optimizer"></a>
### optimizer — بهینه‌ساز (optimizer)
بخشی از موتور که تعیین می‌کند یک پرس‌وجوی اعلانی چگونه اجرا شود: مسیرهای دسترسی، ترتیب و الگوریتم پیوندها، بر پایهٔ آمار و مدل هزینه. *مالک: I-08.* نیز ببینید: cost-based optimizer.

<a id="overflow-page"></a>
### overflow page — صفحهٔ سرریز (overflow page)
صفحه‌ای در SQLite که دنبالهٔ رکوردی بزرگ‌تر از صفحهٔ B-treeاش را نگه می‌دارد و از سلول به آن زنجیر می‌شود. *مالک: I-06.* نیز ببینید: off-row.

<a id="page"></a>
### page — صفحه (page)
بلوک ثابتی (8 KB در PostgreSQL و SQL Server، 16 KB در InnoDB، به‌طور پیش‌فرض 4 KB در SQLite) که موتور آن را یکجا می‌خواند، می‌نویسد، نگه می‌دارد و لاگ می‌کند. *مالک: I-06.* نیز ببینید: block، slotted page.

<a id="page-split"></a>
### page split — شکافتن صفحه (page split)
وقتی صفحهٔ B+tree پر است، موتور حدود نیمی از مدخل‌ها را به صفحهٔ تازه‌ای می‌برد و جداکننده‌ای به والد می‌افزاید؛ شکافتن ریشه درخت را بلندتر می‌کند. کلیدهای تصادفی شکافتن مکرر و صفحه‌های نیمه‌خالی می‌سازند. *مالک: I-07.* نیز ببینید: fill factor.

<a id="parameter-sniffing"></a>
### parameter sniffing — parameter sniffing (بو کشیدن پارامتر)
SQL Server طرح پارامتری را برای مقدارهای نخستین اجرا کامپایل و برای همهٔ مقدارها بازاستفاده می‌کند. در دادهٔ نامتوازن زیان‌بار است؛ راه‌حل‌ها `RECOMPILE`، `OPTIMIZE FOR`، اجبار طرح یا PSP optimization است. *مالک: I-08.* نیز ببینید: bind peeking، generic plan.

<a id="parse-tree"></a>
### parse tree — درخت تجزیه (parse tree)
درختی که تجزیه‌گر از توکن‌های یک دستور می‌سازد، پیش از آن‌که نام‌ها پیدا شوند. *مالک: I-08.* نیز ببینید: parser.

<a id="parser"></a>
### parser — تجزیه‌گر (parser)
نخستین مرحلهٔ خط لوله: متن SQL را توکن‌بندی و دستور زبانش را بررسی می‌کند و درخت تجزیه می‌سازد؛ خطاهای نحوی از این‌جا می‌آیند. *مالک: I-08.* نیز ببینید: binder.

<a id="partial-index"></a>
### partial index — نمایهٔ جزئی (partial index)
نمایه‌ای فقط روی سطرهایی که با یک `WHERE` جور درمی‌آیند (PostgreSQL، SQLite). فقط وقتی قابل استفاده است که گزارهٔ پرس‌وجو گزارهٔ نمایه را نتیجه دهد. *مالک: I-07.* نیز ببینید: filtered index.

<a id="pctfree"></a>
### PCTFREE — PCTFREE
ذخیرهٔ فضای آزاد هر بلوک در Oracle (پیش‌فرض 10%)، وارون ضریب پرشدگی؛ جایی برای بزرگ شدن سطرها بدون مهاجرت. *مالک: I-06.* نیز ببینید: fill factor، row chaining.

<a id="physical-plan"></a>
### physical plan — طرح فیزیکی (physical plan)
درخت قابل اجرای عملگرها با الگوریتم‌ها، مسیرهای دسترسی و ترتیب مشخص که بهینه‌ساز انتخاب کرده است. همان چیزی است که `EXPLAIN` نشان می‌دهد. *مالک: I-08.* نیز ببینید: logical plan.

<a id="pipeline-breaker"></a>
### pipeline breaker — شکنندهٔ خط لوله (pipeline breaker)
عملگری که باید کل ورودی‌اش را مصرف کند تا خروجی بدهد (مرتب‌سازی، ساخت هش، تجمیع هش). جایی که حافظه لازم است و سرریز رخ می‌دهد. *مالک: I-08.* نیز ببینید: Volcano model، spill.

<a id="plan-cache"></a>
### plan cache — حافظهٔ نهان طرح (plan cache)
انباری از طرح‌های کامپایل‌شده که اجراهای بعدی همان دستور از آن استفاده می‌کنند (در سطح نمونه در SQL Server، shared cursor cache در Oracle، برای هر نشست و دستورهای آماده در PostgreSQL). *مالک: I-08.* نیز ببینید: prepared statement.

<a id="predicate-push-down"></a>
### predicate push-down — فروراندن گزاره (predicate push-down)
اعمال فیلتر در زودترین نقطه: زیر پیوندها، درون نماها و پویش‌ها، یا در منبع دوردست، تا سطرهای کمتری در طرح بالا بروند. فدراسیون Rowlit برای هر منبع از آن استفاده می‌کند (II-16). *مالک: I-08.* نیز ببینید: projection pruning، push-down (II-16).

<a id="prepared-statement"></a>
### prepared statement — دستور آماده (prepared statement)
دستوری که یک بار با پارامترها تجزیه و طرح‌ریزی و بارها با مقدارهای گوناگون اجرا می‌شود. زمان کامپایل را صرفه‌جویی می‌کند و جلوی تزریق SQL را می‌گیرد. *مالک: I-08.* نیز ببینید: plan cache، generic plan.

<a id="probe-side"></a>
### probe side — سمت کاوش (probe side)
ورودی hash join که سطر به سطر در برابر جدول هش سمت ساخت جریان می‌یابد. *مالک: I-08.* نیز ببینید: build side.

<a id="projection-pruning"></a>
### projection pruning — هرس ستون‌ها (projection pruning)
خواندن و حمل فقط ستون‌هایی که پرس‌وجو به کار می‌برد. در ستون‌انبارها صرفه‌جویی اصلی همین است؛ در فدراسیون دادهٔ آورده‌شده از منبع‌ها را کم می‌کند. *مالک: I-08.* نیز ببینید: predicate push-down.

<a id="random-io"></a>
### random I/O — ورودی/خروجی تصادفی (random I/O)
خواندن صفحه‌هایی در جاهای پراکنده، هر کدام با درخواستی جدا؛ برای هر صفحه بسیار گران‌تر از ورودی/خروجی ترتیبی، به‌ویژه روی دیسک سخت. *مالک: I-06.* نیز ببینید: sequential scan.

<a id="residual-predicate"></a>
### residual predicate — گزارهٔ باقی‌مانده (residual predicate)
شرطی که پس از خواندن سطر یا مدخل نمایه بررسی می‌شود و فقط سطرها را دور می‌ریزد (`Filter` در PostgreSQL، `Predicate` در SQL Server، `filter` در Oracle). *مالک: I-07.* نیز ببینید: seek predicate.

<a id="reverse-key-index"></a>
### reverse key index — نمایهٔ کلید معکوس (reverse key index)
نمایهٔ Oracle که بایت‌های کلید را وارونه ذخیره می‌کند تا درج‌های پیاپی میان برگ‌های بسیار پخش شوند و بلوک داغ سمت راست پدید نیاید؛ پویش بازه‌ای را پشتیبانی نمی‌کند. *مالک: I-07.* نیز ببینید: page split.

<a id="rewriter"></a>
### rewriter — بازنویس (rewriter)
مرحله‌ای از خط لوله که تبدیل‌های همیشه‌درست را اعمال می‌کند: باز کردن نماها، ruleها، امنیت سطری، تاشدن ثابت‌ها. *مالک: I-08.* نیز ببینید: binder، optimizer.

<a id="rid"></a>
### RID — RID
شناسهٔ سطر در هیپ SQL Server: فایل : صفحه : شکاف (8 بایت). نمایه‌های غیرخوشه‌ای روی هیپ با RID به سطرها اشاره می‌کنند. *مالک: I-06.* نیز ببینید: RID lookup، ctid.

<a id="rid-lookup"></a>
### RID lookup — جست‌وجوی RID (RID lookup)
عملگر SQL Server که پس از seek در نمایهٔ غیرخوشه‌ای، سطر هیپ را با RID آن می‌آورد. *مالک: I-07.* نیز ببینید: key lookup.

<a id="row-chaining"></a>
### row migration / chaining — مهاجرت سطر / زنجیره‌شدن سطر
در Oracle، مهاجرت سطرِ بزرگ‌شده را با گذاشتن یک اشاره‌گر به بلوک دیگری می‌برد؛ زنجیره‌شدن سطرِ بزرگ‌تر از یک بلوک را میان چند بلوک تقسیم می‌کند. هر دو خواندن اضافه هزینه دارند. *مالک: I-06.* نیز ببینید: forwarded record، PCTFREE.

<a id="row-overflow"></a>
### row-overflow — سرریز سطر (row-overflow)
واحد تخصیص SQL Server برای مقدارهای متغیرطولی که سطر را از 8,060 بایت بیشتر می‌کنند؛ سطر یک اشاره‌گر 24 بایتی نگه می‌دارد. *مالک: I-06.* نیز ببینید: LOB.

<a id="rowid"></a>
### rowid / ROWID — rowid / ROWID
در SQLite: کلید صحیح 64 بیتی هر جدول rowid (که `INTEGER PRIMARY KEY` نام دیگرش است). در Oracle: نشانی فیزیکی سطر (شیء، فایل، بلوک، سطر). *مالک: I-06.* نیز ببینید: RID، ctid.

<a id="sai"></a>
### SAI — نمایهٔ پیوست به ذخیره‌سازی (SAI)
نمایهٔ storage-attached در Cassandra 5 که برای هر SSTable و memtable ساخته می‌شود و پرس‌وجوهای برابری و بازه را روی ستون‌های غیرکلیدی بسیار ارزان‌تر از نمایه‌های ثانویهٔ قدیمی پشتیبانی می‌کند. *مالک: I-07.* نیز ببینید: secondary index.

<a id="secondary-index"></a>
### secondary index — نمایهٔ ثانویه (secondary index)
هر نمایه‌ای جز آن که خود جدول را مرتب می‌کند. در Cassandra، نمایهٔ محلی هر گره روی ستون غیرکلیدی که پرس‌وجو را به همهٔ گره‌ها می‌فرستد. *مالک: I-07.* نیز ببینید: SAI، clustered index.

<a id="seek-predicate"></a>
### seek predicate — گزارهٔ جست‌وجو (seek predicate)
شرطی که محدود می‌کند کدام بخش نمایه خوانده شود (`Seek Predicates` در SQL Server، `access` در Oracle، `Index Cond` روی ستون‌های ابتدایی در PostgreSQL). *مالک: I-07.* نیز ببینید: residual predicate.

<a id="selectivity"></a>
### selectivity — گزینندگی (selectivity)
کسری از سطرها که یک گزاره نگه می‌دارد؛ «بسیار گزیننده» یعنی کسر کوچک. بهینه‌ساز آن را در تعداد سطرها ضرب می‌کند تا کاردینالیتی را تخمین بزند. *مالک: I-07.* نیز ببینید: cardinality estimate.

<a id="semi-join"></a>
### semi-join — نیم‌پیوند (semi-join)
پیوندی که هر سطر یک ورودی را، اگر تطابقی وجود داشته باشد، حداکثر یک بار برمی‌گرداند (`EXISTS`، `IN`). باز کردن زیرپرس‌وجو چنین زیرپرس‌وجوهایی را به نیم‌پیوند تبدیل می‌کند. *مالک: I-08.* نیز ببینید: anti-join.

<a id="sequential-scan"></a>
### sequential scan — پویش ترتیبی (sequential scan)
خواندن همهٔ صفحه‌های یک جدول به ترتیب فایل؛ به لطف read-ahead و درخواست‌های بزرگ، برای هر صفحه ارزان است. *مالک: I-06.* نیز ببینید: table scan، random I/O.

<a id="skip-index"></a>
### skip index — نمایهٔ پرش (skip index)
نمایهٔ data skipping در ClickHouse (`minmax`، `set`، `bloom_filter`، `tokenbf_v1`، `ngrambf_v1`): خلاصه‌ای برای هر بلوک از گرانول‌ها که اجازه می‌دهد بلوک‌هایی که نمی‌توانند منطبق باشند خوانده نشوند. *مالک: I-07.* نیز ببینید: sparse index، zone map.

<a id="skip-scan"></a>
### skip scan — پویش پرشی (skip scan)
استفاده از نمایهٔ ترکیبی بدون ستون اولش، با یک seek برای هر مقدار متمایز ستون اول (Oracle، MySQL 8.0.13 به بعد، SQLite پس از `ANALYZE`، PostgreSQL 18). *مالک: I-07.* نیز ببینید: leftmost prefix.

<a id="slotted-page"></a>
### slotted page — صفحهٔ شکاف‌دار (slotted page)
چیدمان صفحه با یک سرآیند، آرایه‌ای از شکاف‌ها که به سطرها اشاره می‌کنند، فضای آزاد، و سطرهایی که از سر دیگر چیده می‌شوند؛ سطرها بدون تغییر نشانی درون صفحه جابه‌جا می‌شوند. *مالک: I-06.* نیز ببینید: line pointer.

<a id="sp-gist"></a>
### SP-GiST — SP-GiST
GiST افرازشدهٔ فضایی در PostgreSQL: درخت‌های افراز نامتوازن (quadtree، k-d tree، radix trie) برای نقطه‌ها، بازه‌های IP و پیشوندهای متن. *مالک: I-07.* نیز ببینید: GiST.

<a id="sparse-index"></a>
### sparse index — نمایهٔ تُنُک (sparse index)
نمایه‌ای با یک مدخل برای هر بلوک از سطرها به‌جای هر سطر، مثل نمایهٔ اصلی ClickHouse (یک mark برای هر گرانول 8,192 سطری). بسیار کوچک است ولی دادهٔ مرتب بر اساس کلید لازم دارد. *مالک: I-07.* نیز ببینید: skip index.

<a id="spill"></a>
### spill — سرریز به دیسک (spill)
نوشتن مرتب‌سازی، جدول هش یا تجمیع روی دیسک چون از بودجهٔ حافظه بیشتر شده است؛ اغلب ده برابر کندتر. معمولاً از کم‌برآورد کردن سطرها می‌آید. *مالک: I-08.* نیز ببینید: memory grant، pipeline breaker.

<a id="statistics"></a>
### statistics — آمار (statistics)
خلاصه‌هایی که بهینه‌ساز دربارهٔ جدول‌ها و ستون‌ها نگه می‌دارد: تعداد سطر و صفحه، NULLها، مقدارهای متمایز، پرتکرارترین مقدارها، هیستوگرام، همبستگی. با `ANALYZE`، آمار خودکار یا `DBMS_STATS` تازه می‌شوند. *مالک: I-07.* نیز ببینید: histogram، cardinality estimate.

<a id="histogram"></a>
### histogram — هیستوگرام (histogram)
آماری که مقدارهای مرتب یک ستون را به سطل‌ها تقسیم می‌کند (هم‌عمق در PostgreSQL، حداکثر 200 گام در SQL Server، چند گونه در Oracle) تا بازه‌ها و مقدارهای کم‌تکرار تخمین زده شوند. *مالک: I-07.* نیز ببینید: statistics، most common values.

<a id="table-scan"></a>
### table scan — پویش جدول (table scan)
مسیر دسترسی‌ای که همهٔ سطرهای جدول را می‌خواند (`Seq Scan` در PostgreSQL، `Table Scan` / `Clustered Index Scan` در SQL Server، `TABLE ACCESS FULL` در Oracle، `type: ALL` در MySQL). برای کسرهای بزرگ و جدول‌های کوچک درست است. *مالک: I-08.* نیز ببینید: sequential scan.

<a id="tablespace"></a>
### tablespace — فضای جدول (tablespace)
گروهی نام‌دار از فایل‌های داده که اشیا در آن قرار می‌گیرند (Oracle، PostgreSQL، InnoDB؛ filegroup در SQL Server). *مالک: I-06.* نیز ببینید: extent.

<a id="toast"></a>
### TOAST — TOAST
ذخیره‌سازی بیرون از سطر در PostgreSQL: مقدارهای سطرهای پهن‌تر از حدود 2 KB فشرده و/یا تکه‌تکه به یک جدول جانبی منتقل می‌شوند و یک اشاره‌گر 18 بایتی می‌ماند. *مالک: I-06.* نیز ببینید: off-row، LOB.

<a id="unique-index"></a>
### unique index — نمایهٔ یکتا (unique index)
نمایه‌ای که کلید تکراری را نمی‌پذیرد؛ قیدهای `PRIMARY KEY` و `UNIQUE` را اعمال می‌کند. رفتار با NULL در هر موتور فرق دارد. *مالک: I-07.* نیز ببینید: index.

<a id="uniquifier"></a>
### uniquifier — یکتاساز (uniquifier)
مقدار پنهان 4 بایتی که SQL Server به کلیدهای تکراری نمایهٔ خوشه‌ای غیریکتا می‌افزاید تا هر سطر نشانی یکتا داشته باشد. *مالک: I-06.* نیز ببینید: clustered index.

<a id="vectorised-execution"></a>
### vectorised execution — اجرای برداری (vectorised execution)
اجرای عملگرها روی دسته‌هایی از مقدارهای ستون به‌جای سطر به سطر، تا حلقه‌های فشرده از حافظهٔ نهان CPU و SIMD بهره ببرند (ClickHouse، DuckDB، Snowflake، batch mode در SQL Server). *مالک: I-08 (و I-15).* نیز ببینید: Volcano model.

<a id="visibility-map"></a>
### visibility map — نقشهٔ مرئی‌بودن (visibility map)
بیت‌نگاشت هر جدول در PostgreSQL (fork `_vm`) که صفحه‌هایی را علامت می‌زند که همهٔ سطرهایشان مرئی (و منجمد) است. پویش فقط‌نمایه برای این صفحه‌ها به هیپ نمی‌رود؛ VACUUM بیت‌ها را تنظیم می‌کند. *مالک: I-07.* نیز ببینید: index-only scan، VACUUM.

<a id="volcano-model"></a>
### Volcano model — مدل Volcano (مدل تکرارگر)
مدل اجرایی که در آن هر عملگر `open`/`next`/`close` را پیاده می‌کند و هر بار یک سطر از فرزندانش می‌کشد (Graefe، 1994). ساده و خط‌لوله‌ای است؛ سربار هر سطر هزینهٔ آن است. *مالک: I-08.* نیز ببینید: vectorised execution.

<a id="without-rowid"></a>
### WITHOUT ROWID — WITHOUT ROWID
گزینهٔ جدول در SQLite که جدول را به‌جای rowid پنهان، به شکل خوشه‌ای روی کلید اصلی اعلام‌شده ذخیره می‌کند و برای کلیدهای غیرصحیح یک نمایهٔ جداگانه را صرفه‌جویی می‌کند. *مالک: I-06.* نیز ببینید: rowid، clustered index.

<a id="zone-map"></a>
### zone map — نقشهٔ ناحیه (zone map)
خلاصه‌های کمینه/بیشینه (و گاهی بیشتر) برای هر بلوک از سطرها که برای پرش از بلوک‌ها به کار می‌روند: BRIN در PostgreSQL، نمایه‌های minmax در ClickHouse، فرادادهٔ ریزپارتیشن در Snowflake، row groupها در DuckDB. *مالک: I-07.* نیز ببینید: BRIN، skip index.
