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

// Cache the tree entries by hash for faster path lookup.
var cache = {};
function loadTree(hash, callback) {
  var cached = cache[hash];
  if (cached) return callback(null, cached);
  repo.loadAs("tree", hash, function (err, tree) {
    if (!tree) return callback(err);
    cache[hash] = tree;
    callback(null, tree);
  });
}

function loadLink(hash, callback) {
  var cached = cache[hash];
  if (cached) return callback(null, cached);
  repo.loadAs("text", hash, function (err, tree) {
    if (!tree) return callback(err);
    cache[hash] = tree;
    callback(null, tree);
  });
}

// Given a hash to a tree and a path within that tree, return the directory entry
// complete with mode and hash.  Returns undefined when not found.
function pathToEntry(root, path, callback) {
  // Base case in recursion is the root itself as a tree.
  if (!path) {
    return callback(null, {
      mode: 040000,
      hash: root
    });
  }
  var index = path.lastIndexOf("/");
  if (index < 0) {
    return callback(new TypeError("Invalid path: " + path));
  }
  var dir = path.substr(0, index);
  var base = path.substr(index + 1);

  // Ignore trailing slashes in path.
  if (!base) return pathToEntry(root, dir, callback);

  // Recursivly find the parent directory.
  pathToEntry(root, dir, onParent);

  function onParent(err, parent) {
    if (!parent) return callback(err);
    if (parent.mode === 0120000) {
      // Support symlinks to directories when resolving paths.
      return loadLink(parent.hash, function (err, link) {
        if (err) return callback(err);
        var target = pathJoin(dir, "..", link);
        return pathToEntry(root, target, onParent);
      });
    }
    if (parent.mode !== 040000) {
      return callback(new TypeError("Invalid parent mode: 0" + parent.mode.toString(8)));
    }
    loadTree(parent.hash, function (err, tree) {
      if (!tree) return callback(err);
      var entry = tree[base];
      if (!entry) return callback();
      if (entry.mode !== 0120000) {
        return callback(null, entry);
      }
      loadLink(entry.hash, function (err, link) {
        if (link === undefined) return callback(err);
        entry.link = link;
        callback(null, entry);
      });
    });
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

  pathToEntry(root, path, onEntry);

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
      return loadTree(entry.hash, function (err, tree) {
        if (err) return onEntry(err);
        if (tree["index.html"]) {
          path = pathJoin(path, "index.html");
          return pathToEntry(root, path, onEntry);
        }
        // Convert to a JSON file
        var entries = [];
        for (var name in tree) {
          var item = tree[name];
          item.name = name;
          item.url = "http://" + req.headers.host + pathJoin(path, name);
          entries.push(item);
        }
        var body = new Buffer(JSON.stringify(entries) + "\n");
        res.setHeader("Content-Length", body.length);
        res.setHeader("Content-Type", "application/json");
        res.end(body);
        return;
      });
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
        return pathToEntry(root, target, onEntry);
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

