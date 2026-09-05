/**
 * The graph on the wire and on the disk: a story and a thread crossing real
 * WebRTC between two visitors, and a device that comes back to its own graph.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, expect, test } from "@playwright/test"
import { connected, freshRoom, go, loginAs, promoted, submit, subtextOf, transportStats, url, visitor } from "./_helpers.js"

test("a story and a thread cross between two visitors over real WebRTC", async ({ browser }) => {
  const room = freshRoom("story")
  const authority = await visitor(browser, room), alice = await visitor(browser, room)
  await loginAs(authority, "constitution")
  await loginAs(alice, "alice")
  await connected(authority); await connected(alice)
  await promoted(alice)

  await submit(alice, "GenosDB: a P2P graph database with a zero-trust security model", "https://github.com/estebanrfp/gdb")
  await expect(alice.page).toHaveURL(/#\/newest/)
  await expect(alice.page.locator("#nav a.topsel")).toHaveText("new")
  await expect(subtextOf(alice.page, "GenosDB: a P2P graph database with a zero-trust security model")).toContainText("0 points by alice")
  await go(authority, "#/")
  await expect(authority.page.locator(".titleline")).toContainText("GenosDB: a P2P graph database")
  await expect(authority.page.locator(".sitebit")).toContainText("github.com")

  // The authority is trusted by definition: its upvote is a point, and Alice's karma.
  await authority.page.locator(".votearrow").first().click()
  await expect(subtextOf(authority.page, "GenosDB: a P2P graph database with a zero-trust security model")).toContainText("1 point by alice")
  await expect(subtextOf(alice.page, "GenosDB: a P2P graph database with a zero-trust security model")).toContainText("1 point by alice")
  await expect(alice.page.locator("#session")).toContainText("alice (1)")
  await expect(subtextOf(authority.page, "GenosDB: a P2P graph database with a zero-trust security model")).toContainText("unvote")
  await expect(alice.page.locator(".votelinks.nosee")).toHaveCount(1) // no arrow on your own story

  // A comment threads under the story, and the story counts it everywhere.
  await go(alice, "#/")
  await alice.page.locator('a:has-text("discuss")').first().click()
  await alice.page.locator(".reply-form textarea").fill("Every vote here is a node the voter owns — nobody can cast one in your name.")
  await alice.page.locator('.reply-form input[type="submit"]').click()
  await expect(alice.page.locator(".comment-tree .commtext")).toContainText("a node the voter owns")
  await expect(subtextOf(authority.page, "GenosDB: a P2P graph database with a zero-trust security model")).toContainText("1 comment")
  await go(alice, "#/threads")
  await expect(alice.page.locator("#nav a.topsel")).toHaveText("threads")
  await expect(alice.page.locator(".comment-tree .comhead")).toContainText("on: GenosDB: a P2P graph database")

  const stats = await transportStats(alice.page)
  console.log("alice transport:", JSON.stringify(stats))
  expect(stats.succeededPairs).toBeGreaterThan(0)
  expect(stats.bytesReceived).toBeGreaterThan(0)
  await authority.close(); await alice.close()
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
  await page.goto(url(room))
  await expect(page.locator("#bigbox")).toContainText("Nothing here yet")
  await page.goto(url(room, "#/login"))
  await page.locator('.demo-login:has-text("constitution")').click()
  await expect(page.locator("#session")).toContainText("constitution")
  // The engine writes the graph to OPFS on a short debounce, as `<room>_graph.msgpack`:
  // read the file's size before and after the story, and close only once it has
  // grown — the disk, not a timer, says it landed.
  const graphSize = () => page.evaluate(async (room) => {
    try { const root = await navigator.storage.getDirectory(); return (await (await root.getFileHandle(`${room}_graph.msgpack`)).getFile()).size } catch { return -1 }
  }, room)
  await expect.poll(graphSize, { timeout: 30_000 }).toBeGreaterThan(0) // the login's user node is on disk
  const before = await graphSize()
  await page.goto(url(room, "#/submit"))
  await page.locator('[name="title"]').fill("Written on this device, read back from its disk")
  await page.locator('[name="text"]').fill("No peer was ever online.")
  await page.locator('#submit-form input[type="submit"]').click()
  await expect(page).toHaveURL(/#\/item\//)
  await expect(page.locator(".titleline")).toContainText("Written on this device")
  await expect.poll(graphSize, { timeout: 30_000 }).toBeGreaterThan(before)
  await context.close()

  context = await chromium.launchPersistentContext(device)
  page = context.pages()[0] ?? (await context.newPage())
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(url(room))
  await expect(page.locator(".titleline")).toContainText("Written on this device")
  await expect(page.locator("#nav")).toContainText("submit")
  expect(errors).toEqual([])
  await context.close()
})
