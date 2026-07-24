import { timingSafeEqual } from "node:crypto";
import http from "node:http";

const expectedToken = process.env.FEATURE015A_CHANNEL_TOKEN;
if (!expectedToken || Buffer.byteLength(expectedToken) < 32) {
  throw new Error("FEATURE015A_CHANNEL_TOKEN is required");
}

function tokenMatches(actual) {
  const actualBytes = Buffer.from(actual ?? "");
  const expectedBytes = Buffer.from(expectedToken);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

const server = http.createServer((request, response) => {
  if (
    request.method !== "POST" ||
    request.url !== "/tool" ||
    !tokenMatches(request.headers["x-feature015a-channel-token"])
  ) {
    response.writeHead(403).end();
    return;
  }

  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4096) request.destroy();
  });
  request.on("end", () => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      message?.name !== "synthetic_read" ||
      message?.arguments?.key !== "stage2" ||
      Object.keys(message.arguments).length !== 1
    ) {
      response.writeHead(400).end();
      return;
    }
    console.log("worker_call=synthetic_read");
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ value: "SYNTHETIC_WORKER_RESULT" }));
  });
});

server.listen(8080, "0.0.0.0", () => console.log("worker_ready=true"));
