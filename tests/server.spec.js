/**
 * Production's authority: the Fallback Server, the always-on peer that ships
 * in the genosdb package. It holds the authority's key, runs the same rules,
 * and keeps the graph when every browser is gone.
 */
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { CONSTITUTION, SUPERADMIN, governanceRules } from "../constitution.js"
import { RELAY, connected, freshRoom, go, loginAs, promoted, submit, visitor } from "./_helpers.js"

const ROOT = new URL("..", import.meta.url).pathname
const ARTIFACT = "https://cdn.jsdelivr.net/npm/genosdb@latest/dist/genossrv.min.js" // one file, zero dependencies, same CDN as the app

/** The server is an artifact, fetched from the CDN like the engine the app runs — nothing installed. */
const fetchServer = async () => {
  const dir = join(ROOT, "node_modules", ".cache"); mkdirSync(dir, { recursive: true })
  const file = join(dir, "genossrv.min.js")
  const res = await fetch(ARTIFACT); if (!res.ok) throw new Error(`${ARTIFACT} → ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

test("the Fallback Server is the authority that never sleeps: it promotes with no browser authority online, and keeps the graph when every browser is gone", async ({ browser }) => {
  test.setTimeout(300_000)
  const room = freshRoom("server")
  const dataDir = mkdtempSync(join(tmpdir(), "dnews-srv-"))
  const server = spawn("bun", [await fetchServer(), room, "--room"], {
    cwd: ROOT,
    env: { ...process.env, GDB_DB_PATH: join(dataDir, "data.sqlite"), GDB_SM_KEY: SUPERADMIN.mnemonic, GDB_SUPERADMINS: CONSTITUTION.authority, GDB_SM_RULES: JSON.stringify(governanceRules), ...(RELAY && { GDB_RELAY_URLS: RELAY }) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  // What the server holds is on its disk: the SQLite files (main + WAL) grow when a node lands.
  const onDisk = () => readdirSync(dataDir).reduce((n, f) => n + statSync(join(dataDir, f)).size, 0)
  let log = ""
  server.stdout.on("data", (d) => { log += d }); server.stderr.on("data", (d) => { log += d })
  try {
    await expect.poll(() => log, { timeout: 60_000 }).toContain("signing as") // the authority's key is on the server
    const alice = await visitor(browser, room)
    await loginAs(alice, "alice")
    await connected(alice) // the server joined the room: it is the peer
    await promoted(alice) // by the rules, signed on the server — no browser authority anywhere
    const before = onDisk()
    await submit(alice, "Kept by the server", "https://genosdb.com/")
    await expect(alice.page.locator(".titleline")).toContainText("Kept by the server")
    await expect.poll(onDisk, { timeout: 90_000 }).toBeGreaterThan(before) // the server wrote it down
    await alice.close() // every browser is gone

    const later = await visitor(browser, room) // a fresh device: the only holder left is the server
    await connected(later)
    await expect(later.page.locator(".titleline")).toContainText("Kept by the server")
    await go(later, `#/user/${alice.address}`)
    await expect(later.page.locator(".userpage")).toContainText(/role:\s*user/) // the role it signed travelled too
    await later.close()
  } finally {
    server.kill()
    if (test.info().status !== test.info().expectedStatus) console.log("server log:\n" + log.slice(-3000))
  }
})
