using System.Globalization;
using System.Text;

namespace DbStudio.Import.Generate;

/// <summary>
/// Generates strings from a small regular-expression subset: literals, <c>\d \w \a \A \x \X \s</c>, <c>.</c>, character
/// classes (<c>[A-Z0-9_]</c>), groups with alternation (<c>(red|green)</c>) and the quantifiers <c>? * + {n} {n,m}</c>.
/// </summary>
internal sealed class PatternGenerator : IValueGenerator
{
    private readonly Node _root;

    public PatternGenerator(string pattern)
    {
        if (string.IsNullOrEmpty(pattern)) throw new ArgumentException("The pattern is empty.");
        var p = new Parser(pattern);
        _root = p.ParseAlternation();
        if (!p.AtEnd) throw new ArgumentException($"Unexpected '{p.Peek()}' at position {p.Position + 1} of the pattern.");
        Cardinality = Math.Max(1, _root.Cardinality());
    }

    public double Cardinality { get; }

    public object? Next(Rng rng, long row)
    {
        var sb = new StringBuilder();
        _root.Emit(rng, sb);
        return sb.ToString();
    }

    // ---- nodes

    private abstract class Node
    {
        public abstract void Emit(Rng rng, StringBuilder sb);
        public abstract double Cardinality();
    }

    private sealed class Lit(string text) : Node
    {
        public override void Emit(Rng rng, StringBuilder sb) => sb.Append(text);
        public override double Cardinality() => 1;
    }

    private sealed class CharSet(string chars) : Node
    {
        public override void Emit(Rng rng, StringBuilder sb) => sb.Append(chars[rng.Next(chars.Length)]);
        public override double Cardinality() => chars.Length;
    }

    private sealed class Seq(List<Node> items) : Node
    {
        public override void Emit(Rng rng, StringBuilder sb) { foreach (var i in items) i.Emit(rng, sb); }
        public override double Cardinality() { var c = 1.0; foreach (var i in items) c *= i.Cardinality(); return c; }
    }

    private sealed class Alt(List<Node> options) : Node
    {
        public override void Emit(Rng rng, StringBuilder sb) => options[rng.Next(options.Count)].Emit(rng, sb);
        public override double Cardinality() => options.Sum(o => o.Cardinality());
    }

    private sealed class Rep(Node inner, int min, int max) : Node
    {
        public override void Emit(Rng rng, StringBuilder sb)
        {
            var n = (int)rng.NextLong(min, max);
            for (var i = 0; i < n; i++) inner.Emit(rng, sb);
        }

        public override double Cardinality()
        {
            var c = inner.Cardinality();
            double total = 0;
            for (var n = min; n <= max; n++) total += Math.Pow(c, n);
            return total;
        }
    }

    // ---- parser

    private sealed class Parser(string s)
    {
        private int _i;
        public int Position => _i;
        public bool AtEnd => _i >= s.Length;
        public char Peek() => s[_i];

        public Node ParseAlternation()
        {
            var options = new List<Node> { ParseSequence() };
            while (!AtEnd && s[_i] == '|')
            {
                _i++;
                options.Add(ParseSequence());
            }
            return options.Count == 1 ? options[0] : new Alt(options);
        }

        private Node ParseSequence()
        {
            var items = new List<Node>();
            while (!AtEnd && s[_i] is not ('|' or ')'))
            {
                var atom = ParseAtom();
                items.Add(ParseQuantifier(atom));
            }
            return items.Count == 1 ? items[0] : new Seq(items);
        }

        private Node ParseAtom()
        {
            var c = s[_i++];
            switch (c)
            {
                case '(':
                {
                    if (_i + 1 < s.Length && s[_i] == '?' && s[_i + 1] == ':') _i += 2;
                    var inner = ParseAlternation();
                    if (AtEnd || s[_i] != ')') throw new ArgumentException("A group in the pattern is not closed.");
                    _i++;
                    return inner;
                }
                case '[': return ParseClass();
                case '.': return new CharSet(Letters + Upper + Digits);
                case '\\': return Escape();
                case '*' or '+' or '?' or '{':
                    throw new ArgumentException($"Nothing to repeat before '{c}' at position {_i} of the pattern.");
                default: return new Lit(c.ToString());
            }
        }

