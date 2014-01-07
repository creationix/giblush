var pathJoin = require('js-linker/pathjoin.js');

var commands = {
  cjs: require('./cjs-filter.js'),
  appcache: require('./appcache-filter.js')
};

// Cache the tree entries by hash for faster path lookup.
var cache = {};

module.exports = function (repo) {
  repo.servePath = servePath;
  repo.pathToEntry = pathToEntry;
};

function pathToEntry(root, path, callback) {
  if (!callback) return pathToEntry.bind(this, root, path);

  var repo = this;

  // Split path ignoring leading and trailing slashes.
  var parts = path.split("/").filter(String);
  var length = parts.length;
  var index = 0;

  // These contain the hash and mode of the path as we walk the segments.
  var mode = 040000;
  var hash = root;
  return walk();

  function walk() {
    var cached;
    while (index < length) {
      // If the parent is a tree, look for our path segment
      if (mode === 040000) {
        cached = cache[hash];
        // If it's not cached yet, abort and resume later.
        if (!cached) return repo.loadAs("tree", hash, onValue);
        var entry = cached[parts[index++]];
        if (!entry) return callback();
        hash = entry.hash;
        mode = entry.mode;
        continue;
      }
      // If the parent is a symlink, adjust the path in-place and start over.
      if (mode === 0120000) {
        cached = cache[hash];
        if (!cached) return repo.loadAs("text", hash, onValue);
        // Remove the tail and remove the symlink segment from the head.
        var tail = parts.slice(index);
        parts.length = index - 1;
        // Join the target resolving special "." and ".." segments.
        cached.split("/").forEach(onPart);
        // Add the tail back in.
        parts.push.apply(parts, tail);
        // Start over.  The already passed path will be cached and quite fast.
        hash = root;
        mode = 040000;
        index = 0;
        continue;
      }
      return callback(new Error("Invalid path segment"));
    }

    // We've reached the final segment, let's preload symlinks and trees since
    // we don't mind caching those.

    var result;
    if (mode === 040000) {
      cached = cache[hash];
      if (!cached) return repo.loadAs("tree", hash, onValue);
      result = { tree: cached };
    }
    else if (mode === 0120000) {
      cached = cache[hash];
      if (!cached) return repo.loadAs("text", hash, onValue);
      result = { link: cached };
    }
    else {
      result = {};
    }
    result.mode = mode;
    result.hash = hash;

    return callback(null, result);

    // Used by the symlink code to resolve the target against the path.
    function onPart(part) {
      // Ignore leading and trailing slashes as well as "." segments.
      if (!part || part === ".") return;
      // ".." pops a path segment from the stack
      if (part === "..") parts.pop();
      // New paths segments get pushed on top.
      else parts.push(part);
    }

  }

  function onValue(err, value) {
    if (value === undefined) return callback(err);
    cache[hash] = value;
    return walk();
  }

}

// Options can be "etag" and "head".
// If path is invalid (nothing is there), callback()
// If there is an error, callback(err)
// Otherwise callback(null, etag, fetch(cb))
//   Where fetch's callback returns the body or error.
// If the path is close (require a redirect) callback({location});
function servePath(root, path, reqEtag, callback) {
  if (!callback) return servePath.bind(this, root, path, reqEtag);
  var repo = this;
  repo.pathToEntry(root, path, onEntry);

  function onEntry(err, entry) {
    if (!entry) return callback(err);

    var etag;
    if (entry.mode === 040000) etag = 'W/"' + entry.hash + '"';
    else if (entry.mode & 0777) etag = '"' + entry.hash + '"';

    if (reqEtag && etag === reqEtag) {
      return callback(null, etag);
    }
    if (entry.mode === 040000) {
      // Directory
      if (path[path.length - 1] !== "/") {
        // Redirect if trailing slash is missing
        return callback({redirect: path + "/"});
      }
      // Auto-load index.html pages using internal redirect
      if (entry.tree["index.html"]) {
        path = pathJoin(path, "index.html");
        return callback({internalRedirect: path});
      }
      // Render tree as JSON listing.
      return callback(null, etag, function (callback) {
        var body = {
          mime: "application/json",
          body: JSON.stringify(entry.tree) + "\n"
        };
        callback(null, body);
      });
    }
    if (entry.mode & 0777) {
      // Static file, serve it as-is.
      return callback(null, etag, function (callback) {
        repo.loadAs("blob", entry.hash, callback);
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

}


