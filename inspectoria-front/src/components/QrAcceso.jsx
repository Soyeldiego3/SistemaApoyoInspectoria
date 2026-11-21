import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { crearCodigoAcceso } from '../api.js';

// URL + QR para abrir la app en el teléfono. El QR lleva un código de un solo uso que inicia
// sesión automáticamente; dura 60 s, así que se renueva solo mientras se muestra.
export default function QrAcceso({ base, onMensaje, onError }) {
  const [codigo, setCodigo] = useState(null);
  const [errorCodigo, setErrorCodigo] = useState('');
  const [renovar, setRenovar] = useState(0);

  useEffect(() => {
    let activo = true;
    let timer;
    const pedir = async () => {
      try {
        const respuesta = await crearCodigoAcceso();
        if (!activo) return;
        setCodigo(respuesta.codigo);
        setErrorCodigo('');
        // Se pide uno nuevo un poco antes de que venza
        timer = setTimeout(pedir, Math.max(10_000, respuesta.expiraEnMs - 10_000));
      } catch (e) {
        if (!activo) return;
        setCodigo(null);
        setErrorCodigo(e.message || 'No se pudo generar el código de acceso.');
      }
    };
    pedir();
    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [base, renovar]);

  const urlQr = codigo ? `${base}/?codigo=${encodeURIComponent(codigo)}` : base;

  const copiarUrl = async () => {
    try {
      await navigator.clipboard.writeText(base);
      onMensaje?.('URL copiada.');
    } catch {
      onError?.('No se pudo copiar la URL. Cópiala manualmente.');
    }
  };

  return (
    <div className="row" style={{ alignItems: 'center', marginTop: 16 }}>
      <div style={{ minWidth: 0 }}>
        <p className="big" style={{ fontSize: '1.2rem', margin: 0, overflowWrap: 'anywhere' }}>{base}</p>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: '.85rem' }}>
          {errorCodigo
            ? errorCodigo
            : 'Escanea el QR para entrar sin contraseña. Cada código sirve una sola vez y se renueva cada minuto.'}
        </p>
        <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={copiarUrl}>
            <Copy size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Copiar URL
          </button>
          <button className="btn ghost" onClick={() => setRenovar((n) => n + 1)}>
            <RefreshCw size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Nuevo código
          </button>
        </div>
      </div>
      <QRCodeCanvas value={urlQr} size={140} includeMargin />
    </div>
  );
}
