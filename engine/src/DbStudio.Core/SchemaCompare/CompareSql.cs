using System.Text;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Core.Sql;

namespace DbStudio.Core.SchemaCompare;

/// <summary>
/// SQL text helpers of the schema compare: normalisation of routine / view / trigger bodies for the "ignore whitespace /
/// case / comments" options, splitting of the CREATE header (so a body compares without its name and CREATE OR ALTER /
/// OR REPLACE / DEFINER noise), rewriting of schema qualifiers and statement splitting.
/// </summary>
internal static partial class CompareSql
{
    private enum PieceKind { Ws, Comment, Str, QIdent, Word, Punct }

    private readonly record struct Piece(PieceKind Kind, int Start, int End);

    private static bool IsWordChar(char c) => char.IsLetterOrDigit(c) || c is '_' or '$' or '#' or '@';

    /// <summary>Splits text into whitespace, comments, string literals, quoted identifiers, words and punctuation. Never throws.</summary>
    private static List<Piece> Scan(string s, Dialect d)
    {
        var list = new List<Piece>(s.Length / 4 + 4);
        var i = 0;
        var n = s.Length;
        while (i < n)
        {
            var c = s[i];
            var start = i;
            if (char.IsWhiteSpace(c))
            {
                while (i < n && char.IsWhiteSpace(s[i])) i++;
                list.Add(new Piece(PieceKind.Ws, start, i));
            }
            else if ((c == '-' && i + 1 < n && s[i + 1] == '-') || (c == '#' && DialectInfo.HashLineComments(d)))
            {
                while (i < n && s[i] != '\n' && s[i] != '\r') i++;
                list.Add(new Piece(PieceKind.Comment, start, i));
            }
            else if (c == '/' && i + 1 < n && s[i + 1] == '*')
            {
                var depth = 1;
                i += 2;
                while (i < n && depth > 0)
                {
                    if (s[i] == '*' && i + 1 < n && s[i + 1] == '/') { depth--; i += 2; }
                    else if (DialectInfo.NestedBlockComments(d) && s[i] == '/' && i + 1 < n && s[i + 1] == '*') { depth++; i += 2; }
                    else i++;
                }
                list.Add(new Piece(PieceKind.Comment, start, i));
            }
            else if (c == '\'')
            {
                i++;
                while (i < n)
                {
                    if (s[i] == '\\' && DialectInfo.BackslashStringEscapes(d) && i + 1 < n) { i += 2; continue; }
                    if (s[i] == '\'')
                    {
                        if (i + 1 < n && s[i + 1] == '\'') { i += 2; continue; }
                        i++;
                        break;
                    }
                    i++;
                }
                list.Add(new Piece(PieceKind.Str, start, i));
            }
            else if (c == '"' || (c == '`' && DialectInfo.BacktickIdentifiers(d)) || (c == '[' && d == Dialect.TSql))
            {
                var close = c == '[' ? ']' : c;
                i++;
                while (i < n)
                {
                    if (s[i] == close)
                    {
                        if (i + 1 < n && s[i + 1] == close) { i += 2; continue; }
                        i++;
                        break;
                    }
                    i++;
                }
                list.Add(new Piece(PieceKind.QIdent, start, i));
            }
            else if (c == '$' && DialectInfo.DollarQuotedStrings(d) && TryDollarTag(s, i, out var tagEnd))
            {
                i = tagEnd;
                list.Add(new Piece(PieceKind.Word, start, i));
            }
            else if (IsWordChar(c))
            {
                while (i < n && IsWordChar(s[i])) i++;
                list.Add(new Piece(PieceKind.Word, start, i));
            }
            else
            {
                i++;
                list.Add(new Piece(PieceKind.Punct, start, i));
            }
        }
        return list;
    }

    private static bool TryDollarTag(string s, int i, out int end)
    {
        end = i;
        var j = i + 1;
        if (j < s.Length && (char.IsLetter(s[j]) || s[j] == '_'))
        {
            while (j < s.Length && (char.IsLetterOrDigit(s[j]) || s[j] == '_')) j++;
        }
        if (j < s.Length && s[j] == '$') { end = j + 1; return true; }
        return false;
    }

