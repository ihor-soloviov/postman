"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", glyph: "🗺️", label: "Маршрут" },
  { href: "/history", glyph: "📜", label: "Історія" },
  { href: "/addresses", glyph: "🏠", label: "Адреси" },
  { href: "/settings", glyph: "⚙️", label: "Налаштування" },
];

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;
  return (
    <nav className="nav">
      {ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" || pathname.startsWith("/trip") : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""}>
            <span className="glyph">{item.glyph}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
