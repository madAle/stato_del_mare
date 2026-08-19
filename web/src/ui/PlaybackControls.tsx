import * as Toggle from "@radix-ui/react-toggle";
import { useState } from "react";

type Props = {
  inRiproduzione: boolean;
  cambia: (attiva: boolean) => void;
  cambiaVelocita: (oreAlSecondo: number) => void;
};

const VELOCITA: readonly number[] = [2, 4, 8];

// Deve combaciare con il valore predefinito dentro Animazione (map/animazione.ts):
// alla prima pressione di "riproduci", senza aver ancora toccato le velocita',
// il bottone evidenziato deve dire quello che il ciclo sta gia' facendo, non
// una velocita' diversa scelta a caso qui.
const VELOCITA_PREDEFINITA = 4;

/**
 * Play/pausa e le tre velocita' della riproduzione.
 *
 * Il Toggle di Radix e' la scelta naturale per play/pausa: "premuto" e "in
 * riproduzione" sono lo stesso stato, e onPressedChange consegna gia' il
 * booleano nella forma che cambia() si aspetta. Il nome accessibile del
 * bottone (via aria-label, che vince sul contenuto testuale nel calcolo del
 * nome accessibile) contiene "riproduci" da fermo e "pausa" in riproduzione,
 * perche' un test lo cerca per ruolo e nome.
 */
export function PlaybackControls({ inRiproduzione, cambia, cambiaVelocita }: Props) {
  const [velocita, setVelocita] = useState(VELOCITA_PREDEFINITA);

  return (
    <div className="comandi-riproduzione">
      <Toggle.Root
        className="comandi-riproduzione-play"
        pressed={inRiproduzione}
        onPressedChange={cambia}
        aria-label={inRiproduzione ? "pausa" : "riproduci"}
      >
        {inRiproduzione ? "pausa" : "riproduci"}
      </Toggle.Root>
      <div className="comandi-riproduzione-velocita" role="group" aria-label="velocita di riproduzione">
        {VELOCITA.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === velocita}
            className={v === velocita ? "attiva" : ""}
            onClick={() => {
              setVelocita(v);
              cambiaVelocita(v);
            }}
          >
            {v} ore/s
          </button>
        ))}
      </div>
    </div>
  );
}
