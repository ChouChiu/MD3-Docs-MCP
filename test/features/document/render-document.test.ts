import assert from "node:assert/strict";
import test from "node:test";
import { renderDocument } from "../../../src/features/document/render-document.js";
import type { DocumentData } from "../../../src/infrastructure/material/types.js";

test("document rendering loads independent resource tables concurrently", async () => {
  const document: DocumentData = {
    title: "Concurrent resources",
    sections: [
      {
        name: "Overview",
        contentBlocks: [
          {
            contentChunks: [
              { resourceName: "designSystems/test/one" },
              { resourceName: "designSystems/test/two" },
            ],
          },
        ],
      },
    ],
  };
  let active = 0;
  let maximumActive = 0;
  const rendered = await renderDocument(document, "components/test", "version", async (name) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { displayName: name };
  });

  assert.equal(maximumActive, 2);
  assert.equal(rendered.sections[0]?.blocks[0]?.chunks.length, 2);
});
