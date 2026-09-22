import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/seo";

// Sitemap XML — uniquement les pages publiques indexables.
// La plateforme est monopage ("/") : les vues (réservation, suivi,
// espaces métier) sont des états clients non indexables, et /api/*
// est exclue. URL absolue construite sur l'hôte réellement servi.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getBaseUrl();
  return [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
