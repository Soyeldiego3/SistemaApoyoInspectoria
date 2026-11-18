import React from 'react';
import { createRoot } from 'react-dom/client';
//import { BrowserRouter } from 'react-router-dom';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Error de render en la aplicación:', error?.name || 'Error');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <section className="card" role="alert" style={{ maxWidth: 420 }}>
          <h2>Ocurrió un error inesperado</h2>
          <p className="muted">La sesión sigue activa. Puedes volver a cargar la aplicación.</p>
          <button className="btn" onClick={() => window.location.reload()}>Recargar</button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </HashRouter>
);
