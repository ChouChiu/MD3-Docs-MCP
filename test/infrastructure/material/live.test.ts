import assert from "node:assert/strict";
import test from "node:test";
import { ContextService } from "../../../src/features/context/index.js";
import { DocumentService } from "../../../src/features/document/index.js";
import { Md3Client } from "../../../src/infrastructure/material/index.js";

test("live Material 3 sitemap, search, and document endpoints", {
  skip: process.env.MD3_LIVE_TESTS !== "1",
  timeout: 60_000,
}, async () => {
  const client = new Md3Client();
  const documents = new DocumentService(client);
  const directory = await client.getDirectory();
  assert.ok(directory.length > 100);
  assert.ok(
    directory.every((entry) => ["foundations", "styles", "components"].includes(entry.category)),
  );

  const search = await client.search("buttons", "components", 1, 5);
  assert.ok(search.hits.length > 0);

  const document = await documents.readDocument("components/buttons/guidelines");
  assert.equal(document.section, "Guidelines");
  assert.match(document.markdown, /button/i);
  assert.equal(document.sourceUrl, "https://m3.material.io/components/buttons/guidelines");

  const context = await new ContextService(client, documents).getContext({
    task: "button accessibility guidance",
    mode: "review",
    paths: ["components/buttons/accessibility"],
    category: "components",
    maxSources: 2,
    maxCharacters: 4_000,
  });
  assert.match(context.markdown, /\[S1\]/);
  assert.ok(
    context.sources.every((source) => source.sourceUrl.startsWith("https://m3.material.io/")),
  );
});
