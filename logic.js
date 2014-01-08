var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var getMime = require('simple-mime')('application/octet-stream');
var watch = require('node-watch');

var db = memDb();
var repo = jsGit(db);

var commands = require('./serve-path.js')(repo);
commands.cjs = require('./cjs-filter.js');
commands.appcache = require('./appcache-filter.js');
commands.md2html = require('./md2html-filter.js');

var root;
var dataDir = pathJoin(__dirname, "test");
db.init(function (err) {
  if (err) throw err;
  importPath(repo, dataDir, function (err, hash) {
    if (err) throw err;
    console.log("Initial import done");
    root = hash;
  });
});

watch(dataDir, function(filename) {
  importPath(repo, dataDir, function (err, hash) {
    if (err) throw err;
    root = hash;
  });
});

module.exports = onRequest;
function onRequest(req, res) {
  var end = res.end;
  res.end = function () {
    console.log(req.method, req.url, res.statusCode);
    return end.apply(this, arguments);
  };
  if (!root) return onError(new Error("root hash is not set yet"));

  // Ensure the request is either HEAD or GET by rejecting everything else
  var head = req.method === "HEAD";
  if (!head && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "HEAD,GET");
    res.end();
    return;
  }

  var path = urlParse(req.url).pathname;
  var etag = req.headers['if-none-match'];

  repo.servePath(root, path, etag, onEntry);

  function onEntry(err, result) {
    if (result === undefined) return onError(err);
    if (result.redirect) {
      // User error requiring redirect
      res.statusCode = 301;
      res.setHeader("Location", result.redirect);
      res.end();
      return;
    }

    if (result.internalRedirect) {
      path = result.internalRedirect;
      res.setHeader("Location", path);
      return repo.servePath(root, path, etag, onEntry);
    }

    res.setHeader("ETag", result.etag);
    if (etag === result.etag) {
      // etag matches, no change
      res.statusCode = 304;
      res.end();
      return;
    }

    res.setHeader("Content-Type", result.mime || getMime(path));
    if (head) {
      return res.end();
    }
    result.fetch(function (err, body) {
      if (body === undefined) return onError(err);

      if (Buffer.isBuffer(body)) {
        res.setHeader("Content-Length", body.length);
      }
      if (typeof body === "string") {
        res.setHeader("Content-Length", Buffer.byteLength(body));
      }
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
