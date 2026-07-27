export default function HomePage() {
  return (
    <div>
      <h1>MP-CRM</h1>
      <p className="muted">
        Шаг 1: базовый CRUD для ручного учёта товаров, поставщиков и поставок.
      </p>
      <ul>
        <li><a href="/products">Товары</a></li>
        <li><a href="/suppliers">Поставщики</a></li>
        <li><a href="/batches">Поставки из Китая</a></li>
        <li><a href="/orders">Заказы</a></li>
        <li><a href="/marketplaces">Площадки</a></li>
        <li><a href="/mp-listings">Листинги</a></li>
        <li><a href="/matching">Сопоставление</a></li>
        <li><a href="/warehouses">Склады</a></li>
        <li><a href="/stock">Остатки</a></li>
        <li><a href="/stock-import">Импорт остатков из CSV</a></li>
        <li><a href="/unit-economics">Юнит-экономика</a></li>
      </ul>
    </div>
  );
}
