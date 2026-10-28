# Glossary fragment, package D (chapters I-14 to I-17), English

Row format: anchor, term, beginner meaning, deeper note, owner chapter. Package H merges these rows into `en/glossary.md` (alphabetical). Cross-references use the glossary anchors.

## I-14 Database security

<a id="authentication"></a>
### authentication
Proving who you are to the server (password, ticket, certificate, signed token). Deeper: the server decides which method applies (PostgreSQL `pg_hba.conf`, SQL Server login type); weak methods over unencrypted links can be replayed or stolen. *Owner: I-14.* See also: authorisation, SCRAM, Kerberos.

<a id="authorisation"></a>
### authorisation
Deciding what an authenticated principal may do (read, change, create). Deeper: implemented with roles, privileges, ownership, row policies; the principle of least privilege governs its design. *Owner: I-14.* See also: privilege, role, least privilege.

<a id="defence-in-depth"></a>
### defence in depth
Using several independent protections so one failure is not fatal. Deeper: authentication, authorisation, encryption, injection defence and audit each cover what the others miss. *Owner: I-14.*

<a id="kerberos"></a>
### Kerberos
A ticket-based network authentication protocol: a key distribution centre issues tickets, so the password never crosses the network. Deeper: tickets are bound to a service principal name (SPN); the "double hop" problem needs constrained delegation. *Owner: I-14.* See also: SSO.

<a id="key-pair-authentication"></a>
### key-pair authentication
Login by signing a short-lived token with a private key; the server holds the public key. Deeper: Snowflake's `snowflake_jwt`; the private key can be encrypted with a passphrase. *Owner: I-14.*

<a id="oauth"></a>
### OAuth
A framework in which an identity provider issues access tokens that a client presents instead of a password. Deeper: tokens expire; the database validates the signature and claims. *Owner: I-14.* See also: SSO.

<a id="sso"></a>
### SSO (single sign-on)
Logging in once with an identity provider and reusing that login for many services. Deeper: Snowflake `externalbrowser` opens the provider in a browser and hands the database a proof. *Owner: I-14.* See also: OAuth, Kerberos.

<a id="scram"></a>
### SCRAM
Salted Challenge Response Authentication Mechanism: both sides prove they know the password by answering a fresh challenge, without sending it. Deeper: the server stores a salted, iterated hash; `-PLUS` variants bind to the TLS channel. *Owner: I-14.* See also: TLS.

<a id="pg-hba-conf"></a>
### pg_hba.conf
PostgreSQL's host-based authentication file: lines of (connection type, database, user, address, method). Deeper: first match wins; `reject` closes a door; `hostssl` requires TLS. *Owner: I-14.*

<a id="principal"></a>
### principal
Anything that can be granted rights: a user, group or role. Deeper: in Kerberos a principal is also the name of a user or service in the realm. *Owner: I-14.*

<a id="role"></a>
### role
A named bundle of privileges that can be granted to users or other roles. Deeper: PostgreSQL makes no difference between users and roles (a role with `LOGIN`); Snowflake builds a role hierarchy. *Owner: I-14.* See also: privilege.

<a id="privilege"></a>
### privilege
One permission, such as `SELECT` on a table or `CREATE TABLE` in a schema. Deeper: object privileges apply to an object, system privileges to the server. *Owner: I-14.*

<a id="grant-revoke"></a>
### GRANT / REVOKE
`GRANT` gives a privilege, `REVOKE` removes it. Deeper: SQL Server also has `DENY`, which overrides `GRANT`; `WITH GRANT OPTION` lets the grantee pass it on. *Owner: I-14.*

<a id="least-privilege"></a>
### least privilege
Each account gets only the permissions its job needs. Deeper: web applications should not own tables; reporting accounts are read-only. *Owner: I-14.*

<a id="row-level-security"></a>
### row-level security (RLS)
A predicate the engine adds to every query on a table so a user sees only some rows. Deeper: PostgreSQL policies, SQL Server security policies, Oracle VPD, Snowflake row access policies; owners and superusers can bypass unless forced. *Owner: I-14.*

