/**
 * The vocabulary of the suite. A visitor is a BrowserContext of its own — own
 * storage, own identity — never a tab. Every test takes a fresh room, because
 * the graph also lives on the wire. Assertions retry instead of sleeping.
 */
import { expect } from "@playwright/test"

export const RELAY = process.env.DNEWS_RELAY
export const BASE = "http://localhost:5705"
export const ADDR = {
  authority: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
  alice: "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931",
  bob: "0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC",
}
export const freshRoom = (label) => `dnews-test-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
export const url = (room, hash = "#/") => `${BASE}/?room=${room}${RELAY ? `&relay=${RELAY}` : ""}${hash}`

/** Record every RTCPeerConnection before any page script runs. */
export const observePeerConnections = (context) => context.addInitScript(() => {
  const Native = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__pcs.push(this) } }
  Object.setPrototypeOf(window.RTCPeerConnection, Native)
})

/** A `candidate-pair` in state `succeeded` proves ICE negotiated a real path; its bytes prove traffic flowed. */
export const transportStats = (page) => page.evaluate(async () => {
  const s = { succeededPairs: 0, bytesReceived: 0 }
  for (const pc of window.__pcs ?? []) {
    let report; try { report = await pc.getStats() } catch { continue }
    report.forEach((r) => { if (r.type === "candidate-pair" && r.state === "succeeded") { s.succeededPairs++; s.bytesReceived += r.bytesReceived ?? 0 } })
  }
  return s
})

const loaded = (page) => page.waitForFunction(() => !document.querySelector("#bigbox").textContent.includes("Opening the graph"), null, { timeout: 60_000 })

/** A visitor: own context, own storage, no identity yet. */
export const visitor = async (browser, room, options = {}) => {
  const context = await browser.newContext(options)
  await observePeerConnections(context)
  const page = await context.newPage()
  page.on("pageerror", (e) => { throw e })
  await page.goto(url(room))
  await loaded(page)
  return { page, context, room, close: () => context.close() }
}
export const go = async (v, hash) => { await v.page.goto(url(v.room, hash)); await loaded(v.page) }

/** One-click demo identity. */
export const loginAs = async (v, name) => {
  await go(v, "#/login")
  await v.page.locator(`.demo-login:has-text("${name}")`).click()
  await expect(v.page.locator("#session")).toContainText(name)
  v.name = name; v.address = ADDR[name === "constitution" ? "authority" : name]
}
/** A brand-new identity: generate, sign in with the phrase it shows. */
export const newcomer = async (v) => {
  await go(v, "#/login")
  await v.page.locator("#generate-btn").click()
  await expect(v.page.locator("#mnemonic")).toHaveValue(/(\w+\s+){11}\w+/)
  v.mnemonic = await v.page.locator("#mnemonic").inputValue()
  await v.page.locator("#login-btn").click()
  await expect(v.page.locator("#session")).toContainText("logout")
  v.address = await v.page.locator("#session .hnuser").getAttribute("title")
  v.name = v.address.slice(0, 6)
}
export const connected = (v) => expect(v.page.locator("#presence")).toContainText(/[1-9]\d* peer/)
/** The constitution's onboarding rule, seen from the user page. */
export const promoted = async (v) => { await go(v, `#/user/${v.address}`); await expect(v.page.locator(".userpage")).toContainText(/role:\s*user/) }

export const submit = async (v, title, urlOrText) => {
  await go(v, "#/submit")
  await v.page.locator('[name="title"]').fill(title)
  await v.page.locator(urlOrText.startsWith("http") ? '[name="url"]' : '[name="text"]').fill(urlOrText)
  await v.page.locator('#submit-form input[type="submit"]').click()
  await expect(v.page).not.toHaveURL(/#\/submit/)
}
/** The story row on any list page, by its exact title (so "story 1" is not "story 10"). */
const exact = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
export const row = (page, title) => page.locator(".athing", { has: page.locator(".titleline > a:first-child", { hasText: exact(title) }) })
export const subtextOf = (page, title) => row(page, title).locator("xpath=following-sibling::tr[1]").locator(".subtext")
export const upvote = async (v, title) => { await row(v.page, title).locator(".votearrow").click() }
export const flag = async (v, title) => { await subtextOf(v.page, title).locator(".flag").click() }
