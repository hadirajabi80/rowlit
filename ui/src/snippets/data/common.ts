// Snippets every SQL dialect shares (CQL gets the subset Cassandra supports). A dialect's own snippet with the same
// prefix replaces the shared one (see ensureBuiltins in ../builtins.ts).
import type { Dialect } from '../../api/types';
import { CAT, defs, type SnippetDef } from '../builtins';

const NOT_CQL: Dialect[] = ['tsql', 'plsql', 'sqlite', 'pgsql', 'mysql', 'clickhouse', 'snowflake'];
const WITH_INDEXES: Dialect[] = ['tsql', 'plsql', 'sqlite', 'pgsql', 'mysql', 'cql'];

const all = defs(null);
const notCql = defs(NOT_CQL);
const withIndexes = defs(WITH_INDEXES);

export const COMMON: SnippetDef[] = [
  all('sel', 'SELECT … FROM', CAT.Q, 'Select columns from a table.', 'SELECT ${1:*}\nFROM ${2:my_table}$0'),
  all('selw', 'SELECT … FROM … WHERE', CAT.Q, 'Select with a filter.', 'SELECT ${1:*}\nFROM ${2:my_table}\nWHERE ${3:condition}$0'),
  all('selc', 'SELECT COUNT(*)', CAT.Q, 'Count the rows of a table.', 'SELECT COUNT(*)\nFROM ${1:my_table}$0'),
  notCql('cte', 'Common table expression', CAT.Q, 'WITH … AS (…) SELECT.', 'WITH ${1:cte} AS (\n\tSELECT ${2:*}\n\tFROM ${3:my_table}\n)\nSELECT *\nFROM ${1:cte}$0'),
  notCql('join', 'JOIN … ON', CAT.Q, 'Join clause with aliases.', 'JOIN ${1:my_table} ${2:t} ON ${2:t}.${3:id} = ${4:other}.${5:id}$0'),
  notCql('case', 'CASE WHEN … END', CAT.Q, 'Searched CASE expression.', 'CASE\n\tWHEN ${1:condition} THEN ${2:result}\n\tELSE ${3:other}\nEND$0'),
  all('ins', 'INSERT INTO … VALUES', CAT.D, 'Insert one row.', 'INSERT INTO ${1:my_table} (${2:columns})\nVALUES (${3:values})$0'),
  all('upd', 'UPDATE … SET … WHERE', CAT.D, 'Update rows matching a filter.', 'UPDATE ${1:my_table}\nSET ${2:my_column} = ${3:value}\nWHERE ${4:condition}$0'),
  all('del', 'DELETE FROM … WHERE', CAT.D, 'Delete rows matching a filter.', 'DELETE FROM ${1:my_table}\nWHERE ${2:condition}$0'),
  withIndexes('idx', 'CREATE INDEX', CAT.L, 'Non-unique index on one column.', 'CREATE INDEX ${1:IX_name} ON ${2:my_table} (${3:my_column});$0'),
];
