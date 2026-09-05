/**
 * dNews, as two visitors use it: one is the constitution's authority, the
 * other a newcomer. Every peer is its own BrowserContext; every test its own
 * room. The assertions are what a reader sees — never the app's internals.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, expect, test } from "@playwright/test"

const RELAY = process.env.DNEWS_RELAY
const ALICE = "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931"
const freshRoom = (label) => `dnews-test-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const url = (room, hash = "#/") => `/?room=${room}${RELAY ? `&relay=${RELAY}` : ""}${hash}`

/** Record every RTCPeerConnection before any page script runs. */
const observePeerConnections = (context) => context.addInitScript(() => {
  const Native = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__pcs.push(this) } }
  Object.setPrototypeOf(window.RTCPeerConnection, Native)
})
const transportStats = (page) => page.evaluate(async () => {
  const s = { succeededPairs: 0, bytesReceived: 0 }
  for (const pc of window.__pcs ?? []) {
    let report; try { report = await pc.getStats() } catch { continue }
    report.forEach((r) => { if (r.type === "candidate-pair" && r.state === "succeeded") { s.succeededPairs++; s.bytesReceived += r.bytesReceived ?? 0 } })
  }
  return s
})

/** A visitor: own context, own storage, own identity. */
const visitor = async (browser, room) => {
  const context = await browser.newContext()
  await observePeerConnections(context)
  const page = await context.newPage()
  page.on("pageerror", (e) => { throw e })
  await page.goto(url(room))
  await expect(page.locator("#bigbox")).toContainText(/Nothing here yet|point/)
  return { page, context }
}
const loginAs = async (page, room, name) => {
  await page.goto(url(room, "#/login"))
  await page.locator(`.demo-login:has-text("${name}")`).click()
  await expect(page.locator("#session")).toContainText(name)
}
const connected = (page) => expect(page.locator("#presence")).toContainText(/[1-9]\d* peer/)

