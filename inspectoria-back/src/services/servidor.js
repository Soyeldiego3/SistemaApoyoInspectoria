const { redHabilitada } = require('./red');

let server;

function iniciarServidor() {
  const app = require('../app');
  const port = process.env.PORT || 3005;
  const host = redHabilitada() ? '0.0.0.0' : '127.0.0.1';
  server = app.listen(port, host, () => {
    console.log(`API corriendo en http://${host}:${port}`);
  });
  return server;
}

function reiniciarServidor() {
  if (!server) return iniciarServidor();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) return reject(error);
      resolve(iniciarServidor());
    });
  });
}

module.exports = { iniciarServidor, reiniciarServidor };
