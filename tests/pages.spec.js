/**
 * Every page of the bar, as a reader sees it. One visitor is enough: the
 * authority writes without waiting for a promotion, so these pages get their
 * content in seconds and the assertions are about rendering, not sync.
 */
import { expect, test } from "@playwright/test"
import { ADDR, freshRoom, go, loginAs, row, submit, subtextOf, url, visitor } from "./_helpers.js"

const seed = async (v) => {
  await submit(v, "GenosDB: a P2P graph database with a zero-trust model", "https://github.com/estebanrfp/gdb")
  await submit(v, "Ask dN: which rule would you refuse to run?", "Every rule here runs on every peer.")
  await submit(v, "Show dN: four files and no server", "https://github.com/estebanrfp/dNews")
  await submit(v, "GenosDB is hiring a constitution lawyer", "https://genosdb.com/")
}

test("every page of the bar renders its own content, and the one you are on reads white", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("pages"))
  await loginAs(v, "constitution")
  await seed(v)
  await expect(v.page.locator("#nav")).toHaveText("Hacker Newsnew | threads | past | comments | ask | show | jobs | submit")

  await go(v, "#/newest")
  await expect(v.page.locator(".athing")).toHaveCount(4)
  await expect(v.page.locator(".athing").first()).toContainText("hiring") // newest first
  await expect(v.page.locator("#nav a.topsel")).toHaveText("new")

  await go(v, "#/")
  await expect(v.page.locator(".athing")).toHaveCount(4)
  await expect(v.page.locator("#nav a.topsel")).toHaveCount(0) // HN marks nothing on the front page
  await expect(row(v.page, "GenosDB: a P2P graph database with a zero-trust model").locator(".sitebit")).toContainText("github.com")
  await expect(subtextOf(v.page, "GenosDB: a P2P graph database with a zero-trust model")).toContainText("0 points by constitution")

  await go(v, "#/ask")
  await expect(v.page.locator(".athing")).toHaveCount(1) // the text post only
  await expect(v.page.locator(".titleline")).toContainText("Ask dN")
  await go(v, "#/show")
  await expect(v.page.locator(".athing")).toHaveCount(1)
  await expect(v.page.locator(".titleline")).toContainText("Show dN")
  await expect(v.page.locator("#bigbox")).toContainText("Show dN is for something you've made")
  await go(v, "#/jobs")
  await expect(v.page.locator(".athing")).toHaveCount(1)
  await expect(v.page.locator(".titleline")).toContainText("hiring")
  await expect(v.page.locator(".votelinks.nosee")).toHaveCount(1) // no arrow on your own — and jobs are not voted on HN either

  // A thread, then the comment pages that quote which story it is on.
  await go(v, "#/ask"); await v.page.locator(".titleline a").first().click()
  await v.page.locator(".reply-form textarea").fill("The one that deletes.")
  await v.page.locator('.reply-form input[type="submit"]').click()
  await expect(v.page.locator(".comment-tree .commtext")).toHaveText("The one that deletes.")
  await go(v, "#/newcomments")
  await expect(v.page.locator(".comment-tree .comhead")).toContainText("on: Ask dN: which rule would you refuse to run?")
  await expect(v.page.locator("#nav a.topsel")).toHaveText("comments")
  await go(v, "#/threads")
  await expect(v.page.locator(".comment-tree .commtext")).toHaveText("The one that deletes.")
  await expect(v.page.locator("#nav a.topsel")).toHaveText("threads")

  await go(v, `#/submitted/${ADDR.authority}`)
  await expect(v.page.locator(".athing")).toHaveCount(4)
  await go(v, "#/from/github.com")
  await expect(v.page.locator(".athing")).toHaveCount(2)
  await go(v, `#/user/${ADDR.authority}`)
  await expect(v.page.locator(".userpage")).toContainText(/trust:\s*the authority/)
  await expect(v.page.locator(".userpage")).toContainText(/role:\s*superadmin/)

  await go(v, "#/constitution")
  await expect(v.page.locator(".constitution")).toContainText('{"if":{"role":"guest"},"offsetTimestamp":10000,"then":{"assignRole":"user"}}') // the file, rendered
  await expect(v.page.locator(".constitution")).toContainText("flagsToKill")
  await expect(v.page.locator(".constitution")).toContainText("the authority is online here")
  await go(v, "#/nowhere")
  await expect(v.page.locator("#bigbox")).toContainText("No such page.")
  await v.close()
})

test("past is a day of stories, with HN's navigation", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("past"))
  await loginAs(v, "constitution")
  await submit(v, "A story from today", "https://genosdb.com/")
  const today = new Date(), day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  await go(v, `#/front?day=${day}`)
  await expect(v.page.locator("#bigbox")).toContainText("Stories from")
  await expect(v.page.locator(".titleline")).toContainText("A story from today")
  await expect(v.page.locator("#nav a.topsel")).toHaveText("past")
  await v.page.locator('a:has-text("a day")').first().click() // go back a day
  await expect(v.page.locator("#bigbox")).toContainText("No stories that day")
  await go(v, "#/front") // with no day: yesterday, as on HN
  await expect(v.page.locator("#bigbox")).toContainText("Stories from")
  await v.close()
})

