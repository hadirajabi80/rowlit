# Glossary fragment — package C (I-09 … I-13)

Temporary file for package H to merge into `en/glossary.md` and `fa/glossary.md`, then delete. Rows are alphabetical by
English term inside each language section. Each row: explicit anchor, heading `term — فارسی`, a beginner meaning, a
deeper note, the owner chapter. The anchors are the ones the chapters link to; the FA section repeats them on purpose
(they go into a different file after the merge).

Anchors used by these chapters but owned by other packages (H: please confirm they exist): `buffer-pool`, `dirty-page`
(I-06), `commitlog` (I-16).

## English

<a id="accelerated-database-recovery"></a>
### Accelerated Database Recovery — بازیابی شتاب‌یافتهٔ پایگاه داده
SQL Server 2019+ option that keeps row versions in a persistent version store inside the database. Deeper: undo becomes a logical revert, so rollback and crash recovery are nearly instant and the log can be truncated despite long transactions. *Owner: I-11.* See also: version store.

<a id="acid"></a>
### ACID — ACID
The four transaction guarantees: atomicity, consistency, isolation, durability. Deeper: each letter is kept by a different engine part (undo, constraints, concurrency control, WAL). *Owner: I-09.*

<a id="archivelog-mode"></a>
### ARCHIVELOG mode — حالت ARCHIVELOG
Oracle mode in which every filled online redo log is copied to an archived redo log before reuse. Deeper: required for media recovery, PITR and Data Guard; NOARCHIVELOG allows crash recovery only. *Owner: I-11.*

<a id="aries"></a>
### ARIES — ARIES
The classic crash-recovery algorithm (IBM, 1992): analysis, redo, undo. Deeper: repeats history during redo and writes compensation log records during undo so recovery is idempotent. *Owner: I-11.*

<a id="asynchronous-replication"></a>
### asynchronous replication — همانندسازی ناهمگام
COMMIT returns before any replica has the change. Deeper: no commit latency cost, but a failover can lose the transactions inside the replication lag. *Owner: I-12.*

<a id="atomicity"></a>
### atomicity — اتمی‌بودن
All statements of a transaction take effect, or none. Deeper: implemented with undo information and recovery. *Owner: I-09.*

<a id="autocommit"></a>
### autocommit — ثبت خودکار
Mode in which every statement is its own transaction and commits when it ends. Deeper: the default in PostgreSQL, SQL Server, MySQL, SQLite and Snowflake; Oracle leaves it to the client. *Owner: I-09.*

<a id="autovacuum"></a>
### autovacuum — جاروی خودکار (autovacuum)
PostgreSQL background workers that run VACUUM and ANALYZE when a table has enough dead tuples or changes. Deeper: triggers at threshold + scale factor × rows (defaults 50 + 20 %), and forces anti-wraparound vacuums. *Owner: I-10.*

<a id="awr"></a>
### AWR — مخزن خودکار بار کاری (AWR)
Oracle's Automatic Workload Repository: periodic snapshots of performance statistics. Deeper: with ASH and ADDM it needs the Diagnostics Pack licence on Enterprise Edition; Statspack is the free alternative. *Owner: I-13.*

<a id="backup"></a>
### backup — پشتیبان
A copy of the data kept aside to restore later. Deeper: comes as full, differential, incremental or log backups, physical or logical; a replica is not a backup. *Owner: I-12.*

<a id="binlog"></a>
### binlog (binary log) — لاگ دودویی (binlog)
MySQL's server-level log of committed changes, used for replication and point-in-time recovery. Deeper: kept consistent with the InnoDB redo log through an internal two-phase commit; row format is the default. *Owner: I-12.*

<a id="blocking-chain"></a>
### blocking chain — زنجیرهٔ انسداد
A queue of sessions each waiting for a lock held by the next, ending at a head blocker. Deeper: find the head with `pg_blocking_pids`, `blocking_session_id` or `v$session.blocking_session`. *Owner: I-10.*

<a id="bloat"></a>
### bloat — حجیم‌شدگی (bloat)
Space in tables and indexes taken by dead row versions or empty pages. Deeper: in PostgreSQL it grows when VACUUM cannot keep up or the xmin horizon is held back. *Owner: I-10.*

<a id="bottleneck"></a>
### bottleneck — گلوگاه
The one resource or step that limits the whole system. Deeper: improving anything else does not change what users see. *Owner: I-13.*

<a id="bulk-load"></a>
### bulk load — بارگذاری انبوه
Loading many rows through the engine's fast path (`COPY`, `BULK INSERT`, `LOAD DATA`, `COPY INTO`). Deeper: amortises per-statement and per-commit overhead; may be minimally logged. *Owner: I-13.*

<a id="cap"></a>
### CAP theorem — قضیهٔ CAP
During a network partition a replicated system must give up consistency (linearizability) or availability. Deeper: proved by Gilbert and Lynch (2002); not "pick any two". *Owner: I-12.* See also: PACELC.

<a id="causal-consistency"></a>
### causal consistency — سازگاری علّی
Everyone sees causally related writes in the same order; unrelated writes may differ. Deeper: weaker than linearizability, stronger than eventual. *Owner: I-12.*

<a id="cdc"></a>
### CDC (change data capture) — ثبت تغییرات داده (CDC)
Reading a database's log and publishing each row change as an event. Deeper: PostgreSQL logical decoding, the MySQL binlog, SQL Server CDC; Debezium to Kafka is typical. *Owner: I-12.*

<a id="checkpoint"></a>
### checkpoint — نقطهٔ وارسی (checkpoint)
Writing dirty pages so that recovery can start from a recent log position. Deeper: fuzzy; bounds recovery time and lets old log be recycled. *Owner: I-11.*

<a id="commit"></a>
### commit — commit (ثبت نهایی)
Ending a transaction so its changes become permanent and visible. Deeper: durable once the commit record is flushed to the log. *Owner: I-09.*

<a id="compensation-log-record"></a>
### compensation log record (CLR) — رکورد لاگ جبرانی (CLR)
A log record written while undoing a change during rollback or recovery. Deeper: its undoNextLSN keeps recovery from undoing the same change twice after a second crash. *Owner: I-11.*

<a id="connection-pool"></a>
### connection pool — استخر اتصال
A set of open connections lent to callers and returned instead of closed. Deeper: client-side (ADO.NET, HikariCP) or server-side (PgBouncer); stateful sessions do not fit pooling. *Owner: I-13.*

<a id="consensus"></a>
### consensus — اجماع
Nodes agreeing on one value despite failures. Deeper: Paxos and Raft; needed for leader election and replicated logs. *Owner: I-12.*

<a id="consistency"></a>
### consistency (ACID) — سازگاری
A transaction moves the database from one valid state to another; declared constraints hold. Deeper: not the C of CAP. *Owner: I-09.*

<a id="consistent-read"></a>
### consistent read — خواندن سازگار
Oracle reading a block as of the query's SCN by applying undo to a copy. Deeper: produces CR blocks in the buffer cache; fails with ORA-01555 when undo is gone. *Owner: I-10.*

<a id="crash-recovery"></a>
### crash recovery — بازیابی پس از خرابی
Bringing the database back to a correct state after a crash by replaying and reversing the log. Deeper: ARIES phases analysis, redo, undo; PostgreSQL needs redo only. *Owner: I-11.*

<a id="dead-tuple"></a>
### dead tuple — تاپل مرده
A PostgreSQL row version no snapshot can see any more. Deeper: occupies space until VACUUM removes it. *Owner: I-10.*

<a id="deadlock"></a>
### deadlock — بن‌بست
A cycle of transactions each waiting for a lock another holds. Deeper: detected by the engine and broken by rolling back a victim; prevent with consistent access order. *Owner: I-10.*

<a id="deadlock-graph"></a>
### deadlock graph — گراف بن‌بست
The engine's report of the processes and resources in a deadlock. Deeper: SQL Server `xml_deadlock_report` in `system_health`; InnoDB `LATEST DETECTED DEADLOCK`. *Owner: I-10.*

<a id="deadlock-victim"></a>
### deadlock victim — قربانی بن‌بست
The transaction the engine rolls back to break a deadlock. Deeper: SQL Server error 1205, PostgreSQL 40P01, MySQL 1213; retry it. *Owner: I-10.*

<a id="delayed-durability"></a>
### delayed durability — ماندگاری تأخیری
SQL Server option to return from COMMIT before the log flush. Deeper: faster commits; a crash can lose the latest ones. *Owner: I-11.*

<a id="differential-backup"></a>
### differential backup — پشتیبان تفاضلی
Pages changed since the last full backup. Deeper: restore = full + latest differential. *Owner: I-12.*

<a id="dirty-read"></a>
### dirty read — خواندن کثیف
Reading another transaction's uncommitted change. Deeper: possible only at READ UNCOMMITTED / NOLOCK in SQL Server and MySQL. *Owner: I-09.*

