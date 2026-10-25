// CQL (Apache Cassandra 3.11 / 4.x / 5.x, ScyllaDB). Bodies are Monaco snippet syntax; map literals use plain braces.
// Cassandra has no joins, subqueries, CTEs or stored procedures: the Programmability group is UDFs, UDAs and triggers.
// DESCRIBE, CONSISTENCY, TRACING and COPY are cqlsh commands (Rowlit runs them through its CQL support where available).
import { CAT as C, defs, type SnippetDef } from '../builtins';

const s = defs(['cql']);

export const SNIPPETS: SnippetDef[] = [
  // ------------------------------------------------------------------ Query
  s('top', 'SELECT … LIMIT n', C.Q, 'First n rows (a full scan: fine for exploring, not for production queries).', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nLIMIT ${3:100}$0'),
  s('selpk', 'SELECT by partition key + clustering range', C.Q, 'The efficient query shape: one partition, a slice of its clustering order.', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:value}\n\tAND ${5:ck} >= ${6:start}\n\tAND ${5:ck} < ${7:end}\nLIMIT ${8:100}$0'),
  s('selin', 'SELECT … WHERE pk IN (…)', C.Q, 'Several partitions in one query (keep the list short: the coordinator fans out).', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} IN (${4:v1, v2, v3})$0'),
  s('ord', 'ORDER BY clustering column', C.Q, 'Only the clustering order (or its reverse) within one partition.', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:value}\nORDER BY ${5:ck} DESC\nLIMIT ${6:10}$0'),
  s('token', 'Token-range paging', C.Q, 'Walk the whole table in partition order, a page at a time.', 'SELECT ${1:pk}, ${2:col}\nFROM ${3:my_ks.my_table}\nWHERE token(${1:pk}) > token(${4:last_pk})\nLIMIT ${5:1000}$0'),
  s('ppl', 'PER PARTITION LIMIT', C.Q, 'The first n rows of every partition (Cassandra 3.6+).', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nPER PARTITION LIMIT ${3:1}\nLIMIT ${4:100}$0'),
  s('allowf', 'ALLOW FILTERING (warning: full scan)', C.Q, 'Filters on non-key columns by reading every row; avoid on large tables, prefer an index or a second table.', 'SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:non_key_col} = ${4:value}\nALLOW FILTERING$0'),
  s('cont', 'CONTAINS / CONTAINS KEY', C.Q, 'Collection membership (needs a secondary index on the collection).', "SELECT ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:tags} CONTAINS ${4:'value'}$0"),
  s('ttl', 'TTL() and WRITETIME()', C.Q, 'Remaining time to live and write timestamp (microseconds) of a column.', 'SELECT ${1:col}, TTL(${1:col}) AS ttl_s, WRITETIME(${1:col}) AS written_us\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:value}$0'),
  s('seljson', 'SELECT JSON', C.Q, 'Return each row as a JSON document.', 'SELECT JSON ${1:*}\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:value}$0'),
  s('agg', 'count / min / max / avg / sum', C.Q, 'Aggregates over a partition (over a whole table they scan everything).', 'SELECT count(*), min(${1:col}), max(${1:col}), avg(${1:col}), sum(${1:col})\nFROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:value}$0'),
  s('grpk', 'GROUP BY partition / clustering prefix', C.Q, 'Aggregate per partition (Cassandra 3.10+); GROUP BY follows the key order.', 'SELECT ${1:pk}, count(*), max(${2:col})\nFROM ${3:my_ks.my_table}\nGROUP BY ${1:pk}$0'),
  s('funcs', 'now() / uuid() / toTimestamp()', C.Q, 'Time and id functions (timeuuid columns: minTimeuuid / maxTimeuuid for ranges).', 'SELECT now() AS id, uuid() AS random_id, toTimestamp(now()) AS ts, toUnixTimestamp(now()) AS epoch_ms\nFROM system.local$0'),

  // ------------------------------------------------------------------ DML
  s('insttl', 'INSERT … USING TTL', C.D, 'Row (or columns) expire after n seconds.', 'INSERT INTO ${1:my_ks.my_table} (${2:columns})\nVALUES (${3:value1})\nUSING TTL ${4:86400};$0'),
  s('insts', 'INSERT … USING TTL AND TIMESTAMP', C.D, 'Explicit write timestamp (microseconds) for last-write-wins control.', 'INSERT INTO ${1:my_ks.my_table} (${2:columns})\nVALUES (${3:value1})\nUSING TTL ${4:86400} AND TIMESTAMP ${5:1700000000000000};$0'),
  s('insjson', 'INSERT JSON', C.D, 'Insert a row from a JSON document.', `INSERT INTO \${1:my_ks.my_table} JSON '{"\${2:id}": \${3:1}, "\${4:name}": "\${5:a}"}';$0`),
  s('insine', 'INSERT … IF NOT EXISTS (LWT)', C.D, 'Lightweight transaction: insert only when the row is absent (Paxos; about 4x the latency).', 'INSERT INTO ${1:my_ks.my_table} (${2:columns})\nVALUES (${3:value1})\nIF NOT EXISTS;$0'),
  s('updttl', 'UPDATE … USING TTL', C.D, 'Update with an expiry.', 'UPDATE ${1:my_ks.my_table} USING TTL ${2:86400}\nSET ${3:col} = ${4:value}\nWHERE ${5:pk} = ${6:key_col};$0'),
  s('updif', 'UPDATE … IF (LWT)', C.D, 'Compare-and-set: apply only when the condition holds; the result row says [applied].', 'UPDATE ${1:my_ks.my_table}\nSET ${2:col} = ${3:new_value}\nWHERE ${4:pk} = ${5:key_col}\nIF ${2:col} = ${6:expected};$0'),
  s('updcol', 'UPDATE collections (set / list / map)', C.D, 'Add and remove elements without rewriting the collection.', "UPDATE ${1:my_ks.my_table}\nSET ${2:tags} = ${2:tags} + {${3:'new'}},\n\t${4:items} = ${4:items} + [${5:'x'}],\n\t${6:attrs}[${7:'k'}] = ${8:'v'}\nWHERE ${9:pk} = ${10:key_col};$0"),
  s('ctr', 'UPDATE counter', C.D, 'Increment or decrement a counter column (counter tables only).', 'UPDATE ${1:my_ks.counters}\nSET ${2:hits} = ${2:hits} + ${3:1}\nWHERE ${4:id} = ${5:key_col};$0'),
  s('delcol', 'DELETE column(s)', C.D, 'Remove single columns (writes tombstones).', 'DELETE ${1:col} FROM ${2:my_ks.my_table}\nWHERE ${3:pk} = ${4:key_col};$0'),
  s('delrow', 'DELETE row / partition', C.D, 'Without a clustering key the whole partition is deleted.', 'DELETE FROM ${1:my_ks.my_table}\nWHERE ${2:pk} = ${3:key_col}\n\tAND ${4:ck} = ${5:value};$0'),
  s('delrng', 'DELETE a clustering range', C.D, 'One range tombstone instead of many row tombstones.', 'DELETE FROM ${1:my_ks.my_table}\nWHERE ${2:pk} = ${3:key_col}\n\tAND ${4:ck} >= ${5:start}\n\tAND ${4:ck} < ${6:end};$0'),
  s('delif', 'DELETE … IF EXISTS (LWT)', C.D, 'Delete only when the row exists.', 'DELETE FROM ${1:my_ks.my_table}\nWHERE ${2:pk} = ${3:key_col}\nIF EXISTS;$0'),
  s('batch', 'BEGIN BATCH (logged)', C.D, 'Atomic across tables or partitions (atomicity, not performance).', 'BEGIN BATCH\n\tINSERT INTO ${1:my_ks.table_a} (${2:columns}) VALUES (${3:value1});\n\tINSERT INTO ${4:my_ks.table_b} (${5:columns}) VALUES (${6:value1});\nAPPLY BATCH;$0'),
  s('ubatch', 'BEGIN UNLOGGED BATCH (one partition)', C.D, 'Group writes to the same partition into one mutation; never batch across many partitions.', 'BEGIN UNLOGGED BATCH\n\tINSERT INTO ${1:my_ks.my_table} (${2:columns}) VALUES (${3:value1});\n\tINSERT INTO ${1:my_ks.my_table} (${2:columns}) VALUES (${4:value1});\nAPPLY BATCH;$0'),
  s('trunc', 'TRUNCATE', C.D, 'Remove all rows of a table.', 'TRUNCATE ${1:my_ks.my_table};$0'),

  // ------------------------------------------------------------------ DDL
  s('ks', 'CREATE KEYSPACE (SimpleStrategy)', C.L, 'Single data centre or development.', "CREATE KEYSPACE IF NOT EXISTS ${1:my_ks}\nWITH replication = {'class': 'SimpleStrategy', 'replication_factor': ${2:1}};$0"),
  s('ksnts', 'CREATE KEYSPACE (NetworkTopologyStrategy)', C.L, 'Replicas per data centre (production).', "CREATE KEYSPACE IF NOT EXISTS ${1:my_ks}\nWITH replication = {'class': 'NetworkTopologyStrategy', '${2:dc1}': ${3:3}, '${4:dc2}': ${5:3}}\nAND durable_writes = true;$0"),
  s('ksalter', 'ALTER KEYSPACE', C.L, 'Change replication, then run nodetool repair on every node.', "ALTER KEYSPACE ${1:my_ks}\nWITH replication = {'class': 'NetworkTopologyStrategy', '${2:dc1}': ${3:3}};$0"),
  s('tbl', 'CREATE TABLE (partition + clustering key)', C.L, 'Design the table around the query: partition key picks the node, clustering columns sort rows inside it.', 'CREATE TABLE IF NOT EXISTS ${1:my_ks.my_table} (\n\t${2:pk} uuid,\n\t${3:ck} timestamp,\n\t${4:value} text,\n\tPRIMARY KEY ((${2:pk}), ${3:ck})\n) WITH CLUSTERING ORDER BY (${3:ck} DESC);$0'),
  s('tblpk', 'CREATE TABLE (composite partition key)', C.L, 'Several columns form the partition key; spreads hot partitions.', 'CREATE TABLE IF NOT EXISTS ${1:my_ks.my_table} (\n\t${2:tenant} text,\n\t${3:bucket} int,\n\t${4:ts} timeuuid,\n\t${5:payload} text,\n\tPRIMARY KEY ((${2:tenant}, ${3:bucket}), ${4:ts})\n) WITH CLUSTERING ORDER BY (${4:ts} DESC);$0'),
  s('tblts', 'CREATE TABLE (time series, TWCS + TTL)', C.L, 'Time-window compaction and a default expiry for append-only data.', "CREATE TABLE IF NOT EXISTS ${1:my_ks.events} (\n\t${2:sensor_id} text,\n\t${3:day} date,\n\t${4:ts} timestamp,\n\t${5:value} double,\n\tPRIMARY KEY ((${2:sensor_id}, ${3:day}), ${4:ts})\n) WITH CLUSTERING ORDER BY (${4:ts} DESC)\n  AND default_time_to_live = ${6:2592000}\n  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 1};$0"),
  s('tblctr', 'CREATE TABLE (counters)', C.L, 'A table of counter columns cannot hold other non-key columns.', 'CREATE TABLE IF NOT EXISTS ${1:my_ks.counters} (\n\t${2:id} text PRIMARY KEY,\n\t${3:hits} counter\n);$0'),
  s('tblstat', 'CREATE TABLE (static column)', C.L, 'A static column is stored once per partition.', 'CREATE TABLE IF NOT EXISTS ${1:my_ks.my_table} (\n\t${2:pk} uuid,\n\t${3:ck} timestamp,\n\t${4:owner} text STATIC,\n\t${5:value} text,\n\tPRIMARY KEY ((${2:pk}), ${3:ck})\n);$0'),
  s('addcol', 'ALTER TABLE ADD column', C.L, 'Add a column to a table.', 'ALTER TABLE ${1:my_ks.my_table} ADD ${2:new_col} ${3:text};$0'),
  s('dropcol', 'ALTER TABLE DROP column', C.L, 'Drop a non-key column.', 'ALTER TABLE ${1:my_ks.my_table} DROP ${2:col};$0'),
  s('tblopt', 'ALTER TABLE WITH options (TTL, gc_grace, comment)', C.L, 'Table-level properties.', "ALTER TABLE ${1:my_ks.my_table}\nWITH default_time_to_live = ${2:0}\n  AND gc_grace_seconds = ${3:864000}\n  AND comment = '${4:description}';$0"),
  s('idxsai', 'CREATE CUSTOM INDEX (SAI)', C.L, 'Storage-attached index (Cassandra 5.0 / Astra / DSE): range and combined predicates.', "CREATE CUSTOM INDEX IF NOT EXISTS ${1:ix_name} ON ${2:my_ks.my_table} (${3:my_column}) USING 'StorageAttachedIndex';$0"),
  s('mv', 'CREATE MATERIALIZED VIEW', C.L, 'Server-maintained copy keyed differently; every key column must be IS NOT NULL.', 'CREATE MATERIALIZED VIEW IF NOT EXISTS ${1:my_ks.table_by_col} AS\n\tSELECT ${2:*}\n\tFROM ${3:my_ks.my_table}\n\tWHERE ${4:col} IS NOT NULL AND ${5:pk} IS NOT NULL\n\tPRIMARY KEY ((${4:col}), ${5:pk});$0'),
  s('udt', 'CREATE TYPE (user-defined type)', C.L, 'A reusable composite; use it as frozen<type> in tables.', 'CREATE TYPE IF NOT EXISTS ${1:my_ks.address} (\n\t${2:street} text,\n\t${3:city} text,\n\t${4:zip} int\n);\n-- column: ${5:home} frozen<address>$0'),
  s('drpif', 'DROP … IF EXISTS', C.L, 'Drop objects without failing when missing.', 'DROP TABLE IF EXISTS ${1:my_ks.my_table};\nDROP MATERIALIZED VIEW IF EXISTS ${2:my_ks.mv};\nDROP INDEX IF EXISTS ${3:my_ks.ix_name};$0'),

  // ------------------------------------------------------------------ Programmability
  s('udf', 'CREATE FUNCTION (UDF)', C.P, 'Needs enable_user_defined_functions in cassandra.yaml.', "CREATE OR REPLACE FUNCTION ${1:my_ks.fn_name} (${2:x} ${3:int})\nCALLED ON NULL INPUT\nRETURNS ${4:int}\nLANGUAGE java\nAS 'return ${2:x} == null ? null : ${2:x} * 2;';$0"),
  s('uda', 'CREATE AGGREGATE (UDA)', C.P, 'State function + optional final function.', 'CREATE OR REPLACE AGGREGATE ${1:my_ks.agg_name} (${2:int})\nSFUNC ${3:state_fn}\nSTYPE ${4:int}\nINITCOND ${5:0};$0'),
  s('trig', 'CREATE TRIGGER', C.P, 'Attach a Java trigger class (deployed on every node).', "CREATE TRIGGER IF NOT EXISTS ${1:trg_name} ON ${2:my_ks.my_table} USING '${3:com.example.MyTrigger}';$0"),
  s('lwtb', 'Conditional batch (LWT, one partition)', C.P, 'Compare-and-set across several rows of the same partition.', "BEGIN BATCH\n\tUPDATE ${1:my_ks.my_table} SET ${2:balance} = ${3:90} WHERE ${4:pk} = ${5:key_col} AND ${6:ck} = ${7:'a'} IF ${2:balance} = ${8:100};\n\tINSERT INTO ${1:my_ks.my_table} (${4:pk}, ${6:ck}, ${2:balance}) VALUES (${5:key_col}, ${9:'b'}, ${10:10});\nAPPLY BATCH;$0"),

  // ------------------------------------------------------------------ DBA / admin
  s('ver', 'Version, cluster and data centre', C.A, 'Release, cluster name and where this node lives.', 'SELECT release_version, cluster_name, data_center, rack, cql_version, host_id\nFROM system.local', true),
  s('ksl', 'List keyspaces and replication', C.A, 'Every keyspace with its strategy.', 'SELECT keyspace_name, durable_writes, replication\nFROM system_schema.keyspaces', true),
  s('tbls', 'List tables of a keyspace', C.A, 'Tables with their main properties.', "SELECT table_name, default_time_to_live, gc_grace_seconds, compaction, comment\nFROM system_schema.tables\nWHERE keyspace_name = ${1:'my_ks'}", true),
  s('cols', 'Columns and keys of a table', C.A, 'Column kinds: partition_key, clustering, regular, static.', "SELECT column_name, kind, position, type, clustering_order\nFROM system_schema.columns\nWHERE keyspace_name = ${1:'my_ks'} AND table_name = ${2:'my_table'}", true),
  s('idxs', 'Indexes and materialized views', C.A, 'Secondary indexes and views of a keyspace.', "SELECT table_name, index_name, kind, options\nFROM system_schema.indexes\nWHERE keyspace_name = ${1:'my_ks'};\nSELECT view_name, base_table_name\nFROM system_schema.views\nWHERE keyspace_name = ${1:'my_ks'};$0", true),
  s('types', 'User-defined types and functions', C.A, 'UDTs, functions and aggregates of a keyspace.', "SELECT type_name, field_names, field_types FROM system_schema.types WHERE keyspace_name = ${1:'my_ks'};\nSELECT function_name, argument_types, return_type FROM system_schema.functions WHERE keyspace_name = ${1:'my_ks'};$0", true),
  s('sizes', 'Table size estimates', C.A, 'Approximate partition count per table (system.size_estimates sums the token ranges of this node).', "SELECT table_name, SUM(partitions_count) AS approx_partitions\nFROM system.size_estimates\nWHERE keyspace_name = ${1:'my_ks'}\nGROUP BY keyspace_name, table_name", true),
  s('peers', 'Cluster peers', C.A, 'The other nodes this node knows about.', 'SELECT peer, data_center, rack, release_version, host_id\nFROM system.peers_v2', true),
  s('clients', 'Connected clients (4.0+)', C.A, 'Virtual table of client connections.', 'SELECT address, port, username, driver_name, driver_version, request_count\nFROM system_views.clients', true),
  s('settings', 'Node configuration (4.0+)', C.A, 'Virtual table of cassandra.yaml settings.', 'SELECT name, value\nFROM system_views.settings', true),
  s('pools', 'Thread pools (4.0+)', C.A, 'Active, pending and blocked tasks per stage.', 'SELECT name, active_tasks, pending_tasks, completed_tasks, blocked_tasks\nFROM system_views.thread_pools', true),
  s('tracing', 'TRACING ON', C.A, 'Show the coordinator and replica steps of the next requests (cqlsh).', 'TRACING ON;\n$0'),
  s('cons', 'CONSISTENCY level', C.A, 'Set the consistency level for the session (cqlsh): ONE, QUORUM, LOCAL_QUORUM, ALL.', 'CONSISTENCY ${1:LOCAL_QUORUM};\nCONSISTENCY;$0'),
  s('desc', 'DESCRIBE (cqlsh)', C.A, 'The CREATE statements of a keyspace or table.', 'DESCRIBE KEYSPACES;\nDESCRIBE KEYSPACE ${1:my_ks};\nDESCRIBE TABLE ${2:my_ks.my_table};$0'),
  s('roles', 'CREATE ROLE and GRANT', C.A, 'A login role with read/write on one keyspace (requires authentication enabled).', "CREATE ROLE IF NOT EXISTS ${1:app_user} WITH PASSWORD = '${2:change_me}' AND LOGIN = true;\nGRANT SELECT ON KEYSPACE ${3:my_ks} TO ${1:app_user};\nGRANT MODIFY ON KEYSPACE ${3:my_ks} TO ${1:app_user};$0"),
  s('perms', 'LIST ROLES / PERMISSIONS', C.A, 'Who may do what.', 'LIST ROLES;\nLIST ALL PERMISSIONS OF ${1:app_user};$0'),
  s('nodetool', 'nodetool (command line)', C.A, 'Operational commands run in a shell on a node, not in CQL.', '-- nodetool status\n-- nodetool repair -pr ${1:my_ks}\n-- nodetool cfstats ${1:my_ks}.${2:my_table}\n-- nodetool compact ${1:my_ks} ${2:my_table}\n-- nodetool flush ${1:my_ks}$0'),
];
