"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Live Surveillance" },
  { href: "/alerts", label: "Alert Studio" },
  { href: "/triggers", label: "Trigger Studio" },
  { href: "/learn", label: "Measure & Learn" },
  { href: "/audit", label: "Audit Log" },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 30px", background: "rgba(255,255,255,.85)", backdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--line2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span className="df" style={{ fontWeight: 800, fontSize: 13, letterSpacing: ".14em", color: "#fff", background: "var(--navy)", padding: "6px 11px", borderRadius: 6 }}>AMEX</span>
        <span className="df" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", letterSpacing: "-.01em" }}>
          Risk <span style={{ color: "var(--blue)" }}>Meter</span>
        </span>
        <span className="mono" style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)" }}>
          Prototype · Servicing Capabilities &amp; Innovation
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className="mono"
              style={{
                fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase",
                padding: "8px 14px", borderRadius: 20,
                color: active ? "#fff" : "var(--muted)",
                background: active ? "var(--blue)" : "transparent",
                transition: "all .2s",
              }}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
