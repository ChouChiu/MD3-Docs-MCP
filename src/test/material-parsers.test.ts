import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectory,
  cleanSearchText,
  discoverMainScript,
  findRouteForPath,
  getCategory,
  normalizeAndValidatePath,
  normalizeLoosePath,
  parseDocumentData,
  parseSearchPageResponse,
  parseSiteIndexScript,
  parseSitemap,
  searchSection,
} from "../infrastructure/material/parsers/index.js";
import {
  documentJson,
  homeHtml,
  mainScript,
  searchDocument,
  searchResponseNested,
  sitemapXml,
} from "./fixtures.js";

test("accepts canonical paths and clean official URLs", () => {
  for (const input of [
    "components/buttons/guidelines",
    "/components/buttons/guidelines/",
    "https://m3.material.io/components/buttons/guidelines",
    "https://m3.material.io/components/buttons/guidelines/",
  ]) {
    assert.equal(normalizeAndValidatePath(input), "components/buttons/guidelines");
  }
  // A category root is a real directory page, not a malformed path.
  assert.equal(normalizeAndValidatePath("components"), "components");
});

test("rejects external, disallowed, traversal, and ambiguous inputs", () => {
  for (const input of [
    "https://example.com/components/buttons",
    "https://m3.material.io.evil.test/components/buttons",
    "https://user:pass@m3.material.io/components/buttons",
    "https://m3.material.io/components/buttons?q=x",
    "https://m3.material.io/components/buttons#frag",
    "blog/buttons",
    "components/%2e%2e/blog",
    "components\\buttons",
    "",
  ]) {
    assert.throws(() => normalizeAndValidatePath(input), /Only clean|malformed|within/);
  }
});

test("rejects encoded separators and control characters", () => {
  for (const input of [
    "components%2Fbuttons",
    "https://m3.material.io/components%2Fbuttons",
    "components/%5cbuttons",
    "components/%00buttons",
    "components/%252fbuttons",
  ]) {
    assert.throws(
      () => normalizeAndValidatePath(input),
      /Encoded path separators|control characters|Only clean|malformed|within/,
    );
  }
});

test("normalizes loose paths and rejects unknown categories", () => {
  assert.equal(normalizeLoosePath("///styles//color///"), "styles/color");
  assert.equal(getCategory("styles/color"), "styles");
  assert.throws(() => getCategory("blog/post"), /category/);
});

test("discovers the main script and parses live route data", () => {
  assert.equal(
    discoverMainScript(homeHtml),
    "https://m3.material.io/static/angular/main.abc123.js",
  );
  const index = parseSiteIndexScript(mainScript);
  assert.equal(index.carbonVersion, "2026-01-02_03-04-05");
  assert.equal(index.routes.get("components/buttons")?.documentId, "buttons.json");
  assert.deepEqual(index.routes.get("components/buttons")?.tabs, ["Overview", "Guidelines"]);
  assert.equal(index.routes.get("components/buttons")?.title, "Buttons");
  assert.equal(
    index.routes.get("components/buttons")?.description,
    "Buttons let people take action.",
  );
});

test("rejects a cross-origin or missing main script", () => {
  assert.throws(
    () =>
      discoverMainScript(
        '<script src="https://example.com/static/angular/main.external.js"></script>',
      ),
    /same-origin/,
  );
  assert.throws(() => discoverMainScript("<html><body>maintenance</body></html>"), /main script/);
});

test("rejects bundles without a content version or routes", () => {
  assert.throws(() => parseSiteIndexScript("const x=1;"), /Carbon content version/);
  assert.throws(
    () => parseSiteIndexScript('const env={carbonVersion:"v1"}; const routes=[];'),
    /No Material 3 document routes/,
  );
});

test("sitemap keeps only allowed same-origin documents", () => {
  const sitemap = parseSitemap(sitemapXml);
  assert.deepEqual(
    [...sitemap.keys()],
    ["components/buttons/overview", "components/buttons/guidelines", "styles/color"],
  );
  assert.equal(sitemap.get("styles/color"), "2026-01-01");
});

test("rejects sitemap responses without supported documents", () => {
  for (const input of ["{}", "<html>maintenance</html>", "<urlset></urlset>"]) {
    assert.throws(() => parseSitemap(input), /sitemap/);
  }
});

test("directory lists sitemap pages with route titles, tabs, and dates", () => {
  const directory = buildDirectory(
    parseSitemap(sitemapXml),
    parseSiteIndexScript(mainScript).routes,
  );
  assert.equal(directory.length, 3);
  assert.equal(directory[0]?.path, "components/buttons/guidelines");
  assert.equal(directory[0]?.title, "Buttons — Guidelines");
  assert.deepEqual(directory[0]?.tabs, ["Overview", "Guidelines"]);
  assert.equal(directory[0]?.updatedAt, "2026-01-02");
  assert.equal(directory[2]?.title, "Color");
});

