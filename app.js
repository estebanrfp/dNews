// dNews — a Hacker News clone with no server.
//
// Every story, comment, vote, flag and vouch is a node in a GenosDB graph that
// lives in each visitor's browser and syncs peer-to-peer over WebRTC. The
// Security Manager signs every write and every peer verifies it: a node can
// only be changed by its owner, a role is only valid with the authority's
// signature, and a guest's write is refused on every receiver. What you see —
// points, karma, trust, ranking, dead items — is derived by this browser from
// those signed nodes with the rules of constitution.js, the same rules every
// other browser runs. Nobody moderates; everybody calculates.
import { gdb } from "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/index.min.js"
import { CONSTITUTION, DEMO_IDENTITIES, SUPERADMIN, ALICE, BOB, governanceRules } from "./constitution.js"

const T = CONSTITUTION.thresholds
const AUTHORITY = CONSTITUTION.authority.toLowerCase()
const $ = (id) => document.getElementById(id)
const eqAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// `?room=` opens a private sandbox of the same site (the tests use it, so can
// you); `?relay=` points signalling at a relay of your own.
const params = new URLSearchParams(location.search)
const ROOM = params.get("room") ?? "dnews"
const RELAY = params.get("relay")
const PASSKEYS_AVAILABLE = window.isSecureContext && !!window.PublicKeyCredential &&
  !/^\d{1,3}(\.\d{1,3}){3}$/.test(location.hostname) // an IP is never an RP ID

// ── Boot: the constitution travels beside the root of trust ─────────────────
const db = await gdb(ROOM, {
  rtc: RELAY ? { relayUrls: [RELAY] } : true,
  sm: { superAdmins: [CONSTITUTION.authority], customRoles: CONSTITUTION.roles, governanceRules, acls: true },
})

// ── The store: one subscription, every kind of node ─────────────────────────
// The four actions land here and nowhere else; every view derives from it.
const nodes = new Map()
let me = null, session = {}
await db.map({ query: { $or: [{ type: { $in: ["story", "comment", "vote", "flag", "vouch"] } }, { role: { $exists: true } }] } },
  ({ id, value, timestamp, action }) => {
    if (action === "removed") nodes.delete(id)
    else nodes.set(id, { id, value, timestamp })
    scheduleRender()
  })

