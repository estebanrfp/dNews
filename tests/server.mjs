// Static server for the suite: the repo root, everything no-store, so an
// edited file is what the next navigation loads. Signalling goes through the
// public relays unless DNEWS_RELAY names one of your own (a local relay makes
// discovery deterministic; the public ones can take a while to pair peers).
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml" }
Bun.serve({
  port: Number(process.env.PORT) || 5705,
  async fetch(req) {
    let { pathname } = new URL(req.url)
    if (pathname === "/") pathname = "/index.html"
    const file = Bun.file(ROOT + pathname)
    if (!(await file.exists())) return new Response("404", { status: 404 })
    const ext = pathname.split(".").pop()
    return new Response(file, { headers: { "Cache-Control": "no-store", "Content-Type": TYPES[ext] ?? "application/octet-stream" } })
  },
})
console.log(`dNews on http://localhost:${Number(process.env.PORT) || 5705}`)
