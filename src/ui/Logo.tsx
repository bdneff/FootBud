/**
 * FootBud wordmark: letters shaped from white balloon-animal balloons.
 * Each letter is a thick round-capped tube stroke rendered in three layers
 * (shadow, body, gloss highlight), with a tied-off knot at the start of the
 * letter and pinch marks where a twisted balloon would crease.
 */

interface Pinch {
  x: number;
  y: number;
  /** Rotation in degrees, across the tube. */
  angle: number;
}

interface BalloonLetter {
  /** Tube strokes in local coordinates (baseline y=33, cap y=9). */
  paths: string[];
  /** Local x,y where the balloon is tied off. */
  knot: { x: number; y: number };
  pinches: Pinch[];
  width: number;
}

const LETTERS: BalloonLetter[] = [
  // F
  {
    paths: ['M6 33 L6 9', 'M6 9 L20 9', 'M6 20 L16 20'],
    knot: { x: 6, y: 33 },
    pinches: [{ x: 6, y: 9.5, angle: 45 }],
    width: 28,
  },
  // o
  {
    paths: ['M17.5 25 A8.5 8.5 0 1 1 17.49 24.6'],
    knot: { x: 9, y: 33.5 },
    pinches: [{ x: 9, y: 16.5, angle: 0 }],
    width: 26,
  },
  // o
  {
    paths: ['M17.5 25 A8.5 8.5 0 1 1 17.49 24.6'],
    knot: { x: 9, y: 33.5 },
    pinches: [{ x: 9, y: 16.5, angle: 0 }],
    width: 26,
  },
  // t
  {
    paths: ['M8 10 L8 27 Q8 33 15 33', 'M2 17 L16 17'],
    knot: { x: 8, y: 10 },
    pinches: [{ x: 8, y: 17, angle: 90 }],
    width: 24,
  },
  // B
  {
    paths: [
      'M6 33 L6 9',
      'M6 9 Q21 9 21 14.5 Q21 20 6 20',
      'M6 20 Q23 20 23 26.5 Q23 33 6 33',
    ],
    knot: { x: 6, y: 9 },
    pinches: [{ x: 6, y: 20, angle: 90 }],
    width: 30,
  },
  // u
  {
    paths: ['M5 17 L5 25 Q5 33 11.5 33 Q18 33 18 25 L18 17', 'M18 25 L18 33'],
    knot: { x: 5, y: 17 },
    pinches: [{ x: 18, y: 26, angle: 0 }],
    width: 27,
  },
  // d
  {
    paths: ['M17.5 25 A8.5 8.5 0 1 1 17.49 24.6', 'M18 8 L18 33'],
    knot: { x: 18, y: 8 },
    pinches: [{ x: 17.6, y: 20, angle: 0 }],
    width: 28,
  },
];

const TUBE = 9;
const SHADOW = '#aab0bc';
const BODY = '#f7f8fb';
const GLOSS = '#ffffff';
const CREASE = '#c7ccd6';

function Tube({ d }: { d: string }) {
  return (
    <>
      {/* soft shadow under the tube gives it lift */}
      <path
        d={d}
        fill="none"
        stroke={SHADOW}
        strokeWidth={TUBE}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(1.4 1.9)"
        opacity={0.55}
      />
      {/* inflated body */}
      <path
        d={d}
        fill="none"
        stroke={BODY}
        strokeWidth={TUBE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* gloss line riding the upper-left of the tube */}
      <path
        d={d}
        fill="none"
        stroke={GLOSS}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(-1.4 -1.7)"
        opacity={0.9}
      />
    </>
  );
}

export function Logo({ height = 34 }: { height?: number }) {
  const offsets: number[] = [];
  let x = 4;
  for (const letter of LETTERS) {
    offsets.push(x);
    x += letter.width;
  }
  const footballX = x + 16;
  const width = footballX + 22;

  return (
    <svg
      className="logo"
      height={height}
      viewBox={`0 0 ${width} 44`}
      role="img"
      aria-label="FootBud"
    >
      {LETTERS.map((letter, i) => (
        <g key={i} transform={`translate(${offsets[i]} 0)`}>
          {letter.paths.map((d, j) => (
            <Tube key={j} d={d} />
          ))}
          {/* twist creases */}
          {letter.pinches.map((p, j) => (
            <ellipse
              key={j}
              cx={p.x}
              cy={p.y}
              rx={1.3}
              ry={TUBE / 2 - 0.8}
              fill={CREASE}
              opacity={0.8}
              transform={`rotate(${p.angle} ${p.x} ${p.y})`}
            />
          ))}
          {/* tied-off knot */}
          <circle cx={letter.knot.x} cy={letter.knot.y} r={2.6} fill={BODY} stroke={SHADOW} strokeWidth={0.9} />
          <circle cx={letter.knot.x - 0.8} cy={letter.knot.y - 0.8} r={0.8} fill={GLOSS} />
        </g>
      ))}
      {/* little football */}
      <g transform={`rotate(-24 ${footballX} 24)`}>
        <ellipse cx={footballX} cy={24} rx={13} ry={8.5} fill="#8a5a3b" />
        <line
          x1={footballX - 7}
          y1={24}
          x2={footballX + 7}
          y2={24}
          stroke="#f3ede6"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        {[-4.5, -1.5, 1.5, 4.5].map((dx, j) => (
          <line
            key={j}
            x1={footballX + dx}
            y1={21.5}
            x2={footballX + dx}
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