test("a newcomer is promoted by the constitution, submits, and the authority's vote counts", async ({ browser }) => {
  const room = freshRoom("story")
  const authority = await visitor(browser, room)
  const alice = await visitor(browser, room)
  await loginAs(alice.page, room, "alice")
  await expect(alice.page.locator("#nav")).toHaveText("Hacker Newsnew | threads | past | comments | ask | show | jobs | submit") // HN's bar, item for item
  await connected(alice.page)

  // A guest, and no authority online to promote her: the site says so instead
  // of letting the engine refuse the write on every receiver.
  await alice.page.goto(url(room, "#/submit"))
  await alice.page.locator('[name="title"]').fill("Too early")
  await alice.page.locator('[name="url"]').fill("https://genosdb.com/too-early")
  await alice.page.locator('input[type="submit"]').click()
  await expect(alice.page.locator("#notice")).toContainText("10 seconds")
  await expect(alice.page).toHaveURL(/#\/submit/)

  // The authority arrives: the rule fires on its device and the signed role reaches Alice.
  await loginAs(authority.page, room, "constitution")
  await connected(authority.page)
  await alice.page.goto(url(room, `#/user/${ALICE}`))
  await expect(alice.page.locator(".userpage")).toContainText(/role:\s*user/)
  await expect(alice.page.locator(".userpage")).toContainText(/vouched for by\s*constitution/)

  // A story: a node Alice owns, on the front page of both windows.
  await alice.page.goto(url(room, "#/submit"))
  await alice.page.locator('[name="title"]').fill("GenosDB: a P2P graph database with a zero-trust model")
  await alice.page.locator('[name="url"]').fill("https://github.com/estebanrfp/gdb")
  await alice.page.locator('input[type="submit"]').click()
  await expect(alice.page).toHaveURL(/#\/newest/)
  await expect(alice.page.locator("#nav a.topsel")).toHaveText("new") // the section you are on, in white, as on HN
  expect(await alice.page.locator("#nav a.topsel").evaluate((a) => getComputedStyle(a).color)).toBe("rgb(255, 255, 255)")
  await expect(alice.page.locator(".titleline")).toContainText("GenosDB: a P2P graph database")
  await expect(alice.page.locator(".subtext")).toContainText("0 points by alice")
  await authority.page.goto(url(room, "#/"))
  await expect(authority.page.locator(".titleline")).toContainText("GenosDB: a P2P graph database")
  await expect(authority.page.locator(".sitebit")).toContainText("github.com")

  // The authority is trusted by definition: its upvote is a point, and Alice's karma.
  await authority.page.locator(".votearrow").first().click()
  await expect(authority.page.locator(".subtext")).toContainText("1 point by alice")
  await expect(alice.page.locator(".subtext")).toContainText("1 point by alice")
  await expect(alice.page.locator("#session")).toContainText("alice (1)")
  await expect(authority.page.locator(".subtext")).toContainText("unvote")

  // A comment threads under the story, and the story counts it everywhere.
  await alice.page.goto(url(room, "#/"))
  await alice.page.locator('a:has-text("discuss")').first().click()
  await alice.page.locator(".reply-form textarea").fill("Every vote here is a node the voter owns — nobody can cast one in your name.")
  await alice.page.locator('.reply-form input[type="submit"]').click()
  await expect(alice.page.locator(".comment-tree .commtext")).toContainText("a node the voter owns")
  await expect(authority.page.locator(".subtext")).toContainText("1 comment")

  const stats = await transportStats(alice.page)
  console.log("alice transport:", JSON.stringify(stats))
  expect(stats.succeededPairs).toBeGreaterThan(0)
  expect(stats.bytesReceived).toBeGreaterThan(0)
  await authority.context.close(); await alice.context.close()
})

test("writing is free, influence is earned: an unvouched identity's vote weighs nothing until someone vouches", async ({ browser }) => {
  const room = freshRoom("trust")
  const authority = await visitor(browser, room)
  const alice = await visitor(browser, room)
  const newcomer = await visitor(browser, room)
  await loginAs(authority.page, room, "constitution")
  await loginAs(alice.page, room, "alice")
  // A brand-new identity: generate, then sign in with the phrase it shows.
  await newcomer.page.goto(url(room, "#/login"))
  await newcomer.page.locator("#generate-btn").click()
  await expect(newcomer.page.locator("#mnemonic")).toHaveValue(/(\w+\s+){11}\w+/)
  await newcomer.page.locator("#login-btn").click()
  await expect(newcomer.page.locator("#session")).toContainText("logout")
  await connected(newcomer.page)

  // Alice (vouched by the authority in the demo seed) submits once she is a user.
  await alice.page.goto(url(room, `#/user/${ALICE}`))
  await expect(alice.page.locator(".userpage")).toContainText(/role:\s*user/)
  await alice.page.goto(url(room, "#/submit"))
  await alice.page.locator('[name="title"]').fill("Ask dNews: does an unvouched vote count?")
  await alice.page.locator('[name="text"]').fill("It should not.")
  await alice.page.locator('input[type="submit"]').click()
  await expect(alice.page).toHaveURL(/#\/item\//)

  // The newcomer becomes a user and votes: the point never appears anywhere.
  const newcomerAddr = await newcomer.page.locator("#session .hnuser").getAttribute("title")
  await newcomer.page.goto(url(room, `#/user/${newcomerAddr}`))
  await expect(newcomer.page.locator(".userpage")).toContainText(/role:\s*user/)
  await expect(newcomer.page.locator(".userpage")).toContainText("not vouched for yet")
  await newcomer.page.goto(url(room, "#/"))
  await expect(newcomer.page.locator(".titleline")).toContainText("Ask dNews")
  await newcomer.page.locator(".votearrow").first().click()
  await expect(newcomer.page.locator(".subtext")).toContainText("unvote") // the vote exists…
  await expect(newcomer.page.locator(".subtext")).toContainText("0 points") // …and weighs nothing
  await authority.page.goto(url(room, "#/"))
  await expect(authority.page.locator(".titleline")).toContainText("Ask dNews")
  await expect(authority.page.locator(".subtext")).toContainText("0 points")

  // The authority vouches: the same vote now counts, on every peer, with no new write from the newcomer.
  await authority.page.goto(url(room, `#/user/${newcomerAddr}`))
  await authority.page.locator("#vouch-btn").click()
  await authority.page.goto(url(room, "#/"))
  await expect(authority.page.locator(".subtext")).toContainText("1 point")
  await expect(newcomer.page.locator(".subtext")).toContainText("1 point")
  await newcomer.page.goto(url(room, `#/user/${newcomerAddr}`))
  await expect(newcomer.page.locator(".userpage")).toContainText(/vouched for by\s*constitution/)
  await authority.context.close(); await alice.context.close(); await newcomer.context.close()
})

test("a device that comes back finds its graph on disk and renders before any peer", async () => {
  // Not a fresh context: a user-data dir that survives close and relaunch, OPFS
  // included. The regression this guards: db.map hands a returning device its
  // nodes synchronously, before the module has finished declaring itself.
  const room = freshRoom("device")
  const device = mkdtempSync(join(tmpdir(), "dnews-device-"))
  let context = await chromium.launchPersistentContext(device)
  let page = context.pages()[0] ?? (await context.newPage())
  page.on("pageerror", (e) => { throw e })
  await page.goto(`http://localhost:5705${url(room)}`)
  await expect(page.locator("#bigbox")).toContainText("Nothing here yet")
  await loginAs(page, room, "constitution")
  const graphSize = () => page.evaluate(async (room) => {
    try { const root = await navigator.storage.getDirectory(); return (await (await root.getFileHandle(`${room}_graph.msgpack`)).getFile()).size } catch { return -1 }
  }, room)
  await expect.poll(graphSize, { timeout: 30_000 }).toBeGreaterThan(0) // the login's user node is on disk
  const before = await graphSize()
  await page.goto(`http://localhost:5705${url(room, "#/submit")}`)
  await page.locator('[name="title"]').fill("Written on this device, read back from its disk")
  await page.locator('[name="text"]').fill("No peer was ever online.")
  await page.locator('#submit-form input[type="submit"]').click()
  // The engine writes the graph to OPFS on a short debounce, as
  // `<room>_graph.msgpack`: read the file's size before and after the story,
  // and close only once it has grown — the disk, not a timer, says it landed.
  await expect(page).toHaveURL(/#\/item\//)
  await expect(page.locator(".titleline")).toContainText("Written on this device")
  await expect.poll(graphSize, { timeout: 30_000 }).toBeGreaterThan(before)
  await context.close()

  context = await chromium.launchPersistentContext(device)
  page = context.pages()[0] ?? (await context.newPage())
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`http://localhost:5705${url(room)}`)
  await expect(page.locator(".titleline")).toContainText("Written on this device")
  await expect(page.locator("#nav")).toContainText("submit")
  expect(errors).toEqual([])
  await context.close()
})
