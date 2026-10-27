# QA round: PostgreSQL

Scope: provider `engine/src/DbStudio.Providers.PostgreSql` (values, catalog, DDL, objects list, session) against a scratch
PostgreSQL 17 (own container, seed `seed-postgres.sql` plus a `qa` schema with enums, domains, composites, ranges, partitioned,
inherited and foreign tables, materialized views, `$$` functions, procedures, aggregates).

Method: engine REST/WebSocket driven (catalog, DDL, execute + rows), xunit integration tests compare every rendered value with
the server's own `expr::text`.

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Result values | wrong data | Arrays containing NULL (`{1,NULL}`, any element type) showed `(unsupported type integer[])`; so did `date[]`, `numeric[]`, `boolean[]` and multi-dimensional ones | fixed | `PgBinaryText.cs`, `PgTypes.ReadValue` | `PgValueTextTests.Value_RendersAsPostgreSqlText` |
| 2 | Result values | wrong data | `numeric` beyond 28 digits and `NaN` / `Infinity` showed `(unsupported type numeric)` (non-integral) or a lossy double; now the exact text | fixed | `PgTypes.ReadNumeric`, `PgBinaryText.Numeric` | `PgBinaryTextUnitTests.Numeric_*`, `PgValueTextTests` |
| 3 | Result values | wrong data | `inet` lost its mask (`10.0.0.1/24` shown as `10.0.0.1`); MAC addresses shown without colons | fixed | `PgTypes.ReadValue` | `PgValueTextTests` |
| 4 | Result values | wrong data | `daterange`/`tsrange`/`tstzrange` formatted with the current culture (`[1/1/2025 12:00:00 AM,...)`); multiranges and arrays of ranges likewise | fixed | `PgTypes.ReadValue` | `PgValueTextTests` |
| 5 | Result values | wrong data | `'infinity'::date` showed `9999-12-31`, `-infinity` timestamps `0001-01-01`; dates before year 1 / after 9999 showed `(unsupported type date)`; `24:00:00` showed `1.00:00:00` | fixed | `PgTypes.ReadValue`, `PgBinaryText.Date/Timestamp/TimeOfDay` | `PgBinaryTextUnitTests.Date_*`, `Timestamp_*`, `TimeOfDay_*`, `PgValueTextTests` |
| 6 | Result values | wrong data | `ROW(...)` records arrived as `{a,1}` (array literal) instead of `(a,1)` | fixed | `PgTypes.ReadValue` | `PgValueTextTests` |
| 7 | Result values | failed operation | A type or extension created in the session was unknown to Npgsql until reconnect (values unreadable); types are now reloaded after `CREATE/ALTER/DROP TYPE/DOMAIN/EXTENSION` | fixed | `PgSession.OnBatchCompletedAsync`, `DefinesTypes` | `PgValueTextTests.TypeCreatedInTheSession_IsReadableRightAway`, `DefinesTypes_DetectsTypeDdl` |
| 8 | DDL | wrong data | `CREATE MATERIALIZED VIEW ... WITH NO DATA` was scripted `WITH DATA` (running the DDL would populate it) | fixed | `PgDdlGenerator.ViewDdl`, `RelationInfo` | `PgPartitionCatalogTests.Ddl_ScriptsPartitions_...` |
| 9 | DDL | wrong data | Tables with `INHERITS` were scripted as standalone tables; partitions were scripted as plain tables (no `PARTITION OF ... FOR VALUES`); a partitioned table did not list its partitions | fixed | `PgDdlGenerator.Generate`, `ReadTableDefinitionAsync` | `PgPartitionCatalogTests` |
| 10 | Explorer | broken workflow | Triggers cloned onto hidden partitions were listed once per partition (`trg on measurements_2025`...) | fixed | `PgCatalogQueries.Triggers`, `PgDependencyQueries` | `PgPartitionCatalogTests.Triggers_...` |
| 11 | Explorer | broken workflow | PostgreSQL trigger names are per table: a name used on several tables (very common, e.g. `set_updated_at`) always resolved to the first table (DDL, dependencies). Duplicates are now listed as `name on table` and resolved back | fixed | `PgCatalogQueries.TriggerDisplayName`, `FindTrigger` (both readers) | `PgPartitionCatalogTests.Triggers_...` |
| 12 | Objects tab | UX | Partitioned tables showed size 0 and no row estimate; now the sum over the leaf partitions | fixed | `PgDependencyQueries.ListRelations` | `PgPartitionCatalogTests.ObjectList_...` |
| 13 | Result values | wrong data | Named composite types (`CREATE TYPE ... AS (...)`) and arrays of them still show `(unsupported type ...)`: Npgsql cannot read unmapped composites at all (not even as a stream). The placeholder now says how to view the value (`"col"::text`) | left (driver limitation): Npgsql chooses binary result formats in Bind, before the row description says a column is a composite; reading it as text needs a describe round trip before every statement or a second execution (side effects, twice the work), both worse than the placeholder | `PgTypes.ReadValue` | n/a |
| 14 | Result values | UX | `timetz` shows `10:20:30+05:00`, PostgreSQL prints `10:20:30+05`. Now decoded from the wire value like the server prints it; editing such a cell binds the text untyped (the `time` bind has no zone) | fixed | `PgTypes.ReadValue`, `PgBinaryText.TimeTz`, `ui/src/data/sqlgen.ts` `paramKindFor` | `PgBinaryTextUnitTests.TimeTz_Text`, `sqlgen.pgsql.test.ts` |
| 15 | Parameters | edge | A `numeric` parameter above 28 digits or `NaN` cannot be bound (System.Decimal); only matters when such a column is edited in the grid. Now an exact value (shared `ExactDecimal`): integers bind as numeric from a BigInteger, other values and NaN / Infinity as untyped text the server reads as a numeric literal | fixed | `PgParamBinder.CreateParameter`, `engine/src/DbStudio.Core/Params/ExactDecimal.cs` (shared) | `PgUnitTests.Types_NumericBeyondSystemDecimal_IsBoundExactly`, `ExactDecimalTests` |
| 16 | Explorer | UX | Extension-owned functions (postgres_fdw, range-type constructors, ...) are listed with user routines. The catalog now marks routines owned by an extension (`pg_depend` deptype `e`) or made for a range type (deptype `i`) with a group (wire `g`); the explorer lists them in a collapsed sub-folder per owner ("Extension postgres_fdw", "Range type constructors"). Completion and search still see them | fixed | `PgCatalogQueries.RoutineGroup`, `CatalogObject.Group` / `CatalogWire` (shared), `ui/src/components/Explorer/tree.ts` | `CatalogWireTests.OwnedRoutines_CarryTheirExplorerGroup`, `ui/src/components/Explorer/routineGroups.test.ts` |

Not covered: the UI could not be driven end to end this round (the machine ran out of memory and Docker Desktop stopped
answering); UI vitest/lint were not affected (no UI file changed).

Shared code touched: none (provider only).
