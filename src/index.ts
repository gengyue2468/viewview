import { Hono, MiddlewareHandler } from "hono";
import { isValidURL, normalizeInputURL } from "./lib/valid";
import { getBrowserDebuggingURL } from "./lib/browser";
import { htmlParser } from "./lib/parser";

import { pluginRegistry } from "./plugins";

const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header("Authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  if (bearerToken !== Bun.env.ACCESS_TOKEN) {
    return c.json({ error: "咦，你是谁啊？" }, 401);
  }
  await next();
};

const app = new Hono();

const method = {
  allowGet: Bun.env.ALLOW_GET === "true",
  allowPost: Bun.env.ALLOW_POST === "true",
};

function getErrorStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null) return 500;

  const status = Reflect.get(error, "status");
  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  const statusCode = Reflect.get(error, "statusCode");
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }

  return 500;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  label: string,
) {
  if (!Number.isFinite(timeout) || timeout <= 0) return promise;
  let id: Timer | undefined;
  const t = new Promise<never>((_, reject) => {
    id = setTimeout(
      () => reject(new Error(`${label} 经过 ${timeout}ms 后超时了`)),
      timeout,
    );
  });
  try {
    return await Promise.race([promise, t]);
  } finally {
    if (id) clearTimeout(id);
  }
}

function buildFrontmatter(
  title: string,
  description: string,
  pageMeta: Record<string, string> | null,
  authors: string[],
  url: string,
  partial: boolean,
): string[] {
  const meta = pageMeta || ({} as Record<string, string>);
  return [
    `title: ${title || "无题"}`,
    description ? `description: ${description}` : null,
    meta.siteName ? `site_name: ${meta.siteName}` : null,
    meta.pageType ? `type: ${meta.pageType}` : null,
    authors.length > 0 ? `author: ${authors.join(", ")}` : null,
    meta.publishedTime ? `published_time: ${meta.publishedTime}` : null,
    meta.modifiedTime ? `modified_time: ${meta.modifiedTime}` : null,
    meta.section ? `section: ${meta.section}` : null,
    meta.keywords ? `keywords: ${meta.keywords}` : null,
    meta.canonicalUrl && meta.canonicalUrl !== url
      ? `canonical_url: ${meta.canonicalUrl}`
      : null,
    `url: ${url}`,
    partial ? `partial: true` : null,
  ].filter(Boolean);
}

async function navigateToURL(
  view: Bun.WebView,
  target: string,
  timeoutMs: number,
): Promise<boolean> {
  let navFailed: Error | null = null;

  const p = new Promise<void>((resolve, reject) => {
    view.onNavigated = () => resolve();
    view.onNavigationFailed = (err) => {
      navFailed = err;
      reject(err);
    };
  });

  await view.navigate(target);

  try {
    await withTimeout(p, timeoutMs, "导航");
  } catch {
    if (navFailed) {
      console.warn(`导航到 ${target} 失败: ${navFailed.message}`);
    }
    return true;
  }

  return false;
}