<a id="dmv"></a>
### DMV (dynamic management view) — نمای مدیریتی پویا (DMV)
SQL Server `sys.dm_*` views of live and cumulative server state. Deeper: reset at restart; plan-cache based ones forget evicted statements. *Owner: I-13.*

<a id="doublewrite-buffer"></a>
### doublewrite buffer — بافر نوشتن دوگانه
InnoDB area where pages are written and synced before their real location. Deeper: repairs torn pages after a crash. *Owner: I-11.*

<a id="durability"></a>
### durability — ماندگاری
A committed change survives crashes and power loss. Deeper: kept by flushing the WAL at commit. *Owner: I-09.*

<a id="eventual-consistency"></a>
### eventual consistency — سازگاری نهایی
If writes stop, replicas eventually converge; reads in between may be stale. *Owner: I-12.*

<a id="exclusive-lock"></a>
### exclusive lock (X) — قفل انحصاری
Lock for writing; incompatible with every other mode. *Owner: I-10.*

<a id="failover"></a>
### failover — جابه‌جایی خودکار (failover)
Promoting a replica to primary when the primary fails. Deeper: needs failure detection, choice of the new primary and fencing of the old one. *Owner: I-12.*

<a id="fencing"></a>
### fencing — حصارکشی (fencing)
Actively stopping an old primary from accepting writes. Deeper: STONITH, storage revocation, leases; prevents split brain. *Owner: I-12.*

<a id="freezing"></a>
### freezing — منجمدسازی (freezing)
PostgreSQL marking old tuples as visible to everyone regardless of transaction id. Deeper: prevents transaction id wraparound. *Owner: I-10.*

<a id="fsync"></a>
### fsync — fsync
System call that returns only when data reached the storage device. Deeper: the one synchronous I/O on the commit path. *Owner: I-11.*

<a id="full-backup"></a>
### full backup — پشتیبان کامل
A copy of the whole database. *Owner: I-12.*

<a id="full-page-write"></a>
### full page write — نوشتن صفحهٔ کامل
PostgreSQL logging the whole page image at its first change after a checkpoint. Deeper: protects against torn pages; shows as `fpi` in `EXPLAIN (WAL)`. *Owner: I-11.*

<a id="fuzzy-checkpoint"></a>
### fuzzy checkpoint — checkpoint فازی
A checkpoint that runs while transactions continue. Deeper: recovery starts at the redo point remembered at its start. *Owner: I-11.*

<a id="gap-lock"></a>
### gap lock — قفل شکاف
InnoDB lock on the space between index records that blocks inserts there. Deeper: used at REPEATABLE READ; gap locks never conflict with each other. *Owner: I-10.*

<a id="group-commit"></a>
### group commit — commit گروهی
Several commits made durable by one log flush. Deeper: raises throughput under load. *Owner: I-11.*

<a id="head-blocker"></a>
### head blocker — مسدودکنندهٔ سرِ زنجیره
The session at the start of a blocking chain, itself not waiting for a lock. *Owner: I-10.*

<a id="history-list-length"></a>
### history list length — طول فهرست تاریخچه
InnoDB's count of undo log records not yet purged. Deeper: a steadily rising value means a long transaction blocks purge. *Owner: I-10.*

<a id="hot-update"></a>
### HOT update — به‌روزرسانی HOT
PostgreSQL heap-only tuple update: the new version stays on the same page and no index entry is added. Deeper: needs no change to indexed columns and free space on the page. *Owner: I-10.*

<a id="implicit-commit"></a>
### implicit commit — commit ضمنی
A commit the engine performs on its own, for example around DDL in Oracle and MySQL. *Owner: I-09.*

<a id="implicit-conversion"></a>
### implicit conversion — تبدیل ضمنی
The engine converting one side of a comparison to the other's type. Deeper: if the column is converted the predicate is no longer SARGable (SQL Server `CONVERT_IMPLICIT`). *Owner: I-13.*

<a id="incremental-backup"></a>
### incremental backup — پشتیبان افزایشی
Pages changed since the last backup of any kind. Deeper: PostgreSQL 17 native, Oracle RMAN level 1. *Owner: I-12.*

<a id="intent-lock"></a>
### intent lock — قفل نیت
Lock on a container (table, page) announcing locks on its rows (IS, IX, SIX). Deeper: makes table-level lock checks cheap. *Owner: I-10.*

<a id="isolation"></a>
### isolation — جداسازی
Concurrent transactions do not see each other's partial work, to the degree the isolation level promises. *Owner: I-09.*

<a id="isolation-level"></a>
### isolation level — سطح جداسازی
Setting that decides which anomalies a transaction may observe. Deeper: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE, plus SNAPSHOT. *Owner: I-09.*

<a id="journal"></a>
### journal (SQLite) — ژورنال
SQLite's rollback journal: original pages copied aside before change. Deeper: an undo log; modes DELETE, TRUNCATE, PERSIST. *Owner: I-11.*

<a id="keyset-pagination"></a>
### keyset pagination — صفحه‌بندی کلیدی (keyset)
Fetching the next page with `WHERE key > last_key ORDER BY key LIMIT n`. Deeper: constant cost per page and stable under inserts; needs a unique sort key and an index. *Owner: I-13.*

<a id="latch"></a>
### latch — latch (قفل سبک داخلی)
Short in-memory lock protecting a physical structure such as a buffer page. Deeper: held microseconds, no deadlock detection; seen as `PAGELATCH_*`, `LWLock`. *Owner: I-10.*

<a id="latency"></a>
### latency — تأخیر (latency)
Time one operation takes. Deeper: report percentiles, not averages. *Owner: I-13.*

<a id="lazy-loading"></a>
### lazy loading — بارگذاری تنبل
ORM behaviour that loads related objects only when first accessed. Deeper: the usual cause of N+1 queries. *Owner: I-13.*

<a id="lightweight-transaction"></a>
### lightweight transaction (LWT) — تراکنش سبک (LWT)
Cassandra compare-and-set on one partition (`IF NOT EXISTS`, `IF col = x`) using Paxos. Deeper: linearizable but costs several round trips. *Owner: I-09.*

<a id="linearizability"></a>
### linearizability — خطی‌پذیری
Each operation appears to take effect at one instant between start and end; acknowledged writes are seen by all later reads. Deeper: about single objects in real time, unlike serializability. *Owner: I-12.*

<a id="littles-law"></a>
### Little's law — قانون لیتل
Concurrency = throughput × latency. *Owner: I-13.*

<a id="lock"></a>
### lock — قفل
Registration that a transaction uses a resource in a mode; incompatible requests wait. *Owner: I-10.*

<a id="lock-compatibility"></a>
### lock compatibility matrix — ماتریس سازگاری قفل‌ها
Table saying which lock modes can be held together. *Owner: I-10.*

<a id="lock-escalation"></a>
### lock escalation — ارتقای قفل
Replacing many fine locks with one coarse lock. Deeper: SQL Server at about 5,000 locks per statement on one object; PostgreSQL, Oracle and InnoDB never escalate. *Owner: I-10.*

<a id="lock-timeout"></a>
### lock timeout — مهلت قفل
Maximum time to wait for a lock before failing. Deeper: `lock_timeout`, `SET LOCK_TIMEOUT`, `innodb_lock_wait_timeout`. *Owner: I-10.*

<a id="log-backup"></a>
### log backup — پشتیبان لاگ
A backup of log records since the previous log backup (WAL archive, archived redo, binlog). Deeper: the basis of PITR; in SQL Server FULL recovery also what allows log truncation. *Owner: I-12.*

<a id="log-record"></a>
### log record — رکورد لاگ
One entry of the WAL describing one change. *Owner: I-11.*

<a id="log-truncation"></a>
### log truncation — کوتاه‌سازی لاگ
Making old log space reusable. Deeper: blocked by active transactions, missing log backups, replicas or slots (`log_reuse_wait_desc`). *Owner: I-11.*

<a id="logical-backup"></a>
### logical backup — پشتیبان منطقی
Export of SQL or rows (`pg_dump`, `mysqldump`, Data Pump). Deeper: portable and selective, slow to restore, no PITR. *Owner: I-12.*

<a id="logical-replication"></a>
### logical replication — همانندسازی منطقی
Shipping row changes to an independent database. Deeper: allows other versions and subsets; DDL usually not replicated. *Owner: I-12.*

<a id="lost-update"></a>
### lost update — به‌روزرسانی گم‌شده
Two read-modify-write transactions where the second write overwrites the first. Deeper: fix with atomic updates, locking reads, version checks or a stronger level. *Owner: I-09.*

<a id="lsn"></a>
### LSN (log sequence number) — شمارهٔ ترتیبی لاگ (LSN)
Monotonic position of a record in the log. Deeper: pages store the LSN of the last change applied (pageLSN). *Owner: I-11.*