<a id="data-masking"></a>
### data masking
Returning a disguised version of a value to users without the right to see it. Deeper: SQL Server Dynamic Data Masking, Snowflake masking policies; the stored value is unchanged. *Owner: I-14.*

<a id="tls"></a>
### TLS (Transport Layer Security)
The protocol that encrypts and authenticates a network connection (successor of SSL). Deeper: gives confidentiality, integrity and, with certificate verification, server authenticity. *Owner: I-14.*

<a id="certificate"></a>
### certificate
A public key plus an identity (host name) signed by a certificate authority. Deeper: clients verify the chain, the validity dates and the host name. *Owner: I-14.*

<a id="certificate-authority"></a>
### certificate authority (CA)
An organisation whose signature on certificates clients trust. Deeper: "verify-ca" checks the chain only, "verify-full" also checks the host name. *Owner: I-14.*

<a id="man-in-the-middle"></a>
### man-in-the-middle
An attacker who sits between client and server and relays or alters traffic. Deeper: encryption without certificate verification does not stop it. *Owner: I-14.*

<a id="encrypt-trustservercertificate"></a>
### Encrypt / TrustServerCertificate
SQL Server connection options: `Encrypt` (Optional, Mandatory, Strict) chooses encryption; `TrustServerCertificate=true` skips certificate validation. Deeper: Strict is TDS 8.0, TLS before the first protocol byte. *Owner: I-14.*

<a id="sslmode"></a>
### sslmode
PostgreSQL's TLS setting: `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`. Deeper: only `verify-full` prevents impersonation. *Owner: I-14.*

<a id="tde"></a>
### TDE (transparent data encryption)
Encryption of data files below the SQL layer, invisible to applications. Deeper: protects stolen disks and backups, not authorised users; the key must be stored elsewhere. *Owner: I-14.*

<a id="sql-injection"></a>
### SQL injection
Making a program run attacker-chosen SQL because input was glued into the statement text. Deeper: fixed by parameters for values and allowlists for identifiers. *Owner: I-14.* See also: parameterised query.

<a id="parameterised-query"></a>
### parameterised query
SQL text with placeholders, sent separately from the values (also called a prepared statement). Deeper: the parser sees values only as data; some drivers (MySqlConnector) escape client-side. *Owner: I-14.* See also: bind variable.

<a id="bind-variable"></a>
### bind variable
A placeholder in a statement filled in at execution time. Deeper: the placeholder syntax differs per dialect (`@name`, `:name`, `$1`, `?`, `{name:Type}`); chapter I-17 lists the styles. *Owner: I-14 (styles: I-17).*

<a id="audit"></a>
### audit
A tamper-resistant record of logins, changes and reads. Deeper: ship the log off the host; audit meaningfully, not everything. *Owner: I-14.*

## I-15 OLTP vs OLAP and columnar engines

<a id="oltp"></a>
### OLTP
Online transaction processing: many small reads and writes of a few whole rows. Deeper: wants low latency and ACID; row stores. *Owner: I-15.* See also: OLAP.

<a id="olap"></a>
### OLAP
Online analytical processing: few large queries that scan a few columns of many rows. Deeper: wants throughput; column stores, star schemas. *Owner: I-15.*

<a id="htap"></a>
### HTAP
Hybrid transactional and analytical processing: one system serves both. Deeper: usually two copies of the data (row and column) kept in sync. *Owner: I-15.*

<a id="row-store"></a>
### row store
Storage that keeps all fields of a row together. Deeper: best for fetching or updating whole rows. *Owner: I-15.*

<a id="column-store"></a>
### column store
Storage that keeps all values of one column together. Deeper: reads only needed columns, compresses well; costly for single-row access. *Owner: I-15.*

<a id="compression-rle-dictionary-delta"></a>
### compression (RLE / dictionary / delta)
Run-length encoding stores a value and its repeat count; dictionary encoding replaces values with small codes; delta encoding stores differences. Deeper: followed by LZ4 or ZSTD; ClickHouse `CODEC(Delta, ZSTD)`. *Owner: I-15.*

