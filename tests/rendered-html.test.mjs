import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/"), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Not a Transplant game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Not a Transplant/);
  assert.match(html, /NOT A/);
  assert.match(html, /TRANSPLANT/);
  assert.doesNotMatch(html, /All boroughs|Drag and pinch/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});
