/*global PIXI, requestAnimFrame*/

window.addEventListener('load', function () {

  window.applicationCache.addEventListener('updateready', function() {
    if (window.applicationCache.status == window.applicationCache.UPDATEREADY) {
        window.location.reload();
    }
  }, false);

var width = window.innerWidth;
var height = window.innerHeight;
var colors = ['green', 'blue', 'brown', 'white', 'yellow', 'orange', 'purple',
              'red', 'grey'];
var loader = new PIXI.AssetLoader(["sprites.json"]);
loader.onComplete = onAssetsLoaded;
loader.load();


// create a renderer instance.
var renderer = PIXI.autoDetectRenderer(width, height);

// create an new instance of a pixi stage
var stage = new PIXI.Stage(0);

// add the renderer view element to the DOM
document.body.textContent = "";
document.body.appendChild(renderer.view);

var balls = [];
var sparks = [];
var sources = {};
var start = 0, before;

function onAssetsLoaded() {

  // Create a few balls on the screen
  var x = 0;
  var rad = 0;
  var r = Math.min(window.innerHeight, window.innerWidth) / 3;
  while (r >= 24) {
    var c = Math.PI * r * 2;
    var count = c / 48;
    var step = Math.PI * 2 / count;
    r -= 48 / count;
    rad += step;
    var colorName = colors[x++ % colors.length];
    var ball = PIXI.Sprite.fromFrame(colorName);
    ball.position.x = (width / 2 + Math.sin(rad) * r)|0;
    ball.position.y = (height / 2 - Math.cos(rad) * r)|0;
    ball.anchor.x = 0.5;
    ball.anchor.y = 0.5;
    ball.mx = 0;
    ball.my = 0;
    ball.animate = animateBall;
    balls.push(ball);
    stage.addChild(ball);
  }

  // Add input listeners
  listen();

	// start animating
  before = Date.now();
	requestAnimFrame(animate);
}

function explode(x, y, owner) {
  start = (start + 11) % 360;
  var end = start + 360;
  for (var i = start; i < end; i += 72) {
    var spark = PIXI.Sprite.fromFrame("dart");
    var rotation = i * Math.PI / 180;
    spark.position.x = x + Math.sin(rotation) * 10;
    spark.position.y = y - Math.cos(rotation) * 10;
    spark.pivot.x = 24;
    spark.pivot.y = 24;
    spark.owner = owner;
    spark.lifetime = 200;
    spark.rotation = rotation;
    spark.mx = Math.sin(rotation);
    spark.my = -Math.cos(rotation);
    spark.animate = animateSpark;
    sparks.push(spark);
    stage.addChild(spark);
  }
}


function animate() {
  var now = Date.now();
  var delta = Math.min(33, now - before);
  before = now;

  for (var key in sources) {
    var source = sources[key];
    explode(source.x, source.y);
  }

  for (i = balls.length - 1; i >= 0; --i) {
    balls[i].animate(i, delta);
  }
  for (var i = sparks.length - 1; i >= 0; --i) {
    sparks[i].animate(i, delta);
  }
  renderer.render(stage);
  requestAnimFrame(animate);
}

function animateSpark(index, delta) {
  this.rotation += Math.sin(before / 500 + index / 10) / 10;
  this.mx = Math.sin(this.rotation);
  this.my = -Math.cos(this.rotation);
  var len = delta >> 2;
  this.lifetime -= len;
  this.position.x += this.mx * len;
  this.position.y += this.my * len;
  checkCollision(this);

  if (this.lifetime < 0 ||
      this.position.x < -24 || this.position.x > width ||
      this.position.y < -24 || this.position.y > height) {
    sparks.splice(index, 1);
    stage.removeChild(this);
  }
}

function checkCollision(spark) {
  var i = balls.length;
  while (i--) {
    var ball = balls[i];
    if (ball === spark.owner) continue;
    var dx = spark.position.x - ball.position.x;
    var dy = spark.position.y - ball.position.y;
    var dist = dx * dx + dy * dy;
    if (dist < 2000) {
      ball.mx += spark.mx / 40;
      ball.my += spark.my / 40;
      spark.lifetime -= 20;
      return;
    }
  }
}

function animateBall(index, delta) {
  this.position.x += this.mx * delta / 5;
  this.position.y += this.my * delta / 5;
  if (this.explode) {
    explode(this.position.x, this.position.y, this);
    if (!--this.explode) {
      balls.splice(index, 1);
      stage.removeChild(this);
      return;
    }
  }
  var bounced = false;
  if (this.position.x < 24) {
    this.position.x = 24;
    this.mx *= -1;
    bounced = true;
  }
  else if (this.position.x > width - 24) {
    this.position.x = width - 24;
    this.mx *= -1;
    bounced = true;
  }
  if (this.position.y < 24) {
    this.position.y = 24;
    this.my *= -1;
    bounced = true;
  }
  else if (this.position.y > height - 24) {
    this.position.y = height - 24;
    this.my *= -1;
    bounced = true;
  }
  if (bounced) {
    // explode(this.position.x, this.position.y, this);
    if (this.mx * this.mx + this.my * this.my > 6) {
      var velocity = Math.sqrt(this.mx * this.mx + this.my * this.my);
      this.mx *= 0.99 + Math.random() - 0.5;
      this.my *= 0.99 + Math.random() - 0.5;
      this.explode = Math.floor(velocity + 1) * 10;
    }
  }
}

function listen() {
  // Listen for mouse and touch events
  var element = document.body;
  element.addEventListener('mousedown', function (e) {
    e.preventDefault();
    onDown("mouse", e.clientX, e.clientY);
  }, true);
  element.addEventListener('mousemove', function (e) {
    e.preventDefault();
    onMove("mouse", e.clientX, e.clientY);
  }, true);
  element.addEventListener('mouseup', function (e) {
    e.preventDefault();
    onUp("mouse", e.clientX, e.clientY);
  }, true);
  element.addEventListener('touchstart', function (e) {
    e.preventDefault();
    for (var i = 0, l = e.changedTouches.length; i < l; i++) {
      var touch = e.changedTouches[i];
      onDown(touch.identifier, touch.clientX, touch.clientY);
    }
  }, true);
  element.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0, l = e.changedTouches.length; i < l; i++) {
      var touch = e.changedTouches[i];
      onMove(touch.identifier, touch.clientX, touch.clientY);
    }
  }, true);
  element.addEventListener('touchend', function (e) {
    e.preventDefault();
    for (var i = 0, l = e.changedTouches.length; i < l; i++) {
      var touch = e.changedTouches[i];
      onUp(touch.identifier);
    }
  }, true);
}

function onDown(key, x, y) {
  sources[key] = {
    x: x,
    y: y
  };
}

function onUp(key) {
  delete sources[key];
}

function onMove(key, x, y) {
  if (sources[key]) {
    sources[key].x = x;
    sources[key].y = y;
  }
}

}, false);

