import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/ai_media_factory/static/app.js",import.meta.url),"utf8");
test("Model Intelligence V2 is tabbed, paginated, detail-capable, and does not lead with raw JSON",()=>{
  for(const text of ["Overview","Shortlist","All Models","Benchmarks","Routing","Price History","BENCHMARK_STATUS = NOT_EXECUTED","page_size","View details","Developer / Raw Evidence"])assert.ok(source.includes(text),text);
  const block=source.slice(source.indexOf("async function modelIntelligence"),source.indexOf("async function platformHealth"));
  assert.equal(block.includes("JSON.stringify(shortlist"),false);
  assert.ok(source.includes("miState={tab:'overview',page:1,pageSize:25"));
});
