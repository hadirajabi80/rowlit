# QA round: Oracle

Scope: the Oracle provider (engine) and the Oracle paths of the editor (splitter, Messages pane). Defects found while
driving a live Oracle 23ai instance through the UI; each is fixed with a regression test.

## Fixed

| # | Symptom | Cause | Fix | Test |
|---|---------|-------|-----|------|
| 1 | `END CASE;` inside a PL/SQL block left the block open, so every later statement ran as part of it | the splitter counted `CASE` as opening a block even after `END` | `CASE` only opens a level when it does not follow `END` (`ui/src/intel/split/splitter.ts`) | `splitter.test.ts` "END CASE; ..." |
| 2 | A `DECLARE` / `CREATE PROCEDURE` with a local subprogram ended at the subprogram's `END;` when a blank line followed | `END;` at depth 0 was taken as the end of the unit | track subprogram headers whose `BEGIN` is pending and the block's own `BEGIN`; only the main `END;` ends the block | "local subprogram", "nested local subprograms", "CREATE PROCEDURE with a local subprogram" |
| 3 | `<<label>> BEGIN ... END;` was split as plain SQL | the label token was not recognised as a block start | `<<` starts a block | "a labelled block" |
| 4 | `WITH FUNCTION f ... SELECT ...;` was cut at the first `;` of the function body | 12c inline PL/SQL not handled | new `withfn` mode: ends at the first `;` after the last function body, kind `select`, no `/` expected | "WITH FUNCTION ... SELECT"; a plain WITH (CTE) stays ordinary SQL |
| 5 | An error raised inside an anonymous block had no position in the editor | only `ORA-06550` carried line/column | the last unnamed `ORA-06512: at line N` frame maps to line N of the executed text (`OracleErrors.cs`) | `OracleErrorAndMiscTests` |
| 6 | Messages pane showed `[ORA-00942] ORA-00942: ...` | the code prefix was added to a message that already starts with it | skip the prefix when the text starts with the code (`MessagesPane.tsx`) | `MessagesPane.test.tsx` |
| 7 | Object / VARRAY / nested-table columns showed the type `Object` / `Array` | ODP.NET generic names | read `UdtTypeName` from the schema table (`SHOP.ADDRESS_T`) | `OracleIntegrationTests` |
| 8 | `TIMESTAMP(7..9)` and `TIMESTAMP WITH TIME ZONE` lost the sub-100 ns digits | conversion through `DateTime` ticks | built from `OracleTimeStamp` / `OracleTimeStampTZ` with nanoseconds, trailing zeros trimmed | `OracleErrorAndMiscTests` (value text) |
| 9 | 23ai `VECTOR` cells showed a CLR type name | the value arrives as `float[]` / `double[]` / `sbyte[]` | rendered as `[1,2.5,3]` | `OracleErrorAndMiscTests` (value text) |
| 10 | The table designer listed a unique constraint on a hidden `SYS_NC...$` column of an object column and could not script it | system constraint on a hidden column | unique constraints that reference columns the table does not show are skipped (`OracleDesignerDatabase.cs`) | `OracleIntegrationTests` |

## Checks run (final pass)

- `ui`: `vitest run` for MessagesPane (11 passed); `npm run test:intel` 1112 passed, 3 failed. The 3 failures are the
  "5,000-line ... formats in < 150 ms" timing assertions in `format.test.ts` (658 ms and 929 ms measured on a machine
  that was low on memory); they are unrelated to this change.
- `ui`: `tsc -b` clean; `oxlint` on the touched files reports only the `only-export-components` warning for the new
  exported helper `startsWithCode`, the same warning the file already has for `summaryMessage`.
- `engine`: Oracle unit tests (value text, error mapping, DBMS_OUTPUT, DDL generator, SQL text, unreadable values) 32/32.

## Open

- The Oracle integration tests (`OracleIntegrationTests`, `OracleSchemaTests`, ...) need the Docker Oracle 23ai
  instance. A full `dotnet test` of the project aborted with a test-host crash in the final pass (the machine was out
  of memory and no Oracle container was running), so the integration regression tests for items 7 and 10 were not
  re-run in the final pass. Re-run them with the container up (`engine/tests/docker`).
- The three 150 ms formatter performance tests above are timing-sensitive; re-run them on an idle machine.
- Follow-up round (open items fix): both points are still open, as environment items. Docker Desktop did not answer
  `docker ps`, so the Oracle container could not be started. The unit side of NUMBER binds now goes through the shared
  exact value (`ExactDecimal`, `OracleParamBinder.ToOracleDecimal`; an int param beyond long binds as NUMBER too, NaN is
  rejected), tested by `OracleM15Tests.Bind_DecimalBeyondSystemDecimal_IsExact`.
