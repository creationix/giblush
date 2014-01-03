var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var http = require('http');
var getMime = require('simple-mime')('application/octet-stream');

var db = memDb();
var repo = jsGit(db);
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

var cache = {};

// Caching loader that remembers already seen trees
function loadAs(type, hash, callback) {
  var cached = cache[hash];
  if (cached) {
    if (type !== cached.type) throw new TypeError("Type mismatch " + type + " !== " + cached.type);
    return callback(null, cached.body);
  }
  else {
    repo.loadAs(type, hash, function (err, body) {
      if (err) return callback(err);
      if (type === "tree") {
        cache[hash] = {
          type: type,
          body: body
        };
      }
      callback(null, body);
    });
  }
}

// Given a tree hash as root and a path, get the object by walking the tree.
function load(root, path, callback) {
  var entry;
  var index = path.lastIndexOf("/");
  if (index < 0) {
    entry = { mode: 040000, hash: root };
    return loadAs("tree", root, onDone);
  }
  var dir = path.substr(0, index);
  var base = path.substr(index + 1);
  if (!base) return load(root, dir, callback);
  load(root, dir, function (err, parent) {
    if (err) return callback(err);
    entry = parent.body[base];
    if (!entry) return callback();
    if (entry.mode === 040000) {
      return loadAs("tree", entry.hash, onDone);
    }
    console.log("MODE", entry)
    return loadAs("blob", entry.hash, onDone);
  });

  function onDone(err, body) {
    if (err) return callback(err);
    entry.body = body;
    callback(null, entry);
  }
}

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

  load(root, path, onLoad);

  function onLoad(err, entry) {
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
    if (entry.mode === 040000) {
      // Directory
      if (path[path.length - 1] !== "/") {
        // Make sure it ends in a slash
        res.statusCode = 301;
        res.setHeader("Location", path + "/");
        res.end();
        return;
      }
      if (entry.body["index.html"]) {
        path = pathJoin(path, "index.html");
        return load(root, path, onLoad);
      }
      // Convert to a JSON file
      var etag = '"' + entry.hash + '"';
      if (req.headers["if-none-match"] === etag) {
        res.statusCode = 304;
        res.end();
        return;
      }
      var entries = [];
      for (var name in entry.body) {
        var item = entry.body[name];
        item.name = name;
        item.url = "http://" + req.headers.host + pathJoin(path, name);
        entries.push(item);
      }
      var body = new Buffer(JSON.stringify(entries) + "\n");
      // Static file, serve it as-is.
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", body.length);
      res.setHeader("Content-Type", "application/json");
      res.end(body);
      return;
    }
    if (entry.mode & 0777) {
      // Static file, serve it as-is.
      var etag = '"' + entry.hash + '"';
      if (req.headers["if-none-match"] === etag) {
        res.statusCode = 304;
        res.end();
        return;
      }
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", entry.body.length);
      res.setHeader("Content-Type", getMime(path));
      res.end(entry.body);
      return;
    }
    if (entry.mode === 0120000) {
      // Symbolic Link, execute the filter if any
      console.log("SYMLINK", entry);
      return;
    }

  }
}

