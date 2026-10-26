namespace DbStudio.Federation.Materialize;

// WP-B fills this (plan-links 2): a JobManager job (kind "links.materialize") that runs ILinkRuntime.OpenQueryAsync and
// writes the reader into a writable target through Import's TargetWriter / ImportDialect (create / replace / append),
// reporting job.progress per batch; refuses read-only targets (403 READ_ONLY) and linked targets; preview = the DDL
// ImportDialect would run with the mapped columns.
internal static class MaterializeServicePlaceholder;