<a id="manual-transaction"></a>
### manual transaction — تراکنش دستی
Mode in which statements stay in an open transaction until an explicit COMMIT or ROLLBACK. *Owner: I-09.*

<a id="mvcc"></a>
### MVCC (multi-version concurrency control) — کنترل هم‌روندی چندنسخه‌ای (MVCC)
Writers create new row versions; readers read the version valid for their snapshot. Deeper: readers and writers do not block each other; old versions must be cleaned up. *Owner: I-10.*

<a id="n-plus-1"></a>
### N+1 queries — پرس‌وجوهای N+1
One query for a list plus one query per item. Deeper: costs round trips; fix with a join or an `IN` list. *Owner: I-13.*

<a id="next-key-lock"></a>
### next-key lock — قفل کلید بعدی
InnoDB record lock plus a gap lock on the gap before it. Deeper: prevents phantoms for locking reads at REPEATABLE READ. *Owner: I-10.*

<a id="non-repeatable-read"></a>
### non-repeatable read — خواندن تکرارناپذیر
The same row read twice in a transaction returns different values. *Owner: I-09.*

<a id="offset-pagination"></a>
### offset pagination — صفحه‌بندی با OFFSET
`LIMIT n OFFSET k`: the engine produces and discards k rows. Deeper: cost grows with depth; unstable under inserts. *Owner: I-13.*

<a id="optimistic-concurrency"></a>
### optimistic concurrency — هم‌روندی خوش‌بینانه
Read without locks; at write time check the row has not changed (version column, `rowversion`, ETag). *Owner: I-10.*

<a id="ora-01555"></a>
### ORA-01555 (snapshot too old) — خطای ORA-01555
Oracle error when the undo needed for a consistent read was overwritten. Deeper: size undo, tune `UNDO_RETENTION`, shorten queries. *Owner: I-10.*

<a id="over-indexing"></a>
### over-indexing — نمایه‌گذاری بیش از اندازه
More indexes than the workload needs. Deeper: each one slows writes and uses memory. *Owner: I-13.*

<a id="pacelc"></a>
### PACELC — PACELC
If Partition, choose Availability or Consistency; Else, choose Latency or Consistency. *Owner: I-12.*

<a id="pagelsn"></a>
### pageLSN — pageLSN
LSN stored in a page of the last log record applied to it. Deeper: redo skips records older than it. *Owner: I-11.*

<a id="partition-key-table"></a>
### partition key (table partitioning) — کلید پارتیشن
Column(s) whose value decides the partition of a row. Deeper: queries must compare it directly for pruning. Not the Cassandra partition key (see `partition-key`). *Owner: I-12.*

<a id="partition-pruning"></a>
### partition pruning — هرس پارتیشن
The planner skipping partitions that cannot contain matching rows. Deeper: at plan time and, in PostgreSQL 11+, at execution time. *Owner: I-12.*

<a id="percentile"></a>
### percentile — صدک
The value below which a given share of measurements fall (p50, p95, p99). *Owner: I-13.*

<a id="pessimistic-concurrency"></a>
### pessimistic concurrency — هم‌روندی بدبینانه
Lock what you read because you expect a conflict (`SELECT … FOR UPDATE`, `UPDLOCK`). *Owner: I-10.*

<a id="pg-stat-statements"></a>
### pg_stat_statements — pg_stat_statements
PostgreSQL extension that aggregates statistics per normalised statement. Deeper: needs `shared_preload_libraries`; sort by total time. *Owner: I-13.*

<a id="pgbouncer"></a>
### PgBouncer — PgBouncer
Lightweight connection pooler for PostgreSQL with session, transaction and statement modes. Deeper: transaction mode breaks session state. *Owner: I-13.*

<a id="phantom-read"></a>
### phantom read — خواندن شبح (phantom)
A repeated range query returns new or missing rows because another transaction inserted or deleted. *Owner: I-09.*

<a id="physical-backup"></a>
### physical backup — پشتیبان فیزیکی
Copy of data files or pages (`pg_basebackup`, `BACKUP DATABASE`, RMAN). Deeper: fast restore, same version only. *Owner: I-12.*

<a id="physical-replication"></a>
### physical replication — همانندسازی فیزیکی
Shipping the log itself; the replica replays it into a byte-identical copy. *Owner: I-12.*

<a id="pitr"></a>
### PITR (point-in-time recovery) — بازیابی به نقطه‌ای از زمان (PITR)
Restoring a backup and replaying the log up to a chosen moment. *Owner: I-12.*

<a id="primary-replica"></a>
### primary / replica — اصلی / رونوشت
The server that accepts writes, and the servers that follow its changes. *Owner: I-12.*

<a id="query-store"></a>
### Query Store — Query Store (انبارهٔ پرس‌وجو)
SQL Server feature that persists query texts, plans and runtime statistics in the database. Deeper: on by default for new databases in SQL Server 2022; can force plans. *Owner: I-13.*

<a id="quorum"></a>
### quorum — حد نصاب
A majority (or a configured count) of nodes that must agree or acknowledge. Deeper: R + W > RF gives overlapping reads and writes. *Owner: I-12.*

<a id="raft"></a>
### Raft — Raft
Consensus algorithm with terms, an elected leader and majority-replicated log entries. Deeper: etcd, ClickHouse Keeper, KRaft. *Owner: I-12.*

<a id="rbar"></a>
### RBAR — RBAR (ردیف به ردیف)
"Row by agonizing row": processing rows in a loop instead of one set-based statement. *Owner: I-13.*

<a id="rcsi"></a>
### RCSI (read committed snapshot isolation) — RCSI
SQL Server option that makes READ COMMITTED read row versions instead of waiting for locks. *Owner: I-10.*

<a id="read-committed"></a>
### READ COMMITTED — READ COMMITTED
Isolation level that sees only committed data, with a new snapshot per statement in MVCC engines. Deeper: the default of PostgreSQL, SQL Server, Oracle and Snowflake. *Owner: I-09.*

<a id="read-skew"></a>
### read skew — انحراف خواندن (read skew)
Two reads in one transaction see different moments of related data. *Owner: I-09.*

<a id="read-uncommitted"></a>
### READ UNCOMMITTED — READ UNCOMMITTED
Weakest level; allows dirty reads where supported. *Owner: I-09.*

<a id="read-view"></a>
### read view — نمای خواندن (read view)
InnoDB's record of which transactions were active when a consistent read began. *Owner: I-10.*

<a id="read-your-writes"></a>
### read-your-writes — خواندن نوشته‌های خود
A client always sees its own earlier writes. *Owner: I-12.*

<a id="rebalancing"></a>
### rebalancing — توازن‌بخشی دوباره
Moving data between shards when shards are added or uneven. *Owner: I-12.*

<a id="recovery-model"></a>
### recovery model — مدل بازیابی
SQL Server setting (SIMPLE, FULL, BULK_LOGGED) that decides when the log can be truncated and whether log backups exist. *Owner: I-11.*

<a id="redo"></a>
### redo — بازاجرا (redo)
Re-applying logged changes to pages that missed them. *Owner: I-11.*

<a id="redo-point"></a>
### redo point — نقطهٔ بازاجرا
Log position from which crash recovery starts, remembered at the start of the last checkpoint. *Owner: I-11.*

<a id="repeatable-read"></a>
### REPEATABLE READ — REPEATABLE READ
Level that prevents non-repeatable reads. Deeper: lock-based in SQL Server (phantoms possible), snapshot isolation in PostgreSQL, hybrid in InnoDB (its default). *Owner: I-09.*

<a id="replication"></a>
### replication — همانندسازی
Keeping live copies of data on other servers. *Owner: I-12.*

<a id="replication-lag"></a>
### replication lag — تأخیر همانندسازی
How far a replica is behind the primary. Deeper: `pg_stat_replication`, `Seconds_Behind_Source`, AG queues. *Owner: I-12.*

<a id="replication-slot"></a>
### replication slot — اسلات همانندسازی
PostgreSQL object that retains WAL until a consumer has received it. Deeper: an abandoned slot fills the disk; limit with `max_slot_wal_keep_size`. *Owner: I-12.*

<a id="restore-drill"></a>
### restore drill — تمرین بازگردانی
Regularly restoring backups to prove they work and to measure the real RTO. *Owner: I-12.*

<a id="rollback"></a>
### rollback — بازگردانی (rollback)
Ending a transaction by undoing all its changes. *Owner: I-09.*

<a id="round-trip"></a>
### round trip — رفت‌وبرگشت
A request sent to the server and its reply coming back. Deeper: fixed network cost per statement. *Owner: I-13.*

<a id="row-versioning"></a>
### row versioning — نسخه‌بندی سطرها
SQL Server's MVCC: previous row versions kept in the version store. *Owner: I-10.*

