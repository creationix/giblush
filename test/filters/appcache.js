var sha1 = require('sha1');
var pathJoin = require('path-join');
var parallel = require('parallel');

var mime = "text/cache-manifest";

module.exports = appcache;

function appcache(req, callback) {
  // If the file list is external, we use the root and file hash for etag
  if (req.target) {
    var etag = 'W/"' + sha1(req.root + "-" + req.target.hash) + '"';
    return callback(null, {etag: etag, mime: mime, fetch: function (callback) {
      req.target.fetch(function (err, input) {
        if (err) return callback(err);
        input = ("" + input).split("\n").filter(Boolean);
        req.args = req.args.concat(input);
        render(req, callback);
      });
    }});
  }

  // If it's all args, we can generate the actual manifest without any I/O
  // and get better caching semantics.
  render(req, function (err, manifest) {
    if (err) return callback(err);
    var etag = 'W/"' + sha1(manifest) + '"';
    callback(null, {etag: etag, mime: mime, fetch:function (callback) {
      callback(null, manifest);
    }});
  });
}
function render(req, callback) {
  parallel(req.args.map(function (file) {
    return req.repo.servePath(req.root, pathJoin(req.base, file));
  }), function (err, entries) {
    if (err) return callback(err);
    var manifest = "CACHE MANIFEST\n";
    entries.forEach(function(entry, i) {
      if (entry) {
        manifest += req.args[i] + "#" + entry.etag + "\n";
      }
      else {
        manifest += req.args[i] + "\n";
      }
    });
    callback(null, manifest);
  });
}