// ── Derivation: the constitution, applied by this peer ──────────────────────
// Everything below is a pure function of the store. Trust is a chain of
// vouches from the authority; a vote or a flag counts only from a trusted
// owner; karma is what your items earned from trusted votes, minus what your
// invitees cost you. The authority writes the same number on user nodes so
// the role rules can read it — anyone can recount it with this code.
const derive = () => {
  const all = [...nodes.values()]
  const of = (type) => all.filter((n) => n.value.type === type)
  const users = new Map() // address → user node value
  for (const n of all) if (n.id.startsWith("user:")) users.set(n.id.slice(5).toLowerCase(), { ...n.value, _ts: n.timestamp, _id: n.id })
  const roleOf = (addr) => eqAddr(addr, AUTHORITY) ? "superadmin" : (users.get(addr?.toLowerCase())?.role ?? "guest")

  // One vote per owner and item: the earliest node wins if a client made two.
  const votes = new Map() // item → Map(owner → node)
  for (const n of of("vote").sort((a, b) => a.value.at - b.value.at)) {
    const owner = n.value.owner?.toLowerCase(); if (!owner) continue
    const m = votes.get(n.value.item) ?? new Map(); if (!m.has(owner)) m.set(owner, n); votes.set(n.value.item, m)
  }
  const flags = new Map()
  for (const n of of("flag").sort((a, b) => a.value.at - b.value.at)) {
    const owner = n.value.owner?.toLowerCase(); if (!owner) continue
    const m = flags.get(n.value.item) ?? new Map(); if (!m.has(owner)) m.set(owner, n); flags.set(n.value.item, m)
  }
  const vouches = of("vouch").filter((n) => n.value.owner && n.value.for)

  // Pass 1: trust and karma from upvotes only, so the thresholds that gate
  // downvotes, flags and vouches never depend on themselves.
  const items = all.filter((n) => n.value.type === "story" || n.value.type === "comment")
  const ownerOf = (id) => nodes.get(id)?.value.owner?.toLowerCase()
  const upKarma = new Map()
  const trusted = new Set([AUTHORITY])
  const vouchedBy = new Map() // address → voucher
  let grew = true
  while (grew) { // the chain, in whatever order the nodes arrived
    grew = false
    for (const v of vouches) {
      const from = v.value.owner.toLowerCase(), to = v.value.for.toLowerCase()
      if (trusted.has(from) && !trusted.has(to)) { trusted.add(to); vouchedBy.set(to, from); grew = true }
    }
  }
  const countVote = (voter, dir) => trusted.has(voter) && (dir > 0 || (upKarma.get(voter) ?? 0) >= T.downvoteKarma)
  for (const [item, m] of votes) {
    const owner = ownerOf(item); if (!owner) continue
    for (const [voter, n] of m) if (n.value.dir > 0 && trusted.has(voter)) upKarma.set(owner, (upKarma.get(owner) ?? 0) + 1)
  }
  // Pass 2: the numbers everyone sees.
  const points = new Map(), karma = new Map()
  for (const [item, m] of votes) {
    let p = 0
    for (const [voter, n] of m) if (countVote(voter, n.value.dir)) p += n.value.dir
    points.set(item, p)
    const owner = ownerOf(item); if (owner) karma.set(owner, (karma.get(owner) ?? 0) + p)
  }
  for (const [addr, voucher] of vouchedBy) if (roleOf(addr) === "restricted") karma.set(voucher, (karma.get(voucher) ?? 0) - T.vouchPenalty)
  const countingFlags = (item) => [...(flags.get(item) ?? [])].filter(([f, n]) => n.value.on && trusted.has(f) && (upKarma.get(f) ?? 0) >= T.flagKarma)
  const dead = (item) => countingFlags(item).length >= T.flagsToKill || (points.get(item) ?? 0) <= T.deadScore
  const deadReason = (item) => {
    const f = countingFlags(item)
    return f.length >= T.flagsToKill ? `flagged by ${f.length} trusted members` : (points.get(item) ?? 0) <= T.deadScore ? `voted down to ${points.get(item)}` : null
  }
  const kids = new Map()
  for (const n of items) if (n.value.type === "comment") { const l = kids.get(n.value.parent) ?? []; l.push(n); kids.set(n.value.parent, l) }
  const hours = (n) => (Date.now() - n.value.at) / 3_600_000
  const rank = (n) => ((points.get(n.id) ?? 0) - 1) / Math.pow(hours(n) + 2, T.gravity)
  const descendants = (id) => (kids.get(id) ?? []).reduce((c, k) => c + 1 + descendants(k.id), 0)
  const canVouch = (addr) => eqAddr(addr, AUTHORITY) || (trusted.has(addr?.toLowerCase()) && (upKarma.get(addr?.toLowerCase()) ?? 0) >= T.vouchKarma)
  return { users, roleOf, votes, flags, vouches, trusted, vouchedBy, points, karma, upKarma, dead, deadReason, countingFlags, kids, rank, descendants, canVouch,
    stories: of("story"), comments: of("comment"),
    myVote: (item) => me && votes.get(item)?.get(me.toLowerCase()),
    myFlag: (item) => me && flags.get(item)?.get(me.toLowerCase()) }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const abbr = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""
const DEMO_NAMES = Object.fromEntries(DEMO_IDENTITIES.map((i) => [i.address.toLowerCase(), i.name]))
const userNodeId = (addr) => { for (const id of nodes.keys()) if (id.startsWith("user:") && eqAddr(id.slice(5), addr)) return id; return null }
const nameOf = (addr, d) => d.users.get(addr?.toLowerCase())?.name || DEMO_NAMES[addr?.toLowerCase()] || abbr(addr)
const userLink = (addr, d) => `<a href="#/user/${esc(addr)}" class="hnuser" title="${esc(addr)}">${esc(nameOf(addr, d))}</a>`
const ago = (at) => {
  const s = Math.max(0, (Date.now() - at) / 1000)
  const [n, u] = s < 60 ? [Math.floor(s), "minute"] : s < 3600 ? [Math.floor(s / 60), "minute"] : s < 86400 ? [Math.floor(s / 3600), "hour"] : [Math.floor(s / 86400), "day"]
  return s < 60 ? "just now" : `${n} ${u}${n === 1 ? "" : "s"} ago`
}
const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, "") } catch { return null } }
const validUrl = (url) => { try { return ["http:", "https:"].includes(new URL(url).protocol) } catch { return false } }
// Text is paragraphs; a bare http(s) URL becomes a link. Nothing else is markup.
const richText = (text) => esc(text).split(/\n\s*\n/).map((p) => `<p>${p.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" rel="nofollow noopener" target="_blank">${u}</a>`).replace(/\n/g, "<br>")}</p>`).join("")
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`

