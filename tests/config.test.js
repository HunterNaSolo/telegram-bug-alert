import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../api/config.js", import.meta.url), "utf8");
const authSource = await readFile(new URL("../api/_lib/auth.js", import.meta.url), "utf8");

async function setup() {
  let stored;
  let writes = 0;
  const redis = {
    async get() { return stored; },
    async set(key, value) { stored = value; writes++; },
  };
  const context = vm.createContext({
    process: { env: { APP_PASSWORD: "test-only" } },
    console: { error() {} },
  });
  const db = new vm.SyntheticModule(["redis", "CONFIG_KEY"], function () {
    this.setExport("redis", redis);
    this.setExport("CONFIG_KEY", "test:config");
  }, { context });
  const auth = new vm.SourceTextModule(authSource, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => specifier.endsWith("db.js") ? db : auth);
  await module.evaluate();
  return {
    redis,
    get writes() { return writes; },
    async request(method, body, password = "test-only") {
      const response = {
        code: 200,
        setHeader() {},
        status(code) { this.code = code; return this; },
        json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
        end() { return this; },
      };
      await module.namespace.default({ method, body, headers: { "x-app-password": password } }, response);
      return response;
    },
  };
}

test("saves and reloads a new product with all search filters and legacy products", async () => {
  const app = await setup();
  const response = await app.request("POST", {
    channels: [" ofertas ", ""],
    keywords: [" BUG ", "café -xícara", {
      main: " Sabão ", synonyms: [" detergente ", ""], require: [" 5L "], excludes: [" pó "],
    }],
  });
  assert.equal(response.code, 200);
  assert.deepEqual((await app.request("GET")).body, {
    channels: ["ofertas"],
    keywords: ["BUG", "café -xícara", {
      main: "Sabão", synonyms: ["detergente"], require: ["5L"], excludes: ["pó"],
    }],
  });
});

test("accepts products without optional filters and empty lists", async () => {
  const app = await setup();
  assert.equal((await app.request("POST", { channels: [], keywords: [{ main: "Arroz" }] })).code, 200);
  assert.deepEqual((await app.request("GET")).body.keywords, [{ main: "Arroz", synonyms: [], require: [], excludes: [] }]);
  assert.equal((await app.request("POST", { channels: [], keywords: [] })).code, 200);
  assert.deepEqual((await app.request("GET")).body.keywords, []);
});

test("invalid products and filters do not overwrite existing configuration", async () => {
  const app = await setup();
  const original = { channels: ["ofertas"], keywords: ["BUG"] };
  await app.request("POST", original);
  for (const keywords of [[null], [42], [{}], [{ main: " " }], [{ main: "Arroz", require: "5kg" }], [{ main: "Arroz", synonyms: [42] }]]) {
    assert.equal((await app.request("POST", { channels: [], keywords })).code, 400);
  }
  assert.equal((await app.request("POST", { channels: [null], keywords: [] })).code, 400);
  assert.equal((await app.request("POST", {})).code, 400);
  assert.equal(app.writes, 1);
  assert.deepEqual((await app.request("GET")).body, original);
});

test("requires the password before writing", async () => {
  const app = await setup();
  assert.equal((await app.request("POST", { channels: [], keywords: [] }, "wrong")).code, 401);
  assert.equal(app.writes, 0);
});

test("reports storage failure without claiming success", async () => {
  const app = await setup();
  app.redis.set = async () => { throw new Error("storage unavailable"); };
  const response = await app.request("POST", { channels: [], keywords: [{ main: "Arroz" }] });
  assert.equal(response.code, 500);
  assert.match(response.body.error, /Não foi possível salvar/);
});
