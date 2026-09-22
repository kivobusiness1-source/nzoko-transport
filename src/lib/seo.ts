// ============================================================
// NZOKO TRANSPORT — Helpers SEO (SERVEUR uniquement)
// Utilise headers() de Next.js → à n'importer que depuis des
// composants serveur / routes de métadonnées.
// ============================================================

import { headers } from "next/headers";
import { APP_NAME, APP_SLOGAN } from "@/lib/constants";
import { FAQ_ITEMS, SEO_TEXT } from "@/lib/seo-content";
import type { CityDTO } from "@/types";

/**
 * Base URL réelle de la requête courante (protocole + hôte transmis par le
 * proxy). Sert au canonical, aux URLs Open Graph et au sitemap : la version
 * canonique est celle effectivement servie — jamais une URL « au hasard ».
 * Repli hors requête (build) : localhost.
 */
export async function getBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // Rendu hors contexte de requête (génération statique) — repli neutre.
  }
  return "http://localhost:3000";
}

/**
 * JSON-LD en @graph : Organization + WebSite + FAQPage.
 * Contraintes respectées :
 *  — aucune donnée inventée (pas d'avis, note, prix, téléphone, adresse) ;
 *  — FAQPage reflète EXACTEMENT le contenu visible (FAQ_ITEMS partagé) ;
 *  — areaServed = villes réellement actives en base ;
 *  — pas de SearchAction : la recherche vit dans l'application (aucune
 *    URL paramétrée indexable — l'inventer serait une fausse donnée).
 */
export function buildJsonLd({
  baseUrl,
  cities,
}: {
  baseUrl: string;
  cities: CityDTO[];
}): { "@context": string; "@graph": object[] } {
  const url = `${baseUrl}/`;
  const graph: object[] = [
    {
      "@type": "Organization",
      "@id": `${baseUrl}/#organization`,
      name: APP_NAME,
      url,
      logo: `${baseUrl}/icons/icon-512.png`,
      slogan: APP_SLOGAN,
      description: SEO_TEXT.organizationDescription,
      areaServed: cities.length
        ? [...cities.map((c) => c.name), "Congo-Brazzaville"]
        : "Congo-Brazzaville",
    },
    {
      "@type": "WebSite",
      "@id": `${baseUrl}/#website`,
      name: APP_NAME,
      url,
      inLanguage: "fr",
      description: SEO_TEXT.description,
      publisher: { "@id": `${baseUrl}/#organization` },
    },
    {
      "@type": "FAQPage",
      "@id": `${baseUrl}/#faq`,
      mainEntity: FAQ_ITEMS.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    },
  ];
  return { "@context": "https://schema.org", "@graph": graph };
}
