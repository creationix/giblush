var pathJoin = require('js-linker/pathjoin.js');

// Cache the tree entries by hash for faster path lookup.
var cache = {};

// Cached compiled directories that contain wildcards.
var dirs = {};

module.exports = commands;
function commands(repo) {
  repo.servePath = servePath;
  repo.pathToEntry = pathToEntry;
  return commands;
}

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

  function patternCompile(source, target) {
    // Escape characters that are dangerous in regular expressions first.
    source = source.replace(/[\-\[\]\/\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    // Extract all the variables in the source and target and replace them.
    source.match(/\{[a-z]+\}/g).forEach(function (match, i) {
      source = source.replace(match, "([^/]*)");
      target = target.replace(match, '$' + (i + 1));
    });
    var match = new RegExp("^" + source + "$");
    match.target = target;
    return match;
  }

  function compileDir(hash, tree) {
    var left = 0;
    var wilds = Object.keys(tree).filter(function (key) {
      return tree[key].mode === 0120000 && /\{[a-z]+\}/.test(key);
    });
    dirs[hash] = wilds;
    wilds.forEach(function (key, i) {
      var hash = tree[key].hash;
      var link = cache[hash];
      if (link) {
        wilds[i] = patternCompile(key, link);
        return;
      }
      left++;
      repo.loadAs("text", hash, function (err, link) {
        if (err) throw err; // TODO: handle this properly
        cache[hash] = link;
        wilds[i] = patternCompile(key, link);
        if (!--left) walk();
      });
      if (!left) walk();
    });
  }

  function walk() {
    var cached;
    outer:
    while (index < length) {
      // If the parent is a tree, look for our path segment
      if (mode === 040000) {
        cached = cache[hash];
        // If it's not cached yet, abort and resume later.
        if (!cached) return repo.loadAs("tree", hash, onValue);
        var name = parts[index];
        var entry = cached[name];
        if (!entry) {
          var dir = dirs[hash];
          if (!dir) return compileDir(hash, cached);
          for (var i = 0, l = dir.length; i < l; i++) {
            var wild = dir[i];
            if (!wild.test(name)) continue;
            mode = 0120000;
            hash = hash + "-" + name;
            cache[hash] = name.replace(wild, wild.target);
            break outer;
          }
          return callback();
        }
        index++;
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
      return callback(null, {etag:etag});
    }
    if (entry.mode === 040000) {
      // Directory
      if (path[path.length - 1] !== "/") {
        // Redirect if trailing slash is missing
        return callback(null, {redirect: path + "/"});
      }
      // Auto-load index.html pages using internal redirect
      if (entry.tree["index.html"]) {
        path = pathJoin(path, "index.html");
        return callback(null, {internalRedirect: path});
      }
      // Render tree as JSON listing.
      return callback(null, { etag: etag, mime: "application/json", fetch: function (callback) {
        callback(null, JSON.stringify(entry.tree) + "\n");
      }});
    }
    if (entry.mode & 0777) {
      // Static file, serve it as-is.
      return callback(null, {etag: etag, fetch: function (callback) {
        repo.loadAs("blob", entry.hash, callback);
      }});
    }
    if (entry.mode === 0120000) {
      // Symbolic Link, execute the filter if any
      var index = entry.link.indexOf("|");
      var base = pathJoin(path, "..");

      // If it's a static symlink, redirect to the target but preserve the
      // original path.
      if (index < 0) {
        return repo.pathToEntry(root, pathJoin(base, entry.link), onEntry);
      }

      var target = entry.link.substr(0, index);
      var args = entry.link.substr(index + 1).split(" ");
      var name = args.shift();
      var command = commands[name];
      if (!command) return callback(new Error("Invalid filter name: " + name));
      var req = {
        base: base,
        repo: repo,
        root: root,
        etag: reqEtag,
        entry: entry,
        args: args
      };

      if (!target) return command(req, callback);

      return repo.servePath(root, pathJoin(base, target), null, function (err, target) {
        if (!target) return callback(err);
        req.target = target;
        command(req, callback);
      });
    }
  }

}


