import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ModelProvider } from "@/components/ModelContext";
import { ModelPicker } from "@/components/ModelPicker";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "March Madness Arena",
    template: "%s | March Madness Arena",
  },
  description:
    "AI-powered NCAA tournament bracket simulator. Watch 64 teams battle through 6 rounds with real-time AI analysis, KenPom-style stats, and full-field bracket visualization.",
  metadataBase: new URL("https://marcharena.com"),
  openGraph: {
    title: "March Madness Arena",
    description:
      "AI-powered NCAA tournament bracket simulator with real-time analysis and full-field visualization.",
    siteName: "March Madness Arena",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "March Madness Arena",
    description:
      "AI-powered NCAA tournament bracket simulator with real-time analysis and full-field visualization.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a1628",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overflow-x-hidden">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-x-hidden`}
      >
        <ModelProvider>
          <nav className="border-b border-[#dcdddf] bg-white">
          <div className="max-w-[1440px] mx-auto px-4 flex items-center justify-between h-12">
            <Link
              href="/"
              className="flex items-center text-[15px] font-bold text-[#121213] tracking-tight"
            >
              <img
                src="/favicon.ico"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 object-contain md:hidden"
                aria-hidden
              />
              <span className="hidden md:inline">March Madness Arena</span>
              <span className="sr-only md:hidden">March Madness Arena</span>
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-[13px] text-[#6c6e6f] hover:text-[#121213] transition-colors"
              >
                Bracket
              </Link>
              <Link
                href="/leaderboard"
                className="text-[13px] text-[#6c6e6f] hover:text-[#121213] transition-colors"
              >
                Leaderboard
              </Link>
              <Link
                href="/survivor"
                className="text-[13px] text-[#6c6e6f] hover:text-[#121213] transition-colors"
              >
                Survivor
              </Link>
              <Link
                href="/about"
                className="text-[13px] text-[#6c6e6f] hover:text-[#121213] transition-colors"
              >
                About
              </Link>
              <div className="h-4 w-px bg-[#dcdddf]" />
              <ModelPicker />
            </div>
          </div>
          </nav>
          {children}
        </ModelProvider>
      </body>
    </html>
  );
}
