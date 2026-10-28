using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Import.Generate;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests.Generate;

/// <summary>
/// Generates thousands of rows into the Docker sample servers (SQL Server, PostgreSQL, MySQL, MariaDB, Oracle, ClickHouse):
/// a parent and a child table are created, the child references the parent, both are filled and checked. Skipped (not
/// failed) when DBSTUDIO_IT=0 or the server is not running.
/// </summary>
public sealed class DockerGenerateTests : IDisposable
{
    private readonly Harness _h = new();
    public void Dispose() => _h.Dispose();

    [SkippableTheory]
    [MemberData(nameof(Target.All), MemberType = typeof(Target))]
    public async Task Parent_and_child_tables_are_filled_with_valid_rows(Target t)
    {
        Skip.IfNot(t.Reachable(), $"{t.Name} is not reachable (start engine/tests/docker/compose.yml or set DBSTUDIO_IT=0).");
        var cid = _h.AddConnection(t.Profile(), t.Password);
        var d = ImportDialect.For(_h.Providers.Get(t.ProviderId).Dialect, t.ProviderId);
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var parent = d.Fold("gen_parent_" + suffix);
        var child = d.Fold("gen_child_" + suffix);
        var qParent = d.Qualify(t.Database, t.Schema, parent);
        var qChild = d.Qualify(t.Database, t.Schema, child);
        var hasFk = t.ProviderId != "clickhouse";
        string Col(string n) => d.Quote(d.Fold(n));
        NewColumnSpec C(string n, InferredType type, bool nullable = true) => new(d.Fold(n), d.SqlType(type), nullable);

        try
        {
            await _h.ExecAsync(cid, d.CreateTable(qParent,
                [C("id", new InferredType(Kinds.Int), false), C("name", new InferredType(Kinds.Text, 80)), C("email", new InferredType(Kinds.Text, 120)), C("active", new InferredType(Kinds.Bool))],
                [d.Fold("id")]), t.Database);
            await _h.ExecAsync(cid, d.CreateTable(qChild,
                [C("id", new InferredType(Kinds.Int), false), C("parent_id", new InferredType(Kinds.Int), false), C("amount", new InferredType(Kinds.Decimal, null, 12, 2)),
                 C("created", new InferredType(Kinds.DateTime)), C("note", new InferredType(Kinds.Text, 200))],
                [d.Fold("id")]), t.Database);
            if (hasFk)
                await _h.ExecAsync(cid, $"ALTER TABLE {qChild} ADD CONSTRAINT {d.Quote(d.Fold("fk_" + suffix))} FOREIGN KEY ({Col("parent_id")}) REFERENCES {qParent} ({Col("id")})", t.Database);
            await _h.Catalog.RefreshAsync(cid, t.Database, t.Schema is null ? null : [t.Schema], default);

            var parentPlan = await _h.Generate.PlanAsync(cid, t.Database, t.Schema, parent, default);
            Assert.True(parentPlan.CanGenerate);
            Assert.Equal("sequence", parentPlan.Columns.First(c => string.Equals(c.Name, d.Fold("id"), StringComparison.OrdinalIgnoreCase)).Generator);
            Assert.Equal("email", parentPlan.Columns.First(c => string.Equals(c.Name, d.Fold("email"), StringComparison.OrdinalIgnoreCase)).Generator);

            var s = await Run(new GenerateRequest { ConnectionId = cid, Database = t.Database, Schema = t.Schema, Table = parent, Rows = 500, Seed = 11, Columns = parentPlan.Columns.ToList() });
            Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error} {string.Join("; ", s.ErrorsSample.Select(e => e.Message))}");
            Assert.Equal(500, s.RowsWritten);
            Assert.Equal(500L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {qParent}", t.Database)));

            var childPlan = await _h.Generate.PlanAsync(cid, t.Database, t.Schema, child, default);
            var parentCol = childPlan.Columns.First(c => string.Equals(c.Name, d.Fold("parent_id"), StringComparison.OrdinalIgnoreCase));
            if (hasFk)
            {
                Assert.Equal("foreignKey", parentCol.Generator);
            }
            else
            {
                parentCol.Generator = "int";
                parentCol.Options = new() { ["min"] = "1", ["max"] = "500" };
            }
            var childReq = new GenerateRequest { ConnectionId = cid, Database = t.Database, Schema = t.Schema, Table = child, Rows = 10_000, Seed = 12, Columns = childPlan.Columns.ToList() };
            var preview = await _h.Generate.PreviewAsync(childReq, default);
            Assert.Equal(20, preview.Rows.Count);

            s = await Run(childReq);
            Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error} {string.Join("; ", s.ErrorsSample.Select(e => e.Message))}");
            Assert.Equal(10_000, s.RowsWritten);
            Assert.Equal(10_000L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {qChild}", t.Database)));
            Assert.Equal(10_000L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(DISTINCT {Col("id")}) FROM {qChild}", t.Database)));
            Assert.Equal(0L, Convert.ToInt64(await _h.ScalarAsync(cid,
                $"SELECT COUNT(*) FROM {qChild} c WHERE NOT EXISTS (SELECT 1 FROM {qParent} p WHERE p.{Col("id")} = c.{Col("parent_id")})", t.Database)));

            // Truncate and repeat: exactly the requested rows remain.
            childReq.TruncateFirst = true;
            childReq.Rows = 100;
            s = await Run(childReq);
            Assert.True(s.Outcome == "completed", $"{t.Name}: {s.Outcome} {s.Error}");
            Assert.Equal(100L, Convert.ToInt64(await _h.ScalarAsync(cid, $"SELECT COUNT(*) FROM {qChild}", t.Database)));
        }
        finally
        {
            foreach (var table in new[] { qChild, qParent })
            {
                try { await _h.ExecAsync(cid, d.DropTable(table), t.Database); }
                catch (Exception) { /* best effort cleanup */ }
            }
        }
    }

    private async Task<GenerateSummary> Run(GenerateRequest req)
    {
        var jobId = _h.Generate.Start(req, null);
        await _h.Jobs.WaitAsync(jobId);
        var done = _h.Events.Done(jobId) ?? throw new InvalidOperationException("The job did not finish.");
        if (done.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"Job {done.Status}: {done.Error}");
        return done.Result!.Value.Deserialize<GenerateSummary>(CoreJson.Options)!;
    }
}
