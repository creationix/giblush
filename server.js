var http = require('http');
http.createServer(require('./logic.js')).listen(8080);