// ── Views: HN's tables, to the pixel that matters ───────────────────────────
const voteCell = (n, d, dead) => {
  const mine = d.myVote(n.id)?.value.dir ?? 0
  if (dead) return `<td class="votelinks nosee"><div class="votearrow"></div></td>`
  return `<td class="votelinks"><a href="#" class="vote" data-item="${n.id}" data-dir="1" title="upvote"><div class="votearrow${mine > 0 ? " voted" : ""}"></div></a></td>`
}
const storyRow = (n, i, d) => {
  const dead = d.dead(n.id), p = d.points.get(n.id) ?? 0, c = d.descendants(n.id)
  const domain = n.value.url && domainOf(n.value.url)
  const title = dead ? `[dead] ${n.value.title}` : n.value.title
  const mine = d.myVote(n.id)?.value.dir ?? 0, flagged = d.myFlag(n.id)?.value.on
  const meta = [`${plural(p, "point")} by ${userLink(n.value.owner, d)} <a href="#/item/${n.id}">${ago(n.value.at)}</a>`]
  if (mine) meta.push(`<a href="#" class="vote" data-item="${n.id}" data-dir="0">un${mine > 0 ? "vote" : "downvote"}</a>`)
  else if (me && (d.upKarma.get(me.toLowerCase()) ?? 0) >= T.downvoteKarma && !dead) meta.push(`<a href="#" class="vote" data-item="${n.id}" data-dir="-1">downvote</a>`)
  meta.push(`<a href="#" class="flag" data-item="${n.id}">${flagged ? "unflag" : "flag"}</a>`)
  if (dead) meta.push(`<span class="label">${esc(d.deadReason(n.id))}</span>`)
  meta.push(`<a href="#/item/${n.id}">${c ? plural(c, "comment") : "discuss"}</a>`)
  return `<tr class="athing${dead ? " dead" : ""}" id="s-${n.id}"><td class="title rank">${i ? `${i}.` : ""}</td>${voteCell(n, d, dead)}<td class="title"><span class="titleline${dead ? " dead" : ""}"><a href="${n.value.url && validUrl(n.value.url) ? esc(n.value.url) : `#/item/${n.id}`}"${n.value.url ? ' rel="nofollow noopener"' : ""}>${esc(title)}</a>${domain ? ` <span class="sitebit">(<a href="#/from/${esc(domain)}">${esc(domain)}</a>)</span>` : ""}</span></td></tr>
<tr><td colspan="2"></td><td class="subtext">${meta.join(" | ")}</td></tr><tr class="spacer"></tr>`
}
const storyList = (list, d, page, base) => {
  const start = (page - 1) * T.perPage, slice = list.slice(start, start + T.perPage)
  if (!list.length) return `<table><tr><td class="title">Nothing here yet — <a href="#/submit">submit the first story</a>.</td></tr></table>`
  const more = list.length > start + T.perPage ? `<tr class="morespace"></tr><tr><td colspan="2"></td><td class="title"><a href="${base}?p=${page + 1}" class="morelink">More</a></td></tr>` : ""
  return `<table>${slice.map((n, i) => storyRow(n, start + i + 1, d)).join("")}${more}</table>`
}

const commentRow = (n, depth, d, collapsed) => {
  const dead = d.dead(n.id), mine = d.myVote(n.id)?.value.dir ?? 0, kids = d.descendants(n.id)
  return `<tr class="athing comtr${collapsed.has(n.id) ? " collapsed" : ""}${dead ? " dead" : ""}" id="c-${n.id}"><td><table><tr>
<td class="ind" data-depth="${depth}" style="--depth:${depth};width:${depth * 40}px"></td>${voteCell(n, d, dead)}
<td class="default"><div class="comhead">${userLink(n.value.owner, d)} <a href="#/item/${n.id}">${ago(n.value.at)}</a>${mine ? ` | <a href="#" class="vote" data-item="${n.id}" data-dir="0">unvote</a>` : ""}${dead ? ` | <span class="label">[dead: ${esc(d.deadReason(n.id))}]</span>` : ""} | <a href="#" class="flag" data-item="${n.id}">${d.myFlag(n.id)?.value.on ? "unflag" : "flag"}</a> <a href="#" class="togg" data-item="${n.id}">[${collapsed.has(n.id) ? `${kids + 1} more` : "–"}]</a></div>
<div class="comment"><div class="commtext">${richText(n.value.text)}</div><div class="reply"><a href="#" class="reply-link" data-item="${n.id}">reply</a></div><div id="reply-${n.id}"></div></div></td></tr></table></td></tr>`
}
const commentTree = (parent, depth, d, collapsed, out = []) => {
  const list = (d.kids.get(parent) ?? []).sort((a, b) => (d.points.get(b.id) ?? 0) - (d.points.get(a.id) ?? 0) || a.value.at - b.value.at)
  for (const n of list) {
    if (d.dead(n.id) && !showDead()) continue
    out.push(commentRow(n, depth, d, collapsed))
    if (!collapsed.has(n.id)) commentTree(n.id, depth + 1, d, collapsed, out)
  }
  return out
}
const commentForm = (parent, story) => me
  ? `<form class="reply-form" data-parent="${parent}" data-story="${story}"><textarea name="text" rows="6" cols="60" required></textarea><br><input type="submit" value="${parent === story ? "add comment" : "reply"}"></form>`
  : `<div class="reply-form"><a href="#/login">login</a> to comment.</div>`

const itemPage = (id, d) => {
  const n = nodes.get(id); if (!n) return `<table><tr><td class="title">No such item.</td></tr></table>`
  const isStory = n.value.type === "story", story = isStory ? id : n.value.story
  const head = isStory ? storyRow(n, 0, d) : commentRow(n, 0, d, new Set())
  const text = isStory && n.value.text ? `<tr><td colspan="2"></td><td><div class="toptext">${richText(n.value.text)}</div></td></tr>` : ""
  const tree = commentTree(id, 0, d, collapsedSet())
  return `<table>${head}${text}<tr><td colspan="2"></td><td>${commentForm(id, story)}</td></tr></table><br>
<table class="comment-tree">${tree.join("")}</table>`
}

const submitPage = () => me
  ? `<form id="submit-form"><table class="formtable"><tr><td>title</td><td><input type="text" name="title" maxlength="80" autocomplete="off" required></td></tr>
<tr><td>url</td><td><input type="url" name="url" autocomplete="off"></td></tr>
<tr><td></td><td><b>or</b></td></tr>
<tr><td>text</td><td><textarea name="text"></textarea></td></tr>
<tr><td></td><td><input type="submit" value="submit"></td></tr>
<tr><td></td><td class="note">Leave url blank to submit a question for discussion. If there is no url, text will appear at the top of the thread. The story is a node you own: nobody else can edit or delete it, and neither can anyone stop you from posting it.</td></tr></table></form>`
  : `<table><tr><td class="title"><a href="#/login">login</a> to submit.</td></tr></table>`

const loginPage = () => {
  const s = session, onboarding = s.hasVolatileIdentity && !s.isActive
  const demo = DEMO_IDENTITIES.map((i) => `<a href="#" class="demo-login" data-address="${i.address}">${i.emoji} ${esc(i.name)}${eqAddr(i.address, AUTHORITY) ? " (the authority)" : ""}</a>`).join(" · ")
  return `<table class="formtable"><tr><td colspan="2"><p class="formhead">${onboarding ? "Your new identity" : "Login"}</p></td></tr>
<tr><td>phrase</td><td><textarea id="mnemonic" class="phrase" placeholder="Enter your 12-word mnemonic phrase to log in or recover…"${onboarding ? " readonly" : ""}>${onboarding ? esc(db.sm.getMnemonicForDisplayAfterRegistrationOrRecovery() ?? "") : ""}</textarea></td></tr>
${onboarding ? `<tr><td></td><td class="danger">Save this phrase. There is no reset.</td></tr>` : ""}
<tr><td></td><td class="actions">
<button id="login-btn">login with mnemonic</button>${!onboarding ? `<button id="generate-btn">generate new identity</button>` : ""}${onboarding && PASSKEYS_AVAILABLE && !s.isWebAuthnProtected ? `<button id="passkey-protect-btn">protect with passkey</button>` : ""}${!onboarding && PASSKEYS_AVAILABLE && s.hasWebAuthnHardwareRegistration ? `<button id="passkey-login-btn">login with passkey</button>` : ""}
</td></tr>
${!onboarding ? `<tr><td></td><td class="note">Demo identities, one click, so two windows can meet: ${demo}</td></tr>` : ""}
<tr><td></td><td class="note">There is no account and no server: an identity is a key pair on this device. A mnemonic recovers it anywhere; a passkey keeps the session on this browser. Everything you post is signed with it.</td></tr>
<tr><td></td><td class="note status" id="login-status"></td></tr></table>`
}

const userPage = (addr, d) => {
  const u = d.users.get(addr.toLowerCase()), role = d.roleOf(addr), k = d.karma.get(addr.toLowerCase()) ?? 0
  const trusted = d.trusted.has(addr.toLowerCase()), voucher = d.vouchedBy.get(addr.toLowerCase())
  const own = [...d.stories, ...d.comments].filter((n) => eqAddr(n.value.owner, addr))
  const since = own.length ? Math.min(...own.map((n) => n.value.at)) : u?._ts?.physical
  const isMe = eqAddr(addr, me)
  const certified = u?.karma
  const invitees = [...d.vouchedBy].filter(([, v]) => v === addr.toLowerCase()).map(([a]) => a)
  const rows = [
    ["user:", `<span class="hnuser">${esc(nameOf(addr, d))}</span>`],
    ["address:", `<span class="mono">${esc(addr)}</span>`],
    ["created:", since ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—"],
    ["karma:", `${k}${certified !== undefined && certified !== k ? ` <span class="label">(the authority last certified ${certified})</span>` : ""}`],
    ["role:", `${esc(role)}${role === "restricted" ? " — lost the right to write; it comes back with the karma" : ""}`],
    ["trust:", trusted ? (eqAddr(addr, AUTHORITY) ? "the authority" : `vouched for by ${userLink(voucher, d)}`) : "not vouched for yet — posts count, votes and flags do not"],
    ...(invitees.length ? [["vouched:", invitees.map((a) => userLink(a, d)).join(", ")]] : []),
    ["about:", u?.about ? richText(u.about) : ""],
  ]
  const vouch = me && !isMe && !trusted && d.canVouch(me) ? `<tr><td></td><td><a href="#" id="vouch-btn" data-address="${esc(addr)}"><u>vouch for ${esc(nameOf(addr, d))}</u></a> <span class="note">— a signed node; if they end up restricted it costs you ${T.vouchPenalty} karma</span></td></tr>` : ""
  const edit = isMe ? `<tr><td colspan="2"><form id="profile-form" class="formtable"><table class="formtable"><tr><td>name:</td><td><input type="text" name="name" maxlength="15" pattern="[a-z0-9_-]{1,15}" value="${esc(u?.name ?? "")}" placeholder="lowercase, digits, - and _"></td></tr><tr><td>about:</td><td><textarea name="about">${esc(u?.about ?? "")}</textarea></td></tr><tr><td>showdead:</td><td><label><input type="checkbox" id="showdead"${showDead() ? " checked" : ""}> show killed items, in grey, with the reason</label></td></tr>
<tr><td></td><td><input type="submit" value="update"> <span class="note" id="profile-status"></span></td></tr></table></form></td></tr>` : ""
  return `<table class="userpage">${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("")}${vouch}
<tr><td></td><td><a href="#/submitted/${esc(addr)}"><u>submissions</u></a></td></tr><tr><td></td><td><a href="#/threads/${esc(addr)}"><u>comments</u></a></td></tr>${edit}</table>`
}

const constitutionPage = (d) => {
  const rows = (obj, texts) => Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === "object" ? JSON.stringify(v) : v)}<br><span class="rule">${esc(texts[k] ?? "")}</span></td></tr>`).join("")
  const mine = me ? `<h2>You, under it</h2><p class="mine">role <b>${esc(d.roleOf(me))}</b> · karma <b>${d.karma.get(me.toLowerCase()) ?? 0}</b> computed here${d.users.get(me.toLowerCase())?.karma !== undefined ? `, <b>${d.users.get(me.toLowerCase()).karma}</b> certified by the authority` : ""} · ${d.trusted.has(me.toLowerCase()) ? "trusted" : "not vouched for yet"}${eqAddr(me, AUTHORITY) ? ` · <span id="authority-status">the authority is online here: certifying karma every 5 s</span>` : ""}</p>` : ""
  return `<div class="constitution">
<p class="lede">This page is <code>constitution.js</code>, rendered. The rules you read are the rules that run — on every peer, with nobody in between.</p>
<h2>The authority</h2><p><code>${esc(CONSTITUTION.authority)}</code> — its only power is signing roles when the rules below say so. It never touches content: every story, comment, vote and flag is a node its author owns, and the engine refuses anyone else's edit or deletion, the authority included.</p>
<h2>Roles — enforced by the engine on every peer</h2><table>${rows(CONSTITUTION.roles, CONSTITUTION.roleText)}</table>
<h2>Role rules — evaluated in order, the last match wins</h2><table>${CONSTITUTION.rules.map((r, i) => `<tr><td>${i + 1}</td><td><code>${esc(JSON.stringify({ if: r.if, ...(r.offsetTimestamp && { offsetTimestamp: r.offsetTimestamp }), then: r.then }))}</code><br><span class="rule">${esc(r.text)}</span></td></tr>`).join("")}</table>
<p>A rule's <code>karma</code> is written on the user node by the authority, counted from the signed votes with the thresholds below. This browser counts it too; the user page shows both numbers, and if they differ the authority is behind or lying.</p>
<h2>Thresholds — derived by every peer from the same signed nodes</h2><table>${rows(CONSTITUTION.thresholds, CONSTITUTION.thresholdText)}</table>
<h2>Trust</h2><p>Writing is free; influence is earned. A vote or a flag counts only if its owner is trusted, and trust is a chain of vouches that starts at the authority. Today ${d.trusted.size === 1 ? "only the authority is trusted" : `${d.trusted.size} members are trusted`}.</p>
<h2>Amendment</h2><p>${esc(CONSTITUTION.amendment)} <a href="https://github.com/estebanrfp/dnews/blob/main/constitution.js">The file.</a></p>
${mine}</div>`
}

