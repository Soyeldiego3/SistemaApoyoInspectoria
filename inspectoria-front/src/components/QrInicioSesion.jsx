import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { crearCodigoQr } from '../api.js';

const REINTENTO_MS = 5000;
const visibleAhora = () => document.visibilityState === 'visible';

// QR de "Conectar desde el teléfono": la URL lleva un código de un solo uso que dura
// 60 s, así el teléfono entra con la sesión del PC. Se renueva solo mientras la ventana
// está a la vista; si no se puede generar, el QR muestra solo la URL (login normal).
export default function QrInicioSesion({ urlBase }) {
  const [qr, setQr] = useState(null); // { url, usuario, renuevaEn }
  const [restante, setRestante] = useState(0);
  const [visible, setVisible] = useState(visibleAhora);

  useEffect(() => {
    const cambiar = () => setVisible(visibleAhora());
    document.addEventListener('visibilitychange', cambiar);
    return () => document.removeEventListener('visibilitychange', cambiar);
  }, []);

  useEffect(() => {
    if (!visible) {
      setQr(null); // con la ventana oculta no se generan códigos
      return undefined;
    }
    let activo = true;
    let timer;
    const pedir = async () => {
      try {
        const r = await crearCodigoQr();
        if (!activo) return;
        setQr({ url: r.url, usuario: r.usuario, renuevaEn: Date.now() + r.renovarEnMs });
        timer = setTimeout(pedir, r.renovarEnMs);
      } catch {
        // p. ej. el servidor se está reiniciando tras activar el acceso en red
        if (!activo) return;
        setQr(null);
        timer = setTimeout(pedir, REINTENTO_MS);
      }
    };
    pedir();
    return () => { activo = false; clearTimeout(timer); };
  }, [visible, urlBase]);

  useEffect(() => {
    if (!qr) return undefined;
    const tick = () => setRestante(Math.max(0, Math.ceil((qr.renuevaEn - Date.now()) / 1000)));
    tick();
    const intervalo = setInterval(tick, 1000);
    return () => clearInterval(intervalo);
  }, [qr]);

  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
      <QRCodeCanvas value={qr?.url || urlBase} size={140} includeMargin />
      <p className="muted" style={{ margin: 0, fontSize: '.8rem', textAlign: 'center', maxWidth: 180 }} aria-live="polite">
        {qr
          ? <>Entra como <strong>{qr.usuario}</strong>. Se renueva en {restante} s.</>
          : 'Generando código…'}
      </p>
    </div>
  );
}
