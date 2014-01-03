var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var http = require('http');
var getMime = require('simple-mime')('application/octet-stream');

var db = memDb();
var repo = jsGit(db);

// Mix in path resolving ability
require('./path-to-entry.js')(repo);

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
  var path = urlParse(req.url).pathname;
  console.log(req.method, path);

  // TODO: Implement HEAD requests

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  repo.pathToEntry(root, path, onEntry);

  function onEntry(err, entry) {
    if (err) {
      res.statusCode = 500;
      res.end(err.stack + "\n");
      console.error(err.stack);
      return;
    }
    if (!entry) {
      // Not found
      res.statusCode = 404;
      res.end("ENOENT: " + root + path + "\n");
      return;
    }

    var etag = '"' + entry.hash + '"';
    if (req.headers["if-none-match"] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader("ETag", etag);
    if (entry.mode === 040000) {
      // Directory
      res.setHeader("ETag", "W/" + etag);
      if (path[path.length - 1] !== "/") {
        // Make sure it ends in a slash
        res.statusCode = 301;
        res.setHeader("Location", path + "/");
        res.end();
        return;
      }
      if (entry.tree["index.html"]) {
        path = pathJoin(path, "index.html");
        return repo.pathToEntry(root, path, onEntry);
      }
      // Convert to a JSON file
      var entries = [];
      for (var name in entry.tree) {
        var item = entry.tree[name];
        item.name = name;
        item.url = "http://" + req.headers.host + pathJoin(path, name);
        entries.push(item);
      }
      var body = new Buffer(JSON.stringify(entries) + "\n");
      res.setHeader("Content-Length", body.length);
      res.setHeader("Content-Type", "application/json");
      res.end(body);
      return;
    }
    if (entry.mode & 0777) {
      // Static file, serve it as-is.
      return repo.loadAs("blob", entry.hash, function (err, body) {
        if (err) return onEntry(err);
        res.setHeader("Content-Length", body.length);
        res.setHeader("Content-Type", getMime(path));
        res.end(body);
      });
    }
    if (entry.mode === 0120000) {
      // Symbolic Link, execute the filter if any
      var filters = entry.link.split("|");
      var base = pathJoin(path, "..");
      var target = pathJoin(base, filters.shift());
      // If it's a static symlink, redirect to the target.
      if (!filters.length) {
        return repo.pathToEntry(root, target, onEntry);
      }
      console.log("DYNLINK", {
        path: path,
        base: base,
        target: target,
        filters: filters
      });
    }
  }
}

