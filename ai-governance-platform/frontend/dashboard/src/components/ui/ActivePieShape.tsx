/** Renders an active (hovered) pie segment that projects outward with a shadow */
export function renderActiveShape(props: any) {
  const RADIAN = Math.PI / 180;
  const {
    cx, cy, innerRadius, outerRadius, startAngle, endAngle,
    fill, payload, value,
  } = props;

  // Expanded sector
  const ir = innerRadius - 3;
  const or2 = outerRadius + 8;

  // Outer accent ring
  const orRing1 = outerRadius + 12;
  const orRing2 = outerRadius + 14;

  function sectorPath(cxp: number, cyp: number, ir: number, or: number, sa: number, ea: number) {
    const s = RADIAN * -sa;
    const e = RADIAN * -ea;
    const sx1 = cxp + or * Math.cos(s);
    const sy1 = cyp + or * Math.sin(s);
    const ex1 = cxp + or * Math.cos(e);
    const ey1 = cyp + or * Math.sin(e);
    const sx2 = cxp + ir * Math.cos(e);
    const sy2 = cyp + ir * Math.sin(e);
    const ex2 = cxp + ir * Math.cos(s);
    const ey2 = cyp + ir * Math.sin(s);
    const largeArc = ea - sa > 180 ? 1 : 0;
    return `M${sx1},${sy1} A${or},${or},0,${largeArc},0,${ex1},${ey1} L${sx2},${sy2} A${ir},${ir},0,${largeArc},1,${ex2},${ey2} Z`;
  }

  return (
    <g>
      <path
        d={sectorPath(cx, cy, ir, or2, startAngle, endAngle)}
        fill={fill}
        style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.35))' }}
      />
      <path
        d={sectorPath(cx, cy, orRing1, orRing2, startAngle, endAngle)}
        fill={fill}
        opacity={0.4}
      />
      <text x={cx} y={cy - 6} textAnchor="middle" fill={fill} fontSize={16} fontWeight={700}>
        {typeof value === 'number' ? (value < 1 ? `$${value.toFixed(2)}` : value) : value}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize={10}>
        {payload?.name}
      </text>
    </g>
  );
}
