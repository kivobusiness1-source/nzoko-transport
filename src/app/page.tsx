import { headers } from "next/headers";
import NzokoApp from "@/components/app/nzoko-app";

// ============================================================
// Données structurées Schema.org (JSON-LD) — contenu 100 % statique,
// construit côté serveur, aucune donnée utilisateur injectée.
// ============================================================
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.nzoko.cg";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TravelAgency",
      "@id": `${SITE_URL}/#organization`,
      name: "NZOKO TRANSPORT",
      slogan: "Voyagez simplement. Voyagez en confiance.",
      url: SITE_URL,
      logo: `${SITE_URL}/icons/icon-512.png`,
      telephone: "+242 06 123 45 67",
      areaServed: [
        { "@type": "City", name: "Pointe-Noire" },
        { "@type": "City", name: "Brazzaville" },
        { "@type": "City", name: "Dolisie" },
        { "@type": "City", name: "Nkayi" },
        { "@type": "City", name: "Ouesso" },
      ],
      address: {
        "@type": "PostalAddress",
        streetAddress: "Boulevard Charles de Gaulle",
        addressLocality: "Pointe-Noire",
        addressCountry: "CG",
      },
      paymentAccepted: "MTN Mobile Money, Espèces, Carte bancaire, Virement",
      currenciesAccepted: "XAF",
      openingHours: "Mo-Su 06:00-20:00",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "NZOKO TRANSPORT",
      inLanguage: "fr",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default async function Page() {
  // Nonce CSP fourni par src/middleware.ts (x-nonce) : appliqué au
  // JSON-LD, seul script inline du document. La lecture de headers()
  // rend la page dynamique — requis pour un nonce par requête.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      {/* JSON-LD statique : safe (aucune entrée utilisateur).
          suppressHydrationWarning : le navigateur RETIRE l'attribut
          nonce du DOM après l'évaluation (spec CSP, anti-exfiltration)
          → React signalerait un attribut manquant sans cela. */}
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <NzokoApp />
    </>
  );
}
