import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

export const dynamic = "force-dynamic";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Powers Tree Farm Counting",
  description: "Yard Receiving and Shipping tree counts for Powers Tree Farm, Lansing, NC.",
  applicationName: "PTF Count",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "PTF Count",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#13261b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${fraunces.variable}`} style={{ fontFamily: "var(--font-sans), Outfit, sans-serif" }}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
