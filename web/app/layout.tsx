import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  title: { default: "FeeFlow — Transparent funding from coin creator fees", template: "%s · FeeFlow" },
  description: "Launch a coin and tag anyone on X. They choose who receives its creator fees: themselves, a creator, a project, a cause or a nonprofit. Every payout is public.",
  openGraph: { title: "FeeFlow — Transparent funding from coin creator fees", description: "The account tagged on a coin chooses who receives its creator fees. Every payout is public.", images: ["/feeflow-og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#faf6ee" };

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
