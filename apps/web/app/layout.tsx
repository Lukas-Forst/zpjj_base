import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "ZPJJ Base",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ZPJJ Base", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#2454E0", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="bg-background text-foreground min-h-dvh">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
