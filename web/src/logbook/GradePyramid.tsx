// The grade pyramid — a stacked bar chart of unique sends by grade, each bar split by
// try-bucket (flash / 2nd / 3rd / 4+). Mirrors iOS `GradePyramidView`. Tap a bar to
// reveal each segment's count; tap again to clear.

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { pyramid, type PyramidInput } from './sessions'
import { TRY_BUCKETS, TRY_BUCKET_COLOR } from './tryBucket'

// ChartContainer requires a config; we render our own legend and use direct fills, so
// this only feeds the container's baseline styling.
const chartConfig: ChartConfig = {
  sends: { label: 'Sends' },
}

interface LabelProps {
  x?: string | number
  y?: string | number
  width?: string | number
  height?: string | number
  value?: string | number
  index?: number
}

export function GradePyramid({ items }: { items: PyramidInput[] }) {
  const { rows } = useMemo(() => pyramid(items), [items])
  const [selected, setSelected] = useState<string | null>(null)

  const toggle = (index: number) => {
    const grade = rows[index]?.grade
    if (grade) setSelected((s) => (s === grade ? null : grade))
  }

  return (
    <div>
      <ChartContainer config={chartConfig} className="aspect-auto h-[190px] w-full">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="grade" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} fontSize={11} />
          {TRY_BUCKETS.map((bucket) => (
            <Bar
              key={bucket}
              dataKey={bucket}
              stackId="pyramid"
              fill={TRY_BUCKET_COLOR[bucket]}
              isAnimationActive
              onClick={(_data: unknown, index: number) => toggle(index)}
              className="cursor-pointer"
            >
              {rows.map((row) => (
                <Cell
                  key={row.grade}
                  fillOpacity={selected && selected !== row.grade ? 0.35 : 1}
                />
              ))}
              <LabelList
                dataKey={bucket}
                content={(raw) => {
                  const props = raw as LabelProps
                  const { value, index } = props
                  const count = Number(value)
                  if (index == null || rows[index]?.grade !== selected || !count) return null
                  const x = Number(props.x)
                  const y = Number(props.y)
                  const width = Number(props.width)
                  const height = Number(props.height)
                  return (
                    <text
                      x={x + width / 2}
                      y={y + height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={700}
                      fill="#fff"
                    >
                      {count}
                    </text>
                  )
                }}
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>

      {/* Reduced legend, matching iOS — colored swatch + bucket label. */}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {TRY_BUCKETS.map((bucket) => (
          <div key={bucket} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: TRY_BUCKET_COLOR[bucket] }}
            />
            <span className="text-xs text-muted-foreground">{bucket}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
