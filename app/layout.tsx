import type { Metadata, Viewport } from "next";
import Boot from "@/components/Boot";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Поштар — маршрути",
  description: "Планування велосипедного маршруту доставки та історія поїздок",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Поштар", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4ed8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <Boot />
        <div className="shell">{children}</div>
        <Nav />
      </body>
    </html>
  );
}
