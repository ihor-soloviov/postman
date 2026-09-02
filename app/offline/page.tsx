export default function OfflinePage() {
  return (
    <div className="card" style={{ marginTop: 40 }}>
      <h1>Немає зв&apos;язку</h1>
      <p className="muted">
        Сторінка ще не була відкрита онлайн, тому її немає в кеші. Відкриті раніше маршрути
        працюють без мережі, а позначки й коментарі збережуться і надішлються, коли зв&apos;язок
        повернеться.
      </p>
    </div>
  );
}