// ── Router and render ───────────────────────────────────────────────────────
const route = () => {
  const [path, query = ""] = location.hash.slice(1).split("?")
  const seg = path.split("/").filter(Boolean)
  return { page: seg[0] ?? "", arg: seg[1] ? decodeURIComponent(seg[1]) : null, p: Number(new URLSearchParams(query).get("p")) || 1, q: new URLSearchParams(query).get("q") ?? "" }
}
const showDead = () => localStorage.dnewsShowDead === "1"
const collapsedSet = () => new Set(JSON.parse(sessionStorage.dnewsCollapsed ?? "[]"))
let renderQueued = false, dirtyWhileTyping = false
const scheduleRender = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render() }) }
const typing = () => document.hasFocus() && $("bigbox").contains(document.activeElement) &&
  document.activeElement.matches("textarea, input:not([type=submit]):not([type=button])")

const render = async () => {
  if (typing()) { dirtyWhileTyping = true; return } // never repaint under the reader's caret
  const d = derive(), r = route()
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("topsel", a.dataset.nav === r.page))
  let html, title = "dNews"
  switch (r.page) {
    case "": case "news": html = storyList(d.stories.filter((n) => !d.dead(n.id) || showDead()).sort((a, b) => d.rank(b) - d.rank(a)), d, r.p, "#/news"); break
    case "newest": html = storyList(d.stories.filter((n) => !d.dead(n.id) || showDead()).sort((a, b) => b.value.at - a.value.at), d, r.p, "#/newest"); title = "New Links | dNews"; break
    case "newcomments": html = `<table class="comment-tree">${d.comments.filter((n) => !d.dead(n.id) || showDead()).sort((a, b) => b.value.at - a.value.at).slice(0, T.perPage).map((n) => commentRow(n, 0, d, new Set())).join("") || `<tr><td class="title">No comments yet.</td></tr>`}</table>`; title = "New Comments | dNews"; break
    case "item": html = itemPage(r.arg, d); title = `${nodes.get(r.arg)?.value.title ?? "Item"} | dNews`; break
    case "submit": html = submitPage(); title = "Submit | dNews"; break
    case "login": html = loginPage(); title = "Login | dNews"; break
    case "user": html = r.arg ? userPage(r.arg, d) : ""; title = `Profile: ${nameOf(r.arg, d)} | dNews`; break
    case "submitted": html = storyList(d.stories.filter((n) => eqAddr(n.value.owner, r.arg)).sort((a, b) => b.value.at - a.value.at), d, r.p, `#/submitted/${r.arg}`); break
    case "threads": html = `<table class="comment-tree">${d.comments.filter((n) => eqAddr(n.value.owner, r.arg)).sort((a, b) => b.value.at - a.value.at).map((n) => commentRow(n, 0, d, new Set())).join("") || `<tr><td class="title">No comments yet.</td></tr>`}</table>`; break
    case "from": html = storyList(d.stories.filter((n) => domainOf(n.value.url) === r.arg).sort((a, b) => b.value.at - a.value.at), d, r.p, `#/from/${r.arg}`); break
    case "search": { // the engine's $text: accent-insensitive, one field
      const { results } = await db.map({ query: { type: "story", title: { $text: r.q } } })
      html = storyList(results.map((n) => nodes.get(n.id) ?? n).sort((a, b) => b.value.at - a.value.at), d, r.p, `#/search?q=${encodeURIComponent(r.q)}&`); title = `Search: ${r.q} | dNews`; break }
    case "constitution": html = constitutionPage(d); title = "Constitution | dNews"; break
    default: html = `<table><tr><td class="title">No such page.</td></tr></table>`
  }
  $("bigbox").innerHTML = html
  document.title = title
  renderSession(d)
}
const renderSession = (d) => {
  $("session").innerHTML = me
    ? `${userLink(me, d)} <span class="karma">(${d.karma.get(me.toLowerCase()) ?? 0})</span> | <a href="#" id="logout">logout</a>`
    : `<a href="#/login">login</a>`
}

