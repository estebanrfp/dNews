# dNews | Distributed GenosDB clone of Hacker News (Y Combinator)

A Hacker News clone with **no server**. The same front page, the same threads, the same orange bar — but every story, comment, vote and flag is a signed node in a [GenosDB](https://github.com/estebanrfp/gdb) graph that lives in your browser and syncs peer-to-peer over WebRTC. Nobody hosts it, nobody moderates it: a **constitution every peer runs** decides who may write, what a vote weighs, and when an item dies — and it is a file in this repository.

**Live:** [estebanrfp.github.io/dnews](https://estebanrfp.github.io/dnews/) · **Engine:** [GenosDB](https://github.com/estebanrfp/gdb) — if this is interesting, [star the engine ★](https://github.com/estebanrfp/gdb): that is where the work is.

Plain HTML, CSS and JavaScript. No framework, no build step, no backend. Four files.

## What is different from Hacker News

| On Hacker News | On dNews |
|---|---|
| A server holds the data | Every visitor holds the graph; peers sync it directly over WebRTC |
| An account is a row in a database | An identity is a key pair on your device: a mnemonic recovers it, a passkey keeps it |
| Moderators act on judgement, unseen | The [constitution](constitution.js) acts on rules, on every peer, in the open |
| An edit or a deletion is one click for staff | Impossible: every node is owned by its author and the engine refuses anyone else's edit — the authority included |
| Karma is a number you trust the site about | Karma is derived by your own browser from the signed votes; the authority's certified number is shown beside it, and anyone can recount |
| Sybils are fought with IPs and heuristics | Writing is free; influence is earned: a vote counts only from a member vouched for along a public chain that starts at the authority |

## The constitution

[`constitution.js`](constitution.js) is rendered verbatim on the site's **constitution** page. Two kinds of rule live in it:

- **Roles and role rules — enforced by the engine.** GenosDB's Security Manager signs every operation and every peer verifies it. A guest's write is refused on every receiver; a role is valid only with the authority's signature; the governance engine assigns roles from the rules while the authority is online. Today: a guest becomes a `user` 10 s after signing in, and a member whose karma falls to −10 becomes `restricted` — and recovers by the same rule.
- **Thresholds — derived by every peer.** Points, karma, trust, ranking and the death of an item are computed by each browser from the same signed nodes with the same deterministic rule. Flags count only from trusted members with enough karma; three of them kill an item; a killed item stays visible in grey, with the reason, to anyone with `showdead`.

The authority has exactly one power: signing roles. It never touches content — it cannot.

**To change a rule, open a pull request.** The discussion is public, the diff is the amendment, and the site renders the file as merged.

## Trust, and why a hundred fake accounts add up to zero

Anyone can post the moment the constitution makes them a user. But a vote or a flag counts only if its owner is **trusted**, and trust is a chain of signed vouches that starts at the authority: a trusted member with enough karma vouches for a newcomer by writing a node only they could have written. The chain is public (every user page says who vouched for them), and vouching costs: a voucher loses karma for every invitee that ends up restricted. Sybil-resistant by a public web of trust — not sybil-proof; nothing open is.

## What it demonstrates of GenosDB

- **Ownership enforced on every peer.** `db.sm.acls.set` makes the creator the owner; live or through catch-up, the engine refuses anyone else's edit or deletion. Authorship is the interface: "who voted" is the owner field nobody could forge.
- **Roles and governance.** Custom roles, a role ladder assigned by rules whose conditions are ordinary GenosDB queries, evaluated with last-match-wins so demotion needs no special machinery.
- **Deterministic agreement.** Two peers writing at once converge on the same result everywhere: the engine's hybrid clock and its tie-break decide, and the app derives from what won.
- **Derived state from one subscription.** One `db.map` feeds a store; every page — ranking, threads, karma, trust — is a pure function of it. Nothing ticks over the wire.
- **Identity with no server.** Mnemonic recovery, passkey sessions that survive a reload, and demo identities so two windows can meet in one click.

## Run it

Serve the folder with any static server — there is nothing to build:

```bash
bun tests/server.mjs        # http://localhost:5705
```

Two useful query parameters: `?room=anything` opens a private sandbox of the whole site (the tests use it), and `?relay=ws://…` points signalling at a relay of your own.

**Demo identities.** The login page offers three one-click identities from the GenosDB design guide: `alice`, `bob`, and the `constitution` authority. Open two browsers, sign in as the authority in one — it certifies karma and vouches for Alice and Bob — and as Alice in the other: submit, vote, watch the other window follow.

## Tests

```bash
pnpm install
pnpm test
```

Playwright, one `BrowserContext` per simulated peer (own storage, own identity), a fresh room per test. Signalling goes through the public relays; set `DNEWS_RELAY=ws://…` to use a local one.

## Contributing

Pull requests are welcome — to the code, and to the constitution. A change to `constitution.js` is an amendment: say in the PR what behaviour it changes and why the rule is fairer.

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer

## License

MIT