test("route lookup requires a known tab and prefers the deepest route", () => {
  const routes = parseSiteIndexScript(mainScript).routes;
  assert.equal(findRouteForPath("components/buttons", routes)?.path, "components/buttons");
  assert.equal(
    findRouteForPath("components/buttons/GUIDELINES", routes)?.path,
    "components/buttons",
  );
  assert.equal(findRouteForPath("components/buttons/missing", routes), undefined);
  assert.equal(findRouteForPath("components/unknown", routes), undefined);
});

test("parses a document payload and keeps unknown upstream fields out of the model", () => {
  const document = parseDocumentData(documentJson);
  assert.equal(document.title, "Buttons");
  assert.equal(document.sections.length, 2);
  assert.equal(
    document.sections[0]?.contentBlocks?.[0]?.contentChunks?.[0]?.contentChunkType,
    "TEXT",
  );
  assert.equal("unexpected" in document, false);
});

test("drops unknown fields instead of copying upstream payloads", () => {
  const document = parseDocumentData(
    JSON.stringify({
      title: "Buttons",
      unexpectedTopLevel: "ignored",
      sections: [
        {
          name: "Overview",
          contentBlocks: [
            {
              contentChunks: [{ htmlValue: "<p>Text</p>", unexpectedChunk: "ignored" }],
            },
          ],
        },
      ],
    }),
  );
  const chunk = document.sections[0]?.contentBlocks?.[0]?.contentChunks?.[0];
  assert.ok(chunk);
  assert.equal("unexpectedTopLevel" in document, false);
  assert.equal("unexpectedChunk" in chunk, false);
});

test("rejects document payloads whose structure drifted", () => {
  assert.throws(() => parseDocumentData('{"title":12}'), /Invalid Material 3 document/);
  assert.throws(() => parseDocumentData("not json"), /Invalid Material 3 document/);
  assert.throws(
    () =>
      parseDocumentData(
        JSON.stringify({
          title: "Broken",
          sections: [{ contentBlocks: { contentChunks: [] } }],
        }),
      ),
    /Invalid Material 3 document/,
  );
});

test("reads the nested Search-service payload the live site returns", () => {
  const page = parseSearchPageResponse(JSON.stringify(searchResponseNested));
  assert.equal(page.nextStart, undefined);
  assert.deepEqual(page.items[0], {
    title: "Buttons – Material Design 3",
    link: "https://m3.material.io/components/buttons/guidelines",
    snippet: "Buttons help people take action.",
  });
});

test("still reads the legacy flat payload and its next page", () => {
  const page = parseSearchPageResponse(
    JSON.stringify({
      items: [
        { title: "Buttons", link: "https://m3.material.io/components/buttons", snippet: "Hi" },
      ],
      queries: { nextPage: [{ startIndex: 11 }] },
    }),
  );
  assert.equal(page.items[0]?.title, "Buttons");
  assert.equal(page.nextStart, 11);
});

test("falls back to metadata URLs when a result has no link", () => {
  const page = parseSearchPageResponse(
    JSON.stringify({
      items: [
        {
          document: {
            derived_struct_data: {
              title: "Cards",
              pagemap: {
                metatags: [{ "og:url": "https://m3.material.io/components/cards/overview" }],
              },
            },
          },
        },
      ],
    }),
  );
  assert.equal(page.items[0]?.link, "https://m3.material.io/components/cards/overview");
  assert.equal(page.items[0]?.snippet, undefined);
});

test("rejects payloads that carry neither results nor paging", () => {
  assert.throws(() => parseSearchPageResponse("{}"), /Invalid Material 3 search response/);
  assert.throws(() => parseSearchPageResponse("<html>"), /Invalid Material 3 search response/);
});

test("cleans search snippets and labels known sections", () => {
  assert.equal(
    cleanSearchText("<b>Buttons</b> &amp; cards link Copy link Link copied"),
    "Buttons & cards",
  );
  assert.equal(searchSection("components/buttons/guidelines"), "Guidelines");
  assert.equal(searchSection("components/all-buttons"), undefined);
});

test("keeps a result without a title so the caller can fall back to the path", () => {
  const page = parseSearchPageResponse(
    JSON.stringify({
      items: [
        searchDocument("", "https://m3.material.io/components/cards", "Cards help group content."),
      ],
    }),
  );
  assert.equal(page.items[0]?.title, undefined);
  assert.equal(page.items[0]?.link, "https://m3.material.io/components/cards");
});
