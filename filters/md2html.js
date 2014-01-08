var markdown = require( "markdown" ).markdown;
module.exports = md2html;

function md2html(req, callback) {
  var etag = req.target.etag;
  etag = etag.substr(0, etag.length - 1) + '-md"';
  callback(null, {etag: etag, mime: "text/html", fetch: fetch});
  function fetch(callback) {
    req.target.fetch(function (err, input) {
      if (err) return callback(err);
      var html;
      try { html = markdown.toHTML(input + "") + "\n"; }
      catch (err) { return callback(err); }
      callback(null, html);
    });
  }
}
