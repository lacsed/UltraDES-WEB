using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace UltraDESWeb.Services;

/// <summary>Geometry shared by candidate scoring and the SVG renderer's documented drawing contract.</summary>
public static class AutomatonLayoutGeometry
{
    public readonly record struct Point(double X, double Y)
    {
        public static Point operator +(Point a, Point b) => new(a.X + b.X, a.Y + b.Y);
        public static Point operator -(Point a, Point b) => new(a.X - b.X, a.Y - b.Y);
        public static Point operator *(Point a, double scale) => new(a.X * scale, a.Y * scale);
        public double Length => Math.Sqrt(X * X + Y * Y);
        public Point Unit => Length < .001 ? new(1, 0) : this * (1 / Length);
    }

    public readonly record struct Box(double Left, double Top, double Right, double Bottom)
    {
        public bool Intersects(Box other, double gap = 0) => Left < other.Right + gap && Right + gap > other.Left && Top < other.Bottom + gap && Bottom + gap > other.Top;
        public static Box Around(Point p, double width, double height) => new(p.X - width / 2, p.Y - height / 2, p.X + width / 2, p.Y + height / 2);
        public static Box Of(IEnumerable<Point> points) { var values = points.ToArray(); return new(values.Min(p => p.X), values.Min(p => p.Y), values.Max(p => p.X), values.Max(p => p.Y)); }
    }

    public sealed record Curve(Point[] Samples, Point Label, Box LabelBox, Box Bounds);
    public sealed record Quality(int StateOverlaps, int StateLabelOverlaps, int EdgeStateCollisions,
        int LabelOverlaps, int Crossings, int EdgeLabelCollisions, double Length, double Area, double Symmetry = 0) : IComparable<Quality>
    {
        public int CompareTo(Quality other)
        {
            if (other is null) return -1;
            var left = new[] { StateOverlaps, StateLabelOverlaps, EdgeStateCollisions, LabelOverlaps, Crossings, EdgeLabelCollisions };
            var right = new[] { other.StateOverlaps, other.StateLabelOverlaps, other.EdgeStateCollisions, other.LabelOverlaps, other.Crossings, other.EdgeLabelCollisions };
            for (var i = 0; i < left.Length; i++) { var comparison = left[i].CompareTo(right[i]); if (comparison != 0) return comparison; }
            // Length and occupied area break ties; neither can compensate for a collision or crossing.
            var symmetry = Math.Round(Symmetry, 3).CompareTo(Math.Round(other.Symmetry, 3));
            return symmetry != 0 ? symmetry : (Length + Math.Sqrt(Area) * .15).CompareTo(other.Length + Math.Sqrt(other.Area) * .15);
        }
    }

    public const double LabelRowWidth = 260;
    public const int TextColumns = 26;
    public static string[] TextLines(string value)
    {
        var runes = (value ?? "").EnumerateRunes().ToArray();
        return Enumerable.Range(0, Math.Max(1, (runes.Length + TextColumns - 1) / TextColumns))
            .Select(index => string.Concat(runes.Skip(index * TextColumns).Take(TextColumns).Select(rune => rune.ToString()))).ToArray();
    }

    public static double TextWidth(string value) => (value ?? "").EnumerateRunes().Sum(rune => rune.Value >= 0x2E80 ? 18d : 9d);
    public static double StateRadius(string name)
    {
        var lines = TextLines(name);
        var halfWidth = lines.Max(TextWidth) / 2 + 9;
        var halfHeight = lines.Length * 18 / 2d + 7;
        return Math.Max(30, Math.Ceiling(Math.Sqrt(halfWidth * halfWidth + halfHeight * halfHeight)));
    }

    public static (double Width, double Height) LabelSize(IEnumerable<string> events)
    {
        double width = 0, rowWidth = 0, height = 0, rowHeight = 0;
        foreach (var name in events)
        {
            var lines = TextLines(name);
            var chipWidth = Math.Max(24, lines.Max(TextWidth) + 14);
            var chipHeight = lines.Length * 18 + 8;
            if (rowWidth > 0 && rowWidth + 5 + chipWidth > LabelRowWidth)
            { width = Math.Max(width, rowWidth); height += rowHeight + 5; rowWidth = 0; rowHeight = 0; }
            rowWidth += (rowWidth > 0 ? 5 : 0) + chipWidth;
            rowHeight = Math.Max(rowHeight, chipHeight);
        }
        return (Math.Max(width, rowWidth), height + rowHeight);
    }

