using System.Text;
using DbStudio.Core.Services;
using StackExchange.Redis;

namespace DbStudio.Sources.Redis.Services;

/// <summary>
/// Byte-exact transport of hash / list / set / sorted-set elements whose bytes are not valid UTF-8. The text of such an
/// element is its display form (<c>\xHH</c> for each invalid byte, a literal backslash written <c>\x5c</c>); the real bytes
/// travel next to it, base64, in a map keyed by that text (<c>bin</c> of a response, of an edit request). Valid UTF-8 never
/// appears in the map, so ordinary values are untouched. A client that sends back a text found in the map (to delete, to
/// keep as a field name, to restore) writes those exact bytes.
/// </summary>
internal sealed class BinaryText
{
    private Dictionary<string, string>? _map;

    /// <summary>The map to put on a response (null when every element was valid text).</summary>
    public Dictionary<string, string>? Map => _map;

    /// <summary>Text of one reply element; remembers the bytes when they are not valid UTF-8.</summary>
    public string Text(RedisResult r)
    {
        if (r.IsNull || r.Resp2Type == ResultType.Integer) return Resp.Text(r);
        var bytes = (byte[]?)r ?? [];
        if (RedisArgs.IsValidUtf8(bytes)) return Encoding.UTF8.GetString(bytes);
        var text = RedisArgs.ToDisplay(bytes, escapeBackslash: true);
        (_map ??= new Dictionary<string, string>(StringComparer.Ordinal))[text] = Convert.ToBase64String(bytes);
        return text;
    }

    /// <summary>The command argument for a text of a request: the bytes of <paramref name="bin"/> when it lists the text, the text itself otherwise.</summary>
    public static object Arg(string text, IReadOnlyDictionary<string, string>? bin)
    {
        if (bin is null || !bin.TryGetValue(text, out var b64)) return text;
        try
        {
            return Convert.FromBase64String(b64);
        }
        catch (FormatException)
        {
            throw EngineException.Validation("bin holds a value that is not base64.", new { field = "bin" });
        }
    }
}
