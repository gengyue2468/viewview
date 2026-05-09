//偷来的 valid.ts，以后改改

const URL_PATTERN = /https?:\/\/[^\s<>"'`\]]+/gi;

const FILTERED_HOSTS = [
  'multimedia.nt.qq.com.cn',
  'qqdocument.qq.com',
  'docs.qq.com',
  'm.q.qq.com',
];

const IMAGE_CDN_HOSTS = [
  'pic.ugcimg.cn',
  'p.qpic.cn',
  'qpic.cn',
  'imgcache.qq.com',
  'shp.qpic.cn',
  'gchat.qpic.cn',
  'c2cpicdw.qpic.cn',
  'mmbiz.qpic.cn',
  'thirdqq.qlogo.cn',
  'q.qlogo.cn',
  'wx.qlogo.cn',
];

const SHORT_LINK_HOSTS = [
  'ourl.co',
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'short.link',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'tiny.cc',
  'bit.do',
  'b23.tv',
];

const FILE_EXTENSION_PATTERN = /\.(png|jpg|jpeg|webp|gif|bmp|svg|ico|mp4|mp3|wav|zip|rar|7z|exe|apk|pdf|docx|xlsx|pptx|txt|csv|json|xml)$/i;
const HOSTNAME_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const PACKAGE_NAME_PATTERN = /^(com|org|net)\.[a-z]+\.[a-z]+$/i;
const API_PATTERNS = [
  /\/api\//i,
  /\/v\d+\//,
  /\/download\//i,
  /\/upload\//i,
  /\/(jpg|png|webp|gif)\d+$/i,
];

function normalizeUrl(rawUrl: string) {
  return rawUrl.replace(/&amp;/g, '&').trim();
}

export function isValidURL(rawUrl: string) {
  if (!rawUrl) {
    return false;
  }

  const url = normalizeUrl(rawUrl);

  if (!/^https?:\/\//i.test(url)) {
    return false;
  }

  return !isFilteredUrl(url) && hasValidHostname(url);
}

function extractJsonCardUrls(text: string) {
  const urls: string[] = [];
  const cqJsonPrefix = '[CQ:json,data=';

  if (!text.includes(cqJsonPrefix)) {
    return urls;
  }

  try {
    const start = text.indexOf(cqJsonPrefix) + cqJsonPrefix.length;
    const firstBrace = text.indexOf('{', start);
    if (firstBrace === -1) {
      return urls;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let index = firstBrace; index < text.length; index += 1) {
      const character = text[index];
      if (escape) {
        escape = false;
        continue;
      }

      if (character === '\\' && inString) {
        escape = true;
        continue;
      }

      if (character === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    if (end === -1) {
      return urls;
    }

    const jsonString = text
      .slice(firstBrace, end + 1)
      .replace(/&#44;/g, ',')
      .replace(/&amp;/g, '&')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/\\\//g, '/');

    const payload = JSON.parse(jsonString) as {
      meta?: {
        news?: { jumpUrl?: string };
        detail_1?: { qqdocurl?: string; url?: string };
      };
    };

    const newsUrl = payload.meta?.news?.jumpUrl;
    if (newsUrl) {
      urls.push(newsUrl);
    }

    const qqDocUrl = payload.meta?.detail_1?.qqdocurl;
    if (qqDocUrl) {
      urls.push(qqDocUrl);
    } else {
      const detailUrl = payload.meta?.detail_1?.url;
      if (detailUrl) {
        urls.push(detailUrl.startsWith('http') ? detailUrl : `https://${detailUrl}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[URL Extract] JSON parsing failed:', message);
  }

  return urls;
}

function hasValidHostname(url: string) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (!HOSTNAME_PATTERN.test(hostname)) {
      return false;
    }

    if (PACKAGE_NAME_PATTERN.test(hostname) && !hostname.endsWith('.com') && !hostname.endsWith('.org')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function isFilteredUrl(url: string) {
  if (url.includes('CQ:') || url.includes('download?appid=')) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (FILTERED_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }

    if (IMAGE_CDN_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }

    if (hostname === 'mp.weixin.qq.com' && pathname.startsWith('/s/')) {
      const match = pathname.match(/\/s\/([a-z0-9_-]+)/i);
      if (!match || match[1] === undefined || match[1].length < 15) {
        return true;
      }
    }

    if (FILE_EXTENSION_PATTERN.test(pathname)) {
      return true;
    }

    if (!SHORT_LINK_HOSTS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      if (API_PATTERNS.some((pattern) => pattern.test(url))) {
        return true;
      }
    }
  } catch {
    return true;
  }

  return false;
}

export function extractValidURLs(text: string) {
  if (!text) {
    return [];
  }

  const jsonCardUrls = extractJsonCardUrls(text).map(normalizeUrl);
  if (jsonCardUrls.length > 0) {
    return [...new Set(jsonCardUrls)].filter(isValidURL);
  }

  const matches = text.match(URL_PATTERN) || [];
  return [...new Set(matches.map(normalizeUrl))].filter(isValidURL);
}