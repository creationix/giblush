module.exports = memDb;

function makeAsync(fn, callback) {
  if (!callback) return makeAsync.bind(this, fn);
  process.nextTick(function () {
    var result;
    try { result = fn(); }
    catch (err) { return callback(err); }
    if (result === undefined) return callback();
    return callback(null, result);
  });
}

function memDb() {

  // Store everything in ram!
  var objects;
  var others;
  var isHash = /^[a-z0-9]{40}$/;

  return {
    get: get,
    set: set,
    has: has,
    del: del,
    keys: keys,
    init: init,
    clear: init,
  };

  function get(key, callback) {
    console.log("DB-GET", key);
    return makeAsync(function () {
      if (isHash.test(key)) {
        return objects[key];
      }
      return others[key];
    }, callback);
  }

  function set(key, value, callback) {
    console.log("DB-SET", key);
    return makeAsync(function () {
      if (isHash.test(key)) {
        objects[key] = value;
      }
      else {
        others[key] = value.toString();
      }
    }, callback);
  }

  function has(key, callback) {
    console.log("DB-HAS", key);
    return makeAsync(function () {
      if (isHash.test(key)) {
        return key in objects;
      }
      return key in others;
    }, callback);
  }

  function del(key, callback) {
    console.log("DB-DEL", key);
    return makeAsync(function () {
      if (isHash.test(key)) {
        delete objects[key];
      }
      else {
        delete others[key];
      }
    }, callback);
  }

  function keys(prefix, callback) {
    console.log("DB-KEYS", prefix);
    return makeAsync(function () {
      var length = prefix.length;
      return Object.keys(others).filter(function (key) {
        return key.substr(0, length) === prefix;
      });
    }, callback);
  }

  function init(callback) {
    console.log("DB-INIT");
    return makeAsync(function () {
      objects = {};
      others = {};
    }, callback);
  }

}
