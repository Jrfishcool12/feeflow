import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: "Feeward — Creator fees, paid forward", template: "%s · Feeward" },
  description: "Launch a coin and tag someone on X. They choose who receives its creator fees: themselves, another creator, a project, a community or a nonprofit. Every payout comes with a public receipt.",
  openGraph: { title: "Feeward — Creator fees, paid forward", description: "Tag someone on X. They choose who gets supported. Every payout, a public receipt.", images: ["/feeward-og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f7f2" };

// Applies the saved sidebar state before the first paint, so the page doesn't jump.
const SIDEBAR_STATE = `try{if(localStorage.getItem("gc-sb")==="collapsed")document.documentElement.dataset.sb="collapsed"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_STATE }} />
      </head>
      <body>
        <Providers>
          <Sidebar />
          <div className="app">
            <main id="main">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
