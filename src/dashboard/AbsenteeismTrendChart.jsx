import React, { useState } from 'react';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 170;
const PAD_LEFT = 34;
const PAD_RIGHT = 16;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;

const LINE = 'var(--brass)';
const AREA_FILL_ID = 'absenteeism-trend-area-fill';

// Single-series "trend over time" line chart (SRS FR-3): one brass line, recessive gridlines,
// a direct label on the latest month, and a tooltip on hover, focus or tap. Colours are CSS
// variables set through `style`, so the chart follows the light and dark themes.
export const AbsenteeismTrendChart = ({ monthlyTrend = [] }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  if (!monthlyTrend || monthlyTrend.length === 0) {
    return (
      <p style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
        No absenteeism history yet for the sites you can see.
      </p>
    );
  }

  const values = monthlyTrend.map((m) => m.absenteeismPercentage);
  const maxValue = Math.max(...values, 1);
  // Round the axis ceiling up to a friendly step so gridlines read as whole numbers.
  const axisMax = Math.ceil((maxValue * 1.2) / 2) * 2 || 2;

  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xFor = (i) => PAD_LEFT + (monthlyTrend.length === 1 ? plotWidth / 2 : (i / (monthlyTrend.length - 1)) * plotWidth);
  const yFor = (v) => PAD_TOP + plotHeight - (v / axisMax) * plotHeight;

  const points = monthlyTrend.map((m, i) => ({ ...m, x: xFor(i), y: yFor(m.absenteeismPercentage) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD_TOP + plotHeight} L ${points[0].x} ${PAD_TOP + plotHeight} Z`;

  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const value = (axisMax / gridSteps) * i;
    return { value, y: yFor(value) };
  });

  const active = activeIndex !== null ? points[activeIndex] : null;
  const latest = points[points.length - 1];

  return (
    <figure style={{ position: 'relative', margin: 0 }}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`Monthly guard absenteeism, last ${points.length} months. Latest month ${latest.month}: ${latest.absenteeismPercentage}%.`}
      >
        <defs>
          <linearGradient id={AREA_FILL_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: LINE, stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: LINE, stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD_LEFT} x2={CHART_WIDTH - PAD_RIGHT} y1={g.y} y2={g.y} style={{ stroke: 'var(--rule)' }} strokeWidth="1" />
            <text x={PAD_LEFT - 8} y={g.y + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--muted)' }}>{g.value.toFixed(0)}%</text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${AREA_FILL_ID})`} stroke="none" />
        <path d={linePath} fill="none" style={{ stroke: LINE }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <text key={i} x={p.x} y={CHART_HEIGHT - 8} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>{p.month.split(' ')[0]}</text>
        ))}

        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x} cy={p.y} r={i === activeIndex ? 6 : 4.5}
              style={{ fill: i === points.length - 1 ? LINE : 'var(--surface)', stroke: LINE }}
              strokeWidth="2"
            />
            {i === points.length - 1 && (
              <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="13" fontWeight="800" style={{ fill: 'var(--ink)' }}>{p.absenteeismPercentage}%</text>
            )}
            {/* A larger invisible target for hover, tap and keyboard focus */}
            <circle
              cx={p.x} cy={p.y} r="18" fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.month}: ${p.absenteeismPercentage}% absenteeism`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
              onClick={() => setActiveIndex(activeIndex === i ? null : i)}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}
      </svg>

      {active && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: `${(active.x / CHART_WIDTH) * 100}%`,
            top: `${(active.y / CHART_HEIGHT) * 100}%`,
            transform: 'translate(-50%, -135%)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            borderRadius: '5px',
            padding: '6px 10px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none'
          }}
        >
          <strong>{active.month}</strong>: {active.absenteeismPercentage}% absenteeism
        </div>
      )}
    </figure>
  );
};
