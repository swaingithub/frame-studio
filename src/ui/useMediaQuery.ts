import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query. Used to switch the shell between the
 * desktop three-column layout and the compact drawer layout, and to pick
 * touch-friendly affordances. Safe on the server (returns `false`).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (): void => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * True when there is room for the inline three-column editor. Below this the
 * fixed side panels would squeeze the stage, so the shell switches to overlay
 * drawers instead. Keep the inline layout for roomy desktop workspaces only.
 */
export const DESKTOP_QUERY = '(min-width: 1280px)'
/** True for narrow phones; the inspector becomes a bottom sheet. */
export const PHONE_QUERY = '(max-width: 767px)'
/** Coarse pointers (finger/stylus) get larger hit targets. */
export const COARSE_QUERY = '(pointer: coarse)'
