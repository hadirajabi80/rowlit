using System.Text;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests;

/// <summary>The wizard pages through a file's preview: rows from Offset, HasNextPage, inference always from the start.</summary>
public sealed class PreviewPagingTests : IDisposable
{
    private readonly Harness _h = new();
    private readonly TempDir _d = new();

    public void Dispose() { _h.Dispose(); _d.Dispose(); }

    private string File(int rows)
    {
        var sb = new StringBuilder("id,name\n");
        for (var i = 1; i <= rows; i++) sb.Append(i).Append(",n").Append(i).Append('\n');
        return _d.File("rows.csv", sb.ToString());
    }

    private Task<PreviewResult> Page(string path, int offset, int size) =>
        _h.Service.PreviewAsync(new PreviewRequest { Path = path, MaxRows = size, Offset = offset }, default);

    [Fact]
    public async Task Pages_start_at_the_offset_and_report_a_next_page()
    {
        var path = File(120);
        var p0 = await Page(path, 0, 50);
        Assert.Equal(50, p0.Rows.Count);
        Assert.Equal("1", p0.Rows[0][0]);
        Assert.Equal(0, p0.Offset);
        Assert.True(p0.HasNextPage);

        var p2 = await Page(path, 100, 50);
        Assert.Equal(20, p2.Rows.Count);
        Assert.Equal("101", p2.Rows[0][0]);
        Assert.Equal(100, p2.Offset);
        Assert.False(p2.HasNextPage);
        // Types come from the same sample whatever the page.
        Assert.Equal(p0.Columns.Select(c => c.Inferred.Kind), p2.Columns.Select(c => c.Inferred.Kind));
    }

    [Fact]
    public async Task Pages_beyond_the_inference_sample_still_return_rows()
    {
        var path = File(5000);
        var p = await Page(path, 4000, 50);
        Assert.Equal(50, p.Rows.Count);
        Assert.Equal("4001", p.Rows[0][0]);
        Assert.True(p.HasNextPage);
        Assert.True(p.MoreRows);
    }

    [Fact]
    public async Task An_exact_last_page_has_no_next_page()
    {
        var p = await Page(File(100), 50, 50);
        Assert.Equal(50, p.Rows.Count);
        Assert.False(p.HasNextPage);
    }
}
