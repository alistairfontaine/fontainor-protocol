import { Routes, Route } from 'react-router-dom'

function Placeholder() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <h1 className="font-display text-4xl font-semibold text-ink">fontainor</h1>
        <p className="mt-2 text-muted">The permanent music registry — new frontend scaffolding.</p>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}