<a id="rpo"></a>
### RPO (recovery point objective) — هدف نقطهٔ بازیابی (RPO)
Maximum acceptable data loss, measured in time. *Owner: I-12.*

<a id="rto"></a>
### RTO (recovery time objective) — هدف زمان بازیابی (RTO)
Maximum acceptable time until the system works again. *Owner: I-12.*

<a id="saga"></a>
### saga — saga (زنجیرهٔ تراکنش‌های جبران‌پذیر)
A sequence of local transactions with compensating actions instead of one distributed transaction. *Owner: I-12.*

<a id="sargable"></a>
### SARGable — SARGable (قابل‌جست‌وجو با نمایه)
A predicate the engine can answer with an index: the column alone on one side of the comparison. *Owner: I-13.*

<a id="savepoint"></a>
### savepoint — نقطهٔ ذخیره (savepoint)
Named marker inside a transaction; rolling back to it undoes only later work. *Owner: I-09.*

<a id="scatter-gather"></a>
### scatter-gather — پخش و گردآوری (scatter-gather)
Sending a query to every shard and merging the results. *Owner: I-12.*

<a id="scn"></a>
### SCN (system change number) — شمارهٔ تغییر سیستم (SCN)
Oracle's database-wide logical clock stamped on every commit. *Owner: I-10.*

<a id="serializable"></a>
### SERIALIZABLE — SERIALIZABLE
Strongest level: the result equals some serial order. Deeper: 2PL in SQL Server and MySQL, SSI in PostgreSQL, snapshot isolation in Oracle. *Owner: I-09.*

<a id="serialization-failure"></a>
### serialization failure — شکست سریال‌پذیری
Error telling the application to retry the transaction (SQLSTATE 40001, SQL Server 3960, ORA-08177). *Owner: I-09.*

<a id="shard-key"></a>
### shard key — کلید شارد
Column(s) that decide on which shard a row lives. *Owner: I-12.*

<a id="sharding"></a>
### sharding — شاردینگ
Spreading rows over independent servers. *Owner: I-12.*

<a id="shared-lock"></a>
### shared lock (S) — قفل اشتراکی
Lock for reading; many holders allowed. *Owner: I-10.*

<a id="skip-locked"></a>
### SKIP LOCKED — SKIP LOCKED
Locking-read option that skips rows other transactions hold; the basis of database job queues. *Owner: I-10.*

<a id="slow-query-log"></a>
### slow query log — لاگ پرس‌وجوهای کند
Log of statements slower than a threshold (MySQL `long_query_time`, PostgreSQL `log_min_duration_statement`). *Owner: I-13.*

<a id="snapshot-mvcc"></a>
### snapshot (MVCC) — تصویر لحظه‌ای (snapshot)
The set of committed transactions a statement or transaction sees. *Owner: I-10.*

<a id="snapshot-isolation"></a>
### snapshot isolation — جداسازی تصویر لحظه‌ای
Each transaction reads one snapshot; first committer wins on write conflicts. Deeper: allows write skew. *Owner: I-09.*

<a id="split-brain"></a>
### split brain — دوپارگی (split brain)
Two nodes both acting as primary and accepting writes. *Owner: I-12.*

<a id="ssi"></a>
### SSI (serializable snapshot isolation) — جداسازی تصویر لحظه‌ای سریال‌پذیر (SSI)
Snapshot isolation plus detection of dangerous read/write dependencies; PostgreSQL SERIALIZABLE. *Owner: I-09.*

<a id="steal-no-force"></a>
### steal / no-force — steal / no-force
Buffer policy: uncommitted pages may be written (steal), committed ones need not be (no-force). Deeper: requires both undo and redo. *Owner: I-11.*

<a id="streaming-replication"></a>
### streaming replication — همانندسازی جریانی
PostgreSQL physical replication over a continuous WAL stream. *Owner: I-12.*

<a id="switchover"></a>
### switchover — جابه‌جایی برنامه‌ریزی‌شده (switchover)
A planned role change between primary and replica without data loss. *Owner: I-12.*

<a id="synchronous-replication"></a>
### synchronous replication — همانندسازی همگام
COMMIT waits for at least one replica to confirm. *Owner: I-12.*

<a id="table-partitioning"></a>
### table partitioning — پارتیشن‌بندی جدول
Splitting one logical table into physical pieces by range, list or hash. *Owner: I-12.*

<a id="throughput"></a>
### throughput — توان عملیاتی (throughput)
Operations completed per unit of time. *Owner: I-13.*

<a id="torn-page"></a>
### torn page — صفحهٔ پاره (torn page)
A page only partly written when power failed. *Owner: I-11.*

<a id="transaction"></a>
### transaction — تراکنش
Statements treated as one all-or-nothing unit of work. *Owner: I-09.*

<a id="transaction-id-wraparound"></a>
### transaction id wraparound — دورزدن شناسهٔ تراکنش (wraparound)
PostgreSQL's 32-bit transaction ids running around; prevented by freezing. *Owner: I-10.*

<a id="transaction-log"></a>
### transaction log — لاگ تراکنش
SQL Server's name for its write-ahead log (`.ldf`). *Owner: I-11.*

<a id="tuple-version"></a>
### tuple version — نسخهٔ تاپل
One physical version of a row in a PostgreSQL heap. *Owner: I-10.*

<a id="two-phase-commit"></a>
### two-phase commit (2PC) — commit دومرحله‌ای (2PC)
Prepare then commit across several participants, led by a coordinator. Deeper: in-doubt participants block. *Owner: I-12.*

<a id="two-phase-locking"></a>
### two-phase locking (2PL) — قفل‌گذاری دومرحله‌ای (2PL)
Acquire locks in a growing phase, release in a shrinking phase; strict 2PL holds them to commit. *Owner: I-09.*

<a id="undo"></a>
### undo — بازگردانی (undo)
Information to reverse a change or to rebuild an older row version. *Owner: I-10.*

<a id="undo-log"></a>
### undo log — لاگ بازگردانی
Stored before-images used for rollback, recovery and MVCC reads (InnoDB, Oracle undo segments). *Owner: I-11.*

<a id="update-lock"></a>
### update lock (U) — قفل به‌روزرسانی
SQL Server lock taken while an UPDATE searches rows; prevents conversion deadlocks. *Owner: I-10.*

<a id="vacuum"></a>
### VACUUM — VACUUM
PostgreSQL command that removes dead tuples, updates the visibility map and freezes old rows. *Owner: I-10.*

<a id="version-store"></a>
### version store — انبارهٔ نسخه‌ها
Where SQL Server keeps previous row versions (`tempdb`, or the persistent version store). *Owner: I-10.*

<a id="vlf"></a>
### VLF (virtual log file) — فایل لاگ مجازی (VLF)
Unit into which SQL Server divides its transaction log. *Owner: I-11.*

<a id="wait-statistics"></a>
### wait statistics — آمار انتظار
Records of what sessions wait on and for how long. *Owner: I-13.*

<a id="wal"></a>
### WAL (write-ahead log) — لاگ پیش‌نویس (WAL)
Sequential log written before data pages change and flushed at commit. *Owner: I-11.*

<a id="wal-mode"></a>
### WAL mode (SQLite) — حالت WAL
SQLite journal mode that appends new pages to a `-wal` file; readers do not block the writer. *Owner: I-11.*

<a id="write-skew"></a>
### write skew — write skew (انحراف نوشتن)
Two transactions read overlapping data and write different rows, together breaking a rule each checked. Deeper: allowed by snapshot isolation. *Owner: I-09.*

<a id="xmin-xmax"></a>
### xmin / xmax — xmin / xmax
PostgreSQL tuple fields: id of the creating and of the deleting (or locking) transaction. *Owner: I-10.*

## فارسی

<div dir="rtl" markdown="1">

<a id="accelerated-database-recovery"></a>
### Accelerated Database Recovery — بازیابی شتاب‌یافتهٔ پایگاه داده
گزینهٔ SQL Server 2019 به بعد که نسخه‌های سطرها را در انبارهٔ نسخهٔ ماندگار درون خود پایگاه داده نگه می‌دارد. عمیق‌تر: بازگردانی به یک «برگرداندن منطقی» تبدیل می‌شود، پس rollback و بازیابی پس از خرابی تقریباً آنی است. *مالک: I-11.*

<a id="acid"></a>
### ACID — ACID
چهار تضمین تراکنش: اتمی‌بودن، سازگاری، جداسازی، ماندگاری. عمیق‌تر: هر حرف را بخشی از موتور نگه می‌دارد (undo، قیدها، کنترل هم‌روندی، WAL). *مالک: I-09.*

<a id="archivelog-mode"></a>
### ARCHIVELOG mode — حالت ARCHIVELOG
حالتی در Oracle که هر گروه redo پرشده پیش از استفادهٔ دوباره بایگانی می‌شود. لازمهٔ بازیابی رسانه، PITR و Data Guard. *مالک: I-11.*