<a id="vectorised-execution"></a>
### vectorised execution
Operators process batches of values of one column at a time instead of one row. Deeper: fewer calls, cache-friendly, SIMD. *Owner: I-15.* See also: Volcano model (I-08).

<a id="late-materialisation"></a>
### late materialisation
Delaying the assembly of full rows until after filtering. Deeper: ClickHouse `PREWHERE`. *Owner: I-15.*

<a id="mergetree"></a>
### MergeTree
The main ClickHouse table engine family: sorted immutable parts merged in the background. Deeper: variants Replacing, Summing, Aggregating, Collapsing; `Replicated` prefix. *Owner: I-15.*

<a id="part"></a>
### part
An immutable, sorted chunk of a MergeTree table written by one insert or merge. Deeper: named `partition_minblock_maxblock_level`. *Owner: I-15.*

<a id="granule"></a>
### granule
The unit of ClickHouse's sparse index: by default 8,192 rows. Deeper: a query reads whole granules. *Owner: I-15.*

<a id="partition-clickhouse"></a>
### partition (ClickHouse)
A coarse split of a table (for example per month) used for data management and pruning. Deeper: parts never span partitions; too many partitions hurt. *Owner: I-15.*

<a id="merge"></a>
### merge
The background combination of small parts into larger ones. Deeper: causes write amplification; defines Replacing and Summing semantics. *Owner: I-15.*

<a id="mutation"></a>
### mutation
An asynchronous ClickHouse `ALTER TABLE … UPDATE/DELETE` that rewrites affected parts. Deeper: tracked in `system.mutations`; lightweight `DELETE` marks rows instead. *Owner: I-15.*

<a id="materialized-view-clickhouse"></a>
### materialized view (ClickHouse)
An insert trigger that runs a query on each inserted block and writes the result to a target table. Deeper: blind to rows that existed before and to updates and deletes. *Owner: I-15.*

<a id="dictionary-clickhouse"></a>
### dictionary (ClickHouse)
An in-memory key-to-attributes table refreshed from a source, read with `dictGet`. Deeper: replaces joins for small lookups; layouts such as `FLAT`. *Owner: I-15.*

<a id="projection-clickhouse"></a>
### projection (ClickHouse)
A hidden, differently sorted or pre-aggregated copy of data inside each part. Deeper: chosen automatically by the optimizer. *Owner: I-15.*

<a id="micro-partition"></a>
### micro-partition
Snowflake's immutable columnar storage file (about 50 to 500 MB uncompressed). Deeper: min/max metadata per column enables pruning. *Owner: I-15.*

<a id="virtual-warehouse"></a>
### virtual warehouse
A Snowflake compute cluster that you size, start and suspend independently of storage. Deeper: billed per second while running. *Owner: I-15.*

<a id="time-travel"></a>
### time travel
Querying or restoring data as it was in the past. Deeper: Snowflake keeps history for 1 to 90 days, then 7 days fail-safe. *Owner: I-15.*

<a id="stage"></a>
### stage
A named location for files used by `COPY INTO` (Snowflake). Deeper: internal or external (a cloud bucket). *Owner: I-15.*

<a id="stream-snowflake"></a>
### stream (Snowflake)
An object that records changes to a table since last consumed. Deeper: built-in change data capture. *Owner: I-15.*

<a id="task-snowflake"></a>
### task (Snowflake)
A scheduled or stream-triggered SQL statement. Deeper: tasks can form a dependency graph. *Owner: I-15.*

<a id="pipe"></a>
### pipe
A Snowflake object (Snowpipe) that loads files continuously as they arrive in a stage. Deeper: serverless compute. *Owner: I-15.*

<a id="star-schema"></a>
### star schema
A fact table surrounded by dimension tables. Deeper: denormalised dimensions; "snowflake schema" normalises them. *Owner: I-15.*

<a id="fact-dimension-table"></a>
### fact / dimension table
A fact table holds measurable events; dimension tables describe their context. Deeper: define the grain first; use surrogate keys and slowly changing dimensions. *Owner: I-15.*

