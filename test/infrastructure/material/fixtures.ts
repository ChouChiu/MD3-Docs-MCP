export const homeHtml =
  '<html><body><script src="/static/angular/main.abc123.js" type="module"></script></body></html>';

export const mainScript = `
const env={environment:{carbonVersion:"2026-01-02_03-04-05"}};
const metadata=[
{"slug":"components/buttons","metadata":{"share_title":"Buttons – Material Design 3"},"description":"Buttons let people take action."}
];
const routes=[
{"slug":"components/buttons","exportedCarbonFileId":"buttons.json","carbonPath":"m3/pages/buttons","theme":"green","tabs":[{"label":"Overview","icon":"info"},{"label":"Guidelines","icon":"design_services"}]},
{"slug":"styles/color","exportedCarbonFileId":"color.json","carbonPath":"m3/pages/color","theme":"purple"}
];`;

export const sitemapXml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://m3.material.io/components/buttons/overview</loc><lastmod>2026-01-02</lastmod></url>
  <url><loc>https://m3.material.io/components/buttons/guidelines</loc><lastmod>2026-01-02</lastmod></url>
  <url><loc>https://m3.material.io/styles/color</loc><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://m3.material.io/blog/ignored</loc></url>
  <url><loc>https://example.com/components/buttons</loc></url>
</urlset>`;

export const documentJson = JSON.stringify({
  title: "Buttons",
  description: "Buttons let people take action.",
  updatedTimestamp: "2026-01-02T00:00:00Z",
  sections: [
    {
      name: "Overview",
      isVisible: true,
      contentBlocks: [
        {
          title: "Usage",
          contentChunks: [
            {
              contentChunkType: "TEXT",
              htmlValue:
                "<p>Use buttons for <strong>important</strong> actions.</p><ul><li>Save</li></ul>",
            },
            {
              contentChunkType: "IMAGE",
              imageUrl: "https://example.invalid/button.png",
              imageWidth: 800,
              imageHeight: 400,
              altText: "Five button variants",
              footer: "<p>Button variants</p>",
            },
          ],
        },
      ],
    },
    {
      name: "Guidelines",
      isVisible: true,
      contentBlocks: [
        {
          contentChunks: [
            {
              contentChunkType: "TEXT",
              htmlValue: "<h2>Labels</h2><p>Keep labels concise.</p>",
            },
          ],
        },
      ],
    },
  ],
});

export function createFixtureFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/") return new Response(homeHtml);
    if (url.pathname === "/static/angular/main.abc123.js") return new Response(mainScript);
    if (url.pathname === "/sitemap.xml") {
      return new Response(sitemapXml, { headers: { "content-type": "application/xml" } });
    }
    if (url.pathname.endsWith("/buttons.json")) {
      return new Response(documentJson, { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/search_api") {
      return new Response(
        JSON.stringify({
          items: [
            {
              title: "Buttons",
              link: "https://m3.material.io/components/buttons/guidelines",
              snippet: "Buttons help people take action.",
            },
            {
              title: "Blog",
              link: "https://m3.material.io/blog/buttons",
              snippet: "Ignored.",
            },
            {
              title: "External",
              link: "https://example.com/components/buttons",
              snippet: "Ignored.",
            },
          ],
        }),
      );
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}