test("search is the engine's $text: a word finds the story, accents and case aside", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("search"))
  await loginAs(v, "constitution")
  await submit(v, "Café society and the Fediverse", "https://genosdb.com/")
  await submit(v, "Something else entirely", "https://genosdb.com/")
  await v.page.locator("#search-input").fill("CAFE")
  await v.page.locator("#search-input").press("Enter")
  await expect(v.page).toHaveURL(/#\/search\?q=CAFE/)
  await expect(v.page.locator(".athing")).toHaveCount(1)
  await expect(v.page.locator(".titleline")).toContainText("Café society")
  await v.close()
})

test("More: the front page shows thirty and pages the rest", async ({ browser }) => {
  test.setTimeout(240_000)
  const v = await visitor(browser, freshRoom("more"))
  await loginAs(v, "constitution")
  for (let i = 1; i <= 31; i++) await submit(v, `Story number ${i}`, `https://genosdb.com/story-${i}`)
  await go(v, "#/newest")
  await expect(v.page.locator(".athing")).toHaveCount(30)
  await expect(v.page.locator(".morelink")).toHaveText("More")
  await v.page.locator(".morelink").click()
  await expect(v.page).toHaveURL(/#\/newest\?p=2/)
  await expect(v.page.locator(".athing")).toHaveCount(1)
  await expect(v.page.locator(".rank")).toHaveText("31.")
  await expect(v.page.locator(".morelink")).toHaveCount(0)
  await v.close()
})

test("hide is yours alone: gone here, listed under hidden, still there for everyone else", async ({ browser }) => {
  const room = freshRoom("hide")
  const a = await visitor(browser, room), b = await visitor(browser, room)
  await loginAs(a, "constitution")
  await submit(a, "Hide me", "https://genosdb.com/")
  await submit(a, "Keep me", "https://genosdb.com/")
  await go(a, "#/")
  await subtextOf(a.page, "Hide me").locator(".hide").click()
  await expect(a.page.locator(".athing")).toHaveCount(1)
  await expect(a.page.locator(".titleline")).toContainText("Keep me")
  await go(a, "#/hidden")
  await expect(a.page.locator(".titleline")).toContainText("Hide me")
  await expect(b.page.locator(".titleline", { hasText: "Hide me" })).toBeVisible() // the other visitor never hid it
  await subtextOf(a.page, "Hide me").locator(".hide").click() // un-hide
  await go(a, "#/")
  await expect(a.page.locator(".athing")).toHaveCount(2)
  await a.close(); await b.close()
})

test("a thread folds and unfolds", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("fold"))
  await loginAs(v, "constitution")
  await submit(v, "Ask dN: fold me", "A thread to fold.")
  await v.page.locator(".reply-form textarea").fill("Parent comment")
  await v.page.locator('.reply-form input[type="submit"]').click()
  await expect(v.page.locator(".comment-tree .commtext")).toHaveCount(1)
  await v.page.locator(".reply-link").first().click()
  await v.page.locator(".comment-tree .reply-form textarea").fill("Child comment")
  await v.page.locator('.comment-tree .reply-form input[type="submit"]').click()
  await expect(v.page.locator(".comment-tree .commtext")).toHaveCount(2)
  await v.page.locator(".togg").first().click()
  await expect(v.page.locator(".togg").first()).toHaveText("[2 more]")
  await expect(v.page.locator(".comment-tree .commtext")).toHaveCount(1) // the child row is gone…
  await expect(v.page.locator(".comment-tree .commtext").first()).toBeHidden() // …and the parent's text folds, as on HN
  await v.page.locator(".togg").first().click()
  await expect(v.page.locator(".comment-tree .commtext")).toHaveCount(2)
  await expect(v.page.locator(".comment-tree .commtext").first()).toBeVisible()
  await v.close()
})

test("on a phone nothing overflows the screen", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("phone"), { viewport: { width: 390, height: 844 } })
  await loginAs(v, "constitution")
  await submit(v, "A title long enough to wrap on a phone, with a domain that could push things sideways", "https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system")
  for (const hash of ["#/", "#/constitution", "#/login", `#/user/${ADDR.authority}`]) {
    await go(v, hash)
    expect(await v.page.evaluate(() => document.documentElement.scrollWidth), hash).toBeLessThanOrEqual(390)
  }
  await v.close()
})

test("the shell shows before the engine, and says so when the CDN is unreachable", async ({ browser }) => {
  const context = await browser.newContext()
  await context.route("https://cdn.jsdelivr.net/**", (r) => r.abort())
  const page = await context.newPage()
  await page.goto(url(freshRoom("nocdn")))
  await expect(page.locator("#nav")).toContainText("new | past | comments | ask | show | jobs | submit")
  await expect(page.locator("#bigbox")).toContainText("Could not load the GenosDB engine from cdn.jsdelivr.net")
  await context.close()
})
