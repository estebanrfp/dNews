/**
 * The constitution of dNews.
 *
 * Everything that decides who may do what on this site is in this file, and
 * nowhere else. The app renders it verbatim on the "constitution" page, so the
 * rules you read there are the rules that run. Changing them is a pull request.
 *
 * Two kinds of rule live here, and the difference matters:
 *
 *  - `roles` and `rules` are ENFORCED BY THE ENGINE. GenosDB's Security
 *    Manager signs every operation and every peer verifies it: a guest's
 *    write is rejected on every receiver, a role is only valid with the
 *    authority's signature, and the governance engine assigns roles from
 *    these rules while the authority is online. Nobody can act outside them.
 *
 *  - `thresholds` are DERIVED BY EVERY PEER. Points, karma, trust and the
 *    death of an item are computed by each browser from the same signed
 *    nodes, with the same deterministic rule. Nobody decides; everybody
 *    calculates, and anybody can recount.
 *
 * The authority has exactly one power: signing roles. It never touches
 * content — it cannot: every story, comment, vote and flag is a node its
 * author owns, and the engine refuses anyone else's edit or deletion.
 */

// Public, throwaway demo identities (they protect nothing), so every window
// of the demo can sign in with one click — the canonical set of the GenosDB
// design guide. A production deployment ships no mnemonic in its source.
export const SUPERADMIN = {
  name: "constitution", emoji: "🛡️",
  mnemonic: "panic now afford carbon donate lecture drift excite collect essay stuff prosper",
  address: "0xbfDe0eCEC5332Fd86D2570085571D6051Df098dA",
}
export const ALICE = {
  name: "alice", emoji: "👩‍🦰",
  mnemonic: "prosper fossil kitten crisp view spread jeans shield prosper myself awake usage",
  address: "0x3546D4BA0ac3bfDea3F1511F82a078DDdb3F4931",
}
export const BOB = {
  name: "bob", emoji: "👨‍🦱",
  mnemonic: "salmon grant recall neutral banner glow pluck divert cactus theory rally ship captain shaft cactus",
  address: "0x8089C0480139d85D82c1E20eeF08a77EF8cD7DEC",
}
export const DEMO_IDENTITIES = [SUPERADMIN, ALICE, BOB]

const MEMBER = { $in: ["user", "restricted"] }

export const CONSTITUTION = {
  /** The one address whose signature makes a role valid. Its only power. */
  authority: SUPERADMIN.address,

  /** What each role may do. Enforced by the engine on every peer. */
  roles: {
    guest:      { can: ["read", "sync"] },
    restricted: { can: ["read", "sync"] },
    user:       { can: ["write", "link", "sync"], inherits: ["guest"] },
    superadmin: { can: ["assignRole"], inherits: ["user"] },
  },
  roleText: {
    guest: "Reads everything, writes nothing. Where everyone starts.",
    restricted: "Lost the right to write. Reads everything, like a guest, and recovers by the same rules that demoted it.",
    user: "Submits, comments, votes and flags. Every node it creates is its own: nobody else can edit or delete it.",
    superadmin: "The authority. Signs role changes when the rules say so. Never touches content — it cannot.",
  },

  /**
   * Evaluated in order by the governance engine; the LAST match wins. A user
   * that drops below a threshold is caught by the rule above it — demotion is
   * just another rule. `karma` is written on the user node by the authority,
   * counted from the signed votes (see below), and anyone can recount it.
   */
  rules: [
    { if: { role: "guest" }, offsetTimestamp: 10_000, then: { assignRole: "user" },
      text: "A guest becomes a user 10 seconds after signing in. No invitation needed to write." },
    { if: { role: MEMBER }, then: { assignRole: "user" },
      text: "The floor: every member is a user, whatever their karma." },
    { if: { role: MEMBER, karma: { $lte: -10 } }, then: { assignRole: "restricted" },
      text: "A member whose karma falls to −10 loses the right to write. It comes back the moment the karma does." },
  ],

  /**
   * Derived by every peer from the signed nodes. Writing is free; influence
   * is earned. A vote or a flag counts only if its owner is TRUSTED, and trust
   * is a chain of vouches that starts at the authority — so a hundred fresh
   * identities voting for each other add up to zero.
   */
  thresholds: {
    gravity: 1.8,        // HN's ranking: (points − 1) / (hours + 2) ^ gravity
    vouchKarma: 10,      // karma a trusted member needs to vouch for a newcomer
    vouchPenalty: 5,     // karma a voucher loses for each invitee that gets restricted
    flagKarma: 5,        // karma a trusted member needs for its flags to count
    flagsToKill: 3,      // trusted flags that kill an item
    downvoteKarma: 20,   // karma a trusted member needs to vote down
    deadScore: -5,       // points at which an item is dead on its own
    perPage: 30,
  },
  thresholdText: {
    gravity: "Stories rank by HN's formula: points minus one, divided by age in hours plus two, to this power.",
    vouchKarma: "A trusted member with this much karma may vouch for a newcomer. The vouch is a signed node: the chain is public.",
    vouchPenalty: "A voucher loses this much karma for every invitee that ends up restricted. Vouching costs something.",
    flagKarma: "Flags count only from trusted members with this much karma.",
    flagsToKill: "This many counting flags kill an item. Killed items stay visible in grey to anyone with showdead on, with the reason.",
    downvoteKarma: "Voting down needs this much karma, as on HN.",
    deadScore: "An item whose points fall to this is dead on its own, no flags needed.",
    perPage: "Stories per page.",
  },

  /** How this file changes. */
  amendment: "This constitution is a file in the repository. To change a rule, open a pull request. The discussion is public, the diff is the amendment, and the app renders the file as merged.",
}

/** The rules as the engine takes them — the human text stays here. */
export const governanceRules = CONSTITUTION.rules.map(({ text, ...rule }) => rule)
