import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectory,
  discoverMainScript,
  normalizeAndValidatePath,
  parseDocumentData,
  parseSiteIndexScript,
  parseSitemap,
} from "../../../src/infrastructure/material/parsers.js";
import { documentJson, homeHtml, mainScript, sitemapXml } from "./fixtures.js";

test("discovers main script and parses live route data", () => {
  assert.equal(
    discoverMainScript(homeHtml),
    "https://m3.material.io/static/angular/main.abc123.js",
  );
  const index = parseSiteIndexScript(mainScript);
  assert.equal(index.carbonVersion, "2026-01-02_03-04-05");
  assert.equal(index.routes.get("components/buttons")?.documentId, "buttons.json");
  assert.deepEqual(index.routes.get("components/buttons")?.tabs, ["Overview", "Guidelines"]);
  assert.equal(index.routes.get("components/buttons")?.title, "Buttons");
});

test("rejects a cross-origin main script", () => {
  assert.throws(
    () =>
      discoverMainScript(
        '<script src="https://example.com/static/angular/main.external.js"></script>',
      ),
    /same-origin/,
  );
});

test("sitemap keeps only allowed same-origin docs", () => {
  const sitemap = parseSitemap(sitemapXml);
  assert.deepEqual(
    [...sitemap.keys()],
    ["components/buttons/overview", "components/buttons/guidelines", "styles/color"],
  );
  const index = parseSiteIndexScript(mainScript);
  const directory = buildDirectory(sitemap, index.routes);
  assert.equal(directory.length, 3);
  assert.equal(directory[0]?.category, "components");
});

test("rejects sitemap responses without supported documents", () => {
  for (const input of ["{}", "<html>maintenance</html>", "<urlset></urlset>"]) {
    assert.throws(() => parseSitemap(input), /sitemap/);
  }
});

test("validates document JSON", () => {
  assert.equal(parseDocumentData(documentJson).title, "Buttons");
  assert.throws(() => parseDocumentData('{"title":12}'), /Invalid Material 3 document/);
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

test("rejects external, disallowed, traversal, and ambiguous URLs", () => {
  assert.equal(
    normalizeAndValidatePath("https://m3.material.io/components/buttons/guidelines"),
    "components/buttons/guidelines",
  );
  for (const path of [
    "https://example.com/components/buttons",
    "blog/buttons",
    "components/%2e%2e/blog",
    "https://m3.material.io/components/buttons?q=x",
    "components\\buttons",
  ]) {
    assert.throws(() => normalizeAndValidatePath(path));
  }
});