<a id="aries"></a>
### ARIES — ARIES
الگوریتم کلاسیک بازیابی پس از خرابی (IBM، 1992) با سه مرحلهٔ تحلیل، بازاجرا و بازگردانی. *مالک: I-11.*

<a id="asynchronous-replication"></a>
### asynchronous replication — همانندسازی ناهمگام
COMMIT پیش از رسیدن تغییر به رونوشت برمی‌گردد؛ هزینهٔ تأخیر ندارد اما در failover ممکن است تراکنش‌های اخیر از دست بروند. *مالک: I-12.*

<a id="atomicity"></a>
### atomicity — اتمی‌بودن
همهٔ دستورهای تراکنش اثر می‌کنند یا هیچ‌کدام. *مالک: I-09.*

<a id="autocommit"></a>
### autocommit — ثبت خودکار
حالتی که هر دستور تراکنش جداگانهٔ خودش است و در پایان commit می‌شود. *مالک: I-09.*

<a id="autovacuum"></a>
### autovacuum — جاروی خودکار (autovacuum)
کارگرهای پس‌زمینهٔ PostgreSQL که وقتی تاپل‌های مرده زیاد شوند VACUUM و ANALYZE اجرا می‌کنند. *مالک: I-10.*

<a id="awr"></a>
### AWR — مخزن خودکار بار کاری (AWR)
تصویرهای دوره‌ای آمار کارایی در Oracle؛ در نسخهٔ Enterprise به مجوز Diagnostics Pack نیاز دارد. *مالک: I-13.*

<a id="backup"></a>
### backup — پشتیبان
نسخه‌ای از داده که کنار گذاشته می‌شود تا بعداً بازگردانده شود. رونوشت (replica) پشتیبان نیست. *مالک: I-12.*

<a id="binlog"></a>
### binlog (binary log) — لاگ دودویی (binlog)
لاگ سطح سرور MySQL از تغییرات commitشده، برای همانندسازی و PITR. *مالک: I-12.*

<a id="blocking-chain"></a>
### blocking chain — زنجیرهٔ انسداد
صفی از نشست‌ها که هر کدام منتظر قفل نشست بعدی است و به مسدودکنندهٔ سرِ زنجیره ختم می‌شود. *مالک: I-10.*

<a id="bloat"></a>
### bloat — حجیم‌شدگی (bloat)
فضای اشغال‌شده با نسخه‌های مرده یا صفحه‌های خالی در جدول و نمایه. *مالک: I-10.*

<a id="bottleneck"></a>
### bottleneck — گلوگاه
تنها منبع یا مرحله‌ای که سرعت کل سامانه را محدود می‌کند. *مالک: I-13.*

<a id="bulk-load"></a>
### bulk load — بارگذاری انبوه
بارگذاری سطرهای زیاد از مسیر سریع موتور (`COPY`، `BULK INSERT`، `LOAD DATA`، `COPY INTO`). *مالک: I-13.*

<a id="cap"></a>
### CAP theorem — قضیهٔ CAP
هنگام گسست شبکه، سامانهٔ همانندسازی‌شده باید از سازگاری (خطی‌پذیری) یا دسترس‌پذیری بگذرد. «دو از سه» برداشت نادرستی است. *مالک: I-12.*

<a id="causal-consistency"></a>
### causal consistency — سازگاری علّی
نوشتن‌هایی که رابطهٔ علّی دارند را همه به یک ترتیب می‌بینند. *مالک: I-12.*

<a id="cdc"></a>
### CDC (change data capture) — ثبت تغییرات داده (CDC)
خواندن لاگ پایگاه داده و انتشار هر تغییر سطر به‌صورت رویداد. *مالک: I-12.*

<a id="checkpoint"></a>
### checkpoint — نقطهٔ وارسی (checkpoint)
نوشتن صفحه‌های کثیف تا بازیابی بتواند از موقعیتی نزدیک در لاگ شروع شود. *مالک: I-11.*

<a id="commit"></a>
### commit — commit (ثبت نهایی)
پایان تراکنش به‌گونه‌ای که تغییرها ماندگار و دیدنی شوند. *مالک: I-09.*

<a id="compensation-log-record"></a>
### compensation log record (CLR) — رکورد لاگ جبرانی (CLR)
رکوردی که هنگام بازگرداندن یک تغییر نوشته می‌شود تا بازیابی دوباره همان تغییر را دوبار برنگرداند. *مالک: I-11.*

<a id="connection-pool"></a>
### connection pool — استخر اتصال
مجموعه‌ای از اتصال‌های باز که قرض داده و به‌جای بسته‌شدن برگردانده می‌شوند. *مالک: I-13.*

<a id="consensus"></a>
### consensus — اجماع
توافق گره‌ها بر یک مقدار با وجود خرابی؛ Paxos و Raft. *مالک: I-12.*

<a id="consistency"></a>
### consistency (ACID) — سازگاری
تراکنش پایگاه داده را از یک وضعیت معتبر به وضعیت معتبر دیگر می‌برد. با C در CAP یکی نیست. *مالک: I-09.*

<a id="consistent-read"></a>
### consistent read — خواندن سازگار
خواندن بلوک در Oracle به‌حالتِ SCN پرس‌وجو با اعمال undo روی یک کپی. *مالک: I-10.*

<a id="crash-recovery"></a>
### crash recovery — بازیابی پس از خرابی
بازگرداندن پایگاه داده به وضعیت درست پس از خرابی با بازاجرا و بازگردانی لاگ. *مالک: I-11.*

<a id="dead-tuple"></a>
### dead tuple — تاپل مرده
نسخه‌ای از سطر در PostgreSQL که هیچ snapshotی دیگر آن را نمی‌بیند. *مالک: I-10.*

<a id="deadlock"></a>
### deadlock — بن‌بست
چرخه‌ای از تراکنش‌ها که هر کدام منتظر قفل دیگری است. *مالک: I-10.*

<a id="deadlock-graph"></a>
### deadlock graph — گراف بن‌بست
گزارش موتور از فرایندها و منابع درگیر در بن‌بست. *مالک: I-10.*

<a id="deadlock-victim"></a>
### deadlock victim — قربانی بن‌بست
تراکنشی که موتور برای شکستن بن‌بست بازمی‌گرداند؛ باید دوباره اجرا شود. *مالک: I-10.*

<a id="delayed-durability"></a>
### delayed durability — ماندگاری تأخیری
گزینهٔ SQL Server برای بازگشت از COMMIT پیش از flush لاگ. *مالک: I-11.*

<a id="differential-backup"></a>
### differential backup — پشتیبان تفاضلی
صفحه‌های تغییرکرده از آخرین پشتیبان کامل. *مالک: I-12.*

<a id="dirty-read"></a>
### dirty read — خواندن کثیف
خواندن تغییر commitنشدهٔ تراکنشی دیگر. *مالک: I-09.*

<a id="dmv"></a>
### DMV (dynamic management view) — نمای مدیریتی پویا (DMV)
نماهای `sys.dm_*` در SQL Server برای وضعیت زنده و انباشتهٔ سرور. *مالک: I-13.*

<a id="doublewrite-buffer"></a>
### doublewrite buffer — بافر نوشتن دوگانه
ناحیه‌ای در InnoDB که صفحه‌ها پیش از جای اصلی‌شان آنجا نوشته می‌شوند تا صفحهٔ پاره ترمیم شود. *مالک: I-11.*

<a id="durability"></a>
### durability — ماندگاری
تغییر commitشده از خرابی و قطع برق جان سالم به در می‌برد. *مالک: I-09.*

<a id="eventual-consistency"></a>
### eventual consistency — سازگاری نهایی
اگر نوشتن متوقف شود، رونوشت‌ها سرانجام هم‌سان می‌شوند. *مالک: I-12.*

<a id="exclusive-lock"></a>
### exclusive lock (X) — قفل انحصاری
قفل نوشتن؛ با هیچ حالت دیگری سازگار نیست. *مالک: I-10.*

<a id="failover"></a>
### failover — جابه‌جایی خودکار (failover)
ارتقای رونوشت به اصلی هنگام از کار افتادن اصلی. *مالک: I-12.*

<a id="fencing"></a>
### fencing — حصارکشی (fencing)
بازداشتن فعالانهٔ اصلیِ قدیمی از پذیرش نوشتن؛ جلوی split brain را می‌گیرد. *مالک: I-12.*

<a id="freezing"></a>
### freezing — منجمدسازی (freezing)
علامت‌زدن تاپل‌های قدیمی در PostgreSQL به‌عنوان دیدنی برای همه، برای جلوگیری از wraparound. *مالک: I-10.*

<a id="fsync"></a>
### fsync — fsync
فراخوان سیستمی که فقط پس از رسیدن داده به دستگاه ذخیره‌سازی برمی‌گردد. *مالک: I-11.*

