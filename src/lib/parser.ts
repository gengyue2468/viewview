import * as cheerio from "cheerio";
import { extract, toMarkdown } from "@mizchi/readability";
import TurndownService from "turndown";
import sanitizeHtml from "sanitize-html";

const turndownService = new TurndownService();

function normalizeHtml(html: string) {
  try {
    const cleaned = sanitizeHtml(html, {
      allowedTags: [
        "p", "br", "strong", "em", "u", "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li", "blockquote", "code", "pre", "a", "img", "table",
        "thead", "tbody", "tr", "td", "th", "section", "article", "div", "span"
      ],
      allowedAttributes: {
        a: ["href", "title"],
        img: ["src", "alt", "title"],
        code: ["class"],
      },
      allowedSchemes: ["http", "https", "mailto"],
    });

    const $ = cheerio.load(cleaned);
    $("script, style, noscript, iframe, form, button, input, select, textarea").remove();
    $("div:empty, span:empty").remove();
    
    return $("body").html() ?? $("html").html() ?? cleaned;
  } catch (error) {
    console.warn("HTML 格式化失败:", error);
    return html;
  }
}

async function parseWithReadability(
  url: string,
  html: string,
): Promise<string> {
  try {
    const extracted = extract(html, {
      charThreshold: 100,
    });
    return toMarkdown(extracted.root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Readability 解析失败: ${message}`);
    return "";
  }
}

async function parseWithTurndown(html: string): Promise<string> {
  try {
    return turndownService.turndown(html);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Turndown 解析失败: ${message}`);
    return "";
  }
}

async function htmlParser(url: string, html: string): Promise<string> {
  try {
    const normalizedHtml = normalizeHtml(html);

    const readabilityResult = await parseWithReadability(url, normalizedHtml);
    if (readabilityResult.trim()) {
      return readabilityResult.trim();
    }
    const turndownResult = await parseWithTurndown(normalizedHtml);
    return turndownResult.trim() ? turndownResult.trim() : "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`HTML 解析失败: ${message}`);
    return "";
  }
}

export { htmlParser };
