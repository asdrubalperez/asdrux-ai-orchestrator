import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ProcessRuntimeComponent } from "./processComponent.js";
import { IsolatedToolsSupervisor } from "./supervisor.js";

test("process E2E keeps OAuth/Tavily canaries out of worker and holder has no local tools", async () => {
  const holderScript = [
    'const tools=[];',
    'console.log(JSON.stringify({ready:"HOLDER_READY",tools,oauth:Boolean(process.env.OAUTH_CANARY)}));',
    'setInterval(()=>{},1000);',
  ].join("");
  const workerScript = [
    'const secrets=["OAUTH_CANARY","TAVILY_API_KEY"].filter(k=>process.env[k]);',
    'console.log(JSON.stringify({ready:"WORKER_READY",secrets,syntheticTool:"SYNTHETIC_OK"}));',
    'setInterval(()=>{},1000);',
  ].join("");
  const holder = new ProcessRuntimeComponent({
    name: "holder", command: process.execPath, args: ["-e", holderScript],
    env: { PATH: process.env.PATH, OAUTH_CANARY: "synthetic-oauth" },
    readinessMarker: "HOLDER_READY",
  });
  const worker = new ProcessRuntimeComponent({
    name: "worker", command: process.execPath, args: ["-e", workerScript],
    env: { PATH: process.env.PATH },
    readinessMarker: "WORKER_READY",
  });
  const supervisor = new IsolatedToolsSupervisor();
  const result = await supervisor.run([() => holder, () => worker], async () => ({
    holder: JSON.parse(holder.output[0]), worker: JSON.parse(worker.output[0]),
  }));
  assert.deepEqual(result.holder.tools, []);
  assert.equal(result.holder.oauth, true);
  assert.deepEqual(result.worker.secrets, []);
  assert.equal(result.worker.syntheticTool, "SYNTHETIC_OK");
});

test("Codex contract test is tied to the approved pin tuple", () => {
  const pin = JSON.parse(fs.readFileSync(path.resolve("docker/codex-pin.json"), "utf8"));
  assert.equal(pin.npmVersion, "0.145.0");
  assert.equal(pin.expectedCliVersion, "codex-cli 0.145.0");
  assert.equal(pin.appServerSchemaTreeSha256, "bd3888e9fbdd115552d2847f3f5b343f5d2ecc30912b48d8ead399b6a2b4d329");
});
