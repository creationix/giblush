var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var http = require('http');
var getMime = require('simple-mime')('application/octet-stream');

var commands = {
  cjs: require('./cjs-filter.js'),
  appcache: require('./appcache-filter.js')
};

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

    var etag;
    if (entry.mode !== 0120000) etag = '"' + entry.hash + '"';
    if (entry.mode === 040000) etag = "W/" + etag;
    if (etag && req.headers["if-none-match"] === etag) {
      res.statusCode = 304;
      res.end();
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
      // Auto-load index.html pages
      if (entry.tree["index.html"]) {
        path = pathJoin(path, "index.html");
        return repo.pathToEntry(root, path, onEntry);
      }
      // Render tree as JSON listing.
      var entries = [];
      for (var name in entry.tree) {
        var item = entry.tree[name];
        item.name = name;
        item.href = "http://" + req.headers.host + pathJoin(path, name);
        if (item.mode === 040000) item.href += "/";
        entries.push(item);
      }
      var body = new Buffer(JSON.stringify(entries) + "\n");
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", body.length);
      res.setHeader("Content-Type", "application/json");
      res.end(body);
      return;
    }
    if (entry.mode & 0777) {
      // Static file, serve it as-is.
      return repo.loadAs("blob", entry.hash, function (err, body) {
        if (err) return onEntry(err);
        res.setHeader("ETag", etag);
        res.setHeader("Content-Length", body.length);
        res.setHeader("Content-Type", getMime(path));
        res.end(body);
      });
    }
    if (entry.mode === 0120000) {
      // Symbolic Link, execute the filter if any
      var filters = entry.link.split("|");
      var base = pathJoin(path, "..");
      var target = filters.shift();
      var input;

      // If it's a static symlink, redirect to the target but preserve the
      // original path.
      if (!filters.length) {
        return repo.pathToEntry(root, pathJoin(base, target), onEntry);
      }

      if (target) {
        return loader(target, false, function (err, result) {
          if (result === undefined) return onEntry(err);
          input = result;
          next();
        });
      }
      next();
    }

    function next() {
      if (!filters.length) {
        // res.setHeader("ETag", etag);
        var body = new Buffer(input);
        res.setHeader("Content-Length", body.length);
        res.setHeader("Content-Type", getMime(path));
        res.end(body);
        return;
      }
      var args = filters.shift().split(" ");
      var name = args.shift();
      var command = commands[name];
      command(loader, pathToEntry, base, input, args, function (err, output) {
        if (err) return onEntry(err);
        input = output;
        next();
      });
    }

  }
}

function pathToEntry(path, callback) {
  if (path[0] !== "/") path = "/" + path;
  return repo.pathToEntry(root, path, callback);
}

function loader(path, binary, callback) {
  if (!callback) return loader.bind(this, path, binary);
  console.log("LOAD", path);
  repo.pathToEntry(root, "/" + path, function (err, entry) {
    if (entry === undefined) return callback(err);
    repo.loadAs(binary ? "blob" : "text", entry.hash, callback);
  });
}


