namespace DbStudio.Federation.Provider;

// WP-A fills this (plan-links 2): IDbSession of a link, query-only (ReadOnlyGuard: non-queries → READ_ONLY; TxMode stays
// Auto, SetTransactionModeAsync(Manual) / Commit / Rollback / ChangeDatabaseAsync → NotSupportedException, so the UI's
// providerLevels hasTransactions('linked') = false matches). ExecuteAsync per batch: analyse (Pushdown/QueryAnalyzer) →
// fetch every needed table in parallel per source into the session's IFederationEngine (cached per session until
// "Refresh sources") → run the SQL on the engine → stream rows to the sink through ValueConverter.ToWire. Messages:
// one Info per source ("crm.customers: 1,204 rows from SQL Server in 120 ms"), Warnings from the plan (row cap…).
// Cancel = cancel every running fetch (DbCommand.Cancel) + IFederationEngine.Interrupt(), < 1 s. Temp directory
// <DataDir>/tmp/links/<sessionId> is deleted on dispose.
internal static class FederatedSessionPlaceholder;
