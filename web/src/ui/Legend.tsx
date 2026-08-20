import type React from "react";
import { coloreA } from "../map/colormap";

/** Come si scrive un estremo della scala: virgola italiana, zero senza decimali. */
function estremo(v: number, unita: string): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "").replace(".", ",");
  return `${n} ${unita}`;
}

export function Legend({
  palette, minimo, massimo, unita, children,
}: {
  palette: string;
  /** Fondoscala basso: negativo per le grandezze con segno, che vogliono lo zero in mezzo. */
  minimo: number;
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
      <span>{estremo(minimo, unita)}</span>
      <div className="scala" style={{ background: `linear-gradient(90deg, ${tappe.join(",")})` }} />
      <span>{estremo(massimo, unita)}</span>
      {children}
    </div>
  );
}
