import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/seo";

// robots.txt — pages publiques explorables, endpoints API exclus
// (JSON sans valeur d'indexation → économie de budget d'exploration).
// ⚠️ robots.txt n'est PAS un mécanisme de sécurité : /api/* est protégé
// par authentification/autorisation côté serveur (voir audits sécurité).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getBaseUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
