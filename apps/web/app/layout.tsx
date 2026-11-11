import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

const sans = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter-tight", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "ZPJJ Base",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ZPJJ Base", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#F3F1EC", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-paper text-ink font-sans min-h-dvh">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
