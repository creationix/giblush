// Cache the tree entries by hash for faster path lookup.
var cache = {};

module.exports = function (repo) {

  repo.pathToEntry = pathToEntry;

  function loadTree(hash, callback) {
    var cached = cache[hash];
    if (cached) return callback(null, cached);
    repo.loadAs("tree", hash, function (err, tree) {
      if (tree === undefined) return callback(err);
      cache[hash] = tree;
      callback(null, tree);
    });
  }

  function loadLink(hash, callback) {
    var cached = cache[hash];
    if (cached) return callback(null, cached);
    repo.loadAs("text", hash, function (err, link) {
      if (link === undefined) return callback(err);
      cache[hash] = link;
      callback(null, link);
    });
  }

  // Given a hash to a tree and a path within that tree, return the directory
  // entry complete with mode and hash.
  // Tree entries contain body at `.tree`, symlinks contain data at `.link`.
  // Returns undefined when not found.
  function pathToEntry(root, path, callback) {
    if (!callback) return pathToEntry.bind(this, root, path);
    // Base case in recursion is the root itself as a tree.
    if (!path) {
      return loadTree(root, function (err, tree) {
        if (tree === undefined) return callback(err);
        return callback(null, {
          mode: 040000,
          hash: root,
          tree: tree
        });
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
          if (link === undefined) return callback(err);
          var target = resolve(dir, link);
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
        if (entry.mode === 040000) {
          return loadTree(entry.hash, function (err, tree) {
            if (tree === undefined) return callback(err);
            entry.tree = tree;
            callback(null, entry);
          });
        }
        if (entry.mode === 0120000) {
          return loadLink(entry.hash, function (err, link) {
            if (link === undefined) return callback(err);
            entry.link = link;
            callback(null, entry);
          });
        }
        return callback(null, entry);
      });
    }
  }
};

var pathJoin = require('path').join;
function resolve(source, target) {
  return pathJoin(source, "..", target);
}