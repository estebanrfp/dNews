/**
 * The constitution, as the engine and the peers apply it. Every negative here
 * is a real refusal — a write that succeeds locally and never lands anywhere
 * else — proved against a later write that does land (the anti-vacuity
 * sentinel), never against silence.
 */
import { expect, test } from "@playwright/test"
import { ADDR, connected, flag, freshRoom, go, loginAs, newcomer, promoted, row, submit, subtextOf, upvote, visitor } from "./_helpers.js"

test("a guest's write is refused by every receiver; the constitution promotes, and the same person's next write lands", async ({ browser }) => {
  const room = freshRoom("guest")
  const alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  // No authority online: Alice stays a guest. The UI says so before the click…
  await go(alice, "#/submit")
  await alice.page.locator('[name="title"]').fill("Too early")
  await alice.page.locator('[name="url"]').fill("https://genosdb.com/too-early")
  await alice.page.locator('#submit-form input[type="submit"]').click()
  await expect(alice.page.locator("#notice")).toContainText("10 seconds")
  // …and a modified client that skips the UI writes locally and nowhere else.
  await alice.page.evaluate(() => db.sm.acls.set({ type: "story", title: "A guest's story", text: "written past the UI", at: Date.now() }))
  await go(alice, "#/newest")
  await expect(alice.page.locator(".titleline")).toContainText("A guest's story") // local success…
  // The authority arrives; Alice is promoted; her legitimate story lands on Bob — the guest one never does.
  const authority = await visitor(browser, room)
  await loginAs(authority, "constitution")
  await connected(authority)
  await promoted(alice)
  await submit(alice, "A user's story", "https://genosdb.com/")
  await go(bob, "#/newest")
  await expect(bob.page.locator(".titleline", { hasText: "A user's story" })).toBeVisible()
  await expect(bob.page.locator(".titleline", { hasText: "A guest's story" })).toHaveCount(0) // …refused by the receiver
  await go(authority, "#/newest")
  await expect(authority.page.locator(".titleline", { hasText: "A guest's story" })).toHaveCount(0)
  await alice.close(); await bob.close(); await authority.close()
})

test("nobody edits another's node — not a member, not the authority", async ({ browser }) => {
  const room = freshRoom("owner")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room)
  const reader = await visitor(browser, room) // a guest: reads and syncs, writes nothing — the impartial observer
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(authority); await connected(alice); await connected(bob); await connected(reader)
  await promoted(alice); await promoted(bob)
  await submit(alice, "Alice's original title", "https://genosdb.com/")
  for (const who of [bob, authority, reader]) { await go(who, "#/newest"); await expect(who.page.locator(".titleline", { hasText: "Alice's original title" })).toBeVisible() }
  const id = await reader.page.locator(".athing").first().getAttribute("id").then((s) => s.slice(2))
  // A member and the authority rewrite the node past the UI. Each succeeds on its own screen — and nowhere else.
  await bob.page.evaluate(async (id) => { const { result } = await db.get(id); await db.put({ ...result.value, title: "Rewritten by Bob" }, id) }, id)
  await authority.page.evaluate(async (id) => { const { result } = await db.get(id); await db.put({ ...result.value, title: "Rewritten by the authority" }, id) }, id)
  await expect(bob.page.locator(".titleline", { hasText: "Rewritten by Bob" })).toBeVisible() // local success, the documented behaviour
  // The sentinel: Bob's own story lands on everyone, so the channel works.
  await submit(bob, "Bob's own story lands", "https://genosdb.com/")
  for (const who of [alice, reader]) {
    await go(who, "#/newest")
    await expect(who.page.locator(".titleline", { hasText: "Bob's own story lands" })).toBeVisible()
    await expect(who.page.locator(".titleline", { hasText: "Alice's original title" })).toBeVisible() // untouched
    await expect(who.page.locator(".titleline", { hasText: "Rewritten" })).toHaveCount(0)
  }
  await authority.close(); await alice.close(); await bob.close(); await reader.close()
})