// ── Writes: every one a node you own ────────────────────────────────────────
const say = (id, text) => { const el = $(id); if (el) el.textContent = text }
const create = (value) => db.sm.acls.set({ ...value, at: Date.now() }, crypto.randomUUID())
const gate = (d) => { // what the engine would refuse, said before the click
  if (!me) { location.hash = "#/login"; return false }
  const role = d.roleOf(me)
  if (role === "guest") return alertLine("You became a guest a moment ago; the constitution makes you a user 10 seconds after signing in."), false
  if (role === "restricted") return alertLine("Your karma fell to −10 and the constitution restricted you to reading. It comes back with the karma."), false
  return true
}
let alertTimer
const alertLine = (text) => { // HN has no toasts: one quiet line above the content, outside what re-renders
  const el = $("notice"); el.textContent = text; el.classList.remove("hidden")
  clearTimeout(alertTimer); alertTimer = setTimeout(() => el.classList.add("hidden"), 6000)
}
const setVote = async (item, dir, d) => {
  if (!gate(d)) return
  const mine = d.myVote(item)
  if (dir < 0 && (d.upKarma.get(me.toLowerCase()) ?? 0) < T.downvoteKarma) return alertLine(`Voting down needs ${T.downvoteKarma} karma.`)
  await (mine ? db.sm.acls.set({ ...mine.value, dir }, mine.id) : create({ type: "vote", item, dir }))
}
const setFlag = async (item, d) => {
  if (!gate(d)) return
  const mine = d.myFlag(item)
  await (mine ? db.sm.acls.set({ ...mine.value, on: !mine.value.on }, mine.id) : create({ type: "flag", item, on: true }))
}

