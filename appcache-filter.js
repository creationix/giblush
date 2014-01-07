var sha1 = require('js-git/lib/sha1.js');

module.exports = appcache;
var pathJoin = require('js-linker/pathjoin.js');
var parallel = require('js-git/lib/parallel.js');

function appcache(req, callback) {
  parallel(req.args.map(function (file) {
    return req.repo.servePath(req.root, pathJoin(req.base, file));
  }), function (err, entries) {
    if (err) return callback(err);
    var manifest = "CACHE MANIFEST\n";
    entries.forEach(function(entry, i) {
      manifest += req.args[i] + " # " + entry.etag + "\n";
    });
    var etag = '"' + sha1(manifest) + '"';
    callback(null, {etag:etag,fetch:function (callback) {
      callback(null, manifest);
    }});
  });
}