test("writing is free, influence is earned: an unvouched identity's vote weighs nothing until someone vouches", async ({ browser }) => {
  const room = freshRoom("trust")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), stranger = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice")
  await newcomer(stranger)
  await connected(stranger)
  await promoted(alice)
  await submit(alice, "Ask dN: does an unvouched vote count?", "It should not.")
  await promoted(stranger)
  await expect(stranger.page.locator(".userpage")).toContainText("not vouched for yet")
  await go(stranger, "#/")
  await upvote(stranger, "Ask dN: does an unvouched vote count?")
  await expect(subtextOf(stranger.page, "Ask dN: does an unvouched vote count?")).toContainText("unvote") // the vote exists…
  await expect(subtextOf(stranger.page, "Ask dN: does an unvouched vote count?")).toContainText("0 points") // …and weighs nothing
  await go(authority, "#/")
  await expect(subtextOf(authority.page, "Ask dN: does an unvouched vote count?")).toContainText("0 points")
  // The authority vouches: the same vote now counts everywhere, with no new write from the stranger.
  await go(authority, `#/user/${stranger.address}`)
  await authority.page.locator("#vouch-btn").click()
  await go(authority, "#/")
  await expect(subtextOf(authority.page, "Ask dN: does an unvouched vote count?")).toContainText("1 point")
  await expect(subtextOf(stranger.page, "Ask dN: does an unvouched vote count?")).toContainText("1 point")
  await go(stranger, `#/user/${stranger.address}`)
  await expect(stranger.page.locator(".userpage")).toContainText(/vouched for by\s*constitution/)
  await authority.close(); await alice.close(); await stranger.close()
})

test("your own vote never counts", async ({ browser }) => {
  const v = await visitor(browser, freshRoom("selfvote"))
  await loginAs(v, "constitution")
  await submit(v, "My own story", "https://genosdb.com/")
  await go(v, "#/")
  await expect(v.page.locator(".votelinks.nosee")).toHaveCount(1) // no arrow to press
  await v.page.evaluate(async () => { const { results } = await db.map({ query: { type: "story" } }); await db.sm.acls.set({ type: "vote", item: results[0].id, dir: 1, at: Date.now() }) })
  await expect(subtextOf(v.page, "My own story")).toContainText("unvote") // the node exists…
  await expect(subtextOf(v.page, "My own story")).toContainText("0 points") // …and counts nothing
  await v.close()
})

