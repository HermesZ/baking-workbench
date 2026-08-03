/* ============ 烘焙工作台 · 局域网服务器(零依赖) ============
 * 功能:
 *   1. 托管 index.html / style.css / app.js 静态文件
 *   2. 提供数据同步 API(手机与电脑共享同一份数据,存于 data.json)
 *
 * 启动:  node server.js   (或双击 start.bat)
 * 电脑访问:  http://localhost:8000
 * 手机访问:  http://<电脑局域网IP>:8000   (需同一 Wi-Fi)
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function lanIPs() {
  const list = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) list.push(iface.address);
    }
  }
  return list;
}

function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  /* ---------- 数据同步 API ---------- */
  if (url.pathname === "/api/data") {
    if (req.method === "GET") {
      let body = "{}";
      try { body = fs.readFileSync(DATA_FILE, "utf8"); } catch (e) { body = "{}"; }
      return send(res, 200, body, "application/json; charset=utf-8");
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 5 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const data = JSON.parse(raw);
          fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
          send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
        } catch (e) {
          send(res, 400, JSON.stringify({ ok: false, error: "invalid json" }), "application/json; charset=utf-8");
        }
      });
      return;
    }
    return send(res, 405, "Method Not Allowed");
  }

  /* ---------- 静态文件 ---------- */
  let file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, "Not Found");
  }
  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIPs();
  console.log("🧁 烘焙工作台已启动!");
  console.log("  电脑访问: http://localhost:" + PORT);
  if (ips.length) {
    console.log("  手机访问(需与电脑同一 Wi-Fi),任选一个:");
    ips.forEach((ip) => console.log("    http://" + ip + ":" + PORT));
  } else {
    console.log("  未检测到局域网地址,请用 ipconfig 查看本机 IP 后访问");
  }
  console.log("  数据文件: " + DATA_FILE);
});