<a id="data-warehouse"></a>
### data warehouse
A database organised for analysis and fed from operational systems. Deeper: ELT loads raw data first. *Owner: I-15.*

<a id="lakehouse"></a>
### lakehouse
A data lake of columnar files (Parquet) with a transactional table format (Iceberg, Delta, Hudi). Deeper: lets several engines query one copy with ACID guarantees. *Owner: I-15.*

<a id="columnstore"></a>
### columnstore
SQL Server's column-oriented index (clustered or nonclustered) stored in row groups. Deeper: batch mode, segment elimination, delta store, tuple mover. *Owner: I-15 (index view: I-07).*

## I-16 NoSQL families and their internals

<a id="nosql"></a>
### NoSQL
A loose label for non-relational databases built for scale, flexible schema or a specialised access pattern. Deeper: five families here plus NewSQL. *Owner: I-16.*

<a id="key-value-store"></a>
### key-value store
A database mapping a key to a value. Deeper: Redis values have types; access is by key. *Owner: I-16.*

<a id="document-store"></a>
### document store
A database of nested JSON-like documents. Deeper: MongoDB; embed or reference. *Owner: I-16.*

<a id="wide-column-store"></a>
### wide-column store
A database where a partition key leads to sorted rows with flexible columns. Deeper: Cassandra; not a column store in the OLAP sense. *Owner: I-16.*

<a id="search-engine"></a>
### search engine
A system built around an inverted index for relevance-ranked text search. Deeper: Elasticsearch, OpenSearch, Solr. *Owner: I-16.*

<a id="event-log"></a>
### event log
An append-only, ordered, replayable sequence of events. Deeper: Kafka. *Owner: I-16.*

<a id="bson"></a>
### BSON
MongoDB's binary JSON format with extra types. Deeper: `ObjectId`, `Decimal128`, dates, binary; 16 MiB document limit. *Owner: I-16.*

<a id="extended-json"></a>
### Extended JSON
A text form of BSON that preserves types (`{"$oid": …}`, `{"$numberLong": …}`). Deeper: canonical and relaxed modes. *Owner: I-16.*

<a id="_id"></a>
### _id
The unique primary key field of every MongoDB document. Deeper: defaults to an `ObjectId` (4-byte time, 5-byte random, 3-byte counter). *Owner: I-16.*

<a id="replica-set"></a>
### replica set
A MongoDB group of one primary and several secondaries holding the same data. Deeper: elections on failure; write concern controls durability. *Owner: I-16.*

<a id="oplog"></a>
### oplog
The capped collection (`local.oplog.rs`) of changes that secondaries replay. Deeper: entries are idempotent; change streams use it. *Owner: I-16.*

<a id="aggregation-pipeline"></a>
### aggregation pipeline
A MongoDB query as an array of stages (`$match`, `$group`, `$lookup`, …). Deeper: put `$match` and `$sort` first to use indexes. *Owner: I-16.*

<a id="change-stream"></a>
### change stream
A subscription to the changes of a MongoDB collection. Deeper: needs a replica set. *Owner: I-16.*

<a id="partition-key"></a>
### partition key
In Cassandra, the part of the primary key that decides which nodes store a row. Deeper: hashed to a token; queries must name it. *Owner: I-16.*

<a id="clustering-key"></a>
### clustering key
In Cassandra, the part of the primary key that orders rows inside a partition. Deeper: `CLUSTERING ORDER BY`. *Owner: I-16.*

<a id="token-ring"></a>
### token ring
Cassandra's hash space (−2⁶³ to 2⁶³−1) divided among nodes. Deeper: virtual nodes spread ownership. *Owner: I-16.*

<a id="replication-factor"></a>
### replication factor (RF)
The number of nodes that store each partition. Deeper: per keyspace; usually 3 in production. *Owner: I-16.*

<a id="consistency-level"></a>
### consistency level
How many replicas must respond to a Cassandra read or write. Deeper: `R + W > RF` gives strong consistency. *Owner: I-16.*

