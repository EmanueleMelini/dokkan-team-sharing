/** Al cambio di scheda: le righe arrivano dal database, qui solo lo scheletro. */
export default function CaricaAdmin() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 rounded-[var(--raggio)] border border-linea bg-superficie" />
      ))}
    </div>
  )
}
