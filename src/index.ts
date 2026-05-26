import { Hono, MiddlewareHandler } from "hono";
import { isValidURL, normalizeInputURL } from "./lib/valid";
import { getBrowserDebuggingURL } from "./lib/browser";
import { NetworkIdleTracker } from "./lib/network-idle";
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

async function waitForPageLoadComplete(view: Bun.WebView, timeout: number) {
  if (!Number.isFinite(timeout) || timeout <= 0) return;

  const startedAt = Date.now();
  while (true) {
    const readyState = await view.evaluate("document.readyState");
    if (readyState === "complete") return;

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeout) {
      throw new Error(`页面经过 ${timeout}ms 仍未加载完毕`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function readPage(c: any, url: string) {
  if (!url) {
    return c.json({ error: "似乎没看到 URL" }, 400);
  }

  const normalizedUrl = normalizeInputURL(url);

  if (!isValidURL(normalizedUrl)) {
    return c.json({ error: "URL 无效欸" }, 400);
  }

  const waitMs = Number(c.req.query("wait") ?? "240000");
  const idleMs = Number(c.req.query("idle") ?? "2000");

  try {
    let navigationFailed: Error | null = null;

    const view = new Bun.WebView({
      backend: {
        type: "chrome",
        url: await getBrowserDebuggingURL(),
      },
      headless: true,
    });

    view.onNavigationFailed = (err) => {
      navigationFailed = err;
    };

    async function navigateAndWait(target: string, timeout: number, idleTime?: number) {
      navigationFailed = null;
      const p = new Promise<void>((resolve, reject) => {
        view.onNavigated = () => {
          resolve();
        };
        view.onNavigationFailed = (err) => {
          navigationFailed = err;
          reject(err);
        };
      });
      await view.navigate(target);
      await withTimeout(p, timeout, "onNavigated");
      if (navigationFailed) throw navigationFailed;
      await withTimeout(
        waitForPageLoadComplete(view, timeout),
        timeout,
        "pageLoad",
      );

      if (idleTime && idleTime > 0) {
        const tracker = new NetworkIdleTracker(view, { idleTime });
        await tracker.start();
        await withTimeout(tracker.waitForIdle(), timeout, "networkIdle");
        tracker.stop();
      }
    }

    try {
      await navigateAndWait("about:blank", 5000);

      const matchedUA = pluginRegistry.resolve(normalizedUrl);
      if (matchedUA) {
        await view.cdp("Network.setUserAgentOverride", {
          userAgent: matchedUA,
        });
      }

      await navigateAndWait(normalizedUrl, waitMs, idleMs);

      const title = await view.evaluate(`document.title
          || document.querySelector('meta[property="og:title"]')?.content
          || document.querySelector('meta[name="twitter:title"]')?.content
          || document.querySelector('h1')?.textContent?.trim()
          || document.querySelector('h2')?.textContent?.trim()
          || ""`);
      const description =
        await view.evaluate(`document.querySelector('meta[name="description"]')?.content
          || document.querySelector('meta[property="og:description"]')?.content
          || document.querySelector('meta[name="twitter:description"]')?.content
          || document.querySelector('p')?.textContent?.trim()
          || ""`);
      const pageMeta = (await view.evaluate(`({
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
        })`)) as {
        siteName: string;
        pageType: string;
        publishedTime: string;
        modifiedTime: string;
        keywords: string;
        section: string;
        canonicalUrl: string;
      };

      const authors: string[] = await view.evaluate(
        `Array.from(document.querySelectorAll('meta[name="author"], meta[property="article:author"]')).map(el => el.content).filter(Boolean)`,
      );
      const html = await view.evaluate("document.documentElement.outerHTML");
      const text = await view.evaluate("document.documentElement.innerText");

      const rawText =
        (await htmlParser(url, html as string)) || (text as string);
      const frontmatter = [
        `title: ${title || "无题"}`,
        description ? `description: ${description}` : null,
        pageMeta.siteName ? `site_name: ${pageMeta.siteName}` : null,
        pageMeta.pageType ? `type: ${pageMeta.pageType}` : null,
        authors.length > 0 ? `author: ${authors.join(", ")}` : null,
        pageMeta.publishedTime
          ? `published_time: ${pageMeta.publishedTime}`
          : null,
        pageMeta.modifiedTime
          ? `modified_time: ${pageMeta.modifiedTime}`
          : null,
        pageMeta.section ? `section: ${pageMeta.section}` : null,
        pageMeta.keywords ? `keywords: ${pageMeta.keywords}` : null,
        pageMeta.canonicalUrl && pageMeta.canonicalUrl !== normalizedUrl
          ? `canonical_url: ${pageMeta.canonicalUrl}`
          : null,
        `url: ${normalizedUrl}`,
      ].filter(Boolean);

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

  return c.json({
    endpoints
  });
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
});
