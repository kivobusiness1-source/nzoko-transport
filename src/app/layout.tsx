import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { APP_NAME } from "@/lib/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ⚠️ Domaine de production — à adapter si déploiement sous un autre domaine.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.nzoko.cg";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `Réservation de bus au Congo | ${APP_NAME}`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Billets de bus Pointe-Noire, Brazzaville, Dolisie, Ouesso : comparez les départs, payez par MTN Mobile Money et recevez votre billet QR immédiatement.",
  keywords: [
    "bus Congo",
    "billets de bus Brazzaville",
    "bus Pointe-Noire Brazzaville",
    "réservation billet bus Congo-Brazzaville",
    "transport interurbain Congo",
    "bus Dolisie",
    "Océan du Nord",
    "Mobile Money MTN",
  ],
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: APP_NAME,
    title: `Réservation de bus au Congo | ${APP_NAME}`,
    description:
      "Voyagez entre Brazzaville, Pointe-Noire, Dolisie et Ouesso. Paiement MTN Mobile Money, billet QR immédiat, sièges garantis.",
    images: [
      {
        url: "/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: `${APP_NAME} — réservation de bus au Congo`,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: `Réservation de bus au Congo | ${APP_NAME}`,
    description:
      "Brazzaville, Pointe-Noire, Dolisie, Ouesso — paiement MTN Mobile Money et billet QR immédiat.",
    images: ["/icons/icon-512.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e7a4e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
