import 'es6-symbol/implement'

import utils from './utils.js'
import { EventEmitter } from './events.js'
import mix from './mix.js'
import hash from './hash.js'
import list from './list.js'
import set from './set.js'
import zset from './zset.js'
import mise from './mise.js'
import { memStore, localStore } from './stores.js'

const noop = utils.noop

const min = {}
export default min

utils.extend(min, EventEmitter.prototype)
min.EventEmitter = EventEmitter
min.Promise = Promise

min.memStore = memStore
min.localStore = localStore

const logLevels = [ 'info', 'warn', 'error' ]

min.logLevel = 'info'

Promise.onPossiblyUnhandledRejection((err, promise) => {
  if (logLevels.indexOf(min.logLevel) < 1) {
    console.error(err)
  }
})

min.store = new localStore()

let _keys = min._keys = {}
let _keysTimer = null
const _types = {
  0 : 'mix',
  1 : 'hash',
  2 : 'list',
  3 : 'set',
  4 : 'zset'  // Sorted Set
}

/**
 * Fork a new MinDB object
 * @return {Object} new min object
 */
min.fork = function() {
  const rtn = {}

  const keys = Object.getOwnPropertyNames(this)

  for (let i = 0; i < keys.length; i++) {
    const prop = keys[i]
    if (this.hasOwnProperty(prop)) {
      rtn[prop] = this[prop]
    }
  }

  return rtn
}


/*********
** Keys **
*********/

/**
 * Delete a key
 * @param  {String}   key      Key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.del = function(key, callback = noop) {
  // Promise Object
  const promise = new Promise((resolve, reject) => {

  // Store
  const store = this.store

  // Key prefix
  const $key = 'min-' + key

  if (store.async) {
    // Async Store Operating

    const load = () => {
      // Value processing
      store.remove($key, err => {
        if (err) {
          // Error!
          reject(err)
          return callback(err)
        }

        delete this._keys[key]

        // Done
        resolve(key)
        callback(null, key)
      })
    }

    if (store.ready) {
      load()
    } else {
      store.on('ready', load)
    }
  } else {
    try {
      store.remove($key)

      delete this._keys[key]

      // Done
      resolve(key)
      callback(null, key)
    } catch(err) {
      // Error!
      reject(err)
      callback(err)
    }
  }
  })

  promise.then(() => {
    this.emit('del', key)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 1000)
  })


  return promise
}

/**
 * Check a key is exists or not
 * @param  {String}   key      Key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.exists = function(key, callback = noop) {
  // Promise Object
  return new Promise(resolve => {
    this.get(key)
      .then(value => {
        resolve(true)
        callback(null, true)
      })
      .catch(err => {
        resolve(false)
        return callback(null, false)
      })
  })
}

/**
 * Rename a old key
 * @param  {String}   key      the old key
 * @param  {String}   newKey   the new key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.renamenx = function(key, newKey, callback = noop) {
  // Promise object
  const promise = new Promise((resolve, reject) => {

  try {
    // Error handle
    const reject = err => {
      reject(err)
      callback(err)
    }

    let type = null
    let value = null

    this.exists(key)
      .then(exists => {
        if (!exists) {
          const err = new Error('no such key')

          reject(err)
        } else {
          return this.get(key)
        }
      })
      .then(_value => {
        type = this._keys[key]
        value = _value

        return this.del(key)
      })
      .then(_ => {
        return this.set(newKey, value, callback)
      })
      .then(
        _ => {
          this._keys[newKey] = type
          resolve('OK')
          callback(null, 'OK')
        },
        reject
      )

  } catch(err) {
    reject(err)
  }
  })

  promise.then(_ => {
    this.emit('rename', key, newKey)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })


  return promise
}

/**
 * Rename a old key when the old key is not equal to the new key
 * and the old key is exiest.
 * @param  {String}   key      the old key
 * @param  {String}   newKey   the new key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.rename = function(key, newKey, callback = noop) {
  // Promise object
  const promise = new Promise((resolve, reject) => {

    // Error handle
    const _reject = err => {
      reject(err)
      callback(err)
    }

    if (key == newKey) {
      // The origin key is equal to the new key
      reject(new Error('The key is equal to the new key.'))
    } else {
      this.renamenx.apply(this, arguments)
        .then(resolve)
        .catch(_reject)
    }
  })

  promise.then(_ => {
    this.emit('rename', key, newKey)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })

  return promise
}

/**
 * Return the keys which match by the pattern
 * @param  {String}   pattern  Pattern
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.keys = function(pattern, callback = noop) {

  // Promise object
  return new Promise(resolve => {

    // Stored keys
    const keys = Object.keys(this._keys)

    // Filter
    const filter = new RegExp(pattern
      .replace('?', '(.)')
      .replace('*', '(.*)'))

    const ret = []

    for (let i = 0; i < keys.length; i++) {
      if (keys[i].match(filter)) {
        ret.push(keys[i])
      }
    }

    // Done
    resolve(ret)
    callback(null, ret)

  })
}

/**
 * Return a key randomly
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.randomkey = function(callback = noop) {

  // Promise Object
  return new Promise(resolve => {

    // Stored keys
    const keys = Object.keys(this._keys)

    // Random Key
    const index = Math.round(Math.random() * (keys.length - 1))

    // Done
    const $key = keys[index]
    resolve($key)
    callback(null, $key)
  })
}

/**
 * Return the value's type of the key
 * @param  {String}   key      the key
 * @param  {Function} callback Callback
 * @return {Promise}           Promise Object
 */
