# fig

用 `Bun.Webview` 方法实现的抓取页面的妙妙小玩具，绿皮科技，似乎不太稳定

程序会首先用 `cheerio` 和 `sanitize-html` 解析并清洗 HTML，然后尝试用 `@mizchi/readability` 将正文转换成人类可读的 Markdown 格式，如果失败了会用 `turndown` 再尝试一次转换，最后组成一个包含 frontmatter 元数据的 Markdown 文档返回。

此外，程序套壳了一个 `Hono` HTTP 服务端，支持 `POST /read` 接口，示例请求：

```
curl -X POST http://localhost:9233/read \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-magic-auth-token" \
  -d '{"url":"https://www.gengyue.site"}'
```

> 需要在 `.env` 中设置 `AUTH_TOKEN` 来鉴权，如果留空或未配置则步鉴权.

需要在服务端安装 chromium 或者 chrome 或者 edge 并暴露 cdp 调试端口

详情见[这篇博客](https://www.gengyue.site/blog/build-fig-via-bun-webview/)