<a id="lsm-tree"></a>
### LSM tree
Log-structured merge tree: writes go to a log and an in-memory table, are flushed to immutable sorted files and merged later. Deeper: write amplification versus read amplification. *Owner: I-16.*

<a id="memtable"></a>
### memtable
A sorted in-memory table that receives writes before being flushed. Deeper: one per Cassandra table. *Owner: I-16.*

<a id="sstable"></a>
### SSTable
An immutable sorted file of data flushed from a memtable. Deeper: accompanied by index, summary and Bloom filter files. *Owner: I-16.*

<a id="compaction"></a>
### compaction
The background merging of SSTables. Deeper: size-tiered, leveled, time-window, unified. *Owner: I-16.*

<a id="tombstone"></a>
### tombstone
A marker that hides deleted data in an immutable-file store. Deeper: kept for `gc_grace_seconds` (10 days default); many tombstones slow reads. *Owner: I-16.*

<a id="commitlog"></a>
### commitlog
Cassandra's sequential write-ahead file for crash recovery. Deeper: periodic sync every 10 s by default. *Owner: I-16.*

<a id="inverted-index"></a>
### inverted index
A map from each term to the documents that contain it. Deeper: the basis of full-text search; scoring uses BM25. *Owner: I-16 (also I-07).*

<a id="analyzer"></a>
### analyzer
The pipeline that turns text into terms (character filters, tokenizer, token filters). Deeper: same analyzer at index and search time. *Owner: I-16.*

<a id="mapping"></a>
### mapping
The Elasticsearch declaration of a field's type and indexing. Deeper: `text` versus `keyword`; dynamic mapping guesses. *Owner: I-16.*

<a id="shard-replica-elasticsearch"></a>
### shard / replica (Elasticsearch)
A shard is one Lucene index holding part of an index; a replica is a copy. Deeper: primary shard count is fixed at creation. *Owner: I-16.*

<a id="segment"></a>
### segment
An immutable mini-index inside a Lucene shard. Deeper: deletes are marks; merges rewrite segments. *Owner: I-16.*

<a id="refresh"></a>
### refresh
Making buffered documents searchable by writing a new segment (default every 1 s). Deeper: why Elasticsearch is near-real-time. *Owner: I-16.*

<a id="seq-no-primary-term"></a>
### seq_no / primary_term
Elasticsearch counters returned on each write. Deeper: `if_seq_no` and `if_primary_term` give optimistic concurrency. *Owner: I-16.*

<a id="broker"></a>
### broker
A Kafka server. Deeper: partitions have a leader broker and follower replicas. *Owner: I-16.*

<a id="topic"></a>
### topic
A named stream of records in Kafka, split into partitions. Deeper: retention and compaction are per topic. *Owner: I-16.*

<a id="partition-kafka"></a>
### partition (Kafka)
An ordered append-only sequence of records within a topic. Deeper: order is guaranteed only within a partition; the key chooses the partition. *Owner: I-16.*

<a id="offset"></a>
### offset
The position of a record in its partition. Deeper: consumers commit offsets to `__consumer_offsets`. *Owner: I-16.*

<a id="consumer-group"></a>
### consumer group
Consumers sharing a `group.id` that split a topic's partitions. Deeper: one consumer per partition at a time; rebalances on membership change. *Owner: I-16.*

<a id="consumer-lag"></a>
### consumer lag
`log end offset − committed offset`: records not yet processed. Deeper: the main health signal of a consumer. *Owner: I-16.*

<a id="isr"></a>
### ISR (in-sync replicas)
The Kafka replicas that are caught up with the leader. Deeper: `acks=all` waits for the ISR; `min.insync.replicas` sets the floor. *Owner: I-16.*

<a id="retention"></a>
### retention
The rule that deletes old Kafka data by age or size (default 7 days). Deeper: independent of whether consumers read it. *Owner: I-16.*

<a id="log-compaction"></a>
### log compaction
A Kafka policy that keeps only the latest record per key. Deeper: a null value (tombstone) removes the key. *Owner: I-16.*

