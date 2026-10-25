// SQLite 3.35+ (window functions, UPSERT, RETURNING, JSON1; UPDATE … FROM needs 3.33, ->> needs 3.38).
// Bodies are Monaco snippet syntax; `\$` is a literal dollar (JSON paths).
import { CAT as C, defs, type SnippetDef } from '../builtins';

const s = defs(['sqlite']);

export const SNIPPETS: SnippetDef[] = [
  // ------------------------------------------------------------------ Query
  s('top', 'SELECT … LIMIT n', C.Q, 'First n rows (add an ORDER BY for a stable result).', 'SELECT ${1:*}\nFROM ${2:my_table}\nORDER BY ${3:id}\nLIMIT ${4:100}$0'),
  s('selj', 'SELECT with INNER JOIN', C.Q, 'Two tables joined on a key.', 'SELECT ${1:a}.*, ${2:b}.${3:name}\nFROM ${4:orders} AS ${1:a}\nINNER JOIN ${5:customers} AS ${2:b} ON ${2:b}.${6:id} = ${1:a}.${7:customer_id}\nWHERE ${8:1 = 1}$0'),
  s('sellj', 'LEFT JOIN, rows without a match', C.Q, 'Anti-join: rows of the left table with no related row.', 'SELECT ${1:a}.*\nFROM ${2:customers} AS ${1:a}\nLEFT JOIN ${3:orders} AS ${4:b} ON ${4:b}.${5:customer_id} = ${1:a}.${6:id}\nWHERE ${4:b}.${5:customer_id} IS NULL$0'),
  s('grp', 'GROUP BY with HAVING', C.Q, 'Aggregate per group and filter the groups.', 'SELECT ${1:category}, COUNT(*) AS cnt, SUM(${2:amount}) AS total\nFROM ${3:sales}\nGROUP BY ${1:category}\nHAVING COUNT(*) > ${4:1}\nORDER BY total DESC$0'),
  s('cterec', 'WITH RECURSIVE (hierarchy)', C.Q, 'Walk a parent/child table from the roots down.', 'WITH RECURSIVE tree(id, parent_id, name, lvl) AS (\n\tSELECT ${1:id}, ${2:parent_id}, ${3:name}, 0\n\tFROM ${4:categories}\n\tWHERE ${2:parent_id} IS NULL\n\tUNION ALL\n\tSELECT c.${1:id}, c.${2:parent_id}, c.${3:name}, t.lvl + 1\n\tFROM ${4:categories} AS c\n\tJOIN tree AS t ON c.${2:parent_id} = t.id\n)\nSELECT * FROM tree$0'),
  s('rown', 'ROW_NUMBER() per group', C.Q, 'Number the rows of each partition (window functions: 3.25+).', 'SELECT *, ROW_NUMBER() OVER (PARTITION BY ${1:group_col} ORDER BY ${2:created_at} DESC) AS rn\nFROM ${3:my_table}$0'),
  s('rank', 'RANK / DENSE_RANK / NTILE', C.Q, 'Ranking window functions.', 'SELECT ${1:name}, ${2:score},\n\tRANK() OVER (ORDER BY ${2:score} DESC) AS rnk,\n\tDENSE_RANK() OVER (ORDER BY ${2:score} DESC) AS dense_rnk,\n\tNTILE(${3:4}) OVER (ORDER BY ${2:score} DESC) AS bucket\nFROM ${4:results}$0'),
  s('lag', 'LAG / LEAD', C.Q, 'Previous and next value in an ordered partition.', 'SELECT ${1:id}, ${2:amount},\n\tLAG(${2:amount}) OVER (PARTITION BY ${3:customer_id} ORDER BY ${4:order_date}) AS prev_value,\n\tLEAD(${2:amount}) OVER (PARTITION BY ${3:customer_id} ORDER BY ${4:order_date}) AS next_value\nFROM ${5:orders}$0'),
  s('runtot', 'Running total', C.Q, 'Cumulative SUM over an ordered window.', 'SELECT ${1:order_date}, ${2:amount},\n\tSUM(${2:amount}) OVER (ORDER BY ${1:order_date}, ${3:id} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total\nFROM ${4:orders}$0'),
  s('pivot', 'Pivot with CASE', C.Q, 'Rows to columns for a fixed list of values.', "SELECT ${1:category},\n\tSUM(CASE WHEN ${2:year} = ${3:2023} THEN ${4:amount} END) AS y${3:2023},\n\tSUM(CASE WHEN ${2:year} = ${5:2024} THEN ${4:amount} END) AS y${5:2024}\nFROM ${6:sales}\nGROUP BY ${1:category}$0"),
  s('page', 'Pagination (LIMIT / OFFSET)', C.Q, 'Page n of a sorted result.', 'SELECT ${1:*}\nFROM ${2:my_table}\nORDER BY ${3:id}\nLIMIT ${4:50} OFFSET (${5:1} - 1) * ${4:50}$0'),
  s('keyset', 'Keyset pagination', C.Q, 'Next page after the last key seen; stays fast on deep pages.', 'SELECT ${1:*}\nFROM ${2:my_table}\nWHERE ${3:id} > ${4:0}\nORDER BY ${3:id}\nLIMIT ${5:50}$0'),
  s('exists', 'WHERE EXISTS', C.Q, 'Rows that have a related row.', 'SELECT *\nFROM ${1:customers} AS ${2:c}\nWHERE EXISTS (\n\tSELECT 1 FROM ${3:orders} AS o WHERE o.${4:customer_id} = ${2:c}.${5:id}\n)$0'),
  s('notex', 'WHERE NOT EXISTS', C.Q, 'Rows that have no related row.', 'SELECT *\nFROM ${1:customers} AS ${2:c}\nWHERE NOT EXISTS (\n\tSELECT 1 FROM ${3:orders} AS o WHERE o.${4:customer_id} = ${2:c}.${5:id}\n)$0'),
  s('latest', 'Latest row per group', C.Q, 'Keep the newest row of each key (dedupe by selection).', 'SELECT *\nFROM (\n\tSELECT t.*, ROW_NUMBER() OVER (PARTITION BY ${1:key_col} ORDER BY ${2:updated_at} DESC) AS rn\n\tFROM ${3:my_table} AS t\n)\nWHERE rn = 1$0'),
  s('islands', 'Gaps and islands', C.Q, 'Group consecutive values into islands.', 'SELECT MIN(${1:id}) AS island_start, MAX(${1:id}) AS island_end, COUNT(*) AS len\nFROM (\n\tSELECT ${1:id}, ${1:id} - ROW_NUMBER() OVER (ORDER BY ${1:id}) AS grp\n\tFROM ${2:my_table}\n)\nGROUP BY grp\nORDER BY island_start$0'),
  s('cal', 'Date series (calendar)', C.Q, 'One row per day between two dates.', "WITH RECURSIVE d(dt) AS (\n\tSELECT date(${1:'2024-01-01'})\n\tUNION ALL\n\tSELECT date(dt, '+1 day') FROM d WHERE dt < date(${2:'2024-01-31'})\n)\nSELECT dt FROM d$0", true),
  s('daterng', 'Date range filter (half-open)', C.Q, 'Index-friendly [start, end) filter.', "WHERE ${1:created_at} >= ${2:'2024-01-01'}\n\tAND ${1:created_at} < ${3:'2024-02-01'}$0"),
  s('stragg', 'group_concat', C.Q, 'Concatenate values per group.', "SELECT ${1:group_col}, group_concat(${2:name}, ${3:', '}) AS names\nFROM ${4:my_table}\nGROUP BY ${1:group_col}$0"),
  s('json', 'json_extract / ->>', C.Q, 'Read fields from a JSON column.', "SELECT json_extract(${1:json_col}, '\\$.${2:path}') AS via_function,\n\t${1:json_col} ->> '\\$.${3:other}' AS via_operator\nFROM ${4:my_table}$0"),
  s('jsoneach', 'json_each (expand a JSON array)', C.Q, 'One row per array element.', "SELECT t.${1:id}, j.value\nFROM ${2:my_table} AS t, json_each(t.${3:json_col}, '\\$.${4:items}') AS j$0"),
  s('fts', 'Full-text search (FTS5 MATCH)', C.Q, 'Query an FTS5 virtual table, best matches first.', "SELECT *\nFROM ${1:docs}\nWHERE ${1:docs} MATCH ${2:'search terms'}\nORDER BY rank$0"),
  s('union', 'UNION ALL', C.Q, 'Stack two result sets.', 'SELECT ${1:columns} FROM ${2:a}\nUNION ALL\nSELECT ${1:columns} FROM ${3:b}$0'),

  // ------------------------------------------------------------------ DML
  s('insel', 'INSERT … SELECT', C.D, 'Insert the result of a query.', 'INSERT INTO ${1:target} (${2:columns})\nSELECT ${3:columns}\nFROM ${4:source}\nWHERE ${5:1 = 1};$0'),
  s('insmulti', 'INSERT multiple rows', C.D, 'Row constructor.', "INSERT INTO ${1:my_table} (${2:col1, col2})\nVALUES (${3:1, 'a'}),\n\t(${4:2, 'b'}),\n\t(${5:3, 'c'});$0"),
  s('upsert', 'INSERT … ON CONFLICT DO UPDATE', C.D, 'Insert, or update the existing row with the same key.', 'INSERT INTO ${1:my_table} (${2:columns})\nVALUES (${3:value1})\nON CONFLICT (${4:key_col}) DO UPDATE SET ${5:my_column} = excluded.${5:my_column};$0'),
  s('insign', 'INSERT OR IGNORE', C.D, 'Skip rows that violate a constraint.', 'INSERT OR IGNORE INTO ${1:my_table} (${2:columns})\nVALUES (${3:value1});$0'),
  s('insrep', 'INSERT OR REPLACE', C.D, 'Replace the whole row on a key conflict (deletes the old row first).', 'INSERT OR REPLACE INTO ${1:my_table} (${2:columns})\nVALUES (${3:value1});$0'),
  s('ret', 'INSERT … RETURNING', C.D, 'Get the generated key back (3.35+).', 'INSERT INTO ${1:my_table} (${2:columns})\nVALUES (${3:value1})\nRETURNING ${4:*};$0'),
  s('updj', 'UPDATE … FROM (join)', C.D, 'Update from another table (3.33+).', 'UPDATE ${1:target}\nSET ${2:col} = s.${2:col}\nFROM ${3:source} AS s\nWHERE s.${4:id} = ${1:target}.${4:id};$0'),
  s('delj', 'DELETE rows that match another table', C.D, 'DELETE with a subquery.', 'DELETE FROM ${1:target}\nWHERE ${2:id} IN (SELECT ${2:id} FROM ${3:source} WHERE ${4:id = 1});$0'),
  s('dedel', 'Delete duplicates (keep one)', C.D, 'Keep the row with the lowest rowid per key.', 'DELETE FROM ${1:my_table}\nWHERE rowid NOT IN (SELECT MIN(rowid) FROM ${1:my_table} GROUP BY ${2:key_col});$0'),
  s('trunc', 'Empty a table', C.D, 'SQLite has no TRUNCATE: DELETE without a WHERE is optimised.', 'DELETE FROM ${1:my_table};\n-- DELETE FROM sqlite_sequence WHERE name = \'${1:my_table}\';  -- restart AUTOINCREMENT$0'),

  // ------------------------------------------------------------------ DDL
  s('tbl', 'CREATE TABLE', C.L, 'Table with an integer primary key.', 'CREATE TABLE ${1:name} (\n\t${2:id} INTEGER PRIMARY KEY,\n\t${3:name} TEXT NOT NULL\n);$0'),
  s('tblfk', 'CREATE TABLE with FK, default, CHECK', C.L, 'Foreign keys are enforced only with PRAGMA foreign_keys = ON.', "CREATE TABLE ${1:orders} (\n\t${2:id} INTEGER PRIMARY KEY AUTOINCREMENT,\n\t${3:customer_id} INTEGER NOT NULL REFERENCES ${4:customers} (id) ON DELETE CASCADE,\n\t${5:status} TEXT NOT NULL DEFAULT 'new',\n\t${6:amount} REAL NOT NULL CHECK (${6:amount} >= 0),\n\tcreated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);$0"),
  s('strict', 'CREATE TABLE … STRICT', C.L, 'Enforce column types (3.37+).', 'CREATE TABLE ${1:name} (\n\t${2:id} INTEGER PRIMARY KEY,\n\t${3:name} TEXT NOT NULL,\n\t${4:price} REAL\n) STRICT;$0'),
  s('addcol', 'ALTER TABLE ADD COLUMN', C.L, 'Add a column to a table.', 'ALTER TABLE ${1:my_table} ADD COLUMN ${2:new_col} ${3:TEXT};$0'),
  s('dropcol', 'ALTER TABLE DROP COLUMN', C.L, 'Drop a column (3.35+; not for keys or indexed columns).', 'ALTER TABLE ${1:my_table} DROP COLUMN ${2:col};$0'),
  s('ren', 'Rename a column or table', C.L, 'RENAME COLUMN / RENAME TO (3.25+).', 'ALTER TABLE ${1:my_table} RENAME COLUMN ${2:old_name} TO ${3:new_name};\n-- ALTER TABLE ${1:my_table} RENAME TO ${4:new_table};$0'),
  s('altcol', 'Rebuild a table (change a column)', C.L, 'SQLite cannot ALTER a column type: create, copy, drop, rename.', 'PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\nCREATE TABLE ${1:my_table}_new (\n\t${2:id} INTEGER PRIMARY KEY,\n\t${3:col} ${4:TEXT} NOT NULL\n);\nINSERT INTO ${1:my_table}_new (${2:id}, ${3:col}) SELECT ${2:id}, ${3:col} FROM ${1:my_table};\nDROP TABLE ${1:my_table};\nALTER TABLE ${1:my_table}_new RENAME TO ${1:my_table};\nCOMMIT;\nPRAGMA foreign_keys = ON;$0'),
  s('gen', 'Generated column', C.L, 'Virtual column computed from others (3.31+; ADD COLUMN supports VIRTUAL only).', "ALTER TABLE ${1:my_table} ADD COLUMN ${2:full_name} TEXT GENERATED ALWAYS AS (${3:first_name} || ' ' || ${4:last_name}) VIRTUAL;$0"),
  s('idxu', 'CREATE UNIQUE INDEX', C.L, 'Enforce uniqueness on one or more columns.', 'CREATE UNIQUE INDEX ${1:ux_name} ON ${2:my_table} (${3:my_column});$0'),
  s('idxp', 'CREATE INDEX (partial)', C.L, 'Index only the rows that match a predicate.', 'CREATE INDEX ${1:ix_name} ON ${2:my_table} (${3:my_column})\nWHERE ${4:active = 1};$0'),
  s('idxe', 'CREATE INDEX on an expression', C.L, 'Index a computed value, e.g. lower(email).', 'CREATE INDEX ${1:ix_name} ON ${2:my_table} (lower(${3:my_column}));$0'),
  s('view', 'CREATE VIEW', C.L, 'A named query.', 'CREATE VIEW IF NOT EXISTS ${1:v_name} AS\nSELECT ${2:*}\nFROM ${3:my_table};$0'),
  s('tmp', 'CREATE TEMP TABLE', C.L, 'Connection-scoped table.', 'CREATE TEMP TABLE ${1:tmp} (\n\t${2:id} INTEGER\n);$0'),
  s('fts5', 'CREATE VIRTUAL TABLE … USING fts5', C.L, 'Full-text index over text columns.', 'CREATE VIRTUAL TABLE ${1:docs} USING fts5(${2:title}, ${3:body});$0'),
  s('drpif', 'DROP … IF EXISTS', C.L, 'Drop objects without failing when missing.', 'DROP TABLE IF EXISTS ${1:my_table};\nDROP VIEW IF EXISTS ${2:v_name};\nDROP INDEX IF EXISTS ${3:ix_name};$0'),

  // ------------------------------------------------------------------ Programmability
  s('trg', 'CREATE TRIGGER', C.P, 'Row trigger skeleton.', 'CREATE TRIGGER ${1:trg_name}\nAFTER ${2:INSERT} ON ${3:my_table}\nFOR EACH ROW\nBEGIN\n\t$0\nEND;'),
  s('trgupd', 'updated_at trigger', C.P, 'Maintain an updated_at column (needs recursive_triggers off, the default).', "CREATE TRIGGER ${1:trg_updated_at}\nAFTER UPDATE ON ${2:my_table}\nFOR EACH ROW\nBEGIN\n\tUPDATE ${2:my_table} SET updated_at = datetime('now') WHERE rowid = NEW.rowid;\nEND;$0"),
  s('trgview', 'INSTEAD OF trigger on a view', C.P, 'Make a view writable.', 'CREATE TRIGGER ${1:trg_name}\nINSTEAD OF INSERT ON ${2:view_name}\nFOR EACH ROW\nBEGIN\n\tINSERT INTO ${3:my_table} (${4:col}) VALUES (NEW.${4:col});\nEND;$0'),
  s('tx', 'Transaction', C.P, 'BEGIN / COMMIT.', 'BEGIN TRANSACTION;\n$0\nCOMMIT;'),
  s('txi', 'BEGIN IMMEDIATE (write transaction)', C.P, 'Take the write lock up front to avoid SQLITE_BUSY upgrades.', 'BEGIN IMMEDIATE;\n$0\nCOMMIT;'),
  s('sp', 'Savepoint', C.P, 'Nested transaction.', 'SAVEPOINT ${1:sp};\n$0\nRELEASE ${1:sp};\n-- ROLLBACK TO ${1:sp};'),
  s('fkon', 'PRAGMA foreign_keys = ON', C.P, 'Foreign keys are off by default and must be enabled per connection.', 'PRAGMA foreign_keys = ON;$0'),

  // ------------------------------------------------------------------ DBA / admin
  s('schema', 'List tables, views, indexes', C.A, 'Everything in sqlite_master.', "SELECT type, name, tbl_name, sql\nFROM sqlite_master\nWHERE name NOT LIKE 'sqlite_%'\nORDER BY type, name;$0", true),
  s('tblinfo', 'Table columns (PRAGMA table_info)', C.A, 'Columns, types, defaults and primary key.', "SELECT * FROM pragma_table_info(${1:'table'});$0"),
  s('idxlist', 'Indexes of a table', C.A, 'Index names, uniqueness and origin.', "SELECT * FROM pragma_index_list(${1:'table'});$0"),
  s('fklist', 'Foreign keys of a table', C.A, 'Referenced tables and columns.', "SELECT * FROM pragma_foreign_key_list(${1:'table'});$0"),
  s('dbsize', 'Database size', C.A, 'Pages, page size and free pages.', 'SELECT page_count, page_size, page_count * page_size AS size_bytes, freelist_count\nFROM pragma_page_count(), pragma_page_size(), pragma_freelist_count();$0', true),
  s('integrity', 'PRAGMA integrity_check', C.A, 'Verify the database file ("ok" when healthy).', 'PRAGMA integrity_check;$0', true),
  s('fkcheck', 'PRAGMA foreign_key_check', C.A, 'Rows that violate a foreign key.', 'PRAGMA foreign_key_check;$0', true),
  s('vacuum', 'VACUUM / ANALYZE / optimize', C.A, 'Rebuild the file, refresh statistics.', 'VACUUM;\nANALYZE;\nPRAGMA optimize;$0'),
  s('wal', 'Journal mode (WAL)', C.A, 'Write-ahead logging allows readers during a write.', 'PRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;$0'),
  s('ver', 'SQLite version', C.A, 'Library version and compile options.', 'SELECT sqlite_version() AS version;\n-- SELECT * FROM pragma_compile_options;', true),
  s('explain', 'EXPLAIN QUERY PLAN', C.A, 'Show how SQLite will run the query.', 'EXPLAIN QUERY PLAN\n$0'),
  s('attach', 'ATTACH DATABASE', C.A, 'Query a second database file.', "ATTACH DATABASE ${1:'other.db'} AS ${2:other};\nSELECT * FROM ${2:other}.${3:my_table};$0"),
];
