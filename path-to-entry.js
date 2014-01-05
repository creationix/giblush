// Cache the tree entries by hash for faster path lookup.
var cache = {};

module.exports = function (repo) {
  repo.pathToEntry = pathToEntry;
};

// Given a hash to a tree and a path within that tree, return the directory
// entry complete with mode and hash.
// Tree entries contain body at `.tree`, symlinks contain data at `.link`.
// Returns undefined when not found.
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
