// Recipe import: public http(s) page only (SSRF-safe, IP pinned — see http.ts), HTML stripped to
// text, schema.org Recipe JSON-LD preferred when present (skips the blog story).
import { getPublicPage } from "./http";

export function htmlToText(html: string): string {
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((j) => /"Recipe"/.test(j));
  if (ld) return `STRUCTURED RECIPE DATA:\n${ld.slice(0, 12000)}`;
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 14000);
}

export async function fetchRecipePage(raw: string): Promise<string> {
  const text = htmlToText(await getPublicPage(raw));
  if (text.length < 200) throw new Error("page has too little text to be a recipe");
  return text;
}
