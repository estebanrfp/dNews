/**
 * The thresholds of the constitution, reached the only honest way: by real
 * votes from real identities. Each of these builds the karma it needs on the
 * page, then watches the rule fire on the page.
 */
import { expect, test } from "@playwright/test"
import { connected, freshRoom, go, loginAs, newcomer, promoted, row, submit, subtextOf, upvote, visitor } from "./_helpers.js"

/** Every voter upvotes every story that is not their own — the arrow is not even there on their own. */
const upvoteAll = async (who, titles) => {
  await go(who, "#/newest")
  for (const title of titles) if (await row(who.page, title).locator(".votelinks.nosee").count() === 0) await upvote(who, title)
}

test("deadScore: five downvotes kill an item on their own, no flag needed", async ({ browser }) => {
  test.setTimeout(600_000)
  const room = freshRoom("deadscore")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  const crowd = []
  for (let i = 0; i < 3; i++) { const n = await visitor(browser, room); await newcomer(n); crowd.push(n) }
  for (const n of crowd) { await go(authority, `#/user/${n.address}`); await authority.page.locator("#vouch-btn").click() }
  const downvoters = [alice, bob, ...crowd]
  for (const who of downvoters) await promoted(who)
  // Five members reach downvoteKarma (20): four stories each, upvoted by the five other trusted identities.
  const titles = []
  for (const [i, who] of downvoters.entries()) for (let j = 1; j <= 4; j++) { const t = `Member ${i + 1}, story ${j}`; titles.push(t); await submit(who, t, `https://genosdb.com/${i}-${j}`) }
  for (const who of [authority, ...downvoters]) await upvoteAll(who, titles)
  for (const [i, who] of downvoters.entries()) await expect(who.page.locator("#session")).toContainText(`(20)`)
  // The victim: a story of the authority's, voted down by all five.
  await submit(authority, "Voted into the ground", "https://genosdb.com/ground")
  for (const who of downvoters) { await go(who, "#/newest"); await subtextOf(who.page, "Voted into the ground").locator('.vote[data-dir="-1"]').click() }
  await go(authority, "#/")
  await expect(authority.page.locator(".titleline", { hasText: "Voted into the ground" })).toHaveCount(0) // dead: off the front page
  await go(authority, `#/user/${authority.address}`); await authority.page.locator("#showdead").check()
  await go(authority, "#/newest")
  await expect(row(authority.page, "[dead] Voted into the ground")).toHaveClass(/dead/)
  await expect(subtextOf(authority.page, "[dead] Voted into the ground")).toContainText("voted down to -5")
  for (const who of [authority, ...downvoters]) await who.close()
})

test("vouchPenalty: a voucher pays for an invitee that ends up restricted", async ({ browser }) => {
  test.setTimeout(600_000)
  const room = freshRoom("penalty")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room), stranger = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await newcomer(stranger)
  await promoted(alice); await promoted(bob); await promoted(stranger)
  // Alice reaches vouchKarma (10): five stories, two trusted upvotes each. Bob reaches downvoteKarma (20): ten stories, two each.
  const aliceTitles = [], bobTitles = []
  for (let i = 1; i <= 5; i++) { aliceTitles.push(`Alice ${i}`); await submit(alice, `Alice ${i}`, `https://genosdb.com/alice-${i}`) }
  for (let i = 1; i <= 10; i++) { bobTitles.push(`Bob ${i}`); await submit(bob, `Bob ${i}`, `https://genosdb.com/bob-${i}`) }
  await upvoteAll(authority, [...aliceTitles, ...bobTitles]); await upvoteAll(bob, aliceTitles); await upvoteAll(alice, bobTitles)
  await expect(alice.page.locator("#session")).toContainText("alice (10)")
  await expect(bob.page.locator("#session")).toContainText("bob (20)")
  // Alice vouches for the stranger — the chain is public — and the stranger posts ten stories that Bob votes down.
  await go(alice, `#/user/${stranger.address}`); await alice.page.locator("#vouch-btn").click()
  await go(stranger, `#/user/${stranger.address}`)
  await expect(stranger.page.locator(".userpage")).toContainText(/vouched for by\s*alice/)
  for (let i = 1; i <= 10; i++) await submit(stranger, `Stranger ${i}`, `https://genosdb.com/s-${i}`)
  await go(bob, "#/newest")
  for (let i = 1; i <= 10; i++) await subtextOf(bob.page, `Stranger ${i}`).locator('.vote[data-dir="-1"]').click()
  await expect(stranger.page.locator("#session")).toContainText("(-10)")
  await go(stranger, `#/user/${stranger.address}`)
  await expect(stranger.page.locator(".userpage")).toContainText(/role:\s*restricted/)
  // The rule: the voucher loses vouchPenalty (5) for the restricted invitee — 10 became 5, on every peer.
  await expect(alice.page.locator("#session")).toContainText("alice (5)")
  await go(bob, `#/user/${alice.address}`)
  await expect(bob.page.locator(".userpage")).toContainText(/karma:\s*5/)
  await expect(bob.page.locator(".userpage")).toContainText(/vouched:/)
  for (const who of [authority, alice, bob, stranger]) await who.close()
})

test("downvoteKarma: below it there is no downvote to press, and a downvote written past the UI weighs nothing", async ({ browser }) => {
  const room = freshRoom("downgate")
  const authority = await visitor(browser, room), alice = await visitor(browser, room), bob = await visitor(browser, room)
  await loginAs(authority, "constitution"); await loginAs(alice, "alice"); await loginAs(bob, "bob")
  await connected(alice); await connected(bob)
  await promoted(alice); await promoted(bob)
  await submit(bob, "Bob's story", "https://genosdb.com/")
  await go(alice, "#/newest")
  await expect(subtextOf(alice.page, "Bob's story")).toContainText("flag")
  await expect(subtextOf(alice.page, "Bob's story").locator('.vote[data-dir="-1"]')).toHaveCount(0) // karma 0: nothing to press
  // A modified client writes the downvote anyway: the node exists, and every peer counts it as nothing.
  await alice.page.evaluate(async () => { const { results } = await db.map({ query: { type: "story" } }); await db.sm.acls.set({ type: "vote", item: results[0].id, dir: -1, at: Date.now() }) })
  await expect(subtextOf(alice.page, "Bob's story")).toContainText("undownvote") // her own node, seen by her
  await expect(subtextOf(alice.page, "Bob's story")).toContainText("0 points")
  await go(bob, "#/newest")
  await expect(subtextOf(bob.page, "Bob's story")).toContainText("0 points")
  await expect(bob.page.locator("#session")).toContainText("bob (0)")
  await authority.close(); await alice.close(); await bob.close()
})
