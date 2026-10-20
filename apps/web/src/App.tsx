import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { FocusRoute } from './routes/FocusRoute'
import { WorldRoute } from './routes/WorldRoute'
import { HistoryRoute } from './routes/HistoryRoute'
import { SettingsRoute } from './routes/SettingsRoute'

/**
 * Four routes (§6), all nested inside the layout shell.
 *
 * Settings is a route but deliberately not a nav item — it is reached through
 * the gear icon. That distinction is what keeps the tab bar to Focus, World and
 * History without an ever-growing list of destinations.
 *
 * Every route sits *within* the shell rather than beside it, so each one owns
 * only its content. Nesting a `<main>` inside the shell's `<main>` would be an
 * invalid landmark hierarchy — the shell owns the landmarks, routes own the
 * headings.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<FocusRoute />} />
        <Route path="/world" element={<WorldRoute />} />
        <Route path="/history" element={<HistoryRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
      </Route>
    </Routes>
  )
}