document.addEventListener("click", async (e) => {
  const a = e.target.closest("a, button"); if (!a) return
  const d = derive()
  if (a.classList.contains("vote")) { e.preventDefault(); return setVote(a.dataset.item, Number(a.dataset.dir), d) }
  if (a.classList.contains("flag")) { e.preventDefault(); return setFlag(a.dataset.item, d) }
  if (a.classList.contains("togg")) {
    e.preventDefault(); const c = collapsedSet(); c.has(a.dataset.item) ? c.delete(a.dataset.item) : c.add(a.dataset.item)
    sessionStorage.dnewsCollapsed = JSON.stringify([...c]); return render()
  }
  if (a.classList.contains("reply-link")) {
    e.preventDefault(); const box = $(`reply-${a.dataset.item}`); if (!box) return
    box.innerHTML = box.innerHTML ? "" : commentForm(a.dataset.item, nodes.get(a.dataset.item)?.value.story); box.querySelector("textarea")?.focus(); return
  }
  if (a.id === "logout") { e.preventDefault(); return db.sm.clearSecurity() }
  if (a.id === "vouch-btn") {
    e.preventDefault(); if (!gate(d)) return
    await create({ type: "vouch", for: a.dataset.address }); return alertLine(`You vouched for ${nameOf(a.dataset.address, d)}. The chain is public.`)
  }
  if (a.classList.contains("demo-login")) {
    e.preventDefault(); const id = DEMO_IDENTITIES.find((i) => eqAddr(i.address, a.dataset.address))
    try { await db.sm.loginOrRecoverUserWithMnemonic(id.mnemonic) } catch { say("login-status", "Could not sign in.") } return
  }
  if (a.id === "generate-btn") { e.preventDefault(); if (!await db.sm.startNewUserRegistration()) say("login-status", "Could not generate an identity."); return }
  if (a.id === "login-btn") {
    e.preventDefault(); const m = $("mnemonic").value.trim(); if (!m) return say("login-status", "Paste a mnemonic phrase first.")
    try { await db.sm.loginOrRecoverUserWithMnemonic(m) } catch { say("login-status", "That mnemonic is not valid.") } return
  }
  if (a.id === "passkey-protect-btn") { e.preventDefault(); try { if (!await db.sm.protectCurrentIdentityWithWebAuthn()) say("login-status", "Passkey registration cancelled.") } catch { say("login-status", "Could not register the passkey.") } return }
  if (a.id === "passkey-login-btn") { e.preventDefault(); try { if (!await db.sm.loginCurrentUserWithWebAuthn()) say("login-status", "Passkey login cancelled.") } catch { say("login-status", "Could not sign in with the passkey.") } return }
})

