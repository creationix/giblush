var markdown = require( "markdown" ).markdown;
module.exports = md2html;

function md2html(req, callback) {
  callback(null, {etag: req.target.etag, mime: "text/html", fetch: fetch});
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
