"use client";

import { useMemo } from "react";
import StockCell from "./StockCell";
import { compareForSort } from "@/lib/sortCompare";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";
import PhotoThumb from "@/app/products/PhotoThumb";

type Product = { id: string; sku: string; name: string; photoUrl: string | null };
type Warehouse = { id: string; name: string; type: string };
type StockValues = { qtyAvailable: number; qtyReserved: number; qtyInTransit: number };
type StockRow = { productId: string; warehouseId: string } & StockValues;

const typeLabels: Record<string, string> = {
  OWN_B2B: "Свой склад",
  MARKETPLACE_FBO: "FBO",
  MARKETPLACE_FBS: "FBS",
};

export default function StockTable({
  products,
  warehouses,
  stock,
}: {
  products: Product[];
  warehouses: Warehouse[];
  stock: StockRow[];
}) {
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<string>("name");

  const stockMap = useMemo(() => {
    const map = new Map<string, StockValues>();
    for (const s of stock) {
      map.set(`${s.productId}|${s.warehouseId}`, s);
    }
    return map;
  }, [stock]);

  function compareByKey(a: Product, b: Product, key: string, dir: "asc" | "desc") {
    const isWarehouseSort = key !== "name" && key !== "sku";
    if (isWarehouseSort) {
      const av = stockMap.get(`${a.id}|${key}`)?.qtyAvailable ?? 0;
      const bv = stockMap.get(`${b.id}|${key}`)?.qtyAvailable ?? 0;
      return compareForSort(av, bv, "number", dir);
    }
    return compareForSort(a[key as "sku" | "name"], b[key as "sku" | "name"], "string", dir);
  }

  const sortedProducts = useMemo(() => {
    return applyMultiSort(products, compareByKey, pinned, sortKey, sortDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, stockMap, sortKey, sortDir, pinned]);

  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: 108 }} />
          <SortableTh
            label="Товар"
            active={pinned?.key === "name" || sortKey === "name"}
            dir={pinned?.key === "name" ? pinned.dir : sortDir}
            pinned={pinned?.key === "name"}
            onSort={() => handleSort("name")}
            onTogglePin={() => togglePin("name")}
          />
          {warehouses.map((w) => {
            const isPinned = pinned?.key === w.id;
            return (
              <SortableTh
                key={w.id}
                label={w.name}
                active={isPinned || sortKey === w.id}
                dir={isPinned ? pinned!.dir : sortDir}
                pinned={isPinned}
                onSort={() => handleSort(w.id)}
                onTogglePin={() => togglePin(w.id)}
                subtitle={<span className="muted">{typeLabels[w.type] ?? w.type}</span>}
              />
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedProducts.map((p) => (
          <tr key={p.id}>
            <td>
              <PhotoThumb url={p.photoUrl} size={88} />
            </td>
            <td>
              {p.sku}
              <div className="muted">{p.name}</div>
            </td>
            {warehouses.map((w) => (
              <StockCell
                key={w.id}
                productId={p.id}
                warehouseId={w.id}
                initial={stockMap.get(`${p.id}|${w.id}`) ?? null}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