        private const string Letters = "abcdefghijklmnopqrstuvwxyz";
        private const string Upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        private const string Digits = "0123456789";

        private Node Escape()
        {
            if (AtEnd) throw new ArgumentException("The pattern ends with a backslash.");
            var c = s[_i++];
            return c switch
            {
                'd' => new CharSet(Digits),
                'w' => new CharSet(Letters + Upper + Digits + "_"),
                'a' => new CharSet(Letters),
                'A' => new CharSet(Upper),
                'x' => new CharSet(Digits + "abcdef"),
                'X' => new CharSet(Digits + "ABCDEF"),
                's' => new Lit(" "),
                'n' => new Lit("\n"),
                't' => new Lit("\t"),
                _ => new Lit(c.ToString()),
            };
        }

        private Node ParseClass()
        {
            var sb = new StringBuilder();
            if (!AtEnd && s[_i] == '^') throw new ArgumentException("Negated character classes ([^...]) are not supported.");
            while (true)
            {
                if (AtEnd) throw new ArgumentException("A character class in the pattern is not closed.");
                var c = s[_i++];
                if (c == ']') break;
                if (c == '\\' && !AtEnd)
                {
                    var e = s[_i++];
                    switch (e)
                    {
                        case 'd': sb.Append(Digits); break;
                        case 'w': sb.Append(Letters).Append(Upper).Append(Digits).Append('_'); break;
                        case 'a': sb.Append(Letters); break;
                        case 'A': sb.Append(Upper); break;
                        case 'x': sb.Append(Digits).Append("abcdef"); break;
                        case 'X': sb.Append(Digits).Append("ABCDEF"); break;
                        default: sb.Append(e); break;
                    }
                    continue;
                }
                if (!AtEnd && s[_i] == '-' && _i + 1 < s.Length && s[_i + 1] != ']')
                {
                    var to = s[_i + 1];
                    _i += 2;
                    if (to < c) throw new ArgumentException($"The range '{c}-{to}' in the pattern is reversed.");
                    if (to - c > 5000) throw new ArgumentException("A character range in the pattern is too large.");
                    for (var x = c; x <= to; x++) sb.Append(x);
                    continue;
                }
                sb.Append(c);
            }
            if (sb.Length == 0) throw new ArgumentException("A character class in the pattern is empty.");
            return new CharSet(new string(sb.ToString().Distinct().ToArray()));
        }

        private Node ParseQuantifier(Node atom)
        {
            if (AtEnd) return atom;
            switch (s[_i])
            {
                case '?': _i++; return new Rep(atom, 0, 1);
                case '*': _i++; return new Rep(atom, 0, 3);
                case '+': _i++; return new Rep(atom, 1, 3);
                case '{':
                {
                    var close = s.IndexOf('}', _i);
                    if (close < 0) throw new ArgumentException("A quantifier in the pattern is not closed.");
                    var body = s[(_i + 1)..close];
                    _i = close + 1;
                    var parts = body.Split(',');
                    if (parts.Length > 2 || !int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var min))
                        throw new ArgumentException($"'{{{body}}}' is not a valid quantifier.");
                    var max = min;
                    if (parts.Length == 2)
                    {
                        if (parts[1].Length == 0) max = min + 3;
                        else if (!int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out max)) throw new ArgumentException($"'{{{body}}}' is not a valid quantifier.");
                    }
                    if (max < min) throw new ArgumentException($"'{{{body}}}' is not a valid quantifier.");
                    if (max > 1000) throw new ArgumentException("A quantifier in the pattern is too large (maximum 1000).");
                    return new Rep(atom, min, max);
                }
                default: return atom;
            }
        }
    }
}
