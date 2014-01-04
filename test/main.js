var domBuilder = require('dombuilder');

// Clear the body
document.body.textContent = "";
// Add a nice header and paragraph
document.body.appendChild(domBuilder([
  ["h1", "Hello World"],
  ["p", "This is a sample webpage served from js-git dynamically"]
]));