<a id="kraft"></a>
### KRaft
Kafka's built-in Raft quorum for metadata, replacing ZooKeeper (removed in Kafka 4.0). Deeper: controller nodes. *Owner: I-16.*

<a id="schema-registry"></a>
### Schema Registry
A service storing versioned schemas for Kafka messages and enforcing compatibility. Deeper: messages carry a magic byte and a 4-byte schema id. *Owner: I-16.*

<a id="resp"></a>
### RESP
Redis Serialization Protocol: prefixed, `\r\n`-framed types (`+ - : $ *`). Deeper: RESP2 is common; RESP3 adds maps and push. *Owner: I-16.*

<a id="sentinel"></a>
### Sentinel
Redis watcher processes that detect a failed primary and promote a replica. Deeper: quorum-based; one shard of data. *Owner: I-16.*

<a id="redis-cluster"></a>
### Redis Cluster
Redis horizontal scaling by 16,384 hash slots over several masters. Deeper: no strong consistency; `MOVED`/`ASK` redirects. *Owner: I-16.*

<a id="hash-slot"></a>
### hash slot
One of 16,384 buckets: `CRC16(key) mod 16384`. Deeper: hash tags `{…}` keep related keys together. *Owner: I-16.*

<a id="rdb-aof"></a>
### RDB / AOF
Redis persistence: RDB is a point-in-time snapshot, AOF a log of write commands. Deeper: `appendfsync always/everysec/no`. *Owner: I-16.*

<a id="ttl"></a>
### TTL (time to live)
A lifetime after which data expires automatically. Deeper: Redis `EXPIRE`, Cassandra TTL, MongoDB TTL index. *Owner: I-16.*

<a id="pub-sub"></a>
### pub/sub
Publish and subscribe messaging with no storage. Deeper: offline subscribers miss messages; use streams for durability. *Owner: I-16.*

<a id="newsql"></a>
### NewSQL / distributed SQL
Databases that keep SQL and ACID while scaling out through consensus-replicated ranges. Deeper: Spanner, CockroachDB, TiDB, YugabyteDB. *Owner: I-16.*

<a id="bloom-filter"></a>
### Bloom filter
A compact structure that says "definitely not present" or "maybe present". Deeper: false-positive rate about `(1 − e^(−kn/m))^k`. *Owner: I-16.*

<a id="hash-tag"></a>
### hash tag
The text inside `{…}` of a Redis key, the only part hashed to find the slot. Deeper: keeps related keys on one node. *Owner: I-16.*

<a id="avro"></a>
### Avro
A compact binary row format with an embedded or registered schema. Deeper: the usual Kafka format with the Schema Registry. *Owner: I-16.*

<a id="protobuf"></a>
### Protobuf
Protocol Buffers: Google's schema-based binary format. Deeper: field numbers allow evolution. *Owner: I-16.*

<a id="subject"></a>
### subject
The Schema Registry name under which versions of a schema are stored (usually `<topic>-value`). Deeper: has a compatibility mode. *Owner: I-16.*

## I-17 Dialect comparison

<a id="dialect"></a>
### dialect
One engine's variant of SQL. Deeper: differences in spelling, semantics and capability. *Owner: I-17.*

<a id="quoting"></a>
### quoting
Wrapping an identifier so special characters, spaces and reserved words are allowed. Deeper: `[ ]`, `" "` or backticks; the closing character is doubled to escape it. *Owner: I-17.*

<a id="case-folding"></a>
### case folding
Converting unquoted identifiers to one case. Deeper: upper in Oracle and Snowflake, lower in PostgreSQL and Cassandra, preserved elsewhere. *Owner: I-17.*

<a id="batch-separator"></a>
### batch separator
A client-side word that ends a group of statements sent together. Deeper: `GO` (SQL Server), `/` (Oracle), `DELIMITER` (MySQL); not understood by the server. *Owner: I-17.*

<a id="go"></a>
### GO
The SQL Server batch separator of SSMS and `sqlcmd`, optionally `GO n`. Deeper: variables do not cross it. *Owner: I-17.*

