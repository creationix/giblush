var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var http = require('http');

if (cluster.isMaster) {
  // Fork workers.
  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });
} else {

http.createServer(require('./logic.js')).listen(8080);

console.log = function () {}

}
