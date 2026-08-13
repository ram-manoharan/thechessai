import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/components/AuthProvider";
import { OnboardingPrompt } from "@/components/OnboardingPrompt";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const playfair  = Playfair_Display({
  variable: "--font-playfair",
  subsets:  ["latin"],
  weight:   ["400", "600", "700", "900"],
  style:    ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "chessAIlytics — AI Chess Coach",
  description: "Analyse your chess games with Stockfish + AI coaching. For players of all ages.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the page never flashes dark (the
            unstyled :root default) before React hydrates and ThemeProvider's
            effect sets the real value — light is now the default theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('chess-theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();",
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <AuthProvider>
          <ThemeProvider>
            {children}
            <OnboardingPrompt />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
