"use client";
import { useState, type ReactNode } from "react";
import { download, money } from "./api";

// Plain inline SVG bars, no chart library. Looks only: every figure comes from the report endpoints in integer cents.
// Meaning never rests on colour alone: each bar carries its value as text and the legend names each series.
export type Series = { name: string; color: string };
export type BarRow = { label: string; values: number[] };

const LABEL_W = 240, BAR_H = 16, GAP = 10, AXIS_H = 34, WIDTH = 640, RIGHT = 100, LINE_H = 14, MAX_CHARS = 34;
// Full name always visible: one line, or two split at a space. Never cut with "…" and never moved into a <title> tooltip.
export function wrap(s: string): string[] {
  if (s.length <= MAX_CHARS) return [s];
  const cut = s.lastIndexOf(" ", MAX_CHARS);
  return cut > 0 ? [s.slice(0, cut), s.slice(cut + 1)] : [s.slice(0, MAX_CHARS), s.slice(MAX_CHARS)];
}

export function BarChart({ title, rows, series, valueLabel = "Amount (CAD)", categoryLabel }: { title: string; rows: BarRow[]; series: Series[]; valueLabel?: string; categoryLabel: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const rowH = Math.max(series.length * BAR_H, 2 * LINE_H + 2) + GAP; // tall enough for a two-line label
  const height = rows.length * rowH + AXIS_H + 16;
  const plotW = WIDTH - LABEL_W - RIGHT;
  const x = (v: number) => LABEL_W + (v / max) * plotW;
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {series.length > 1 && (
        <p className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} /> {s.name}</span>)}</p>
      )}
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.values.map((v) => money(v, "CAD")).join(" / ")}`).join("; ")}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={x(max * t)} x2={x(max * t)} y1={0} y2={rows.length * rowH} className="grid" />
            <text x={x(max * t)} y={rows.length * rowH + 14} textAnchor="middle" className="tick">{money(Math.round(max * t), "CAD")}</text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.label} transform={`translate(0 ${i * rowH})`}>
            <text x={LABEL_W - 8} y={wrap(r.label).length > 1 ? BAR_H - 6 : BAR_H - 3} textAnchor="end" className="cat">
              {wrap(r.label).map((line, k) => <tspan key={k} x={LABEL_W - 8} dy={k === 0 ? 0 : LINE_H}>{line}</tspan>)}
            </text>
            {r.values.map((v, j) => (
              <g key={j}>
                <rect x={LABEL_W} y={j * BAR_H} width={Math.max(v > 0 ? 2 : 0, x(v) - LABEL_W)} height={BAR_H - 3} className="bar" style={{ fill: series[j].color }} />
                <text x={x(v) + 6} y={j * BAR_H + BAR_H - 4} className="val">{money(v)}</text>
              </g>
            ))}
          </g>
        ))}
        <text x={LABEL_W + plotW / 2} y={height - 2} textAnchor="middle" className="axis">{valueLabel}</text>
        <text x={2} y={height - 2} className="axis">{categoryLabel}</text>
      </svg>
    </figure>
  );
}

// A real link to ?format=csv. A click goes through fetch so a 401/403 shows a message instead of saving an error page.
export function CsvLink({ href, filename }: { href: string; filename: string }) {
  const [err, setErr] = useState<string>();
  return (
    <>
      <a href={href} download={filename} onClick={async (e) => { e.preventDefault(); setErr(await download(href, filename)); }}>Download CSV</a>
      {err && <span role="alert" className="error"> {err}</span>}
    </>
  );
}

export function ReportSection({ title, csv, children }: { title: string; csv?: { href: string; filename: string }; children: ReactNode }) {
  return (
    <section className="panel report">
      <h2>{title}</h2>
      {csv && <p><CsvLink {...csv} /></p>}
      {children}
    </section>
  );
}
