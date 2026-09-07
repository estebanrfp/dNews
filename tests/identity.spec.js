/**
 * Identity without a server: a key pair on the device, a phrase that recovers
 * it, a passkey that keeps it. The passkey runs on Playwright's virtual
 * authenticator, so it works headless and in CI.
 */
import { expect, test } from "@playwright/test"
import { freshRoom, go, loginAs, newcomer, promoted, submit, subtextOf, visitor } from "./_helpers.js"

test("a new identity: generate, sign in, sign out, recover with the phrase", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("identity"))
  await newcomer(v)
  const address = v.address
  await expect(v.page.locator("#session")).toContainText(address.slice(0, 6)) // no name yet: the abbreviated address
  await v.page.locator("#logout").click()
  await expect(v.page.locator("#session")).toHaveText("login") // signed out, where you were, as on HN
  await go(v, "#/login")
  await v.page.locator("#mnemonic").fill(v.mnemonic)
  await v.page.locator("#login-btn").click()
  await expect(v.page.locator("#session .hnuser")).toHaveAttribute("title", address) // the same identity, recovered
  await v.close()
})

test("a wrong phrase is refused, in words", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("badphrase"))
  await go(v, "#/login")
  await v.page.locator("#login-btn").click()
  await expect(v.page.locator("#login-status")).toHaveText("Paste a mnemonic phrase first.")
  await v.page.locator("#mnemonic").fill("not twelve words at all")
  await v.page.locator("#login-btn").click()
  await expect(v.page.locator("#login-status")).toHaveText("That mnemonic is not valid.")
  await expect(v.page.locator("#session")).toHaveText("login")
  await v.close()
})

test("a passkey keeps the session across a reload; a phrase session does not", async ({ browser }) => {
  const room = freshRoom("passkey")
  const v = await visitor(browser, room)
  const cdp = await v.context.newCDPSession(v.page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
  await go(v, "#/login")
  await v.page.locator("#generate-btn").click()
  await expect(v.page.locator("#mnemonic")).toHaveValue(/(\w+\s+){11}\w+/)
  await expect(v.page.locator("#bigbox")).toContainText("Save this phrase. There is no reset.")
  await v.page.locator("#passkey-protect-btn").click()
  await expect(v.page.locator("#session")).toContainText("logout")
  const address = await v.page.locator("#session .hnuser").getAttribute("title")
  await v.page.reload()
  await expect(v.page.locator("#session .hnuser")).toHaveAttribute("title", address) // resumed silently
  await v.page.locator("#logout").click()
  await expect(v.page.locator("#session")).toHaveText("login")
  await go(v, "#/login")
  await expect(v.page.locator("#passkey-login-btn")).toBeVisible() // this browser holds a registration
  await v.page.locator("#passkey-login-btn").click()
  await expect(v.page.locator("#session .hnuser")).toHaveAttribute("title", address)

  // The phrase alone lives in memory: a reload ends it.
  const w = await visitor(browser, room)
  await loginAs(w, "alice")
  await w.page.reload()
  await expect(w.page.locator("#session")).toHaveText("login")
  await v.close(); await w.close()
})

test("a phrase session takes a passkey later, from the user page — the identity view behind the session pill", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("later-passkey"))
  const cdp = await v.context.newCDPSession(v.page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } })
  await loginAs(v, "alice")
  await expect(v.page).toHaveURL(new RegExp(`#/user/${v.address}$`)) // a sign-in lands on your own page
  const page = v.page.locator(".userpage")
  await expect(page).toContainText(/session:\s*opened with the phrase/)
  await expect(page.locator("#passkey-protect-btn")).toBeVisible() // offered after a phrase login, not only at onboarding
  await page.locator("#passkey-protect-btn").click()
  await expect(page).toContainText(/session:\s*opened by the passkey/)
  await expect(page.locator("#passkey-protect-btn")).toHaveCount(0)
  await v.page.reload()
  await expect(v.page.locator("#session .hnuser")).toHaveAttribute("title", v.address) // resumed silently, no phrase typed
  await v.page.locator("#session .hnuser").click()
  await expect(v.page.locator(".userpage")).toContainText(/passkey:\s*protects this identity/)
  await v.page.locator("#logout").click()
  await expect(v.page.locator("#session")).toHaveText("login")
  await go(v, "#/login")
  await v.page.locator("#passkey-login-btn").click()
  await expect(v.page.locator("#session .hnuser")).toHaveAttribute("title", v.address)
  await v.close()
})

test("a profile: the name and the about travel, and the name replaces the address everywhere", async ({ browser }) => {
  const room = freshRoom("profile")
  const authority = await visitor(browser, room), alice = await visitor(browser, room)
  await loginAs(authority, "constitution")
  await loginAs(alice, "alice")
  await promoted(alice)
  await alice.page.locator('#profile-form [name="name"]').fill("alice_p2p")
  await alice.page.locator('#profile-form [name="about"]').fill("I hold the graph too.")
  await alice.page.locator('#profile-form input[type="submit"]').click()
  await expect(alice.page.locator("#profile-status")).toHaveText("updated")
  await expect(alice.page.locator("#session")).toContainText("alice_p2p")
  await submit(alice, "A story by a named member", "https://genosdb.com/")
  await go(authority, "#/newest")
  await expect(subtextOf(authority.page, "A story by a named member")).toContainText("by alice_p2p")
  await go(authority, `#/user/${alice.address}`)
  await expect(authority.page.locator(".userpage")).toContainText("I hold the graph too.")
  await authority.close(); await alice.close()
})