<a id="full-backup"></a>
### full backup — پشتیبان کامل
نسخه‌ای از کل پایگاه داده. *مالک: I-12.*

<a id="full-page-write"></a>
### full page write — نوشتن صفحهٔ کامل
ثبت تصویر کامل صفحه در WAL هنگام نخستین تغییر پس از checkpoint در PostgreSQL. *مالک: I-11.*

<a id="fuzzy-checkpoint"></a>
### fuzzy checkpoint — checkpoint فازی
checkpointی که در حین اجرای تراکنش‌ها انجام می‌شود. *مالک: I-11.*

<a id="gap-lock"></a>
### gap lock — قفل شکاف
قفل InnoDB روی فاصلهٔ میان رکوردهای نمایه که درج در آنجا را مسدود می‌کند. *مالک: I-10.*

<a id="group-commit"></a>
### group commit — commit گروهی
ماندگارشدن چند commit با یک flush لاگ. *مالک: I-11.*

<a id="head-blocker"></a>
### head blocker — مسدودکنندهٔ سرِ زنجیره
نشستی در ابتدای زنجیرهٔ انسداد که خودش منتظر قفلی نیست. *مالک: I-10.*

<a id="history-list-length"></a>
### history list length — طول فهرست تاریخچه
شمار رکوردهای undo که InnoDB هنوز پاک نکرده است. *مالک: I-10.*

<a id="hot-update"></a>
### HOT update — به‌روزرسانی HOT
به‌روزرسانی heap-only در PostgreSQL: نسخهٔ تازه در همان صفحه می‌ماند و مدخل نمایهٔ تازه‌ای لازم نیست. *مالک: I-10.*

<a id="implicit-commit"></a>
### implicit commit — commit ضمنی
commitی که موتور خودش انجام می‌دهد، مثلاً پیرامون DDL در Oracle و MySQL. *مالک: I-09.*

<a id="implicit-conversion"></a>
### implicit conversion — تبدیل ضمنی
تبدیل یک سوی مقایسه به نوع سوی دیگر؛ اگر ستون تبدیل شود، شرط دیگر SARGable نیست. *مالک: I-13.*

<a id="incremental-backup"></a>
### incremental backup — پشتیبان افزایشی
صفحه‌های تغییرکرده از آخرین پشتیبانِ هر نوع. *مالک: I-12.*

<a id="intent-lock"></a>
### intent lock — قفل نیت
قفلی روی ظرف (جدول، صفحه) که از وجود قفل روی سطرهایش خبر می‌دهد (IS، IX، SIX). *مالک: I-10.*

<a id="isolation"></a>
### isolation — جداسازی
تراکنش‌های هم‌زمان کار نیمه‌تمام یکدیگر را نمی‌بینند، به اندازه‌ای که سطح جداسازی وعده می‌دهد. *مالک: I-09.*

<a id="isolation-level"></a>
### isolation level — سطح جداسازی
تنظیمی که تعیین می‌کند تراکنش کدام ناهنجاری‌ها را می‌تواند ببیند. *مالک: I-09.*

<a id="journal"></a>
### journal (SQLite) — ژورنال
ژورنال بازگردانی SQLite: صفحه‌های اصلی پیش از تغییر کنار گذاشته می‌شوند (یک لاگ undo). *مالک: I-11.*

<a id="keyset-pagination"></a>
### keyset pagination — صفحه‌بندی کلیدی (keyset)
خواندن صفحهٔ بعد با `WHERE key > last_key ORDER BY key LIMIT n`؛ هزینهٔ هر صفحه ثابت است. *مالک: I-13.*

<a id="latch"></a>
### latch — latch (قفل سبک داخلی)
قفل کوتاه‌مدت درون حافظه برای محافظت از یک ساختار فیزیکی مانند صفحهٔ بافر. *مالک: I-10.*

<a id="latency"></a>
### latency — تأخیر (latency)
زمانی که یک عملیات طول می‌کشد؛ صدک‌ها را گزارش کنید، نه میانگین را. *مالک: I-13.*

<a id="lazy-loading"></a>
### lazy loading — بارگذاری تنبل
رفتار ORM که اشیای وابسته را فقط هنگام نخستین دسترسی بار می‌کند؛ علت معمول N+1. *مالک: I-13.*

<a id="lightweight-transaction"></a>
### lightweight transaction (LWT) — تراکنش سبک (LWT)
مقایسه‌و‌جایگزینی روی یک پارتیشن در Cassandra با Paxos. *مالک: I-09.*

<a id="linearizability"></a>
### linearizability — خطی‌پذیری
هر عملیات گویی در یک لحظه میان آغاز و پایانش اثر می‌کند؛ نوشتن تأییدشده را همهٔ خواندن‌های بعدی می‌بینند. *مالک: I-12.*

<a id="littles-law"></a>
### Little's law — قانون لیتل
هم‌روندی = توان عملیاتی × تأخیر. *مالک: I-13.*

<a id="lock"></a>
### lock — قفل
ثبت این‌که تراکنشی منبعی را در حالتی به کار می‌برد؛ درخواست‌های ناسازگار منتظر می‌مانند. *مالک: I-10.*

<a id="lock-compatibility"></a>
### lock compatibility matrix — ماتریس سازگاری قفل‌ها
جدولی که نشان می‌دهد کدام حالت‌های قفل هم‌زمان پذیرفتنی‌اند. *مالک: I-10.*

<a id="lock-escalation"></a>
### lock escalation — ارتقای قفل
جایگزینی قفل‌های ریز فراوان با یک قفل درشت. *مالک: I-10.*

<a id="lock-timeout"></a>
### lock timeout — مهلت قفل
بیشینهٔ زمان انتظار برای قفل پیش از خطا. *مالک: I-10.*

<a id="log-backup"></a>
### log backup — پشتیبان لاگ
پشتیبان رکوردهای لاگ از آخرین پشتیبان لاگ؛ پایهٔ PITR. *مالک: I-12.*

<a id="log-record"></a>
### log record — رکورد لاگ
یک مدخل WAL که یک تغییر را توصیف می‌کند. *مالک: I-11.*

<a id="log-truncation"></a>
### log truncation — کوتاه‌سازی لاگ
قابل‌استفاده‌کردن دوبارهٔ فضای لاگ قدیمی. *مالک: I-11.*

<a id="logical-backup"></a>
### logical backup — پشتیبان منطقی
خروجی SQL یا سطرها (`pg_dump`، `mysqldump`، Data Pump). *مالک: I-12.*

<a id="logical-replication"></a>
### logical replication — همانندسازی منطقی
فرستادن تغییرهای سطر به یک پایگاه دادهٔ مستقل. *مالک: I-12.*

<a id="lost-update"></a>
### lost update — به‌روزرسانی گم‌شده
دو تراکنش خواندن‌ـ‌تغییرـ‌نوشتن که نوشتن دوم نوشتن اول را بازنویسی می‌کند. *مالک: I-09.*

<a id="lsn"></a>
### LSN (log sequence number) — شمارهٔ ترتیبی لاگ (LSN)
موقعیت یکنواخت‌افزایندهٔ یک رکورد در لاگ. *مالک: I-11.*

<a id="manual-transaction"></a>
### manual transaction — تراکنش دستی
حالتی که دستورها تا COMMIT یا ROLLBACK صریح در تراکنش باز می‌مانند. *مالک: I-09.*

<a id="mvcc"></a>
### MVCC (multi-version concurrency control) — کنترل هم‌روندی چندنسخه‌ای (MVCC)
نویسنده‌ها نسخهٔ تازهٔ سطر می‌سازند و خواننده‌ها نسخهٔ معتبر برای snapshot خود را می‌خوانند. *مالک: I-10.*

<a id="n-plus-1"></a>
### N+1 queries — پرس‌وجوهای N+1
یک پرس‌وجو برای فهرست و یکی برای هر قلم. *مالک: I-13.*

<a id="next-key-lock"></a>
### next-key lock — قفل کلید بعدی
قفل رکورد InnoDB به‌همراه قفل شکافِ پیش از آن. *مالک: I-10.*

<a id="non-repeatable-read"></a>
### non-repeatable read — خواندن تکرارناپذیر
یک سطر که دوبار در یک تراکنش خوانده می‌شود، مقدار متفاوت برمی‌گرداند. *مالک: I-09.*

<a id="offset-pagination"></a>
### offset pagination — صفحه‌بندی با OFFSET
`LIMIT n OFFSET k`: موتور k سطر را می‌سازد و دور می‌ریزد. *مالک: I-13.*

<a id="optimistic-concurrency"></a>
### optimistic concurrency — هم‌روندی خوش‌بینانه
خواندن بدون قفل و بررسی تغییرنکردن سطر هنگام نوشتن. *مالک: I-10.*

