// Who the player is: a username (their handle) and a display name (what
// floats over their head). Kept in localStorage so the lobby remembers you
// between visits — and guarded, because this page lives in an iframe, where
// strict privacy settings make localStorage throw rather than return null.
const KEY = 'b1ngster-identity'

export function loadIdentity() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY))
    if (
      typeof parsed?.username === 'string' &&
      typeof parsed?.displayName === 'string'
    ) {
      return parsed
    }
  } catch {
    /* no storage is the same as no identity */
  }
  return null
}

export function saveIdentity(identity) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    /* the identity still holds for this visit */
  }
}
