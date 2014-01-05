module.exports = appcache;
var pathJoin = require('js-linker/pathjoin.js');
var parallel = require('js-git/lib/parallel.js');

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