<a id="ora-01555"></a>
### ORA-01555 (snapshot too old) — خطای ORA-01555
خطای Oracle وقتی undo لازم برای خواندن سازگار بازنویسی شده باشد. *مالک: I-10.*

<a id="over-indexing"></a>
### over-indexing — نمایه‌گذاری بیش از اندازه
نمایه‌هایی بیش از نیاز بار کاری؛ هر کدام نوشتن را کند می‌کند. *مالک: I-13.*

<a id="pacelc"></a>
### PACELC — PACELC
اگر گسست (Partition) هست، میان دسترس‌پذیری و سازگاری؛ وگرنه (Else) میان تأخیر و سازگاری انتخاب کن. *مالک: I-12.*

<a id="pagelsn"></a>
### pageLSN — pageLSN
LSN آخرین رکورد لاگِ اعمال‌شده که در خود صفحه ذخیره شده است. *مالک: I-11.*

<a id="partition-key-table"></a>
### partition key (table partitioning) — کلید پارتیشن
ستون(هایی) که پارتیشنِ هر سطر را تعیین می‌کند؛ با کلید پارتیشن Cassandra یکی نیست. *مالک: I-12.*

<a id="partition-pruning"></a>
### partition pruning — هرس پارتیشن
کنار گذاشتن پارتیشن‌هایی که نمی‌توانند سطر منطبق داشته باشند. *مالک: I-12.*

<a id="percentile"></a>
### percentile — صدک
مقداری که سهم معینی از اندازه‌گیری‌ها زیر آن است (p50، p95، p99). *مالک: I-13.*

<a id="pessimistic-concurrency"></a>
### pessimistic concurrency — هم‌روندی بدبینانه
قفل‌کردن آنچه می‌خوانید چون انتظار تعارض دارید. *مالک: I-10.*

<a id="pg-stat-statements"></a>
### pg_stat_statements — pg_stat_statements
افزونهٔ PostgreSQL که آمار را برای هر دستور نرمال‌شده جمع می‌کند. *مالک: I-13.*

<a id="pgbouncer"></a>
### PgBouncer — PgBouncer
استخر اتصال سبک برای PostgreSQL با حالت‌های session، transaction و statement. *مالک: I-13.*

<a id="phantom-read"></a>
### phantom read — خواندن شبح (phantom)
پرس‌وجوی بازه‌ای تکراری سطرهای تازه یا گم‌شده برمی‌گرداند. *مالک: I-09.*

<a id="physical-backup"></a>
### physical backup — پشتیبان فیزیکی
کپی فایل‌ها یا صفحه‌های داده. *مالک: I-12.*

<a id="physical-replication"></a>
### physical replication — همانندسازی فیزیکی
فرستادن خود لاگ؛ رونوشت آن را بازاجرا می‌کند و نسخه‌ای بایت‌به‌بایت یکسان می‌سازد. *مالک: I-12.*

<a id="pitr"></a>
### PITR (point-in-time recovery) — بازیابی به نقطه‌ای از زمان (PITR)
بازگرداندن پشتیبان و بازاجرای لاگ تا لحظهٔ دلخواه. *مالک: I-12.*

<a id="primary-replica"></a>
### primary / replica — اصلی / رونوشت
سروری که نوشتن را می‌پذیرد و سرورهایی که تغییرهایش را دنبال می‌کنند. *مالک: I-12.*

<a id="query-store"></a>
### Query Store — Query Store (انبارهٔ پرس‌وجو)
قابلیت SQL Server برای نگه‌داری ماندگار متن پرس‌وجو، طرح اجرا و آمار اجرا در پایگاه داده. *مالک: I-13.*

<a id="quorum"></a>
### quorum — حد نصاب
اکثریت (یا شمار تعیین‌شده‌ای) از گره‌ها که باید تأیید کنند. *مالک: I-12.*

<a id="raft"></a>
### Raft — Raft
الگوریتم اجماع با دوره‌ها (term)، رهبر برگزیده و مدخل‌های لاگِ همانندسازی‌شده در اکثریت. *مالک: I-12.*

<a id="rbar"></a>
### RBAR — RBAR (ردیف به ردیف)
پردازش سطرها در حلقه به‌جای یک دستور مجموعه‌محور. *مالک: I-13.*

<a id="rcsi"></a>
### RCSI (read committed snapshot isolation) — RCSI
گزینهٔ SQL Server که READ COMMITTED را به خواندن نسخهٔ سطرها به‌جای انتظار برای قفل وامی‌دارد. *مالک: I-10.*

<a id="read-committed"></a>
### READ COMMITTED — READ COMMITTED
سطحی که فقط دادهٔ commitشده را می‌بیند؛ پیش‌فرض PostgreSQL، SQL Server، Oracle و Snowflake. *مالک: I-09.*

<a id="read-skew"></a>
### read skew — انحراف خواندن (read skew)
دو خواندن در یک تراکنش دو لحظهٔ متفاوت از داده‌های مرتبط را می‌بینند. *مالک: I-09.*

<a id="read-uncommitted"></a>
### READ UNCOMMITTED — READ UNCOMMITTED
ضعیف‌ترین سطح؛ هرجا پشتیبانی شود خواندن کثیف را مجاز می‌کند. *مالک: I-09.*

<a id="read-view"></a>
### read view — نمای خواندن (read view)
فهرست InnoDB از تراکنش‌های فعال در لحظهٔ آغاز خواندن سازگار. *مالک: I-10.*

<a id="read-your-writes"></a>
### read-your-writes — خواندن نوشته‌های خود
کلاینت همیشه نوشته‌های پیشین خودش را می‌بیند. *مالک: I-12.*

<a id="rebalancing"></a>
### rebalancing — توازن‌بخشی دوباره
جابه‌جایی داده میان شاردها هنگام افزودن شارد یا ناهمواری توزیع. *مالک: I-12.*

<a id="recovery-model"></a>
### recovery model — مدل بازیابی
تنظیم SQL Server (SIMPLE، FULL، BULK_LOGGED) که زمان کوتاه‌سازی لاگ را تعیین می‌کند. *مالک: I-11.*

<a id="redo"></a>
### redo — بازاجرا (redo)
اعمال دوبارهٔ تغییرهای ثبت‌شده روی صفحه‌هایی که آن‌ها را ندارند. *مالک: I-11.*

<a id="redo-point"></a>
### redo point — نقطهٔ بازاجرا
موقعیتی در لاگ که بازیابی از آن شروع می‌شود و در آغاز آخرین checkpoint ثبت شده است. *مالک: I-11.*

<a id="repeatable-read"></a>
### REPEATABLE READ — REPEATABLE READ
سطحی که جلوی خواندن تکرارناپذیر را می‌گیرد؛ در هر موتور معنای کمی متفاوت دارد. *مالک: I-09.*

<a id="replication"></a>
### replication — همانندسازی
نگه‌داری نسخه‌های زندهٔ داده روی سرورهای دیگر. *مالک: I-12.*

<a id="replication-lag"></a>
### replication lag — تأخیر همانندسازی
فاصلهٔ عقب‌ماندگی رونوشت از اصلی. *مالک: I-12.*

<a id="replication-slot"></a>
### replication slot — اسلات همانندسازی
شیء PostgreSQL که WAL را تا دریافت مصرف‌کننده نگه می‌دارد. *مالک: I-12.*

<a id="restore-drill"></a>
### restore drill — تمرین بازگردانی
بازگرداندن منظم پشتیبان‌ها برای اثبات کارکرد و سنجش RTO واقعی. *مالک: I-12.*

<a id="rollback"></a>
### rollback — بازگردانی (rollback)
پایان تراکنش با برگرداندن همهٔ تغییرهایش. *مالک: I-09.*

<a id="round-trip"></a>
### round trip — رفت‌وبرگشت
درخواستی که به سرور می‌رود و پاسخی که برمی‌گردد. *مالک: I-13.*

<a id="row-versioning"></a>
### row versioning — نسخه‌بندی سطرها
MVCC در SQL Server: نسخه‌های پیشین سطر در انبارهٔ نسخه‌ها. *مالک: I-10.*

<a id="rpo"></a>
### RPO (recovery point objective) — هدف نقطهٔ بازیابی (RPO)
بیشینهٔ از دست رفتن دادهٔ پذیرفتنی، بر حسب زمان. *مالک: I-12.*

<a id="rto"></a>
### RTO (recovery time objective) — هدف زمان بازیابی (RTO)
بیشینهٔ زمان پذیرفتنی تا کارکرد دوبارهٔ سامانه. *مالک: I-12.*

<a id="saga"></a>
### saga — saga (زنجیرهٔ تراکنش‌های جبران‌پذیر)
دنباله‌ای از تراکنش‌های محلی با کنش‌های جبرانی به‌جای یک تراکنش توزیع‌شده. *مالک: I-12.*