min.type = function(key, callback = noop) {

  // Promise Object
  return new Promise(resolve => {

    if (this._keys.hasOwnProperty(key)) {
      resolve(_types[this._keys[key]])
      callback(null, callback)
    } else {
      resolve(null)
      callback(null, null)
    }
  })
}

/**
 * Remove all keys in the db
 * @param  {Function} callback Callback
 * @return {Object}            min
 */
min.empty = function(callback = noop) {
  const keys = Object.keys(this._keys)
  let removeds = 0

  const promise = new Promise(resolve => {

    const loop = key => {
      if (key) {
        this.del(key, err => {
          if (!err) {
            removeds++
          }

          loop(keys.shift())
        })
      } else {
        resolve(removeds)
        callback(null, removeds)
      }
    }

    loop(keys.shift())
  })
  promise.then(len => {
    this.emit('empty', len)
    if (_keysTimer) {
      clearTimeout(_keysTimer)
    }

    _keysTimer = setTimeout(this.save.bind(this), 5 * 1000)
  })

  return promise
}

/**
 * Save the dataset to the Store Interface manually
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.save = function(callback = noop) {
  const promise = new Promise((resolve, reject) => {

    this.set('min_keys', JSON.stringify(this._keys))
      .then(_ => this.dump())
      .then(([ dump, strResult ]) => {
        resolve([dump, strResult])
        callback(dump, strResult)
      }, err => {
        reject(err)
        callback(err)
      })
  })

  promise.then(([ dump, strResult ]) => {
    this.emit('save', dump, strResult)
  })

  return promise
}

/**
 * Return the dataset of MinDB
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.dump = function(callback = noop) {
  let loop = null
  return new Promise((resolve, reject) => {
    const rtn = {}

    this.keys('*', (err, keys) => {
      if (err) {
        reject(err)
        return callback(err)
      }

      (loop = key => {
        if (key) {
          this.get(key)
            .then(value => {
              rtn[key] = value
              loop(keys.shift())
            }, err => {
              reject(err)
              callback(err)
            })
        } else {
          const strResult = JSON.stringify(rtn)
          resolve([ rtn, strResult ])
          callback(null, rtn, strResult)
        }
      })(keys.shift())
    })
  })
}

/**
 * Restore the dataset to MinDB
 * @param  {Object}   dump     dump object
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.restore = function(dump, callback = noop) {
  const promise = new Promise((resolve, reject) => {

  const keys = Object.keys(dump)

  const done = _ => {
    this
      .exists('min_keys')
      .then(exists => {
        if (exists) {
          return this.get('min_keys')
        } else {
          resolve()
          callback()
        }
      })
      .then(keys => {
        _keys = JSON.parse(keys)

        resolve()
        callback()
      })
      .catch(err => {
        promise.rejeect(err)
        callback(err)
      })
  }

  const loop = key => {
    if (key) {
      this.set(key, dump[key])
        .then(_ => {
          loop(keys.shift())
        }, err => {
          reject(err)
          callback(err)
        })
    } else {
      done()
    }
  }

  loop(keys.shift())
  })

  promise.then(_ => {
    this.save(_ => {
      this.emit('restore')
    })
  })

}

const watchers = {}

/**
 * Watch the command actions of the key
 * @param  {String}   key      key to watch
 * @param  {String}   command  command to watch
 * @param  {Function} callback callback
 * @return {Promise}           promise
 */
min.watch = function(key, command, callback) {
  if ('undefined' === typeof callback && command.apply) {
    callback = command
    command = 'set'
  }

  const watcherId = Math.random().toString(32).substr(2)

  if (!watchers[key]) watchers[key] = {}

  watchers[key][watcherId] = (_key, ...args) => {
    if (_key !== key) return
    callback.call(this, ...args)
  }

  watchers[key][watcherId].command = command

  this.on(command, watchers[key][watcherId])

  return watcherId
}

/**
 * Unbind the watcher
 * @param  {String} key       key to unwatch
 * @param  {String} watcherId watcher's id
 * @param  {String} command   command
 */
min.unwatch = function(key, command, watcherId) {
  if ('undefined' === typeof watcherId && !!command) {
    watcherId = command
    command = 'set'
  }

  this.removeListener(command, watchers[key][watcherId])
}

/**
 * Unbind all the watcher of the key
 * @param  {String} key key to unwatch
 */
min.unwatchForKey = function(key) {
  const watchersList = watchers[key]

  for (let id in watchersList) {
    const watcher = watchersList[id]
    this.removeListener(watcher.command, watcher)
  }
}


// Methods
utils.extend(min, hash)
utils.extend(min, list)
utils.extend(min, set)
utils.extend(min, zset)
utils.extend(min, mise)
utils.extend(min, mix)

// Apply
const handle = function(err, value) {
  if (err || !value) {
    min._keys = {}
    return
  }

  try {
    min._keys = JSON.parse(keys)
  } catch(err) {
    min._keys = {}
  }
}
if (min.store.async) {
  min.store.get('min-min_keys', handle)
} else {
  try {
    const val = min.store.get('min-min_keys')
    handle(null, val)
  } catch(err) {
    handle(err)
  }
}
