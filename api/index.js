var MutantMap = require('@mmckegg/mutant/map')
var electron = require('electron')
var Profiles = require('./profiles')
var schemas = require('ssb-msg-schemas')
var Proxy = require('@mmckegg/mutant/proxy')
var computed = require('@mmckegg/mutant/computed')
var mlib = require('ssb-msgs')
var onceTrue = require('../lib/once-true')

var callbacks = {}
electron.ipcRenderer.on('response', (ev, id, ...args) => {
  var cb = callbacks[id]
  if (cb) {
    delete callbacks[id]
    cb(...args)
  }
})

module.exports = function (ssbClient, config) {
  var windowId = Date.now()
  var seq = 0
  var profiles = null
  var profilesLoaded = Proxy()
  var scope = (config.friends || {}).scope

  return {
    id: ssbClient.id,
    getDiscoveryFeed (cb) {
      checkProfilesLoaded()
      return lookupItems(sortedPostIds(profiles.pubFriendPostIds))
    },

    getFollowingFeed (cb) {
      checkProfilesLoaded()
      var profile = profiles.get(ssbClient.id)
      var postIds = computed([profile.following, profiles.lookup], (following, profiles) => {
        var result = []
        following.forEach((id) => {
          var otherProfile = profiles[id]
          if (otherProfile) {
            otherProfile.posts.forEach(x => result.push(x))
          }
        })
        return result
      }, { nextTick: true })

      return lookupItems(sortedPostIds(postIds))
    },

    getProfileFeed (id, cb) {
      checkProfilesLoaded()
      return lookupItems(reverse(profiles.get(id).posts))
    },

    setOwnDisplayName (name, cb) {
      ssbClient.publish({
        type: 'about',
        about: ssbClient.id,
        name: name
      }, (err) => cb && cb(err))
    },

    getLikedFeedFor (id) {
      checkProfilesLoaded()
      var likes = profiles.get(id).likes
      return lookupItems(likes)
    },

    profilesLoaded,

    getProfile (id) {
      checkProfilesLoaded()
      return profiles.get(id)
    },

    rankProfileIds (ids, max) {
      checkProfilesLoaded()
      return profiles.rankProfileIds(ids, max)
    },

    getOwnProfile () {
      checkProfilesLoaded()
      return profiles.get(ssbClient.id)
    },

    getSuggestedProfiles (max) {
      checkProfilesLoaded()
      return profiles.getSuggested(max)
    },

    publish,

    follow (id, cb) {
      checkProfilesLoaded(() => {
        var profile = profiles.get(id)
        var msg = schemas.follow(id)
        msg.scope = scope
        if (profile.isPub()) {
          msg.pub = true
        }
        publish(msg, cb)
      })
    },

    unfollow (id, cb) {
      publish(schemas.unfollow(id), cb)
    },

    like (id, cb) {
      var likeLink = mlib.link(id)
      likeLink.value = true
      publish({
        type: 'ferment/like',
        like: likeLink
      }, cb)
    },

    unlike (id, cb) {
      var unlikeLink = mlib.link(id)
      unlikeLink.value = false
      publish({
        type: 'ferment/like',
        like: unlikeLink
      }, cb)
    },

    repost (id, cb) {
      var repostLink = mlib.link(id)
      repostLink.value = true
      publish({
        type: 'ferment/repost',
        repost: repostLink
      }, cb)
    },

    unrepost (id, cb) {
      var unrepostLink = mlib.link(id)
      unrepostLink.value = false
      publish({
        type: 'ferment/repost',
        repost: unrepostLink
      }, cb)
    },

    getPost (id) {
      checkProfilesLoaded()
      return profiles.getPost(id)
    },

    addBlob (dataOrPath, cb) {
      var id = `${windowId}-${seq++}`
      callbacks[id] = cb
      electron.ipcRenderer.send('add-blob', id, dataOrPath)
    },

    getBlobUrl (id) {
      if (id && id.startsWith('blobstore:')) {
        return `http://localhost:${config.blobsPort}/${id.slice(10)}`
      } else {
        return `http://localhost:${config.blobsPort}/${id}`
      }
    }
  }

  // scoped

  function sortedPostIds (ids) {
    return computed([ids], function (ids) {
      return ids.map(id => profiles.getPost(id)).sort((a, b) => b.timestamp() - a.timestamp()).map(x => x.id)
    }, { nextTick: true })
  }

  function reverse (ids) {
    return computed([ids], function (ids) {
      var result = []
      ids.forEach((id, i) => {
        result[ids.length - 1 - i] = id
      })
      return result
    })
  }

  function checkProfilesLoaded (cb) {
    if (!profiles) {
      profiles = Profiles(ssbClient, config)
      profilesLoaded.set(profiles.sync)
      if (cb) {
        onceTrue(profiles.sync, cb)
      }
    } else if (cb) {
      cb()
    }
  }

  function publish (message, cb) {
    ssbClient.publish(message, function (err, msg) {
      if (!cb && err) throw err
      cb && cb(err, msg)
    })
  }

  function lookupItems (ids) {
    var result = MutantMap(ids, (id) => {
      return profiles.postLookup.get(id)
    })

    result.sync = profiles.sync
    return result
  }
}
