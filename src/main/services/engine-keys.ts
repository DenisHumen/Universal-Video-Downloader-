/*
  Who may sign the download engine this build will install.

  The list is the whole of the trust: nothing fetched at run time can add to it,
  so a person who controls the GitHub release cannot publish a key alongside the
  files and have it believed. That is also why a rotation needs an app release.

  When yt-dlp changes its key:

   1. Add the new key here, keeping the old one for as long as the releases an
      older download might meet are signed with it. A signature by any key in
      the list passes, so an install on this list accepts both sides of the move.
   2. Get the new key from somewhere other than the release it would vouch for -
      the old key's signature on it, or the maintainers saying so in more than
      one place - and compare the fingerprint by hand.
   3. Ship the app. Until then every install keeps the engine it has and says so,
      and new installs refuse; see `EngineNotice`. The app's own updater does not
      go through this check, so that release reaches them.

  Only the public key packet is kept, not the armored file: the fingerprint is
  worked out from exactly these bytes, so anyone can compare it with what
  `gpg --show-keys public.key` prints, and the name and address in the key's
  user ID are of no use to the check.

  As of the 2026.10.26 release yt-dlp publishes one key, with no successor
  announced: RSA 4096, created 2023-02-26, no expiry, no subkeys.
*/

export interface PinnedKey {
  /** The v4 fingerprint, which `loadKey` checks against `packet` before using it. */
  fingerprint: string
  /** The body of the public key packet (tag 6), in base64. */
  packet: string
}

export const YT_DLP_KEYS: readonly PinnedKey[] = [
  {
    fingerprint: 'AC0CBBE6848D6A873464AF4E57CF65933B5A7581',
    packet:
      'BGP78C4BEAD0rF9zjGPAt0thlt5C1ebzccAVX7Nb1v+eqQjk+WEZdTETVCg3WAM5ngArlHdm/fZq' +
      'zUgO+pAYrB60GKeg7ffUDf+S0XFKEZdeRLYeAaqqKhSibValDjvOBOztu3W607HLETQAqA7wTPuI' +
      't2WqmpL60NIcyr27LxqmgdN3mNvZ2iLO+bP0nKR/C+PgE9H4ytywDa12zMx6PmZCnVOOOu6XZEFm' +
      'dUxxdQ9fFDqd9LcBKY2LDOcSYo1saY0YWiZWHtzVoZu1kOzjnS5Fjq/yBHJLImDH7pNxHm7s/Pna' +
      'urpmQFtDFrukt+2lhDnpKUmGr/I/3IHqH/X+9nPoS4uiqQ5HpblB8BK+4WfpaiEg75LnvuOPfZIP' +
      'KYyXa/0A7QojMwgOrD88ozT+VCkKkkJ+ijXZ7gHNjmcBaUdKK7fDIEOYI63Lyc6QWkGQTigFffSU' +
      'XWHDCO9aXNhP3ejqFWgGMtCUsrbkcJkWuWY7q5ARy/05HbSM3K4DU9eqtnxmiV1WQ8nXuI9JgJQR' +
      'vh5PTkny5LtxqzcmqvWO9TjHBbrs14BPEO9fcXxKL/CFBbzXDSvvAgArdqqlMoncQ/yicTlfL6qz' +
      'J8EKFiqW14QMTdAn6SuuZTodXCTiInwoT7WjjuFPKKdvfH1GP4bnqdzTnzLxCSDIEtfyfPsIX+9G' +
      'I7Jkk/zZjQARAQAB'
  }
]
