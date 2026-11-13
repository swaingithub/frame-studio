import { create } from 'zustand'

export type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'frame-studio-theme'
const DEFAULT_THEME: Theme = 'dark'

function apply(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
}

export function applyInitialTheme(): void {
  apply(initialTheme())
}

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: DEFAULT_THEME,
  setTheme: (t) => {
    apply(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
    set({ theme: t })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))

/** Call once at startup: applies the stored theme and hydrates the store. */
export function initTheme(): Theme {
  const t = initialTheme()
  apply(t)
  useThemeStore.setState({ theme: t })
  return t
}
