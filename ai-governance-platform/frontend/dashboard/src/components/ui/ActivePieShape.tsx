import { Sector } from 'recharts';

/** Renders an active (hovered) pie segment that projects outward */
export function renderActiveShape(props: any) {
  const {
    cx, cy, innerRadius, outerRadius, startAngle, endAngle,
    fill, payload, value,
  } = props;

  return (
    <g>
      {/* Main projected sector */}
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 3}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      {/* Outer ring accent */}
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 12}
        outerRadius={outerRadius + 14}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.4}
      />
      {/* Center value */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill={fill} fontSize={16} fontWeight={700}>
        {typeof value === 'number' ? (value < 1 ? '$' + value.toFixed(2) : value) : value}
      </text>
      {/* Center label */}
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize={10}>
        {payload?.name}
      </text>
    </g>
  );
}
