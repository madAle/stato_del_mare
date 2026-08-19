import type React from "react";
import { coloreA } from "../map/colormap";

export function Legend({
  palette, massimo, unita, children,
}: {
  palette: string;
  massimo: number;
  unita: string;
  /** Il selettore della tavolozza: sta dentro la legenda perche' e' una scelta
   *  di colore, e va letta accanto alla scala che cambia. */
  children?: React.ReactNode;
}) {
  const tappe = Array.from({ length: 32 }, (_, i) => {
    const [r, g, b] = coloreA(palette, i / 31);
    return `rgb(${r},${g},${b}) ${(i / 31) * 100}%`;
  });
  return (
    <div className="legenda">
      <span>0 {unita}</span>
      <div className="scala" style={{ background: `linear-gradient(90deg, ${tappe.join(",")})` }} />
      <span>{massimo} {unita}</span>
      {children}
    </div>
  );
}
