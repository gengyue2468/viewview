import { extract, toMarkdown } from "@mizchi/readability";
import * as cheerio from "cheerio";

function normalizeHtml(html: string) {
  try {
    const $ = cheerio.load(html);
    return $("body").html() ?? "";
  } catch (error) {
    console.warn("HTML 格式化失败:", error);
    return html; 
  }
}

async function htmlParser(url: string, html: string): Promise<string> {
  try {
    const normalizedHtml = normalizeHtml(html);
    const extracted = extract(normalizedHtml, {
      charThreshold: 100,
    });

    if (!extracted?.root) {
      console.warn(`没有找到文章根元素 ${url}`);
      return "";
    }
    const parsed = toMarkdown(extracted.root);

    if (typeof parsed !== "string" || parsed.trim().length === 0) {
      console.warn(`Markdown 转换为空 ${url}`);
      return "";
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`HTML 解析失败: ${message}`);
    return "";
  }
}

export { htmlParser };
