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

/*
 * The HTML page during this worker's own install. The page's precache entry
 * carries an `integrity` so a later precache miss is checked before it is
 * stored (#1345), but the page is the one file hosts and the software between
 * them and a player rewrite on the way: the Vercel toolbar's script for a
 * signed-in team member, an antivirus web shield, a filtering proxy. Checked at
 * install, one rewritten byte fails the whole install on every attempt, and that
 * installed app never sees another update (an installed copy sat on 2.33.0 that
 * way). So while this worker is installing, the page alone is fetched without
 * the check and stored as the server sent it. Scripts, styles and the engine
 * keep theirs. A browser without `self.serviceWorker` keeps the strict check.
 * The cost: a deploy that lands mid-install can leave the next build's page in
 * this worker's cache. Online that page still loads (its hashed files come from
 * the network), and the next worker's install replaces it.
 */
(function () {
  var nativeFetch = self.fetch;
  var isPage = function (url) {
    return /\.html?$/i.test(new URL(url).pathname);
  };
  self.fetch = function (input, init) {
    var installing = self.serviceWorker && self.serviceWorker.state === "installing";
    if (installing && input instanceof Request && input.mode !== "navigate" && input.integrity && isPage(input.url)) {
      return nativeFetch.call(self, new Request(input, { integrity: "" }), init);
    }
    return nativeFetch.apply(self, arguments);
  };
})();
