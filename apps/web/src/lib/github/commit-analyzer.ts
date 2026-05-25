/**
 * GitHub Commit Analyzer — clasifica commits del repo HIS según conventional
 * commits para alimentar el KPI gob_cambios_estandar.
 *
 * Considera "estandarizado" todo commit con prefijo `feat(...)`, `fix(...)`
 * o `chore(...)` siguiendo el patrón conventional. "Personalizado" son los
 * que NO siguen el patrón (commits ad-hoc, hotfixes sin tag, etc.).
 *
 * Requiere env var `GITHUB_TOKEN` con permiso read del repo. Si falta o
 * la API falla, retorna null para que el KPI caiga al placeholder UI.
 *
 * Cache simple en memoria (5 min) para no llamar GitHub en cada render.
 */

const REPO_OWNER = "edwinaml-su";
const REPO_NAME  = "his";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface Commit {
  sha: string;
  commit: { message: string };
}

interface AnalysisResult {
  total: number;
  estandar: number;
  pct: number;
}

let cache: { key: string; expiresAt: number; result: AnalysisResult | null } | null = null;

function classify(message: string): "estandar" | "personalizado" {
  // Acepta: feat(scope): ..., fix(scope): ..., chore(scope): ..., docs(...):, refactor(...):
  // Pero solo cuenta como "estandarizado" feat/fix/chore (productivos para usuarios).
  const head = message.split("\n")[0]?.trim() ?? "";
  return /^(feat|fix|chore)(\([^)]+\))?:/i.test(head) ? "estandar" : "personalizado";
}

export async function analyzeCommitsInRange(
  desde: Date,
  hasta: Date,
): Promise<AnalysisResult | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const cacheKey = `${desde.toISOString()}_${hasta.toISOString()}`;
  if (cache && cache.key === cacheKey && cache.expiresAt > Date.now()) {
    return cache.result;
  }

  try {
    const url = new URL(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits`);
    url.searchParams.set("since", desde.toISOString());
    url.searchParams.set("until", hasta.toISOString());
    url.searchParams.set("per_page", "100");

    // Paginar hasta 5 páginas (500 commits máx) para no abusar de rate limit.
    let total = 0;
    let estandar = 0;
    for (let page = 1; page <= 5; page++) {
      url.searchParams.set("page", String(page));
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Server actions corren server-side — sin cache de Next.
        cache: "no-store",
      });
      if (!r.ok) {
        cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, result: null };
        return null;
      }
      const commits = (await r.json()) as Commit[];
      if (!Array.isArray(commits) || commits.length === 0) break;
      for (const c of commits) {
        total++;
        if (classify(c.commit.message) === "estandar") estandar++;
      }
      if (commits.length < 100) break;
    }

    const result: AnalysisResult = {
      total,
      estandar,
      pct: total > 0 ? (estandar / total) * 100 : 0,
    };
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, result };
    return result;
  } catch {
    cache = { key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS, result: null };
    return null;
  }
}