<a id="delimiter"></a>
### DELIMITER
The MySQL client command that changes the statement terminator. Deeper: needed around procedure bodies. *Owner: I-17.*

<a id="t-sql"></a>
### T-SQL
Transact-SQL, SQL Server's dialect and procedural language. Deeper: `@variables`, `TRY…CATCH`, `GO`. *Owner: I-17.*

<a id="pl-sql"></a>
### PL/SQL
Oracle's procedural language. Deeper: blocks, packages, `DBMS_OUTPUT`, ref cursors. *Owner: I-17.*

<a id="pl-pgsql"></a>
### PL/pgSQL
PostgreSQL's default procedural language. Deeper: bodies in `$$…$$`, `RAISE NOTICE`. *Owner: I-17.*

<a id="cql"></a>
### CQL
Cassandra Query Language: SQL-shaped, without joins and ad hoc filtering. Deeper: partition key required. *Owner: I-17.*

<a id="duckdb-sql"></a>
### DuckDB SQL
The PostgreSQL-style dialect of the embedded analytic engine DuckDB. Deeper: used inside Rowlit for linked databases. *Owner: I-17.*

<a id="auto-increment"></a>
### auto_increment
MySQL's column attribute that generates ascending integers. Deeper: read back with `LAST_INSERT_ID()`. *Owner: I-17.*

<a id="serial"></a>
### serial
PostgreSQL's older shorthand for an integer column with a sequence default. Deeper: replaced by identity columns. *Owner: I-17.*

<a id="identity-column"></a>
### identity column
A standard-SQL column whose values are generated. Deeper: `GENERATED … AS IDENTITY`; SQL Server `IDENTITY(1,1)`. *Owner: I-17 (also I-04).*

<a id="keyspace"></a>
### keyspace
Cassandra's top-level namespace holding tables and the replication settings. Deeper: acts like a database. *Owner: I-17.*

<a id="udt"></a>
### UDT (user-defined type)
A custom composite type. Deeper: Cassandra `address`, PostgreSQL composite types, SQL Server alias and table types. *Owner: I-17.*

<a id="warehouse"></a>
### warehouse
In Snowflake, the compute cluster that runs queries (see virtual warehouse). Deeper: must be running for `INFORMATION_SCHEMA` and data queries. *Owner: I-17 (see I-15).*

<a id="search-path"></a>
### search_path
PostgreSQL's ordered list of schemas used to resolve unqualified names. Deeper: default `"$user", public`. *Owner: I-17.*

<a id="information-schema"></a>
### information_schema
The standard set of metadata views. Deeper: in PostgreSQL, MySQL, SQL Server, Snowflake. *Owner: I-17.*

<a id="sys-catalog-views"></a>
### sys catalog views
SQL Server's catalog views (`sys.tables`, `sys.columns`, `sys.objects`). Deeper: richer than `INFORMATION_SCHEMA`. *Owner: I-17.*

<a id="pg-catalog"></a>
### pg_catalog
PostgreSQL's system catalog (`pg_class`, `pg_attribute`, `pg_namespace`). Deeper: what `psql` reads. *Owner: I-17.*

<a id="all-views"></a>
### ALL_* views
Oracle's dictionary views: `USER_*` (yours), `ALL_*` (visible to you), `DBA_*` (everything). Deeper: `V$` views show the running instance. *Owner: I-17.*

<a id="sqlite-master"></a>
### sqlite_master
SQLite's table of schema objects (also `sqlite_schema`). Deeper: combined with `pragma_*` functions. *Owner: I-17.*

<a id="system-tables"></a>
### system.* tables
ClickHouse's metadata and monitoring tables (`system.tables`, `system.parts`, `system.query_log`). Deeper: read-only views of server state. *Owner: I-17.*

<a id="system-schema"></a>
### system_schema
Cassandra's keyspace of schema tables (`keyspaces`, `tables`, `columns`). Deeper: partitioned by keyspace. *Owner: I-17.*
