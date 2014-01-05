var memDb = require('./memdb.js');
var jsGit = require('js-git');
var importPath = require('./importfs.js');
var pathJoin = require('path').join;
var urlParse = require('url').parse;
var http = require('http');
var getMime = require('simple-mime')('application/octet-stream');
var parallel = require('js-git/lib/parallel.js');

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

      // function onInput(input) {
      //   if (!command) return onEntry(new Error("Invalid command: " + filters[0]));

      //   command(repo, root, base, target, function (err, code) {
      //     if (err) return onEntry(err);
      //     var body = new Buffer(code);
      //     res.setHeader("Content-Length", body.length);
      //     res.setHeader("Content-Type", "application/javascript");
      //     res.end(body);
      //   });
      // }
      // }

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

var commands = {
  cjs: cjs,
  appcache: appcache
};

// function cjs(repo, root, base, target, callback) {
//   console.log("CJS", {
//     base: base,
//     target: target,
//   });

//   compile(loader, "." + pathJoin(base, target), callback);

// }

var mine = require('js-linker/mine.js');
var gen = require('js-linker/gen.js');
function cjs(loader, pathToEntry, base, input, args, callback) {
  var modules = {};  // compiled modules
  var packagePaths = {}; // key is base + name , value is full path
  var aliases = {}; // path aliases from the "browser" directive in package.json
  var path = '-';
  processJs(path, input, function (err) {
    if (err) return callback(err);
    var out;
    try { out = gen({
      initial: path,
      modules: modules
    }, true) + "\n"; }
    catch (err) { return callback(err); }
    callback(null, out);
  });

  function processJs(path, js, callback) {
    var deps = mine(js);
    modules[path] = { type: "javascript", value: js, deps: deps };
    next(0);
    function next(index) {
      var dep = deps[index];
      if (!dep) return callback(null, path);
      resolveModule(pathJoin(path, '..'), dep.name, function (err, newPath) {
        if (err) return callback(err);
        dep.newPath = newPath;
        next(index + 1);
      });
    }
  }

  function resolveModule(base, path, callback) {
    if (path[0] === ".") {
      return resolvePath(pathJoin(base, path), callback);
    }

    // non-local requires are assumed to belong to packages
    var index = path.indexOf("/");
    var name = index < 0 ? path : path.substr(0, index);
    return loadPackage(base, name, onPackage);

    function onPackage(err, metaPath) {
      if (metaPath === undefined) return callback(err);
      if (index < 0) path = metaPath;
      else path = pathJoin(metaPath, path.substr(index));
      return resolvePath(path, callback);
    }
  }

  function resolvePath(path, callback) {
    if (path in aliases) path = aliases[path];
    if (path in modules) return callback(null, path);
    if (/\.js$/.test(path)) {
      return loader(path, false, onJavaScript);
    }
    if (/\.json$/.test(path)) {
      return loader(path, false, onJson);
    }
    if (/#txt$/.test(path)) {
      return loader(path.substr(0, path.length - 4), false, onText);
    }
    if (/#bin$/.test(path)) {
      return loader(path.substr(0, path.length - 4), true, onBinary);
    }
    return callback(new Error("Invalid path extension: " + path));

    function onJavaScript(err, js) {
      if (err) return callback(err);
      processJs(path, js, callback);
    }

    function onJson(err, json) {
      if (json === undefined) return callback(err);
      var value;
      try { value = JSON.parse(json); }
      catch (err) { return callback(err); }
      modules[path] = { type: "json", value: value };
      callback(null, path);
    }

    function onText(err, text) {
      if (text === undefined) return callback(err);
      modules[path] = { type: "text", value: text };
      callback(null, path);
    }

    function onBinary(err, binary) {
      if (binary === undefined) return callback(err);
      modules[path] = { type: "binary", value: binary };
      callback(null, path);
    }

  }

  function loadPackage(base, name, callback) {
    var key = pathJoin(base, name);
    if (key in packagePaths) return callback(null, packagePaths[key]);
    var metaPath = pathJoin(base, "node_modules", name, "package.json");
    loader(metaPath, false, function (err, json) {
      if (err) return callback(err);
      if (!json) {
        if (base === "/" || base === ".") return callback();
        return loadPackage(pathJoin(base, ".."), name, callback);
      }
      var meta;
      try { meta = JSON.parse(json); }
      catch (err) { return callback(err); }
      base = pathJoin(metaPath, "..");
      packagePaths[key] = base;
      if (meta.main) {
        aliases[base] = pathJoin(base, meta.main);
      }
      if (meta.browser) {
        for (var original in meta.browser) {
          aliases[pathJoin(base, original)] = pathJoin(base, meta.browser[original]);
        }
      }
      callback(null, base);
    });
  }

}

function appcache(loader, pathToEntry, base, input, args, callback) {
  var actions = [pathToEntry("/")];
  args.forEach(function (file) {
    actions.push(pathToEntry(pathJoin(base, file)));
  });
  parallel(actions, function (err, entries) {
    if (err) return callback(err);
    var result = "CACHE MANIFEST\n#" + entries.shift().hash + "\n" +
      args.map(function (file, i) {
        return file + " # " + entries[i].hash;
      }).join("\n") + "\n";
    callback(null, result);
  });
}