<a id="sargable"></a>
### SARGable — SARGable (قابل‌جست‌وجو با نمایه)
شرطی که موتور با نمایه پاسخ می‌دهد: ستون تنها در یک سوی مقایسه. *مالک: I-13.*

<a id="savepoint"></a>
### savepoint — نقطهٔ ذخیره (savepoint)
نشانهٔ نام‌دار در تراکنش؛ بازگشت به آن فقط کار پس از آن را برمی‌گرداند. *مالک: I-09.*

<a id="scatter-gather"></a>
### scatter-gather — پخش و گردآوری (scatter-gather)
فرستادن پرس‌وجو به همهٔ شاردها و ادغام نتیجه‌ها. *مالک: I-12.*

<a id="scn"></a>
### SCN (system change number) — شمارهٔ تغییر سیستم (SCN)
ساعت منطقی سراسری Oracle که روی هر commit زده می‌شود. *مالک: I-10.*

<a id="serializable"></a>
### SERIALIZABLE — SERIALIZABLE
قوی‌ترین سطح: نتیجه با یک ترتیب سریال برابر است. *مالک: I-09.*

<a id="serialization-failure"></a>
### serialization failure — شکست سریال‌پذیری
خطایی که به برنامه می‌گوید تراکنش را دوباره اجرا کند (SQLSTATE 40001 و هم‌ارزها). *مالک: I-09.*

<a id="shard-key"></a>
### shard key — کلید شارد
ستون(هایی) که تعیین می‌کند سطر در کدام شارد قرار گیرد. *مالک: I-12.*

<a id="sharding"></a>
### sharding — شاردینگ
پخش‌کردن سطرها روی سرورهای مستقل. *مالک: I-12.*

<a id="shared-lock"></a>
### shared lock (S) — قفل اشتراکی
قفل خواندن؛ چند دارنده هم‌زمان مجازند. *مالک: I-10.*

<a id="skip-locked"></a>
### SKIP LOCKED — SKIP LOCKED
گزینهٔ خواندن قفل‌دار که از سطرهای قفل‌شده می‌گذرد؛ پایهٔ صف کار در پایگاه داده. *مالک: I-10.*

<a id="slow-query-log"></a>
### slow query log — لاگ پرس‌وجوهای کند
لاگ دستورهایی که از آستانه کندترند. *مالک: I-13.*

<a id="snapshot-mvcc"></a>
### snapshot (MVCC) — تصویر لحظه‌ای (snapshot)
مجموعهٔ تراکنش‌های commitشده‌ای که یک دستور یا تراکنش می‌بیند. *مالک: I-10.*

<a id="snapshot-isolation"></a>
### snapshot isolation — جداسازی تصویر لحظه‌ای
هر تراکنش یک snapshot می‌خواند؛ در تعارض نوشتن، نخستین commitکننده برنده است. write skew ممکن است. *مالک: I-09.*

<a id="split-brain"></a>
### split brain — دوپارگی (split brain)
دو گره هر دو نقش اصلی را بازی می‌کنند و نوشتن می‌پذیرند. *مالک: I-12.*

<a id="ssi"></a>
### SSI (serializable snapshot isolation) — جداسازی تصویر لحظه‌ای سریال‌پذیر (SSI)
snapshot isolation به‌همراه کشف وابستگی‌های خطرناک خواندن/نوشتن؛ SERIALIZABLE در PostgreSQL. *مالک: I-09.*

<a id="steal-no-force"></a>
### steal / no-force — steal / no-force
سیاست بافر: صفحه‌های commitنشده را می‌توان نوشت (steal) و صفحه‌های commitشده لازم نیست نوشته شوند (no-force). *مالک: I-11.*

<a id="streaming-replication"></a>
### streaming replication — همانندسازی جریانی
همانندسازی فیزیکی PostgreSQL روی جریان پیوستهٔ WAL. *مالک: I-12.*

<a id="switchover"></a>
### switchover — جابه‌جایی برنامه‌ریزی‌شده (switchover)
تعویض برنامه‌ریزی‌شدهٔ نقش اصلی و رونوشت بدون از دست رفتن داده. *مالک: I-12.*

<a id="synchronous-replication"></a>
### synchronous replication — همانندسازی همگام
COMMIT منتظر تأیید دست‌کم یک رونوشت می‌ماند. *مالک: I-12.*

<a id="table-partitioning"></a>
### table partitioning — پارتیشن‌بندی جدول
تقسیم یک جدول منطقی به تکه‌های فیزیکی بر پایهٔ بازه، فهرست یا هش. *مالک: I-12.*

<a id="throughput"></a>
### throughput — توان عملیاتی (throughput)
شمار عملیات تمام‌شده در واحد زمان. *مالک: I-13.*

<a id="torn-page"></a>
### torn page — صفحهٔ پاره (torn page)
صفحه‌ای که هنگام قطع برق فقط بخشی از آن نوشته شده است. *مالک: I-11.*

<a id="transaction"></a>
### transaction — تراکنش
دستورهایی که یک واحد کار «همه یا هیچ» شمرده می‌شوند. *مالک: I-09.*

<a id="transaction-id-wraparound"></a>
### transaction id wraparound — دورزدن شناسهٔ تراکنش (wraparound)
دور زدن شناسه‌های 32 بیتی تراکنش در PostgreSQL؛ با منجمدسازی پیشگیری می‌شود. *مالک: I-10.*

<a id="transaction-log"></a>
### transaction log — لاگ تراکنش
نام SQL Server برای لاگ پیش‌نویس (`.ldf`). *مالک: I-11.*

<a id="tuple-version"></a>
### tuple version — نسخهٔ تاپل
یک نسخهٔ فیزیکی از سطر در heap جدول PostgreSQL. *مالک: I-10.*

<a id="two-phase-commit"></a>
### two-phase commit (2PC) — commit دومرحله‌ای (2PC)
آماده‌سازی و سپس commit میان چند شرکت‌کننده به رهبری یک هماهنگ‌کننده. *مالک: I-12.*

<a id="two-phase-locking"></a>
### two-phase locking (2PL) — قفل‌گذاری دومرحله‌ای (2PL)
گرفتن قفل‌ها در مرحلهٔ رشد و رهاکردن در مرحلهٔ کاهش. *مالک: I-09.*

<a id="undo"></a>
### undo — بازگردانی (undo)
اطلاعات لازم برای برگرداندن تغییر یا بازسازی نسخهٔ قدیمی سطر. *مالک: I-10.*

<a id="undo-log"></a>
### undo log — لاگ بازگردانی
تصویرهای پیش از تغییر برای rollback، بازیابی و خواندن‌های MVCC. *مالک: I-11.*

<a id="update-lock"></a>
### update lock (U) — قفل به‌روزرسانی
قفل SQL Server هنگام جست‌وجوی سطرها توسط UPDATE؛ جلوی بن‌بست تبدیل را می‌گیرد. *مالک: I-10.*

<a id="vacuum"></a>
### VACUUM — VACUUM
دستور PostgreSQL برای حذف تاپل‌های مرده، به‌روزکردن نقشهٔ دیدپذیری و منجمدسازی. *مالک: I-10.*

<a id="version-store"></a>
### version store — انبارهٔ نسخه‌ها
جایی که SQL Server نسخه‌های پیشین سطرها را نگه می‌دارد. *مالک: I-10.*

<a id="vlf"></a>
### VLF (virtual log file) — فایل لاگ مجازی (VLF)
واحدی که SQL Server لاگ تراکنش را به آن تقسیم می‌کند. *مالک: I-11.*

<a id="wait-statistics"></a>
### wait statistics — آمار انتظار
ثبت این‌که نشست‌ها منتظر چه هستند و چه مدت. *مالک: I-13.*

<a id="wal"></a>
### WAL (write-ahead log) — لاگ پیش‌نویس (WAL)
لاگ ترتیبی که پیش از تغییر صفحه‌های داده نوشته و هنگام commit به دیسک سپرده می‌شود. *مالک: I-11.*

<a id="wal-mode"></a>
### WAL mode (SQLite) — حالت WAL
حالت ژورنال SQLite که صفحه‌های تازه را به فایل `-wal` می‌افزاید؛ خواننده‌ها نویسنده را مسدود نمی‌کنند. *مالک: I-11.*

<a id="write-skew"></a>
### write skew — write skew (انحراف نوشتن)
دو تراکنش دادهٔ مشترکی را می‌خوانند و سطرهای متفاوتی می‌نویسند و با هم قاعده‌ای را می‌شکنند. *مالک: I-09.*

<a id="xmin-xmax"></a>
### xmin / xmax — xmin / xmax
فیلدهای تاپل در PostgreSQL: شناسهٔ تراکنش سازنده و حذف‌کننده (یا قفل‌کننده). *مالک: I-10.*

</div>