    public static Curve Route(StateLayoutData a, StateLayoutData b, TransitionLayoutData edge, int segments = 12)
    {
        var source = new Point(a.X, a.Y); var target = new Point(b.X, b.Y); var control = new Point(edge.ControlX, edge.ControlY);
        Point[] samples; Point label;
        if (edge.Source == edge.Target || (target - source).Length < .001)
        {
            var u = (control - source).Unit; var normal = new Point(-u.Y, u.X);
            var extent = Math.Max(a.Radius + 75, (control - source).Length);
            var start = source + u * ((a.Radius + 1) * Math.Cos(.65)) + normal * ((a.Radius + 1) * Math.Sin(.65));
            var end = source + u * ((a.Radius + 1) * Math.Cos(.65)) - normal * ((a.Radius + 1) * Math.Sin(.65));
            var c1 = source + u * extent + normal * (extent * .75); var c2 = source + u * extent - normal * (extent * .75);
            samples = Enumerable.Range(0, segments + 1).Select(index => Cubic(start, c1, c2, end, index / (double)segments)).ToArray();
            var size = LabelSize(edge.Events);
            var clearance = Math.Abs(u.X) * size.Width / 2 + Math.Abs(u.Y) * size.Height / 2 + 8;
            label = Cubic(start, c1, c2, end, .5) + u * clearance;
        }
        else
        {
            var chord = target - source; var normal = new Point(-chord.Y, chord.X).Unit;
            var cross = Cross(chord, control - source);
            var straight = Math.Abs(cross) / Math.Max(1, chord.Length) < 7;
            var start = source + (straight ? chord.Unit : (control - source).Unit) * (a.Radius + 1);
            var end = target + (straight ? chord.Unit * -1 : (control - target).Unit) * (b.Radius + 1);
            samples = Enumerable.Range(0, segments + 1).Select(index => straight
                ? start + (end - start) * (index / (double)segments)
                : Quadratic(start, control, end, index / (double)segments)).ToArray();
            var size = LabelSize(edge.Events);
            var clearance = Math.Abs(normal.X) * size.Width / 2 + Math.Abs(normal.Y) * size.Height / 2 + 7;
            label = (straight ? (start + end) * .5 : Quadratic(start, control, end, .5)) + normal * ((!straight && cross < 0 ? -1 : 1) * clearance);
        }
        label += new Point(edge.LabelOffsetX, edge.LabelOffsetY);
        var labelSize = LabelSize(edge.Events);
        return new Curve(samples, label, Box.Around(label, labelSize.Width, labelSize.Height), Box.Of(samples));
    }

    public static Quality Evaluate(AutomatonLayoutData layout)
    {
        var nodes = layout.States.ToDictionary(state => state.State, StringComparer.Ordinal);
        var curves = layout.Transitions.Select(edge => Route(nodes[edge.Source], nodes[edge.Target], edge)).ToArray();
        int stateOverlaps = 0, stateLabels = 0, edgeStates = 0, labelOverlaps = 0, crossings = 0, edgeLabels = 0;
        for (var i = 0; i < layout.States.Length; i++)
        {
            var a = layout.States[i];
            for (var j = i + 1; j < layout.States.Length; j++)
                if ((new Point(a.X, a.Y) - new Point(layout.States[j].X, layout.States[j].Y)).Length < a.Radius + layout.States[j].Radius + 12) stateOverlaps++;
            foreach (var curve in curves)
                if (CircleBox(new Point(a.X, a.Y), a.Radius + 6, curve.LabelBox)) stateLabels++;
        }
        double length = 0;
        for (var i = 0; i < curves.Length; i++)
        {
            var edge = layout.Transitions[i]; var curve = curves[i];
            foreach (var state in layout.States.Where(state => state.State != edge.Source && state.State != edge.Target))
                if (HitsCircle(curve, new Point(state.X, state.Y), state.Radius + 7)) edgeStates++;
            length += curve.Samples.Zip(curve.Samples.Skip(1), (a, b) => (b - a).Length).Sum();
        }
        // Dense diagrams use a repeatable sample of pairs; all state/label and edge/state checks remain exact.
        foreach (var (i, j) in Pairs(curves.Length))
            {
                var a = curves[i]; var b = curves[j];
                if (a.LabelBox.Intersects(b.LabelBox, 5)) labelOverlaps++;
                if (HitsBox(a, b.LabelBox) || HitsBox(b, a.LabelBox)) edgeLabels++;
                if (Crosses(a, b)) crossings++;
            }
        var bounds = Box.Of(layout.States.SelectMany(state => new[] { new Point(state.X - state.Radius, state.Y - state.Radius), new Point(state.X + state.Radius, state.Y + state.Radius) })
            .Concat(curves.SelectMany(curve => new[] { new Point(curve.LabelBox.Left, curve.LabelBox.Top), new Point(curve.LabelBox.Right, curve.LabelBox.Bottom) })).DefaultIfEmpty(new Point(0, 0)));
        return new Quality(stateOverlaps, stateLabels, edgeStates, labelOverlaps, crossings, edgeLabels, length, (bounds.Right - bounds.Left) * (bounds.Bottom - bounds.Top));
    }

