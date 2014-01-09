var http = require('http');
http.createServer(require('./logic.js')).listen(process.env.PORT || 8080);
