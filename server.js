var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var http = require('http');
var getMime = require('simple-mime')('application/octet-stream');

var db = memDb();
var repo = jsGit(db);

require('./serve-path.js')(repo);

var root;
db.init(function (err) {
  if (err) throw err;
  importPath(repo, pathJoin(__dirname, "test"), function (err, hash) {
    if (err) throw err;
    root = hash;
    http.createServer(onRequest).listen(8080, function () {
      console.log("HTTP server at http://localhost:8080");
    });
  });
});


function onRequest(req, res) {

  // Ensure the request is either HEAD or GET by rejecting everything else
  var head = req.method === "HEAD";
  if (!head && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "HEAD,GET");
    res.end();
    return;
  }

  var path = urlParse(req.url).pathname;
  var reqEtag = req.headers['if-none-match'];

  console.log(req.method, path);

  repo.servePath(root, path, reqEtag, onEntry);

  function onEntry(err, etag, fetch) {
    if (etag === undefined) {
      if (err) {
        if (err.redirect) {
          // User error requiring redirect
          res.statusCode = 301;
          res.setHeader("Location", err.redirect);
          res.end();
          return;
        }
        if (err.internalRedirect) {
          path = err.internalRedirect;
          res.setHeader("Location", path);
          return repo.servePath(root, path, reqEtag, onEntry);
        }
      }
      return onError(err);
    }
    res.setHeader("ETag", etag);
    if (reqEtag === etag) {
      // etag matches, no change
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader("Content-Type", getMime(path));
    if (head) {
      return res.end();
    }
    fetch(function (err, body) {
      if (body === undefined) return onError(err);

      if (!Buffer.isBuffer(body)) {
        if (typeof body === "object") {
          if (body.mime) res.setHeader("Content-Type", body.mime);
          body = body.body;
        }
        if (typeof body === "string") {
          body = new Buffer(body);
        }
      }
      res.setHeader("Content-Length", body.length);
      res.end(body);
    });
  }

  function onError(err) {
    if (!err) {
      // Not found
      res.statusCode = 404;
      res.end("Not found in tree " + root + ": " + path + "\n");
      return;
    }
    // Server error
    res.statusCode = 500;
    res.end(err.stack + "\n");
    console.error(err.stack);
  }
}