test("three trusted flags kill an item; showdead reveals it in grey, with the reason; an unflag brings it back", async ({ browser }) => {
  test.setTimeout(420_000)
  const room = freshRoom("flags")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  // Three vouched newcomers, so every flagger can reach flagKarma (5) from trusted upvotes — not their own.
  const crowd = []
  for (let i = 0; i < 3; i++) { const n = await visitor(browser, room); await newcomer(n); crowd.push(n) }
  for (const n of crowd) { await go(authority, `#/user/${n.address}`); await authority.page.locator("#vouch-btn").click() }
  for (const who of [alice, bob, ...crowd]) await promoted(who)
  await submit(authority, "The authority's story", "https://genosdb.com/a")
  await submit(alice, "Alice's story", "https://genosdb.com/b")
  await submit(bob, "Bob's story", "https://genosdb.com/c")
  await submit(crowd[0], "Spam, allegedly", "https://genosdb.com/spam")
  const everyone = [authority, alice, bob, ...crowd]
  for (const who of everyone) {
    await go(who, "#/newest")
    for (const title of ["The authority's story", "Alice's story", "Bob's story"]) {
      const arrow = row(who.page, title).locator(".votearrow")
      if (await row(who.page, title).locator(".votelinks.nosee").count() === 0) await arrow.click()
    }
  }
  for (const [who, title] of [[authority, "The authority's story"], [alice, "Alice's story"], [bob, "Bob's story"]]) {
    await expect(subtextOf(who.page, title)).toContainText("5 points") // five trusted votes, none its own
  }
  await expect(authority.page.locator("#session")).toContainText("constitution (5)")
  // Three flags from members with karma ≥ 5: dead.
  for (const who of [authority, alice, bob]) { await go(who, "#/newest"); await flag(who, "Spam, allegedly") }
  for (const who of [authority, crowd[1]]) {
    await go(who, "#/")
    await expect(who.page.locator(".titleline", { hasText: "Spam, allegedly" })).toHaveCount(0)
  }
  // showdead: the killed item, in grey, with its reason.
  await go(crowd[1], `#/user/${crowd[1].address}`)
  await crowd[1].page.locator("#showdead").check()
  await go(crowd[1], "#/newest")
  await expect(row(crowd[1].page, "[dead] Spam, allegedly")).toHaveClass(/dead/)
  await expect(subtextOf(crowd[1].page, "[dead] Spam, allegedly")).toContainText("flagged by 3 trusted members")
  // One unflag and it is alive again, everywhere. A killed item is off Bob's lists (no showdead): its page still has the link.
  const spamId = await row(crowd[1].page, "[dead] Spam, allegedly").getAttribute("id").then((s) => s.slice(2))
  await go(bob, `#/item/${spamId}`); await bob.page.locator(".flag", { hasText: "unflag" }).first().click()
  await go(authority, "#/")
  await expect(authority.page.locator(".titleline", { hasText: "Spam, allegedly" })).toBeVisible()
  for (const who of everyone) await who.close()
})

test("the ladder, by real votes: karma at −10 restricts, and the floor rule restores", async ({ browser }) => {
  test.setTimeout(600_000)
  const room = freshRoom("ladder")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(authority); await connected(alice); await connected(bob)
  await promoted(alice); await promoted(bob)
  // Bob earns downvoteKarma (20): ten stories, each upvoted by two trusted members.
  for (let i = 1; i <= 10; i++) await submit(bob, `Bob's story ${i}`, `https://genosdb.com/bob-${i}`)
  for (const who of [authority, alice]) {
    await go(who, "#/newest"); await expect(who.page.locator(".athing")).toHaveCount(10)
    for (let i = 1; i <= 10; i++) await upvote(who, `Bob's story ${i}`)
  }
  await expect(bob.page.locator("#session")).toContainText("bob (20)")
  // Alice posts ten; Bob, now able to, votes each one down: karma −10, certified by the authority, restricted by the rule.
  for (let i = 1; i <= 10; i++) await submit(alice, `Alice's story ${i}`, `https://genosdb.com/alice-${i}`)
  await go(bob, "#/newest"); await expect(bob.page.locator(".athing")).toHaveCount(20)
  for (let i = 1; i <= 10; i++) await subtextOf(bob.page, `Alice's story ${i}`).locator('.vote[data-dir="-1"]').click()
  await expect(alice.page.locator("#session")).toContainText("alice (-10)")
  await go(alice, `#/user/${ADDR.alice}`)
  await expect(alice.page.locator(".userpage")).toContainText(/role:\s*restricted/)
  await go(alice, "#/submit")
  await alice.page.locator('[name="title"]').fill("Still here?")
  await alice.page.locator('[name="text"]').fill("Restricted.")
  await alice.page.locator('#submit-form input[type="submit"]').click()
  await expect(alice.page.locator("#notice")).toContainText("restricted you to reading")
  // One vote taken back: −9, and the floor rule restores her — last match wins, no demotion rule needed.
  await go(bob, "#/newest"); await subtextOf(bob.page, "Alice's story 10").locator('.vote[data-dir="0"]').click()
  await expect(alice.page.locator("#session")).toContainText("alice (-9)")
  await go(alice, `#/user/${ADDR.alice}`)
  await expect(alice.page.locator(".userpage")).toContainText(/role:\s*user/)
  await authority.close(); await alice.close(); await bob.close()
})
