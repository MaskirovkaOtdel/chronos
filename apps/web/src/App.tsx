import { Route, Routes } from 'react-router'
import { FocusRoute } from './routes/FocusRoute'
import { WorldRoute } from './routes/WorldRoute'
import { HistoryRoute } from './routes/HistoryRoute'
import { SettingsRoute } from './routes/SettingsRoute'

/**
 * Four routes (§6).
 *
 * Settings is a route but deliberately not a nav item — it is reached through
 * the gear icon. That distinction is what keeps the tab bar to Focus, World and
 * History without an ever-growing list of destinations.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FocusRoute />} />
      <Route path="/world" element={<WorldRoute />} />
      <Route path="/history" element={<HistoryRoute />} />
      <Route path="/settings" element={<SettingsRoute />} />
    </Routes>
  )
}
