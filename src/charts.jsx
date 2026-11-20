// Small, dependency-free chart pieces. One job each; values are always readable without hovering.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/** Stage identity colours (categorical, fixed order, validated for colour-blind separation). */
export const STAGE_COLOR = {
  fabric: "var(--s-fabric)", printing: "var(--s-printing)", cutting: "var(--s-cutting)",
  packing: "var(--s-packing)", ready: "var(--s-ready)", delivered: "var(--good)",
};
// Text set inside a coloured block: near-black on the light hues, white on the dark ones.
const INK_ON = { fabric: "#fff", printing: "#0b0b0b", cutting: "#0b0b0b", packing: "#0b0b0b", ready: "#0b0b0b" };

export const compact = (v) => (v >= 10000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, "")}K` : Math.round(v).toLocaleString("en-IN"));

/** One floating tooltip for anything carrying a data-tip attribute (hover or keyboard focus). */
export function TipLayer() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const show = (e) => {
      const el = e.target.closest?.("[data-tip]");
      if (!el) return setTip(null);
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.tip, x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110), y: r.top });
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", show); document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide); window.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mouseover", show); document.removeEventListener("focusin", show); document.removeEventListener("focusout", hide); window.removeEventListener("scroll", hide, true); };
  }, []);
  if (!tip) return null;
  return <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text.split("\n").map((l, i) => <div key={i}>{l}</div>)}</div>;
}

const ICONS = {
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17.2v.3" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  truck: <><path d="M2.5 7h11v9h-11zM13.5 10.5h4l3 3V16h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  roll: <><ellipse cx="7" cy="12" rx="3.5" ry="7" /><path d="M7 5h10c2 0 3.5 3 3.5 7s-1.5 7-3.5 7H7" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};
export const Icon = ({ name, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name]}</svg>
);

/** Headline number with a coloured icon. Tone only lights up when the value needs attention. */
export function StatTile({ label, value, note, icon, tone = "neutral", to }) {
  return (
    <Link to={to} className={`tile ${tone}`}>
      <span className="tile-icon"><Icon name={icon} /></span>
      <span className="tile-body">
        <span className="tile-label">{label}</span>
        <span className="tile-value">{value}</span>
        {note && <span className="tile-note">{note}</span>}
      </span>
    </Link>
  );
}

/** One whole split into parts: open orders by stage. */
export function StageBar({ stages }) {
  const total = stages.reduce((a, s) => a + s.count, 0);
  if (!total) return <p className="muted">No open orders.</p>;
  return (
    <div>
      <div className="segbar" role="img" aria-label={stages.map((s) => `${s.label}: ${s.count}`).join(", ")}>
        {stages.filter((s) => s.count > 0).map((s) => (
          <Link key={s.key} to={`/orders?stage=${s.key}`} className="seg-block" tabIndex={0}
            style={{ flexGrow: s.count, background: STAGE_COLOR[s.key], color: INK_ON[s.key] }}
            data-tip={`${s.label}\n${s.count} order${s.count === 1 ? "" : "s"} · ${Math.round((s.count / total) * 100)}%${s.late ? `\n${s.late} late` : ""}`}>
            {s.count / total >= 0.05 && s.count}
          </Link>
        ))}
      </div>
      <div className="seg-legend">
        {stages.map((s) => (
          <Link key={s.key} to={`/orders?stage=${s.key}`} className="seg-key">
            <i style={{ background: STAGE_COLOR[s.key] }} />
            <span>{s.label}</span>
            {(s.count === 0 || s.count / total < 0.05) && <b>{s.count}</b>}
            {s.late > 0 && <em>{s.late} late</em>}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Columns on one baseline. `tone` per column: "critical" | "muted" | default series colour. */
export function Columns({ data, height = 150, format = (v) => v, unit = "" }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="cols" style={{ "--cols-h": `${height}px` }}>
      {data.map((d) => (
        <div key={d.key} className={`col ${d.tone || ""} ${d.strong ? "strong" : ""}`} tabIndex={0}
          data-tip={`${d.tip || d.label}\n${format(d.value)}${unit ? " " + unit : ""}`}>
          <div className="col-plot">
            {d.value > 0 && <span className="col-val">{format(d.value)}</span>}
            <div className="col-bar" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 3 : 0 }} />
          </div>
          <div className="col-label">{d.label}{d.sub && <small>{d.sub}</small>}</div>
        </div>
      ))}
    </div>
  );
}

const STATUS_ICON = { critical: "alert", warning: "clock", good: "check" };
const SWATCH = { White: "#ffffff", Red: "#c8372d", Green: "#2f8f4e", Navy: "#1f3a6e", Black: "#1c1c1c", Cream: "#f1e3bf", Blue: "#2a78d6", Yellow: "#eec223" };
export const Swatch = ({ color }) => <i className="swatch" style={{ background: SWATCH[color] || "#bdbab0" }} title={color} />;

/** A named row per item: how much we have against how much we need. */
export function MeterList({ rows }) {
  return (
    <div className="meters">
      {rows.map((r) => {
        const pct = r.target > 0 ? Math.min(100, (r.value / r.target) * 100) : 100;
        return (
          <div key={r.key} className={`meter ${r.status}`} tabIndex={0} data-tip={r.tip}>
            <div className="meter-name"><Swatch color={r.color} /><span>{r.name}{r.detail && <small>{r.detail}</small>}</span></div>
            <div className="meter-track"><i style={{ width: `${pct}%` }} /></div>
            <div className="meter-fig"><b>{Math.round(r.value).toLocaleString("en-IN")}</b>{r.target > 0 && <> / {Math.round(r.target).toLocaleString("en-IN")}</>} kg</div>
            <div className="meter-status"><Icon name={STATUS_ICON[r.status]} size={14} />{r.statusLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
