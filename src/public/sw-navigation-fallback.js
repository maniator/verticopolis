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
 *
 * Without the check, a deploy that lands mid-install could leave the next
 * build's page in this worker's cache, and an offline cold start would ask for
 * scripts this worker never stored. So the page is checked another way: the
 * build puts it after every `assets/` file in the precache manifest
 * (`pageLastTransform`), Workbox installs the entries one at a time in that
 * order, and every `assets/` file the page names must already be in the
 * precache. A page from another build names files that are not, and the
 * install fails, to be tried again at the next update check (#1949). A host's
 * rewrite adds its own script and names no `assets/` file, so it passes.
 * The precache can still hold an older build's files until this worker
 * activates, so the check is for a page newer than the worker, the one a
 * deploy brings; a rollback that lands mid-install is not caught.
 */
(function () {
  var nativeFetch = self.fetch;
  var isPage = function (url) {
    return /\.html?$/i.test(new URL(url).pathname);
  };
  // The same-origin `assets/` files the page's `src` and `href` attributes name.
  var assetsNamed = function (html, pageUrl) {
    var found = [];
    var attribute = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    var match;
    while ((match = attribute.exec(html)) !== null) {
      var url = new URL(match[1], pageUrl);
      if (url.origin === new URL(pageUrl).origin && /\/assets\//.test(url.pathname)) found.push(url.href);
    }
    return found;
  };
  // Whether every file in `urls` is in a Workbox precache.
  var allPrecached = function (urls) {
    return self.caches.keys().then(function (names) {
      var precaches = names.filter(function (name) {
        return name.indexOf("precache") !== -1;
      });
      return Promise.all(
        urls.map(function (url) {
          return Promise.all(
            precaches.map(function (name) {
              return self.caches.open(name).then(function (cache) {
                return cache.match(url, { ignoreSearch: true });
              });
            }),
          ).then(function (hits) {
            return hits.some(Boolean);
          });
        }),
      ).then(function (each) {
        return each.every(Boolean);
      });
    });
  };
  self.fetch = function (input, init) {
    var installing = self.serviceWorker && self.serviceWorker.state === "installing";
    if (installing && input instanceof Request && input.mode !== "navigate" && input.integrity && isPage(input.url)) {
      return nativeFetch.call(self, new Request(input, { integrity: "" }), init).then(function (response) {
        if (!response.ok) return response;
        return response
          .clone()
          .text()
          .then(function (html) {
            return allPrecached(assetsNamed(html, input.url));
          })
          .then(function (sameBuild) {
            if (!sameBuild) throw new TypeError("The page names files this worker does not precache, so it is from another build (#1949).");
            return response;
          });
      });
    }
    return nativeFetch.apply(self, arguments);
  };
})();
