/**
 * Keeping the heavy assets in the browser.
 *
 * The character GLBs and sky HDRs are ~20MB between them, and until now
 * every visit re-fetched whatever the HTTP cache had let go of. This
 * stores them in IndexedDB and serves them back on the next visit, so a
 * returning player waits on nothing but paint.
 *
 * Why IndexedDB and not the Cache Storage API, which is built for exactly
 * this: `caches` is exposed only in secure contexts, so it is simply
 * undefined over plain http — including the dev preview. IndexedDB has no
 * such restriction and is available everywhere the app runs.
 *
 * Why patch fetch rather than pre-seed THREE.Cache: three's FileLoader is
 * the one thing that pulls these files, and it goes through fetch(), so
 * this is a single choke point that needs no knowledge of which model the
 * player is about to choose. TextureLoader loads .webp through an <img>
 * element, which never reaches fetch — those stay on the HTTP cache and
 * are deliberately out of scope here.
 *
 * Every path falls back to the network. A cache that breaks loading is
 * worse than no cache at all, so every failure here is swallowed.
 */

const DB_NAME = 'b1ngster-assets'
const DB_VERSION = 1
const STORE = 'files'

// Only the big binaries three streams through fetch().
const CACHEABLE = /\.(glb|hdr)$/i

let dbPromise = null

const openDB = () => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    // Another tab holding an old version open would hang this forever.
    req.onblocked = () => reject(new Error('indexedDB blocked'))
  })
  // A failed open must not poison every later call.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

const tx = async (mode, run) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    t.onabort = () => reject(t.error)
    t.onerror = () => reject(t.error)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const idbGet = (key) => tx('readonly', (store) => store.get(key))
const idbPut = (key, value) => tx('readwrite', (store) => store.put(value, key))

/**
 * What counts as "the same file". The app already cache-busts its models
 * with ?v=N (MODEL_VERSION), so the query string IS the version — a
 * re-exported model bumps it and misses the cache exactly as intended.
 * The HDRs carry no version tag; their filenames are stable, and
 * clearAssetCache() is the escape hatch if one is ever replaced in place.
 */
const keyFor = (u) => u.pathname
const versionFor = (u) => u.search

const CONTENT_TYPE = { glb: 'model/gltf-binary', hdr: 'image/vnd.radiance' }

const cacheableUrl = (raw) => {
  try {
    const u = new URL(raw, window.location.href)
    if (u.origin !== window.location.origin) return null
    return CACHEABLE.test(u.pathname) ? u : null
  } catch {
    return null
  }
}

const fromCache = (bytes, u) => {
  const ext = u.pathname.split('.').pop().toLowerCase()
  return new Response(bytes, {
    status: 200,
    statusText: 'OK',
    headers: {
      // FileLoader reports download progress off Content-Length, so a
      // cache hit still drives the loading bars rather than stalling them.
      'Content-Length': String(bytes.byteLength),
      'Content-Type': CONTENT_TYPE[ext] || 'application/octet-stream',
      'X-Asset-Cache': 'hit',
    },
  })
}

const throughCache = async (u, doFetch) => {
  const key = keyFor(u)
  const version = versionFor(u)

  try {
    const hit = await idbGet(key)
    if (hit && hit.version === version && hit.bytes && hit.bytes.byteLength) {
      return fromCache(hit.bytes, u)
    }
  } catch {
    // no store, or it refused to open — just use the network
  }

  const response = await doFetch()
  // Read a clone so the caller still gets an untouched, unread body. Fire
  // and forget: writing must never hold up the load that triggered it.
  if (response.ok) {
    response
      .clone()
      .arrayBuffer()
      .then((bytes) => idbPut(key, { version, bytes, savedAt: Date.now() }))
      .catch(() => {
        // over quota, private mode, whatever — the asset still loaded
      })
  }
  return response
}

let installed = false

/**
 * Wrap fetch so cacheable assets go through IndexedDB first. Safe to call
 * more than once; call it before anything renders.
 */
export const installAssetCache = () => {
  if (installed) return false
  if (typeof window === 'undefined' || !window.indexedDB || !window.fetch) return false
  // ?nocache forces the network, for when you need to see a fresh export
  // without clearing storage by hand.
  if (new URLSearchParams(window.location.search).has('nocache')) return false

  const nativeFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    let u = null
    let method = 'GET'
    try {
      const isRequest = typeof Request !== 'undefined' && input instanceof Request
      method = String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase()
      if (method === 'GET') u = cacheableUrl(isRequest ? input.url : String(input))
    } catch {
      u = null
    }
    if (!u) return nativeFetch(input, init)
    // A failure anywhere in the cache path still has to resolve to a real
    // response, so the fallback is the untouched original call.
    return throughCache(u, () => nativeFetch(input, init)).catch(() => nativeFetch(input, init))
  }
  // Reachable from the console: the HDRs carry no version tag, so an
  // in-place replacement needs a manual bust.
  //   await b1ngsterAssets.clear()   /   await b1ngsterAssets.stats()
  window.b1ngsterAssets = { clear: clearAssetCache, stats: assetCacheStats }
  installed = true
  return true
}

/** Forget every stored asset — the manual bust for an in-place re-export. */
export const clearAssetCache = async () => {
  try {
    await tx('readwrite', (store) => store.clear())
    return true
  } catch {
    return false
  }
}

/** What is actually being held, for a debug readout. */
export const assetCacheStats = async () => {
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly')
      const store = t.objectStore(STORE)
      const out = { count: 0, bytes: 0, files: [] }
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) return resolve(out)
        const size = c.value?.bytes?.byteLength || 0
        out.count += 1
        out.bytes += size
        out.files.push({ url: c.key, version: c.value?.version, bytes: size })
        c.continue()
      }
      cursor.onerror = () => reject(cursor.error)
    })
  } catch {
    return { count: 0, bytes: 0, files: [] }
  }
}