document.addEventListener("submit", async (e) => {
  const f = e.target; e.preventDefault()
  const field = (name) => (new FormData(f).get(name) ?? "").toString().trim() // never f.<name>: form.title is the attribute
  const d = derive()
  if (f.id === "search-form") { location.hash = `#/search?q=${encodeURIComponent($("search-input").value.trim())}`; return }
  if (!gate(d)) return
  if (f.classList.contains("reply-form")) {
    const text = field("text"); if (!text) return
    await create({ type: "comment", text, parent: f.dataset.parent, story: f.dataset.story })
    f.reset(); f.querySelector("textarea").blur(); if (f.dataset.parent !== f.dataset.story) $(`reply-${f.dataset.parent}`).innerHTML = ""
    dirtyWhileTyping = false; render(); return
  }
  if (f.id === "profile-form") {
    const id = userNodeId(me), u = id && nodes.get(id)?.value
    if (!u) return say("profile-status", "Your user node has not synced yet.")
    try { await db.put({ ...u, name: field("name").toLowerCase(), about: field("about") }, id); say("profile-status", "updated") }
    catch (err) { say("profile-status", `Not saved: ${err.message}`) }
    return
  }
  if (f.id === "submit-form") {
    const title = field("title"), url = field("url"), text = field("text")
    if (!title) return
    if (url && !validUrl(url)) return alertLine("The url must start with http:// or https://")
    if (!url && !text) return alertLine("Give the story a url or a text.")
    const id = await create({ type: "story", title, ...(url ? { url } : { text }) })
    location.hash = url ? "#/newest" : `#/item/${id}`
  }
})
document.addEventListener("change", (e) => { if (e.target.id === "showdead") { localStorage.dnewsShowDead = e.target.checked ? "1" : "0"; scheduleRender() } })
document.addEventListener("focusout", () => { if (dirtyWhileTyping) { dirtyWhileTyping = false; scheduleRender() } })
addEventListener("hashchange", () => { document.activeElement?.blur(); window.scrollTo(0, 0); render() }) // a navigation is intent: nothing is being typed on the new page

