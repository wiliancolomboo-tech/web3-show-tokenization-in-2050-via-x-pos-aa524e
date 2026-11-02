// embedded in worker runtime
import http from "http";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ONLINE", protocol: "AURA-2050", uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(8080);