    private static IEnumerable<(int, int)> Pairs(int count)
    {
        var total = count * (long)(count - 1) / 2;
        var samples = Math.Min(total, 30_000);
        for (long sample = 0; sample < samples; sample++)
        {
            var index = sample * total / samples;
            var i = (int)Math.Floor((2d * count - 1 - Math.Sqrt(Math.Pow(2d * count - 1, 2) - 8 * index)) / 2);
            var row = i * (2L * count - i - 1) / 2;
            if (row > index) { i--; row = i * (2L * count - i - 1) / 2; }
            yield return (i, i + 1 + (int)(index - row));
        }
    }

    public static bool CircleBox(Point center, double radius, Box box)
    {
        var closest = new Point(Math.Clamp(center.X, box.Left, box.Right), Math.Clamp(center.Y, box.Top, box.Bottom));
        return (center - closest).Length < radius;
    }
    public static bool HitsCircle(Curve curve, Point center, double radius) => curve.Samples.Zip(curve.Samples.Skip(1), (a, b) => DistanceToSegment(center, a, b)).Any(distance => distance < radius);
    public static bool HitsBox(Curve curve, Box box)
    {
        if (!curve.Bounds.Intersects(box)) return false;
        var topLeft = new Point(box.Left, box.Top); var topRight = new Point(box.Right, box.Top);
        var bottomLeft = new Point(box.Left, box.Bottom); var bottomRight = new Point(box.Right, box.Bottom);
        for (var i = 1; i < curve.Samples.Length; i++)
        {
            var a = curve.Samples[i - 1]; var b = curve.Samples[i];
            if (a.X >= box.Left && a.X <= box.Right && a.Y >= box.Top && a.Y <= box.Bottom) return true;
            if (Intersects(a, b, topLeft, topRight) || Intersects(a, b, topRight, bottomRight) || Intersects(a, b, bottomRight, bottomLeft) || Intersects(a, b, bottomLeft, topLeft)) return true;
        }
        return false;
    }
    public static bool Crosses(Curve a, Curve b)
    {
        if (!a.Bounds.Intersects(b.Bounds)) return false;
        for (var i = 1; i < a.Samples.Length; i++)
            for (var j = 1; j < b.Samples.Length; j++)
                if (Intersects(a.Samples[i - 1], a.Samples[i], b.Samples[j - 1], b.Samples[j])) return true;
        return false;
    }
    private static bool Intersects(Point a, Point b, Point c, Point d) => Cross(b - a, c - a) * Cross(b - a, d - a) < -.01 && Cross(d - c, a - c) * Cross(d - c, b - c) < -.01;
    private static double DistanceToSegment(Point point, Point a, Point b)
    {
        var ab = b - a; var denominator = ab.X * ab.X + ab.Y * ab.Y;
        var t = denominator < .001 ? 0 : Math.Clamp(((point.X - a.X) * ab.X + (point.Y - a.Y) * ab.Y) / denominator, 0, 1);
        return (point - (a + ab * t)).Length;
    }
    private static double Cross(Point a, Point b) => a.X * b.Y - a.Y * b.X;
    private static Point Quadratic(Point a, Point c, Point b, double t) => a * ((1 - t) * (1 - t)) + c * (2 * t * (1 - t)) + b * (t * t);
    private static Point Cubic(Point a, Point c1, Point c2, Point b, double t) => a * Math.Pow(1 - t, 3) + c1 * (3 * Math.Pow(1 - t, 2) * t) + c2 * (3 * (1 - t) * t * t) + b * Math.Pow(t, 3);
}
