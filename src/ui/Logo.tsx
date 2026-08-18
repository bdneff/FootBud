/**
 * FootBud wordmark: balloon letters. Each letter sits in its own slightly
 * tilted balloon with a shine highlight, followed by a little football.
 */
const LETTERS = ['F', 'o', 'o', 't', 'B', 'u', 'd'] as const;
const COLORS = ['#4fbf8b', '#5b9bd5', '#d9924f', '#d4657a', '#4fbf8b', '#5b9bd5', '#a07fd9'];

export function Logo({ height = 34 }: { height?: number }) {
  const r = 15; // balloon radius
  const step = 26; // horizontal spacing
  const width = LETTERS.length * step + 46;

  return (
    <svg
      className="logo"
      height={height}
      viewBox={`0 0 ${width} 44`}
      role="img"
      aria-label="FootBud"
    >
      {LETTERS.map((ch, i) => {
        const cx = r + 2 + i * step;
        const cy = 20 + (i % 2 === 0 ? -1.5 : 1.5);
        const tilt = i % 2 === 0 ? -7 : 7;
        return (
          <g key={i} transform={`rotate(${tilt} ${cx} ${cy})`}>
            {/* balloon knot */}
            <path
              d={`M ${cx - 2.5} ${cy + r - 1.5} L ${cx} ${cy + r + 3.5} L ${cx + 2.5} ${cy + r - 1.5} Z`}
              fill={COLORS[i]}
            />
            <circle cx={cx} cy={cy} r={r} fill={COLORS[i]} />
            {/* shine */}
            <ellipse
              cx={cx - r * 0.38}
              cy={cy - r * 0.42}
              rx={r * 0.3}
              ry={r * 0.2}
              fill="#ffffff"
              opacity={0.4}
              transform={`rotate(-30 ${cx - r * 0.38} ${cy - r * 0.42})`}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="'Segoe UI', system-ui, sans-serif"
              fontWeight={800}
              fontSize={ch === ch.toUpperCase() ? 17 : 16}
              fill="#10141a"
            >
              {ch}
            </text>
          </g>
        );
      })}
      {/* little football */}
      <g transform={`rotate(-24 ${LETTERS.length * step + 22} 24)`}>
        <ellipse cx={LETTERS.length * step + 22} cy={24} rx={13} ry={8.5} fill="#8a5a3b" />
        <line
          x1={LETTERS.length * step + 15}
          y1={24}
          x2={LETTERS.length * step + 29}
          y2={24}
          stroke="#f3ede6"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        {[17.5, 21, 24.5, 28].map((dx, j) => (
          <line
            key={j}
            x1={LETTERS.length * step + dx - 2}
            y1={21.5}
            x2={LETTERS.length * step + dx - 2}
            y2={26.5}
            stroke="#f3ede6"
            strokeWidth={1.3}
            strokeLinecap="round"
          />
        ))}
      </g>
    </svg>
  );
}
