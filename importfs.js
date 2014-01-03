var fs = require('fs');
var pathJoin = require('path').join;

// Given a repo instance and a fs path, import the path (recursivly) and return
// the final root hash.  Supports symlinks and executable files.
module.exports = function (repo, path, callback) {
  return importPath(repo, path, function (err, stat) {
    if (err) return callback(err);
    return callback(null, stat.hash);
  });
};

function importPath(repo, path, callback) {
  if (!callback) return importPath.bind(this, repo, path);
  var stat;
  fs.lstat(path, onStat);

  function onStat(err, result) {
    if (err) return callback(err);
    stat = result;
    if (stat.isFile()) {
      return fs.readFile(path, onData);
    }
    if (stat.isDirectory()) {
      return fs.readdir(path, onDir);
    }
    if (stat.isSymbolicLink()) {
      return fs.readlink(path, onData);
    }
    return callback(new Error("Can't import non-file " + path));
  }

  function onDir(err, names) {
    if (err) return callback(err);
    parallel(names.map(function (name) {
      return importPath(repo, pathJoin(path, name));
    }), function (err, stats) {
      if (err) return callback(err);
      var dir = names.map(function (name, i) {
        var stat = stats[i];
        return {
          name: name,
          mode: stat.isDirectory() ? 040000 :
                stat.isSymbolicLink() ? 0120000 :
                (stat.mode & 0111) ? 0100755 : 0100644,
          hash: stat.hash
        };
      });
      repo.saveAs("tree", dir, onSave);
    });
  }

  function onData(err, buffer) {
    if (err) return callback(err);
    repo.saveAs("blob", buffer, onSave);
  }

  function onSave(err, hash) {
    if (err) return callback(err);
    stat.hash = hash;
    callback(null, stat);
  }


}

function parallel(commands, callback) {
  var results, length, left, i, done;

  left = length = commands.length;
  results = new Array(left);
  for (i = 0; i < length; i++) {
    run(i, commands[i]);
  }

  function run(key, command) {
    command(function (err, result) {
      if (done) return;
      if (err) {
        done = true;
        return callback(err);
      }
      results[key] = result;
      if (--left) return;
      done = true;
      callback(null, results);
    });
  }
}
