/*
 * Imported by the service worker (`importScripts` in vite.config.ts), before
 * Workbox starts. Every precache entry carries an `integrity`, so a precache
 * miss fetched with it fails when the server's bytes are not the ones this
 * worker was built for: a deploy newer than the worker, after the browser
 * dropped the cache. A failed subresource is a missing file the page copes
 * with, or the engine's own byte check refuses on purpose. A failed
 * navigation is a blank page while the player is online, so a navigation whose
 * response fails is fetched from the network without the integrity and is not
 * stored. The next worker's own install refills the cache with matching
 * bytes. Offline, the fetch fails too and the browser shows its own page, as
 * it does without this file.
 *
 * Plain script, no modules: a worker loads it with importScripts, and it
 * changes how a worker answers every navigation, so keep it small.
 */
(function () {
  var respondWith = FetchEvent.prototype.respondWith;
  FetchEvent.prototype.respondWith = function (response) {
    var request = this.request;
    if (request.mode !== "navigate") return respondWith.call(this, response);
    return respondWith.call(
      this,
      Promise.resolve(response).catch(function () {
        return fetch(request);
      }),
    );
  };
})();
