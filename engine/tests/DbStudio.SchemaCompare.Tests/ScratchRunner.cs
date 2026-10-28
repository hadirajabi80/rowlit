using System.Text;
using DbStudio.Core.Models;
using DbStudio.Core.SchemaCompare;
using DbStudio.Core.Services;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>
/// What an integration test creates in a scratch pair of schemas and expects from the comparison. <see cref="Expected"/> maps item id
/// ("table:customers") to its status; every other item must be identical.
/// </summary>
public sealed record Scratch(
    ConnectionProfile Connection,
    string? Database,
    string SourceSchema,
    string TargetSchema,
    Func<string, IEnumerable<string>> SourceDdl,
    Func<string, IEnumerable<string>> TargetDdl,
    Func<string, IEnumerable<string>> Cleanup,
    IReadOnlyDictionary<string, string> Expected,
    CompareEndpoint? SourceEndpoint = null,
    CompareEndpoint? TargetEndpoint = null,
    ConnectionProfile? TargetConnection = null);

public static class ScratchRunner
{
    /// <summary>Creates the schemas, compares, checks the statuses, applies the whole script and checks the re-compare is identical.</summary>
    public static async Task<(CompareResult First, CompareScript Script)> RunAsync(CompareEnv env, Scratch s)
    {
        await env.TryExecAsync(s.Connection, s.Database, s.Cleanup(s.SourceSchema).Concat(s.Cleanup(s.TargetSchema)));
        try
        {
            await env.ExecAsync(s.Connection, s.Database, s.SourceDdl(s.SourceSchema));
            await env.ExecAsync(s.TargetConnection ?? s.Connection, s.Database, s.TargetDdl(s.TargetSchema));

            var source = s.SourceEndpoint ?? new CompareEndpoint(s.Connection.Id, s.Database, s.SourceSchema);
            var target = s.TargetEndpoint ?? new CompareEndpoint((s.TargetConnection ?? s.Connection).Id, s.Database, s.TargetSchema);
            var first = await env.Service.CompareNowAsync(new CompareRequest(source, target, null), CancellationToken.None);
            var id = first.CompareId;

            var differing = first.Items.Where(i => i.Status != CompareStatus.Identical).ToList();
            var actual = differing.ToDictionary(i => i.Id.ToLowerInvariant(), i => i.Status);
            var expected = s.Expected.ToDictionary(kv => kv.Key.ToLowerInvariant(), kv => kv.Value);
            var script = await env.Service.ScriptAsync(id, null, CancellationToken.None);
            var report = Describe(first, script);
            foreach (var (key, status) in expected)
                Assert.True(actual.TryGetValue(key, out var got) && got == status, $"{key}: expected {status}, got {(actual.TryGetValue(key, out var g) ? g : "identical")}\n{report}");
            foreach (var key in actual.Keys.Except(expected.Keys))
                Assert.Fail($"{key} should be identical but is {actual[key]}\n{report}");

            var applied = await env.Service.ApplyAsync(id, new CompareApplyRequest(null, true), null, CancellationToken.None);
            Assert.True(applied.Ok, $"apply failed: {string.Join("; ", applied.Failures.Select(f => f.Message + " <- " + f.Sql))}\n{report}");

            var second = await env.Service.CompareNowAsync(new CompareRequest(source, target, null), CancellationToken.None);
            var left = second.Items.Where(i => i.Status != CompareStatus.Identical).ToList();
            Assert.True(left.Count == 0, "differences after applying the script: " + string.Join("; ", left.Select(i => $"{i.Id} {i.Status} [{string.Join(", ", i.Changes)}]")) + "\n" + report);
            return (first, script);
        }
        finally
        {
            await env.TryExecAsync(s.Connection, s.Database, s.Cleanup(s.SourceSchema).Concat(s.Cleanup(s.TargetSchema)));
        }
    }

    public static string Describe(CompareResult result, CompareScript script)
    {
        var sb = new StringBuilder();
        foreach (var i in result.Items.Where(i => i.Status != CompareStatus.Identical))
            sb.Append($"  {i.Status,-6} {i.Id}  [{string.Join(" | ", i.Changes)}]\n");
        sb.Append("--- script ---\n").Append(script.Text);
        foreach (var w in script.Warnings) sb.Append($"\n  ! {w.Severity}: {w.ItemId}: {w.Message}");
        return sb.ToString();
    }
}
