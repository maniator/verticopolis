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
 * order, and every `assets/` file the page names must be one this worker
 * asked for earlier in the same install: looked up in the precache (a file
 * the installed build already cached and this build keeps, which Workbox
 * does not fetch again) or fetched for it. A page from another build names
 * files this build's manifest does not list, and the install fails, to be
 * tried again at the next update check (#1949). That holds for a page older
 * than the worker as well as a newer one: the precache can still hold the
 * previous build's files until this worker activates, but this worker never
 * asks for the ones its manifest dropped, so a rollback that lands
 * mid-install is refused too (#2206). A host's rewrite adds its own script
 * and names no `assets/` file, so it passes.
 */
(function () {
  var nativeFetch = self.fetch;
  var isPage = function (url) {
    return /\.html?$/i.test(new URL(url).pathname);
  };
  // The same-origin `assets/` files the page's `src` and `href` attributes
  // name. The build checks the page with the same pattern
  // (`pageAssetsMissing` in src/build/enginePackageBuild.ts). A value that is
  // no URL, as a host's rewrite could add, names no file of the build.
  var assetsNamed = function (html, pageUrl) {
    var found = [];
    var attribute = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    var match;
    while ((match = attribute.exec(html)) !== null) {
      var url;
      try {
        url = new URL(match[1], pageUrl);
      } catch (notAUrl) {
        continue;
      }
      if (url.origin === new URL(pageUrl).origin && /\/assets\//.test(url.pathname)) found.push(url.href);
    }
    return found;
  };
  // The files this worker asked for during this install, without their
  // query. Workbox installs its manifest one entry at a time: it looks each
  // entry up in its precache (`caches.match` with the precache's
  // `cacheName`), and fetches it, with an `integrity`, only when the lookup
  // misses. So by the page (the last entry) this holds every `assets/` file
  // the worker will keep, whether the installed build had already cached it
  // or not.
  var askedFor = Object.create(null);
  var bare = function (url) {
    return url.split("?")[0].split("#")[0];
  };
  var allAskedFor = function (urls) {
    return urls.every(function (url) {
      return askedFor[bare(url)] === true;
    });
  };
  var isInstalling = function () {
    return !!self.serviceWorker && self.serviceWorker.state === "installing";
  };
  var nativeMatch = self.caches && self.caches.match;
  if (nativeMatch) {
    self.caches.match = function (request, options) {
      var precache = !!options && typeof options.cacheName === "string" && options.cacheName.indexOf("precache") !== -1;
      if (precache && isInstalling()) askedFor[bare(new Request(request).url)] = true;
      return nativeMatch.apply(self.caches, arguments);
    };
  }
  self.fetch = function (input, init) {
    var installing = isInstalling();
    if (installing && input instanceof Request && input.mode !== "navigate" && input.integrity && !isPage(input.url)) {
      askedFor[bare(input.url)] = true;
    }
    if (installing && input instanceof Request && input.mode !== "navigate" && input.integrity && isPage(input.url)) {
      return nativeFetch.call(self, new Request(input, { integrity: "" }), init).then(function (response) {
        if (!response.ok) return response;
        return response
          .clone()
          .text()
          .then(function (html) {
            if (!allAskedFor(assetsNamed(html, input.url))) throw new TypeError("The page names files this worker does not precache, so it is from another build (#1949).");
            return response;
          });
      });
    }
    return nativeFetch.apply(self, arguments);
  };
})();