    /// <summary>
    /// Canonical form of a body for comparison. Whitespace: collapsed to nothing/one space between tokens (or kept, line
    /// endings normalised); case: words and quoted identifiers upper-cased, string literals untouched; comments: dropped
    /// (or kept). A trailing ";" / "GO" / "/" never counts.
    /// </summary>
    public static string Normalize(string? sql, Dialect d, bool ignoreWhitespace, bool ignoreCase, bool ignoreComments)
    {
        if (string.IsNullOrWhiteSpace(sql)) return "";
        var text = sql.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var pieces = Scan(text, d);
        var sb = new StringBuilder(text.Length);
        var prevEndsWord = false;
        foreach (var p in pieces)
        {
            var piece = text[p.Start..p.End];
            switch (p.Kind)
            {
                case PieceKind.Ws:
                    if (!ignoreWhitespace) sb.Append(piece);
                    continue;
                case PieceKind.Comment:
                    if (ignoreComments) continue;
                    if (ignoreWhitespace && sb.Length > 0 && sb[^1] != ' ') sb.Append(' ');
                    sb.Append(ignoreWhitespace ? piece.Trim() : piece.TrimEnd());
                    if (ignoreWhitespace) sb.Append(' ');
                    prevEndsWord = false;
                    continue;
            }
            if (p.Kind == PieceKind.Str)
            {
                if (ignoreWhitespace && prevEndsWord) sb.Append(' ');
                sb.Append(piece);
                prevEndsWord = true;
            }
            else
            {
                var token = ignoreCase && p.Kind is PieceKind.Word or PieceKind.QIdent ? piece.ToUpperInvariant() : piece;
                var startsWord = p.Kind is PieceKind.Word or PieceKind.QIdent;
                if (ignoreWhitespace && prevEndsWord && startsWord) sb.Append(' ');
                sb.Append(token);
                prevEndsWord = startsWord;
            }
        }
        var result = sb.ToString().Trim();
        while (result.EndsWith(';') || result.EndsWith('/') && result.Length > 1 && result[^2] == '\n')
            result = result.TrimEnd(';').TrimEnd('/').TrimEnd();
        if (result.EndsWith("\nGO", StringComparison.OrdinalIgnoreCase)) result = result[..^3].TrimEnd();
        return result;
    }

    // ------------------------------------------------------------------ CREATE header

    /// <param name="Kind">Upper-case object keyword: "PROCEDURE", "FUNCTION", "TRIGGER", "VIEW", "PACKAGE BODY"... or "" when none was found.</param>
    /// <param name="CreateStart">Offset of the CREATE keyword.</param>
    /// <param name="HasOrAlter">The header already is CREATE OR ALTER / OR REPLACE.</param>
    /// <param name="NameStart">Offset where the (qualified) object name starts, -1 when none.</param>
    /// <param name="RestStart">Offset just after the qualified object name: the parameters / body start here.</param>
    public readonly record struct CreateHeader(string Kind, int CreateStart, bool HasOrAlter, int NameStart, int RestStart);

