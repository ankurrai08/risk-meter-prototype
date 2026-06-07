"use client";
import { useEffect, useRef } from "react";

export default function Gauge({ value, label }: { value: number; label: string }) {
  const arcRef = useRef<SVGPathElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const total = 390;
  const pct = Math.max(0, Math.min(100, value));

  useEffect(() => {
    if (arcRef.current) {
      arcRef.current.style.strokeDashoffset = String(total - total * (pct / 100));
    }
    if (needleRef.current) {
      needleRef.current.setAttribute("transform", `rotate(${-90 + 180 * (pct / 100)} 160 150)`);
    }
  }, [pct]);

  const color = pct >= 60 ? "var(--bad)" : pct >= 30 ? "var(--blue)" : "var(--good)";

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="100%" height="150" viewBox="0 0 320 168" style={{ display: "block", margin: "0 auto", maxWidth: 320 }}>
        <defs>
          <linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8fbbe8" />
            <stop offset="60%" stopColor="#006fcf" />
            <stop offset="100%" stopColor="#00175a" />
          </linearGradient>
        </defs>
        <path d="M 36 150 A 124 124 0 0 1 284 150" fill="none" stroke="#e7f1fb" strokeWidth="15" strokeLinecap="round" />
        <path
          ref={arcRef}
          d="M 36 150 A 124 124 0 0 1 284 150"
          fill="none"
          stroke="url(#gg)"
          strokeWidth="15"
          strokeLinecap="round"
          strokeDasharray={total}
          strokeDashoffset={total}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)" }}
        />
        <g ref={needleRef} transform="rotate(-90 160 150)" style={{ transition: "transform 1s cubic-bezier(.16,1,.3,1)" }}>
          <line x1="160" y1="150" x2="160" y2="56" stroke="#00175a" strokeWidth="3.5" strokeLinecap="round" />
        </g>
        <circle cx="160" cy="150" r="9" fill="#00175a" />
        <circle cx="160" cy="150" r="3.5" fill="#fff" />
      </svg>
      <div className="df" style={{ fontWeight: 800, fontSize: 42, color, lineHeight: 1, marginTop: -8 }}>{pct.toFixed(1)}%</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
