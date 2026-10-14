import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Morrow | Parkinson’s Assessment & Monitoring",
  description: "Morrow is a private research and monitoring portal for voice-only and voice + gait assessment records.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SiteHeader />
          {children}
          <footer className="site-footer">
            <div className="footer-inner">
              <span>© {new Date().getFullYear()} Morrow · Parkinson’s assessment & monitoring</span>
              <span>Morrow is not a medical device and does not diagnose or provide medical advice. It does not replace a qualified clinician or support treatment decisions.</span>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