    private static readonly HashSet<string> ObjectWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "PROCEDURE", "PROC", "FUNCTION", "TRIGGER", "VIEW", "SEQUENCE", "PACKAGE", "TYPE", "TABLE", "AGGREGATE", "SYNONYM",
    };

    public static CreateHeader ParseHeader(string ddl, Dialect d)
    {
        var tokens = SqlTokenizer.Tokenize(ddl, d);
        var i = tokens.FindIndex(t => t.IsWord("CREATE"));
        if (i < 0) return new CreateHeader("", -1, false, -1, 0);
        var hasOr = false;
        var j = i + 1;
        var limit = Math.Min(tokens.Count, i + 40);
        while (j < limit && !(tokens[j].Kind == SqlTokenKind.Word && ObjectWords.Contains(tokens[j].Value)))
        {
            if (tokens[j].IsWord("OR") && j + 1 < tokens.Count && (tokens[j + 1].IsWord("ALTER") || tokens[j + 1].IsWord("REPLACE"))) hasOr = true;
            j++;
        }
        if (j >= limit) return new CreateHeader("", tokens[i].Start, hasOr, -1, 0);
        var kind = tokens[j].Value.ToUpperInvariant();
        j++;
        if (kind == "PACKAGE" && j < tokens.Count && tokens[j].IsWord("BODY")) { kind = "PACKAGE BODY"; j++; }
        if (kind == "TYPE" && j < tokens.Count && tokens[j].IsWord("BODY")) { kind = "TYPE BODY"; j++; }
        if (j + 2 < tokens.Count && tokens[j].IsWord("IF") && tokens[j + 1].IsWord("NOT") && tokens[j + 2].IsWord("EXISTS")) j += 3;
        if (j >= tokens.Count || !tokens[j].IsIdentifier) return new CreateHeader(kind, tokens[i].Start, hasOr, -1, tokens[Math.Min(j, tokens.Count - 1)].Start);
        var nameStart = tokens[j].Start;
        var end = tokens[j].End;
        while (j + 2 < tokens.Count && tokens[j + 1].IsPunct('.') && tokens[j + 2].IsIdentifier)
        {
            j += 2;
            end = tokens[j].End;
        }
        return new CreateHeader(kind, tokens[i].Start, hasOr, nameStart, end);
    }

    /// <summary>The DDL without its CREATE prefix and object name: kind + everything after the name. Falls back to the whole text.</summary>
    public static string CanonicalBody(string ddl, Dialect d, out string kind)
    {
        var h = ParseHeader(ddl, d);
        kind = h.Kind;
        if (h.Kind.Length == 0 || h.NameStart < 0) return ddl;
        return ddl[h.RestStart..];
    }

    /// <summary>"CREATE PROCEDURE x" → "CREATE OR ALTER PROCEDURE x" (no change when the header already has OR ALTER / OR REPLACE).</summary>
    public static string WithOrReplace(string ddl, Dialect d, string clause)
    {
        var h = ParseHeader(ddl, d);
        if (h.CreateStart < 0 || h.HasOrAlter) return ddl;
        const int createLength = 6;
        return ddl[..(h.CreateStart + createLength)] + " " + clause + ddl[(h.CreateStart + createLength)..];
    }

    /// <summary>The table a trigger fires on (the qualified name after the first ON), or null.</summary>
    public static (string? Schema, string Table)? TriggerTable(string ddl, Dialect d)
    {
        var tokens = SqlTokenizer.Tokenize(ddl, d);
        var h = ParseHeader(ddl, d);
        for (var i = 0; i < tokens.Count; i++)
        {
            if (tokens[i].Start < Math.Max(h.RestStart, 0) || !tokens[i].IsWord("ON")) continue;
            var j = i + 1;
            if (j >= tokens.Count || !tokens[j].IsIdentifier) return null;
            var parts = new List<string> { tokens[j].Value };
            while (j + 2 < tokens.Count && tokens[j + 1].IsPunct('.') && tokens[j + 2].IsIdentifier)
            {
                parts.Add(tokens[j + 2].Value);
                j += 2;
            }
            return parts.Count > 1 ? (parts[^2], parts[^1]) : (null, parts[0]);
        }
        return null;
    }

    // ------------------------------------------------------------------ schema qualifiers

    /// <summary>
    /// Replaces <c>from.name</c> qualifiers with <c>to.name</c> outside strings and comments (<paramref name="to"/> null removes the
    /// qualifier). Quoted identifiers stay quoted. Dollar-quoted bodies are rewritten like code; string literals are not touched.
    /// </summary>
    public static string RewriteSchema(string text, Dialect d, string from, string? to)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(from)) return text;
        if (to is not null && string.Equals(from, to, StringComparison.Ordinal)) return text;
        var pieces = Scan(text, d);
        var edits = new List<(int Start, int End, string Text)>();
        string? Ident(Piece p) => p.Kind switch
        {
            PieceKind.Word => text[p.Start..p.End],
            PieceKind.QIdent when p.End - p.Start >= 2 => text[(p.Start + 1)..(p.End - 1)],
            _ => null,
        };
        for (var i = 0; i + 2 < pieces.Count; i++)
        {
            var p = pieces[i];
            var name = Ident(p);
            if (name is null || !name.Equals(from, StringComparison.OrdinalIgnoreCase)) continue;
            if (i > 0 && pieces[i - 1].Kind == PieceKind.Punct && text[pieces[i - 1].Start] == '.') continue;
            if (pieces[i + 1].Kind != PieceKind.Punct || text[pieces[i + 1].Start] != '.' || Ident(pieces[i + 2]) is null) continue;
            if (to is null) { edits.Add((p.Start, pieces[i + 1].End, "")); continue; }
            var quoted = p.Kind == PieceKind.QIdent || !PlainName(to) || (d == Dialect.PgSql && to != to.ToLowerInvariant());
            edits.Add((p.Start, p.End, quoted ? DialectInfo.QuoteIdentifier(d, to) : to));
        }
        if (edits.Count == 0) return text;
        var sb = new StringBuilder(text);
        for (var k = edits.Count - 1; k >= 0; k--) sb.Remove(edits[k].Start, edits[k].End - edits[k].Start).Insert(edits[k].Start, edits[k].Text);
        return sb.ToString();
    }

    private static bool PlainName(string name) => PlainIdent().IsMatch(name);

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_$]*$")]
    private static partial Regex PlainIdent();

    /// <summary>True when <paramref name="text"/> still names <paramref name="schema"/> as a qualifier somewhere (also inside bodies).</summary>
    public static bool MentionsSchemaQualifier(string text, string schema)
    {
        if (string.IsNullOrEmpty(schema)) return false;
        var e = Regex.Escape(schema);
        return Regex.IsMatch(text, $@"(?<![\w$])[\[""`]?{e}[\]""`]?\s*\.\s*[\[""`]?\w", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    // ------------------------------------------------------------------ statements

    /// <summary>Splits a script on top-level semicolons (strings, comments and dollar-quoted bodies are respected). Empty parts are dropped.</summary>
    public static List<string> SplitStatements(string script, Dialect d)
    {
        var tokens = SqlTokenizer.Tokenize(script, d);
        var parts = new List<string>();
        var start = 0;
        foreach (var t in tokens)
        {
            if (!t.IsPunct(';')) continue;
            var piece = script[start..t.Start].Trim();
            if (piece.Length > 0 && HasCode(piece, d)) parts.Add(piece);
            start = t.End;
        }
        var rest = script[start..].Trim();
        if (rest.Length > 0 && HasCode(rest, d)) parts.Add(rest);
        return parts;
    }

    private static bool HasCode(string text, Dialect d) => SqlTokenizer.Tokenize(text, d).Count > 0;

    /// <summary>Removes a trailing ";" (and "/" or "GO" line) of a stored definition.</summary>
    public static string TrimTerminator(string ddl)
    {
        var s = ddl.TrimEnd();
        while (true)
        {
            var before = s;
            if (s.EndsWith(';')) s = s[..^1].TrimEnd();
            if (s.EndsWith("\n/")) s = s[..^2].TrimEnd();
            if (s.EndsWith("\nGO", StringComparison.OrdinalIgnoreCase)) s = s[..^3].TrimEnd();
            if (s == before) return s;
        }
    }

    /// <summary>
    /// Every identifier a definition mentions (outside comments and string literals; dollar-quoted bodies count as code), for
    /// dependency ordering. Keywords come back too: callers match the names against real objects.
    /// </summary>
    public static HashSet<string> ReferencedNames(string? ddl, Dialect d)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(ddl)) return set;
        foreach (var p in Scan(ddl, d))
        {
            if (p.Kind == PieceKind.Word) set.Add(ddl[p.Start..p.End]);
            else if (p.Kind == PieceKind.QIdent && p.End - p.Start > 2) set.Add(ddl[(p.Start + 1)..(p.End - 1)]);
        }
        return set;
    }
}
