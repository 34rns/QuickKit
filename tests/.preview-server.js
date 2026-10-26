/* Tiny static server for the QuickKit preview harness (test only). */
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, ".preview");
var PORT = Number(process.argv[2] || 8137);

var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json"
};

http
  .createServer(function (req, res) {
    var url = decodeURIComponent(String(req.url || "/").split("?")[0]);
    if (url === "/") url = "/index.html";
    var file = path.join(ROOT, url.replace(/^\/+/, ""));
    if (file.indexOf(ROOT) !== 0) {
      res.writeHead(403);
      res.end("no");
      return;
    }
    fs.readFile(file, function (error, data) {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("missing: " + url);
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", function () {
    console.log("serving " + ROOT + " on http://127.0.0.1:" + PORT);
  });
