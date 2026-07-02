import { BarChart, Bar, XAxis, LabelList, ResponsiveContainer } from 'recharts';

export interface DistBucket {
  label: string;
  pct: number;
  color: 'danger' | 'warning' | 'success' | 'accent';
}

/*
 * Recharts renders Cell's fill/stroke as raw SVG attributes, which don't
 * resolve CSS var() custom properties (unlike style props) - so these must
 * be literal values, not var(--token) references.
 */
const BAR_COLOR: Record<DistBucket['color'], string> = {
  danger: '#FCEBEB',
  warning: '#FAEEDA',
  success: '#EAF3DE',
  accent: '#E6F1FB',
};

const BORDER_COLOR: Record<DistBucket['color'], string> = {
  danger: '#F09595',
  warning: '#EF9F27',
  success: '#97C459',
  accent: '#85B7EB',
};

const TEXT_COLOR: Record<DistBucket['color'], string> = {
  danger: '#A32D2D',
  warning: '#854F0B',
  success: '#3B6D11',
  accent: '#185FA5',
};

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { color: DistBucket['color'] };
}

function BarWithTopCap(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const color = payload?.color ?? 'accent';
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} ry={3} fill={BAR_COLOR[color]} />
      <rect x={x} y={y} width={width} height={2} fill={BORDER_COLOR[color]} />
    </g>
  );
}

export default function DistChart({ buckets, height = 80 }: { buckets: DistBucket[]; height?: number }) {
  const data = buckets.map((b) => ({ ...b, pctLabel: `${Math.round(b.pct * 100)}%` }));

  return (
    <div style={{ height: height + 30 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 0, bottom: 0, left: 0 }} barCategoryGap="14%">
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: '#888780' }}
            height={20}
          />
          <Bar dataKey="pct" isAnimationActive={false} shape={BarWithTopCap}>
            <LabelList
              dataKey="pctLabel"
              position="top"
              content={(props) => {
                const { x, y, width, value, index } = props;
                const color = TEXT_COLOR[data[index as number].color];
                return (
                  <text
                    x={Number(x) + Number(width) / 2}
                    y={Number(y) - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={500}
                    fill={color}
                  >
                    {value}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