async function readPage(c: any, url: string) {
  if (!url) return c.json({ error: "似乎没看到 URL" }, 400);

  const normalizedUrl = normalizeInputURL(url);

  if (!isValidURL(normalizedUrl)) {
    return c.json({ error: "URL 无效欸" }, 400);
  }

  const navigateMs = Number(c.req.query("navigate_timeout") ?? "20000");
  const maxWaitMs = Number(c.req.query("max_wait") ?? "60000");
  const stableWindowMs = Number(c.req.query("stable_window") ?? "200");
  const stableThreshold = Number(c.req.query("stable_threshold") ?? "3");

  try {
    let partial = false;

    const view = new Bun.WebView({
      backend: {
        type: "chrome",
        url: await getBrowserDebuggingURL(),
      },
      headless: true,
    });

    try {
      if (await navigateToURL(view, "about:blank", 5000)) {
        partial = true;
      }

      const matchedUA = pluginRegistry.resolve(normalizedUrl);
      if (matchedUA) {
        await view.cdp("Network.setUserAgentOverride", {
          userAgent: matchedUA,
        });
      }

      if (await navigateToURL(view, normalizedUrl, navigateMs)) {
        partial = true;
      }

      let lastLen = -1;
      let stableCount = 0;
      const pollStarted = Date.now();

      while (true) {
        const elapsed = Date.now() - pollStarted;
        if (elapsed >= maxWaitMs) {
          partial = true;
          break;
        }

        let contentLen = 0;
        try {
          contentLen = await withTimeout(
            view.evaluate("document.body?.innerText?.length ?? 0"),
            5000,
            "evaluate",
          );
        } catch {}

        if (contentLen > 100) {
          if (contentLen === lastLen) {
            stableCount++;
            if (stableCount >= stableThreshold) break;
          } else {
            stableCount = 0;
            lastLen = contentLen;
          }
        }

        await new Promise((r) => setTimeout(r, stableWindowMs));
      }

      const title = await withTimeout(
        view.evaluate(`document.title
          || document.querySelector('meta[property="og:title"]')?.content
          || document.querySelector('meta[name="twitter:title"]')?.content
          || document.querySelector('h1')?.textContent?.trim()
          || document.querySelector('h2')?.textContent?.trim()
          || ""`),
        5000,
        "evaluate",
      ).catch(() => "");
      const description = await withTimeout(
        view.evaluate(`document.querySelector('meta[name="description"]')?.content
          || document.querySelector('meta[property="og:description"]')?.content
          || document.querySelector('meta[name="twitter:description"]')?.content
          || document.querySelector('p')?.textContent?.trim()
          || ""`),
        5000,
        "evaluate",
      ).catch(() => "");
      const pageMeta = (await withTimeout(
        view.evaluate(`({
          siteName:
            document.querySelector('meta[property="og:site_name"]')?.content ||
            document.querySelector('meta[name="application-name"]')?.content ||
            "",
          pageType:
            document.querySelector('meta[property="og:type"]')?.content || "",
          publishedTime:
            document.querySelector('meta[property="article:published_time"]')
              ?.content ||
            document.querySelector('meta[property="og:published_time"]')
              ?.content ||
            document.querySelector('meta[name="pubdate"]')?.content ||
            "",
          modifiedTime:
            document.querySelector('meta[property="article:modified_time"]')
              ?.content ||
            document.querySelector('meta[property="og:updated_time"]')
              ?.content ||
            document.querySelector('meta[name="lastmod"]')?.content ||
            "",
          keywords:
            document.querySelector('meta[name="keywords"]')?.content ||
            document.querySelector('meta[property="article:tag"]')?.content ||
            "",
          section:
            document.querySelector('meta[property="article:section"]')?.content ||
            "",
          canonicalUrl:
            document.querySelector('link[rel="canonical"]')?.href || "",
        })`),
        5000,
        "evaluate",
      ).catch(() => ({
        siteName: "",
        pageType: "",
        publishedTime: "",
        modifiedTime: "",
        keywords: "",
        section: "",
        canonicalUrl: "",
      }))) as {
        siteName: string;
        pageType: string;
        publishedTime: string;
        modifiedTime: string;
        keywords: string;
        section: string;
        canonicalUrl: string;
      };

      const authors: string[] = await withTimeout(
        view.evaluate(
          `Array.from(document.querySelectorAll('meta[name="author"], meta[property="article:author"]')).map(el => el.content).filter(Boolean)`,
        ),
        5000,
        "evaluate",
      ).catch(() => [] as string[]);
      const html = await withTimeout(
        view.evaluate("document.documentElement.outerHTML"),
        5000,
        "evaluate",
      ).catch(() => "");
      const text = await withTimeout(
        view.evaluate("document.documentElement.innerText"),
        5000,
        "evaluate",
      ).catch(() => "");

      const rawText =
        (await htmlParser(url, html as string)) || (text as string);
      const frontmatter = buildFrontmatter(
        title,
        description,
        pageMeta,
        authors,
        normalizedUrl,
        partial,
      );

      const finalText = `---
${frontmatter.join("\n")}
---

${rawText}
          `;

      return c.text(finalText);
    } finally {
      view.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(
      { error: "抓取页面失败", message },
      getErrorStatusCode(error),
    );
  }
}

app.get("/", (c) => {
  const getMethodIntro = method.allowGet ? "GET /:url" : null;
  const postMethodIntro = method.allowPost
    ? 'POST /read with JSON body { "url": "..." }'
    : null;

  const endpoints = [getMethodIntro, postMethodIntro].filter(Boolean);

  return c.text(`# viewview

## Usage:
${endpoints.map((e) => `- ${e}`).join("\n")}

## Response:
- Content-Type: text/plain
- Body: Markdown text with frontmatter containing metadata like title, description, authors, etc.

## Example:
${method.allowGet ? "- GET /https%3A%2F%2Fexample.com" : ""}
${method.allowPost ? '- POST /read with body { "url": "https://example.com" }' : ""}

## Health Check:
- GET /health

[View on GitHub](https://github.com/gengyue2468/viewview)
`);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/*", (c) => {
  const url = decodeURIComponent(c.req.path.slice(1));

  if (!method.allowGet) {
    return c.json({ error: "Method Not Allowed" }, 405);
  }
  return readPage(c, url);
});

app.post("/read", authMiddleware, async (c) => {
  if (!method.allowPost) {
    return c.json({ error: "Method Not Allowed" }, 405);
  }
  const req = await c.req.json();
  return readPage(c, req.url);
});

Bun.serve({
  fetch: app.fetch,
  port: 9233,
  idleTimeout: 120,
});
