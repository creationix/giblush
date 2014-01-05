var domBuilder = require('dombuilder');

// Clear the body
document.body.textContent = "";
// Add a nice header and paragraph
document.body.appendChild(domBuilder([
  ["h1", "Hello World"],
  ["p", "This is a sample webpage served from js-git dynamically"]
]));

window.addEventListener('load', function(e) {
  window.applicationCache.addEventListener('updateready', function(e) {
    if (window.applicationCache.status == window.applicationCache.UPDATEREADY) {
        window.location.reload();
    }
  }, false);
}, false);