// ── The authority's device: certify karma, seed the demo chain ──────────────
// Only the authority's signature makes a role valid, so the role rules can
// only read a karma the authority wrote. It writes the number this very
// derivation produces, and every peer can recount it. In production this
// runs on the always-on peer; in the demo, on whoever pressed the authority.
const certify = async () => {
  const d = derive()
  for (const [addr, u] of d.users) {
    if (eqAddr(addr, AUTHORITY)) continue
    const k = d.karma.get(addr) ?? 0
    if ((u.karma ?? 0) === k) continue
    const { _ts, _id, ...value } = u
    try { await db.put({ ...value, karma: k }, _id) } catch (err) { console.warn("certify:", err.message) }
  }
  if (!seeded) { // the demo chain: the authority vouches for Alice and Bob once
    seeded = true
    for (const who of [ALICE, BOB]) if (!d.vouches.some((v) => eqAddr(v.value.owner, AUTHORITY) && eqAddr(v.value.for, who.address))) await create({ type: "vouch", for: who.address })
  }
}
const startAuthority = () => { if (!certifying) { certify(); certifying = setInterval(certify, 5000) } }
const stopAuthority = () => { clearInterval(certifying); certifying = null }

// ── Session: the callback is the single source of truth ─────────────────────
// It redraws from the state on every call and remembers nothing, so the SM's
// repeated reports while an identity is generated are harmless. The data
// subscription is never touched here.
let certifying = null, seeded = false
db.sm.setSecurityStateChangeCallback((state) => {
  session = state
  me = state.isActive ? state.activeAddress : null
  if (state.isActive && route().page === "login") location.hash = sessionStorage.dnewsGoto ?? "#/"
  if (eqAddr(me, AUTHORITY)) startAuthority(); else stopAuthority()
  render()
})

// ── Presence, in the footer, as on every GenosDB page ───────────────────────
const presence = () => { const n = Object.keys(db.room?.getPeers() ?? {}).length; $("presence").textContent = `${n} peer${n === 1 ? "" : "s"}` }
db.room?.on("peer:join", presence); db.room?.on("peer:leave", presence); presence()
render()
