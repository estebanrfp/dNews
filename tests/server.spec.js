/**
 * Production's authority: the Fallback Server, the always-on peer that ships
 * in the genosdb package. It holds the authority's key, runs the same rules,
 * and keeps the graph when every browser is gone.
 */
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { CONSTITUTION, SUPERADMIN, governanceRules } from "../constitution.js"
import { RELAY, connected, freshRoom, go, loginAs, promoted, submit, visitor } from "./_helpers.js"

const ROOT = new URL("..", import.meta.url).pathname

test("the Fallback Server is the authority that never sleeps: it promotes with no browser authority online, and keeps the graph when every browser is gone", async ({ browser }) => {
  test.setTimeout(300_000)
  const room = freshRoom("server")
  const server = spawn("bun", ["node_modules/genosdb/dist/genossrv.min.js", room, "--room"], {
    cwd: ROOT,
    env: { ...process.env, GDB_DB_PATH: join(mkdtempSync(join(tmpdir(), "dnews-srv-")), "data.sqlite"), GDB_SM_KEY: SUPERADMIN.mnemonic, GDB_SUPERADMINS: CONSTITUTION.authority, GDB_SM_RULES: JSON.stringify(governanceRules), ...(RELAY && { GDB_RELAY_URLS: RELAY }) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  server.stdout.on("data", (d) => { log += d }); server.stderr.on("data", (d) => { log += d })
  try {
    await expect.poll(() => log, { timeout: 60_000 }).toContain("signing as") // the authority's key is on the server
    const alice = await visitor(browser, room)
    await loginAs(alice, "alice")
    await connected(alice) // the server joined the room: it is the peer
    await promoted(alice) // by the rules, signed on the server — no browser authority anywhere
    await submit(alice, "Kept by the server", "https://genosdb.com/")
    await expect(alice.page.locator(".titleline")).toContainText("Kept by the server")
    await alice.close() // every browser is gone

    const later = await visitor(browser, room) // a fresh device: the only holder left is the server
    await connected(later)
    await expect(later.page.locator(".titleline")).toContainText("Kept by the server")
    await go(later, `#/user/${alice.address}`)
    await expect(later.page.locator(".userpage")).toContainText(/role:\s*user/) // the role it signed travelled too
    await later.close()
  } finally {
    server.kill()
  }
})
